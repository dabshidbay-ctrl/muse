import { useCallback, useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describeSupabaseError, useSupabaseClient } from "./supabase";
import { captureError } from "./sentry";

/**
 * A list that grows a page at a time.
 *
 * The browse screens used to ask for a flat `limit: 40` and render whatever came
 * back. Past forty listings the rest were simply absent — no "load more", no
 * notice, no symptom. To a seller whose item fell off the end that reads as
 * "my listing disappeared", which is a much worse bug than a slow list.
 *
 * `hasMore` is inferred from the size of the last page: a page shorter than
 * `pageSize` is the last one. That costs nothing, unlike asking PostgREST for
 * an exact count on every keystroke.
 */
type PagedOptions<TParams, TItem> = {
  fn: (
    supabase: SupabaseClient,
    params: TParams & { limit: number; offset: number }
  ) => Promise<TItem[]>;
  params?: TParams;
  pageSize?: number;
  skip?: boolean;
};

type PagedResult<TItem> = {
  items: TItem[];
  /** True only for the first page, when there is nothing on screen yet. */
  initialLoading: boolean;
  /** True while a *further* page is being fetched. */
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  loadMore: () => void;
  /** Re-runs from page one, keeping the current filters. */
  refresh: () => Promise<void>;
};

export function usePagedQuery<TParams extends object, TItem>({
  fn,
  params = {} as TParams,
  pageSize = 24,
  skip = false,
}: PagedOptions<TParams, TItem>): PagedResult<TItem> {
  const supabase = useSupabaseClient();
  const [items, setItems] = useState<TItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [loadedOnce, setLoadedOnce] = useState(false);

  // Callers pass an inline arrow; a ref keeps its changing identity from
  // restarting the list on every render.
  const fnRef = useRef(fn);
  fnRef.current = fn;

  // The last request wins, not the last to resolve — a slow page 1 must not
  // overwrite the page 1 issued after a filter changed.
  const requestId = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Compared by value: `params` is almost always an inline object.
  const paramsKey = JSON.stringify(params);

  const fetchPage = useCallback(
    async (offset: number) => {
      const id = ++requestId.current;
      if (offset === 0) setLoading(true);
      else setLoadingMore(true);
      setError(null);
      try {
        const parsed = JSON.parse(paramsKey) as TParams;
        const page = await fnRef.current(supabase, {
          ...parsed,
          limit: pageSize,
          offset,
        });
        if (!mounted.current || id !== requestId.current) return;
        // A short page means the end; an exactly-full one might not be, so we
        // keep offering "load more" until a page comes back short or empty.
        setHasMore(page.length === pageSize);
        setItems((prev) => (offset === 0 ? page : [...prev, ...page]));
        setLoadedOnce(true);
      } catch (err) {
        if (!mounted.current || id !== requestId.current) return;
        setError(describeSupabaseError(err));
        captureError(err, "paged-query");
        setLoadedOnce(true);
      } finally {
        if (mounted.current && id === requestId.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [supabase, paramsKey, pageSize]
  );

  // Filters changed: start again from the top rather than appending page 2 of
  // the old query onto page 1 of the new one.
  useEffect(() => {
    if (skip) return;
    setItems([]);
    setHasMore(true);
    setLoadedOnce(false);
    void fetchPage(0);
  }, [fetchPage, skip]);

  const loadMore = useCallback(() => {
    // Guarded rather than debounced: FlatList fires onEndReached more than once
    // near the bottom, and each extra call would append a duplicate page.
    if (loading || loadingMore || !hasMore || skip) return;
    void fetchPage(items.length);
  }, [loading, loadingMore, hasMore, skip, fetchPage, items.length]);

  const refresh = useCallback(async () => {
    await fetchPage(0);
  }, [fetchPage]);

  return {
    items,
    // `loadedOnce` is what stops an empty state flashing before the first
    // request has been issued.
    initialLoading: !skip && !loadedOnce,
    loadingMore,
    error,
    hasMore,
    loadMore,
    refresh,
  };
}
