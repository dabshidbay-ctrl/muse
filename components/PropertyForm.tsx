import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSession } from "@/lib/useSession";
import { supabase } from "@/lib/supabase";
import {
  createProperty,
  getPropertyPhotos,
  replaceAmenities,
  replacePropertyPhotos,
  updateProperty,
  uploadPropertyPhoto,
} from "@/lib/api";
import { MIN_TAP, useResponsive } from "@/lib/responsive";
import { Chip, Touchable } from "@/components/ui";
import { DistrictSelect, type DistrictValue } from "@/components/Filters";
import { Stepper } from "@/components/Stepper";
import { MAX_PHOTOS, MIN_PHOTOS, PhotoPicker, type PhotoUpload } from "@/components/PhotoPicker";
import { amenities as AMENITIES, categories, facilities as FACILITIES, nearbyFacilities as NEARBY } from "@/constants/data";
import type { Property, PropertyType, RentalMode } from "@/lib/types";
import { captureError } from "@/lib/sentry";

// 'All' is a filter, not a real property type. Compared case-insensitively so
// this keeps working across the "All" -> "all" category rename.
const TYPES = categories.filter(
  (c): c is { title: string; category: PropertyType } =>
    String(c.category).toLowerCase() !== "all"
);

const isRemote = (uri: string) => /^https?:\/\//i.test(uri);

/**
 * The in-unit features a renter filters on, in the order they matter.
 *
 * These are stored in `properties.facilities` (a text[] on the row) rather than
 * in the free-form amenities table, because they are a fixed, comparable set:
 * "does this flat have a lift" is a yes/no question across every listing, while
 * amenities are whatever the owner wants to mention. Keeping them here means
 * the detail page can render them with icons and a search can rely on them.
 */
const FEATURES = ["Balcony", "Elevator", "CCTV Camera", "Security"] as const;

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  multiline = false,
  error,
  hint,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric";
  multiline?: boolean;
  error?: string;
  hint?: string;
}) {
  return (
    <View className="mt-md">
      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
        {label}
      </Text>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#8C8E98"
        keyboardType={keyboardType}
        multiline={multiline}
        accessibilityLabel={label}
        accessibilityHint={hint}
        className={`rounded-md border px-md py-sm text-body font-rubik bg-surface dark:bg-surface-dark-muted text-black-300 dark:text-white ${
          error ? "border-danger" : "border-line dark:border-line-dark"
        }`}
        style={multiline ? { minHeight: 96, textAlignVertical: "top" } : undefined}
      />
      {error ? (
        <Text className="text-caption font-rubik-medium text-danger mt-2xs">{error}</Text>
      ) : hint ? (
        <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

function ChipGroup({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <View className="mt-md">
      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
        {label}
      </Text>
      <View className="flex-row flex-wrap gap-xs">
        {options.map((o) => (
          <Chip
            key={o}
            label={o}
            purpose={label}
            selected={selected.includes(o)}
            onPress={() => onToggle(o)}
          />
        ))}
      </View>
    </View>
  );
}

export default function PropertyForm({
  initial,
  initialAmenities,
  isAgency,
  onSaved,
}: {
  /** When provided, the form edits this property; otherwise it creates one. */
  initial?: Property | null;
  /** Existing amenity names, used when editing. */
  initialAmenities?: string[];
  /** Agencies are restricted to monthly rental. */
  isAgency?: boolean;
  /** Called with the saved property id after create/update. */
  onSaved?: (id: string) => void;
}) {
  const { user } = useSession();
  const { gutter, maxContentWidth } = useResponsive();

  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<PropertyType>(initial?.type ?? TYPES[0].category);
  const [address, setAddress] = useState(initial?.address ?? "");
  // Nullable in the database, and listings published before districts existed
  // have none — so "not specified" has to stay a real, selectable state.
  const [district, setDistrict] = useState<DistrictValue | null>(
    (initial?.district as DistrictValue | null | undefined) ?? null
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [price, setPrice] = useState(initial ? String(initial.price) : "");
  // Bedrooms/bathrooms are small bounded counts, so they are held as numbers and
  // chosen with a Stepper — there is no invalid intermediate state to validate.
  const [bedrooms, setBedrooms] = useState<number>(initial?.bedrooms ?? 1);
  // "Toilets" is the label renters use; the column is `bathrooms`.
  const [bathrooms, setBathrooms] = useState<number>(initial?.bathrooms ?? 1);
  const [livingRooms, setLivingRooms] = useState<number>(initial?.living_rooms ?? 1);
  // Held as a string so the field can be empty ("not specified") rather than
  // forcing a 0 that would claim ground floor.
  const [floorNumber, setFloorNumber] = useState<string>(
    initial?.floor_number === null || initial?.floor_number === undefined
      ? ""
      : String(initial.floor_number)
  );
  const [photos, setPhotos] = useState<string[]>(initial?.image ? [initial.image] : []);
  const [uploads, setUploads] = useState<Record<string, PhotoUpload>>({});
  const [rentalMode, setRentalMode] = useState<RentalMode>(
    initial?.rental_mode ?? "monthly"
  );
  const [picked, setPicked] = useState<string[]>(initial?.facilities ?? []);
  const [nearby, setNearby] = useState<string[]>(initial?.nearby_facilities ?? []);
  const [amenityInput, setAmenityInput] = useState("");
  const [amenityNote, setAmenityNote] = useState<string | null>(null);
  const [amenities, setAmenities] = useState<string[]>(initialAmenities ?? []);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  /**
   * Set once a create has succeeded. A later press (for example to retry photo
   * uploads that failed) must update that row rather than insert a duplicate.
   */
  const [createdId, setCreatedId] = useState<string | null>(null);

  const editingId = initial?.id ?? createdId;

  // The gallery is a separate table, and callers only hand over the property
  // row, so the existing photos are fetched here. Without this an edit would
  // start with an empty picker and wipe the gallery on save.
  useEffect(() => {
    if (!initial?.id) return;
    let alive = true;
    getPropertyPhotos(supabase, { propertyId: initial.id })
      .then((urls) => {
        if (!alive || urls.length === 0) return;
        setPhotos(urls);
      })
      .catch((e) => captureError(e, "photos-load"));
    return () => {
      alive = false;
    };
  }, [initial?.id]);

  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Give the listing a name.";
    if (!Number.isFinite(num(price)) || num(price) <= 0) e.price = "Enter a price above 0.";
    // Optional, but not free-form: a negative or fractional floor is not a
    // floor, and silently dropping it would save a listing that disagrees with
    // what the owner typed.
    if (floorNumber.trim() !== "") {
      const f = Number(floorNumber);
      if (!Number.isInteger(f) || f < 0) e.floorNumber = "Enter a whole floor number, or leave it blank.";
    }
    if (photos.length < MIN_PHOTOS)
      e.photos = `Add at least ${MIN_PHOTOS} photos — ${photos.length} so far.`;
    if (photos.length > MAX_PHOTOS) e.photos = `Remove some photos — the limit is ${MAX_PHOTOS}.`;
    return e;
  }, [name, price, floorNumber, photos.length]);

  const valid = Object.keys(errors).length === 0;

  const addAmenity = () => {
    const value = amenityInput.trim();
    // Both cases used to clear the box and do nothing else, which read as the
    // Add button being broken.
    if (!value) {
      setAmenityNote("Type an amenity first.");
      return;
    }
    if (amenities.some((a) => a.toLowerCase() === value.toLowerCase())) {
      setAmenityNote(`“${value}” is already on the list.`);
      return;
    }
    setAmenities((a) => [...a, value]);
    setAmenityInput("");
    setAmenityNote(null);
  };

  const removeAmenity = (value: string) => {
    setAmenities((a) => a.filter((x) => x !== value));
    setAmenityNote(null);
  };

  /**
   * Uploads every local uri and returns the public URLs, in picked order.
   * Failures are reported per photo instead of aborting: eleven good photos
   * should still be saved when the twelfth times out.
   */
  const uploadPhotos = async (propertyId: string) => {
    const urls: string[] = [];
    let failures = 0;
    for (const uri of photos) {
      if (isRemote(uri)) {
        urls.push(uri);
        continue;
      }
      setUploads((u) => ({ ...u, [uri]: { state: "uploading" } }));
      try {
        urls.push(await uploadPropertyPhoto(supabase, { propertyId, uri }));
        setUploads((u) => {
          const next = { ...u };
          delete next[uri];
          return next;
        });
      } catch (e) {
        captureError(e, "photo-upload");
        failures += 1;
        setUploads((u) => ({
          ...u,
          [uri]: { state: "error", message: "Upload failed — save again to retry." },
        }));
      }
    }
    return { urls, failures };
  };

  const submit = async () => {
    // `saving` disables the button, but a double tap can land in the same frame
    // as the first press, before the disabled state has rendered.
    if (saving) return;
    setSubmitted(true);
    if (!valid) return;
    // Separate from the validation gate: the form is filled in correctly, so
    // no field error would explain the press doing nothing.
    if (!user?.id) {
      Alert.alert(
        "You are signed out",
        "Sign in again to publish a listing — your session expired while this form was open."
      );
      return;
    }
    setSaving(true);
    try {
      const common = {
        name: name.trim(),
        type,
        price: num(price),
        // The column is NOT NULL with a default, and nothing in the app shows
        // it, so it is written as 0 rather than asked for.
        area: 0,
        bedrooms,
        bathrooms,
        livingRooms,
        floorNumber: floorNumber.trim() === "" ? null : Number(floorNumber),
        facilities: picked,
        nearbyFacilities: nearby,
        rentalMode,
      };
      // Emptying an optional field has to go out as an explicit null on update:
      // `undefined` makes updateProperty skip that column, so clearing the
      // address or description silently kept the old value.
      const saved = editingId
        ? await updateProperty(supabase, editingId, {
            ...common,
            description: description.trim() || null,
            address: address.trim() || null,
            // Explicit null, like the other optional fields: `undefined` would
            // make updateProperty skip the column and silently keep the old
            // district after the owner cleared it.
            district,
          })
        : await createProperty(supabase, {
            ownerId: user.id,
            ...common,
            description: description.trim() || undefined,
            address: address.trim() || undefined,
            district,
          });
      // Remembered before the photo work below, so a failure there cannot make
      // the next press insert a second listing.
      if (!editingId) setCreatedId(saved.id);

      // Photos need the property id, so they can only be uploaded now. The
      // cover column mirrors photo 1 because cards and search results read it.
      const { urls, failures } = await uploadPhotos(saved.id);
      let photoError: string | null = null;
      try {
        await replacePropertyPhotos(supabase, { propertyId: saved.id, urls });
        await updateProperty(supabase, saved.id, { image: urls[0] ?? null });
      } catch (e) {
        captureError(e, "photos-save");
        photoError = "The listing is saved, but its photos were not. Open it to try again.";
      }
      if (!photoError && failures > 0) {
        photoError = `${failures} photo${failures > 1 ? "s" : ""} failed to upload. The listing is saved — press Save again to retry just those.`;
      }

      // Amenities live in their own table and can fail on their own. The
      // listing is saved by this point, so reporting a failed save would push
      // the user to submit again and publish a duplicate.
      let amenityError: string | null = null;
      try {
        await replaceAmenities(supabase, { propertyId: saved.id, names: amenities });
      } catch (e) {
        captureError(e, "amenities-save");
        amenityError =
          "The listing itself is saved. Open it from My listings to set its amenities again.";
      }

      if (photoError || amenityError) {
        Alert.alert(
          "Listing saved, with problems",
          [photoError, amenityError].filter(Boolean).join("\n\n")
        );
        // Deliberately no navigation: leaving the form open is what makes the
        // retry above possible.
        return;
      }

      onSaved?.(saved.id);
      if (!initial) router.replace(`/properties/${saved.id}`);
    } catch (err) {
      captureError(err, "listing-save");
      Alert.alert(
        initial ? "Could not save changes" : "Could not publish listing",
        err instanceof Error ? err.message : "Please try again."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: gutter,
        paddingBottom: 64,
        width: "100%",
        maxWidth: maxContentWidth,
        alignSelf: "center",
      }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <Field
        label="Listing name"
        value={name}
        onChangeText={setName}
        placeholder="Modernica Apartment"
        error={submitted ? errors.name : undefined}
      />

      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mt-md mb-2xs">
        Property type
      </Text>
      <View className="flex-row flex-wrap gap-xs">
        {TYPES.map((t) => (
          <Chip
            key={t.category}
            label={t.title}
            purpose="Property type"
            selected={type === t.category}
            onPress={() => setType(t.category)}
          />
        ))}
      </View>

      {/* Rental mode — agencies are locked to monthly. */}
      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mt-md mb-2xs">
        Rental mode
      </Text>
      <View className="flex-row flex-wrap gap-xs">
        <Chip
          label="Monthly"
          purpose="Rental mode"
          selected={rentalMode === "monthly"}
          onPress={() => setRentalMode("monthly")}
        />
        {/* Omitted rather than rendered inert: a chip that looks selectable but
            silently ignores the tap is worse than not offering the option. */}
        {!isAgency && (
          <Chip
            label="Short-term (BnB)"
            purpose="Rental mode"
            selected={rentalMode === "short_term"}
            onPress={() => setRentalMode("short_term")}
          />
        )}
      </View>
      {isAgency ? (
        <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
          Agency listings are monthly rental only.
        </Text>
      ) : null}

      <PhotoPicker
        value={photos}
        onChange={setPhotos}
        disabled={saving}
        uploads={uploads}
        error={submitted ? errors.photos : undefined}
      />

      <Field
        label="Address"
        value={address}
        onChangeText={setAddress}
        placeholder="224 Brooklyn Ave, New York"
      />

      <View className="mt-md">
        <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
          District
        </Text>
        {/* The same searchable sheet the Explore filter uses: 20 Banadir
            districts do not fit a Chip row, and matching the control renters
            search with keeps the two lists visibly identical. */}
        <DistrictSelect
          value={district}
          onChange={setDistrict}
          anyLabel="Not specified"
          purpose="District"
          disabled={saving}
        />
        {/* Optional, but not free: `search_properties` filters on the column, so
            an unset district is invisible to every district search. Alert is a
            no-op on web, so the consequence is stated inline instead. */}
        <Text
          accessibilityLiveRegion="polite"
          className={`text-caption font-rubik mt-2xs ${
            district ? "text-black-100 dark:text-white/40" : "text-warning"
          }`}
        >
          {district
            ? "Renters filtering by this district will see the listing."
            : "Optional — but renters filtering by district will not see this listing."}
        </Text>
      </View>
      <Field
        // The listing is billed by the rental mode, so a fixed "per month"
        // label lies for short-term listings.
        label={rentalMode === "short_term" ? "Price per night (USD)" : "Price per month (USD)"}
        value={price}
        onChangeText={setPrice}
        placeholder={rentalMode === "short_term" ? "120" : "1600"}
        keyboardType="numeric"
        error={submitted ? errors.price : undefined}
      />
      {/* No area field: square footage is not shown anywhere in the app, so
          asking for it would be a number the owner types and nobody reads. The
          column stays (it is NOT NULL with a default) and is written as 0. */}

      {/* Room counts. "Toilets" is the word renters use for bathrooms, and
          living rooms are counted separately from bedrooms because a 2-bed
          flat with a salon is a different proposition from a 2-bed with none. */}
      <View className="flex-row gap-sm">
        <View className="flex-1">
          <Stepper label="Bedrooms" value={bedrooms} onChange={setBedrooms} min={0} max={20} />
        </View>
        <View className="flex-1">
          <Stepper label="Toilets" value={bathrooms} onChange={setBathrooms} min={0} max={20} />
        </View>
      </View>

      <View className="flex-row gap-sm">
        <View className="flex-1">
          <Stepper
            label="Living rooms"
            value={livingRooms}
            onChange={setLivingRooms}
            min={0}
            max={10}
          />
        </View>
        <View className="flex-1">
          <Field
            label="Floor number"
            value={floorNumber}
            onChangeText={setFloorNumber}
            placeholder="e.g. 3"
            keyboardType="numeric"
            error={submitted ? errors.floorNumber : undefined}
            hint="Leave blank if it does not apply."
          />
        </View>
      </View>

      {/* The four features renters actually filter on. Stored on the row's
          `facilities` array so the detail page can render them with icons. */}
      <ChipGroup
        label="Features"
        options={[...FEATURES]}
        selected={picked}
        onToggle={(v) =>
          setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))
        }
      />

      <ChipGroup
        label="Facilities"
        options={FACILITIES.map((f) => f.title)}
        selected={picked}
        onToggle={(v) =>
          setPicked((p) => (p.includes(v) ? p.filter((x) => x !== v) : [...p, v]))
        }
      />

      <ChipGroup
        label="Nearby facilities"
        options={NEARBY}
        selected={nearby}
        onToggle={(v) =>
          setNearby((n) => (n.includes(v) ? n.filter((x) => x !== v) : [...n, v]))
        }
      />

      {/* Amenities — addable and deleteable per property. */}
      <View className="mt-md">
        <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
          Amenities
        </Text>
        <View className="flex-row items-stretch gap-xs">
          <TextInput
            value={amenityInput}
            onChangeText={(v) => {
              setAmenityInput(v);
              setAmenityNote(null);
            }}
            onSubmitEditing={addAmenity}
            returnKeyType="done"
            placeholder="e.g. Elevator, CCTV Camera, Balcony"
            placeholderTextColor="#8C8E98"
            accessibilityLabel="New amenity"
            className="flex-1 rounded-md border border-line dark:border-line-dark bg-surface dark:bg-surface-dark-muted px-md py-sm text-body font-rubik text-black-300 dark:text-white"
          />
          {/* Touchable applies className to an inner view and style to the
              outer Pressable, so the outer one carries the row sizing —
              otherwise the filled background is shorter than the input. */}
          <Touchable
            onPress={addAmenity}
            accessibilityLabel="Add amenity"
            style={{ alignSelf: "stretch", minWidth: MIN_TAP }}
            className="items-center justify-center rounded-md bg-primary-300 px-md"
          >
            <Text className="text-body font-rubik-bold text-white">Add</Text>
          </Touchable>
        </View>
        {amenityNote ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-caption font-rubik-medium text-danger mt-2xs"
          >
            {amenityNote}
          </Text>
        ) : null}
        <View className="flex-row flex-wrap gap-xs mt-xs">
          {AMENITIES.map((a) => (
            <Chip
              key={a}
              label={a}
              purpose="Amenity suggestion"
              selected={amenities.includes(a)}
              onPress={() =>
                amenities.includes(a) ? removeAmenity(a) : setAmenities((x) => [...x, a])
              }
            />
          ))}
        </View>
        {amenities.length ? (
          <View className="flex-row flex-wrap gap-xs mt-sm">
            {amenities.map((a) => (
              /* The whole pill removes the amenity. The previous inner icon
                 button rendered a back arrow that never rotated — Touchable
                 sets `transform` inline for the press scale, which overrides
                 the `rotate-45` class — and its 44pt tap target dwarfed the
                 pill. Tapping the pill itself is the target instead. */
              <Touchable
                key={a}
                onPress={() => removeAmenity(a)}
                accessibilityLabel={`Remove ${a}`}
                accessibilityHint="Removes this amenity from the listing"
                style={{ minHeight: MIN_TAP }}
                className="flex-row items-center justify-center gap-2xs rounded-full bg-primary-100 px-md"
              >
                <Text className="text-caption font-rubik-medium text-primary-300">{a}</Text>
                <Text className="text-caption font-rubik-bold text-primary-300">×</Text>
              </Touchable>
            ))}
          </View>
        ) : null}
      </View>

      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="What makes this place worth living in?"
        multiline
      />

      {submitted && !valid ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-caption font-rubik-medium text-danger mt-md"
        >
          Please fix the highlighted fields before saving.
        </Text>
      ) : null}

      {/* The margin lives on a wrapper, not on the Touchable's className: that
          className lands on the inner painted view, and a margin there stops it
          from filling the outer Pressable's 52pt tap target. */}
      <View className="mt-xl">
        <Touchable
          onPress={submit}
          disabled={saving}
          accessibilityLabel={initial ? "Save changes" : "Publish listing"}
          accessibilityState={{ disabled: saving, busy: saving }}
          style={{ minHeight: 52 }}
          className="items-center justify-center rounded-full bg-primary-300"
        >
          <Text className="text-body font-rubik-bold text-white">
            {saving ? "Saving…" : initial ? "Save changes" : "Publish listing"}
          </Text>
        </Touchable>
      </View>
    </ScrollView>
  );
}
