import React, { useCallback, useRef, useState } from "react";
import { FlatList, Image, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useSession } from "@/lib/useSession";
import { useSupabase } from "@/lib/useSupabase";
import { deleteProperty, getMyProperties } from "@/lib/api";
import { describeSupabaseError, supabase } from "@/lib/supabase";
import { useProfile } from "@/lib/useProfile";
import { useResponsive } from "@/lib/responsive";
import { BackButton, EmptyState, IconButton, Skeleton, Touchable } from "@/components/ui";
import icons from "@/constants/icons";
import type { Property } from "@/lib/types";
import { captureError } from "@/lib/sentry";

const money = (n: number) =>
  `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function ListingRow({
  item,
  deleting,
  confirming,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  item: Property;
  /** True while this row's delete is in flight. */
  deleting?: boolean;
  /** True while this row is asking the user to confirm. */
  confirming?: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  return (
    <View className="p-md rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark mb-sm">
    <View className="flex-row items-center gap-md">
      {item.image ? (
        <Image
          source={{ uri: item.image }}
          style={{ width: 80, height: 80 }}
          className="rounded-md"
          resizeMode="cover"
          accessibilityLabel={`Photo of ${item.name}`}
          alt={`Photo of ${item.name}`}
        />
      ) : (
        <View className="size-20 rounded-md bg-surface-sunken" />
      )}
      <View className="flex-1">
        <Text
          numberOfLines={1}
          className="text-body font-rubik-bold text-black-300 dark:text-white"
        >
          {item.name}
        </Text>
        <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
          {item.type} · {item.rental_mode === "short_term" ? "Short-term" : "Monthly"}
        </Text>
        <View className="flex-row items-center gap-xs mt-2xs">
          <Text className="text-body font-rubik-extrabold text-primary-300">
            {money(item.price)}
          </Text>
          {item.views_count > 0 ? (
            <View className="flex-row items-center gap-2xs ml-auto">
              <Image
                source={icons.heart}
                style={{ width: 14, height: 14 }}
                accessible={false}
                alt=""
                tintColor="#8C8E98"
              />
              <Text className="text-caption font-rubik text-black-100 dark:text-white/40">
                {item.views_count} {item.views_count === 1 ? "viewer" : "viewers"}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
      <View className="gap-xs">
        <IconButton
          icon={icons.edit}
          label={`Edit ${item.name}`}
          onPress={onEdit}
          disabled={deleting}
        />
        <IconButton
          icon={icons.logout}
          label={deleting ? `Deleting ${item.name}` : `Delete ${item.name}`}
          onPress={onAskDelete}
          // A second tap during the round trip would fire a second delete and
          // then report a spurious failure when the row is already gone.
          disabled={deleting || confirming}
          className="bg-danger/10"
        />
      </View>
    </View>

    {/* An inline two-step confirm, not Alert.alert: react-native-web ships
        `static alert() {}`, so on web the dialog never appeared and the
        callback inside it never ran — deleting a listing was impossible. */}
    {confirming ? (
      <View
        accessibilityRole="alert"
        className="mt-md pt-md border-t border-line dark:border-line-dark"
      >
        <Text className="text-caption font-rubik text-black-200 dark:text-white/60">
          Delete “{item.name}”? Its photos, amenities and bookings go with it. This cannot be
          undone.
        </Text>
        <View className="flex-row gap-xs mt-md">
          <Touchable
            onPress={onCancelDelete}
            disabled={deleting}
            accessibilityLabel={`Keep ${item.name}`}
            style={{ flex: 1, minHeight: 44 }}
            className="items-center justify-center rounded-full border border-line dark:border-line-dark"
          >
            <Text className="text-caption font-rubik-bold text-black-300 dark:text-white">
              Cancel
            </Text>
          </Touchable>
          <Touchable
            onPress={onConfirmDelete}
            disabled={deleting}
            accessibilityLabel={`Confirm delete ${item.name}`}
            accessibilityState={{ busy: !!deleting }}
            style={{ flex: 1, minHeight: 44 }}
            className="items-center justify-center rounded-full bg-danger"
          >
            <Text className="text-caption font-rubik-bold text-white">
              {deleting ? "Deleting…" : "Delete"}
            </Text>
          </Touchable>
        </View>
      </View>
    ) : null}
    </View>
  );
}

export default function MyListings() {
  const { user } = useSession();
  const { canPublish, loading: profileLoading } = useProfile();
  const { gutter, maxContentWidth } = useResponsive();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Surfaced inline; Alert.alert is a no-op on web, so a failed delete used to
  // report nothing at all there.
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: properties, initialLoading, error, refetch } = useSupabase({
    fn: (supabase, params: { userId: string }) => getMyProperties(supabase, params),
    params: { userId: user?.id ?? "" },
    skip: !user?.id,
  });

  // Edits are made on a separate screen, so the list this screen is holding is
  // stale the moment we come back from it. Refetch on every focus but the
  // first, which useSupabase has already covered on mount.
  const mounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!mounted.current) {
        mounted.current = true;
        return;
      }
      if (user?.id) void refetch();
    }, [refetch, user?.id])
  );

  const handleDelete = useCallback(
    async (item: Property) => {
      setDeletingId(item.id);
      setActionError(null);
      try {
        await deleteProperty(supabase, item.id);
        setConfirmingId(null);
        await refetch();
      } catch (err) {
        captureError(err, "listing-delete");
        setActionError(describeSupabaseError(err));
      } finally {
        setDeletingId(null);
      }
    },
    [refetch]
  );

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
        My listings
      </Text>
      {canPublish ? (
        <IconButton
          icon={icons.edit}
          label="Add a listing"
          onPress={() => router.push("/properties/new")}
        />
      ) : null}
    </View>
  );

  // The role is only known once the profile row lands, so the gate below must
  // wait for it rather than treating "not loaded yet" as "not a publisher".
  if (profileLoading || !user?.id) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        {header}
        <View style={{ paddingHorizontal: gutter }} className="gap-sm">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </View>
      </SafeAreaView>
    );
  }

  // Role gate: only publishers (owner, agency, admin) have listings of their own.
  if (!canPublish) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        {header}
        <View className="flex-1 justify-center">
          <EmptyState
            title="Publisher account required"
            body="Listings are limited to property owner and agency accounts. Pick one of those when you sign up, or ask an administrator to change the role on this account."
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      {header}

      {/* `initialLoading`, not `loading`: a refetch after a delete must not
          replace the list with skeletons. */}
      {initialLoading ? (
        <View style={{ paddingHorizontal: gutter }} className="gap-sm">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </View>
      ) : error && !properties?.length ? (
        <View className="flex-1 justify-center">
          <EmptyState title="Could not load your listings" body={error} tone="error" />
        </View>
      ) : (
        <FlatList
          data={properties ?? []}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{
            paddingHorizontal: gutter,
            paddingBottom: 64,
            width: "100%",
            maxWidth: maxContentWidth,
            alignSelf: "center",
          }}
          showsVerticalScrollIndicator={false}
          ListHeaderComponent={
            actionError ? (
              <View
                accessibilityRole="alert"
                className="rounded-lg border border-danger bg-danger/10 p-md mb-sm"
              >
                <Text className="text-caption font-rubik-medium text-danger">{actionError}</Text>
              </View>
            ) : undefined
          }
          ListEmptyComponent={
            <View className="flex-1 justify-center">
              <EmptyState
                title="No listings yet"
                body="Add your first property to start renting it out."
              />
              <Touchable
                onPress={() => router.push("/properties/new")}
                accessibilityLabel="Add a listing"
                style={{ minHeight: 52, alignSelf: "center" }}
                className="items-center justify-center rounded-full bg-primary-300 px-xl"
              >
                <Text className="text-body font-rubik-bold text-white">Add a listing</Text>
              </Touchable>
            </View>
          }
          renderItem={({ item }) => (
            <ListingRow
              item={item}
              deleting={deletingId === item.id}
              confirming={confirmingId === item.id}
              onEdit={() => router.push({ pathname: "/properties/edit", params: { id: item.id } })}
              onAskDelete={() => {
                setActionError(null);
                setConfirmingId(item.id);
              }}
              onCancelDelete={() => setConfirmingId(null)}
              onConfirmDelete={() => void handleDelete(item)}
            />
          )}
        />
      )}
    </SafeAreaView>
  );
}