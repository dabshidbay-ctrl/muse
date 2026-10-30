import type { SupabaseClient } from "@supabase/supabase-js";
import { uploadPhotoToBucket } from "./uploadPhoto";
import { Platform } from "react-native";
import type {
  Amenity,
  AppNotification,
  BookedRange,
  Booking,
  BookingStatus,
  BookingWithProperty,
  Profile,
  Property,
  PropertyDetail,
  District,
  PropertyFilters,
  PropertyType,
  RentalMode,
  SelfAssignableRole,
} from "./types";

/**
 * A listing needs at least 2 photos before it can be published, and never more
 * than 18.
 *
 * The maximum is also a database trigger (migration 0012) — the DB is the real
 * boundary. The minimum is *not* a database rule on purpose: a gallery is built
 * one photo at a time, so a row-level "at least 2" would reject the first
 * insert and make two unreachable. It is a publish-time rule, and this layer is
 * where publishing is decided.
 */
export const MIN_PROPERTY_PHOTOS = 2;
export const MAX_PROPERTY_PHOTOS = 18;

/** Newest properties, used by the "Featured" rail on the home screen. */
export async function getLatestProperties(
  supabase: SupabaseClient,
  { limit = 6 }: { limit?: number } = {}
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
 * Property list with optional filters and paging.
 *
 * Goes through the `search_properties` RPC rather than building a PostgREST
 * `or=` filter client-side: the query is bound as a real parameter, so
 * punctuation in the search box cannot alter the filter.
 */
export async function getProperties(
  supabase: SupabaseClient,
  {
    filters,
    limit = 20,
    offset = 0,
  }: { filters?: PropertyFilters; limit?: number; offset?: number } = {}
): Promise<Property[]> {
  const { data, error } = await supabase.rpc("search_properties", {
    search_query: filters?.query ?? null,
    // "all" reaches the RPC as-is; it treats "all"/null/"" as no type filter,
    // so the caller never has to translate the chip they rendered.
    property_type: filters?.type ?? null,
    // Same convention as property_type: "all"/null/"" is no district filter,
    // and rows with no district are still returned in that case.
    district: filters?.district ?? null,
    min_price: filters?.minPrice ?? null,
    max_price: filters?.maxPrice ?? null,
    min_bedrooms: filters?.minBedrooms ?? null,
    result_limit: limit,
    result_offset: offset,
  });

  if (error) throw error;
  return (data ?? []) as Property[];
}

/**
 * One property with its gallery, reviews and amenities, in one round trip.
 *
 * Deliberately does NOT join `agents`: that table is world-readable and carries
 * an email address, so joining it published the poster's contact details to
 * every visitor. Poster identity is an admin-only read — see
 * `getPropertyPoster` in lib/adminApi.ts.
 */
export async function getPropertyById(
  supabase: SupabaseClient,
  id: string
): Promise<PropertyDetail | null> {
  const { data, error } = await supabase
    .from("properties")
    .select("*, galleries(*), reviews(*), amenities(*)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data as PropertyDetail | null) ?? null;
}

/**
 * The full favourite rows, joined with the property each one points at.
 *
 * Unlike `getFavorites` (which returns ids for the heart buttons), this returns
 * enough to render a list. Selects only the columns the favourites card needs.
 */
export async function getFavoriteProperties(
  supabase: SupabaseClient,
  { userId }: { userId: string }
): Promise<Property[]> {
  const { data, error } = await supabase
    .from("favorites")
    .select("property:properties(id, name, image, address, price, rating, type, bedrooms, bathrooms, rental_mode)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? [])
    .map((row) => (row as unknown as { property: Property | null }).property)
    .filter((p): p is Property => p !== null);
}

/** Property ids the signed-in user has favourited. */
export async function getFavorites(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from("favorites")
    .select("property_id")
    .eq("user_id", userId);

  if (error) throw error;
  return (data ?? []).map((row) => row.property_id as string);
}

export async function addFavorite(
  supabase: SupabaseClient,
  userId: string,
  propertyId: string
): Promise<void> {
  const { error } = await supabase
    .from("favorites")
    .insert({ user_id: userId, property_id: propertyId });

  if (error) throw error;
}

export async function removeFavorite(
  supabase: SupabaseClient,
  userId: string,
  propertyId: string
): Promise<void> {
  const { error } = await supabase
    .from("favorites")
    .delete()
    .eq("user_id", userId)
    .eq("property_id", propertyId);

  if (error) throw error;
}

/* ------------------------------------------------------------ property views */

/**
 * Records that the signed-in user opened a property.
 *
 * Counted as *unique viewers*: `property_views` has a unique
 * (property_id, viewer_id) constraint, so opening the same listing again is a
 * no-op rather than a failure — `ignoreDuplicates` turns the insert into
 * ON CONFLICT DO NOTHING. A view by the listing's own owner is dropped by a
 * database trigger, so callers never have to know who owns it.
 *
 * The viewer id comes from the stored session rather than an argument: it has
 * to equal auth.jwt()->>'sub' for the insert policy to accept the row, and
 * reading it here keeps the two from drifting apart. Signed out, there is
 * nobody to attribute the view to, so this quietly does nothing.
 */
export async function recordPropertyView(
  supabase: SupabaseClient,
  { propertyId }: { propertyId: string }
): Promise<void> {
  const { data, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const viewerId = data.session?.user?.id;
  if (!viewerId) return;

  const { error } = await supabase
    .from("property_views")
    .upsert(
      { property_id: propertyId, viewer_id: viewerId },
      { onConflict: "property_id,viewer_id", ignoreDuplicates: true }
    );

  if (error) throw error;
}

/* ------------------------------------------------------------------ profiles */

/**
 * Ensures a profile row exists for the signed-in Supabase user and returns it.
 * Role is never sent from the client — it defaults to 'tenant' on insert and is
 * only changed in the Supabase dashboard.
 */
export async function ensureProfile(
  supabase: SupabaseClient,
  user: { id: string; email?: string | null; fullName?: string | null; imageUrl?: string | null }
): Promise<Profile | null> {
  const { data: existing, error: readError } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  if (readError) throw readError;

  if (existing) {
    // Keep the mirrored Supabase user fields fresh, but never touch `role`.
    //
    // `full_name` is seeded only when the profile has none. It is editable in
    // the app, and mirroring the auth metadata on every load silently reverted
    // that edit: profile-edit calls refresh() right after saving, which runs
    // this function and wrote the old name straight back — or NULL, for an
    // account whose provider supplied no name.
    const patch: {
      email: string | null;
      avatar_url: string | null;
      full_name?: string | null;
    } = {
      email: user.email ?? null,
      avatar_url: user.imageUrl ?? null,
    };
    if (!(existing as Profile).full_name && user.fullName) {
      patch.full_name = user.fullName;
    }

    const { data, error } = await supabase
      .from("profiles")
      .update(patch)
      .eq("id", user.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    return (data as Profile | null) ?? (existing as Profile);
  }

  const { data, error } = await supabase
    .from("profiles")
    .insert({
      id: user.id,
      email: user.email ?? null,
      full_name: user.fullName ?? null,
      avatar_url: user.imageUrl ?? null,
    })
    .select("*")
    .maybeSingle();

  if (error) throw error;
  return (data as Profile | null) ?? null;
}

/**
 * Changes the signed-in user's own account type.
 *
 * Only the three self-assignable roles are accepted here; 'admin' is not one of
 * them, and the RLS policy in migration 0009 enforces that server-side — this
 * type is a convenience, not the security boundary.
 */
export async function updateMyRole(
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
  // A silent zero-row result means the policy refused the change rather than
  // the request failing, which would otherwise look like success to the caller.
  if (!data) throw new Error("The account type could not be changed.");
  return data as Profile;
}

export async function getProfile(
  supabase: SupabaseClient,
  { userId }: { userId: string }
): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as Profile | null) ?? null;
}

/* --------------------------------------------------------- profile contacts */

/**
 * The signed-in user's own phone number, or null when none is on file.
 *
 * The number lives in public.profile_contacts rather than on public.profiles
 * because RLS filters rows and not columns: a `phone` column on profiles would
 * be readable by every signed-in user, since the profiles read policy already
 * exposes publisher rows. This table's read policy is self-or-admin only.
 */
export async function getMyPhone(
  supabase: SupabaseClient,
  userId: string
): Promise<string | null> {
  const { data, error } = await supabase
    .from("profile_contacts")
    .select("phone")
    .eq("profile_id", userId)
    .maybeSingle();

  if (error) throw error;
  return (data as { phone: string } | null)?.phone ?? null;
}

/**
 * Create or replace the signed-in user's phone number.
 *
 * Upsert rather than insert-or-update: the row may or may not exist yet, and
 * `profile_id` is the primary key, so one statement covers both cases without a
 * read-then-write race.
 */
export async function saveMyPhone(
  supabase: SupabaseClient,
  userId: string,
  phone: string
): Promise<void> {
  const { error } = await supabase
    .from("profile_contacts")
    .upsert({ profile_id: userId, phone: phone.trim() }, { onConflict: "profile_id" });

  if (error) throw error;
}

/* ------------------------------------------------------------------ bookings */

/** Bookings the user made as a guest, newest first. */
export async function getMyBookings(
  supabase: SupabaseClient,
  { userId }: { userId: string }
): Promise<BookingWithProperty[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, property:properties(id, name, image, address, price)")
    .eq("guest_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as BookingWithProperty[];
}

/** Requests received on properties the user owns, newest first. */
export async function getBookingRequests(
  supabase: SupabaseClient,
  { userId }: { userId: string }
): Promise<BookingWithProperty[]> {
  const { data, error } = await supabase
    .from("bookings")
    .select("*, property:properties(id, name, image, address, price)")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as BookingWithProperty[];
}

export async function createBooking(
  supabase: SupabaseClient,
  input: {
    propertyId: string;
    guestId: string;
    ownerId: string | null;
    checkIn: string;
    checkOut: string;
    guests: number;
    totalPrice: number;
    message?: string;
  }
): Promise<Booking> {
  const { data, error } = await supabase
    .from("bookings")
    .insert({
      property_id: input.propertyId,
      guest_id: input.guestId,
      owner_id: input.ownerId,
      check_in: input.checkIn,
      check_out: input.checkOut,
      guests: input.guests,
      total_price: input.totalPrice,
      message: input.message ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as Booking;
}

/** Owner confirms/declines, or guest cancels. RLS enforces who may do which. */
export async function updateBookingStatus(
  supabase: SupabaseClient,
  bookingId: string,
  status: BookingStatus
): Promise<void> {
  const { error } = await supabase
    .from("bookings")
    .update({ status })
    .eq("id", bookingId);

  if (error) throw error;
}

/**
 * Updates the payment details on a booking after a Sifalo transaction.
 * Used by the client after verifying the payment, and by the Edge Function.
 */
export async function updateBookingPayment(
  supabase: SupabaseClient,
  bookingId: string,
  {
    paymentStatus,
    sifaloSid,
    paidAmount,
    paymentMethod,
  }: {
    paymentStatus: "paid" | "failed" | "pending";
    sifaloSid?: string;
    paidAmount?: number;
    paymentMethod?: string;
  }
): Promise<void> {
  const patch: Record<string, unknown> = { payment_status: paymentStatus };
  if (sifaloSid !== undefined) patch.sifalo_sid = sifaloSid;
  if (paidAmount !== undefined) patch.paid_amount = paidAmount;
  if (paymentMethod !== undefined) patch.payment_method = paymentMethod;

  const { error } = await supabase
    .from("bookings")
    .update(patch)
    .eq("id", bookingId);

  if (error) throw error;
}

/* ------------------------------------------------------------- notifications */

export async function getNotifications(
  supabase: SupabaseClient,
  { userId, limit = 50 }: { userId: string; limit?: number }
): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as AppNotification[];
}

export async function getUnreadCount(
  supabase: SupabaseClient,
  { userId }: { userId: string }
): Promise<number> {
  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);

  if (error) throw error;
  return count ?? 0;
}

export async function markNotificationsRead(
  supabase: SupabaseClient,
  userId: string,
  ids?: string[]
): Promise<void> {
  let request = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);

  if (ids?.length) request = request.in("id", ids);

  const { error } = await request;
  if (error) throw error;
}

/* --------------------------------------------------------------- publishing */

export async function createProperty(
  supabase: SupabaseClient,
  input: {
    ownerId: string;
    name: string;
    type: PropertyType;
    district?: District | null;
    description?: string;
    address?: string;
    price: number;
    area: number;
    bedrooms: number;
    bathrooms: number;
    livingRooms?: number;
    floorNumber?: number | null;
    facilities?: string[];
    nearbyFacilities?: string[];
    rentalMode?: RentalMode;
    image?: string;
  }
): Promise<Property> {
  const { data, error } = await supabase
    .from("properties")
    .insert({
      owner_id: input.ownerId,
      name: input.name,
      type: input.type,
      district: input.district ?? null,
      description: input.description ?? null,
      address: input.address ?? null,
      price: input.price,
      area: input.area,
      bedrooms: input.bedrooms,
      bathrooms: input.bathrooms,
      living_rooms: input.livingRooms ?? 0,
      floor_number: input.floorNumber ?? null,
      facilities: input.facilities ?? [],
      nearby_facilities: input.nearbyFacilities ?? [],
      rental_mode: input.rentalMode ?? "monthly",
      image: input.image ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;
  return data as Property;
}

/** Update an existing listing. RLS restricts this to the owner (or admin). */
export async function updateProperty(
  supabase: SupabaseClient,
  id: string,
  input: {
    name?: string;
    type?: PropertyType;
    district?: District | null;
    description?: string | null;
    address?: string | null;
    price?: number;
    area?: number;
    bedrooms?: number;
    bathrooms?: number;
    livingRooms?: number;
    floorNumber?: number | null;
    facilities?: string[];
    nearbyFacilities?: string[];
    rentalMode?: RentalMode;
    image?: string | null;
  }
): Promise<Property> {
  const { data, error } = await supabase
    .from("properties")
    .update({
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      // `undefined` leaves the district alone; an explicit `null` clears it
      // back to "not specified", which is a real choice the form can make.
      ...(input.district !== undefined ? { district: input.district } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.area !== undefined ? { area: input.area } : {}),
      ...(input.bedrooms !== undefined ? { bedrooms: input.bedrooms } : {}),
      ...(input.bathrooms !== undefined ? { bathrooms: input.bathrooms } : {}),
      ...(input.livingRooms !== undefined ? { living_rooms: input.livingRooms } : {}),
      // Explicit null clears the floor back to "not specified"; `undefined`
      // leaves it alone, matching the district convention above.
      ...(input.floorNumber !== undefined ? { floor_number: input.floorNumber } : {}),
      ...(input.facilities !== undefined ? { facilities: input.facilities } : {}),
      ...(input.nearbyFacilities !== undefined
        ? { nearby_facilities: input.nearbyFacilities }
        : {}),
      ...(input.rentalMode !== undefined ? { rental_mode: input.rentalMode } : {}),
      ...(input.image !== undefined ? { image: input.image } : {}),
    })
    .eq("id", id)
    .select("*")
    .single();

  if (error) throw error;
  return data as Property;
}

/** Delete a listing. RLS restricts this to the owner (or admin). */
export async function deleteProperty(
  supabase: SupabaseClient,
  id: string
): Promise<void> {
  const { error, count } = await supabase.from("properties").delete({ count: "exact" }).eq("id", id);
  if (error) throw error;
  if (count === 0) {
    throw new Error(
      "That listing was not deleted. It may already be gone, or your account may no longer have permission."
    );
  }
}

/** Listings published by the signed-in owner. */
export async function getMyProperties(
  supabase: SupabaseClient,
  { userId }: { userId: string }
): Promise<Property[]> {
  const { data, error } = await supabase
    .from("properties")
    .select("*")
    .eq("owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data ?? []) as Property[];
}

/* ---------------------------------------------------------------- amenities */

/** Amenities for a single property, alphabetised. */
export async function getAmenities(
  supabase: SupabaseClient,
  { propertyId }: { propertyId: string }
): Promise<Amenity[]> {
  const { data, error } = await supabase
    .from("amenities")
    .select("*")
    .eq("property_id", propertyId)
    .order("name", { ascending: true });

  if (error) throw error;
  return (data ?? []) as Amenity[];
}

/** Add an amenity to a property. RLS restricts this to the property owner. */
export async function addAmenity(
  supabase: SupabaseClient,
  { propertyId, name }: { propertyId: string; name: string }
): Promise<Amenity> {
  const { data, error } = await supabase
    .from("amenities")
    .insert({ property_id: propertyId, name })
    .select("*")
    .single();

  if (error) throw error;
  return data as Amenity;
}

/** Remove an amenity. RLS restricts this to the owner (or admin). */
export async function deleteAmenity(
  supabase: SupabaseClient,
  amenityId: string
): Promise<void> {
  const { error } = await supabase.from("amenities").delete().eq("id", amenityId);
  if (error) throw error;
}

/**
 * Replace a property's amenities with the given names. Deletes any rows not in
 * the list and inserts the new ones. RLS restricts writes to the owner.
 */
export async function replaceAmenities(
  supabase: SupabaseClient,
  { propertyId, names }: { propertyId: string; names: string[] }
): Promise<void> {
  const { data: existing, error: readError } = await supabase
    .from("amenities")
    .select("id, name")
    .eq("property_id", propertyId);
  if (readError) throw readError;

  const current = (existing ?? []) as { id: string; name: string }[];
  const currentNames = new Set(current.map((a) => a.name));
  const nextNames = new Set(names);

  const toDelete = current.filter((a) => !nextNames.has(a.name)).map((a) => a.id);
  const toInsert = names.filter((n) => !currentNames.has(n));

  if (toDelete.length) {
    const { error } = await supabase.from("amenities").delete().in("id", toDelete);
    if (error) throw error;
  }
  if (toInsert.length) {
    const { error } = await supabase
      .from("amenities")
      .insert(toInsert.map((name) => ({ property_id: propertyId, name })));
    if (error) throw error;
  }
}

/* ------------------------------------------------------------------- photos */

/** A property's gallery images, oldest first, as plain URLs. */
export async function getPropertyPhotos(
  supabase: SupabaseClient,
  { propertyId }: { propertyId: string }
): Promise<string[]> {
  const { data, error } = await supabase
    .from("galleries")
    .select("id, image, position")
    .eq("property_id", propertyId)
    // `position` is the order the owner arranged in PhotoPicker, and photo 0 is
    // the cover. Ordering by `id` (a random uuid) returned them shuffled, so
    // neither the order nor the cover survived a save. `id` only breaks ties.
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((row) => row.image as string);
}

/**
 * Make a property's gallery exactly `urls`.
 *
 * Diffed rather than delete-all-then-reinsert so an unchanged photo keeps its
 * row: a full wipe would briefly leave the listing with no images, and any
 * concurrent reader would see it empty.
 *
 * The maximum is checked here as well as in the database trigger so the user
 * gets a sentence instead of a Postgres error. The minimum is not checked:
 * callers build a gallery up one photo at a time and only the publish action
 * knows when MIN_PROPERTY_PHOTOS must hold.
 */
export async function replacePropertyPhotos(
  supabase: SupabaseClient,
  { propertyId, urls }: { propertyId: string; urls: string[] }
): Promise<void> {
  if (urls.length > MAX_PROPERTY_PHOTOS) {
    throw new Error(`A property can have at most ${MAX_PROPERTY_PHOTOS} photos.`);
  }

  const { data: existing, error: readError } = await supabase
    .from("galleries")
    .select("id, image")
    .eq("property_id", propertyId);
  if (readError) throw readError;

  const current = (existing ?? []) as { id: string; image: string; position: number }[];
  const next = new Set(urls);
  const byImage = new Map(current.map((g) => [g.image, g]));

  const toDelete = current.filter((g) => !next.has(g.image)).map((g) => g.id);

  if (toDelete.length) {
    const { error } = await supabase.from("galleries").delete().in("id", toDelete);
    if (error) throw error;
  }

  // `urls` is the order the user arranged, so the array index *is* the position.
  // Rows that survive need their position rewritten as well as new rows added —
  // reordering an existing gallery changes no image, only their order.
  const toInsert = urls
    .map((image, position) => ({ image, position }))
    .filter((row) => !byImage.has(row.image));

  if (toInsert.length) {
    const { error } = await supabase
      .from("galleries")
      .insert(toInsert.map((row) => ({ property_id: propertyId, ...row })));
    if (error) throw error;
  }

  // At most MAX_PROPERTY_PHOTOS rows, and only those whose position actually
  // moved, so this is a handful of updates at worst.
  type Row = { id: string; image: string; position: number };
  const moved = urls
    .map((image, position) => ({ row: byImage.get(image), position }))
    .filter((m): m is { row: Row; position: number } => !!m.row && m.row.position !== m.position);

  for (const m of moved) {
    const { error } = await supabase
      .from("galleries")
      .update({ position: m.position })
      .eq("id", m.row.id);
    if (error) throw error;
  }
}

/**
 * Uploads a property photo to the `property-photos` bucket.
 *
 * The mechanics live in lib/uploadPhoto.ts, shared with the marketplace: the
 * platform branching there encodes a device-only bug (React Native's Blob has
 * no `arrayBuffer()`) that must not be fixed in one copy and missed in another.
 */
export async function uploadPropertyPhoto(
  supabase: SupabaseClient,
  { propertyId, uri }: { propertyId: string; uri: string }
): Promise<string> {
  return uploadPhotoToBucket(supabase, {
    bucket: "property-photos",
    folder: propertyId,
    uri,
  });
}

/* ----------------------------------------------------------- booked ranges */

/**
 * Date windows already taken on a property, for the availability calendar.
 *
 * Reads through the `get_booked_ranges` RPC, not the bookings table: RLS lets a
 * guest see only their own bookings, and rightly so. The SECURITY DEFINER
 * function returns check-in/check-out and nothing else, so the calendar learns
 * which days are unavailable without learning who took them.
 *
 * Only 'pending' and 'confirmed' are returned — declined and cancelled
 * bookings free their dates back up.
 */
export async function getBookedRanges(
  supabase: SupabaseClient,
  { propertyId }: { propertyId: string }
): Promise<BookedRange[]> {
  const { data, error } = await supabase.rpc("get_booked_ranges", {
    p_property_id: propertyId,
  });

  if (error) throw error;
  return (data ?? []) as BookedRange[];
}
