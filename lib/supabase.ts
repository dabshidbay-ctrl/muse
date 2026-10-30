import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  createClient,
  type Session,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { AppState, Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Copy .env.example to .env and fill them in."
  );
}

// Dismisses the auth browser tab when it redirects back into the app.
WebBrowser.maybeCompleteAuthSession();

// Deep link that Supabase redirects to after OAuth. Configure this as an
// allowed redirect URL in Supabase -> Authentication -> URL Configuration.
const redirectTo = AuthSession.makeRedirectUri();

/**
 * The one Supabase client. Supabase owns auth: the session is persisted by
 * `@supabase/supabase-js` itself and refreshed automatically, so the access
 * token always matches the signed-in Supabase user. RLS reads the user id
 * from `auth.jwt()->>'sub'`.
 *
 * React Native has no `localStorage`, so `persistSession` needs an explicit
 * storage adapter or the session only lives in memory and is lost on reload.
 *
 * `flowType: 'pkce'` keeps the OAuth code exchange bound to a verifier this
 * client generated: the redirect carries a single-use `code` instead of tokens,
 * so another app registered for the same deep link scheme cannot steal a
 * session out of the URL. The verifier is written to the same storage.
 *
 * `detectSessionInUrl` must stay false on native — there is no page URL for
 * supabase-js to read, and the redirect is handled explicitly below.
 */
export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    // Native only. On web this must stay unset: `expo export --platform web`
    // prerenders every route in Node, where AsyncStorage's web build reaches
    // for `window.localStorage` and throws "window is not defined" — and it
    // throws at import time, because createClient initialises GoTrue eagerly.
    // supabase-js's own default storage feature-detects localStorage instead,
    // so it degrades to in-memory during the prerender pass and picks up
    // localStorage in the browser.
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    persistSession: true,
    autoRefreshToken: true,
    // On web the OAuth redirect lands back on the page URL, which is exactly
    // what supabase-js reads. On native there is no page URL and the redirect
    // is handled explicitly in signInWithGoogle below.
    detectSessionInUrl: Platform.OS === "web",
    flowType: "pkce",
  },
});

/**
 * On React Native `autoRefreshToken` cannot rely on a browser's timers staying
 * alive, so supabase-js expects the app to drive the refresh loop from the
 * foreground/background lifecycle. Without this the access token silently
 * expires while the app is backgrounded and every request 401s on resume.
 *
 * Web keeps supabase-js's own timer-based refresh, and touching AppState during
 * the static prerender would fail the same way the storage adapter does.
 */
if (Platform.OS !== "web") {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      supabase.auth.startAutoRefresh();
    } else {
      supabase.auth.stopAutoRefresh();
    }
  });
  // Cleanup isn't strictly needed for a root-level listener, but prevents
  // a lint warning and keeps the subscription reference alive.
  if (typeof subscription?.remove === "function") {
    const remover = subscription.remove.bind(subscription);
    // On React Native 0.76+, the subscription has a .remove() method.
    // We don't call it because the listener lives for the app's lifetime.
    void remover;
  }
}

/**
 * The app-wide Supabase client. Its identity is stable across renders, so it is
 * safe to use in effect dependency lists.
 */
export function useSupabaseClient(): SupabaseClient {
  return supabase;
}

/**
 * Starts the Google OAuth flow against Supabase's built-in auth.
 *
 * Supabase must have the Google provider enabled (Authentication -> Providers
 * -> Google) with a Client ID / Secret from the Google Cloud console.
 */
export async function signInWithGoogle(): Promise<Session | null> {
  // On web the redirect is a page navigation, not a browser tab the app can
  // await: the popup-and-exchange dance below would land the code in a popup
  // that the main window never reads. Let supabase-js drive the redirect and
  // let `detectSessionInUrl` finish the exchange when the page comes back —
  // so this call navigates away rather than returning a session.
  if (Platform.OS === "web") {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo },
    });
    if (error) throw error;
    return null;
  }

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    // `skipBrowserRedirect` hands us the URL instead of navigating: the app,
    // not supabase-js, owns opening the browser and awaiting the redirect.
    options: { redirectTo, skipBrowserRedirect: true },
  });

  if (error) throw error;
  if (!data.url) throw new Error("Sign in could not be started.");

  // Open the SSO page in the system browser, then wait for the redirect back.
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

  if (result.type !== "success") {
    throw new Error("Sign in was cancelled.");
  }

  // Supabase reports provider failures (consent denied, misconfigured redirect
  // URL) as query params on the redirect rather than as a thrown error.
  const url = new URL(result.url);
  const redirectError = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (redirectError) throw new Error(redirectError);

  // PKCE hands back a single-use authorization code; supabase-js pairs it with
  // the verifier it stored when the flow started and returns a real session.
  const code = url.searchParams.get("code");
  if (!code) throw new Error("Sign in did not return an authorization code.");

  const { data: sessionData, error: sessionError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (sessionError) throw sessionError;
  if (!sessionData.session) throw new Error("Sign in did not return a session.");

  return sessionData.session;
}

/**
 * The account types someone may pick for themselves at sign-up. 'admin' is
 * deliberately absent: it is granted in the SQL editor, never requested.
 * The database repeats this whitelist in `handle_new_user()` (migration 0007),
 * because user metadata is client-controlled and this constant is not a check.
 */
export type SignUpRole = "tenant" | "property_owner" | "agency" | "hotel_manager";

/**
 * Creates an account with an email and password.
 *
 * `full_name` and `role` are written to the user's metadata rather than to
 * `profiles` directly: the `on_auth_user_created` trigger (migrations 0005 and
 * 0007) reads `raw_user_meta_data` when it inserts the profile row, so both are
 * already there the first time the app reads the profile.
 *
 * Returns `needsConfirmation: true` when Supabase accepted the sign-up but
 * withheld a session pending email confirmation — the default for a new
 * project. The caller has to tell the user to check their inbox rather than
 * treating a null session as failure.
 */
export async function signUpWithEmail({
  email,
  password,
  fullName,
  role,
}: {
  email: string;
  password: string;
  fullName?: string;
  role?: SignUpRole;
}): Promise<{ session: Session | null; needsConfirmation: boolean }> {
  // Omitted entirely when there is nothing to say, so the trigger falls back to
  // the 'tenant' column default rather than reading an empty string.
  const metadata: Record<string, string> = {};
  if (fullName?.trim()) metadata.full_name = fullName.trim();
  if (role) metadata.role = role;

  const { data, error } = await supabase.auth.signUp({
    email: email.trim(),
    password,
    options: {
      data: Object.keys(metadata).length ? metadata : undefined,
      emailRedirectTo: redirectTo,
    },
  });

  if (error) throw error;

  // Supabase returns a user with an empty `identities` array when the address
  // is already registered, instead of erroring — otherwise sign-up would tell
  // an attacker which emails have accounts. Surface it as the same neutral
  // "check your inbox" outcome the confirmation path produces.
  if (data.user && data.user.identities?.length === 0) {
    return { session: null, needsConfirmation: true };
  }

  return { session: data.session, needsConfirmation: !data.session };
}

/** Signs in with an email and password. */
export async function signInWithEmail(email: string, password: string): Promise<Session> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });

  if (error) throw error;
  if (!data.session) throw new Error("Sign in did not return a session.");

  return data.session;
}

/**
 * Sends a password-reset email. Resolves the same way whether or not the
 * address has an account, so this never confirms who is registered.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo,
  });
  if (error) throw error;
}

/** Signs the current Supabase session out. */
export async function signOut(): Promise<void> {
  // Best-effort: remove the push token so the user stops getting notifications
  // on a device they no longer use. This is not awaited on purpose — the
  // sign-out itself must not be delayed by a network request to the push API.
  import("./pushNotifications").then(({ unregisterPushNotificationsAsync }) =>
    unregisterPushNotificationsAsync(supabase)
  ).catch(() => {});
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

/**
 * Safe accessor for the signed-in Supabase user, mirroring what screens used
 * to read from Supabase auth's user object:
 *   - id       (uuid from auth.users, maps to auth.jwt()->>'sub')
 *   - email
 *   - fullName (derived from user_metadata / raw_user_meta_data)
 *   - imageUrl (avatar from user_metadata)
 */
export function describeSupabaseUser(
  user: Pick<User, "id" | "email" | "user_metadata"> | null
): { id: string; email: string | null; fullName: string | null; imageUrl: string | null } | null {
  if (!user) return null;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const fullName =
    (meta.full_name as string) ||
    (meta.name as string) ||
    ([meta.given_name, meta.family_name].filter(Boolean).join(" ") as string) ||
    null;
  const imageUrl = (meta.avatar_url as string) || (meta.picture as string) || null;
  return {
    id: user.id,
    email: user.email ?? null,
    fullName,
    imageUrl,
  };
}

/**
 * Turns a Supabase *auth* failure into something the person signing in can act
 * on. `describeSupabaseError` below covers PostgREST data errors; these arrive
 * as AuthApiError with their own codes and messages, and the raw text
 * ("Invalid login credentials") does not say what to do next.
 */
export function describeAuthError(error: unknown): string {
  const err = error as { code?: string; message?: string } | null;
  const code = err?.code;
  const message = err?.message ?? "Something went wrong";

  switch (code) {
    case "invalid_credentials":
      return "That email and password do not match an account.";
    case "email_not_confirmed":
      return "Confirm your email address first — check your inbox for the link we sent.";
    case "user_already_exists":
    case "email_exists":
      return "That email already has an account. Try signing in instead.";
    case "weak_password":
      return "That password is too weak. Use at least 8 characters.";
    case "over_email_send_rate_limit":
    case "over_request_rate_limit":
      return "Too many attempts. Wait a minute and try again.";
    case "validation_failed":
      return "Check the email address and password and try again.";
    default:
      return message;
  }
}

/**
 * Turns Supabase/PostgREST error codes into something a developer can act on.
 * The raw codes ("PGRST301") say nothing about which setup step was missed.
 */
export function describeSupabaseError(error: unknown): string {
  const err = error as { code?: string; message?: string } | null;
  const code = err?.code;
  const message = err?.message ?? "Something went wrong";

  switch (code) {
    case "PGRST301":
      return "Supabase rejected the session token. Sign out and back in.";
    case "PGRST302":
      return "Supabase rejected the session token as expired. Sign out and back in.";
    case "PGRST202":
      // The RPC does not exist on the server.
      return (
        "The search_properties function is missing. Run " +
        "supabase/migrations/0002_search_and_indexes.sql in the Supabase SQL editor."
      );
    case "PGRST205":
    case "42P01":
      // Deliberately not naming a single file: the schema is built by the whole
      // numbered sequence, and pointing at 0001 sent people to re-run the first
      // migration when the missing table came from a much later one.
      return (
        "A database table is missing. Apply the migrations in supabase/migrations " +
        "in order (or run `supabase db push`), then reload."
      );
    case "42501":
      return "Permission denied by row level security. Check the policies in 0001_init.sql.";
    default:
      return code ? `${message} (${code})` : message;
  }
}
