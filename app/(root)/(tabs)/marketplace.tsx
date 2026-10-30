import { useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Image, ScrollView, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { usePagedQuery } from "@/lib/usePagedQuery";
import { listMarketplaceItems } from "@/lib/marketplaceApi";
import type {
  MarketplaceCategory,
  MarketplaceCondition,
  MarketplaceFilters,
  MarketplaceItem,
} from "@/lib/types";
import { MIN_TAP, SPACE, shadow, useDebounced, useResponsive } from "@/lib/responsive";
import { Chip, EmptyState, FadeInUp, Skeleton, Touchable } from "@/components/ui";
// Read-only reuse: the district sheet and its label lookup are the same control
// the property search uses, so "Hodan" means the same thing in both places.
// `components/Filters.tsx` itself is property-shaped, so the marketplace panel
// below is built here rather than by widening that component.
import { DistrictSelect, districtLabel, type DistrictValue } from "@/components/Filters";
import { marketplaceCategories, marketplaceConditions } from "@/constants/data";
import icons from "@/constants/icons";

const money = (n: number) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const categoryLabel = (v: MarketplaceCategory) =>
  marketplaceCategories.find((c) => c.value === v)?.label ?? v;
const conditionLabel = (v: MarketplaceCondition) =>
  marketplaceConditions.find((c) => c.value === v)?.label ?? v;

/**
 * Second-hand furniture spans a much narrower range than rent, so the bands are
 * tighter than the property ones. Bands rather than a slider or two number
 * boxes: this stays a one-tap control, and it maps straight onto
 * `minPrice`/`maxPrice` in the contract's filter shape.
 */
const PRICE_BANDS: { label: string; short: string; min?: number; max?: number }[] = [
  { label: "Any price", short: "Any" },
  { label: "Under $50", short: "< $50", max: 50 },
  { label: "$50 to $150", short: "$50–150", min: 50, max: 150 },
  { label: "$150 to $400", short: "$150–400", min: 150, max: 400 },
  { label: "$400 to $1,000", short: "$400–1k", min: 400, max: 1000 },
  { label: "$1,000 and up", short: "$1k+", min: 1000 },
];

function bandIndex(f: MarketplaceFilters): number {
  const i = PRICE_BANDS.findIndex((b) => b.min === f.minPrice && b.max === f.maxPrice);
  return i === -1 ? 0 : i;
}

function activeCount(f: MarketplaceFilters): number {
  let n = 0;
  if (f.category && f.category !== "all") n += 1;
  if (f.condition && f.condition !== "all") n += 1;
  if (f.district && f.district !== "all") n += 1;
  if (f.minPrice !== undefined || f.maxPrice !== undefined) n += 1;
  return n;
}

/** Human summary of what is narrowing the list, for the badge line and the empty state. */
function describe(f: MarketplaceFilters): string[] {
  const out: string[] = [];
  if (f.category && f.category !== "all") out.push(categoryLabel(f.category));
  if (f.condition && f.condition !== "all") out.push(conditionLabel(f.condition));
  const d = districtLabel(f.district);
  if (d) out.push(d);
  const band = bandIndex(f);
  if (band > 0) out.push(PRICE_BANDS[band].short);
  return out;
}

function FilterRow({
  title,
  gutter,
  children,
}: {
  title: string;
  gutter: number;
  children: React.ReactNode;
}) {
  return (
    <View className="mt-sm">
      <Text
        accessibilityRole="header"
        className="text-caption font-rubik-semibold text-black-200 dark:text-white/60 mb-2xs"
      >
        {title}
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: SPACE.xs, paddingRight: gutter, paddingVertical: 2 }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

const CARD_IMAGE_HEIGHT = 148;

function ItemCard({ item, index }: { item: MarketplaceItem; index: number }) {
  const cover = item.images?.[0];
  const district = districtLabel(item.district);

  return (
    // flex-1 belongs on this wrapper, never on the Touchable's className — that
    // className paints the inner view, and a flex-basis of 0 there collapses the
    // card to a sliver.
    <FadeInUp index={index} className="flex-1">
      <Touchable
        // The object form, not a template string: typed routes reject an
        // interpolated path for a dynamic segment.
        onPress={() => router.push({ pathname: "/marketplace/[id]", params: { id: item.id } })}
        accessibilityLabel={`${item.title}, ${money(item.price)}${
          item.negotiable ? ", negotiable" : ""
        }, ${conditionLabel(item.condition)}, ${categoryLabel(item.category)}${
          district ? `, ${district}` : ""
        }`}
        accessibilityHint="Opens the item"
        style={{ flex: 1, ...shadow({ opacity: 0.05, radius: 10, offsetY: 4, elevation: 2 }) }}
        className="rounded-lg overflow-hidden bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark"
      >
        {cover ? (
          // Sized inline: a `size-*`/`h-*` class loses to the atomic class
          // react-native-web emits for the asset's intrinsic size.
          <Image
            source={{ uri: cover }}
            style={{ width: "100%", height: CARD_IMAGE_HEIGHT }}
            resizeMode="cover"
            accessible={false}
            alt=""
          />
        ) : (
          <View
            style={{ width: "100%", height: CARD_IMAGE_HEIGHT }}
            className="items-center justify-center bg-surface-sunken dark:bg-surface-dark-elevated"
          >
            <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
              No photo
            </Text>
          </View>
        )}

        <View className="p-sm">
          <View className="flex-row items-center justify-between">
            {/* Price leads the card: it is the single thing a buyer scans for. */}
            <Text className="text-h3 font-rubik-extrabold text-primary-300">
              {money(item.price)}
            </Text>
            {item.negotiable ? (
              <View className="rounded-full bg-success/15 px-xs py-2xs">
                <Text className="text-caption font-rubik-semibold text-success">Negotiable</Text>
              </View>
            ) : null}
          </View>

          <Text
            numberOfLines={2}
            className="text-body font-rubik-semibold text-black-300 dark:text-white mt-2xs"
          >
            {item.title}
          </Text>

          {/* Condition and category are the next two facts, as text rather than
              colour-coded pills — the tone would be the only carrier otherwise. */}
          <Text
            numberOfLines={1}
            className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mt-2xs"
          >
            {conditionLabel(item.condition)} · {categoryLabel(item.category)}
          </Text>

          {district ? (
            <View className="flex-row items-center gap-2xs mt-2xs">
              <Image
                source={icons.location}
                style={{ width: 14, height: 14 }}
                accessible={false}
                alt=""
              />
              <Text
                numberOfLines={1}
                className="text-caption font-rubik text-black-200 dark:text-white/60"
              >
                {district}
              </Text>
            </View>
          ) : null}
        </View>
      </Touchable>
    </FadeInUp>
  );
}

function ItemCardSkeleton() {
  return (
    <View className="flex-1 rounded-lg overflow-hidden bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark">
      <Skeleton className="rounded-none" style={{ width: "100%", height: CARD_IMAGE_HEIGHT }} />
      <View className="p-sm gap-2xs">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
      </View>
    </View>
  );
}

export default function Marketplace() {
  const [query, setQuery] = useState("");
  const [panel, setPanel] = useState<MarketplaceFilters>({});
  const [expanded, setExpanded] = useState(false);
  const { columns, gutter, maxContentWidth } = useResponsive();

  const debouncedQuery = useDebounced(query, 300);

  const filters: MarketplaceFilters = useMemo(
    () => ({ ...panel, query: debouncedQuery.trim() || undefined }),
    [panel, debouncedQuery]
  );

  // Paged rather than a flat `limit: 40`: the old query dropped every item past
  // the fortieth with nothing on screen to say so, which to a seller looks like
  // their listing vanished.
  const {
    items,
    initialLoading,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh: refetch,
  } = usePagedQuery({
    fn: (client, { limit, offset }) =>
      listMarketplaceItems(client, { filters, limit, offset }),
    params: { filters },
    pageSize: 24,
  });
  const active = activeCount(filters);
  // A text query narrows the list exactly like the chips do, so an empty result
  // from either has to offer the same way out.
  const narrowed = active > 0 || !!filters.query;
  const summary = useMemo(() => describe(filters), [filters]);
  const band = bandIndex(panel);

  const clearEverything = () => {
    setPanel({});
    setQuery("");
  };

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      <FlatList
        key={`marketplace-${columns}`}
        data={initialLoading ? [] : items}
        keyExtractor={(item: MarketplaceItem) => item.id}
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
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={
          <View>
            <Text
              accessibilityRole="header"
              className="text-h1 font-rubik-extrabold text-black-300 dark:text-white pt-sm"
            >
              Marketplace
            </Text>
            <Text className="text-body font-rubik text-black-200 dark:text-white/60 mt-2xs">
              Second-hand furniture from people nearby.
            </Text>

            {/* Selling is the other half of a marketplace, so the way in is on
                the first screen rather than buried in a profile menu. */}
            <View className="flex-row items-center gap-xs mt-md">
              <Touchable
                onPress={() => router.push("/marketplace/new")}
                accessibilityLabel="Sell an item"
                accessibilityHint="Opens the form to list furniture for sale"
                style={{ flex: 1, minHeight: MIN_TAP }}
                className="items-center justify-center rounded-full bg-primary-300 px-lg"
              >
                <Text className="text-body font-rubik-semibold text-white">Sell an item</Text>
              </Touchable>
              <Touchable
                onPress={() => router.push("/marketplace/mine")}
                accessibilityLabel="My listings"
                accessibilityHint="Shows the items you listed and their approval status"
                style={{ minHeight: MIN_TAP }}
                className="items-center justify-center rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md"
              >
                <Text className="text-body font-rubik-semibold text-primary-300">My listings</Text>
              </Touchable>
            </View>

            <View className="flex-row items-center gap-sm mt-md rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md">
              <Image
                source={icons.search}
                style={{ width: 20, height: 20 }}
                accessible={false}
                alt=""
              />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder="Search sofas, beds, desks…"
                placeholderTextColor="#8C8E98"
                accessibilityLabel="Search marketplace items"
                returnKeyType="search"
                clearButtonMode="while-editing"
                className="flex-1 py-sm text-body font-rubik text-black-300 dark:text-white"
              />
            </View>

            {/* Category is the most-used filter here, so it never collapses. */}
            <FilterRow title="Category" gutter={gutter}>
              <Chip
                label="All"
                selected={(panel.category ?? "all") === "all"}
                purpose="Filter by category,"
                onPress={() => setPanel((p) => ({ ...p, category: "all" }))}
              />
              {marketplaceCategories.map((c) => (
                <Chip
                  key={c.value}
                  label={c.label}
                  selected={panel.category === c.value}
                  purpose="Filter by category,"
                  onPress={() => setPanel((p) => ({ ...p, category: c.value }))}
                />
              ))}
            </FilterRow>

            <View className="flex-row items-center gap-xs mt-sm">
              <Touchable
                onPress={() => setExpanded((e) => !e)}
                accessibilityLabel={
                  active
                    ? `${expanded ? "Hide" : "Show"} condition, price and district filters, ${active} active`
                    : `${expanded ? "Hide" : "Show"} condition, price and district filters`
                }
                accessibilityState={{ selected: expanded }}
                style={{ minHeight: MIN_TAP }}
                className="flex-row items-center justify-center gap-2xs rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md"
              >
                <Text className="text-caption font-rubik-semibold text-black-300 dark:text-white">
                  {expanded ? "Fewer filters" : "More filters"}
                </Text>
                {active ? (
                  <View className="min-w-[20px] h-[20px] px-2xs rounded-full bg-primary-300 items-center justify-center">
                    <Text className="text-caption font-rubik-bold text-white">{active}</Text>
                  </View>
                ) : null}
              </Touchable>

              {narrowed ? (
                <Touchable
                  onPress={clearEverything}
                  accessibilityLabel="Clear all filters"
                  accessibilityHint="Removes the search text and every filter"
                  style={{ minHeight: MIN_TAP }}
                  className="items-center justify-center rounded-full border border-primary-300 bg-primary-100 px-md"
                >
                  <Text className="text-caption font-rubik-semibold text-primary-300">
                    Clear all
                  </Text>
                </Touchable>
              ) : null}
            </View>

            {/* Spelled out even while collapsed: a filter must never silently
                shape the results the user is looking at. */}
            {active && !expanded ? (
              <Text
                accessibilityLiveRegion="polite"
                className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs"
              >
                {summary.join(" · ")}
              </Text>
            ) : null}

            {expanded ? (
              <View>
                <FilterRow title="Condition" gutter={gutter}>
                  <Chip
                    label="Any"
                    selected={(panel.condition ?? "all") === "all"}
                    purpose="Filter by condition,"
                    onPress={() => setPanel((p) => ({ ...p, condition: "all" }))}
                  />
                  {marketplaceConditions.map((c) => (
                    <Chip
                      key={c.value}
                      label={c.label}
                      selected={panel.condition === c.value}
                      purpose="Filter by condition,"
                      onPress={() => setPanel((p) => ({ ...p, condition: c.value }))}
                    />
                  ))}
                </FilterRow>

                <FilterRow title="Price" gutter={gutter}>
                  {PRICE_BANDS.map((b, i) => (
                    <Chip
                      key={b.label}
                      label={b.short}
                      selected={band === i}
                      purpose="Filter by price,"
                      onPress={() =>
                        setPanel((p) => ({
                          ...p,
                          minPrice: PRICE_BANDS[i].min,
                          maxPrice: PRICE_BANDS[i].max,
                        }))
                      }
                    />
                  ))}
                </FilterRow>

                <View className="mt-sm">
                  <Text
                    accessibilityRole="header"
                    className="text-caption font-rubik-semibold text-black-200 dark:text-white/60 mb-2xs"
                  >
                    District
                  </Text>
                  <DistrictSelect
                    value={
                      panel.district && panel.district !== "all"
                        ? (panel.district as DistrictValue)
                        : null
                    }
                    onChange={(d) => setPanel((p) => ({ ...p, district: d ?? undefined }))}
                    anyLabel="Any district"
                  />
                </View>
              </View>
            ) : null}

            <View className="flex-row items-center justify-between mt-md">
              <Text
                className="text-caption font-rubik-medium text-black-200 dark:text-white/60"
                accessibilityLiveRegion="polite"
              >
                {initialLoading
                  ? "Searching…"
                  : `${items.length}${hasMore ? "+" : ""} ${
                      items.length === 1 ? "item" : "items"
                    }`}
              </Text>
            </View>

            {error ? (
              <View>
                <EmptyState title="Couldn’t load the marketplace" body={error} tone="error" />
                <View className="items-center">
                  <Touchable
                    onPress={() => void refetch()}
                    accessibilityLabel="Try loading the marketplace again"
                    style={{ minHeight: MIN_TAP }}
                    className="items-center justify-center rounded-full bg-primary-300 px-lg"
                  >
                    <Text className="text-body font-rubik-semibold text-white">Try again</Text>
                  </Touchable>
                </View>
              </View>
            ) : null}
          </View>
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListFooterComponent={
          items.length === 0 ? undefined : loadingMore ? (
            <View className="py-lg items-center">
              <ActivityIndicator size="small" color="#0061FF" />
            </View>
          ) : hasMore ? (
            // A visible button as well as onEndReached: the automatic trigger
            // is unreliable on web, and a list that just stops is the silent
            // truncation this replaced.
            <Touchable
              onPress={loadMore}
              accessibilityLabel="Load more items"
              style={{ minHeight: 48, marginTop: 16, marginBottom: 8 }}
              className="items-center justify-center rounded-full border border-line dark:border-line-dark"
            >
              <Text className="text-caption font-rubik-semibold text-primary-300">Load more</Text>
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
                <ItemCardSkeleton key={i} />
              ))}
            </View>
          ) : error ? undefined : narrowed ? (
            // Distinct from "nothing listed yet": this list is empty because of
            // a choice the user made, so it says which choice and undoes it.
            <View className="items-center px-lg py-2xl" accessibilityRole="summary">
              <View className="size-14 rounded-full items-center justify-center mb-md bg-primary-100">
                <Text className="text-h2 text-primary-300">·</Text>
              </View>
              <Text className="text-lead font-rubik-semibold text-black-300 dark:text-white text-center">
                No items match these filters
              </Text>
              <Text className="text-body font-rubik text-black-200 dark:text-white/60 text-center mt-2xs max-w-[420px]">
                {(() => {
                  const bits = [...summary];
                  if (filters.query) bits.unshift(`“${filters.query}”`);
                  return bits.length
                    ? `Nothing found for ${bits.join(" · ")}.`
                    : "Try widening your search.";
                })()}
              </Text>
              <View className="mt-md">
                <Touchable
                  onPress={clearEverything}
                  accessibilityLabel="Clear all filters"
                  style={{ minHeight: MIN_TAP }}
                  className="items-center justify-center rounded-full bg-primary-300 px-lg"
                >
                  <Text className="text-body font-rubik-semibold text-white">Clear filters</Text>
                </Touchable>
              </View>
            </View>
          ) : (
            <View>
              <EmptyState
                title="Nothing listed yet"
                body="No furniture has been approved for sale yet. Be the first to list something."
              />
              <View className="items-center">
                <Touchable
                  onPress={() => router.push("/marketplace/new")}
                  accessibilityLabel="Sell an item"
                  style={{ minHeight: MIN_TAP }}
                  className="items-center justify-center rounded-full bg-primary-300 px-lg"
                >
                  <Text className="text-body font-rubik-semibold text-white">Sell an item</Text>
                </Touchable>
              </View>
            </View>
          )
        }
        renderItem={({ item, index }) => <ItemCard item={item} index={index} />}
      />
    </SafeAreaView>
  );
}
