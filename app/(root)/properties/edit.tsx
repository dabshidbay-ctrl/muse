import React from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useSession } from "@/lib/useSession";
import { useSupabase } from "@/lib/useSupabase";
import { getPropertyById } from "@/lib/api";
import { useProfile } from "@/lib/useProfile";
import { useResponsive } from "@/lib/responsive";
import { BackButton, EmptyState, Skeleton, goBack } from "@/components/ui";
import PropertyForm from "@/components/PropertyForm";

export default function EditProperty() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useSession();
  const { isAgency, isAdmin, loading: profileLoading } = useProfile();
  const { gutter } = useResponsive();

  // A repeated `?id=` in the deep link arrives as an array despite the param
  // type, and an empty string is not a usable id either.
  const propertyId = (Array.isArray(id) ? id[0] : id)?.trim() || null;

  const { data: property, loading, error } = useSupabase({
    fn: (supabase, params: { id: string }) => getPropertyById(supabase, params.id),
    params: { id: propertyId ?? "" },
    skip: !propertyId,
  });

  // Admins may fix any listing; everyone else only their own. Seeded rows have
  // a null owner_id and belong to nobody, so they are never editable in-app.
  const canEdit =
    isAdmin || (!!user?.id && !!property?.owner_id && user.id === property.owner_id);

  const back = () => goBack("/properties/listings");

  // No id at all: the query is skipped, so without this branch the screen would
  // fall through to "Property not found" and blame a listing that was never named.
  if (!propertyId) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        <View style={{ paddingHorizontal: gutter }} className="flex-row items-center gap-sm pt-sm">
          <BackButton fallback="/properties/listings" />
        </View>
        <View className="flex-1 justify-center">
          <EmptyState
            title="No listing selected"
            body="Open a listing from My listings to edit it."
            tone="error"
          />
        </View>
      </SafeAreaView>
    );
  }

  if (loading || profileLoading) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        <View style={{ paddingHorizontal: gutter }} className="p-md gap-sm">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !property) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        <View style={{ paddingHorizontal: gutter }} className="flex-row items-center gap-sm pt-sm">
          <BackButton fallback="/properties/listings" />
        </View>
        <View className="flex-1 justify-center">
          <EmptyState
            title={error ? "Could not load this property" : "Property not found"}
            body={error ?? "It may have been removed."}
            tone="error"
          />
        </View>
      </SafeAreaView>
    );
  }

  if (!canEdit) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        <View style={{ paddingHorizontal: gutter }} className="flex-row items-center gap-sm pt-sm">
          <BackButton fallback="/properties/listings" />
        </View>
        <View className="flex-1 justify-center">
          <EmptyState
            title="Not your listing"
            body="Only the owner of this listing can edit it."
            tone="error"
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      <View
        style={{ paddingHorizontal: gutter }}
        className="flex-row items-center gap-sm pt-sm pb-xs"
      >
        <BackButton fallback="/properties/listings" />
        <Text
          accessibilityRole="header"
          className="flex-1 text-h2 font-rubik-extrabold text-black-300 dark:text-white"
        >
          Edit listing
        </Text>
      </View>

      <PropertyForm
        initial={property}
        initialAmenities={property.amenities?.map((a) => a.name) ?? []}
        isAgency={isAgency}
        onSaved={back}
      />
    </SafeAreaView>
  );
}