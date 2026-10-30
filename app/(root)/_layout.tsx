import { useEffect, useRef } from "react";
import { Redirect, Stack, router, usePathname } from "expo-router";
import { ActivityIndicator, Platform, SafeAreaView } from "react-native";
import { useSession } from "@/lib/useSession";
import { supabase } from "@/lib/supabase";
import {
  registerForPushNotificationsAsync,
  addNotificationResponseListener,
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

  if (!isSignedIn && !isPublicPath(pathname)) {
    return <Redirect href="/sign-in" />;
  }

  return <Stack screenOptions={{ headerShown: false }} />;
}
