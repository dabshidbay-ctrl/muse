import { useEffect, useRef } from "react";
import { Stack, router, usePathname } from "expo-router";
import { ActivityIndicator, Platform, SafeAreaView } from "react-native";
import { useSession } from "@/lib/useSession";
import { supabase } from "@/lib/supabase";
import {
  registerForPushNotificationsAsync,
  addNotificationResponseListener,
  getLastNotificationResponseType,
} from "@/lib/pushNotifications";
import { captureError } from "@/lib/sentry";

/**
 * Browsing is public; acting is not. Anyone may view the home feed, Explore,
 * a property detail page, or a marketplace item without an account — a
 * marketplace that shows nothing before sign-in cannot be shared, searched,
 * or tried out. Everything else under (root) still requires a signed-in
 * Supabase user, and anyone else is sent to the sign-in screen: profile,
 * bookings, checkout, payments, favourites, notifications, publishing,
 * editing, managing listings, and admin.
 *
 * The action screens themselves also guard on the user (booking and enquiry
 * submit nothing without a user id), so a public visitor who taps "Book now"
 * or "I am interested" is sent to sign-in at that point instead of hitting
 * a form that silently does nothing.
 */
function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  // /marketplace and /explore are public tabs; /marketplace/new and
  // /marketplace/mine, and /properties/new, /properties/edit and
  // /properties/listings, are actions and stay behind sign-in.
  if (pathname === "/explore" || pathname === "/marketplace") return true;
  if (pathname.startsWith("/marketplace/")) {
    const rest = pathname.slice("/marketplace/".length);
    return rest !== "new" && rest !== "mine" && !rest.includes("/");
  }
  if (pathname.startsWith("/properties/")) {
    const rest = pathname.slice("/properties/".length);
    return rest !== "new" && rest !== "edit" && rest !== "listings" && !rest.includes("/");
  }
  return false;
}

export default function AppLayout() {
  const { isLoaded, isSignedIn, user } = useSession();
  const pathname = usePathname();

  // Register for push notifications once on sign-in (native only —
  // push notifications do not work in a browser tab).
  const registered = useRef(false);
  const registering = useRef(false);
  useEffect(() => {
    if (!isSignedIn || !user?.id || registered.current || registering.current) return;
    if (Platform.OS === "web") return;
    // The flag is only set when a token actually comes back: if the user
    // denied permission the first time, locking registration out forever
    // would mean enabling notifications later in settings did nothing.
    registering.current = true;
    registerForPushNotificationsAsync(supabase, user.id)
      .then((token) => {
        if (token) registered.current = true;
      })
      .catch((err) => captureError(err, "push-register"))
      .finally(() => {
        registering.current = false;
      });
  }, [isSignedIn, user?.id]);

  // Navigate to the relevant screen when the user taps a notification.
  // Only on native — expo-notifications does not work in a browser tab.
  // This covers both a tap while the app is running (listener) and a tap
  // that launched the app from a killed state (last response check).
  const navigateForNotificationType = (type: string) => {
    if (
      type === "booking_requested" ||
      type === "booking_confirmed" ||
      type === "booking_declined" ||
      type === "booking_cancelled"
    ) {
      router.push("/bookings");
    } else if (type === "marketplace_enquiry") {
      router.push("/marketplace/mine");
    } else {
      router.push("/notifications");
    }
  };
  useEffect(() => {
    if (!isSignedIn || Platform.OS === "web") return;
    let sub: { remove: () => void } = { remove: () => {} };
    addNotificationResponseListener(({ type }) => navigateForNotificationType(type)).then(
      (s) => {
        sub = s;
      }
    );
    getLastNotificationResponseType()
      .then((type) => {
        if (type) navigateForNotificationType(type);
      })
      .catch(() => {});
    return () => sub.remove();
  }, [isSignedIn]);

  if (!isLoaded) {
    return (
      <SafeAreaView className="bg-white h-full flex justify-center items-center">
        <ActivityIndicator className="text-primary-300" size="large" />
      </SafeAreaView>
    );
  }

  // Signed-out guard, done as an effect instead of a render-time <Redirect>:
  // rendering <Redirect> out of this layout — which owns the tab navigator —
  // while a tab tap is still settling crashed the release build on Android
  // (tapping Profile while signed out exited the app instead of showing
  // sign-in). Navigating from an effect, after the tap has landed, and
  // rendering nothing meanwhile, takes that transition out of the crash path.
  // The sign-in screen itself lives outside this group, so once the replace
  // lands this layout unmounts and cannot loop back onto itself.
  useEffect(() => {
    if (isLoaded && !isSignedIn && !isPublicPath(pathname) && pathname !== "/sign-in") {
      router.replace("/sign-in");
    }
  }, [isLoaded, isSignedIn, pathname]);

  if (!isSignedIn && !isPublicPath(pathname)) {
    return null;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
