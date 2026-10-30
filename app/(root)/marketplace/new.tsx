import React, { useEffect, useState } from "react";
import { Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams } from "expo-router";
import { useSession } from "@/lib/useSession";
import { supabase } from "@/lib/supabase";
import { getMarketplaceContact, getMarketplaceItem } from "@/lib/marketplaceApi";
import { useResponsive } from "@/lib/responsive";
import { BackButton, EmptyState, Skeleton } from "@/components/ui";
import MarketplaceForm from "@/components/MarketplaceForm";
import type { MarketplaceItem } from "@/lib/types";
import { captureError } from "@/lib/sentry";

/**
 * Create — and, with `?id=`, edit — a marketplace item.
 *
 * Deliberately NOT role-gated. Property listings need a publisher account, but
 * anyone signed in may sell their own furniture, tenants included; that is the
 * whole point of the marketplace.
 */
export default function NewMarketplaceItem() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { user } = useSession();
  const { gutter } = useResponsive();

  const editing = typeof id === "string" && id.length > 0;
  const [item, setItem] = useState<MarketplaceItem | null>(null);
  const [phone, setPhone] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) return;
    let alive = true;
    setLoading(true);
    getMarketplaceItem(supabase, { id: id as string })
      .then((found) => {
        if (!alive) return;
        if (!found) {
          setLoadError("That item no longer exists. It may have been deleted.");
          return;
        }
        setItem(found);
      })
      .catch((e) => {
        captureError(e, "marketplace-item-load");
        if (alive) setLoadError("Could not load that item. Check your connection and try again.");
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    // The seller's own number lives in marketplace_contacts, which only they
    // and an admin may read. If the read fails the form simply starts empty and
    // asks for the number again — better than saving a blank contact row.
    getMarketplaceContact(supabase, { itemId: id as string })
      .then((c) => {
        if (alive && c?.phone) setPhone(c.phone);
      })
      .catch((e) => captureError(e, "marketplace-contact-load"));

    return () => {
      alive = false;
    };
  }, [editing, id]);

  const heading = editing ? "Edit item" : "Sell an item";

  const header = (
    <View
      style={{ paddingHorizontal: gutter }}
      className="flex-row items-center gap-sm pt-sm pb-xs"
    >
      <BackButton fallback="/marketplace/mine" />
      <Text
        accessibilityRole="header"
        className="flex-1 text-h2 font-rubik-extrabold text-black-300 dark:text-white"
      >
        {heading}
      </Text>
    </View>
  );

  if (!user?.id) {
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

  if (editing && loading) {
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

  if (editing && loadError) {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        {header}
        <View className="flex-1 justify-center">
          <EmptyState title="Could not open that item" body={loadError} tone="error" />
        </View>
      </SafeAreaView>
    );
  }

  // The server refuses an update once an item is approved, so offering the form
  // would only produce a rejected save. Say why instead.
  if (editing && item && item.status === "approved") {
    return (
      <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
        {header}
        <View className="flex-1 justify-center">
          <EmptyState
            title="Approved items cannot be edited"
            body="An administrator has already approved this item, so its content is locked — otherwise an approved item could be swapped for something else. Delete it from My items and post the replacement, which will be reviewed again."
          />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      {header}
      <MarketplaceForm initial={editing ? item : null} initialPhone={phone} />
    </SafeAreaView>
  );
}
