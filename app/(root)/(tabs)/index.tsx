import { useMemo, useState } from "react";
import { FlatList, Image, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useSession } from "@/lib/useSession";
import { useSupabase } from "@/lib/useSupabase";
import { getLatestProperties, getProperties, getUnreadCount } from "@/lib/api";
import type { Property, PropertyFilters } from "@/lib/types";
import { SPACE, useResponsive } from "@/lib/responsive";
import { useProfile } from "@/lib/useProfile";
import { EmptyState, IconButton, SectionHeader, Touchable } from "@/components/ui";
import { Filters, NoFilterMatches, countActiveFilters } from "@/components/Filters";
import { PropertyCard, PropertyCardSkeleton, PropertyRow } from "@/components/PropertyCard";
import icons from "@/constants/icons";

function Greeting() {
  const { user } = useSession();
  const hour = new Date().getHours();
  const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Visitors are not "back" — they are shopping. A signed-in greeting for an
  // anonymous visitor reads as a broken login, so visitors get a Mogadishu
  // hero headline instead, and signed-in users keep the personal greeting.
  if (!user) {
    return (
      <View className="flex-1">
        <Text className="text-h1 font-rubik-extrabold text-black-300 dark:text-white">
          Find your home in Mogadishu
        </Text>
        <Text className="text-body font-rubik text-black-200 dark:text-white/60 mt-2xs">
          Houses, apartments and BnBs across all 20 districts — from Hodan to Abdiaziz.
        </Text>
      </View>
    );
  }

  return (
    <View className="flex-row items-center gap-sm flex-1">
      <Touchable
        onPress={() => router.push("/profile")}
        accessibilityLabel="Open your profile"
        className="rounded-full"
      >
        {user?.imageUrl ? (
          <Image
            source={{ uri: user.imageUrl }}
            style={{ width: 48, height: 48 }}
            className="rounded-full"
            accessible={false}
            alt=""
          />
        ) : (
          <View className="size-12 rounded-full bg-primary-200" />
        )}
      </Touchable>
      <View className="flex-1">
        <Text className="text-caption font-rubik text-black-100 dark:text-white/50">{part}</Text>
        <Text
          numberOfLines={1}
          className="text-body font-rubik-semibold text-black-300 dark:text-white"
        >
          {user?.fullName ?? "Welcome back"}
        </Text>
      </View>
    </View>
  );
}

export default function Index() {
  const { columns, gutter, maxContentWidth, device } = useResponsive();
  const { user } = useSession();
  const { isAgent } = useProfile();

  const { data: unread } = useSupabase({
    fn: getUnreadCount,
    params: { userId: user?.id ?? "" },
    skip: !user?.id,
  });

  const { data: featured, initialLoading: loadingFeatured } = useSupabase({
    fn: getLatestProperties,
    params: { limit: 6 },
  });
  // Home has no search box, so every filter here (type, district, price,
  // bedrooms) is a selection and can be applied immediately: `filters` is the
  // useSupabase param, so a district change refetches on the spot.
  const [filters, setFilters] = useState<PropertyFilters>({});
  const { data: all, initialLoading, error } = useSupabase({
    fn: getProperties,
    params: { filters, limit: 20 },
  });

  const showcase = (featured ?? []).slice(0, 5);
  const activeFilters = useMemo(() => countActiveFilters(filters), [filters]);

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      <FlatList
        key={`grid-${columns}`}
        data={initialLoading ? [] : (all ?? [])}
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
        ListHeaderComponent={
          <View>
            <View className="flex-row items-start gap-sm pt-sm">
              <Greeting />
              {user ? (
              <View>
                <IconButton
                  icon={icons.bell}
                  label={
                    unread
                      ? `Notifications, ${unread} unread`
                      : "Notifications"
                  }
                  onPress={() => router.push("/notifications")}
                />
                {unread ? (
                  <View
                    pointerEvents="none"
                    className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-2xs rounded-full bg-danger items-center justify-center"
                  >
                    <Text className="text-caption font-rubik-bold text-white">
                      {unread > 9 ? "9+" : unread}
                    </Text>
                  </View>
                ) : null}
              </View>
              ) : null}
            </View>

            <Touchable
              onPress={() => router.push("/explore")}
              accessibilityLabel="Search properties"
              accessibilityHint="Opens the explore tab"
              style={{ marginTop: SPACE.lg }}
              className="flex-row items-center gap-sm rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md py-sm"
            >
              <Image source={icons.search} style={{ width: 20, height: 20 }} accessible={false} alt="" />
              <Text className="text-body font-rubik text-black-100 dark:text-white/40">
                Search homes, cities, types…
              </Text>
            </Touchable>

            <SectionHeader
              title="Featured"
              actionLabel="See all"
              onAction={() => router.push("/explore")}
            />
            {loadingFeatured ? (
              <View className="flex-row gap-sm">
                <View className="w-64"><PropertyCardSkeleton /></View>
                <View className="w-64"><PropertyCardSkeleton /></View>
              </View>
            ) : showcase.length ? (
              <FlatList
                horizontal
                data={showcase}
                keyExtractor={(i) => `f-${i.id}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ gap: 12, paddingRight: gutter }}
                renderItem={({ item, index }) => (
                  <View style={{ width: device === "phone" ? 240 : 280 }}>
                    <PropertyCard item={item} index={index} />
                  </View>
                )}
              />
            ) : null}

            <SectionHeader
              title="Recommended"
              actionLabel={isAgent ? "Add listing" : undefined}
              onAction={isAgent ? () => router.push("/properties/new") : undefined}
            />
            <Filters value={filters} onChange={setFilters} gutter={gutter} />

            {error ? (
              <EmptyState title="Couldn’t load properties" body={error} tone="error" />
            ) : null}
          </View>
        }
        ListEmptyComponent={
          initialLoading ? (
            <View className="flex-row flex-wrap gap-sm">
              {Array.from({ length: columns * 2 }).map((_, i) => (
                <View key={i} style={{ flex: 1, minWidth: `${100 / columns - 4}%` }}>
                  <PropertyCardSkeleton />
                </View>
              ))}
            </View>
          ) : error ? undefined : activeFilters ? (
            <NoFilterMatches filters={filters} onClear={() => setFilters({})} />
          ) : (
            <EmptyState
              title="No properties yet"
              body="Listings will appear here as owners publish them. Check back soon, or browse all districts on Explore."
            />
          )
        }
        ListFooterComponent={
          <View className="items-center py-xl">
            <Text className="text-body font-rubik-bold text-black-300 dark:text-white">
              ReState
            </Text>
            <Text className="text-caption font-rubik text-black-200 dark:text-white/60 text-center mt-2xs">
              Homes across Mogadishu — sign in to book, or publish your own listing.
            </Text>
          </View>
        }
        renderItem={({ item, index }) =>
          columns === 1 ? (
            <PropertyRow item={item} index={index} />
          ) : (
            <PropertyCard item={item} index={index} />
          )
        }
      />
    </SafeAreaView>
  );
}
