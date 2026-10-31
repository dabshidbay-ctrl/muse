import type {
  District,
  MarketplaceCategory,
  MarketplaceCondition,
  PropertyType,
} from "@/lib/types";

import icons from "./icons";
import images from "./images";

/**
 * The five listing categories, in the order the chip rail renders them.
 *
 * `category` values are the labels of the Postgres enum public.property_type
 * and travel to the database unchanged, so they stay lowercase; only `title` is
 * for humans. "all" is not an enum member — search_properties reads it as
 * "no type filter".
 */
export const categories: { title: string; category: PropertyType | "all" }[] = [
  { title: "All", category: "all" },
  { title: "Villa", category: "villa" },
  { title: "Apartment", category: "apartment" },
  { title: "Room", category: "room" },
  { title: "BnB", category: "bnb" },
  { title: "Hotel", category: "hotel" },
];

/**
 * The 20 districts of Banadir (Mogadishu).
 *
 * `value` is a label of the Postgres enum public.mogadishu_district (migration
 * 0016) and travels to the database unchanged, so it stays snake_case; `label`
 * is the only part meant for humans. Ordered alphabetically by label for the
 * picker. "all" is not an enum member — search_properties reads it as "no
 * district filter", and a property may have no district at all.
 */
export const districts: { value: District; label: string }[] = [
  { value: "abdiaziz", label: "Abdiaziz" },
  { value: "bondhere", label: "Bondhere" },
  { value: "darusalam", label: "Darusalam" },
  { value: "daynile", label: "Daynile" },
  { value: "dharkenley", label: "Dharkenley" },
  { value: "garasbaaley", label: "Garasbaaley" },
  { value: "gubadley", label: "Gubadley" },
  { value: "hamar_jajab", label: "Hamar Jajab" },
  { value: "hamar_weyne", label: "Hamar Weyne" },
  { value: "heliwa", label: "Heliwa" },
  { value: "hodan", label: "Hodan" },
  { value: "howlwadag", label: "Howlwadag" },
  { value: "karan", label: "Karan" },
  { value: "kaxda", label: "Kaxda" },
  { value: "shangani", label: "Shangani" },
  { value: "shibis", label: "Shibis" },
  { value: "waberi", label: "Waberi" },
  { value: "wadajir", label: "Wadajir" },
  { value: "wardhigley", label: "Wardhigley" },
  { value: "yaqshid", label: "Yaqshid" },
];

export const settings = [
  {
    title: "My Bookings",
    icon: icons.calendar,
  },
  {
    title: "Saved properties",
    icon: icons.heart,
  },
  {
    title: "Payments",
    icon: icons.wallet,
  },
  {
    title: "Profile",
    icon: icons.person,
  },
  {
    title: "Notifications",
    icon: icons.bell,
  },
  {
    title: "Security",
    icon: icons.shield,
  },
  {
    title: "Language",
    icon: icons.language,
  },
  {
    title: "Help Center",
    icon: icons.info,
  },
  {
    title: "Invite Friends",
    icon: icons.people,
  },
];

export const facilities = [
  {
    title: "Laundry",
    icon: icons.laundry,
  },
  {
    title: "Car Parking",
    icon: icons.carPark,
  },
  {
    title: "Sports Center",
    icon: icons.run,
  },
  {
    title: "Cutlery",
    icon: icons.cutlery,
  },
  {
    title: "Gym",
    icon: icons.dumbell,
  },
  {
    title: "Swimming pool",
    icon: icons.swim,
  },
  {
    title: "Wifi",
    icon: icons.wifi,
  },
  {
    title: "Pet Center",
    icon: icons.dog,
  },
  // In-unit features that also have a real icon, so they belong here and not
  // in the free-text amenities list (which would show the same item twice on
  // the detail page, once as a tile and once as a pill). This list is the
  // single source of truth: the form offers exactly these, and the detail
  // page builds its icon map from exactly these, so a facility can never
  // fall back to a generic icon on detail.
  {
    title: "Balcony",
    icon: icons.home,
  },
  {
    title: "Security",
    icon: icons.shield,
  },
];

// In-unit amenities an owner can add/remove per property. These are stored in
// the dedicated `amenities` table (not the `facilities` text array).
// Amenities are pills with no icon, so they must not repeat anything that
// already appears as an icon tile under Facilities (Balcony, Security, Car
// Parking) — otherwise the same feature shows twice on the detail page.
export const amenities = [
  "Elevator",
  "CCTV Camera",
  "Air Conditioning",
  "Heating",
  "Furnished",
  "Garden",
  "Roof Terrace",
  "Storage",
  "Intercom",
];

// Nearby facilities / neighbourhood features, stored on the property row.
export const nearbyFacilities = [
  "School",
  "Hospital",
  "Supermarket",
  "Metro Station",
  "Bus Stop",
  "Park",
  "Pharmacy",
  "Bank",
  "Restaurant",
  "Mall",
  "Mosque",
];

export const gallery = [
  {
    id: 1,
    image: images.newYork,
  },
  {
    id: 2,
    image: images.japan,
  },
  {
    id: 3,
    image: images.newYork,
  },
  {
    id: 4,
    image: images.japan,
  },
  {
    id: 5,
    image: images.newYork,
  },
  {
    id: 6,
    image: images.japan,
  },
];


/**
 * Marketplace furniture categories.
 *
 * Same shape as `districts` above: `value` is a label of the Postgres enum
 * public.marketplace_category (migration 0017) and travels to the database
 * unchanged, so it stays lowercase; `label` is the only part meant for humans.
 * "all" is not an enum member — the browse screen reads it as "no category
 * filter" — so it is not listed here.
 */
export const marketplaceCategories: { value: MarketplaceCategory; label: string }[] = [
  { value: "sofa", label: "Sofa" },
  { value: "bed", label: "Bed" },
  { value: "table", label: "Table" },
  { value: "chair", label: "Chair" },
  { value: "wardrobe", label: "Wardrobe" },
  { value: "kitchen", label: "Kitchen" },
  { value: "appliance", label: "Appliance" },
  { value: "decor", label: "Decor" },
  { value: "office", label: "Office" },
  { value: "other", label: "Other" },
];

/**
 * Condition of a marketplace item, best first — the order a seller thinks in.
 * `value` is a label of the Postgres enum public.marketplace_condition
 * (migration 0017); "Like new" is the human rendering of `like_new`.
 */
export const marketplaceConditions: { value: MarketplaceCondition; label: string }[] = [
  { value: "new", label: "New" },
  { value: "like_new", label: "Like new" },
  { value: "good", label: "Good" },
  { value: "fair", label: "Fair" },
];
