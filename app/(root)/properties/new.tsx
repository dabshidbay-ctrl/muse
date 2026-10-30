import React from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useProfile } from "@/lib/useProfile";
import { useResponsive } from "@/lib/responsive";
import { BackButton, EmptyState, Skeleton } from "@/components/ui";
import PropertyForm from "@/components/PropertyForm";

export default function NewProperty() {
  const { canPublish, isAgency, loading: profileLoading } = useProfile();
  const { gutter } = useResponsive();

  const header = (
    <View
      style={{ paddingHorizontal: gutter }}
      className="flex-row items-center gap-sm pt-sm pb-xs"
    >
      <BackButton fallback="/profile" />
      <Text
        accessibilityRole="header"
        className="flex-1 text-h2 font-rubik-extrabold text-black-300 dark:text-white"
      >
        Add a listing
      </Text>
    </View>
  );

  // Until the profile row lands the role is unknown, so rendering the form here
  // would flash a full form at a tenant — and lose anything they had typed when
  // the gate below replaces it.
  if (profileLoading) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        {header}
        <View style={{ paddingHorizontal: gutter }} className="gap-sm">
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-14 w-full" />
          <Skeleton className="h-24 w-full" />
        </View>
      </SafeAreaView>
    );
  }

  // Role gate: publishing requires a publisher role (owner, agency or admin).
  if (!canPublish) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        {header}
        <View className="flex-1 justify-center">
          <EmptyState
            title="Publisher account required"
            body="Publishing is limited to property owner and agency accounts. Pick one of those when you sign up, or ask an administrator to change the role on this account."
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      {header}

      <PropertyForm isAgency={isAgency} />
    </SafeAreaView>
  );
}
