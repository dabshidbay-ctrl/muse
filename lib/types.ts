// Shapes returned by the Supabase tables defined in supabase/migrations.

export type Agent = {
  id: string;
  name: string;
  email: string | null;
  avatar: string | null;
  created_at: string;
};

export type Gallery = {
  id: string;
  property_id: string;
  image: string;
};

export type Review = {
  id: string;
  property_id: string;
  name: string;
  avatar: string | null;
  review: string;
  rating: number;
  created_at: string;
};

export type RentalMode = "monthly" | "short_term";

/**
 * The four listing categories. Matches the Postgres enum public.property_type
 * exactly (migration 0012) — lowercase, because these values travel to the DB
 * unchanged. Display labels live in constants/data.ts.
 */
export type PropertyType = "villa" | "apartment" | "room" | "bnb" | "hotel";

/**
 * The 20 districts of Banadir (Mogadishu). Matches the Postgres enum
 * public.mogadishu_district exactly (migration 0016) — snake_case, because
 * these values travel to the database unchanged. Display labels live in
 * constants/data.ts.
 */
export type District =
  | "abdiaziz"
  | "bondhere"
  | "daynile"
  | "dharkenley"
  | "garasbaaley"
  | "hamar_jajab"
  | "hamar_weyne"
  | "heliwa"
  | "hodan"
  | "howlwadag"
  | "karan"
  | "kaxda"
  | "shangani"
  | "shibis"
  | "waberi"
  | "wadajir"
  | "wardhigley"
  | "yaqshid"
  | "darusalam"
  | "gubadley";

/** Filters accepted by the search_properties RPC. All optional. */
export type PropertyFilters = {
  query?: string;
  /** "all" or undefined means no type filter. */
  type?: PropertyType | "all";
  /**
   * "all" or undefined means no district filter — which still returns
   * listings that have no district at all.
   */
  district?: District | "all";
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
};

/**
 * A window another guest already holds, as ISO yyyy-mm-dd. Deliberately
 * carries no booking id or guest name: get_booked_ranges returns dates without
 * identities so the calendar can grey days out without leaking who took them.
 */
export type BookedRange = { check_in: string; check_out: string };

export type Property = {
  id: string;
  name: string;
  type: PropertyType;
  /** Nullable: listings predating migration 0016 have none, and "not specified" stays valid. */
  district: District | null;
  description: string | null;
  address: string | null;
  geolocation: string | null;
  price: number;
  /** One-time service fee in USD, set by the owner in the form; 0 / null
      means no fee. Shown on the detail page and added to a booking total. */
  service_fee: number | null;
  area: number;
  bedrooms: number;
  bathrooms: number;
  /** Separate living-room count; 0 when the listing has none. */
  living_rooms: number;
  /** Nullable: "not specified" is a real answer, and 0 would claim ground floor. */
  floor_number: number | null;
  rating: number;
  facilities: string[];
  /** Nearby places (e.g. School, Hospital, Supermarket, Mosque) — never a duplicate of a Facility or Amenity. */
  nearby_facilities: string[];
  /** 'monthly' is a fixed monthly rental; 'short_term' is BnB-style nightly. */
  rental_mode: RentalMode;
  image: string | null;
  agent_id: string | null;
  /** Supabase auth user id of the publishing owner; null for seeded rows. */
  owner_id: string | null;
  /**
   * Distinct signed-in viewers who opened this listing, excluding the owner.
   * Denormalised from public.property_views; not null, defaults to 0.
   */
  views_count: number;
  created_at: string;
};

/**
 * A property joined with its gallery images, reviews and amenities.
 *
 * There is deliberately no `agent` here. The old shape joined public.agents,
 * which is world-readable and carries an email address, so every visitor could
 * read the poster's contact details off the listing page. Poster identity is
 * now an admin-only read — see `PropertyPoster` and `getPropertyPoster`.
 */
export type PropertyDetail = Property & {
  galleries: Gallery[];
  reviews: Review[];
  amenities: Amenity[];
};

/**
 * Who published a listing, as an administrator sees them.
 *
 * Deliberately NOT part of PropertyDetail: the listing page is public, and a
 * poster's name, email and phone must never reach a visitor. This shape is
 * produced only by `getPropertyPoster` in lib/adminApi.ts, which is gated on
 * the admin role by RLS.
 */
export type PropertyPoster = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: Role;
  /** From public.profile_contacts — admin-only by RLS. Null when not on file. */
  phone: string | null;
};

/** A single in-unit amenity (elevator, CCTV camera, balcony, security, ...). */
export type Amenity = {
  id: string;
  property_id: string;
  name: string;
  created_at: string;
};

export type Role = "tenant" | "property_owner" | "agency" | "hotel_manager" | "admin";

/**
 * The roles a user may give themselves. 'admin' is deliberately absent: it is
 * granted only in the Supabase dashboard, and migration 0009's update policy
 * rejects any attempt to move to it.
 */
export type SelfAssignableRole = Exclude<Role, "admin">;

export type Profile = {
  id: string; // Supabase auth user id
  email: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: Role;
  /** Government-issued ID type (passport, national_id, driver_license, other). */
  identity_type: string | null;
  /** Government-issued ID number. */
  identity_number: string | null;
  created_at: string;
  updated_at: string;
};

export type BookingStatus = "pending" | "confirmed" | "declined" | "cancelled";

export type PaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "refunded";

export type Booking = {
  id: string;
  property_id: string;
  guest_id: string;
  owner_id: string | null;
  check_in: string;  // YYYY-MM-DD
  check_out: string; // YYYY-MM-DD
  guests: number;
  total_price: number;
  status: BookingStatus;
  /** True for a tour request, not a stay: it must not block the calendar,
      shows as "Tour" in the bookings list, and carries only the $15 tour
      fee (held in escrow), never a rent payment. */
  is_tour: boolean;
  message: string | null;
  payment_status: PaymentStatus;
  sifalo_sid: string | null;
  /** Sifalo order id (booking_<id>_<timestamp>), stored so a pending payment
      can be re-checked later. Null for rows created before migration 0029. */
  sifalo_order_id?: string | null;
  paid_amount: number | null;
  payment_method: string | null;
  created_at: string;
  updated_at: string;
};

/** A booking joined with the property it refers to. */
export type BookingWithProperty = Booking & {
  property: Pick<Property, "id" | "name" | "image" | "address" | "price"> | null;
};

export type NotificationType =
  | "general"
  | "booking_requested"
  | "booking_confirmed"
  | "booking_declined"
  | "booking_cancelled"
  | "marketplace_enquiry";

export type AppNotification = {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  property_id: string | null;
  booking_id: string | null;
  marketplace_item_id: string | null;
  read_at: string | null;
  created_at: string;
};

/* -------------------------------------------------------------- marketplace */

/**
 * Moderation state of a marketplace item. Matches the Postgres enum
 * public.marketplace_status exactly (migration 0017). An item is not public
 * until an admin approves it, and `rejected` carries a `review_note`.
 */
export type MarketplaceStatus = "pending" | "approved" | "rejected";

/** Matches the Postgres enum public.marketplace_condition (migration 0017). */
export type MarketplaceCondition = "new" | "like_new" | "good" | "fair";

/** Matches the Postgres enum public.marketplace_category (migration 0017). */
export type MarketplaceCategory =
  | "sofa"
  | "bed"
  | "table"
  | "chair"
  | "wardrobe"
  | "kitchen"
  | "appliance"
  | "decor"
  | "office"
  | "other";

/**
 * A furniture listing, as any buyer may see it.
 *
 * Note what is NOT here: no phone, no email, no seller contact of any kind.
 * RLS filters rows, not columns, so a contact column on this table would be
 * readable by every authenticated buyer. The seller's phone lives in
 * public.marketplace_contacts, behind a seller-or-admin read policy, and
 * reaches the app only through `getMarketplaceContact` (admins only).
 */
export type MarketplaceItem = {
  id: string;
  /** Supabase auth user id (the `sub` claim) of the seller. */
  seller_id: string;
  title: string;
  description: string | null;
  category: MarketplaceCategory;
  condition: MarketplaceCondition;
  price: number;
  negotiable: boolean;
  /** Nullable: "not specified" is a valid answer, as it is for properties. */
  district: District | null;
  /** 1..8 public URLs from the `marketplace-photos` bucket. */
  images: string[];
  status: MarketplaceStatus;
  /** The admin's reason when rejected; null otherwise. */
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Filters for the marketplace browse screen. All optional. */
export type MarketplaceFilters = {
  query?: string;
  /** "all" or undefined means no category filter. */
  category?: MarketplaceCategory | "all";
  /** "all" or undefined means no condition filter. */
  condition?: MarketplaceCondition | "all";
  /**
   * "all" or undefined means no district filter — which still returns items
   * that have no district at all.
   */
  district?: District | "all";
  minPrice?: number;
  maxPrice?: number;
};

/**
 * A buyer reaching out about an item.
 *
 * `buyer_phone` travels in one direction only: the buyer chose to share it by
 * enquiring, and it is readable by that item's seller and by admins. A seller's
 * own number is never exposed this way — see migration 0019.
 */
export type MarketplaceEnquiry = {
  id: string;
  item_id: string;
  buyer_id: string;
  buyer_phone: string;
  message: string | null;
  created_at: string;
};
