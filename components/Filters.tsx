import { useMemo, useState } from "react";
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Chip, Touchable } from "@/components/ui";
import { MIN_TAP, SPACE, shadow } from "@/lib/responsive";
import icons from "@/constants/icons";
import type { PropertyFilters, PropertyType } from "@/lib/types";
import { categories, districts } from "@/constants/data";

/**
 * `constants/data.ts` is owned elsewhere and still types `category` as a bare
 * string; the contract fixes the values to `"all" | PropertyType`, so narrow
 * here rather than duplicating the list.
 */
type Category = { title: string; category: PropertyType | "all" };
const CATEGORIES = categories as readonly Category[];

/**
 * Derived from the data rather than imported as a named type: the contract
 * fixes the 20 values, and reading them off the array means this file cannot
 * drift from `constants/data.ts` — and does not care which module the
 * `District` type alias ends up living in.
 */
export type DistrictValue = (typeof districts)[number]["value"];

export function districtLabel(v: string | null | undefined): string | null {
  if (!v || v === "all") return null;
  return districts.find((d) => d.value === v)?.label ?? null;
}

export const EMPTY_FILTERS: PropertyFilters = {};

/**
 * District selector — a searchable sheet, not a chip rail.
 *
 * Banadir has 20 districts. A horizontal rail shows three or four at a time and
 * hides the rest behind a scroll gesture with no scent, so a user looking for
 * Yaqshid has to drag past sixteen chips to learn whether it exists. A sheet
 * shows the whole alphabetical list at once, vertically (the direction lists
 * are read in), and a search box turns "find my district" from a scan into two
 * keystrokes. The trigger doubles as the current-value display, so the choice
 * is legible without opening anything.
 */
export function DistrictSelect({
  value,
  onChange,
  /** Label for the "no district" row, and for the trigger when nothing is set. */
  anyLabel,
  /** Verb for the accessible name, e.g. "Filter by district". */
  purpose = "Filter by district",
  disabled,
}: {
  value: DistrictValue | null;
  onChange: (next: DistrictValue | null) => void;
  anyLabel: string;
  purpose?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selectedLabel = districtLabel(value);
  const needle = q.trim().toLowerCase();
  const matches = useMemo(
    () => (needle ? districts.filter((d) => d.label.toLowerCase().includes(needle)) : districts),
    [needle]
  );

  const close = () => {
    setOpen(false);
    // The next open starts from the full list; a stale query would look like
    // districts had gone missing.
    setQ("");
  };

  const pick = (next: DistrictValue | null) => {
    onChange(next);
    close();
  };

  // A modern list row, not a plain text line: a letter badge on the left
  // makes a 20-item alphabetical list scannable, a filled check badge on
  // the right makes the selection unmistakable, and the selected row gets
  // a brand border instead of only a pale fill (which vanished in dark
  // mode before the primary-100 theme variables landed).
  const row = (key: string, label: string, selected: boolean, onPress: () => void) => (
    <Touchable
      key={key}
      onPress={onPress}
      accessibilityLabel={`${label}${selected ? ", selected" : ""}`}
      accessibilityState={{ selected }}
      style={{ minHeight: 56 }}
      className={`hover-surface flex-row items-center gap-sm rounded-lg border px-sm py-2xs ${
        selected
          ? "border-primary-300 bg-primary-100"
          : "border-transparent bg-transparent"
      }`}
    >
      <View
        className={`size-8 items-center justify-center rounded-full ${
          selected ? "bg-primary-300" : "bg-surface-muted dark:bg-surface-dark-muted"
        }`}
      >
        <Text
          className={`text-caption font-rubik-bold ${
            selected ? "text-white" : "text-primary-300"
          }`}
        >
          {label.charAt(0)}
        </Text>
      </View>
      <Text
        className={`flex-1 text-body ${
          selected
            ? "font-rubik-semibold text-primary-300"
            : "font-rubik text-black-300 dark:text-white"
        }`}
      >
        {label}
      </Text>
      {selected ? (
        <View className="size-6 items-center justify-center rounded-full bg-primary-300">
          <Text className="text-caption font-rubik-bold text-white">✓</Text>
        </View>
      ) : null}
    </Touchable>
  );

  return (
    <View>
      <Touchable
        onPress={() => setOpen(true)}
        disabled={disabled}
        accessibilityLabel={`${purpose}: ${selectedLabel ?? anyLabel}`}
        accessibilityHint="Opens a searchable list of Mogadishu districts"
        // A proper form control, not a caption-sized chip: 52 tall, 16px
        // label, 20px icon, generous padding, so it reads as the primary
        // location control instead of a footnote.
        style={{ minHeight: 52 }}
        className={`flex-row items-center justify-between rounded-xl border px-lg ${
          selectedLabel
            ? "border-primary-300 bg-primary-100"
            : "border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted"
        }`}
      >
        <Image
          source={icons.location}
          style={{ width: 20, height: 20 }}
          tintColor={selectedLabel ? "#0061FF" : "#8C8E98"}
          accessible={false}
          alt=""
        />
        <Text
          numberOfLines={1}
          className={`ml-xs flex-1 text-body ${
            selectedLabel
              ? "font-rubik-semibold text-primary-300"
              : "font-rubik-medium text-black-300 dark:text-white"
          }`}
        >
          {selectedLabel ?? anyLabel}
        </Text>
        {/* U+25BE: a caret is the conventional "this opens a list" mark, and an
            image would need an asset that does not exist in constants/icons. */}
        <Text
          accessible={false}
          className={`text-body ml-xs ${
            selectedLabel ? "text-primary-300" : "text-black-100 dark:text-white/40"
          }`}
        >
          ▾
        </Text>
      </Touchable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        // Android back / web escape must close the sheet, not the screen.
        onRequestClose={close}
      >
        <View className="flex-1 bg-black/50 items-center justify-center px-lg">
          {/* Tapping the dimmed area is the expected way out of a sheet. Hidden
              from assistive tech: the ✕ below is the announced close, and a
              full-screen "button" behind the list would be noise. */}
          <Pressable
            onPress={close}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={StyleSheet.absoluteFill}
          />
          <View
            // 80% of the viewport rather than a fixed 520: on a tall phone that
            // is five more districts visible without scrolling, and on a short
            // one the sheet still fits.
            style={{
              width: "100%",
              maxWidth: 420,
              maxHeight: "80%",
              overflow: "hidden",
              ...shadow({ color: "#000000", opacity: 0.22, radius: 28, offsetY: 16, elevation: 8 }),
            }}
            className="rounded-xl border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-elevated p-md"
          >
            <View className="flex-row items-start justify-between gap-sm">
              <View className="flex-1">
                <Text
                  accessibilityRole="header"
                  className="text-h2 font-rubik-extrabold text-black-300 dark:text-white"
                >
                  Choose a district
                </Text>
                <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
                  Mogadishu · {districts.length} districts
                </Text>
              </View>
              <Touchable
                onPress={close}
                accessibilityLabel="Close district list"
                style={{ minWidth: MIN_TAP, minHeight: MIN_TAP }}
                className="items-center justify-center rounded-full bg-surface-muted dark:bg-surface-dark-muted"
              >
                <Text className="text-body font-rubik-bold text-black-200 dark:text-white/70">
                  ✕
                </Text>
              </Touchable>
            </View>

            <View className="mt-md flex-row items-center gap-xs rounded-full border border-line dark:border-line-dark bg-surface-muted dark:bg-surface-dark-muted px-md">
              <Image
                source={icons.search}
                style={{ width: 18, height: 18 }}
                tintColor="#8C8E98"
                accessible={false}
                alt=""
              />
              <TextInput
                value={q}
                onChangeText={setQ}
                placeholder="Search districts"
                placeholderTextColor="#8C8E98"
                accessibilityLabel="Search districts"
                autoCorrect={false}
                className="flex-1 py-sm text-body font-rubik text-black-300 dark:text-white"
              />
            </View>

            <ScrollView
              // React Native's flexShrink defaults to 0, so without this the
              // list overflows the sheet's maxHeight and is simply clipped —
              // the last districts become unreachable instead of scrollable.
              style={{ flexShrink: 1, marginTop: SPACE.sm }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              contentContainerStyle={{ paddingVertical: SPACE.xs, gap: 4 }}
            >
              {/* Always offered, and never filtered out by the search box: it is
                  the way back to an unfiltered list. */}
              {row("__any", anyLabel, value === null, () => pick(null))}
              {matches.map((d) => row(d.value, d.label, value === d.value, () => pick(d.value)))}
              {matches.length === 0 ? (
                <Text
                  accessibilityLiveRegion="polite"
                  className="text-caption font-rubik text-black-200 dark:text-white/60 px-md py-sm"
                >
                  No district matches “{q.trim()}”.
                </Text>
              ) : null}
            </ScrollView>
            <View className="border-t border-line dark:border-line-dark pt-xs mt-xs">
              <Text className="text-caption font-rubik text-black-200 dark:text-white/60">
                {needle
                  ? `${matches.length} district${matches.length === 1 ? "" : "s"} match “${q.trim()}”`
                  : `Tap a district to filter · ${districts.length} in Mogadishu`}
              </Text>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Price is expressed as bands rather than a text box or a slider. Rent has no
 * natural upper bound, and every alternative that covers "and up" needs typing
 * or a drag gesture: bands stay a one-tap selection control, which is the
 * product rule here, and they map straight onto min/maxPrice.
 */
const PRICE_BANDS: { label: string; short: string; min?: number; max?: number }[] = [
  { label: "Any price", short: "Any" },
  { label: "Under $500", short: "< $500", max: 500 },
  { label: "$500 – $1k", short: "$500–1k", min: 500, max: 1000 },
  { label: "$1k – $2k", short: "$1k–2k", min: 1000, max: 2000 },
  { label: "$2k – $5k", short: "$2k–5k", min: 2000, max: 5000 },
  { label: "$5k and up", short: "$5k+", min: 5000 },
];

const BEDROOMS: { label: string; short: string; min?: number }[] = [
  { label: "Any bedrooms", short: "Any" },
  { label: "1 or more bedrooms", short: "1+", min: 1 },
  { label: "2 or more bedrooms", short: "2+", min: 2 },
  { label: "3 or more bedrooms", short: "3+", min: 3 },
  { label: "4 or more bedrooms", short: "4+", min: 4 },
  { label: "5 or more bedrooms", short: "5+", min: 5 },
];

function bandIndex(f: PropertyFilters): number {
  const i = PRICE_BANDS.findIndex((b) => b.min === f.minPrice && b.max === f.maxPrice);
  return i === -1 ? 0 : i;
}

/** Number of filters the user has actually set — drives the badge and the clear affordance. */
export function countActiveFilters(f: PropertyFilters): number {
  let n = 0;
  if (f.type && f.type !== "all") n += 1;
  if (f.district && f.district !== "all") n += 1;
  if (f.minPrice !== undefined || f.maxPrice !== undefined) n += 1;
  if (f.minBedrooms) n += 1;
  return n;
}

/** Short human summary of the non-text filters, e.g. "Villa · $1k–2k · 2+ beds". */
export function describeFilters(f: PropertyFilters): string[] {
  const out: string[] = [];
  if (f.type && f.type !== "all") {
    out.push(CATEGORIES.find((c) => c.category === f.type)?.title ?? f.type);
  }
  const district = districtLabel(f.district);
  if (district) out.push(district);
  const band = bandIndex(f);
  if (band > 0) out.push(PRICE_BANDS[band].short);
  if (f.minBedrooms) out.push(`${f.minBedrooms}+ beds`);
  return out;
}

/** Drops every filter but keeps the text query, which is a separate control. */
export function clearFilters(f: PropertyFilters): PropertyFilters {
  return f.query ? { query: f.query } : {};
}

function Row({
  title,
  children,
  gutter,
}: {
  title: string;
  children: React.ReactNode;
  gutter: number;
}) {
  return (
    <View className="mt-sm">
      <Text
        accessibilityRole="header"
        className="text-[14px] leading-[20px] font-rubik-semibold text-black-300 dark:text-white mb-xs"
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

/**
 * Category / price / bedrooms filter panel. Every change is committed on tap —
 * there is no free text here, so there is nothing to debounce; the search box
 * that owns `filters.query` stays with the screen and debounces itself.
 */
export function Filters({
  value,
  onChange,
  gutter = 0,
  /** Start with price + bedrooms open (used where the screen has room). */
  defaultExpanded = false,
}: {
  value: PropertyFilters;
  onChange: (next: PropertyFilters) => void;
  gutter?: number;
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const active = countActiveFilters(value);
  const summary = useMemo(() => describeFilters(value), [value]);
  const band = bandIndex(value);

  const setBand = (i: number) => {
    const { min, max } = PRICE_BANDS[i];
    onChange({ ...value, minPrice: min, maxPrice: max });
  };

  return (
    <View>
      {/* Category is the most-used filter, so it stays visible at all times. */}
      <Row title="Category" gutter={gutter}>
        {CATEGORIES.map((c) => (
          <Chip
            key={c.category}
            label={c.title}
            selected={(value.type ?? "all") === c.category}
            onPress={() => onChange({ ...value, type: c.category })}
          />
        ))}
      </Row>

      {/* Location is the first thing a renter narrows by here, so the district
          trigger stays out of the collapsed "More filters" section. It is one
          full-width control rather than a row of 20 chips. */}
      <View className="mt-sm">
        <Text
          accessibilityRole="header"
          className="text-[14px] leading-[20px] font-rubik-semibold text-black-300 dark:text-white mb-xs"
        >
          District
        </Text>
        <DistrictSelect
          value={value.district && value.district !== "all" ? value.district : null}
          onChange={(d) => onChange({ ...value, district: d ?? undefined })}
          anyLabel="Any district"
        />
      </View>

      <View className="flex-row items-center gap-xs mt-sm">
        <Touchable
          onPress={() => setExpanded((e) => !e)}
          accessibilityLabel={
            active
              ? `${expanded ? "Hide" : "Show"} price and bedroom filters, ${active} active`
              : `${expanded ? "Hide" : "Show"} price and bedroom filters`
          }
          accessibilityState={{ selected: expanded }}
          style={{ minHeight: 52 }}
          className="flex-row items-center justify-center gap-2xs rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-lg"
        >
          <Text className="text-[14px] leading-[20px] font-rubik-semibold text-black-300 dark:text-white">
            {expanded ? "Fewer filters" : "More filters"}
          </Text>
          {active ? (
            <View className="min-w-[20px] h-[20px] px-2xs rounded-full bg-primary-300 items-center justify-center">
              <Text className="text-caption font-rubik-bold text-white">{active}</Text>
            </View>
          ) : null}
        </Touchable>

        {active ? (
          <Touchable
            onPress={() => onChange(clearFilters(value))}
            accessibilityLabel="Clear all filters"
            accessibilityHint="Removes the category, district, price and bedroom filters"
            style={{ minHeight: 52 }}
            className="items-center justify-center rounded-full border border-primary-300 bg-primary-100 px-lg"
          >
            <Text className="text-[14px] leading-[20px] font-rubik-semibold text-primary-300">Clear all</Text>
          </Touchable>
        ) : null}
      </View>

      {/* The active set is spelled out even while collapsed, so a filter can
          never silently shape the results the user is looking at. */}
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
          <Row title="Price per month" gutter={gutter}>
            {PRICE_BANDS.map((b, i) => (
              <Chip
                key={b.label}
                label={b.short}
                selected={band === i}
                purpose="Filter by price,"
                onPress={() => setBand(i)}
              />
            ))}
          </Row>

          <Row title="Bedrooms" gutter={gutter}>
            {BEDROOMS.map((b) => (
              <Chip
                key={b.label}
                label={b.short}
                selected={(value.minBedrooms ?? 0) === (b.min ?? 0)}
                purpose="Filter by bedrooms,"
                onPress={() => onChange({ ...value, minBedrooms: b.min })}
              />
            ))}
          </Row>
        </View>
      ) : null}
    </View>
  );
}

/**
 * The empty state for a filtered list. Kept next to the filter model so the
 * "nothing matched" copy and the escape hatch can never drift apart.
 */
export function NoFilterMatches({
  filters,
  onClear,
}: {
  filters: PropertyFilters;
  onClear: () => void;
}) {
  const bits = describeFilters(filters);
  if (filters.query) bits.unshift(`“${filters.query}”`);

  return (
    <View className="items-center px-lg py-2xl" accessibilityRole="summary">
      <View className="size-14 rounded-full items-center justify-center mb-md bg-primary-100">
        <Text className="text-h2 text-primary-300">·</Text>
      </View>
      <Text className="text-lead font-rubik-semibold text-black-300 dark:text-white text-center">
        No properties match these filters
      </Text>
      <Text className="text-body font-rubik text-black-200 dark:text-white/60 text-center mt-2xs max-w-[420px]">
        {bits.length ? `Nothing found for ${bits.join(" · ")}.` : "Try widening your search."}
      </Text>
      <View className="mt-md">
        <Touchable
          onPress={onClear}
          accessibilityLabel="Clear all filters"
          style={{ minHeight: MIN_TAP }}
          className="items-center justify-center rounded-full bg-primary-300 px-lg"
        >
          <Text className="text-body font-rubik-semibold text-white">Clear filters</Text>
        </Touchable>
      </View>
    </View>
  );
}
