import { Alert, Platform, Share } from "react-native";
import { captureError } from "@/lib/sentry";

/**
 * Sharing a listing.
 *
 * The link handed to a recipient has to be a *web* URL. The obvious candidates
 * are all dead ends: an `exp://` deep link only resolves on a machine running
 * this dev server, and `window.location.origin` is `localhost` for everyone
 * developing. Either one arrives in a chat thread as a link that cannot be
 * opened, which is worse than no link, so the deployed origin is configured
 * explicitly through EXPO_PUBLIC_SITE_URL and nothing is invented when it is
 * missing.
 */
const SITE_URL = (process.env.EXPO_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");

/** Guards against a misconfigured .env silently producing unopenable links. */
function usableOrigin(value: string): boolean {
  if (!value) return false;
  if (!/^https?:\/\//i.test(value)) return false;
  return !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(:|\/|$)/i.test(value);
}

/**
 * The origin the current page is served from, when it is a real one.
 *
 * This is the fallback that makes the button work at all in a build where
 * EXPO_PUBLIC_SITE_URL was never set — which is the normal state of a preview
 * deployment. It is only trusted when it is not a loopback address, so a
 * developer sharing from `localhost` still gets the honest "not set up"
 * message instead of a link nobody else can open.
 */
function currentWebOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const origin = window.location?.origin;
  if (!origin || !usableOrigin(origin)) return null;
  return origin.replace(/\/+$/, "");
}

/**
 * The canonical web URL for a property.
 *
 * Order of preference: the configured site origin, then the origin this page is
 * actually served from. Returns null only when neither is usable, which is the
 * one case where there is genuinely no link to send.
 */
export function propertyWebUrl(id: string): string | null {
  if (!id) return null;
  const origin = usableOrigin(SITE_URL) ? SITE_URL : currentWebOrigin();
  if (!origin) return null;
  return `${origin}/properties/${encodeURIComponent(id)}`;
}

/**
 * Web-only transient message.
 *
 * `Alert.alert` is a no-op on react-native-web (it ships `static alert() {}`),
 * so a "copied" confirmation routed through Alert is invisible in a browser —
 * the button reads as broken. This puts a real element on the page instead.
 */
function webToast(message: string) {
  if (typeof document === "undefined") return;
  const id = "rn-share-toast";
  document.getElementById(id)?.remove();

  const el = document.createElement("div");
  el.id = id;
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  el.textContent = message;
  el.style.cssText = [
    "position:fixed",
    "left:50%",
    "bottom:32px",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "max-width:min(90vw,420px)",
    "padding:12px 18px",
    "border-radius:9999px",
    "background:rgba(17,17,17,0.92)",
    "color:#fff",
    "font-size:14px",
    "line-height:1.35",
    "text-align:center",
    "box-shadow:0 6px 24px rgba(0,0,0,0.35)",
    "pointer-events:none",
  ].join(";");

  document.body.appendChild(el);
  window.setTimeout(() => el.remove(), 3200);
}

/** One notification path, so a message is never lost to the web Alert no-op. */
function notify(title: string, body: string) {
  if (Platform.OS === "web") webToast(body ? `${title} — ${body}` : title);
  else Alert.alert(title, body);
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    // Clipboard access is permission-gated and throws in a non-secure context;
    // fall through to the textarea path rather than failing the share.
    captureError(err, "share-clipboard-api");
  }

  // execCommand is deprecated but is still the only clipboard write available
  // over plain http, which is how a self-hosted preview build is often served.
  try {
    if (typeof document === "undefined") return false;
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch (err) {
    captureError(err, "share-clipboard-fallback");
    return false;
  }
}

/**
 * Share a link to a property's page on the deployed website.
 *
 * Native goes through the OS share sheet. Web prefers `navigator.share` (a real
 * share sheet on mobile browsers) and otherwise copies the link and *says so* —
 * a silent copy is indistinguishable from a broken button.
 */
export async function shareProperty(p: { id: string; name: string }): Promise<void> {
  const title = p.name || "Property listing";
  const webUrl = propertyWebUrl(p.id);

  // Native has one more option than web: the app's own scheme. A recipient with
  // the app installed lands straight on the listing, so this is a real link
  // rather than the dead end an `exp://` URL would be.
  const url = webUrl ?? (Platform.OS === "web" ? null : `restate://properties/${p.id}`);

  if (!url) {
    notify(
      "Sharing is not set up",
      "This build has no website address configured (EXPO_PUBLIC_SITE_URL), so there is no link to send."
    );
    return;
  }

  const message = `${title}\n${url}`;

  if (Platform.OS === "web") {
    const nav: any = typeof navigator !== "undefined" ? navigator : undefined;
    if (nav?.share) {
      try {
        await nav.share({ title, text: title, url });
        return;
      } catch (err) {
        // A dismissed share sheet rejects with AbortError — that is the user
        // saying no, not a failure, and must not fall through to a copy.
        if ((err as { name?: string })?.name === "AbortError") return;
        captureError(err, "share-property-web");
      }
    }

    const copied = await copyToClipboard(url);
    notify(copied ? "Link copied" : "Could not copy the link", copied ? url : url);
    return;
  }

  try {
    await Share.share({ title, message, url });
  } catch (err) {
    captureError(err, "share-property");
    notify("Could not share this listing", "Please try again.");
  }
}
