import { Tabs } from "expo-router";
import { Image, Platform, type ImageSourcePropType } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "nativewind";
import { shadow } from "@/lib/responsive";

const ACTIVE = "#0061FF";
const INACTIVE = "#666876";

/**
 * The tab bar is styled through React Navigation's style objects, not
 * className, so no `dark:` variant can reach it — it stayed white while the
 * rest of the app went dark. These mirror the `surface`/`line` tokens in
 * tailwind.config.js; keep them in step with those.
 */
const BAR = {
  light: { background: "#FFFFFF", border: "#E6EAF2", inactive: INACTIVE },
  dark: { background: "#1B1E28", border: "#2A2F3D", inactive: "#8C8E98" },
} as const;

/**
 * Icon only. The label is rendered by React Navigation via `tabBarLabel`, so it
 * lays out and vertically centres icon + label together. Packing both into
 * `tabBarIcon` overflows the bar (the icon escapes the top edge and the label
 * lands flush against the bottom of the screen).
 */
const tabIcon =
  (icon: ImageSourcePropType, inactive: string) =>
  ({ focused }: { focused: boolean }) => (
    <Image
      source={icon}
      tintColor={focused ? ACTIVE : inactive}
      resizeMode="contain"
      style={{ width: 24, height: 24 }}
      accessible={false}
      alt=""
    />
  );

export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { colorScheme } = useColorScheme();
  const bar = colorScheme === "dark" ? BAR.dark : BAR.light;

  // Sit above the gesture bar / nav bar, but keep a floor on phones that
  // report no bottom inset so the bar never hugs the screen edge.
  const bottomInset = Math.max(insets.bottom, 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // Labels always visible: tab state is never signalled by colour alone.
        tabBarShowLabel: true,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: bar.inactive,
        tabBarLabelStyle: {
          fontFamily: "Rubik-Medium",
          fontSize: 12,
          lineHeight: 16,
          marginTop: 2,
        },
        tabBarIconStyle: { marginTop: 2 },
        // minHeight keeps each item at/above the platform tap minimum even
        // though the icon+label content is shorter than that.
        tabBarItemStyle: { paddingTop: 8, paddingBottom: 4, minHeight: 48 },
        tabBarStyle: {
          backgroundColor: bar.background,
          borderTopColor: bar.border,
          borderTopWidth: 1,
          // Mobile-first on web too: on a wide desktop window the tab bar
          // is capped at the same centred column as the detail page, instead
          // of stretching across the whole screen. Native phones are
          // untouched — their bar is already phone-width.
          ...(Platform.OS === "web"
            ? { width: "100%", maxWidth: 560, alignSelf: "center", left: 0, right: 0, marginHorizontal: "auto" as const }
            : {}),
          // 76, not 64: the content box is height - paddingTop - paddingBottom,
          // and each item needs minHeight 48 plus its own 8/4 padding = 60. At
          // 64 the box was 58 and the *label* was the thing that overflowed and
          // vanished, leaving colour as the only signal of the active tab.
          height: 76 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 6,
          ...shadow({ opacity: 0.06, radius: 12, offsetY: -4, elevation: 8 }),
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarLabel: "Home",
          tabBarAccessibilityLabel: "Home tab",
          tabBarIcon: tabIcon(require("@/assets/icons/home.png"), bar.inactive),
        }}
      />
      <Tabs.Screen
        name="explore"
        options={{
          title: "Explore",
          tabBarLabel: "Explore",
          tabBarAccessibilityLabel: "Explore tab",
          tabBarIcon: tabIcon(require("@/assets/icons/search.png"), bar.inactive),
        }}
      />
      <Tabs.Screen
        name="marketplace"
        options={{
          title: "Marketplace",
          // "Marketplace" is 11 characters; at 12px Rubik-Medium it does not fit
          // a quarter of a 320px bar and React Navigation would shrink or clip
          // it. "Market" fits every tab width we support with room to spare, and
          // the full word stays in the accessible name and the screen title.
          tabBarLabel: "Market",
          tabBarAccessibilityLabel: "Marketplace tab",
          tabBarIcon: tabIcon(require("@/assets/icons/wallet.png"), bar.inactive),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: "Profile",
          tabBarLabel: "Profile",
          tabBarAccessibilityLabel: "Profile tab",
          tabBarIcon: tabIcon(require("@/assets/icons/person.png"), bar.inactive),
        }}
      />
    </Tabs>
  );
}
