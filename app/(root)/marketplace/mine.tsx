import React, { useCallback, useMemo, useRef, useState } from "react";
import { FlatList, Image, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useSession } from "@/lib/useSession";
import { useSupabase } from "@/lib/useSupabase";
import {
  deleteMarketplaceItem,
  getItemEnquiries,
  getMyMarketplaceItems,
} from "@/lib/marketplaceApi";
import { describeSupabaseError, supabase } from "@/lib/supabase";
import { useResponsive, shadow } from "@/lib/responsive";
import { BackButton, EmptyState, Skeleton, Touchable } from "@/components/ui";
import { districtLabel } from "@/components/Filters";
import { marketplaceCategories, marketplaceConditions } from "@/constants/data";
import type { MarketplaceEnquiry, MarketplaceItem, MarketplaceStatus } from "@/lib/types";
import { captureError } from "@/lib/sentry";

const money = (n: number) =>
  `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const labelOf = (list: readonly { value: string; label: string }[], value: string) =>
  list.find((x) => x.value === value)?.label ?? value;

const STATUS: Record<
  MarketplaceStatus,
  { label: string; skin: string; text: string; blurb: string }
> = {
  pending: {
    label: "Awaiting review",
    skin: "bg-warning/10 border-warning/40",
    text: "text-warning",
    blurb: "An administrator has not looked at this yet. It is not visible to buyers.",
  },
  approved: {
    label: "Live",
    skin: "bg-success/10 border-success/40",
    text: "text-success",
    blurb: "Approved and visible in the marketplace.",
  },
  rejected: {
    label: "Rejected",
    skin: "bg-danger/10 border-danger/40",
    text: "text-danger",
    // Only an admin may move `status`, and the queue lists pending items only,
    // so editing a rejected item does not re-queue it. Say so.
    blurb:
      "Not published. You can fix it below, but only an administrator can put it back into review — reposting it as a new item is the faster route.",
  },
};

function StatusPill({ status }: { status: MarketplaceStatus }) {
  const s = STATUS[status];
  return (
    <View className={`self-start rounded-full border px-sm py-2xs ${s.skin}`}>
      <Text className={`text-caption font-rubik-bold ${s.text}`}>{s.label}</Text>
    </View>
  );
}

/** Text button. Touchable paints its inner view from `className`, so all sizing * and spacing stays on `style` / a wrapper. */
function TextButton({
  label,
  onPress,
  disabled,
  tone = "neutral",
  hint,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "neutral" | "danger" | "primary";
  hint?: string;
}) {
  const skin =
    tone === "danger"
      ? "bg-danger/10 border-danger/40"
      : tone === "primary"
        ? "bg-primary-300 border-primary-300"
        : "bg-surface dark:bg-surface-dark-elevated border-line dark:border-line-dark";
  const text =
    tone === "danger"
      ? "text-danger"
      : tone === "primary"
        ? "text-white"
        : "text-black-300 dark:text-white";
  return (
    <Touchable
      onPress={onPress}
      disabled={disabled}
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      style={{ minHeight: 44 }}
      className={`items-center justify-center rounded-full border px-lg ${skin} ${
        disabled ? "opacity-50" : ""
      }`}
    >
      <Text className={`text-caption font-rubik-bold ${text}`}>{label}</Text>
    </Touchable>
  );
}

/**
 * The buyers who asked about one item, with the number each chose to share.
 *
 * This is the seller's half of the contact path. It is loaded on demand rather
 * than with the list: a phone number should be fetched because someone asked to
 * see it, not pulled down for every row on the off chance.
 */
function Enquiries({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<MarketplaceEnquiry[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      setRows(await getItemEnquiries(supabase, { itemId }));
    } catch (err) {
      captureError(err, "marketplace-enquiries-load");
      setError(describeSupabaseError(err));
    } finally {
      setBusy(false);
    }
  }, [itemId]);

  return (
    <View className="mt-sm rounded-md border border-line dark:border-line-dark bg-surface-muted dark:bg-surface-dark px-md py-sm">
      <Touchable
        onPress={() => {
          const next = !open;
          setOpen(next);
          if (next && rows === null) void load();
        }}
        accessibilityLabel={`${open ? "Hide" : "Show"} the people interested in this item`}
        accessibilityState={{ expanded: open }}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text className="text-caption font-rubik-bold text-primary-300">
          {open ? "Hide interested buyers" : "Interested buyers"}
        </Text>
      </Touchable>

      {open ? (
        busy ? (
          <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
            Loading…
          </Text>
        ) : error ? (
          <Text
            accessibilityRole="alert"
            className="text-caption font-rubik-medium text-danger mt-2xs"
          >
            {error}
          </Text>
        ) : (
          <View className="mt-xs gap-xs">
            {(rows ?? []).length === 0 ? (
              <Text className="text-caption font-rubik text-black-200 dark:text-white/60">
                No one has asked about this item yet. When someone does, their number appears
                here.
              </Text>
            ) : null}
            {(rows ?? []).map((e) => (
              <View
                key={e.id}
                className="rounded-md bg-surface dark:bg-surface-dark-muted px-md py-sm border border-line dark:border-line-dark"
              >
                <Text
                  // Selectable so the seller can copy the number out; there is
                  // no dialler on web and typing it back in invites mistakes.
                  selectable
                  className="text-body font-rubik-bold text-black-300 dark:text-white"
                >
                  {e.buyer_phone}
                </Text>
                {e.message ? (
                  <Text className="text-caption font-rubik text-black-200 dark:text-white/70 mt-2xs">
                    {e.message}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        )
      ) : null}
    </View>
  );
}

function ItemRow({
  item,
  confirming,
  deleting,
  onEdit,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  item: MarketplaceItem;
  confirming: boolean;
  deleting: boolean;
  onEdit: () => void;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const s = STATUS[item.status];
  const cover = item.images?.[0];
  const locked = item.status === "approved";
  const district = districtLabel(item.district);

  return (
    <View
      className="p-md rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark mb-sm"
      style={shadow({ opacity: 0.06 })}
    >
      <View className="flex-row items-start gap-md">
        {cover ? (
          // Inline size: a `size-*` class loses to react-native-web's runtime
          // stylesheet and the thumbnail renders full-bleed.
          <Image
            source={{ uri: cover }}
            style={{ width: 80, height: 80 }}
            className="rounded-md"
            resizeMode="cover"
            accessibilityLabel={`Photo of ${item.title}`}
            alt={`Photo of ${item.title}`}
          />
        ) : (
          <View
            style={{ width: 80, height: 80 }}
            className="rounded-md bg-surface-sunken dark:bg-surface-dark-elevated items-center justify-center"
          >
            <Text className="text-caption font-rubik text-black-100 dark:text-white/40">
              No photo
            </Text>
          </View>
        )}

        <View className="flex-1">
          <StatusPill status={item.status} />
          <Text
            numberOfLines={2}
            className="text-body font-rubik-bold text-black-300 dark:text-white mt-2xs"
          >
            {item.title}
          </Text>
          <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
            {labelOf(marketplaceCategories, item.category)} ·{" "}
            {labelOf(marketplaceConditions, item.condition)}
            {district ? ` · ${district}` : ""}
          </Text>
          <Text className="text-body font-rubik-extrabold text-primary-300 mt-2xs">
            {money(item.price)}
            {item.negotiable ? (
              <Text className="text-caption font-rubik text-black-200 dark:text-white/60">
                {"  negotiable"}
              </Text>
            ) : null}
          </Text>
        </View>
      </View>

      <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-xs">
        {s.blurb}
      </Text>

      {/* A rejection with no reason is indistinguishable from a bug, so the
          admin's note is rendered in full rather than summarised. */}
      {item.status === "rejected" ? (
        <View className="mt-xs rounded-md border border-danger/40 bg-danger/10 px-md py-sm">
          <Text className="text-caption font-rubik-bold text-danger">
            Why it was rejected
          </Text>
          <Text className="text-caption font-rubik text-black-300 dark:text-white/80 mt-2xs">
            {item.review_note?.trim() ||
              "The administrator did not leave a note. Edit the item and resubmit, or contact support if you are unsure what to change."}
          </Text>
        </View>
      ) : null}

      {/* Approved items are locked server-side, so no edit button is offered —
          a control that is guaranteed to fail is worse than none. */}
      {locked ? (
        <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-xs">
          Approved items cannot be edited — that stops an approved item being swapped for
          something else. Delete it and post a replacement if you need to change it.
        </Text>
      ) : null}

      {/* Only an approved item is visible to buyers, so only an approved item
          can have anyone interested in it. */}
      {item.status === "approved" ? <Enquiries itemId={item.id} /> : null}

      {confirming ? (
        // Alert.alert is a no-op on web, so the confirmation is in-app UI.
        <View
          accessibilityLiveRegion="polite"
          className="mt-sm rounded-md border border-danger/40 bg-danger/10 px-md py-sm"
        >
          <Text className="text-caption font-rubik-bold text-danger">
            Delete “{item.title}”?
          </Text>
          <Text className="text-caption font-rubik text-black-300 dark:text-white/80 mt-2xs">
            This cannot be undone, and its photos go with it.
          </Text>
          <View className="flex-row gap-xs mt-sm">
            <TextButton label="Cancel" onPress={onCancelDelete} disabled={deleting} />
            <TextButton
              label={deleting ? "Deleting…" : "Delete for good"}
              tone="danger"
              onPress={onConfirmDelete}
              disabled={deleting}
            />
          </View>
        </View>
      ) : (
        <View className="flex-row gap-xs mt-sm">
          {!locked ? (
            <TextButton
              label="Edit"
              onPress={onEdit}
              hint="Opens this item for editing"
            />
          ) : null}
          <TextButton label="Delete" tone="danger" onPress={onAskDelete} />
        </View>
      )}
    </View>
  );
}

export default function MyMarketplaceItems() {
  const { user } = useSession();
  const { gutter, maxContentWidth } = useResponsive();
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { data, initialLoading, error, refetch } = useSupabase({
    fn: (sb, params: { sellerId: string }) => getMyMarketplaceItems(sb, params),
    params: { sellerId: user?.id ?? "" },
    skip: !user?.id,
  });

  // Newest first. Sorted here as well as in the query so the order is right
  // even if the API's ordering ever changes underneath this screen.
  const items = useMemo(
    () =>
      [...(data ?? [])].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      ),
    [data]
  );

  // Edits happen on another screen, so this list is stale the moment we return
  // from it. Refetch on every focus but the first, which useSupabase covers.
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

  const doDelete = useCallback(
    async (item: MarketplaceItem) => {
      setDeletingId(item.id);
      setDeleteError(null);
      try {
        await deleteMarketplaceItem(supabase, { id: item.id });
        setConfirmId(null);
        await refetch();
      } catch (err) {
        captureError(err, "marketplace-item-delete");
        setDeleteError(describeSupabaseError(err));
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
      <BackButton fallback="/marketplace" />
      <Text
        accessibilityRole="header"
        className="flex-1 text-h2 font-rubik-extrabold text-black-300 dark:text-white"
      >
        My items
      </Text>
    </View>
  );

  if (!user?.id || initialLoading) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        {header}
        <View style={{ paddingHorizontal: gutter }} className="gap-sm">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </View>
      </SafeAreaView>
    );
  }

  if (error && items.length === 0) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        {header}
        <View className="flex-1 justify-center">
          <EmptyState title="Could not load your items" body={error} tone="error" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      {header}

      <FlatList
        data={items}
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
          <View>
            <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mb-sm">
              Items you have posted, newest first. A new or edited item is reviewed by an
              administrator before it appears publicly.
            </Text>
            {deleteError ? (
              <View
                accessibilityLiveRegion="polite"
                className="mb-sm rounded-md border border-danger/40 bg-danger/10 px-md py-sm"
              >
                <Text className="text-caption font-rubik-bold text-danger">
                  Could not delete that item
                </Text>
                <Text className="text-caption font-rubik text-black-300 dark:text-white/80 mt-2xs">
                  {deleteError}
                </Text>
              </View>
            ) : null}
            <View className="mb-sm">
              <TextButton
                label="Sell an item"
                tone="primary"
                onPress={() => router.push("/marketplace/new")}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View className="flex-1 justify-center">
            <EmptyState
              title="Nothing listed yet"
              body="Post furniture you no longer need. An administrator reviews each item before it goes public, and your phone number is never shown to buyers."
            />
          </View>
        }
        renderItem={({ item }) => (
          <ItemRow
            item={item}
            confirming={confirmId === item.id}
            deleting={deletingId === item.id}
            onEdit={() => router.push({ pathname: "/marketplace/new", params: { id: item.id } })}
            onAskDelete={() => {
              setDeleteError(null);
              setConfirmId(item.id);
            }}
            onCancelDelete={() => setConfirmId(null)}
            onConfirmDelete={() => void doDelete(item)}
          />
        )}
      />
    </SafeAreaView>
  );
}
