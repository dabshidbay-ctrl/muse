/**
 * App-wide settings stored in the `app_settings` table (migration 0030).
 *
 * The WhatsApp number is the one the admin sets on the admin page: it is
 * the number property detail pages open a chat to, with the property
 * details pre-filled. It is deliberately NOT an env var — the admin must
 * be able to change it without a redeploy.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone } from "@/lib/phone";

export const WHATSAPP_SETTING_KEY = "whatsapp_number";

/** The admin-set WhatsApp number, or null when none has been set yet. */
export async function getWhatsAppNumber(
  supabase: SupabaseClient
): Promise<string | null> {
  const { data, error } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", WHATSAPP_SETTING_KEY)
    .maybeSingle();
  if (error) return null;
  const value = (data?.value ?? "").trim();
  return value || null;
}

/**
 * Save the admin-set WhatsApp number. Throws on an invalid number or a
 * failed write; the caller renders the message.
 */
export async function setWhatsAppNumber(
  supabase: SupabaseClient,
  phone: string
): Promise<void> {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new Error("Enter a valid Somali phone number, e.g. 061 555 1234.");
  }
  const { error } = await supabase
    .from("app_settings")
    .upsert({ key: WHATSAPP_SETTING_KEY, value: normalized }, { onConflict: "key" });
  if (error) throw error;
}
