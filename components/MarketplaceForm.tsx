import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSession } from "@/lib/useSession";
import { supabase, describeSupabaseError } from "@/lib/supabase";
import {
  MAX_ITEM_PHOTOS,
  MIN_ITEM_PHOTOS,
  createMarketplaceItem,
  updateMarketplaceItem,
  uploadMarketplacePhoto,
} from "@/lib/marketplaceApi";
import { useResponsive, shadow } from "@/lib/responsive";
import { Chip, Touchable } from "@/components/ui";
import { DistrictSelect, type DistrictValue } from "@/components/Filters";
import { PhotoPicker, type PhotoUpload } from "@/components/PhotoPicker";
import { marketplaceCategories, marketplaceConditions } from "@/constants/data";
import type { MarketplaceCategory, MarketplaceCondition, MarketplaceItem } from "@/lib/types";
import { captureError } from "@/lib/sentry";
import { normalizePhone } from "@/lib/phone";

const isRemote = (uri: string) => /^https?:\/\//i.test(uri);

/* --------------------------------------------------------------------- phone */

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  keyboardType = "default",
  multiline = false,
  error,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: "default" | "numeric" | "phone-pad";
  multiline?: boolean;
  error?: string;
  hint?: string;
  disabled?: boolean;
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
        editable={!disabled}
        accessibilityLabel={label}
        accessibilityHint={hint}
        className={`rounded-md border px-md py-sm text-body font-rubik bg-surface dark:bg-surface-dark-muted text-black-300 dark:text-white ${
          error ? "border-danger" : "border-line dark:border-line-dark"
        }`}
        style={multiline ? { minHeight: 96, textAlignVertical: "top" } : undefined}
      />
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-caption font-rubik-medium text-danger mt-2xs"
        >
          {error}
        </Text>
      ) : hint ? (
        <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-2xs">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

/** Boxed, coloured message. Alert.alert is a no-op on web, so every success, * failure and policy notice this form has to say is rendered inline. */
function Notice({
  tone,
  title,
  body,
}: {
  tone: "info" | "privacy" | "error" | "success";
  title: string;
  body: string;
}) {
  const skin = {
    info: "bg-warning/10 border-warning/40",
    privacy: "bg-primary-100 border-primary-200",
    error: "bg-danger/10 border-danger/40",
    success: "bg-success/10 border-success/40",
  }[tone];
  const heading = {
    info: "text-warning",
    privacy: "text-primary-300",
    error: "text-danger",
    success: "text-success",
  }[tone];

  return (
    <View
      accessibilityLiveRegion="polite"
      accessibilityRole="summary"
      className={`mt-md rounded-md border px-md py-sm ${skin}`}
    >
      <Text className={`text-caption font-rubik-bold ${heading}`}>{title}</Text>
      <Text className="text-caption font-rubik text-black-300 dark:text-white/80 mt-2xs">
        {body}
      </Text>
    </View>
  );
}

export default function MarketplaceForm({
  initial,
  initialPhone,
  onSaved,
}: {
  /** When provided, the form edits this item; otherwise it creates one. */
  initial?: MarketplaceItem | null;
  /** The seller's stored number, read from marketplace_contacts by the screen. */
  initialPhone?: string;
  /** Called with the saved item id after create/update. */
  onSaved?: (id: string) => void;
}) {
  const { user } = useSession();
  const { gutter, maxContentWidth } = useResponsive();

  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [category, setCategory] = useState<MarketplaceCategory>(initial?.category ?? "other");
  const [condition, setCondition] = useState<MarketplaceCondition>(initial?.condition ?? "good");
  const [price, setPrice] = useState(initial ? String(initial.price) : "");
  const [negotiable, setNegotiable] = useState<boolean>(initial?.negotiable ?? false);
  const [district, setDistrict] = useState<DistrictValue | null>(
    (initial?.district as DistrictValue | null | undefined) ?? null
  );
  const [photos, setPhotos] = useState<string[]>(initial?.images ?? []);
  const [uploads, setUploads] = useState<Record<string, PhotoUpload>>({});
  const [phone, setPhone] = useState(initialPhone ?? "");
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ tone: "error" | "success"; title: string; body: string } | null>(
    null
  );
  /**
   * Set once a create has succeeded. A later press — to retry photo uploads
   * that failed, say — must update that row rather than insert a second item.
   */
  const [createdId, setCreatedId] = useState<string | null>(null);

  const editingId = initial?.id ?? createdId;

  // The screen may resolve the stored phone after the first render (it needs a
  // round trip to marketplace_contacts), so adopt it unless the user has
  // already typed something.
  useEffect(() => {
    if (initialPhone) setPhone((p) => (p.trim() ? p : initialPhone));
  }, [initialPhone]);

  const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

  const errors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!title.trim()) e.title = "Give the item a title.";
    if (!Number.isFinite(num(price)) || num(price) <= 0) e.price = "Enter a price above 0.";
    if (photos.length < MIN_ITEM_PHOTOS)
      e.photos = `Add at least ${MIN_ITEM_PHOTOS} photo${MIN_ITEM_PHOTOS > 1 ? "s" : ""} — ${photos.length} so far.`;
    else if (photos.length > MAX_ITEM_PHOTOS)
      e.photos = `Remove some photos — the limit is ${MAX_ITEM_PHOTOS}.`;
    if (!phone.trim()) e.phone = "Enter a phone number so an administrator can reach you.";
    else if (!normalizePhone(phone))
      e.phone =
        "That does not look like a Somali number. Try 61 555 1234, 0615551234 or +252 61 555 1234.";
    return e;
  }, [title, price, photos.length, phone]);

  const valid = Object.keys(errors).length === 0;

  // PhotoPicker is shared with property listings, where the cap is 18. Clamping
  // here keeps its own copy honest for marketplace items and explains the drop
  // instead of silently discarding what the picker returned.
  const changePhotos = (next: string[]) => {
    if (next.length > MAX_ITEM_PHOTOS) {
      setPhotos(next.slice(0, MAX_ITEM_PHOTOS));
      setPhotoNote(`Only the first ${MAX_ITEM_PHOTOS} were kept — an item can have ${MAX_ITEM_PHOTOS} photos.`);
      return;
    }
    setPhotos(next);
    setPhotoNote(null);
  };

  /**
   * Uploads every local uri and returns the public URLs in picked order.
   * Failures are reported per photo rather than aborting: seven good photos
   * should still be saved when the eighth times out.
   */
  const uploadPhotos = async (itemId: string) => {
    const urls: string[] = [];
    let failures = 0;
    for (const uri of photos) {
      if (isRemote(uri)) {
        urls.push(uri);
        continue;
      }
      setUploads((u) => ({ ...u, [uri]: { state: "uploading" } }));
      try {
        urls.push(await uploadMarketplacePhoto(supabase, { itemId, uri }));
        setUploads((u) => {
          const next = { ...u };
          delete next[uri];
          return next;
        });
      } catch (e) {
        captureError(e, "marketplace-photo-upload");
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
    setResult(null);
    if (!valid) return;
    // Separate from the validation gate: the form is filled in correctly, so no
    // field error would explain the press doing nothing.
    if (!user?.id) {
      setResult({
        tone: "error",
        title: "You are signed out",
        body: "Your session expired while this form was open. Sign in again, then post the item.",
      });
      return;
    }
    setSaving(true);
    try {
      const normalizedPhone = normalizePhone(phone) ?? phone.trim();
      const item = {
        title: title.trim(),
        // Explicit null on update: `undefined` would make the API skip the
        // column, so clearing the description would silently keep the old text.
        description: description.trim() || null,
        category,
        condition,
        price: num(price),
        negotiable,
        district,
        // Overwritten below once the uploads have public URLs; an item cannot
        // be inserted without an id, and photos are keyed by that id.
        images: photos.filter(isRemote),
      };

      const saved = editingId
        ? await updateMarketplaceItem(supabase, {
            id: editingId,
            item,
            phone: normalizedPhone,
          })
        : await createMarketplaceItem(supabase, {
            sellerId: user.id,
            item,
            phone: normalizedPhone,
          });
      // Remembered before the photo work below, so a failure there cannot make
      // the next press insert a second item.
      if (!editingId) setCreatedId(saved.id);

      const { urls, failures } = await uploadPhotos(saved.id);
      let photoError: string | null = null;
      try {
        await updateMarketplaceItem(supabase, { id: saved.id, item: { images: urls } });
      } catch (e) {
        captureError(e, "marketplace-photos-save");
        photoError = "The item is saved, but its photos were not. Open it from My items to try again.";
      }
      if (!photoError && failures > 0) {
        photoError = `${failures} photo${failures > 1 ? "s" : ""} failed to upload. The item is saved — press Post again to retry just those.`;
      }

      if (photoError) {
        setResult({ tone: "error", title: "Item saved, with problems", body: photoError });
        // Deliberately no navigation: leaving the form open is what makes the
        // retry above possible.
        return;
      }

      onSaved?.(saved.id);
      if (!initial) {
        setResult({
          tone: "success",
          title: "Sent for review",
          body: "An administrator will check your item before it appears in the marketplace. You can follow its status under My items.",
        });
        router.replace("/marketplace/mine");
      } else {
        setResult({
          tone: "success",
          title: "Changes saved",
          body:
            initial.status === "rejected"
              ? // Honest about a real limit: only an admin may move `status`, and
                // the review queue lists pending items only, so an edited
                // rejected item does not re-queue itself.
                "The item is still marked rejected — only an administrator can put it back into review, so ask one to take another look. Posting it again as a new item also works."
              : "It stays in the review queue and appears publicly once an administrator approves it.",
        });
      }
    } catch (err) {
      captureError(err, "marketplace-item-save");
      setResult({
        tone: "error",
        title: initial ? "Could not save changes" : "Could not post the item",
        body: describeSupabaseError(err),
      });
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
      {/* Stated before the first field, not after the button: a seller who posts
          and then sees nothing in the marketplace assumes the app is broken. */}
      <Notice
        tone="info"
        title="Reviewed before it appears publicly"
        body="Every item is checked by an administrator first. Yours stays private — visible only to you under My items — until it is approved."
      />

      <Field
        label="Title"
        value={title}
        onChangeText={setTitle}
        placeholder="Three-seat sofa, barely used"
        error={submitted ? errors.title : undefined}
        disabled={saving}
      />

      {/* Ten categories and four conditions are small fixed sets, so they are
          picked, never typed — a typed "sofaa" would never match a filter. */}
      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mt-md mb-2xs">
        Category
      </Text>
      <View className="flex-row flex-wrap gap-xs">
        {marketplaceCategories.map((c) => (
          <Chip
            key={c.value}
            label={c.label}
            purpose="Category"
            selected={category === c.value}
            onPress={() => setCategory(c.value)}
          />
        ))}
      </View>

      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mt-md mb-2xs">
        Condition
      </Text>
      <View className="flex-row flex-wrap gap-xs">
        {marketplaceConditions.map((c) => (
          <Chip
            key={c.value}
            label={c.label}
            purpose="Condition"
            selected={condition === c.value}
            onPress={() => setCondition(c.value)}
          />
        ))}
      </View>

      <PhotoPicker
        value={photos}
        onChange={changePhotos}
        disabled={saving}
        uploads={uploads}
        error={submitted ? errors.photos : undefined}
      />
      {/* The picker is shared with property listings and prints that screen's
          2–18 rule, which is wrong here. */}
      <Text
        accessibilityLiveRegion="polite"
        className={`text-caption font-rubik-medium mt-2xs ${
          photoNote ? "text-warning" : "text-black-100 dark:text-white/40"
        }`}
      >
        {photoNote ??
          `For marketplace items: ${MIN_ITEM_PHOTOS} photo minimum, ${MAX_ITEM_PHOTOS} maximum. The first is the cover.`}
      </Text>

      <Field
        label="Price (USD)"
        value={price}
        onChangeText={setPrice}
        placeholder="250"
        keyboardType="numeric"
        error={submitted ? errors.price : undefined}
        disabled={saving}
      />

      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mt-md mb-2xs">
        Price is
      </Text>
      <View className="flex-row flex-wrap gap-xs">
        <Chip
          label="Fixed"
          purpose="Price is"
          selected={!negotiable}
          onPress={() => setNegotiable(false)}
        />
        <Chip
          label="Negotiable"
          purpose="Price is"
          selected={negotiable}
          onPress={() => setNegotiable(true)}
        />
      </View>

      <View className="mt-md">
        <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
          District
        </Text>
        {/* The same searchable sheet the Explore filter uses: 20 districts do
            not fit a chip row, and a typed district would never match a filter. */}
        <DistrictSelect
          value={district}
          onChange={setDistrict}
          anyLabel="Not specified"
          purpose="District"
          disabled={saving}
        />
        <Text
          accessibilityLiveRegion="polite"
          className={`text-caption font-rubik mt-2xs ${
            district ? "text-black-100 dark:text-white/40" : "text-warning"
          }`}
        >
          {district
            ? "Buyers filtering by this district will see the item."
            : "Optional — but buyers filtering by district will not see this item."}
        </Text>
      </View>

      <Field
        label="Description"
        value={description}
        onChangeText={setDescription}
        placeholder="Size, colour, any marks or damage, and why you are selling."
        multiline
        disabled={saving}
      />

      <Field
        label="Your phone number"
        value={phone}
        onChangeText={setPhone}
        placeholder="61 555 1234"
        keyboardType="phone-pad"
        error={submitted ? errors.phone : undefined}
        hint="Somali mobile or landline. +252, a leading 0, spaces and dashes are all fine."
        disabled={saving}
      />
      {/* The single reason anyone types their number into this form. It has to
          sit against the field, not in a policy page nobody opens. */}
      <Notice
        tone="privacy"
        title="Your number stays private"
        body="Buyers never see your phone number or your email — not on the item page, not anywhere in the app. Only administrators reviewing this listing can see it, so they can contact you about the item."
      />

      {submitted && !valid ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-caption font-rubik-medium text-danger mt-md"
        >
          Please fix the highlighted fields before posting.
        </Text>
      ) : null}

      {result ? <Notice tone={result.tone} title={result.title} body={result.body} /> : null}

      {/* The margin lives on a wrapper, not on the Touchable's className: that
          className lands on the inner painted view, and a margin there stops it
          filling the outer Pressable's 52pt tap target. */}
      <View className="mt-xl" style={shadow({ opacity: 0.12 })}>
        <Touchable
          onPress={submit}
          disabled={saving}
          accessibilityLabel={initial ? "Save changes" : "Post item for review"}
          accessibilityState={{ disabled: saving, busy: saving }}
          style={{ minHeight: 52 }}
          className="items-center justify-center rounded-full bg-primary-300"
        >
          <Text className="text-body font-rubik-bold text-white">
            {saving ? "Saving…" : initial ? "Save changes" : "Post item for review"}
          </Text>
        </Touchable>
      </View>
      <Text className="text-caption font-rubik text-black-100 dark:text-white/40 mt-xs text-center">
        Posting sends the item to an administrator for review — it is not public yet.
      </Text>
    </ScrollView>
  );
}
