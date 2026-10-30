import * as Sentry from "@sentry/react-native";
import Constants, { ExecutionEnvironment } from "expo-constants";

/**
 * Error reporting.
 *
 * The DSN is read from EXPO_PUBLIC_SENTRY_DSN. That prefix means it is compiled
 * into the client bundle, which is correct for Sentry: a DSN is an ingest
 * endpoint, not a credential, and it cannot be used to read anything back. Do
 * not put an auth token here — that one *is* secret and belongs only in CI.
 *
 * With no DSN set, every function below turns into a no-op. Reporting is then
 * simply off, rather than the app crashing on boot or logging a warning on
 * every error, so a contributor without Sentry access can still run the app.
 */
const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

/**
 * Expo Go cannot load Sentry's native module, so native crashes and ANRs are
 * not captured there — only JavaScript errors, through the JS layer. That is
 * enough for the Supabase/RLS and upload failures this was added to chase, but
 * a release build is needed for the full picture.
 */
const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export const sentryEnabled = !!dsn;

export function initSentry() {
  if (!dsn) return;

  Sentry.init({
    dsn,
    // Ship the JS stack for handled errors too, not just crashes: most of what
    // goes wrong here is a rejected Supabase call, which never crashes the app.
    attachStacktrace: true,
    // Traces are sampled rather than sent whole; this is an error-tracking
    // setup, not a performance one, and a full trace stream is mostly noise.
    tracesSampleRate: 0.2,
    // __DEV__ builds would otherwise flood the project with errors from code
    // being actively edited.
    enabled: !__DEV__ || process.env.EXPO_PUBLIC_SENTRY_DEBUG === "true",
    environment: __DEV__ ? "development" : "production",
    enableNativeFramesTracking: !isExpoGo,
  });
}

/**
 * Identifies the signed-in user on subsequent events, so an error can be traced
 * to the account that hit it. Only the Supabase user id and email are sent —
 * both already live in Sentry's own user schema, and neither is anything the
 * server does not already know.
 */
export function setSentryUser(user: { id: string; email?: string | null } | null) {
  if (!dsn) return;
  Sentry.setUser(user ? { id: user.id, email: user.email ?? undefined } : null);
}

/**
 * Reports a handled error with the context needed to act on it.
 *
 * `where` is a stable label for the operation ("upload-photo", "record-view"),
 * so the same failure groups together in Sentry rather than fragmenting on the
 * message text. Postgres/PostgREST codes are promoted to tags because they are
 * what actually identifies the fault — "42501" and "42P17" are searchable,
 * "new row violates row-level security policy" is not.
 */
export function captureError(
  error: unknown,
  where: string,
  extra?: Record<string, unknown>
) {
  // Always log locally: the terminal is where this gets noticed during
  // development, and it is the only output at all when no DSN is configured.
  console.error(`[${where}]`, error, extra ?? "");

  if (!dsn) return;

  const err = error as { code?: string; message?: string; details?: string } | null;

  Sentry.withScope((scope) => {
    scope.setTag("operation", where);
    if (err?.code) scope.setTag("pg_code", err.code);
    if (extra) scope.setContext("details", extra);
    if (err?.details) scope.setContext("postgrest", { details: err.details });

    Sentry.captureException(
      error instanceof Error ? error : new Error(err?.message ?? String(error))
    );
  });
}

/**
 * Records a step that led up to an error. Breadcrumbs are what turn "RLS
 * refused an insert" into "RLS refused an insert, on this screen, for this
 * property, moments after the session refreshed".
 */
export function addBreadcrumb(message: string, data?: Record<string, unknown>) {
  if (!dsn) return;
  Sentry.addBreadcrumb({ message, data, level: "info" });
}
