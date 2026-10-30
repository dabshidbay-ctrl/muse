/**
 * Pure date helpers for the availability calendar.
 *
 * Extracted from the component so they can be tested without React Native's
 * rendering pipeline. Dates are handled as integer day counts from the UTC
 * epoch rather than Date objects: comparison, "is this day inside a booking"
 * and "how many nights" all become integer arithmetic, with no local-timezone
 * drift turning 2026-09-01 into the 31st of August for anyone west of Greenwich.
 */

export const MS_DAY = 86_400_000;

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Sunday-first, matching the grid in the component. */
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The internal span type: a booking occupies [start, endExclusive) — half-open.
 * `check_out` is the morning the guest leaves, so that date is *not* occupied
 * and stays bookable as the next guest's check-in.
 */
export type Span = [start: number, endExclusive: number];

export type BookedRange = { check_in: string; check_out: string };

export function toDayNumber(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor(t / MS_DAY) : NaN;
}

export function fromDayNumber(day: number): string {
  return new Date(day * MS_DAY).toISOString().slice(0, 10);
}

/** Today in the *viewer's* calendar, expressed on the UTC day axis. */
export function todayDayNumber(): number {
  const now = new Date();
  return Math.floor(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / MS_DAY
  );
}

export function dayNumberOf(year: number, monthIndex: number, dayOfMonth: number): number {
  return Math.floor(Date.UTC(year, monthIndex, dayOfMonth) / MS_DAY);
}

export function mergeBooked(booked: BookedRange[]): Span[] {
  const spans: Span[] = [];
  for (const range of booked) {
    const start = toDayNumber(range.check_in);
    const end = toDayNumber(range.check_out);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    spans.push([start, end]);
  }
  spans.sort((a, b) => a[0] - b[0]);

  const merged: Span[] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}

/** Index of the first span that has not already ended before `day`. */
export function firstSpanEndingAfter(spans: Span[], day: number): number {
  let lo = 0;
  let hi = spans.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (spans[mid][1] <= day) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function isDayBooked(spans: Span[], day: number): boolean {
  const i = firstSpanEndingAfter(spans, day);
  return i < spans.length && spans[i][0] <= day;
}

/**
 * True when [start, endExclusive) touches any booking.
 */
export function spanOverlapsBooked(spans: Span[], start: number, endExclusive: number): boolean {
  if (endExclusive <= start) return false;
  const i = firstSpanEndingAfter(spans, start);
  return i < spans.length && spans[i][0] < endExclusive;
}

/**
 * Public guard for callers that submit a booking: re-checks a chosen range
 * against the same rules the grid enforces, so a stale calendar cannot slip an
 * overlapping request past the UI.
 */
export function isRangeAvailable(
  booked: BookedRange[],
  checkIn: string | null,
  checkOut: string | null
): boolean {
  if (!checkIn || !checkOut) return false;
  const start = toDayNumber(checkIn);
  const end = toDayNumber(checkOut);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
  return !spanOverlapsBooked(mergeBooked(booked), start, end);
}