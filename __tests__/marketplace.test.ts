/**
 * Tests for the marketplace phone-number normalisation.
 *
 * Somali phone numbers arrive in many formats: "0615551234", "+252 61 555 1234",
 * "252-61-555-1234", "61 555 1234", and everything in between. The normaliser
 * must accept all of them and produce the canonical +252 format.
 */
import { normalizePhone } from "@/lib/phone";

describe("normalizePhone", () => {
  // --------------------------------------------------------- standard formats
  it("normalises a local number with leading 0", () => {
    expect(normalizePhone("0615551234")).toBe("+252615551234");
  });

  it("normalises a local number without leading 0", () => {
    expect(normalizePhone("615551234")).toBe("+252615551234");
  });

  it("normalises an international +252 number", () => {
    expect(normalizePhone("+252615551234")).toBe("+252615551234");
  });

  it("normalises an international 252 number without +", () => {
    expect(normalizePhone("252615551234")).toBe("+252615551234");
  });

  it("normalises a number with spaces and dashes", () => {
    expect(normalizePhone("+252 61 555 1234")).toBe("+252615551234");
    expect(normalizePhone("252-61-555-1234")).toBe("+252615551234");
  });

  it("normalises a number with country code 00252", () => {
    expect(normalizePhone("00252615551234")).toBe("+252615551234");
  });

  it("normalises a Mogadishu landline (shorter 7-digit national)", () => {
    // 1xxxxxx format — landlines start with 1.
    expect(normalizePhone("01234567")).toBe("+2521234567");
  });

  it("normalises a landline without leading 0", () => {
    expect(normalizePhone("1234567")).toBe("+2521234567");
  });

  // --------------------------------------------------------- edge cases
  it("rejects an empty string", () => {
    expect(normalizePhone("")).toBeNull();
  });

  it("rejects a number that is too short", () => {
    expect(normalizePhone("123")).toBeNull();
  });

  it("rejects a number that is too long", () => {
    expect(normalizePhone("0615551234567890")).toBeNull();
  });

  it("rejects a number starting with 0 after stripping (only zeros)", () => {
    expect(normalizePhone("000000000")).toBeNull();
  });

  it("strips non-digit characters", () => {
    expect(normalizePhone("+252 (61) 555-1234")).toBe("+252615551234");
  });

  it("handles numbers with multiple + signs (only the first is kept)", () => {
    expect(normalizePhone("++252615551234")).toBe("+252615551234");
  });
});

/**
 * Tests for the admin review-note validator.
 *
 * The marketplace moderation queue requires a minimum-length note before
 * rejecting a listing, so the seller knows what to fix.
 */
import { reviewNoteProblem } from "@/lib/adminApi";

describe("reviewNoteProblem", () => {
  it("returns null for a valid note at the minimum length", () => {
    expect(reviewNoteProblem("Exactly 8")).toBeNull();
  });

  it("returns null for a long, detailed note", () => {
    expect(reviewNoteProblem("The photos show a different item than the title describes.")).toBeNull();
  });

  it("returns an error for an empty string", () => {
    expect(reviewNoteProblem("")).not.toBeNull();
  });

  it("returns an error for whitespace only", () => {
    expect(reviewNoteProblem("   ")).not.toBeNull();
  });

  it("returns an error for a note shorter than the minimum", () => {
    expect(reviewNoteProblem("Short")).not.toBeNull();
  });

  it("trims whitespace before checking length", () => {
    // "  1234567  " = 11 chars, trimmed = 7 — too short.
    expect(reviewNoteProblem("  1234567  ")).not.toBeNull();
    // "  12345678  " = 12 chars, trimmed = 8 — valid.
    expect(reviewNoteProblem("  12345678  ")).toBeNull();
  });
});