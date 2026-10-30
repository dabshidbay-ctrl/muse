import React, { useState } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useSession } from "@/lib/useSession";
import { signOut } from "@/lib/supabase";
import { useProfile } from "@/lib/useProfile";
import { MIN_TAP, useResponsive } from "@/lib/responsive";
import { EmptyState, SectionHeader, Skeleton, Touchable } from "@/components/ui";
import { THEME_OPTIONS, useTheme } from "@/lib/theme";
import { settings } from "@/constants/data";
import icons from "@/constants/icons";
import { captureError } from "@/lib/sentry";

function Row({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: any;
  label: string;
  danger?: boolean;
  /** Required: a row with no destination does not get rendered at all. */
  onPress: () => void;
}) {
  return (
    <Touchable
      onPress={onPress}
      accessibilityLabel={label}
      className="flex-row items-center gap-md px-md py-sm rounded-md"
    >
      <View
        className={`size-10 rounded-full items-center justify-center ${
          danger ? "bg-danger/10" : "bg-primary-100"
        }`}
      >
        <Image source={icon} style={{ width: 20, height: 20 }} accessible={false} alt="" />
      </View>
      <Text
        className={`flex-1 text-body font-rubik-medium ${
          danger ? "text-danger" : "text-black-300 dark:text-white"
        }`}
      >
        {label}
      </Text>
      {!danger ? (
        <Image source={icons.rightArrow} style={{ width: 16, height: 16 }} accessible={false} alt="" />
      ) : null}
    </Touchable>
  );
}

export default function Profile() {
  const { user } = useSession();
  const { canPublish, isAdmin, loading: profileLoading, error: profileError } = useProfile();
  const { gutter, maxContentWidth } = useResponsive();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  // `settings` (constants/data.ts) still lists rows this app has no screen for
  // — Payments, Security, Language, Help Center, Invite Friends. A row that
  // leads nowhere is not shown at all, so the list is derived from the
  // destinations that actually exist rather than from the constant.
  const DESTINATIONS: Record<string, () => void> = {
    "My Bookings": () => router.push("/bookings"),
    Payments: () => router.push("/payments"),
    Notifications: () => router.push("/notifications"),
    Profile: () => router.push("/profile-edit"),
    "Saved properties": () => router.push("/favorites"),
  };
  const settingsRows = settings.filter((s) => DESTINATIONS[s.title]);
  const { mode: themeMode, scheme: themeScheme, setMode: setThemeMode } = useTheme();

  const handleLogout = async () => {
    // Sign-out tears down the session the whole tree reads from; a second tap
    // mid-flight would fire against a client that is already clearing.
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await signOut();
      // The (root) layout redirects to /sign-in once the session is gone.
    } catch (error) {
      captureError(error, "sign-out");
      // Rendered inline, not via Alert.alert: react-native-web's Alert is a
      // no-op, so on web the failure would be completely invisible and the
      // button would read as broken.
      setSignOutError("Sign out failed. Please try again.");
      setSigningOut(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 120,
          width: "100%",
          maxWidth: maxContentWidth,
          alignSelf: "center",
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text
          accessibilityRole="header"
          className="text-h1 font-rubik-extrabold text-black-300 dark:text-white pt-sm"
        >
          Profile
        </Text>

        {/* Identity card — glass-style layered surface from the design system. */}
        <View className="items-center mt-lg p-lg rounded-xl bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark">
          {user?.imageUrl ? (
            <Image
              source={{ uri: user.imageUrl }}
              style={{ width: 112, height: 112 }}
              className="rounded-full"
              accessibilityLabel={`Profile photo of ${user.fullName ?? "the signed-in user"}`}
              alt={`Profile photo of ${user.fullName ?? "the signed-in user"}`}
            />
          ) : (
            <View className="size-28 rounded-full bg-primary-200" />
          )}
          <Text className="text-h2 font-rubik-bold text-black-300 dark:text-white mt-md text-center">
            {user?.fullName ?? "ReState user"}
          </Text>
          <Text className="text-body font-rubik text-black-200 dark:text-white/60 mt-2xs text-center">
            {user?.email}
          </Text>
        </View>

        <SectionHeader title="Appearance" />
        <View className="rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark p-md">
          <View accessibilityRole="tablist" className="flex-row gap-2xs p-2xs rounded-full bg-surface-muted dark:bg-surface-dark">
            {THEME_OPTIONS.map((option) => {
              const selected = themeMode === option.value;
              return (
                <Touchable
                  key={option.value}
                  onPress={() => setThemeMode(option.value)}
                  accessibilityRole="tab"
                  accessibilityLabel={`${option.label}. ${option.hint}`}
                  accessibilityState={{ selected }}
                  style={{ flex: 1, minHeight: 44 }}
                  className={`flex-1 items-center justify-center rounded-full ${
                    selected ? "bg-surface dark:bg-surface-dark-elevated" : ""
                  }`}
                >
                  <Text
                    className={`text-caption ${
                      selected
                        ? "font-rubik-bold text-primary-300"
                        : "font-rubik-medium text-black-200 dark:text-white/60"
                    }`}
                  >
                    {option.label}
                  </Text>
                </Touchable>
              );
            })}
          </View>
          <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-xs">
            {themeMode === "system"
              ? `Following your device — currently ${themeScheme}.`
              : `Always ${themeMode}, whatever your device is set to.`}
          </Text>
        </View>

        {/* If nothing in `settings` maps to a real screen the whole section
            goes, header included — a titled empty card is worse than nothing. */}
        {settingsRows.length ? (
          <>
            <SectionHeader title="Settings" />
            <View className="rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark py-2xs">
              {settingsRows.map((s) => (
                <Row key={s.title} icon={s.icon} label={s.title} onPress={DESTINATIONS[s.title]} />
              ))}
            </View>
          </>
        ) : null}

        {/* The publishing rows depend on the role, which arrives with the
            profile row — reserve the space rather than popping them in. */}
        {profileLoading ? (
          <>
            <SectionHeader title="My properties" />
            <Skeleton className="h-32 w-full rounded-lg" />
          </>
        ) : profileError ? (
          <>
            <SectionHeader title="My properties" />
            <EmptyState
              title="Couldn’t load your account"
              body={profileError}
              tone="error"
            />
          </>
        ) : canPublish ? (
          <>
            <SectionHeader title="My properties" />
            <View className="rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark py-2xs">
              <Row
                icon={icons.home}
                label="My listings"
                onPress={() => router.push("/properties/listings")}
              />
              <Row
                icon={icons.edit}
                label="Add a listing"
                onPress={() => router.push("/properties/new")}
              />
              <Row
                icon={icons.calendar}
                label="Booking requests"
                onPress={() => router.push("/bookings")}
              />
            </View>
          </>
        ) : (
          /* Hiding the section entirely left tenants with no evidence the
             publishing area exists, so it stays visible and explains the gate
             instead of silently disappearing. */
          <>
            <SectionHeader title="My properties" />
            <View className="rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark p-md">
              <Text className="text-body font-rubik-bold text-black-300 dark:text-white">
                Your account is a tenant account
              </Text>
              <Text className="text-body font-rubik text-black-200 dark:text-white/60 mt-2xs">
                Publishing listings is limited to property owner and agency accounts.
                Change your account type below, or ask an administrator to change the
                role on this account.
              </Text>
              {/* Margin on a wrapper: Touchable's className styles the inner
                  painted view, which must fill the outer tap target. */}
              <View className="mt-md flex-row">
                <Touchable
                  onPress={() => router.push("/profile-edit")}
                  accessibilityLabel="View your account type"
                  accessibilityHint="Opens your profile, where the account type is shown"
                  style={{ flex: 1, minHeight: MIN_TAP }}
                  className="items-center justify-center rounded-full border border-primary-300 px-lg"
                >
                  <Text className="text-caption font-rubik-semibold text-primary-300">
                    View account type
                  </Text>
                </Touchable>
              </View>
            </View>
          </>
        )}

        {/* Moderation tools, for administrators only. `isAdmin` is false while
            the profile is still loading, so this cannot flash at anyone else;
            it lands in the same single transition as "My properties" above,
            whose skeleton is already holding the space. */}
        {isAdmin ? (
          <>
            <SectionHeader title="Administration" />
            <View className="rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark py-2xs">
              <Row
                icon={icons.shield}
                label="Admin console"
                onPress={() => router.push("/admin")}
              />
            </View>
            <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs px-md">
              Moderate every listing and account on the platform.
            </Text>
          </>
        ) : null}

        <SectionHeader title="Account" />
        <View className="rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark py-2xs">
          <Row
            icon={icons.logout}
            label={signingOut ? "Signing out…" : "Log out"}
            danger
            onPress={handleLogout}
          />
        </View>
        {signOutError ? (
          <Text
            accessibilityRole="alert"
            className="text-caption font-rubik-medium text-danger mt-2xs px-md"
          >
            {signOutError}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
