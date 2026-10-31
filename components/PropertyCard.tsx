import { Image, Text, View } from "react-native";
import { router } from "expo-router";
import type { Property } from "@/lib/types";
import icons from "@/constants/icons";
import { SPACE, shadow } from "@/lib/responsive";
import { FadeInUp, IconButton, Skeleton, Touchable } from "./ui";

const money = (n: number) =>
  `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/**
 * The billing period, spelled out on the card.
 *
 * A bare "$1,600" is ambiguous on a platform that rents both monthly and by the
 * night — the same number can mean a month or a week. The suffix is what makes
 * the two comparable at a glance, so it is part of the price, not a caption.
 */
const priceSuffix = (p: Property) => (p.rental_mode === "short_term" ? "/day" : "/mo");

/** Shared label so grid and list variants announce identically. */
const a11yLabel = (p: Property) =>
  `${p.name}, ${p.type}, ${money(p.price)} ${
    p.rental_mode === "short_term" ? "per day" : "per month"
  }, rated ${p.rating} out of 5${p.address ? `, ${p.address}` : ""}`;

function Rating({ value }: { value: number }) {
  return (
    <View className="flex-row items-center gap-2xs rounded-full bg-white/90 dark:bg-black/60 px-xs py-2xs">
      <Image source={icons.star} style={{ width: 14, height: 14 }} accessible={false} alt="" />
      {/* Number is also text, so rating never depends on colour alone. */}
      <Text className="text-caption font-rubik-bold text-black-300 dark:text-white">{value}</Text>
    </View>
  );
}

/**
 * Small heart button overlaying the top-right corner of the card image.
 *
 * Three states, each visually distinct without relying on colour alone:
 *   unsaved  – white glyph on a dark scrim
 *   hovered  – red glyph, so the affordance is discoverable before the click
 *   saved    – red glyph on a red-tinted disc, which is the "after clicked" state
 */
function HeartButton({
  isFavorite,
  onToggle,
}: {
  isFavorite: boolean;
  onToggle: () => void;
}) {
  return (
    <IconButton
      icon={icons.heart}
      label={isFavorite ? "Remove from saved" : "Save property"}
      // The heart asset is a filled heart, so the tint is the whole state.
      tintColor={isFavorite ? "#F75555" : "#FFFFFFCC"}
      onPress={onToggle}
      // `hover-heart` turns the disc red under the pointer (app/global.css);
      // the saved state keeps it red permanently.
      className={`rounded-full hover-heart ${isFavorite ? "bg-danger/20" : "bg-black/30"}`}
    />
  );
}

/* --------------------------------------------------------------- Grid card */
export function PropertyCard({
  item,
  index = 0,
  isFavorite,
  onToggleFavorite,
}: {
  item: Property;
  index?: number;
  /** Whether the signed-in user has saved this property. */
  isFavorite?: boolean;
  /** Called when the user taps the heart. If omitted the heart is hidden. */
  onToggleFavorite?: () => void;
}) {
  return (
    <FadeInUp index={index} className="flex-1">
      <View
        style={{ flex: 1, ...shadow({ opacity: 0.08, radius: 12, offsetY: 6, elevation: 3 }) }}
        className="relative rounded-xl overflow-hidden bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark"
      >
        <Touchable
          onPress={() => router.push(`/properties/${item.id}`)}
          accessibilityLabel={a11yLabel(item)}
          accessibilityHint="Opens the property details"
          style={{ flex: 1 }}
        >
          <View className="relative">
            {item.image ? (
              <Image
                source={{ uri: item.image }}
                style={{ width: "100%", height: 180 }}
                resizeMode="cover"
                accessible={false}
                alt=""
              />
            ) : (
              <View className="w-full bg-surface-sunken dark:bg-surface-dark-elevated" style={{ height: 180 }} />
            )}
            <View className="absolute top-xs right-xs">
              <Rating value={item.rating} />
            </View>
            <View className="absolute bottom-xs left-xs rounded-full bg-primary-300/90 px-xs py-2xs">
              <Text className="text-caption font-rubik-semibold text-white">{item.type}</Text>
            </View>
          </View>
          <View className="p-sm">
            <Text
              numberOfLines={1}
              className="text-body font-rubik-bold text-black-300 dark:text-white"
            >
              {item.name}
            </Text>
            <Text
              numberOfLines={1}
              className="text-caption font-rubik text-black-100 dark:text-white/50 mt-2xs"
            >
              {item.address}
            </Text>
            {/* Beds/baths at a glance, like a modern listing card — previously
                the grid card showed price only, so renters had to open every
                card to learn the room counts. */}
            <View className="flex-row items-center gap-md mt-xs">
              <View className="flex-row items-center gap-2xs">
                <Image source={icons.bed} style={{ width: 16, height: 16 }} accessible={false} alt="" />
                <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
                  {item.bedrooms} bed{item.bedrooms === 1 ? "" : "s"}
                </Text>
              </View>
              <View className="flex-row items-center gap-2xs">
                <Image source={icons.bath} style={{ width: 16, height: 16 }} accessible={false} alt="" />
                <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
                  {item.bathrooms} bath{item.bathrooms === 1 ? "" : "s"}
                </Text>
              </View>
            </View>
            <View className="flex-row items-baseline gap-2xs mt-xs">
              <Text className="text-body font-rubik-extrabold text-primary-300">
                {money(item.price)}
              </Text>
              <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
                {priceSuffix(item)}
              </Text>
            </View>
          </View>
        </Touchable>
        {onToggleFavorite && isFavorite !== undefined ? (
          <View className="absolute top-xs right-xs">
            <HeartButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
          </View>
        ) : null}
      </View>
    </FadeInUp>
  );
}

/* --------------------------------------------------------------- List card */
export function PropertyRow({
  item,
  index = 0,
  isFavorite,
  onToggleFavorite,
}: {
  item: Property;
  index?: number;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}) {
  return (
    <FadeInUp index={index}>
      <View
        style={{ marginBottom: SPACE.sm }}
        className="relative flex-row items-center gap-md p-sm rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark"
      >
        <Touchable
          onPress={() => router.push(`/properties/${item.id}`)}
          accessibilityLabel={a11yLabel(item)}
          accessibilityHint="Opens the property details"
          style={{ flex: 1 }}
          className="flex-row items-center gap-md"
        >
          <View>
            {item.image ? (
              <Image
                source={{ uri: item.image }}
                style={{ width: 96, height: 96 }}
                className="rounded-md"
                resizeMode="cover"
                accessible={false}
                alt=""
              />
            ) : (
              <View className="size-24 rounded-md bg-surface-sunken dark:bg-surface-dark-elevated" />
            )}
          </View>
          <View className="flex-1">
            <View className="flex-row items-center justify-between gap-xs">
              <Text
                numberOfLines={1}
                className="flex-1 text-body font-rubik-bold text-black-300 dark:text-white"
              >
                {item.name}
              </Text>
              <Rating value={item.rating} />
            </View>
            <Text
              numberOfLines={1}
              className="text-caption font-rubik text-black-100 dark:text-white/50 mt-2xs"
            >
              {item.address}
            </Text>
            <View className="flex-row items-center justify-between mt-xs">
              <View className="flex-row items-baseline gap-2xs">
                <Text className="text-body font-rubik-extrabold text-primary-300">
                  {money(item.price)}
                </Text>
                <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
                  {priceSuffix(item)}
                </Text>
              </View>
              <Text className="text-caption font-rubik text-black-200 dark:text-white/60">
                {item.bedrooms} bd · {item.bathrooms} ba
              </Text>
            </View>
          </View>
        </Touchable>
        {onToggleFavorite && isFavorite !== undefined ? (
          <View
            style={{ position: "absolute", left: SPACE.sm + 96 - 48, top: SPACE.sm }}
          >
            <HeartButton isFavorite={isFavorite} onToggle={onToggleFavorite} />
          </View>
        ) : null}
      </View>
    </FadeInUp>
  );
}

/** Matches PropertyCard's box so the grid doesn't reflow when data arrives. */
export function PropertyCardSkeleton() {
  return (
    <View className="flex-1 rounded-lg overflow-hidden bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark">
      <Skeleton className="w-full h-40 rounded-none" />
      <View className="p-sm gap-xs">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </View>
    </View>
  );
}
