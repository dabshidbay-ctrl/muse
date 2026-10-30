import * as Sentry from "@sentry/react-native";
import { SplashScreen, Stack } from "expo-router";
import "./global.css";
import { useFonts } from "expo-font";
import { useEffect } from "react";
import { Platform } from "react-native";
import { initSentry } from "@/lib/sentry";
import { loadSavedTheme } from "@/lib/theme";
import { configurePushNotifications } from "@/lib/pushNotifications";

// Before the component, so an error thrown while the tree first mounts is still
// reported. Inside an effect this would run too late to catch exactly the class
// of failure that matters most.
initSentry();

// Before first render, not in an effect: applying the saved theme a frame late
// shows the wrong one first, which on web is a white flash on a dark device.
void loadSavedTheme();

// Configure push notification handling before any screen mounts.
// On web this is a no-op — expo-notifications does not work in a browser tab.
if (Platform.OS !== "web") {
  configurePushNotifications().catch(() => {});
}

function RootLayout() {
  const [fontsLoaded] = useFonts({
    "Rubik-Bold": require("../assets/fonts/Rubik-Bold.ttf"),
    "Rubik-ExtraBold": require("../assets/fonts/Rubik-ExtraBold.ttf"),
    "Rubik-Light": require("../assets/fonts/Rubik-Light.ttf"),
    "Rubik-Medium": require("../assets/fonts/Rubik-Medium.ttf"),
    "Rubik-Regular": require("../assets/fonts/Rubik-Regular.ttf"),
    "Rubik-SemiBold": require("../assets/fonts/Rubik-SemiBold.ttf"),
  });

  useEffect(() => {
    if (fontsLoaded) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded]);

  if (!fontsLoaded) return null;

  return <Stack screenOptions={{ headerShown: false }} />;
}

// Sentry.wrap installs the error boundary and touch/navigation breadcrumbs. It
// is a no-op when init() was skipped for want of a DSN.
export default Sentry.wrap(RootLayout);
