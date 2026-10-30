/**
 * Somali phone number normalisation.
 *
 * Somali numbers reach us in every shape a person can type them: "0615551234",
 * "+252 61 555 1234", "252-61-555-1234", "61 555 1234". Rejecting any of those
 * would be wrong, so everything that is not a digit or a leading "+" is thrown
 * away first and only the national significant number is checked.
 *
 * After normalising, the national part must be 7–9 digits and must not start
 * with 0 — that covers mobiles (61x–79x + 7 digits) and the shorter Mogadishu
 * landlines (1 xxxxxx). Deliberately no prefix whitelist: Somali operators add
 * ranges regularly, and a stale list would reject a real, working number.
 */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  let national = digits.startsWith("+") ? digits.slice(1) : digits;
  if (national.startsWith("00252")) national = national.slice(5);
  else if (national.startsWith("252")) national = national.slice(3);
  // Trunk prefix, as written on shop fronts and business cards.
  national = national.replace(/^0+/, "");
  if (!/^[1-9]\d{6,8}$/.test(national)) return null;
  return `+252${national}`;
}