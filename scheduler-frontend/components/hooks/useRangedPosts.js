// components/hooks/useRangedPosts.js — DROP-IN REPLACEMENT
import React from "react";
import { fetchPostsRange } from "@/components/api/PostsClient";

/** simple utilities */
function isWithinRange(d, start, end) {
  const t = new Date(d).getTime();
  return t >= new Date(start).getTime() && t <= new Date(end).getTime();
}

// Optional, safe dynamic fallback to an entity if it exists
async function tryListAllPostsFromEntity() {
  try {
    const mod =
      (await import("@/entities/ScheduledPost").catch(() => null)) ||
      (await import("@/Entities/ScheduledPost").catch(() => null));
    const ScheduledPost = mod?.ScheduledPost || mod?.default;
    if (!ScheduledPost || typeof ScheduledPost.listAll !== "function") return [];
    const all = await ScheduledPost.listAll();
    return Array.isArray(all) ? all : [];
  } catch {
    return [];
  }
}

/**
 * useRangedPosts
 * @param {object} opts
 * @param {number|string} opts.accountId
 * @param {string} opts.startISO  // inclusive
 * @param {string} opts.endISO    // inclusive
 * @param {string|number} [opts.key] // cache-busting dep you already pass around
 * @param {boolean} [opts.allowListFallback=false] // if API fails, try local entity
 * @param {Array} [opts.fallbackSnapshot] // optional pre-fetched list for quick paint
 */
export function useRangedPosts({
  accountId,
  startISO,
  endISO,
  key,
  allowListFallback = false,
  fallbackSnapshot = null,
}) {
  const [posts, setPosts] = React.useState(() => {
    // seed with snapshot if provided
    if (Array.isArray(fallbackSnapshot)) {
      return fallbackSnapshot.filter(
        (p) =>
          String(p.account_id) === String(accountId) &&
          isWithinRange(p.scheduled_at, startISO, endISO)
      );
    }
    return [];
  });
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [version, setVersion] = React.useState(0);

  const load = React.useCallback(() => {
    // guard missing inputs
    if (!accountId || !startISO || !endISO) {
      setPosts([]);
      setLoading(false);
      setError(null);
      return () => {};
    }

    const controller = new AbortController();
    const { signal } = controller;

    (async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await fetchPostsRange({
          accountId,
          startISO,
          endISO,
          signal,
        });

        // Accept either array or { items }
        const arr = Array.isArray(data) ? data : data?.items || [];

        // Final client-side filter (harmless if server already filtered)
        const filtered = arr.filter(
          (p) =>
            String(p.account_id) === String(accountId) &&
            isWithinRange(p.scheduled_at, startISO, endISO)
        );

        if (!signal.aborted) setPosts(filtered);
      } catch (e) {
        if (signal.aborted) return; // ignore aborts
        if (allowListFallback) {
          const all = await tryListAllPostsFromEntity();
          const fallback = all.filter(
            (p) =>
              String(p.account_id) === String(accountId) &&
              isWithinRange(p.scheduled_at, startISO, endISO)
          );
          if (!signal.aborted) {
            setPosts(fallback);
            setError(null);
            setLoading(false);
            return;
          }
        }
        setError(e);
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [accountId, startISO, endISO, key, allowListFallback, fallbackSnapshot]);

  React.useEffect(() => {
    const cleanup = load();
    return typeof cleanup === "function" ? cleanup : undefined;
  }, [load, version]);

  const refetch = () => setVersion((v) => v + 1);

  return { posts, loading, error, refetch };
}
