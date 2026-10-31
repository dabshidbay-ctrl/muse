import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Modal, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useSession } from "@/lib/useSession";
import { useSupabase } from "@/lib/useSupabase";
import { describeSupabaseError, supabase } from "@/lib/supabase";
import {
  addFavorite,
  createBooking,
  deleteProperty,
  getBookedRanges,
  getFavorites,
  getPropertyById,
  getPropertyPhotos,
  recordPropertyView,
  removeFavorite,
} from "@/lib/api";
import { useProfile } from "@/lib/useProfile";
import { getPropertyPoster } from "@/lib/adminApi";
import { SPACE, shadow, useResponsive } from "@/lib/responsive";
import { EmptyState, IconButton, SectionHeader, Skeleton, Touchable } from "@/components/ui";
import { AvailabilityCalendar, isRangeAvailable } from "@/components/AvailabilityCalendar";
import { PropertyGallery } from "@/components/PropertyGallery";
import { shareProperty } from "@/lib/share";
import icons from "@/constants/icons";
import { districts, facilities as FACILITIES_DATA } from "@/constants/data";
import { captureError } from "@/lib/sentry";
import type { Role } from "@/lib/types";

const money = (n: number) =>
  `$${Number(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/** Human labels for the publisher roles, used by the admin-only poster panel. */
const ROLE_LABEL: Record<Role, string> = {
  tenant: "Tenant",
  property_owner: "Property owner",
  agency: "Agency",
  hotel_manager: "Hotel manager",
  admin: "Administrator",
};

// Single source of truth: the icon map is built from the same facilities
// list the form offers, so form and detail can never drift apart and a
// facility can never fall back to a generic icon. Values from older listings
// that are not in this map are rendered as pills below, never with a wrong
// or generic icon, and nothing is dropped.
const FACILITY_ICONS: Record<string, any> = Object.fromEntries(
  FACILITIES_DATA.map((f) => [f.title, f.icon])
);

function Stat({ icon, value, label }: { icon: any; value: string | number; label: string }) {
  return (
    <View className="flex-1 items-center py-sm rounded-md bg-surface-muted dark:bg-surface-dark-elevated">
      <Image source={icon} style={{ width: 20, height: 20 }} accessible={false} alt="" />
      <Text className="text-body font-rubik-bold text-black-300 dark:text-white mt-2xs">
        {value}
      </Text>
      <Text className="text-caption font-rubik text-black-200 dark:text-white/60">{label}</Text>
    </View>
  );
}

export default function Property() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { heroHeight, gutter, height } = useResponsive();
  const { user } = useSession();

  const { data: property, loading, error } = useSupabase({
    fn: (supabase, params: { id: string }) => getPropertyById(supabase, params.id),
    params: { id: id ?? "" },
    skip: !id,
  });

  const { data: photos } = useSupabase({
    fn: (supabase, params: { propertyId: string }) => getPropertyPhotos(supabase, params),
    params: { propertyId: id ?? "" },
    skip: !id,
  });

  const { data: bookedRanges, refetch: refetchBooked } = useSupabase({
    fn: (supabase, params: { propertyId: string }) => getBookedRanges(supabase, params),
    params: { propertyId: id ?? "" },
    skip: !id,
  });

  // The gallery is the only hero now, so a listing with no gallery rows still
  // has to show its cover image rather than an empty carousel.
  const galleryImages = useMemo(() => {
    if (photos?.length) return photos;
    return property?.image ? [property.image] : [];
  }, [photos, property?.image]);

  const booked = bookedRanges ?? [];

  const [isFavorite, setIsFavorite] = useState(false);
  const [savingFavorite, setSavingFavorite] = useState(false);

  // Reflect whether this property is already saved for the signed-in user.
  useEffect(() => {
    let alive = true;
    if (!user?.id || !id) return;
    getFavorites(supabase, user.id)
      .then((ids) => alive && setIsFavorite(ids.includes(id)))
      .catch((err) => captureError(err, "favourite-load"));
    return () => {
      alive = false;
    };
  }, [user?.id, id]);

  // Records one view per property per mount. A ref rather than state, because
  // re-renders must not fire a second insert and this must not cause one.
  // Owners are skipped here as well as in the database, so their own visit does
  // not even leave the device.
  const recordedViewFor = useRef<string | null>(null);
  useEffect(() => {
    if (!property || !user?.id) return;
    if (recordedViewFor.current === property.id) return;
    if (property.owner_id === user.id) return;
    recordedViewFor.current = property.id;
    // Deliberately not awaited: tracking must never delay or break the page.
    recordPropertyView(supabase, { propertyId: property.id }).catch((err) =>
      captureError(err, "record-view")
    );
  }, [property, user?.id]);

  const toggleFavorite = useCallback(async () => {
    if (!user?.id || !id || savingFavorite) return;
    const next = !isFavorite;
    setSavingFavorite(true);
    setIsFavorite(next); // optimistic
    try {
      if (next) await addFavorite(supabase, user.id, id);
      else await removeFavorite(supabase, user.id, id);
    } catch (err) {
      setIsFavorite(!next); // roll back on failure
      captureError(err, "favourite-toggle");
      Alert.alert("Could not update saved properties", "Please try again.");
    } finally {
      setSavingFavorite(false);
    }
  }, [user?.id, id, isFavorite, savingFavorite]);

  // Shares a link to the property's page on the deployed website, so the
  // recipient opens the listing in a browser instead of a dead app-only URL.
  const onShare = useCallback(() => {
    if (!property) return;
    shareProperty({ id: property.id, name: property.name }).catch((err) =>
      captureError(err, "share-property")
    );
  }, [property]);

  // This screen is reachable by deep link and from a shared URL, so it can be
  // the first entry in the stack — router.back() is a no-op with no history.
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, []);

  const isOwnListing = !!user?.id && !!property?.owner_id && user.id === property.owner_id;
  const { isAdmin } = useProfile();
  const canManage = isOwnListing || isAdmin;

  // Poster identity is fetched separately and only for an admin: the query is
  // gated by RLS on public.profile_contacts, so a non-admin caller would get
  // nothing back anyway. Skipping it entirely keeps a visitor's page from even
  // asking for a phone number.
  const {
    data: poster,
    loading: posterLoading,
    error: posterError,
  } = useSupabase({
    fn: (client, params: { ownerId: string }) => getPropertyPoster(client, params.ownerId),
    params: { ownerId: property?.owner_id ?? "" },
    skip: !isAdmin || !property?.owner_id,
  });

  // Inline confirmation, not Alert.alert: react-native-web ships
  // `static alert() {}`, so on web the dialog never appeared and the callback
  // inside it never ran — deleting a listing was impossible there.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = useCallback(async () => {
    if (!property || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteProperty(supabase, property.id);
      router.replace("/properties/listings");
    } catch (err) {
      captureError(err, "owner-delete-property");
      setDeleteError(describeSupabaseError(err));
    } finally {
      setDeleting(false);
    }
  }, [property, deleting]);

  const [bookingOpen, setBookingOpen] = useState(false);
  const [checkIn, setCheckIn] = useState<string | null>(null);
  const [checkOut, setCheckOut] = useState<string | null>(null);
  const [guestCount, setGuestCount] = useState("1");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  // Success needs to be visible on web too: Alert.alert is `static alert() {}`
  // there, so a sent request produced no feedback at all and read as a failure.
  const [bookingSent, setBookingSent] = useState(false);
  // The id of the booking just created, so the "Pay now" button can navigate
  // to the checkout screen.
  const [lastBookingId, setLastBookingId] = useState<string | null>(null);

  const nights = useMemo(() => {
    const a = Date.parse(`${checkIn}T00:00:00Z`);
    const b = Date.parse(`${checkOut}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
    return Math.max(0, Math.round((b - a) / 86400000));
  }, [checkIn, checkOut]);

  const submitBooking = useCallback(async () => {
    if (!user?.id || !property) return;
    if (!checkIn || !checkOut || nights < 1) {
      setFormError("Pick a check-in and a check-out date on the calendar.");
      return;
    }
    // The grid already refuses overlapping ranges, but availability fetched at
    // mount can be stale by the time Send is pressed.
    if (!isRangeAvailable(booked, checkIn, checkOut)) {
      setFormError("Those dates are no longer available. Please choose others.");
      return;
    }
    const g = Number(guestCount);
    if (!Number.isInteger(g) || g < 1) {
      setFormError("Guests must be a whole number of 1 or more.");
      return;
    }

    setFormError(null);
    setSubmitting(true);
    // A previous "Request sent" must not sit above a new attempt.
    setBookingSent(false);
    setLastBookingId(null);
    try {
      const created = await createBooking(supabase, {
        propertyId: property.id,
        guestId: user.id,
        ownerId: property.owner_id ?? null,
        checkIn,
        checkOut,
        guests: g,
        // Short-term is priced per night; monthly is pro-rated per night.
        totalPrice:
          property.rental_mode === "short_term"
            ? Math.round(Number(property.price) * nights)
            : Math.round((Number(property.price) / 30) * nights),
      });
      setBookingOpen(false);
      setCheckIn(null);
      setCheckOut(null);
      // The dates just requested are taken from now on: leaving the old ranges
      // on screen would invite an immediate double booking.
      void refetchBooked();
      setLastBookingId(created.id);
      setBookingSent(true);
    } catch (err) {
      captureError(err, "booking-create");
      setFormError(describeSupabaseError(err));
    } finally {
      setSubmitting(false);
    }
  }, [user?.id, property, checkIn, checkOut, guestCount, nights, booked, refetchBooked]);

  if (loading) {
    return (
      <View className="flex-1 bg-surface dark:bg-surface-dark">
        <Skeleton className="w-full rounded-none" style={{ height: heroHeight }} />
        <View className="p-lg gap-sm">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-20 w-full" />
        </View>
      </View>
    );
  }

  if (error || !property) {
    return (
      <View className="flex-1 bg-surface dark:bg-surface-dark items-center justify-center">
        <EmptyState
          title={error ? "Could not load this property" : "Property not found"}
          body={error ?? "It may have been removed."}
          tone="error"
        />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-surface dark:bg-surface-dark">
      <ScrollView
        showsVerticalScrollIndicator={false}
        // Bottom inset clears the sticky CTA so content is never hidden behind it.
        contentContainerStyle={{ paddingBottom: 132 + insets.bottom }}
      >
        {/* Mobile-first detail column: photos, buttons and content are all
            capped at 560 wide and centred, on every screen. Before this the
            gallery and the floating buttons stretched across a full desktop
            width, which is what made the page feel wide and uncentred. On a
            phone 560 is wider than the screen, so nothing changes there. */}
        <View
          style={{
            width: "100%",
            maxWidth: 560 + gutter * 2,
            alignSelf: "center",
            paddingHorizontal: gutter,
            paddingTop: 8,
          }}
        >
          <View className="relative overflow-hidden rounded-xl">
            {galleryImages.length ? (
              <PropertyGallery images={galleryImages} height={heroHeight} />
            ) : (
              <View style={{ height: heroHeight }} className="w-full bg-surface-sunken" />
            )}
            {/* Floating controls sit inside the top safe area, never under the notch.
                They now live inside the centred photo card, so back / love /
                share are grouped over the photo instead of spread across the
                whole screen width. */}
            <View
              className="absolute left-lg right-lg flex-row items-center justify-between"
              style={{ top: insets.top + 8 }}
            >
            <IconButton icon={icons.backArrow} label="Go back" onPress={goBack} />
            <View className="flex-row gap-xs">
              {canManage ? (
                <>
                  <IconButton
                    icon={icons.edit}
                    label="Edit this listing"
                    onPress={() => router.push(`/properties/edit?id=${property.id}`)}
                  />
                  <IconButton
                    icon={icons.logout}
                    label="Delete this listing"
                    onPress={() => {
                      setDeleteError(null);
                      setConfirmingDelete(true);
                    }}
                    disabled={deleting}
                    className="bg-danger/15"
                  />
                </>
              ) : null}
              {/* Saved state is red and stays red; unsaved turns red under the
                  pointer so the affordance is visible before the click. */}
              <IconButton
                icon={icons.heart}
                label={isFavorite ? "Remove from saved properties" : "Save this property"}
                // A public visitor has nothing to save yet: send them to
                // sign-in instead of a disabled button that explains nothing.
                onPress={() => {
                  if (!user?.id) router.push("/sign-in");
                  else void toggleFavorite();
                }}
                disabled={savingFavorite}
                tintColor={isFavorite ? "#F75555" : undefined}
                className={`hover-heart ${isFavorite ? "bg-danger/20" : ""}`}
              />
              {/* Tinted rather than plain white: a white disc on a pale hero
                  image reads as a hole in the page, not as a button. */}
              <IconButton
                icon={icons.send}
                label="Share this property"
                onPress={onShare}
                tintColor="#0061FF"
                className="hover-share bg-primary-100"
              />
            </View>
          </View>
        </View>
        </View>

        <View
          style={{
            paddingHorizontal: gutter,
            width: "100%",
            maxWidth: 560,
            alignSelf: "center",
          }}
          // Pull the sheet over the hero for depth (glassmorphism layering).
          className="-mt-lg rounded-t-xl bg-surface dark:bg-surface-dark pt-lg"
        >
          {confirmingDelete ? (
            <View
              accessibilityRole="alert"
              className="rounded-lg border border-danger bg-danger/10 p-md mb-md"
            >
              <Text className="text-body font-rubik-bold text-black-300 dark:text-white">
                Delete “{property.name}”?
              </Text>
              <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
                Its photos, amenities and bookings are deleted with it. This cannot be undone.
              </Text>
              {deleteError ? (
                <Text className="text-caption font-rubik-medium text-danger mt-xs">
                  {deleteError}
                </Text>
              ) : null}
              <View className="flex-row gap-xs mt-md">
                <Touchable
                  onPress={() => setConfirmingDelete(false)}
                  disabled={deleting}
                  accessibilityLabel="Keep this listing"
                  style={{ flex: 1, minHeight: 44 }}
                  className="items-center justify-center rounded-full border border-line dark:border-line-dark"
                >
                  <Text className="text-caption font-rubik-bold text-black-300 dark:text-white">
                    Cancel
                  </Text>
                </Touchable>
                <Touchable
                  onPress={() => void handleDelete()}
                  disabled={deleting}
                  accessibilityLabel="Confirm delete this listing"
                  accessibilityState={{ busy: deleting }}
                  style={{ flex: 1, minHeight: 44 }}
                  className="items-center justify-center rounded-full bg-danger"
                >
                  <Text className="text-caption font-rubik-bold text-white">
                    {deleting ? "Deleting…" : "Delete"}
                  </Text>
                </Touchable>
              </View>
            </View>
          ) : null}
          <View className="flex-row items-center gap-xs">
            <View className="rounded-full bg-primary-100 px-sm py-2xs">
              <Text className="text-caption font-rubik-bold text-primary-300">{property.type}</Text>
            </View>
            <View className="rounded-full bg-surface-muted dark:bg-surface-dark-elevated px-sm py-2xs">
              <Text className="text-caption font-rubik-bold text-black-200 dark:text-white/60">
                {property.rental_mode === "short_term" ? "Short-term (BnB)" : "Monthly rental"}
              </Text>
            </View>
            <View className="flex-row items-center gap-2xs">
              <Image source={icons.star} style={{ width: 16, height: 16 }} accessible={false} alt="" />
              <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
                {property.rating} ({property.reviews?.length ?? 0} reviews)
              </Text>
            </View>
          </View>

          <Text
            accessibilityRole="header"
            className="text-h1 font-rubik-extrabold text-black-300 dark:text-white mt-sm"
          >
            {property.name}
          </Text>
          {property.address ? (
            <Text className="text-body font-rubik text-black-200 dark:text-white/60 mt-2xs">
              {property.address}
            </Text>
          ) : null}
          {/* The district is a form field, so it must show here — previously
              it was saved but never rendered, and only survived inside the
              free-text address. */}
          {property.district ? (
            <View className="flex-row items-center gap-2xs mt-2xs">
              <Image source={icons.location} style={{ width: 16, height: 16 }} accessible={false} alt="" />
              <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
                {districts.find((d) => d.value === property.district)?.label ?? property.district}, Mogadishu
              </Text>
            </View>
          ) : null}

          {/* Square footage is deliberately not shown: renters here compare
              rooms and features, and an area figure that owners estimate by eye
              reads as a promise the platform cannot keep. */}
          <View className="flex-row gap-xs mt-lg">
            <Stat icon={icons.bed} value={property.bedrooms} label="Beds" />
            <Stat icon={icons.bath} value={property.bathrooms} label="Toilets" />
            {/* A 0 here usually means "unknown" (older rows, or a database
                without the living_rooms column), not a home with no living
                space — showing "0 Living" reads as a broken listing, so the
                stat is omitted until a real count exists. */}
            {(property.living_rooms ?? 0) > 0 ? (
              <Stat icon={icons.home} value={property.living_rooms ?? 0} label="Living" />
            ) : null}
          </View>

          {property.floor_number !== null && property.floor_number !== undefined ? (
            <View className="flex-row items-center gap-xs mt-sm">
              <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
                Floor
              </Text>
              <Text className="text-caption font-rubik-bold text-black-300 dark:text-white">
                {property.floor_number === 0 ? "Ground floor" : property.floor_number}
              </Text>
            </View>
          ) : null}

          {/* Listing performance belongs to whoever manages the listing, so it
              is never rendered for ordinary visitors. The count is distinct
              viewers (the owner's own visits excluded), not total opens — the
              wording has to match what 0008_property_views.sql actually counts. */}
          {canManage ? (
            <View className="flex-row items-center gap-xs mt-sm px-md py-sm rounded-md bg-surface-muted dark:bg-surface-dark-elevated">
              <Image source={icons.people} style={{ width: 16, height: 16 }} accessible={false} alt="" />
              <Text className="text-caption font-rubik-bold text-black-300 dark:text-white">
                {property.views_count ?? 0}{" "}
                {(property.views_count ?? 0) === 1 ? "viewer" : "viewers"}
              </Text>
              <Text className="flex-1 text-caption font-rubik text-black-200 dark:text-white/60">
                Only you can see this
              </Text>
            </View>
          ) : null}

          {/* Who posted this listing is an administrator-only fact.
              A visitor sees no name, no email and no phone — contact happens
              through the booking request, which the platform mediates. The
              panel below is rendered only for an admin, and the data behind it
              is fetched from an admin-gated query, so hiding the UI is not the
              only thing standing between a visitor and the number. */}
          {isAdmin ? (
            <>
              <SectionHeader title="Posted by (admin only)" />
              <View className="p-md rounded-lg border border-warning/40 bg-warning/10">
                {posterLoading ? (
                  <Skeleton className="h-12 w-full" />
                ) : poster ? (
                  <View className="flex-row items-center gap-md">
                    <View className="size-12 rounded-full bg-primary-200 items-center justify-center">
                      <Text className="text-body font-rubik-bold text-primary-300">
                        {(poster.full_name ?? poster.email ?? "?").slice(0, 1).toUpperCase()}
                      </Text>
                    </View>
                    <View className="flex-1">
                      <Text className="text-body font-rubik-bold text-black-300 dark:text-white">
                        {poster.full_name ?? "Unnamed publisher"}
                      </Text>
                      <Text
                        numberOfLines={1}
                        className="text-caption font-rubik text-black-200 dark:text-white/60"
                      >
                        {poster.email ?? "No email on file"} · {ROLE_LABEL[poster.role]}
                      </Text>
                      <Text
                        selectable
                        className="text-caption font-rubik-bold text-black-300 dark:text-white mt-2xs"
                      >
                        {poster.phone ?? "No phone number on file"}
                      </Text>
                    </View>
                  </View>
                ) : (
                  <Text className="text-caption font-rubik text-black-200 dark:text-white/60">
                    {posterError ?? "This listing has no publisher account."}
                  </Text>
                )}
                <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-xs">
                  Visible to administrators only. Visitors never see this.
                </Text>
              </View>
            </>
          ) : null}

          {property.description ? (
            <>
              <SectionHeader title="Overview" />
              <Text className="text-body font-rubik text-black-200 dark:text-white/70">
                {property.description}
              </Text>
            </>
          ) : null}

          {(() => {
            // Dedupe at render time: a value must never appear twice on the
            // page, even if an older listing stored it in two places.
            const uniqueFacilities = [...new Set(property.facilities ?? [])];
            const iconFacilities = uniqueFacilities.filter((f) => FACILITY_ICONS[f]);
            const extraFacilities = uniqueFacilities.filter((f) => !FACILITY_ICONS[f]);
            const uniqueAmenities = [
              ...new Map(
                (property.amenities ?? []).map((a) => [a.name.toLowerCase(), a])
              ).values(),
            ];
            const uniqueNearby = [...new Set(property.nearby_facilities ?? [])];
            return (
              <>
                {uniqueFacilities.length ? (
                  <>
                    <SectionHeader title="Facilities" />
                    <View className="flex-row flex-wrap gap-md">
                      {iconFacilities.map((f) => (
                        <View key={f} className="items-center w-20">
                          <View className="size-14 rounded-full bg-surface-muted dark:bg-surface-dark-elevated items-center justify-center">
                            <Image
                              source={FACILITY_ICONS[f]}
                              style={{ width: 24, height: 24 }}
                              accessible={false}
                              alt=""
                            />
                          </View>
                          <Text
                            numberOfLines={2}
                            className="text-caption font-rubik text-black-200 dark:text-white/60 text-center mt-2xs"
                          >
                            {f}
                          </Text>
                        </View>
                      ))}
                    </View>
                    {extraFacilities.length ? (
                      <View className="flex-row flex-wrap gap-xs mt-md">
                        {extraFacilities.map((f) => (
                          <View
                            key={f}
                            className="rounded-full bg-surface-muted dark:bg-surface-dark-elevated px-sm py-2xs"
                          >
                            <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
                              {f}
                            </Text>
                          </View>
                        ))}
                      </View>
                    ) : null}
                  </>
                ) : null}

                {uniqueAmenities.length ? (
                  <>
                    <SectionHeader title="Amenities" />
                    <View className="flex-row flex-wrap gap-xs">
                      {uniqueAmenities.map((a) => (
                        <View
                          key={a.id}
                          className="rounded-full bg-primary-100 px-sm py-2xs"
                        >
                          <Text className="text-caption font-rubik-medium text-primary-300">
                            {a.name}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                ) : null}

                {uniqueNearby.length ? (
                  <>
                    <SectionHeader title="Nearby facilities" />
                    <View className="flex-row flex-wrap gap-xs">
                      {uniqueNearby.map((n) => (
                        <View
                          key={n}
                          className="rounded-full bg-surface-muted dark:bg-surface-dark-elevated px-sm py-2xs"
                        >
                          <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
                            {n}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </>
                ) : null}
              </>
            );
          })()}

          {property.reviews?.length ? (
            <>
              <SectionHeader title={`Reviews (${property.reviews.length})`} />
              {property.reviews.map((review) => (
                <View
                  key={review.id}
                  className="p-md rounded-lg bg-surface-muted dark:bg-surface-dark-muted mb-sm"
                >
                  <View className="flex-row items-center gap-sm">
                    {review.avatar ? (
                      <Image
                        source={{ uri: review.avatar }}
                        style={{ width: 40, height: 40 }}
                        className="rounded-full"
                        accessible={false}
                        alt=""
                      />
                    ) : (
                      <View className="size-10 rounded-full bg-primary-200" />
                    )}
                    <Text className="flex-1 text-body font-rubik-bold text-black-300 dark:text-white">
                      {review.name}
                    </Text>
                    <View className="flex-row items-center gap-2xs">
                      <Image source={icons.star} style={{ width: 16, height: 16 }} accessible={false} alt="" />
                      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
                        {review.rating}
                      </Text>
                    </View>
                  </View>
                  <Text className="text-body font-rubik text-black-200 dark:text-white/70 mt-xs">
                    {review.review}
                  </Text>
                </View>
              ))}
            </>
          ) : null}
        </View>
      </ScrollView>

      {/* Sticky booking bar — one primary CTA, inside the bottom safe area. */}
      <View
        className="absolute left-0 right-0 bottom-0 border-t border-line dark:border-line-dark bg-surface dark:bg-surface-dark"
        style={{ paddingBottom: insets.bottom + 12, paddingTop: 12, paddingHorizontal: gutter }}
      >
        <View
          className="flex-row items-center justify-between gap-md"
          style={{ width: "100%", maxWidth: 560, alignSelf: "center" }}
        >
          <View>
            <Text className="text-caption font-rubik text-black-200 dark:text-white/60 uppercase">
              {property.rental_mode === "short_term" ? "Per night" : "Per month"}
            </Text>
            <Text className="text-h2 font-rubik-extrabold text-primary-300">
              {money(property.price)}
            </Text>
          </View>
          <Touchable
            onPress={() => {
              // Booking needs an account, and the submit handler silently
              // returns without one — so a public visitor is sent to
              // sign-in here, instead of opening a form that can never send.
              if (!user?.id) {
                router.push("/sign-in");
                return;
              }
              setBookingSent(false);
              setBookingOpen(true);
            }}
            disabled={isOwnListing}
            accessibilityLabel={
              isOwnListing ? "You cannot rent your own listing" : `${property.rental_mode === "monthly" ? "Rent" : "Book"} ${property.name}`
            }
            accessibilityHint={isOwnListing ? undefined : user?.id ? "Opens the booking request form" : "Sign in to send a booking request"}
            accessibilityState={{ disabled: isOwnListing }}
            className="items-center justify-center rounded-full bg-primary-300 py-md"
            // Narrow, centred button — not a full-width bar button. The bar
            // itself is capped at the 560 detail column, and this button is
            // a fixed 180 wide inside it.
            style={{
              width: 180,
              ...shadow({ opacity: 0.3, radius: 12, offsetY: 6, elevation: 4 }),
            }}
          >
            <Text className="text-body font-rubik-bold text-white">
              {isOwnListing ? "Your listing" : !user?.id ? "Sign in to book" : property.rental_mode === "monthly" ? "Rent now" : "Book now"}
            </Text>
          </Touchable>
        </View>
      </View>

      {/* Booking request sheet */}
      <Modal
        visible={bookingOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setBookingOpen(false)}
      >
        <View className="flex-1 justify-end bg-black/40">
          <ScrollView
            // The calendar makes the sheet taller than a phone screen, so the
            // Send button has to stay reachable rather than sit off-canvas.
            // Squeezed to the same 560 detail column, centred — before this
            // the sheet and its calendar stretched across a full desktop width.
            style={{ maxHeight: height * 0.9 }}
            contentContainerStyle={{
              paddingBottom: insets.bottom + 24,
              paddingHorizontal: gutter,
              width: "100%",
              maxWidth: 560,
              alignSelf: "center",
            }}
            className="rounded-t-2xl bg-surface dark:bg-surface-dark pt-lg"
            showsVerticalScrollIndicator={false}
          >
            <View className="flex-row items-center justify-between">
              <Text
                accessibilityRole="header"
                className="text-h3 font-rubik-bold text-black-300 dark:text-white"
              >
                {property.rental_mode === "monthly" ? "Request to rent" : "Request to book"}
              </Text>
              <IconButton
                icon={icons.backArrow}
                label="Close booking form"
                onPress={() => setBookingOpen(false)}
              />
            </View>

            <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
              {property.name}
            </Text>

            <View className="mt-lg">
              <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-xs">
                {checkIn && checkOut
                  ? `${checkIn} to ${checkOut}`
                  : checkIn
                    ? `Check-in ${checkIn} — now pick a check-out`
                    : "Pick your check-in date"}
              </Text>
              <AvailabilityCalendar
                booked={booked}
                checkIn={checkIn}
                checkOut={checkOut}
                onChange={(next) => {
                  setCheckIn(next.checkIn);
                  setCheckOut(next.checkOut);
                  setFormError(null);
                }}
              />
            </View>

            <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mt-md mb-2xs">
              Guests
            </Text>
            <TextInput
              value={guestCount}
              onChangeText={setGuestCount}
              keyboardType="numeric"
              accessibilityLabel="Number of guests"
              className="rounded-full border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md py-sm text-body font-rubik text-black-300 dark:text-white"
            />

            {nights > 0 ? (
              <View className="flex-row items-center justify-between mt-lg p-md rounded-lg bg-surface-muted dark:bg-surface-dark-elevated">
                <Text className="text-body font-rubik text-black-200 dark:text-white/70">
                  {nights} night{nights === 1 ? "" : "s"}
                </Text>
                <Text className="text-body font-rubik-extrabold text-primary-300">
                  {money(
                    property.rental_mode === "short_term"
                      ? Math.round(Number(property.price) * nights)
                      : Math.round((Number(property.price) / 30) * nights)
                  )}
                </Text>
              </View>
            ) : null}

            {bookingSent ? (
              <View
                accessibilityLiveRegion="polite"
                className="rounded-lg border border-success bg-success/10 p-md mb-md"
              >
                <Text className="text-caption font-rubik-bold text-success">Request sent</Text>
                <Text className="text-caption font-rubik text-black-200 dark:text-white/60 mt-2xs">
                  {property.rental_mode === "monthly"
                    ? "The owner has been notified and will confirm or decline."
                    : "The owner has been notified and will confirm or decline."}
                </Text>
                <View className="flex-row gap-xs mt-sm">
                  <Touchable
                    onPress={() => router.push("/bookings")}
                    accessibilityLabel={`View my ${property.rental_mode === "monthly" ? "rentals" : "bookings"}`}
                    style={{ flex: 1, minHeight: 44 }}
                    className="items-center justify-center rounded-full border border-success"
                  >
                    <Text className="text-caption font-rubik-bold text-success">
                      View
                    </Text>
                  </Touchable>
                  {lastBookingId ? (
                    <Touchable
                      onPress={() =>
                        router.push(
                          `/checkout?bookingId=${lastBookingId}&amount=${encodeURIComponent(
                            String(
                              property.rental_mode === "short_term"
                                ? Math.round(Number(property.price) * nights)
                                : Math.round((Number(property.price) / 30) * nights)
                            )
                          )}`
                        )
                      }
                      accessibilityLabel="Pay now"
                      style={{ flex: 1, minHeight: 44 }}
                      className="items-center justify-center rounded-full bg-primary-300"
                    >
                      <Text className="text-caption font-rubik-bold text-white">Pay now</Text>
                    </Touchable>
                  ) : null}
                </View>
              </View>
            ) : null}

            {formError ? (
              <Text
                accessibilityLiveRegion="polite"
                className="text-caption font-rubik-medium text-danger mt-md"
              >
                {formError}
              </Text>
            ) : null}

            <Touchable
              onPress={submitBooking}
              disabled={submitting}
              accessibilityLabel={`Send ${property.rental_mode === "monthly" ? "rent" : "booking"} request`}
              accessibilityState={{ disabled: submitting, busy: submitting }}
              // Narrow, centred send button — same rule as the booking bar.
              style={{ minHeight: 52, marginTop: SPACE.lg, width: 240, alignSelf: "center" }}
              className="items-center justify-center rounded-full bg-primary-300"
            >
              <Text className="text-body font-rubik-bold text-white">
                {submitting ? "Sending…" : property.rental_mode === "monthly" ? "Send rent request" : "Send request"}
              </Text>
            </Touchable>
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}
