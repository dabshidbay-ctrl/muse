import { useEffect, useRef } from "react";
import { Redirect, Stack, router } from "expo-router";
import { ActivityIndicator, Platform, SafeAreaView } from "react-native";
import { useSession } from "@/lib/useSession";
import { supabase } from "@/lib/supabase";
import {
  registerForPushNotificationsAsync,
  addNotificationResponseListener,
} from "@/lib/pushNotifications";
import { captureError } from "@/lib/sentry";

/**
 * Everything under (root) requires a signed-in Supabase user; anyone else is
 * sent to the sign-in screen.
 */
export default function AppLayout() {
  const { isLoaded, isSignedIn, user } = useSession();

  // Register for push notifications once on sign-in (native only —
  // push notifications do not work in a browser tab).
  const registered = useRef(false);
  useEffect(() => {
    if (!isSignedIn || !user?.id || registered.current) return;
    registered.current = true;
    if (Platform.OS === "web") return;
    registerForPushNotificationsAsync(supabase, user.id).catch((err) =>
      captureError(err, "push-register")
    );
  }, [isSignedIn, user?.id]);

  // Navigate to the relevant screen when the user taps a notification.
  // Only on native — expo-notifications does not work in a browser tab.
  useEffect(() => {
    if (!isSignedIn || Platform.OS === "web") return;
    let sub: { remove: () => void } = { remove: () => {} };
    addNotificationResponseListener(({ type }) => {
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
    }).then((s) => { sub = s; });
    return () => sub.remove();
  }, [isSignedIn]);

  if (!isLoaded) {
    return (
      <SafeAreaView className="bg-white h-full flex justify-center items-center">
        <ActivityIndicator className="text-primary-300" size="large" />
      </SafeAreaView>
    );
  }

  if (!isSignedIn) {
    return <Redirect href="/sign-in" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
