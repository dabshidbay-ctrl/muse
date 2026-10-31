import React, { Component, useState, type ReactNode } from "react";
import { Image, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import Constants from "expo-constants";
import { router } from "expo-router";
import { useSession } from "@/lib/useSession";
import { signOut } from "@/lib/supabase";
import { useProfile } from "@/lib/useProfile";
import { MIN_TAP, useResponsive } from "@/lib/responsive";
import { EmptyState, SectionHeader, Skeleton, Touchable } from "@/components/ui";
import { useSupabase } from "@/lib/useSupabase";
import { getBookingRequests, getMyBookings } from "@/lib/api";
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

const APP_VERSION = Constants.expoConfig?.version ?? "";

const money = (n: number) =>
  `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * If anything in the profile screen itself throws during render, the app
 * must show this fallback instead of exiting: a single screen's render bug
 * must never take down the whole app, and the fallback says which version
 * the user is on so a crash report can be matched to a build.
 */
class ProfileErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    captureError(error, "profile-render");
  }

  render() {
    if (this.state.hasError) {
      return (
        <SafeAreaView
          className="flex-1 bg-surface-muted dark:bg-surface-dark"
          edges={["top"]}
        >
          <View className="flex-1 items-center justify-center px-lg">
            <Text className="text-h2 font-rubik-bold text-black-300 dark:text-white text-center">
              Profile couldn&apos;t load
            </Text>
            <Text className="text-body font-rubik text-black-200 dark:text-white/60 mt-sm text-center">
              Something went wrong on this screen. Your account and listings are
              safe — try going home and coming back.
            </Text>
            <Touchable
              onPress={() => router.replace("/")}
              accessibilityLabel="Go home"
              className="items-center justify-center rounded-full bg-primary-300"
              style={{ minHeight: 56, marginTop: 24, alignSelf: "stretch" }}
            >
              <Text className="text-body font-rubik-bold text-white">Go home</Text>
            </Touchable>
            {APP_VERSION ? (
              <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-lg">
                ReState v{APP_VERSION}
              </Text>
            ) : null}
          </View>
        </SafeAreaView>
      );
    }
    return this.props.children;
  }
}

function ProfileInner() {
  const { user, isSignedIn } = useSession();
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

  // Overview analytics: what this account has paid as a tenant, what it has
  // received as an owner, and the booking counts behind those totals. Paid
  // figures use the recorded paid_amount and fall back to the booking total.
  const mine = useSupabase({
    fn: getMyBookings,
    params: { userId: user?.id ?? "" },
    skip: !user?.id,
  });
  const requests = useSupabase({
    fn: getBookingRequests,
    params: { userId: user?.id ?? "" },
    skip: !user?.id,
  });
  const myBookings = mine.data ?? [];
  const myRequests = requests.data ?? [];
  const paidAsTenant = myBookings
    .filter((b) => b.payment_status === "paid")
    .reduce((sum, b) => sum + Number(b.paid_amount ?? b.total_price ?? 0), 0);
  const receivedAsOwner = myRequests
    .filter((b) => b.payment_status === "paid")
    .reduce((sum, b) => sum + Number(b.paid_amount ?? b.total_price ?? 0), 0);
  const awaitingReply =
    myBookings.filter((b) => b.status === "pending").length +
    myRequests.filter((b) => b.status === "pending").length;
  const analyticsLoading = mine.initialLoading || requests.initialLoading;

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

  // Signed-out visitors land here directly — no layout redirect, no blank
  // frame, nothing mid-transition to crash. This is the screen a signed-out
  // Profile tap is supposed to show, and both buttons carry returnTo so
  // signing in lands back on the real profile instead of Home.
  if (!isSignedIn) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        <View
          style={{
            paddingHorizontal: gutter,
            width: "100%",
            maxWidth: maxContentWidth,
            alignSelf: "center",
            flex: 1,
            justifyContent: "center",
          }}
        >
          <View className="items-center">
            <View className="size-28 rounded-full bg-primary-200 items-center justify-center">
              <Image
                source={icons.person}
                style={{ width: 48, height: 48, tintColor: "#0061FF" }}
                accessible={false}
                alt=""
              />
            </View>
            <Text className="text-h1 font-rubik-extrabold text-black-300 dark:text-white mt-lg text-center">
              Your profile
            </Text>
            <Text className="text-body font-rubik text-black-200 dark:text-white/60 mt-sm text-center">
              Sign in to see your bookings, saved properties and listings.
            </Text>
          </View>
          <Touchable
            onPress={() =>
              router.push({ pathname: "/sign-in", params: { returnTo: "/profile" } })
            }
            accessibilityLabel="Sign in"
            className="items-center justify-center rounded-full bg-primary-300"
            style={{ minHeight: 60, marginTop: 32 }}
          >
            <Text className="text-lead font-rubik-bold text-white">Sign in</Text>
          </Touchable>
          <Touchable
            onPress={() =>
              router.push({
                pathname: "/sign-in",
                params: { returnTo: "/profile", mode: "signup" },
              })
            }
            accessibilityLabel="Create account"
            className="items-center justify-center rounded-full border border-primary-300"
            style={{ minHeight: 60, marginTop: 12 }}
          >
            <Text className="text-lead font-rubik-bold text-primary-300">Create account</Text>
          </Touchable>
          {APP_VERSION ? (
            <Text className="text-caption font-rubik text-black-100 dark:text-white/40 text-center mt-lg">
              ReState v{APP_VERSION}
            </Text>
          ) : null}
        </View>
      </SafeAreaView>
    );
  }

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

        {/* Overview: money in and out, plus the booking counts behind them.
            No theme picker lives here anymore — the app is light-only now. */}
        <SectionHeader title="Overview" />
        <View className="rounded-lg bg-surface border border-line p-md">
          {analyticsLoading ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <>
              <View className="flex-row gap-sm">
                <View className="flex-1 rounded-md bg-primary-100 p-md">
                  <Text className="text-caption font-rubik-medium text-black-200">
                    Paid as tenant
                  </Text>
                  <Text className="text-h2 font-rubik-extrabold text-black-300 mt-2xs">
                    {money(paidAsTenant)}
                  </Text>
                </View>
                <View className="flex-1 rounded-md bg-success/10 p-md">
                  <Text className="text-caption font-rubik-medium text-black-200">
                    Received as owner
                  </Text>
                  <Text className="text-h2 font-rubik-extrabold text-success mt-2xs">
                    {money(receivedAsOwner)}
                  </Text>
                </View>
              </View>
              <View className="flex-row gap-sm mt-md">
                <View className="flex-1 items-center">
                  <Text className="text-body font-rubik-bold text-black-300">
                    {myBookings.length}
                  </Text>
                  <Text className="text-caption font-rubik text-black-200">My bookings</Text>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-body font-rubik-bold text-black-300">
                    {myRequests.length}
                  </Text>
                  <Text className="text-caption font-rubik text-black-200">Requests</Text>
                </View>
                <View className="flex-1 items-center">
                  <Text className="text-body font-rubik-bold text-black-300">
                    {awaitingReply}
                  </Text>
                  <Text className="text-caption font-rubik text-black-200">Awaiting reply</Text>
                </View>
              </View>
              <Touchable
                onPress={() => router.push("/payments")}
                accessibilityLabel="View payments"
                style={{ minHeight: 44, marginTop: 12 }}
                className="items-center justify-center rounded-full border border-primary-300"
              >
                <Text className="text-body font-rubik-bold text-primary-300">View payments</Text>
              </Touchable>
            </>
          )}
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
        {APP_VERSION ? (
          <Text className="text-caption font-rubik text-black-100 dark:text-white/40 text-center mt-lg">
            ReState v{APP_VERSION}
          </Text>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default function Profile() {
  return (
    <ProfileErrorBoundary>
      <ProfileInner />
    </ProfileErrorBoundary>
  );
}
