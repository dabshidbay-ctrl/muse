import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadPhotoToBucket } from "./uploadPhoto";
import { Platform } from "react-native";
import type {
  MarketplaceEnquiry,
  MarketplaceFilters,
  MarketplaceItem,
  MarketplaceStatus,
} from "./types";

/**
 * An item needs at least 1 photo before it can be listed, and never more than 8.
 *
 * The maximum is also a database CHECK (migration 0017) — the DB is the real
 * boundary. The minimum is *not* a database rule, for the same reason as
 * MIN_PROPERTY_PHOTOS in lib/api.ts: a row-level "at least 1" would reject the
 * draft row a gallery is built onto. It is a publish-time rule, and this layer
 * is where publishing is decided.
 */
export const MIN_ITEM_PHOTOS = 1;
export const MAX_ITEM_PHOTOS = 8;

/**
 * Columns of public.marketplace_items.
 *
 * Spelled out rather than `*` as a standing reminder: this list is the buyer's
 * view of an item and there is no contact column on the table to add to it. A
 * seller's phone lives in public.marketplace_contacts and is reachable only
 * through `getMarketplaceContact`, which admins alone can call successfully.
 */
const ITEM_COLUMNS =
  "id, seller_id, title, description, category, condition, price, negotiable, " +
  "district, images, status, review_note, reviewed_by, reviewed_at, created_at, updated_at";

/**
 * Characters PostgREST reads as structure inside an `or=` filter.
 *
 * The search term is interpolated into that filter string, so anything that
 * could close a value and start a new predicate is dropped rather than escaped
 * — a furniture search box has no legitimate use for them, and dropping cannot
 * be got wrong the way escaping can. Everything else, including spaces and
 * non-Latin scripts, survives untouched.
 */
const sanitiseSearch = (query: string) =>
  query.replace(/[,()"'\\%*]/g, " ").trim();

/**
 * Approved items only, newest first.
 *
 * The `status` filter is belt and braces: the RLS policy from 0017 already
 * hides other people's pending rows. Stating it here means the seller's own
 * pending item does not appear on the public browse screen either — RLS shows
 * it to them, and this is a public list, not "my items".
 */
export async function listMarketplaceItems(
  supabase: SupabaseClient,
  {
    filters,
    limit = 20,
    offset = 0,
  }: { filters?: MarketplaceFilters; limit?: number; offset?: number } = {}
): Promise<MarketplaceItem[]> {
  let request = supabase
    .from("marketplace_items")
    .select(ITEM_COLUMNS)
    .eq("status", "approved");

  if (filters?.category && filters.category !== "all") {
    request = request.eq("category", filters.category);
  }

  if (filters?.condition && filters.condition !== "all") {
    request = request.eq("condition", filters.condition);
  }

  // As with properties: asking for no district still returns items that have
  // none. Only an explicit district excludes them.
  if (filters?.district && filters.district !== "all") {
    request = request.eq("district", filters.district);
  }

  if (typeof filters?.minPrice === "number") {
    request = request.gte("price", filters.minPrice);
  }

  if (typeof filters?.maxPrice === "number") {
    request = request.lte("price", filters.maxPrice);
  }

  const term = sanitiseSearch(filters?.query ?? "");
  if (term) {
    request = request.or(
      `title.ilike.*${term}*,description.ilike.*${term}*`
    );
  }

  const { data, error } = await request
    .order("created_at", { ascending: false })
    // Clamped so a caller cannot ask for an unbounded page.
    .range(offset, offset + Math.max(1, Math.min(limit, 100)) - 1);

  if (error) throw error;
  return (data ?? []) as unknown as MarketplaceItem[];
}

/**
 * A single item, or null when it does not exist *or* the caller may not see it.
 *
 * Those two cases are deliberately indistinguishable: telling a buyer "this
 * item exists but is pending" leaks the existence of an unapproved listing.
 * `maybeSingle` is what makes the empty result a null instead of an error.
 */
export async function getMarketplaceItem(
  supabase: SupabaseClient,
  { id }: { id: string }
): Promise<MarketplaceItem | null> {
  const { data, error } = await supabase
    .from("marketplace_items")
    .select(ITEM_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as unknown as MarketplaceItem) ?? null;
}

/**
 * A seller's own items, in every status, for the "my items" screen.
 *
 * Bounded like every other list here. A seller is unlikely to reach 200, but an
 * unbounded query is a promise the database cannot keep, and this was the only
 * one left in the codebase.
 */
export async function getMyMarketplaceItems(
  supabase: SupabaseClient,
  { sellerId, limit = 200 }: { sellerId: string; limit?: number }
): Promise<MarketplaceItem[]> {
  const { data, error } = await supabase
    .from("marketplace_items")
    .select(ITEM_COLUMNS)
    .eq("seller_id", sellerId)
    .order("created_at", { ascending: false })
    .limit(Math.max(1, Math.min(limit, 200)));

  if (error) throw error;
  return (data ?? []) as unknown as MarketplaceItem[];
}

/**
 * What a seller may set. `status` and the review columns are absent on purpose:
 * the trigger in migration 0017 refuses them from any request carrying a JWT,
 * so including them here would only produce a confusing server-side error.
 */
export type MarketplaceItemInput = Partial<
  Pick<
    MarketplaceItem,
    | "title"
    | "description"
    | "category"
    | "condition"
    | "price"
    | "negotiable"
    | "district"
    | "images"
  >
>;

/**
 * Creates an item and its private contact row.
 *
 * Two writes, because the phone number lives in a separate table — that split
 * is what makes it unreadable to buyers (see the header of migration 0017).
 * They are not a transaction: PostgREST has no cross-request transaction, so if
 * the contact insert fails the item is deleted again rather than left listed
 * with no way for an admin to reach the seller.
 */
export async function createMarketplaceItem(
  supabase: SupabaseClient,
  {
    sellerId,
    item,
    phone,
  }: { sellerId: string; item: MarketplaceItemInput; phone: string }
): Promise<MarketplaceItem> {
  const { data, error } = await supabase
    .from("marketplace_items")
    .insert({ ...item, seller_id: sellerId })
    .select(ITEM_COLUMNS)
    .single();

  if (error) throw error;
  const created = data as unknown as MarketplaceItem;

  const { error: contactError } = await supabase
    .from("marketplace_contacts")
    .insert({ item_id: created.id, phone });

  if (contactError) {
    // Best effort: the item row is the caller's own, so this delete is
    // permitted by RLS. If it also fails there is nothing more this layer can
    // do, and the original error is the one worth reporting.
    await supabase.from("marketplace_items").delete().eq("id", created.id);
    throw contactError;
  }

  return created;
}

/**
 * Edits an item, and optionally its phone number.
 *
 * Only possible while the item is not approved — the RLS policy matches zero
 * rows once it is, which surfaces as a "no rows" error from `.single()` rather
 * than a silent no-op. That is the intended outcome: an approved listing is
 * frozen so an approval cannot be used as cover for different content.
 */
export async function updateMarketplaceItem(
  supabase: SupabaseClient,
  {
    id,
    item,
    phone,
  }: { id: string; item: MarketplaceItemInput; phone?: string | null }
): Promise<MarketplaceItem> {
  const { data, error } = await supabase
    .from("marketplace_items")
    .update(item)
    .eq("id", id)
    .select(ITEM_COLUMNS)
    .single();

  if (error) throw error;

  if (phone !== undefined) {
    if (phone) {
      // upsert, not update: an item created before the contact row existed (or
      // whose contact insert failed) would otherwise silently keep no phone.
      const { error: contactError } = await supabase
        .from("marketplace_contacts")
        .upsert({ item_id: id, phone }, { onConflict: "item_id" });

      if (contactError) throw contactError;
    } else {
      // Empty/null phone means the seller wants to clear their number.
      await supabase.from("marketplace_contacts").delete().eq("item_id", id);
    }
  }

  return data as unknown as MarketplaceItem;
}

/**
 * Deletes an item. The contact row goes with it: the foreign key is
 * `on delete cascade`, so a phone number never outlives the listing it
 * belongs to.
 */
export async function deleteMarketplaceItem(
  supabase: SupabaseClient,
  { id }: { id: string }
): Promise<void> {
  const { error } = await supabase
    .from("marketplace_items")
    .delete()
    .eq("id", id);

  if (error) throw error;
}

/**
 * Uploads a marketplace photo to the `marketplace-photos` bucket.
 *
 * Shares its mechanics with property uploads via lib/uploadPhoto.ts — see the
 * note there about React Native's Blob lacking `arrayBuffer()`.
 */
export async function uploadMarketplacePhoto(
  supabase: SupabaseClient,
  { itemId, uri }: { itemId: string; uri: string }
): Promise<string> {
  return uploadPhotoToBucket(supabase, {
    bucket: "marketplace-photos",
    folder: itemId,
    uri,
  });
}

/* --------------------------------------------------------------- admin only */

/**
 * The moderation queue, oldest first — a queue is worked from the front.
 *
 * Not privileged in itself: RLS is what limits the result. A non-admin caller
 * sees only their own pending items here, which is a harmless (and useless)
 * result rather than an error.
 */
export async function listPendingMarketplaceItems(
  supabase: SupabaseClient
): Promise<MarketplaceItem[]> {
  const { data, error } = await supabase
    .from("marketplace_items")
    .select(ITEM_COLUMNS)
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as MarketplaceItem[];
}

/**
 * The seller's phone number, for the admin approval screen.
 *
 * Returns null for anyone who is neither the item's seller nor an admin —
 * their SELECT matches zero rows under the policy in 0017, and zero rows is
 * exactly what a buyer must get. This function is the ONLY path from the phone
 * number to the app, and nothing on a buyer-facing screen may call it.
 */
export async function getMarketplaceContact(
  supabase: SupabaseClient,
  { itemId }: { itemId: string }
): Promise<{ phone: string } | null> {
  const { data, error } = await supabase
    .from("marketplace_contacts")
    .select("phone")
    .eq("item_id", itemId)
    .maybeSingle();

  if (error) throw error;
  return (data as { phone: string } | null) ?? null;
}

/**
 * Approves or rejects an item.
 *
 * `reviewed_by` and `reviewed_at` are not sent: the trigger in 0017 stamps them
 * from the caller's own JWT, so the audit trail cannot disagree with who
 * actually performed the update. The trigger also clears `review_note` for any
 * status other than 'rejected', so a stale rejection reason can never appear
 * beside an approved badge.
 *
 * A non-admin caller is refused by that trigger, not silently ignored.
 */
export async function reviewMarketplaceItem(
  supabase: SupabaseClient,
  {
    id,
    status,
    note,
  }: { id: string; status: MarketplaceStatus; note?: string }
): Promise<MarketplaceItem> {
  const { data, error } = await supabase
    .from("marketplace_items")
    .update({ status, review_note: note ?? null })
    .eq("id", id)
    .select(ITEM_COLUMNS)
    .single();

  if (error) throw error;
  return data as unknown as MarketplaceItem;
}

/* ------------------------------------------------------------- enquiries --
 * The buyer -> seller path. A seller's number stays private; what moves here is
 * the buyer's, and only because they pressed a button to send it.
 */

/**
 * Sends an enquiry. The seller is notified by a database trigger, so there is
 * no second write to keep in step.
 *
 * A repeat enquiry from the same buyer on the same item hits a unique
 * constraint (23505). That is the intended answer to a buyer pressing the
 * button twice, so it is translated into something a person can read rather
 * than surfaced as a database error.
 */
export async function sendMarketplaceEnquiry(
  supabase: SupabaseClient,
  {
    itemId,
    buyerId,
    phone,
    message,
  }: { itemId: string; buyerId: string; phone: string; message?: string }
): Promise<MarketplaceEnquiry> {
  const { data, error } = await supabase
    .from("marketplace_enquiries")
    .insert({
      item_id: itemId,
      buyer_id: buyerId,
      buyer_phone: phone.trim(),
      message: message?.trim() || null,
    })
    .select("*")
    .single();

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      throw new Error(
        "You have already asked about this item. The seller has your number."
      );
    }
    throw error;
  }
  return data as unknown as MarketplaceEnquiry;
}

/**
 * The enquiries on one item — for its seller (and admins).
 *
 * Returns an empty list rather than throwing for anyone else: RLS filters the
 * rows away, and a buyer opening an item they do not own is not an error.
 */
export async function getItemEnquiries(
  supabase: SupabaseClient,
  { itemId }: { itemId: string }
): Promise<MarketplaceEnquiry[]> {
  const { data, error } = await supabase
    .from("marketplace_enquiries")
    .select("*")
    .eq("item_id", itemId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return (data ?? []) as unknown as MarketplaceEnquiry[];
}

/** Whether this buyer has already enquired — drives the button's state. */
export async function hasEnquired(
  supabase: SupabaseClient,
  { itemId, buyerId }: { itemId: string; buyerId: string }
): Promise<boolean> {
  const { data, error } = await supabase
    .from("marketplace_enquiries")
    .select("id")
    .eq("item_id", itemId)
    .eq("buyer_id", buyerId)
    .maybeSingle();

  if (error) throw error;
  return !!data;
}

/** Withdraws an enquiry, taking the buyer's number back with it. */
export async function withdrawMarketplaceEnquiry(
  supabase: SupabaseClient,
  { itemId, buyerId }: { itemId: string; buyerId: string }
): Promise<void> {
  const { error } = await supabase
    .from("marketplace_enquiries")
    .delete()
    .eq("item_id", itemId)
    .eq("buyer_id", buyerId);

  if (error) throw error;
}
