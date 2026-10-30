import React, { useCallback, useEffect, useRef } from "react";
import { FlatList, Image, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useSession } from "@/lib/useSession";
import { useSupabase } from "@/lib/useSupabase";
import { supabase } from "@/lib/supabase";
import { getNotifications, markNotificationsRead } from "@/lib/api";
import type { AppNotification } from "@/lib/types";
import { SPACE, useResponsive } from "@/lib/responsive";
import { BackButton, EmptyState, Skeleton, Touchable } from "@/components/ui";
import icons from "@/constants/icons";
import { captureError } from "@/lib/sentry";

const TONE: Record<string, { bg: string; text: string }> = {
  booking_requested: { bg: "bg-primary-100", text: "text-primary-300" },
  booking_confirmed: { bg: "bg-success/10", text: "text-success" },
  booking_declined: { bg: "bg-danger/10", text: "text-danger" },
  booking_cancelled: { bg: "bg-warning/10", text: "text-warning" },
  marketplace_enquiry: { bg: "bg-success/10", text: "text-success" },
  general: { bg: "bg-primary-100", text: "text-primary-300" },
};

function timeAgo(iso: string | null) {
  const at = iso ? new Date(iso).getTime() : NaN;
  if (Number.isNaN(at)) return "";
  const mins = Math.floor((Date.now() - at) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function Notifications() {
  const { user } = useSession();
  const { gutter, maxContentWidth } = useResponsive();

  const { data, initialLoading, error, refetch } = useSupabase({
    fn: getNotifications,
    params: { userId: user?.id ?? "" },
    skip: !user?.id,
  });

  const items = data ?? [];
  const unread = items.filter((n) => !n.read_at).length;

  // Opening the screen is the read receipt. The ref makes this run at most once
  // per user per visit: without it, a write that races the refetch can leave
  // `unread` above zero and the effect re-fires in a loop.
  const receipted = useRef<string | null>(null);
  useEffect(() => {
    if (!user?.id || unread === 0 || receipted.current === user.id) return;
    receipted.current = user.id;
    markNotificationsRead(supabase, user.id)
      .then(() => refetch())
      .catch((err) => {
        // Failing to mark read is not worth an alert, but it must not be
        // remembered as done or the receipt would never be retried.
        receipted.current = null;
        captureError(err, "notifications-mark-read");
      });
  }, [user?.id, unread, refetch]);

  const open = useCallback((n: AppNotification) => {
    if (n.booking_id) router.push("/bookings");
    // An enquiry belongs to a seller, so it opens their own items rather than
    // the public listing — the buyer's number is on the item they own.
    else if (n.marketplace_item_id) router.push("/marketplace/mine");
    else if (n.property_id) router.push(`/properties/${n.property_id}`);
  }, []);

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
          Notifications
        </Text>
      </View>

      <FlatList
        data={initialLoading ? [] : items}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 48,
          width: "100%",
          maxWidth: maxContentWidth,
          alignSelf: "center",
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          initialLoading ? (
            <View className="gap-sm mt-sm">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </View>
          ) : error ? (
            <EmptyState title="Couldn’t load notifications" body={error} tone="error" />
          ) : (
            <EmptyState
              title="Nothing yet"
              body="Booking requests and updates will show up here."
            />
          )
        }
        renderItem={({ item }) => {
          const tone = TONE[item.type] ?? TONE.general;
          return (
            <Touchable
              onPress={
                item.booking_id || item.property_id || item.marketplace_item_id
                  ? () => open(item)
                  : undefined
              }
              accessibilityLabel={`${item.title}. ${item.body ?? ""} ${timeAgo(item.created_at)}${
                item.read_at ? "" : ". Unread"
              }`}
              style={{ marginBottom: SPACE.sm }}
              className={`flex-row items-start gap-md p-md rounded-lg border ${
                item.read_at
                  ? "bg-surface dark:bg-surface-dark-muted border-line dark:border-line-dark"
                  : "bg-primary-100 border-primary-200"
              }`}
            >
              <View className={`size-10 rounded-full items-center justify-center ${tone.bg}`}>
                <Image source={icons.bell} style={{ width: 20, height: 20 }} accessible={false} alt="" />
              </View>
              <View className="flex-1">
                <View className="flex-row items-center gap-xs">
                  <Text className="flex-1 text-body font-rubik-bold text-black-300 dark:text-white">
                    {item.title}
                  </Text>
                  {/* Unread is a dot AND the bold title, never colour alone. */}
                  {!item.read_at ? (
                    <View className="size-2 rounded-full bg-primary-300" />
                  ) : null}
                </View>
                {item.body ? (
                  <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
                    {item.body}
                  </Text>
                ) : null}
                <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
                  {timeAgo(item.created_at)}
                </Text>
              </View>
            </Touchable>
          );
        }}
      />
    </SafeAreaView>
  );
}
