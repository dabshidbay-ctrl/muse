import { useCallback, useEffect, useRef, useState } from "react";
import { captureError } from "./sentry";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeSupabaseError, useSupabaseClient } from "./supabase";

type UseSupabaseOptions<TParams, TResult> = {
  fn: (supabase: SupabaseClient, params: TParams) => Promise<TResult>;
  params?: TParams;
  skip?: boolean;
};

type UseSupabaseResult<TParams, TResult> = {
  data: TResult | null;
  /** True while any request is in flight. */
  loading: boolean;
  /** True only for the very first load, when there is nothing to show yet. */
  initialLoading: boolean;
  error: string | null;
  refetch: (params?: TParams) => Promise<void>;
};

/**
 * Runs a Supabase query against the Supabase-authenticated client and tracks
 * loading/error state. Replaces the old `useAppwrite` hook.
 */
export function useSupabase<TParams extends object, TResult>({
  fn,
  params = {} as TParams,
  skip = false,
}: UseSupabaseOptions<TParams, TResult>): UseSupabaseResult<TParams, TResult> {
  const supabase = useSupabaseClient();
  const [data, setData] = useState<TResult | null>(null);
  const [loading, setLoading] = useState(!skip);
  const [error, setError] = useState<string | null>(null);

  // Callers routinely pass an inline arrow as `fn`; keeping it in a ref stops
  // that new identity on every render from re-triggering the effect forever.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // Identifies the most recent request. Responses from superseded requests are
  // discarded, so the last request *issued* wins rather than the last to
  // resolve — otherwise a slow early keystroke can overwrite newer results.
  const requestId = useRef(0);

  // Avoid setting state after the component has gone away.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchData = useCallback(
    async (fetchParams: TParams) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const result = await fnRef.current(supabase, fetchParams);
        if (!mounted.current || id !== requestId.current) return;
        setData(result);
      } catch (err) {
        if (!mounted.current || id !== requestId.current) return;
        setError(describeSupabaseError(err));
        captureError(err, "query");
      } finally {
        // Only the newest request may clear the spinner; a stale one finishing
        // must not make a still-pending request look finished.
        if (mounted.current && id === requestId.current) setLoading(false);
      }
    },
    [supabase]
  );

  // `params` is usually an inline object too, so compare it by value.
  const paramsKey = JSON.stringify(params);

  useEffect(() => {
    if (skip) return;
    void fetchData(JSON.parse(paramsKey) as TParams);
  }, [fetchData, paramsKey, skip]);

  const refetch = useCallback(
    async (nextParams?: TParams) =>
      fetchData(nextParams ?? (JSON.parse(paramsKey) as TParams)),
    [fetchData, paramsKey]
  );

  // A query that is *about to* run counts as loading.
  //
  // `loading` only becomes true once the effect fires, so when `skip` flips
  // from true to false there is one render where nothing is loading and `data`
  // is still null — long enough to paint an empty state before the first
  // request has even been issued. Screens were compensating for this with
  // extra `!user?.id` conditions in their skeleton branches; deriving it here
  // means they no longer have to.
  const pending = !skip && data === null && error === null;

  return {
    data,
    loading: loading || pending,
    // Once something has been rendered, later refetches should not blank it.
    initialLoading: (loading || pending) && data === null,
    error,
    refetch,
  };
}
