/**
 * Sifalo Pay e-Wallet payment integration.
 *
 * SECURITY: The Sifalo API key lives on the server (Edge Function). The client
 * sends only the payment details and the user's phone number.
 *
 * Flow:
 *   1. User enters their mobile money number + picks a gateway on the checkout
 *      screen
 *   2. Client calls initiatePayment() → Edge Function → Sifalo e-Wallet API
 *   3. Response is instant: success, failure, or pending (603 = needs PIN)
 *   4. Booking is updated immediately
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** The deployed Edge Function route. */
const FN_BASE = `${(process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "")}/functions/v1/sifalo-checkout`;

/** Supported mobile money gateways. */
export const PAYMENT_GATEWAYS = [
  { value: "waafi", label: "EVC+ / Zaad / Sahal", hint: "Somaliland's most popular mobile money" },
  { value: "edahab", label: "eDahab", hint: "Popular in Mogadishu and south-central Somalia" },
  { value: "pbwallet", label: "Premier Wallet", hint: "Premier Bank mobile wallet" },
] as const;

export type PaymentGateway = (typeof PAYMENT_GATEWAYS)[number]["value"];

/** Result from initiating a payment. */
export type PaymentResult = {
  success: boolean;
  sid: string;
  status: "success" | "failure" | "pending";
  code: string;
  message: string;
};


async function authHeader(supabase: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? "";
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Initiate a direct wallet payment.
 *
 * @param supabase - Supabase client (for auth)
 * @param params - Payment details
 * @param params.bookingId - The booking to mark paid
 * @param params.amount - Amount in USD
 * @param params.account - The user's mobile money number (e.g. "615551234")
 * @param params.gateway - Payment gateway: "waafi", "edahab", or "pbwallet"
 */
export async function initiatePayment(
  supabase: SupabaseClient,
  {
    bookingId,
    amount,
    account,
    gateway,
  }: { bookingId: string; amount: number; account: string; gateway: PaymentGateway }
): Promise<PaymentResult> {
  const res = await fetch(FN_BASE, {
    method: "POST",
    headers: await authHeader(supabase),
    body: JSON.stringify({ bookingId, amount, account, gateway }),
  });

  const body = await res.text();

  if (!res.ok) {
    throw new Error(body || `Payment failed (HTTP ${res.status})`);
  }

  try {
    return JSON.parse(body) as PaymentResult;
  } catch {
    throw new Error(`Invalid response from payment server: ${body.slice(0, 200)}`);
  }
}