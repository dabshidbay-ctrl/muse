import React, { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { BookedRange } from "@/lib/types";
import { MIN_TAP } from "@/lib/responsive";
import { Touchable } from "@/components/ui";
import {
  mergeBooked,
  toDayNumber,
  fromDayNumber,
  todayDayNumber,
  dayNumberOf,
  spanOverlapsBooked,
  isDayBooked,
  isRangeAvailable,
  MONTHS,
  WEEKDAYS,
  MS_DAY,
  type Span,
} from "@/lib/availability";

export { isRangeAvailable };

/* ------------------------------------------------------------------- DayCell */

type DayCell =
  | { kind: "blank"; key: string }
  | {
      kind: "day";
      key: string;
      day: number;
      dayOfMonth: number;
      iso: string;
      booked: boolean;
      past: boolean;
      selected: boolean;
      inRange: boolean;
    };

export function AvailabilityCalendar({
  booked,
  checkIn,
  checkOut,
  onChange,
}: {
  booked: BookedRange[];
  checkIn: string | null;
  checkOut: string | null;
  onChange: (next: { checkIn: string | null; checkOut: string | null }) => void;
}) {
  const spans = useMemo(() => mergeBooked(booked), [booked]);
  const today = useMemo(todayDayNumber, []);

  const startDay = checkIn ? toDayNumber(checkIn) : NaN;
  const endDay = checkOut ? toDayNumber(checkOut) : NaN;

  // Open on the month of the existing check-in so an edit does not throw the
  // user back to today.
  const [cursor, setCursor] = useState(() => {
    const anchor = new Date((Number.isFinite(startDay) ? startDay : today) * MS_DAY);
    return { year: anchor.getUTCFullYear(), month: anchor.getUTCMonth() };
  });
  const [message, setMessage] = useState<string | null>(null);

  const firstOfMonth = dayNumberOf(cursor.year, cursor.month, 1);
  const monthLabel = `${MONTHS[cursor.month]} ${cursor.year}`;
  // Nothing before the current month can ever be booked, so hide the way back.
  const canGoBack = firstOfMonth > today;

  const cells = useMemo<DayCell[]>(() => {
    const leading = new Date(firstOfMonth * MS_DAY).getUTCDay();
    const daysInMonth = new Date(Date.UTC(cursor.year, cursor.month + 1, 0)).getUTCDate();
    const out: DayCell[] = [];
    for (let i = 0; i < leading; i++) out.push({ kind: "blank", key: `b${i}` });
    for (let d = 1; d <= daysInMonth; d++) {
      const day = firstOfMonth + (d - 1);
      out.push({
        kind: "day",
        key: `d${day}`,
        day,
        dayOfMonth: d,
        iso: fromDayNumber(day),
        booked: isDayBooked(spans, day),
        past: day < today,
        selected: day === startDay || day === endDay,
        // Only the nights actually slept are highlighted, so the check-out day
        // reads as the boundary it is rather than as an occupied night.
        inRange:
          Number.isFinite(startDay) && Number.isFinite(endDay) && day > startDay && day < endDay,
      });
    }
    return out;
  }, [firstOfMonth, cursor.year, cursor.month, spans, today, startDay, endDay]);

  const weeks = useMemo(() => {
    const rows: DayCell[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));
    const last = rows[rows.length - 1];
    if (last) while (last.length < 7) last.push({ kind: "blank", key: `t${last.length}` });
    return rows;
  }, [cells]);

  const selectDay = useCallback(
    (cell: Extract<DayCell, { kind: "day" }>) => {
      if (cell.booked || cell.past) return; // guarded again at the tap site

      // No check-in yet, or a complete range in hand: this tap starts over.
      const starting = !Number.isFinite(startDay) || Number.isFinite(endDay);
      if (starting || cell.day <= startDay) {
        setMessage(null);
        onChange({ checkIn: cell.iso, checkOut: null });
        return;
      }

      if (spanOverlapsBooked(spans, startDay, cell.day)) {
        // Blocking only the endpoints would let a stay be booked straight over
        // an existing reservation, since both ends of such a range are free.
        // The range is refused; the tap becomes a new check-in instead, or the
        // user is stranded with a check-in they can no longer move forward.
        setMessage("Those dates cross a booking, so the stay now starts on this day.");
        onChange({ checkIn: cell.iso, checkOut: null });
        return;
      }

      setMessage(null);
      onChange({ checkIn, checkOut: cell.iso });
    },
    [spans, startDay, endDay, checkIn, onChange]
  );

  const shiftMonth = useCallback((delta: number) => {
    setCursor((c) => {
      const next = new Date(Date.UTC(c.year, c.month + delta, 1));
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() };
    });
  }, []);

  return (
    <View accessibilityLabel="Availability calendar">
      <View className="flex-row items-center justify-between">
        <Touchable
          onPress={() => shiftMonth(-1)}
          disabled={!canGoBack}
          accessibilityLabel="Previous month"
          style={{ minWidth: MIN_TAP, minHeight: MIN_TAP }}
          className="items-center justify-center rounded-full bg-surface-muted dark:bg-surface-dark-elevated"
        >
          <Text className="text-body font-rubik-bold text-black-300 dark:text-white">‹</Text>
        </Touchable>
        <Text
          accessibilityRole="header"
          className="text-body font-rubik-bold text-black-300 dark:text-white"
        >
          {monthLabel}
        </Text>
        <Touchable
          onPress={() => shiftMonth(1)}
          accessibilityLabel="Next month"
          style={{ minWidth: MIN_TAP, minHeight: MIN_TAP }}
          className="items-center justify-center rounded-full bg-surface-muted dark:bg-surface-dark-elevated"
        >
          <Text className="text-body font-rubik-bold text-black-300 dark:text-white">›</Text>
        </Touchable>
      </View>

      <View className="flex-row mt-sm" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {WEEKDAYS.map((w) => (
          <View key={w} style={{ flex: 1 }} className="items-center">
            <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
              {w.slice(0, 1)}
            </Text>
          </View>
        ))}
      </View>

      {weeks.map((week, wi) => (
        <View key={`w${wi}`} className="flex-row mt-2xs">
          {week.map((cell) => {
            if (cell.kind === "blank") return <View key={cell.key} style={{ flex: 1 }} />;

            const disabled = cell.booked || cell.past;
            const label = `${cell.dayOfMonth} ${MONTHS[cursor.month]} ${cursor.year}, ${
              cell.booked ? "booked, not available" : cell.past ? "in the past, not available" : "available"
            }${cell.selected ? ", selected" : ""}`;

            return (
              <View key={cell.key} style={{ flex: 1, paddingHorizontal: 2 }}>
                <Touchable
                  onPress={() => selectDay(cell)}
                  // Deliberately NOT `disabled`: Touchable dims a disabled
                  // control to 0.5 opacity, which would wash the red out of
                  // exactly the days whose colour has to stay legible. The
                  // state is announced instead, and the handler refuses.
                  accessibilityLabel={label}
                  accessibilityState={{ disabled, selected: cell.selected }}
                  style={{ minHeight: MIN_TAP }}
                  className={`items-center justify-center rounded-md border ${
                    cell.selected
                      ? "bg-primary-300 border-primary-300"
                      : cell.past
                        ? "bg-surface-muted dark:bg-surface-dark-elevated border-line dark:border-line-dark"
                        : cell.booked
                          // Booked = red, vacant = green — stronger tints so
                          // the colours survive pale photos and light themes.
                          ? "bg-danger/30 border-danger"
                          : cell.inRange
                            ? "bg-primary-200 border-primary-300"
                            : "bg-success/30 border-success"
                  }`}
                >
                  <Text
                    // Strikethrough is the non-colour signal: a colour-blind or
                    // greyscale reader still sees which days are gone.
                    style={cell.booked ? { textDecorationLine: "line-through" } : undefined}
                    className={`text-caption ${
                      cell.selected
                        ? "font-rubik-bold text-white"
                        : cell.past
                          ? "font-rubik text-black-100"
                          : cell.booked
                            ? "font-rubik-bold text-danger"
                            : cell.inRange
                              ? "font-rubik-medium text-primary-300"
                              : "font-rubik-medium text-success"
                    }`}
                  >
                    {cell.dayOfMonth}
                  </Text>
                </Touchable>
              </View>
            );
          })}
        </View>
      ))}

      <View className="flex-row flex-wrap items-center gap-md mt-sm">
        <View className="flex-row items-center gap-2xs">
          <View className="size-3 rounded-xs bg-success/30 border border-success" />
          <Text className="text-caption font-rubik text-black-200 dark:text-white/60">Available</Text>
        </View>
        <View className="flex-row items-center gap-2xs">
          <View className="size-3 rounded-xs bg-danger/30 border border-danger" />
          <Text
            style={{ textDecorationLine: "line-through" }}
            className="text-caption font-rubik text-black-200 dark:text-white/60"
          >
            Booked
          </Text>
        </View>
        <Text className="text-caption font-rubik text-black-200 dark:text-white/60">
          Check-out day is free for the next guest.
        </Text>
      </View>

      {message ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-caption font-rubik-medium text-danger mt-xs"
        >
          {message}
        </Text>
      ) : null}
    </View>
  );
}
