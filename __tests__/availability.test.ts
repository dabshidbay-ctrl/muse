/**
 * Tests for the availability calendar logic.
 *
 * The pure date functions in lib/availability.ts power the calendar and the
 * booking submit guard. `isRangeAvailable` is the contract these tests assert
 * against; the internal functions are covered indirectly through it.
 */
import { isRangeAvailable } from "@/lib/availability";

type BookedRange = { check_in: string; check_out: string };

/* ---------------------------------------------------------------- helpers */

/**
 * Build an array of BookedRange from a list of [checkIn, checkOut] pairs.
 * Both values are ISO yyyy-mm-dd.
 */
const booked = (...ranges: [string, string][]): BookedRange[] =>
  ranges.map(([check_in, check_out]) => ({ check_in, check_out }));

/* ------------------------------------------------------------- is available */

describe("isRangeAvailable", () => {
  // ------------------------------------------------------------------ basics
  it("returns true when there are no bookings at all", () => {
    expect(isRangeAvailable([], "2026-09-10", "2026-09-14")).toBe(true);
  });

  it("returns false when checkIn or checkOut is null", () => {
    expect(isRangeAvailable([], null, "2026-09-14")).toBe(false);
    expect(isRangeAvailable([], "2026-09-10", null)).toBe(false);
    expect(isRangeAvailable([], null, null)).toBe(false);
  });

  it("returns false when checkIn == checkOut (zero nights)", () => {
    expect(isRangeAvailable([], "2026-09-10", "2026-09-10")).toBe(false);
  });

  it("returns false when checkIn > checkOut (negative nights)", () => {
    expect(isRangeAvailable([], "2026-09-14", "2026-09-10")).toBe(false);
  });

  // --------------------------------------------------------- half-open range
  it("allows a stay ending on the day an existing booking starts", () => {
    const r = booked(["2026-09-15", "2026-09-18"]);
    // Guest checks out on the 15th; the booking starts on the 15th.
    // The 15th is the morning the guest leaves, so it is free.
    expect(isRangeAvailable(r, "2026-09-10", "2026-09-15")).toBe(true);
  });

  it("allows a stay starting on the day an existing booking ends", () => {
    const r = booked(["2026-09-10", "2026-09-15"]);
    // Existing booking ends on the 15th (morning); new stay starts on the 15th.
    expect(isRangeAvailable(r, "2026-09-15", "2026-09-20")).toBe(true);
  });

  // ---------------------------------------------------------- full overlap
  it("blocks a stay that starts inside an existing booking", () => {
    const r = booked(["2026-09-10", "2026-09-20"]);
    expect(isRangeAvailable(r, "2026-09-10", "2026-09-15")).toBe(false);
  });

  it("blocks a stay that ends inside an existing booking", () => {
    const r = booked(["2026-09-10", "2026-09-20"]);
    expect(isRangeAvailable(r, "2026-09-05", "2026-09-15")).toBe(false);
  });

  it("blocks a stay that completely contains an existing booking", () => {
    const r = booked(["2026-09-12", "2026-09-15"]);
    expect(isRangeAvailable(r, "2026-09-10", "2026-09-20")).toBe(false);
  });

  // -------------------------------------------------------- multiple bookings
  it("works with multiple non-overlapping bookings", () => {
    const r = booked(["2026-09-05", "2026-09-08"], ["2026-09-15", "2026-09-18"]);
    // Gap between the two — should be available.
    expect(isRangeAvailable(r, "2026-09-10", "2026-09-14")).toBe(true);
    // Overlaps the first booking.
    expect(isRangeAvailable(r, "2026-09-06", "2026-09-10")).toBe(false);
    // Overlaps the second booking.
    expect(isRangeAvailable(r, "2026-09-14", "2026-09-17")).toBe(false);
  });

  it("merges back-to-back bookings so the gap is not bookable", () => {
    // Two bookings end on the day the next starts — they merge into one block
    // [10, 20), so there is no bookable gap between them.
    const r = booked(
      ["2026-09-10", "2026-09-15"],
      ["2026-09-15", "2026-09-20"]
    );
    // The 15th is a free day (half-open), so 10–15 touches the second booking
    // and is NOT available — the merged block covers it.
    expect(isRangeAvailable(r, "2026-09-10", "2026-09-15")).toBe(false);
    // 10–16 crosses the boundary: also blocked by the merged block.
    expect(isRangeAvailable(r, "2026-09-10", "2026-09-16")).toBe(false);
    // A stay starting exactly on the 20th (the morning the block ends) is free.
    expect(isRangeAvailable(r, "2026-09-20", "2026-09-22")).toBe(true);
  });

  // -------------------------------------------------------- edge cases
  it("handles single-day bookings (check_out = check_in + 1)", () => {
    const r = booked(["2026-09-15", "2026-09-16"]);
    // This single night is taken.
    expect(isRangeAvailable(r, "2026-09-15", "2026-09-16")).toBe(false);
    // The day after is free.
    expect(isRangeAvailable(r, "2026-09-16", "2026-09-17")).toBe(true);
  });

  it("handles malformed booked ranges (equal dates) gracefully", () => {
    // A zero-night booking occupies nothing, so it must not block anything.
    const r = booked(["2026-09-10", "2026-09-10"]);
    expect(isRangeAvailable(r, "2026-09-10", "2026-09-15")).toBe(true);
  });

  it("crosses month boundaries", () => {
    const r = booked(["2026-09-28", "2026-10-02"]);
    expect(isRangeAvailable(r, "2026-09-25", "2026-09-28")).toBe(true);
    expect(isRangeAvailable(r, "2026-09-25", "2026-09-30")).toBe(false);
    expect(isRangeAvailable(r, "2026-10-02", "2026-10-05")).toBe(true);
  });

  it("crosses year boundaries", () => {
    const r = booked(["2026-12-30", "2027-01-03"]);
    expect(isRangeAvailable(r, "2026-12-28", "2026-12-30")).toBe(true);
    expect(isRangeAvailable(r, "2026-12-28", "2027-01-01")).toBe(false);
    expect(isRangeAvailable(r, "2027-01-03", "2027-01-06")).toBe(true);
  });

  it("rejects invalid date strings without crashing", () => {
    const r = booked(["not-a-date", "still-not"]);
    // The malformed range is dropped, so the check should succeed.
    expect(isRangeAvailable(r, "2026-09-10", "2026-09-15")).toBe(true);
  });
});