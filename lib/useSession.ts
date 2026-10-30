import { useEffect, useState } from "react";
import { captureError, setSentryUser } from "./sentry";
import type { Session } from "@supabase/supabase-js";
import { describeSupabaseUser, supabase } from "./supabase";

export type SessionUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  imageUrl: string | null;
};

/**
 * React hook that exposes the current Supabase auth session, mirroring the
 * `useUser`/`useAuth` API the app previously used:
 *
 *   const { user, isLoaded, isSignedIn } = useSession();
 *
 * - `user`      – { id, email, fullName, imageUrl } or null
 * - `isLoaded`  – true once the initial session has been resolved
 * - `isSignedIn`– true when a session exists
 *
 * Wired to Supabase's onAuthStateChange so sign in/out/refresh all re-render
 * consumers automatically.
 */
export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    let alive = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!alive) return;
        setSession(data.session);
        // Attach the account to every later event, so an error report says who
        // hit it — which is most of the work in reproducing an RLS failure.
        setSentryUser(data.session?.user ?? null);
        setIsLoaded(true);
      })
      .catch((err) => {
        captureError(err, "session-load");
        if (alive) setIsLoaded(true);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      if (!alive) return;
      setSession(next);
      setSentryUser(next?.user ?? null);
    });

    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const user: SessionUser | null = session?.user ? describeSupabaseUser(session.user) : null;

  return {
    user,
    session,
    isLoaded,
    isSignedIn: !!session,
  };
}