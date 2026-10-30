import React, { useMemo } from "react";
import { FlatList, Image, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useSession } from "@/lib/useSession";
import { useSupabase } from "@/lib/useSupabase";
import { getMyBookings } from "@/lib/api";
import type { BookingWithProperty, PaymentStatus } from "@/lib/types";
import { useResponsive } from "@/lib/responsive";
import { BackButton, EmptyState, Skeleton, Touchable } from "@/components/ui";

const money = (n: number) => `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

const fmt = (d: string | null) => {
  const parsed = d ? new Date(`${d}T00:00:00`) : null;
  if (!parsed || Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
};

const monthLabel = (d: string) =>
  new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" });

function Pill({ status }: { status: PaymentStatus }) {
  const map: Record<PaymentStatus, { bg: string; text: string }> = {
    unpaid: { bg: "bg-black-100/10", text: "text-black-200" },
    pending: { bg: "bg-warning/15", text: "text-warning" },
    paid: { bg: "bg-success/15", text: "text-success" },
    failed: { bg: "bg-danger/15", text: "text-danger" },
    refunded: { bg: "bg-primary-100", text: "text-primary-300" },
  };
  const t = map[status] ?? { bg: "bg-black-100/10", text: "text-black-200" };
  return (
    <View className={`rounded-full px-sm py-2xs ${t.bg}`}>
      <Text className={`text-caption font-rubik-bold capitalize ${t.text}`}>{status}</Text>
    </View>
  );
}

/** A single stat box. */
function Stat({ label, value, sub, accent }: { label: string; value: string; sub: string; accent: string }) {
  return (
    <View className="rounded-xl border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted p-md flex-1 min-w-[130px]">
      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">{label}</Text>
      <Text className={`mt-xs text-h3 font-rubik-extrabold ${accent}`}>{value}</Text>
      <Text className="mt-2xs text-caption font-rubik text-black-100 dark:text-white/50">{sub}</Text>
    </View>
  );
}

export default function PaymentsDashboard() {
  const { user } = useSession();
  const { gutter, maxContentWidth } = useResponsive();

  const bookings = useSupabase({
    fn: getMyBookings,
    params: { userId: user?.id ?? "" },
    skip: !user?.id,
  });

  const items = bookings.data ?? [];

  const summary = useMemo(() => {
    const paid = items.filter((b) => b.payment_status === "paid");
    const pending = items.filter((b) => b.payment_status === "pending" || b.payment_status === "unpaid");
    const failed = items.filter((b) => b.payment_status === "failed");

    const totalPaid = paid.reduce((s, b) => s + Number(b.paid_amount ?? b.total_price), 0);
    const totalPending = pending.reduce((s, b) => s + Number(b.total_price), 0);
    const totalFailed = failed.reduce((s, b) => s + Number(b.total_price), 0);

    // Group paid bookings by payment method
    const byMethod: Record<string, number> = {};
    paid.forEach((b) => {
      const m = b.payment_method || "unknown";
      byMethod[m] = (byMethod[m] ?? 0) + Number(b.paid_amount ?? b.total_price);
    });

    // 6-month trend
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const d = new Date();
      d.setMonth(d.getMonth() - (5 - i));
      d.setDate(1);
      const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const val = paid
        .filter((b) => {
          const c = new Date(`${b.created_at}Z`);
          return `${c.getFullYear()}-${String(c.getMonth() + 1).padStart(2, "0")}` === mk;
        })
        .reduce((s, b) => s + Number(b.paid_amount ?? b.total_price), 0);
      return { label: d.toLocaleDateString("en-US", { month: "short" }), value: val };
    });

    return { totalPaid, totalPending, totalFailed, byMethod, monthly, paidCount: paid.length, itemsCount: items.length };
  }, [items]);

  const sorted = [...items].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const maxMonthly = Math.max(...summary.monthly.map((m) => m.value), 1);

  useFocusEffect(() => {
    if (user?.id) void bookings.refetch();
  });

  return (
    <SafeAreaView className="flex-1 bg-surface-muted dark:bg-surface-dark" edges={["top"]}>
      <View style={{ paddingHorizontal: gutter }} className="flex-row items-center gap-sm pt-sm pb-xs">
        <BackButton fallback="/profile" />
        <Text accessibilityRole="header" className="flex-1 text-h2 font-rubik-extrabold text-black-300 dark:text-white">
          Payments
        </Text>
      </View>

      <FlatList
        data={sorted}
        keyExtractor={(b) => b.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          width: "100%",
          maxWidth: maxContentWidth,
          alignSelf: "center",
          paddingHorizontal: gutter,
          paddingBottom: 64,
        }}
        ListHeaderComponent={
          <View className="mb-md">
            {bookings.initialLoading ? (
              <View className="gap-sm">
                <Skeleton className="h-44 w-full rounded-xl" />
                <Skeleton className="h-32 w-full rounded-xl" />
              </View>
            ) : bookings.error ? (
              <EmptyState title="Couldn’t load payments" body={bookings.error} tone="error" />
            ) : (
              <>
                {/* Total cash flow hero */}
                <View className="rounded-xl border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted p-md mb-md">
                  <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">Total paid</Text>
                  <Text className="mt-xs text-h1 font-rubik-extrabold text-black-300 dark:text-white">{money(summary.totalPaid)}</Text>
                  <Text className="mt-2xs text-body font-rubik text-black-200 dark:text-white/60">
                    {summary.paidCount} paid booking{summary.paidCount === 1 ? "" : "s"} across {summary.itemsCount} stays
                  </Text>
                  {/* Payment method breakdown */}
                  {Object.keys(summary.byMethod).length > 0 && (
                    <View className="mt-sm flex-row flex-wrap gap-x-md gap-y-2xs">
                      {Object.entries(summary.byMethod).map(([method, amt]) => (
                        <View key={method} className="flex-row items-center gap-2xs">
                          <View className="size-2 rounded-full bg-primary-300" />
                          <Text className="text-caption font-rubik text-black-200 dark:text-white/60 capitalize">
                            {method.replace(/_/g, " ")}: {money(amt)}
                          </Text>
                        </View>
                      ))}
                    </View>
                  )}
                </View>

                {/* Stat cards row */}
                <View className="flex-row flex-wrap gap-sm mb-md">
                  <Stat label="Paid" value={money(summary.totalPaid)} sub={`${summary.paidCount} successful`} accent="text-success" />
                  <Stat label="Pending" value={money(summary.totalPending)} sub="Awaiting payment" accent="text-warning" />
                  <Stat label="Failed" value={money(summary.totalFailed)} sub="Action needed" accent="text-danger" />
                </View>

                {/* 6-month trend bar chart */}
                <View className="rounded-xl border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted p-md mb-md">
                  <Text className="text-body font-rubik-bold text-black-300 dark:text-white">Payment trend</Text>
                  <View className="mt-md flex-row items-end gap-xs h-28">
                    {summary.monthly.map((m) => {
                      const pct = Math.max((m.value / maxMonthly) * 100, m.value > 0 ? 14 : 6);
                      return (
                        <View key={m.label} className="flex-1 items-center gap-2xs">
                          <View className="w-full items-center justify-end flex-1">
                            <View className="w-full rounded-t-md bg-primary-200 dark:bg-primary-300/70" style={{ height: `${pct}%` }} />
                          </View>
                          <Text className="text-caption font-rubik text-black-200 dark:text-white/60">{m.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* Section heading */}
                <View className="mb-sm flex-row items-center justify-between">
                  <Text className="text-body font-rubik-bold text-black-300 dark:text-white">Booking & payment history</Text>
                  <Text className="text-caption font-rubik text-black-100 dark:text-white/50">{items.length} item{items.length === 1 ? "" : "s"}</Text>
                </View>
              </>
            )}
          </View>
        }
        ListEmptyComponent={
          bookings.initialLoading ? undefined : bookings.error ? undefined : (
            <EmptyState title="No payment history" body="Once you book and pay, everything shows up here." />
          )
        }
        renderItem={({ item }) => {
          const p = item.property;
          const paid = Number(item.paid_amount ?? 0);
          const total = Number(item.total_price);
          const outstanding = Math.max(total - paid, 0);
          const nights =
            item.check_in && item.check_out
              ? Math.round(
                  (new Date(`${item.check_out}T00:00:00`).getTime() -
                    new Date(`${item.check_in}T00:00:00`).getTime()) /
                    (1000 * 60 * 60 * 24)
                )
              : 0;

          return (
            <View className="mb-sm rounded-xl border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted overflow-hidden">
              {/* Top row — property info & status */}
              <Touchable
                onPress={p ? () => router.push({ pathname: "/properties/[id]", params: { id: p.id } }) : undefined}
                accessibilityLabel={`${p?.name ?? "Property"}, ${fmt(item.check_in)} to ${fmt(
                  item.check_out
                )}, ${nights} night${nights === 1 ? "" : "s"}`}
                className="flex-row items-center gap-md p-md"
              >
                {p?.image ? (
                  <Image source={{ uri: p.image }} style={{ width: 60, height: 60 }} className="rounded-lg" accessible={false} alt="" />
                ) : (
                  <View className="size-[60px] rounded-lg bg-primary-100" />
                )}

                <View className="flex-1">
                  <Text className="text-body font-rubik-bold text-black-300 dark:text-white" numberOfLines={1}>
                    {p?.name ?? "Property"}
                  </Text>
                  <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
                    {fmt(item.check_in)} → {fmt(item.check_out)} · {nights} night{nights === 1 ? "" : "s"} · {item.guests} guest{item.guests === 1 ? "" : "s"}
                  </Text>
                  {p?.address ? (
                    <Text className="text-caption font-rubik text-black-100 dark:text-white/50 mt-2xs" numberOfLines={1}>
                      {p.address}
                    </Text>
                  ) : null}
                </View>

                <Pill status={item.payment_status} />
              </Touchable>

              {/* Divider */}
              <View className="h-px bg-line dark:bg-line-dark mx-md" />

              {/* Payment detail row */}
              <View className="flex-row items-center justify-between px-md py-sm">
                <View className="gap-2xs">
                  <Text className="text-caption font-rubik text-black-200 dark:text-white/60">Booked {monthLabel(item.created_at)}</Text>
                  {item.payment_method ? (
                    <Text className="text-caption font-rubik text-black-200 dark:text-white/60 capitalize">
                      Via {item.payment_method.replace(/_/g, " ")}
                    </Text>
                  ) : null}
                  {item.sifalo_sid ? (
                    <Text className="text-caption font-rubik text-black-100 dark:text-white/40">Ref: {item.sifalo_sid.slice(0, 12)}…</Text>
                  ) : null}
                </View>

                <View className="items-end gap-2xs">
                  <View className="flex-row items-center gap-sm">
                    <Text className="text-caption font-rubik text-black-200 dark:text-white/60">Total</Text>
                    <Text className="text-body font-rubik-bold text-black-300 dark:text-white">{money(total)}</Text>
                  </View>
                  {paid > 0 && (
                    <View className="flex-row items-center gap-sm">
                      <Text className="text-caption font-rubik text-success">Paid</Text>
                      <Text className="text-body font-rubik-bold text-success">{money(paid)}</Text>
                    </View>
                  )}
                  {outstanding > 0 && item.payment_status !== "paid" && item.payment_status !== "refunded" && (
                    <View className="flex-row items-center gap-sm">
                      <Text className="text-caption font-rubik text-warning">Left</Text>
                      <Text className="text-body font-rubik-bold text-warning">{money(outstanding)}</Text>
                    </View>
                  )}
                </View>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}
