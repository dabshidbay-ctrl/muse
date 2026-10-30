import { useCallback, useEffect, useState } from "react";
import { captureError } from "./sentry";
import { describeSupabaseError, supabase } from "./supabase";
import { ensureProfile } from "./api";
import { useSession } from "./useSession";
import type { Profile } from "./types";

type UseProfileResult = {
  profile: Profile | null;
  /** True when the user may publish listings (owner or agency). */
  isAgent: boolean;
  /** True for property owners (may rent short-term or monthly). */
  isOwner: boolean;
  /** True for agencies (monthly rental only). */
  isAgency: boolean;
  /** True for hotel managers (short-stay and monthly units). */
  isHotelManager: boolean;
  /** True for the platform administrator. */
  isAdmin: boolean;
  /** True for any publisher role (owner, agency, hotel manager or admin). */
  canPublish: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * Mirrors the Supabase user into `public.profiles` (creating the row on first
 * run) and exposes their role. The profiles pk is the Supabase auth user id.
 */
export function useProfile(): UseProfileResult {
  const { user, isLoaded } = useSession();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.id) {
      setProfile(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setProfile(
        await ensureProfile(supabase, {
          id: user.id,
          email: user.email ?? null,
          fullName: user.fullName ?? null,
          imageUrl: user.imageUrl ?? null,
        })
      );
    } catch (err) {
      setError(describeSupabaseError(err));
      captureError(err, "profile-load");
    } finally {
      setLoading(false);
    }
  }, [user?.id, user?.email, user?.fullName, user?.imageUrl]);

  useEffect(() => {
    if (!isLoaded) return;
    void load();
  }, [isLoaded, load]);

  const role = profile?.role;
  const isPublisher =
    role === "property_owner" || role === "agency" || role === "hotel_manager";
  return {
    profile,
    isAgent: isPublisher,
    isOwner: role === "property_owner",
    isAgency: role === "agency",
    isHotelManager: role === "hotel_manager",
    isAdmin: role === "admin",
    canPublish: isPublisher || role === "admin",
    loading,
    error,
    refresh: load,
  };
}
