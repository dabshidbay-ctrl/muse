import React, { useCallback, useEffect, useMemo, useState } from "react";
import { FlatList, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSession } from "@/lib/useSession";
import { useSupabase } from "@/lib/useSupabase";
import { getFavoriteProperties, getFavorites } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import { addFavorite, removeFavorite } from "@/lib/api";
import { useResponsive } from "@/lib/responsive";
import { BackButton, EmptyState, Skeleton } from "@/components/ui";
import { PropertyCard, PropertyCardSkeleton } from "@/components/PropertyCard";
import { captureError } from "@/lib/sentry";
import type { Property } from "@/lib/types";

export default function Favorites() {
  const { user } = useSession();
  const { columns, gutter, maxContentWidth } = useResponsive();

  const { data: properties, initialLoading, error, refetch } = useSupabase({
    fn: getFavoriteProperties,
    params: { userId: user?.id ?? "" },
    skip: !user?.id,
  });

  // Track which ids are favourited so toggling is instant — the full list from
  // getFavoriteProperties is stale until refetch, and a freshly un-favourited
  // card would flash the filled heart for a moment.
  const [favoriteIds, setFavoriteIds] = useState<Set<string> | null>(null);

  // Seed the set from the data load in an effect, never during render:
  // render-phase setState is fragile, and the old seed ran only while the
  // set was null, so a property favourited elsewhere later still showed an
  // unfilled heart here. The list itself is the favourite list, so before
  // the first seed every card is favourited by definition.
  const items = properties ?? [];
  useEffect(() => {
    setFavoriteIds(new Set(items.map((p) => p.id)));
    // Depend on the fetched data, not the derived array (new identity every
    // render), so optimistic toggles are not clobbered by re-seeding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [properties]);

  const handleToggle = useCallback(
    async (propertyId: string, currentlyFav: boolean) => {
      if (!user?.id) return;

      // Optimistic update.
      setFavoriteIds((prev) => {
        const next = new Set(prev ?? []);
        if (currentlyFav) next.delete(propertyId);
        else next.add(propertyId);
        return next;
      });

      try {
        if (currentlyFav) {
          await removeFavorite(supabase, user.id, propertyId);
        } else {
          await addFavorite(supabase, user.id, propertyId);
        }
        // Refetch the full list so the screen reflects the real state.
        await refetch();
      } catch (err) {
        captureError(err, "favourite-toggle");
        // Roll back the optimistic update.
        setFavoriteIds((prev) => {
          const next = new Set(prev ?? []);
          if (currentlyFav) next.add(propertyId);
          else next.delete(propertyId);
          return next;
        });
      }
    },
    [user?.id, refetch],
  );

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      <View
        style={{ paddingHorizontal: gutter }}
        className="flex-row items-center gap-sm pt-sm pb-xs"
      >
        <BackButton fallback="/profile" />
        <Text
          accessibilityRole="header"
          className="flex-1 text-h2 font-rubik-extrabold text-black-300 dark:text-white"
        >
          Saved properties
        </Text>
      </View>

      <FlatList
        key={`favs-${columns}`}
        data={initialLoading ? [] : items}
        keyExtractor={(item: Property) => item.id}
        numColumns={columns}
        columnWrapperStyle={columns > 1 ? { gap: 12 } : undefined}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 120,
          gap: 12,
          width: "100%",
          maxWidth: maxContentWidth,
          alignSelf: "center",
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          initialLoading ? (
            <View className="flex-row flex-wrap gap-sm">
              {Array.from({ length: columns * 2 }).map((_, i) => (
                <View key={i} style={{ flex: 1, minWidth: `${100 / columns - 4}%` }}>
                  <PropertyCardSkeleton />
                </View>
              ))}
            </View>
          ) : error ? (
            <EmptyState title="Couldn't load saved properties" body={error} tone="error" />
          ) : (
            <EmptyState
              title="Nothing saved yet"
              body="Tap the heart on any property to save it here."
            />
          )
        }
        renderItem={({ item, index }) => (
          <PropertyCard
            item={item}
            index={index}
            isFavorite={favoriteIds ? favoriteIds.has(item.id) : true}
            onToggleFavorite={() =>
              handleToggle(item.id, favoriteIds ? favoriteIds.has(item.id) : true)
            }
          />
        )}
      />
    </SafeAreaView>
  );
}