import type { SupabaseClient } from "@supabase/supabase-js";
import { decode as decodeBase64 } from "base64-arraybuffer";
import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";

/**
 * Uploading a picked photo to a Supabase Storage bucket.
 *
 * This lived twice — once for property galleries, once for marketplace items —
 * and the two copies were identical apart from the bucket name. That mattered
 * more than ordinary duplication, because the platform branching below encodes
 * a bug that only appeared on a real device: **React Native's Blob does not
 * implement `arrayBuffer()`**. The obvious `fetch(uri).then(r => r.blob())`
 * approach works perfectly on web and crashes on every phone. With two copies,
 * the next fix would have landed in one of them.
 */

// Extension → content type, so the bucket serves the bytes as what they are.
// Only the formats an image picker can hand us are listed; anything else falls
// back to JPEG, which is what a phone camera produces.
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  bmp: "image/bmp",
};

/**
 * The extension is derived *from* the content type rather than copied from the
 * uri, so the two can never disagree: a file stored as `.png` but served as
 * `image/jpeg` renders as a broken image.
 */
function extensionFor(mime: string): string {
  const subtype = mime.split("/")[1]?.split(";")[0]?.split("+")[0]?.toLowerCase();
  if (!subtype) return "jpg";
  return subtype === "jpeg" ? "jpg" : subtype;
}

/**
 * Uploads one local photo and returns its public URL.
 *
 * `folder` groups a listing's photos under one prefix so the bucket stays
 * navigable and an item's files can be found without a database round trip.
 * A uri that is already an `http(s)` URL is returned untouched — that is an
 * existing photo being re-saved, and re-uploading would copy the same bytes
 * under a new key.
 */
export async function uploadPhotoToBucket(
  supabase: SupabaseClient,
  { bucket, folder, uri }: { bucket: string; folder: string; uri: string }
): Promise<string> {
  if (/^https?:\/\//i.test(uri)) return uri;

  // Query strings and fragments are stripped first — some pickers append
  // things like `?width=...`, and ".jpg?w=1" is not "jpg".
  const uriExtension = uri.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  const mimeFromUri = MIME_BY_EXTENSION[uriExtension];

  let bytes: ArrayBuffer;
  let contentType: string;

  const dataUrl = /^data:([^;,]+)?(;[^,]*)?,/i.exec(uri);

  if (dataUrl) {
    // A data URL carries both its type and its payload, so neither the file
    // system nor fetch is involved on any platform.
    const [, mime, parameters] = dataUrl;
    if (!/;base64/i.test(parameters ?? "")) {
      throw new Error("The selected image could not be read.");
    }
    contentType = mime || "image/jpeg";
    bytes = decodeBase64(uri.slice(dataUrl[0].length));
  } else if (Platform.OS === "web") {
    // On web the picker hands back a blob: URL that only the browser can
    // resolve, and a browser Blob *does* implement arrayBuffer(). Its `type` is
    // also the most trustworthy source of the content type here, because a
    // blob: URL has no extension to read one from.
    const response = await fetch(uri);
    if (!response.ok) throw new Error("The selected image could not be read.");
    const blob = await response.blob();
    contentType = blob.type || mimeFromUri || "image/jpeg";
    bytes = await blob.arrayBuffer();
  } else {
    // The native path, and the reason this function exists in one place.
    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    if (!base64) throw new Error("The selected image could not be read.");
    contentType = mimeFromUri ?? "image/jpeg";
    bytes = decodeBase64(base64);
  }

  const extension = extensionFor(contentType);
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, bytes, { contentType, upsert: false });

  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}
