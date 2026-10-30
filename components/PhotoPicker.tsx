import React, { useCallback, useState } from "react";
import { Image, Platform, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { MIN_TAP } from "@/lib/responsive";
import { Touchable } from "@/components/ui";
import { captureError } from "@/lib/sentry";

/** Enforced here AND by a trigger on public.galleries — see the contract. */
export const MIN_PHOTOS = 2;
export const MAX_PHOTOS = 18;

const TILE = 104;

/** Per-photo upload state, keyed by the uri in `value`. */
export type PhotoUpload = { state: "uploading" | "error"; message?: string };

function Tile({
  uri,
  index,
  total,
  disabled,
  upload,
  onRemove,
  onMove,
}: {
  uri: string;
  index: number;
  total: number;
  disabled?: boolean;
  upload?: PhotoUpload;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
}) {
  const [broken, setBroken] = useState(false);
  const isCover = index === 0;
  const failed = upload?.state === "error";

  return (
    <View style={{ width: TILE }}>
      <View
        style={{ width: TILE, height: TILE }}
        className={`rounded-md overflow-hidden bg-surface-sunken dark:bg-surface-dark-elevated border ${
          failed ? "border-danger" : "border-line dark:border-line-dark"
        }`}
      >
        {broken ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60">
              No preview
            </Text>
          </View>
        ) : (
          // Inline size: a `size-*` class loses to react-native-web's runtime
          // stylesheet, which is why thumbnails used to render at full size.
          <Image
            source={{ uri }}
            style={{ width: TILE, height: TILE }}
            resizeMode="cover"
            accessible={false}
            alt=""
            onError={() => setBroken(true)}
          />
        )}

        {upload?.state === "uploading" ? (
          <View className="absolute inset-0 items-center justify-center bg-black/50">
            <Text className="text-caption font-rubik-semibold text-white">Uploading…</Text>
          </View>
        ) : null}

        {isCover ? (
          <View className="absolute left-0 bottom-0 right-0 bg-primary-300 py-2xs items-center">
            <Text className="text-caption font-rubik-semibold text-white">Cover</Text>
          </View>
        ) : null}

        <View className="absolute right-0 top-0">
          <Touchable
            onPress={onRemove}
            disabled={disabled}
            accessibilityLabel={`Remove photo ${index + 1}`}
            accessibilityHint="Removes this photo from the listing"
            style={{ minWidth: MIN_TAP, minHeight: MIN_TAP }}
            className="items-center justify-center"
          >
            <View className="size-6 rounded-full bg-black/60 items-center justify-center">
              <Text className="text-caption font-rubik-bold text-white">×</Text>
            </View>
          </Touchable>
        </View>
      </View>

      {/* Order is the listing's photo order, so it has to be fixable without
          removing and re-picking everything. */}
      <View className="flex-row justify-between mt-2xs">
        {([-1, 1] as const).map((delta) => {
          const edge = delta === -1 ? index === 0 : index === total - 1;
          return (
            <Touchable
              key={delta}
              onPress={() => onMove(delta)}
              disabled={disabled || edge}
              accessibilityLabel={
                delta === -1
                  ? `Move photo ${index + 1} earlier`
                  : `Move photo ${index + 1} later`
              }
              accessibilityState={{ disabled: disabled || edge }}
              style={{ minWidth: MIN_TAP, minHeight: MIN_TAP }}
              className="items-center justify-center rounded-sm bg-surface dark:bg-surface-dark-elevated border border-line dark:border-line-dark"
            >
              <Text className="text-body font-rubik-bold text-black-300 dark:text-white">
                {delta === -1 ? "‹" : "›"}
              </Text>
            </Touchable>
          );
        })}
      </View>

      {failed ? (
        // Per photo, not per form: one dead upload out of twelve should not
        // read as "the listing failed to save".
        <Text className="text-caption font-rubik-medium text-danger mt-2xs">
          {upload?.message ?? "Upload failed"}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * Device photo selection for a listing.
 *
 * Holds whatever uri the platform hands back (a local `file:`/`blob:` uri
 * before upload, an https URL after). Upload itself lives with the caller:
 * `uploadPropertyPhoto` needs a property id, which does not exist until the
 * listing row has been inserted, so the picker cannot own that step.
 */
export function PhotoPicker({
  value,
  onChange,
  disabled,
  uploads,
  error,
}: {
  value: string[];
  onChange: (urls: string[]) => void;
  disabled?: boolean;
  /** Upload state per uri, supplied by the form once it has a property id. */
  uploads?: Record<string, PhotoUpload>;
  /** Validation message from the form, e.g. the minimum not being met. */
  error?: string;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const remaining = MAX_PHOTOS - value.length;

  const pick = useCallback(async () => {
    if (busy || disabled) return;
    if (remaining <= 0) {
      setNote(`That is the limit — ${MAX_PHOTOS} photos. Remove one to add another.`);
      return;
    }
    setBusy(true);
    setNote(null);
    try {
      // The web build uses a file input and has no permission model; asking
      // there returns a denial on some browsers and blocks the picker.
      if (Platform.OS !== "web") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          setNote("Photo access is off. Enable it for this app in Settings, then try again.");
          return;
        }
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        quality: 0.8,
      });
      if (result.canceled) return;

      const picked = result.assets.map((a) => a.uri).filter((uri) => !value.includes(uri));
      const accepted = picked.slice(0, remaining);
      onChange([...value, ...accepted]);

      if (picked.length > accepted.length) {
        // selectionLimit is advisory on some Android pickers, so the overflow
        // has to be reported rather than silently dropped.
        setNote(
          `Only ${accepted.length} added — a listing can have at most ${MAX_PHOTOS} photos.`
        );
      }
    } catch (e) {
      captureError(e, "photo-pick");
      setNote("Could not open your photos. Try again.");
    } finally {
      setBusy(false);
    }
  }, [busy, disabled, remaining, value, onChange]);

  const removeAt = (i: number) => {
    onChange(value.filter((_, n) => n !== i));
    setNote(null);
  };

  const moveBy = (i: number, delta: -1 | 1) => {
    const j = i + delta;
    if (j < 0 || j >= value.length) return;
    const next = [...value];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const atMax = remaining <= 0;

  return (
    <View className="mt-md">
      <Text className="text-caption font-rubik-medium text-black-200 dark:text-white/60 mb-2xs">
        Photos
      </Text>

      <View className="mb-xs">
        <Touchable
          onPress={pick}
          disabled={disabled || busy || atMax}
          accessibilityLabel={atMax ? `Photo limit reached, ${MAX_PHOTOS} of ${MAX_PHOTOS}` : "Add photos"}
          accessibilityHint={`Choose up to ${remaining > 0 ? remaining : 0} more photos from this device`}
          accessibilityState={{ disabled: disabled || busy || atMax, busy }}
          style={{ minHeight: 52 }}
          className={`items-center justify-center rounded-full ${
            atMax ? "bg-surface-sunken dark:bg-surface-dark-elevated" : "bg-primary-300"
          }`}
        >
          <Text
            className={`text-body font-rubik-bold ${
              atMax ? "text-black-200 dark:text-white/60" : "text-white"
            }`}
          >
            {busy ? "Opening…" : atMax ? "Maximum photos added" : "Add photos"}
          </Text>
        </Touchable>
      </View>

      <Text
        accessibilityLiveRegion="polite"
        className="text-caption font-rubik text-black-100 dark:text-white/40"
      >
        {`${value.length} of ${MAX_PHOTOS} selected · at least ${MIN_PHOTOS} required · the first photo is the cover`}
      </Text>

      {note ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-caption font-rubik-medium text-warning mt-2xs"
        >
          {note}
        </Text>
      ) : null}
      {error ? (
        <Text
          accessibilityLiveRegion="polite"
          className="text-caption font-rubik-medium text-danger mt-2xs"
        >
          {error}
        </Text>
      ) : null}

      {value.length ? (
        <View className="flex-row flex-wrap gap-sm mt-sm">
          {value.map((uri, i) => (
            <Tile
              key={`${i}-${uri}`}
              uri={uri}
              index={i}
              total={value.length}
              disabled={disabled}
              upload={uploads?.[uri]}
              onRemove={() => removeAt(i)}
              onMove={(d) => moveBy(i, d)}
            />
          ))}
        </View>
      ) : (
        <View className="mt-sm rounded-md border border-dashed border-line dark:border-line-dark px-lg py-xl items-center">
          <Text className="text-caption font-rubik text-black-200 dark:text-white/60 text-center">
            No photos yet. Listings with photos get far more enquiries.
          </Text>
        </View>
      )}
    </View>
  );
}

export default PhotoPicker;
