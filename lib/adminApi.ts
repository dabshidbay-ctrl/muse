import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getMarketplaceContact,
  listPendingMarketplaceItems,
  reviewMarketplaceItem,
} from "./marketplaceApi";
import type {
  MarketplaceCategory,
  MarketplaceCondition,
  MarketplaceItem,
  Profile,
  Property,
  PropertyPoster,
  SelfAssignableRole,
} from "./types";

/**
 * Queries backing the admin moderation screen (app/(root)/admin.tsx).
 *
 * These live apart from lib/api.ts because every call here only succeeds for a
 * caller whose profile row carries role='admin' — they lean on the widened RLS
 * policies from migration 0015 (`admin reads all profiles`,
 * `admin updates any profile`) and on the pre-existing admin moderation
 * policies on `properties`. Same conventions as lib/api.ts: the SupabaseClient
 * is the first argument, errors are thrown rather than returned, and results
 * are typed from lib/types.ts.
 *
 * Nothing in this file is a security boundary. The role gate in the UI only
 * decides what is worth rendering; the database decides what is allowed.
 */

/**
 * Every listing on the platform, newest first, regardless of owner.
 *
 * Unlike getMyProperties this applies no owner_id filter — `properties` is
 * world-readable, so this is a wide read rather than a privileged one; the
 * privilege is in what the screen offers to do with the rows.
 */
export async function getAllProperties(
  supabase: SupabaseClient,
  { limit = 200 }: { limit?: number } = {}
): Promise<Property[]> {
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as Property[];
}

/**
 * Delete any listing as an administrator.
 *
 * Cascades: the row's photos, amenities, views, favourites and bookings go with
 * it (foreign keys are ON DELETE CASCADE), so callers must confirm first.
 *
 * A delete refused by RLS resolves with no error and no rows rather than
 * failing, which reads as success — hence the explicit count check.
 */
export async function adminDeleteProperty(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error, count } = await supabase
    .from("properties")
    .delete({ count: "exact" })
    .eq("id", id);

  if (error) throw error;
  if (count === 0) {
    throw new Error(
      "That listing was not deleted. It may already be gone, or your account may no longer have administrator rights."
    );
  }
}

/** Every user profile, newest first. Only an admin sees more than their own row. */
export async function getAllProfiles(
  supabase: SupabaseClient,
  { limit = 200 }: { limit?: number } = {}
): Promise<Profile[]> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as Profile[];
}

/**
 * Change another user's account type.
 *
 * `SelfAssignableRole` deliberately excludes 'admin': migration 0015's trigger
 * rejects any client-side grant of 'admin' — to yourself or to anyone else —
 * and equally refuses changing an existing admin's role. Promotion stays a
 * Supabase dashboard action. The type keeps that mistake out of the UI; the
 * trigger is what actually enforces it.
 */
export async function setUserRole(
  supabase: SupabaseClient,
  userId: string,
  role: SelfAssignableRole
): Promise<Profile> {
  const { data, error } = await supabase
    .from("profiles")
    .update({ role })
    .eq("id", userId)
    .select("*")
    .maybeSingle();

  if (error) throw error;
  // Zero rows means the update policy filtered the row out instead of raising:
  // supabase-js reports that as a success with no data, so it must be caught here.
  if (!data) {
    throw new Error(
      "That account type was not changed. Your account may no longer have administrator rights."
    );
  }
  return data as Profile;
}

/* ------------------------------------------------------- listing publishers */

/**
 * Who published a listing, with the phone number they registered.
 *
 * Admin-only, and enforced by RLS rather than by the caller: the profile row is
 * readable by any signed-in user (that is what makes a publisher's name show up
 * elsewhere), but the number lives in public.profile_contacts, whose SELECT
 * policy is self-or-admin. A non-admin calling this gets the profile fields and
 * a null phone, never the number.
 *
 * Returns null when the listing has no owner (seeded rows) rather than throwing,
 * so the caller can render "no publisher account" instead of an error.
 */
export async function getPropertyPoster(
  supabase: SupabaseClient,
  ownerId: string
): Promise<PropertyPoster | null> {
  if (!ownerId) return null;

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role")
    .eq("id", ownerId)
    .maybeSingle();

  if (error) throw error;
  if (!profile) return null;

  // A separate read, not a join: the contact table's policy is what protects
  // the number, and a join would fail the whole query for a non-admin instead
  // of simply returning no phone.
  const { data: contact, error: contactError } = await supabase
    .from("profile_contacts")
    .select("phone")
    .eq("profile_id", ownerId)
    .maybeSingle();

  // A refused read is not a failure of the screen — it means "no number for
  // you", which is exactly what a non-admin should see.
  if (contactError) {
    return { ...(profile as Omit<PropertyPoster, "phone">), phone: null };
  }

  return {
    ...(profile as Omit<PropertyPoster, "phone">),
    phone: (contact as { phone: string } | null)?.phone ?? null,
  };
}

/* ------------------------------------------------- marketplace review queue */

/**
 * The marketplace moderation queue.
 *
 * The queries themselves live in lib/marketplaceApi.ts (contract #3); what is
 * added here is the admin console's view of them — the labels the queue renders
 * and the one rule the UI must not be able to skip: a rejection carries a
 * reason.
 *
 * Privacy: `getSellerPhone` is the only phone read in the whole app. The number
 * lives in `marketplace_contacts`, whose SELECT policy is seller-or-admin only,
 * because RLS filters rows and not columns — a phone on the public item table
 * would be readable by every authenticated buyer. Nothing here may persist,
 * log, or report that number: it is fetched on demand, held in component state
 * for as long as it is on screen, and never attached to an error report.
 */

/** Labels for the queue's chips. Kept beside the queue so the admin console
 *  renders the same wording whatever order the marketplace constants land in. */
export const MARKETPLACE_CATEGORY_LABEL: Record<MarketplaceCategory, string> = {
  sofa: "Sofa",
  bed: "Bed",
  table: "Table",
  chair: "Chair",
  wardrobe: "Wardrobe",
  kitchen: "Kitchen",
  appliance: "Appliance",
  decor: "Decor",
  office: "Office",
  other: "Other",
};

export const MARKETPLACE_CONDITION_LABEL: Record<MarketplaceCondition, string> = {
  new: "New",
  like_new: "Like new",
  good: "Good",
  fair: "Fair",
};

/**
 * Shortest note that can plausibly tell a seller what to fix. Anything below
 * this is the "rejected, no reason" case the seller cannot distinguish from a
 * bug, so it is refused rather than stored.
 */
export const MIN_REVIEW_NOTE = 8;

/**
 * Validates a rejection note. Returns the problem to show, or null when valid.
 * The console disables its Reject button on this, and `rejectMarketplaceItem`
 * checks it again — a disabled button is a hint, not a guarantee.
 */
export function reviewNoteProblem(note: string): string | null {
  const trimmed = note.trim();
  if (!trimmed) return "A reason is required. The seller is shown this note.";
  if (trimmed.length < MIN_REVIEW_NOTE) {
    return `Add a little more detail (at least ${MIN_REVIEW_NOTE} characters) so the seller knows what to change.`;
  }
  return null;
}

/** Items awaiting review, oldest submissions first as ordered by the query. */
export async function getMarketplaceQueue(
  supabase: SupabaseClient
): Promise<MarketplaceItem[]> {
  return listPendingMarketplaceItems(supabase);
}

/**
 * The seller's phone for one queued item. Admin-only by RLS; returns null when
 * no contact row exists rather than throwing, so a missing number reads as
 * "none on file" instead of as a failure.
 */
export async function getSellerPhone(
  supabase: SupabaseClient,
  itemId: string
): Promise<string | null> {
  const contact = await getMarketplaceContact(supabase, { itemId });
  return contact?.phone ?? null;
}

/** Approve an item — it becomes publicly visible. No note is needed. */
export async function approveMarketplaceItem(
  supabase: SupabaseClient,
  id: string
): Promise<MarketplaceItem> {
  return reviewMarketplaceItem(supabase, { id, status: "approved" });
}

/**
 * Reject an item with the reason the seller will be shown.
 *
 * The note is required here and not only in the form: the seller's only signal
 * that a human looked at their item is this text.
 */
export async function rejectMarketplaceItem(
  supabase: SupabaseClient,
  id: string,
  note: string
): Promise<MarketplaceItem> {
  const problem = reviewNoteProblem(note);
  if (problem) throw new Error(problem);
  return reviewMarketplaceItem(supabase, { id, status: "rejected", note: note.trim() });
}
