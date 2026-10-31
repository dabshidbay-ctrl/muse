import { Platform } from "react-native";
import Constants from "expo-constants";
import type { SupabaseClient } from "@supabase/supabase-js";
import { captureError } from "./sentry";

// Lazy getters — static import of expo-notifications crashes on web because
// the native modules aren't available. These are only called from native code
// paths, so dynamic import is safe there.
let _Notifications: typeof import("expo-notifications") | null = null;
let _Device: typeof import("expo-device") | null = null;

async function getNotifications() {
  if (_Notifications) return _Notifications;
  try {
    _Notifications = await import("expo-notifications");
  } catch {
    // Module not available (web, Expo Go without native modules, etc.)
    return null;
  }
  return _Notifications;
}

function getDevice() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _Device = require("expo-device");
  } catch {
    // Not available — fine on web.
  }
  return _Device;
}

/**
 * Configures the global notification handler so foreground notifications show
 * a banner. On web this is a no-op.
 */
export async function configurePushNotifications(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const Notifications = await getNotifications();
    if (!Notifications) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
  } catch {
    // Silently skip if the module is unavailable.
  }
}

/**
 * Registers the device for push notifications. On web and simulators this
 * returns null without prompting.
 */
export async function registerForPushNotificationsAsync(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  if (Platform.OS === "web") return null;
  const Device = getDevice();
  if (!Device?.isDevice) return null;

  try {
    const Notifications = await getNotifications();
    if (!Notifications) return null;

    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== "granted") {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    if (finalStatus !== "granted") return null;

    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("default", {
        name: "default",
        importance: Notifications.AndroidImportance.DEFAULT,
        sound: "default",
      });
    }

    // In a standalone EAS build the push token request needs the EAS
    // project id — without it the call fails and no token is ever saved,
    // so no push ever arrives even though everything else looks wired up.
    // Constants is how the app reads it: app.json > expo.extra.eas.projectId.
    // Expo Go / dev builds have no project id, and there the no-arg call is
    // the correct one, so fall back to it rather than failing outright.
    const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
    const eas = extra.eas as Record<string, unknown> | undefined;
    const projectId =
      (typeof eas?.projectId === "string" ? eas.projectId : undefined) ??
      (typeof (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId === "string"
        ? (Constants as unknown as { easConfig: { projectId: string } }).easConfig.projectId
        : undefined);
    const tokenData = projectId
      ? await Notifications.getExpoPushTokenAsync({ projectId })
      : await Notifications.getExpoPushTokenAsync();
    const token = tokenData.data;

    const { error } = await supabase.from("push_tokens").insert({ token, user_id: userId });
    if (error && (error as { code?: string }).code !== "23505") {
      captureError(error, "push-token-save");
    }
    return token;
  } catch {
    // Expo Go cannot provide push tokens — this is expected and harmless.
    return null;
  }
}

/**
 * Removes the device's push token on sign-out.
 */
export async function unregisterPushNotificationsAsync(
  supabase: SupabaseClient
): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    const Notifications = await getNotifications();
    if (!Notifications) return;
    const tokenData = await Notifications.getExpoPushTokenAsync();
    await supabase.from("push_tokens").delete().eq("token", tokenData.data);
  } catch {
    // No token to remove.
  }
}

/**
 * Returns the app's last known Expo push token, without re-registering.
 */
export async function getExistingPushToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const Notifications = await getNotifications();
    if (!Notifications) return null;
    const tokenData = await Notifications.getExpoPushTokenAsync();
    return tokenData.data;
  } catch {
    return null;
  }
}

/**
 * Registers a listener for incoming notifications while the app is in the
 * foreground. On web this is a no-op.
 */
export async function addNotificationReceivedListener(
  callback: (args: { title: string; body: string | null; type: string }) => void
): Promise<{ remove: () => void }> {
  if (Platform.OS === "web") return { remove: () => {} };
  try {
    const Notifications = await getNotifications();
    if (!Notifications) return { remove: () => {} };
    return Notifications.addNotificationReceivedListener((notification) => {
      const { title, body } = notification.request.content;
      const type = (notification.request.content.data?.type as string) ?? "general";
      callback({ title: title ?? "", body: body ?? null, type });
    });
  } catch {
    return { remove: () => {} };
  }
}

/**
 * The notification that launched the app from a killed state, if any.
 * A response listener registered after sign-in can miss a cold-start tap
 * (the app was not running when the tap happened), so the layout also
 * checks this once on mount and navigates from it.
 */
export async function getLastNotificationResponseType(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const Notifications = await getNotifications();
    if (!Notifications) return null;
    const response = await Notifications.getLastNotificationResponseAsync();
    const type = response?.notification.request.content.data?.type;
    return typeof type === "string" ? type : null;
  } catch {
    return null;
  }
}

/**
 * Registers a listener for when the user taps a notification. On web this is
 * a no-op.
 */
export async function addNotificationResponseListener(
  callback: (args: { type: string }) => void
): Promise<{ remove: () => void }> {
  if (Platform.OS === "web") return { remove: () => {} };
  try {
    const Notifications = await getNotifications();
    if (!Notifications) return { remove: () => {} };
    return Notifications.addNotificationResponseReceivedListener((response) => {
      const type = (response.notification.request.content.data?.type as string) ?? "general";
      callback({ type });
    });
  } catch {
    return { remove: () => {} };
  }
}