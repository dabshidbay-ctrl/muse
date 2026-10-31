import React, { useCallback, useRef, useState } from "react";
import { Alert, FlatList, Image, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useSession } from "@/lib/useSession";
import { useSupabase } from "@/lib/useSupabase";
import { describeSupabaseError, supabase } from "@/lib/supabase";
import { getBookingRequests, getMyBookings, updateBookingStatus } from "@/lib/api";
import type { BookingStatus, BookingWithProperty } from "@/lib/types";
import { SPACE, useResponsive } from "@/lib/responsive";
import { BackButton, EmptyState, Skeleton, Touchable } from "@/components/ui";
import { captureError } from "@/lib/sentry";

const money = (n: number) =>
  `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const fmt = (d: string | null) => {
  // Dates come back as YYYY-MM-DD; anything else must not render "Invalid Date".
  const parsed = d ? new Date(`${d}T00:00:00`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US", { day: "numeric", month: "short" });
};

/** Status is conveyed by label text as well as colour. */
function StatusPill({ status }: { status: BookingStatus }) {
  const map: Record<BookingStatus, { bg: string; text: string }> = {
    pending: { bg: "bg-warning/15", text: "text-warning" },
    confirmed: { bg: "bg-success/15", text: "text-success" },
    declined: { bg: "bg-danger/15", text: "text-danger" },
    cancelled: { bg: "bg-black-100/15", text: "text-black-200" },
  };
  // A status the app does not know about (a value added in the DB ahead of the
  // client) must degrade to a neutral pill, not crash the whole list.
  const tone = map[status] ?? { bg: "bg-black-100/15", text: "text-black-200" };
  return (
    <View className={`rounded-full px-sm py-2xs ${tone.bg}`}>
      <Text className={`text-caption font-rubik-bold capitalize ${tone.text}`}>{status}</Text>
    </View>
  );
}

export default function Bookings() {
  const { user } = useSession();
  const { gutter, maxContentWidth } = useResponsive();
  const [tab, setTab] = useState<"mine" | "requests">("mine");
  const [busyId, setBusyId] = useState<string | null>(null);

  const mine = useSupabase({
    fn: getMyBookings,
    params: { userId: user?.id ?? "" },
    skip: !user?.id,
  });
  const requests = useSupabase({
    fn: getBookingRequests,
    params: { userId: user?.id ?? "" },
    skip: !user?.id,
  });

  const active = tab === "mine" ? mine : requests;
  const items = active.data ?? [];

  const respond = useCallback(
    async (booking: BookingWithProperty, status: BookingStatus) => {
      setBusyId(booking.id);
      try {
        await updateBookingStatus(supabase, booking.id, status);
        // The DB trigger writes the notification; just refresh both lists.
        await Promise.all([mine.refetch(), requests.refetch()]);
      } catch (err) {
        captureError(err, "booking-respond");
        Alert.alert("Could not update booking", describeSupabaseError(err));
      } finally {
        setBusyId(null);
      }
    },
    [mine, requests]
  );

  // A booking made on the property detail screen lands while this one is still
  // mounted in the stack, so refresh on every focus after the first (which
  // useSupabase already covered on mount).
  const mounted = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (!mounted.current) {
        mounted.current = true;
        return;
      }
      if (!user?.id) return;
      void mine.refetch();
      void requests.refetch();
      // Depend on the two `refetch` callbacks, which useSupabase memoises —
      // depending on the hook objects themselves would re-run this every render.
    }, [user?.id, mine.refetch, requests.refetch])
  );

  // Inline, not Alert.alert: react-native-web ships `static alert() {}`, so on
  // web the dialog never rendered and the callback inside it never ran —
  // cancelling a booking was impossible there.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

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
          Bookings
        </Text>
      </View>

      {/* Segmented control */}
      <View style={{ paddingHorizontal: gutter }} className="flex-row gap-xs pb-sm">
        {(
          [
            ["mine", "My bookings"],
            ["requests", "Requests"],
          ] as const
        ).map(([key, label]) => {
          const selected = tab === key;
          const count = key === "mine" ? (mine.data?.length ?? 0) : (requests.data?.length ?? 0);
          return (
            <Touchable
              key={key}
              onPress={() => setTab(key)}
              accessibilityLabel={`${label}, ${count} item${count === 1 ? "" : "s"}${
                selected ? ", selected" : ""
              }`}
              accessibilityState={{ selected }}
              style={{ flex: 1, minHeight: 44 }}
              className={`items-center justify-center rounded-full border ${
                selected
                  ? "bg-primary-300 border-primary-300"
                  : "bg-surface dark:bg-surface-dark-muted border-line dark:border-line-dark"
              }`}
            >
              <Text
                className={`text-caption ${
                  selected
                    ? "font-rubik-semibold text-white"
                    : "font-rubik-medium text-black-200 dark:text-white/70"
                }`}
              >
                {label} ({count})
              </Text>
            </Touchable>
          );
        })}
      </View>

      <FlatList
        data={active.initialLoading ? [] : items}
        keyExtractor={(b) => b.id}
        contentContainerStyle={{
          paddingHorizontal: gutter,
          paddingBottom: 48,
          width: "100%",
          maxWidth: maxContentWidth,
          alignSelf: "center",
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          active.initialLoading ? (
            <View className="gap-sm">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full" />
              ))}
            </View>
          ) : active.error ? (
            <EmptyState title="Couldn’t load bookings" body={active.error} tone="error" />
          ) : tab === "mine" ? (
            <EmptyState
              title="No bookings yet"
              body="When you request a stay it will appear here with its status."
            />
          ) : (
            <EmptyState
              title="No requests"
              body="Requests from guests on your listings will appear here."
            />
          )
        }
        renderItem={({ item }) => {
          const busy = busyId === item.id;
          // Bind the property once so the press handler cannot need a non-null
          // assertion that the ternary above has already stopped guaranteeing.
          const property = item.property;
          return (
            <View className="p-md rounded-lg bg-surface dark:bg-surface-dark-muted border border-line dark:border-line-dark mb-sm">
              <Touchable
                onPress={
                  property
                    ? () =>
                        router.push({
                          pathname: "/properties/[id]",
                          params: { id: property.id },
                        })
                    : undefined
                }
                accessibilityLabel={`${item.property?.name ?? "Property"}, ${fmt(
                  item.check_in
                )} to ${fmt(item.check_out)}, ${item.guests} guest${
                  item.guests === 1 ? "" : "s"
                }, ${item.status}`}
                className="flex-row items-center gap-md"
              >
                {item.property?.image ? (
                  <Image
                    source={{ uri: item.property.image }}
                    style={{ width: 64, height: 64 }}
                    className="rounded-md"
                    accessible={false}
                    alt=""
                  />
                ) : (
                  <View className="size-16 rounded-md bg-surface-sunken dark:bg-surface-dark-elevated" />
                )}
                <View className="flex-1">
                  <Text
                    numberOfLines={1}
                    className="text-body font-rubik-bold text-black-300 dark:text-white"
                  >
                    {item.property?.name ?? "Property"}
                  </Text>
                  <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
                    {item.is_tour
                      ? `Tour on ${fmt(item.check_in)}`
                      : `${fmt(item.check_in)} – ${fmt(item.check_out)} · ${item.guests} guest${item.guests === 1 ? "" : "s"}`}
                  </Text>
                  {item.is_tour ? (
                    <View className="rounded-full bg-primary-100 px-xs py-2xs mt-2xs self-start">
                      <Text className="text-caption font-rubik-bold text-primary-300">Tour</Text>
                    </View>
                  ) : null}
                  {item.message ? (
                    // The message is how a tour tenant leaves their WhatsApp
                    // number — the owner must actually see it here, not just
                    // in the database row.
                    <Text
                      numberOfLines={3}
                      className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs"
                    >
                      {item.message}
                    </Text>
                  ) : null}
                  <View className="flex-row items-center gap-xs mt-2xs">
                    <Text className="text-body font-rubik-extrabold text-primary-300">
                      {money(item.total_price)}
                    </Text>
                    {item.payment_status === "paid" ? (
                      <View className="rounded-full bg-success/15 px-xs py-2xs">
                        <Text className="text-caption font-rubik-bold text-success">
                          Paid {item.paid_amount ? money(item.paid_amount) : ""}
                          {item.payment_method ? ` · ${item.payment_method}` : ""}
                        </Text>
                      </View>
                    ) : item.payment_status === "pending" ? (
                      <View className="rounded-full bg-warning/15 px-xs py-2xs">
                        <Text className="text-caption font-rubik-bold text-warning">Paying</Text>
                      </View>
                    ) : item.payment_status === "failed" ? (
                      <View className="rounded-full bg-danger/15 px-xs py-2xs">
                        <Text className="text-caption font-rubik-bold text-danger">Failed</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                <StatusPill status={item.status} />
              </Touchable>

              {/* Guest: pay now button for unpaid bookings. Tours are payable
                  too: their $15 fee is held in escrow, it is not a rent payment. */}
              {tab === "mine" && item.payment_status === "unpaid" && item.status !== "cancelled" && item.status !== "declined" ? (
                <View className="mt-md">
                  <Touchable
                    onPress={() =>
                      router.push(`/checkout?bookingId=${item.id}&amount=${item.total_price}`)
                    }
                    accessibilityLabel="Pay now"
                    style={{ minHeight: 44 }}
                    className="items-center justify-center rounded-full bg-primary-300"
                  >
                    <Text className="text-caption font-rubik-bold text-white">Pay now</Text>
                  </Touchable>
                </View>
              ) : null}

              {/* Owner actions on a pending request */}
              {tab === "requests" && item.status === "pending" ? (
                <View className="flex-row gap-xs mt-md">
                  <Touchable
                    onPress={() => void respond(item, "confirmed")}
                    disabled={busy}
                    accessibilityLabel={`Confirm booking for ${item.property?.name ?? "property"}`}
                    accessibilityState={{ busy }}
                    style={{ flex: 1, minHeight: 44 }}
                    className="items-center justify-center rounded-full bg-primary-300"
                  >
                    <Text className="text-caption font-rubik-bold text-white">Confirm</Text>
                  </Touchable>
                  <Touchable
                    onPress={() => void respond(item, "declined")}
                    disabled={busy}
                    accessibilityLabel={`Decline booking for ${item.property?.name ?? "property"}`}
                    accessibilityState={{ busy }}
                    style={{ flex: 1, minHeight: 44 }}
                    className="items-center justify-center rounded-full border border-line dark:border-line-dark"
                  >
                    <Text className="text-caption font-rubik-bold text-danger">Decline</Text>
                  </Touchable>
                </View>
              ) : null}

              {/* Guest can withdraw a request that is still open */}
              {tab === "mine" && (item.status === "pending" || item.status === "confirmed") ? (
                confirmingId === item.id ? (
                  <View
                    accessibilityRole="alert"
                    style={{ marginTop: SPACE.md }}
                    className="pt-md border-t border-line dark:border-line-dark"
                  >
                    <Text className="text-caption font-rubik text-black-200 dark:text-white/60">
                      Cancel this booking? The owner will be notified and the dates are released.
                    </Text>
                    <View className="flex-row gap-xs mt-md">
                      <Touchable
                        onPress={() => setConfirmingId(null)}
                        disabled={busy}
                        accessibilityLabel="Keep this booking"
                        style={{ flex: 1, minHeight: 44 }}
                        className="items-center justify-center rounded-full border border-line dark:border-line-dark"
                      >
                        <Text className="text-caption font-rubik-bold text-black-300 dark:text-white">
                          Keep it
                        </Text>
                      </Touchable>
                      <Touchable
                        onPress={() => {
                          setConfirmingId(null);
                          void respond(item, "cancelled");
                        }}
                        disabled={busy}
                        accessibilityLabel={`Confirm cancel booking for ${item.property?.name ?? "property"}`}
                        accessibilityState={{ busy }}
                        style={{ flex: 1, minHeight: 44 }}
                        className="items-center justify-center rounded-full bg-danger"
                      >
                        <Text className="text-caption font-rubik-bold text-white">
                          Cancel booking
                        </Text>
                      </Touchable>
                    </View>
                  </View>
                ) : (
                  <Touchable
                    onPress={() => setConfirmingId(item.id)}
                    disabled={busy}
                    accessibilityLabel={`Cancel booking for ${item.property?.name ?? "property"}`}
                    accessibilityState={{ busy }}
                    style={{ minHeight: 44, marginTop: SPACE.md }}
                    className="items-center justify-center rounded-full border border-line dark:border-line-dark"
                  >
                    <Text className="text-caption font-rubik-bold text-danger">Cancel booking</Text>
                  </Touchable>
                )
              ) : null}
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
