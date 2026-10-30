import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { usePagedQuery } from "@/lib/usePagedQuery";
import { getProperties } from "@/lib/api";
import type { Property, PropertyFilters } from "@/lib/types";
import { useDebounced, useResponsive } from "@/lib/responsive";
import { EmptyState, Touchable } from "@/components/ui";
import { Filters, NoFilterMatches, countActiveFilters } from "@/components/Filters";
import { PropertyCard, PropertyCardSkeleton, PropertyRow } from "@/components/PropertyCard";
import icons from "@/constants/icons";

export default function Explore() {
  const [query, setQuery] = useState("");
  // The panel owns type/district/price/bedrooms; `query` is merged in below so
  // the search box can debounce independently of the selection controls. Every
  // panel key lands in `filters`, which is the useSupabase param — so picking a
  // district changes the params object and refetches, with no extra wiring.
  const [panel, setPanel] = useState<PropertyFilters>({});
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const { columns, gutter, maxContentWidth } = useResponsive();

  // Send the query once typing pauses rather than on every keystroke.
  const debouncedQuery = useDebounced(query, 300);

  const filters: PropertyFilters = useMemo(
    () => ({ ...panel, query: debouncedQuery.trim() || undefined }),
    [panel, debouncedQuery]
  );

  // Paged rather than a flat `limit: 40`: the old query silently dropped every
  // listing past the fortieth, with nothing on screen to say so.
  const {
    items: results,
    initialLoading,
    loadingMore,
    error,
    hasMore,
    loadMore,
  } = usePagedQuery({
    fn: (client, { limit, offset }) =>
      getProperties(client, { filters, limit, offset }),
    params: { filters },
    pageSize: 24,
  });
  // On narrow screens a list is more readable; the toggle only matters above that.
  const effectiveColumns = layout === "list" ? 1 : columns;
  const resultLabel = useMemo(
    () =>
      `${results.length}${hasMore ? "+" : ""} ${
        results.length === 1 ? "property" : "properties"
      }`,
    [results.length, hasMore]
  );

  // A text query narrows the list exactly like the chips do, so an empty result
  // caused by either one has to offer the same way out.
  const narrowed = countActiveFilters(filters) > 0 || !!filters.query;

  const clearEverything = () => {
    setPanel({});
    setQuery("");
  };

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      <FlatList
        key={`explore-${effectiveColumns}`}
        data={initialLoading ? [] : results}
        keyExtractor={(item: Property) => item.id}
        numColumns={effectiveColumns}
        columnWrapperStyle={effectiveColumns > 1 ? { gap: 12 } : undefined}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 120,
          gap: 12,
          width: "100%",
          maxWidth: maxContentWidth,
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <Text
              accessibilityRole="header"
              className="text-h1 font-rubik-extrabold text-black-300 dark:text-white pt-sm"
            >
              Explore
            </Text>
            <Text className="text-body font-rubik text-black-200 dark:text-white/60 mt-2xs">
              Find a place that fits how you live.
            </Text>

            <View className="flex-row items-center gap-sm mt-lg rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md">
              <Image source={icons.search} style={{ width: 20, height: 20 }} accessible={false} alt="" />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name, address or type"
                placeholderTextColor="#8C8E98"
                accessibilityLabel="Search properties"
                returnKeyType="search"
                clearButtonMode="while-editing"
                className="flex-1 py-sm text-body font-rubik text-black-300 dark:text-white"
              />
            </View>

            <Filters value={panel} onChange={setPanel} gutter={gutter} />

            <View className="flex-row items-center justify-between mt-md">
              <Text
                className="text-caption font-rubik-medium text-black-200 dark:text-white/60"
                accessibilityLiveRegion="polite"
              >
                {initialLoading ? "Searching…" : resultLabel}
              </Text>
              <Touchable
                onPress={() => setLayout((l) => (l === "grid" ? "list" : "grid"))}
                accessibilityLabel={`Switch to ${layout === "grid" ? "list" : "grid"} view`}
                accessibilityState={{ selected: layout === "list" }}
                style={{ minHeight: 44, justifyContent: "center" }}
                className="items-center justify-center rounded-full border border-line dark:border-line-dark px-md py-xs"
              >
                <Text className="text-caption font-rubik-semibold text-primary-300">
                  {layout === "grid" ? "List view" : "Grid view"}
                </Text>
              </Touchable>
            </View>

            {error ? <EmptyState title="Couldn’t load properties" body={error} tone="error" /> : null}
          </View>
        }
        onEndReached={loadMore}
        // Fires when the user is within half a screen of the end, so the next
        // page is usually already there by the time they reach it.
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          results.length === 0 ? undefined : loadingMore ? (
            <View className="py-lg items-center">
              <ActivityIndicator size="small" color="#0061FF" />
            </View>
          ) : hasMore ? (
            // A button as well as onEndReached: the automatic trigger does not
            // fire reliably on web, and a list that stops with no way forward
            // is exactly the silent truncation this replaced.
            <Touchable
              onPress={loadMore}
              accessibilityLabel="Load more properties"
              style={{ minHeight: 48, marginTop: 16, marginBottom: 8 }}
              className="items-center justify-center rounded-full border border-line dark:border-line-dark"
            >
              <Text className="text-caption font-rubik-semibold text-primary-300">
                Load more
              </Text>
            </Touchable>
          ) : (
            <Text className="text-caption font-rubik text-black-100 dark:text-white/40 text-center py-lg">
              That’s everything.
            </Text>
          )
        }
        ListEmptyComponent={
          initialLoading ? (
            <View className="gap-sm mt-sm">
              {Array.from({ length: 4 }).map((_, i) => (
                <PropertyCardSkeleton key={i} />
              ))}
            </View>
          ) : error ? undefined : narrowed ? (
            <NoFilterMatches filters={filters} onClear={clearEverything} />
          ) : (
            <EmptyState title="No matches" body="No properties have been published yet." />
          )
        }
        renderItem={({ item, index }) =>
          effectiveColumns === 1 ? (
            <PropertyRow item={item} index={index} />
          ) : (
            <PropertyCard item={item} index={index} />
          )
        }
      />
    </SafeAreaView>
  );
}
