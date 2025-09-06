// components/hooks/useRangedPosts.js
import React from "react";
import { fetchPostsRange } from "@/components/api/PostsClient";

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
    if (ScheduledPost?.list) return await ScheduledPost.list();
  } catch {}
  return null;
}

// Simple in-memory cache: key = accountId|startISO|endISO
const cache = new Map();

export function useRangedPosts({
  accountId,
  startISO,
  endISO,
  fallbackAllPosts = [],
  allowListFallback = false,
}) {
  const key = `${String(accountId)}|${startISO}|${endISO}`;
  const [posts, setPosts] = React.useState(() => cache.get(key) || []);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [version, setVersion] = React.useState(0);

  const load = React.useCallback(async () => {
    if (!accountId || !startISO || !endISO) {
      setPosts([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // 1) backend range endpoint
      const ranged = await fetchPostsRange({ accountId, startISO, endISO });
      if (Array.isArray(ranged)) {
        cache.set(key, ranged);
        setPosts(ranged);
        return;
      }

      // 2) optional fallbacks
      if (allowListFallback) {
        let all =
          (Array.isArray(fallbackAllPosts) && fallbackAllPosts.length > 0
            ? fallbackAllPosts
            : await tryListAllPostsFromEntity()) || [];

        const filtered = all.filter((p) => {
          const pid =
            p.account_id ?? p.accountId ?? p.account?.id ?? p.owner_id;
          const when = p.scheduled_at ?? p.scheduledAt ?? p.time ?? p.when;
          return (
            String(pid) === String(accountId) &&
            when &&
            isWithinRange(when, startISO, endISO)
          );
        });

        cache.set(key, filtered);
        setPosts(filtered);
        return;
      }

      setPosts([]);
    } catch (e) {
      setError(e?.message || "Failed to load posts");
    } finally {
      setLoading(false);
    }
  }, [accountId, startISO, endISO, key, fallbackAllPosts, allowListFallback]);

  React.useEffect(() => { load(); }, [load, version]);
  const refetch = () => setVersion((v) => v + 1);

  return { posts, loading, error, refetch };
}
