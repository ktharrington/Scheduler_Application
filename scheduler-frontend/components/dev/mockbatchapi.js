// components/dev/mockbatchapi.js
import React from "react";

export default function MockBatchApi() {
  React.useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const mockParam = (urlParams.get("mock") || "").toLowerCase();
    const byParam = mockParam === "1" || mockParam === "true" || mockParam.includes("batch") || mockParam === "all";
    const byLS = localStorage.getItem("mock_batch_api") === "true";
    const byGlobal = typeof window !== "undefined" && window.__MOCK_BATCH_API__ === true;
    const active = byParam || byLS || byGlobal;

    if (!active) return;

    (async () => {
      const g = window;

      // Try to load an optional Entities/ScheduledPost (ignore if missing)
      let ScheduledPost = null;
      try {
        const mod =
          (await import("@/Entities/ScheduledPost").catch(() => null)) ||
          (await import("@/entities/ScheduledPost").catch(() => null));
        ScheduledPost = mod?.ScheduledPost || mod?.default || null;
      } catch {
        ScheduledPost = null;
      }

      // In-memory store (persists until full page reload)
      const mockStore =
        g.__MOCK_SCHEDULED_POSTS_STORE__ ||
        (g.__MOCK_SCHEDULED_POSTS_STORE__ = { posts: [], nextId: 1 });

      const clone = (o) => JSON.parse(JSON.stringify(o));
      const nowISO = () => new Date().toISOString();
      const assignId = () => mockStore.nextId++;

      // Simple range cache
      const rangeCache = g.__MOCK_RANGE_CACHE__ || (g.__MOCK_RANGE_CACHE__ = new Map());
      const invalidateRangeCache = (accountId) => {
        if (!accountId) return rangeCache.clear();
        for (const k of Array.from(rangeCache.keys())) {
          if (k.startsWith(`${String(accountId)}|`)) rangeCache.delete(k);
        }
      };

      // If an SDK exists, patch it (optional, no-op otherwise)
      if (ScheduledPost && !g.__MOCK_SDK_PATCHED__) {
        g.__ORIG_SCHEDULEDPOST_SDK__ = {
          list: ScheduledPost.list?.bind(ScheduledPost),
          create: ScheduledPost.create?.bind(ScheduledPost),
          bulkCreate: ScheduledPost.bulkCreate?.bind(ScheduledPost),
          update: ScheduledPost.update?.bind(ScheduledPost),
          delete: ScheduledPost.delete?.bind(ScheduledPost),
        };

        ScheduledPost.list = async () =>
          clone(mockStore.posts).sort(
            (a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at)
          );
        ScheduledPost.create = async (data) => {
          const id = assignId();
          const rec = { id, created_date: nowISO(), updated_date: nowISO(), created_by: "mock@local", ...clone(data) };
          mockStore.posts.push(rec);
          invalidateRangeCache(rec.account_id);
          return rec;
        };
        ScheduledPost.bulkCreate = async (arr) => {
          const created = [];
          let accId = null;
          for (const data of arr || []) {
            const id = assignId();
            const rec = { id, created_date: nowISO(), updated_date: nowISO(), created_by: "mock@local", ...clone(data) };
            mockStore.posts.push(rec);
            created.push(rec);
            accId = accId || rec.account_id;
          }
          invalidateRangeCache(accId);
          return created;
        };
        ScheduledPost.update = async (id, data) => {
          const i = mockStore.posts.findIndex((p) => String(p.id) === String(id));
          if (i === -1) return null;
          mockStore.posts[i] = { ...mockStore.posts[i], ...clone(data), updated_date: nowISO() };
          invalidateRangeCache(mockStore.posts[i].account_id);
          return mockStore.posts[i];
        };
        ScheduledPost.delete = async (id) => {
          const i = mockStore.posts.findIndex((p) => String(p.id) === String(id));
          const accId = i >= 0 ? mockStore.posts[i].account_id : null;
          if (i >= 0) mockStore.posts.splice(i, 1);
          invalidateRangeCache(accId);
          return { id };
        };

        g.__MOCK_SDK_PATCHED__ = true;
      }

      // Helpers for fetch mocks
      const ok = (obj) =>
        new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json" } });
      const err = (msg, code = 400) => new Response(msg, { status: code });
      const toYMD = (d) => {
        const z = new Date(d);
        z.setHours(0, 0, 0, 0);
        return z.toISOString().slice(0, 10);
      };
      const startOfISOWeek = (d) => {
        const z = new Date(d);
        const dow = z.getDay();
        const offset = (dow + 6) % 7;
        z.setDate(z.getDate() - offset);
        z.setHours(0, 0, 0, 0);
        return z;
      };
      const addDays = (d, n) => {
        const z = new Date(d);
        z.setDate(z.getDate() + n);
        z.setHours(0, 0, 0, 0);
        return z;
      };
      const snapTo15 = (m) => Math.max(0, Math.min(24 * 60 - 15, m - (m % 15)));
      const minutesToISOOnDay = (day, minutes) => {
        const z = new Date(day);
        z.setHours(0, 0, 0, 0);
        const h = Math.floor(minutes / 60);
        const mi = minutes % 60;
        z.setHours(h, mi, 0, 0);
        return z.toISOString();
      };
      const generateTimesPerDay = (count) => {
        const start = 8 * 60;
        const end = 22 * 60 + 45;
        const span = end - start;
        if (count <= 0) return [];
        const step = Math.floor(span / (count + 1));
        const times = [];
        for (let i = 1; i <= count; i++) times.push(snapTo15(start + i * step));
        return times;
      };

      // Patch fetch once
      const origFetch = g.__ORIG_FETCH__ || window.fetch.bind(window);
      if (!g.__MOCK_FETCH_PATCHED__) {
        g.__ORIG_FETCH__ = origFetch;
        window.fetch = async (input, init = {}) => {
          try {
            const url = typeof input === "string" ? input : input.url || "";
            const method = (init.method || "GET").toUpperCase();

            // /api/posts/query
            if (url.includes("/api/posts/query") && method === "GET") {
              const u = new URL(url, window.location.origin);
              const accountId = (u.searchParams.get("account_id") || "").trim();
              const start = (u.searchParams.get("start") || "").trim();
              const end = (u.searchParams.get("end") || "").trim();
              if (!accountId || !start || !end) return ok({ posts: [] });
              const key = `${accountId}|${start}|${end}`;
              if (rangeCache.has(key)) return ok({ posts: rangeCache.get(key) });
              const sT = new Date(start).getTime();
              const eT = new Date(end).getTime();
              const filtered = mockStore.posts
                .filter((p) => String(p.account_id) === String(accountId))
                .filter((p) => {
                  const t = new Date(p.scheduled_at).getTime();
                  return t >= sT && t <= eT;
                })
                .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
              rangeCache.set(key, clone(filtered));
              return ok({ posts: filtered });
            }

            // POST /api/posts (create)
            if (url.endsWith("/api/posts") && method === "POST") {
              let body = {};
              try { body = JSON.parse(init.body || "{}"); } catch {}
              const id = assignId();
              const rec = {
                id,
                created_date: nowISO(),
                updated_date: nowISO(),
                created_by: "mock@local",
                account_id: String(body.account_id || ""),
                media_url:
                  body.media_url ||
                  `https://picsum.photos/seed/${encodeURIComponent(`mock-${id}`)}/1080/1080`,
                media_type: body.media_type || "photo",
                caption: body.caption || "",
                first_comment: body.first_comment || "",
                scheduled_at: body.scheduled_at || nowISO(),
                status: body.status || "scheduled",
                client_request_id: body.client_request_id || null,
              };
              mockStore.posts.push(rec);
              invalidateRangeCache(rec.account_id);
              return ok(rec);
            }

            // PATCH /api/posts/:id
            if (url.match(/\/api\/posts\/\d+$/) && method === "PATCH") {
              const m = url.match(/\/api\/posts\/(\d+)$/);
              const id = m ? Number(m[1]) : null;
              let body = {};
              try { body = JSON.parse(init.body || "{}"); } catch {}
              const i = mockStore.posts.findIndex((p) => String(p.id) === String(id));
              if (i === -1) return err("Not found", 404);
              mockStore.posts[i] = { ...mockStore.posts[i], ...body, updated_date: nowISO() };
              invalidateRangeCache(mockStore.posts[i].account_id);
              return ok(mockStore.posts[i]);
            }

            // POST /api/posts/:id/cancel
            if (url.match(/\/api\/posts\/\d+\/cancel$/) && method === "POST") {
              const m = url.match(/\/api\/posts\/(\d+)\/cancel$/);
              const id = m ? Number(m[1]) : null;
              const i = mockStore.posts.findIndex((p) => String(p.id) === String(id));
              if (i === -1) return err("Not found", 404);
              const accId = mockStore.posts[i].account_id;
              mockStore.posts.splice(i, 1);
              invalidateRangeCache(accId);
              return ok({ status: "cancelled", id });
            }

            // GET /api/posts/summary
            if (url.includes("/api/posts/summary") && method === "GET") {
              const u = new URL(url, window.location.origin);
              const accountId = (u.searchParams.get("account_id") || "").trim();
              const start = new Date(u.searchParams.get("start") || new Date());
              const end = new Date(u.searchParams.get("end") || new Date());
              const out = {};
              mockStore.posts
                .filter((p) => !accountId || String(p.account_id) === String(accountId))
                .forEach((p) => {
                  const t = new Date(p.scheduled_at);
                  if (t >= start && t <= end) {
                    const ymd = toYMD(t);
                    out[ymd] = (out[ymd] || 0) + 1;
                  }
                });
              return ok(out);
            }

            // GET /api/posts/minmax
            if (url.includes("/api/posts/minmax") && method === "GET") {
              const u = new URL(url, window.location.origin);
              const accountId = (u.searchParams.get("account_id") || "").trim();
              const times = mockStore.posts
                .filter((p) => !accountId || String(p.account_id) === String(accountId))
                .map((p) => new Date(p.scheduled_at).getTime());
              if (times.length === 0) return ok({ min: null, max: null });
              return ok({
                min: new Date(Math.min(...times)).toISOString(),
                max: new Date(Math.max(...times)).toISOString(),
              });
            }

            // GET /api/accounts  — provide some mock accounts like Base44
            if (url.endsWith("/api/accounts") && method === "GET") {
              return ok([
                { id: 1, handle: "mycompany" },
                { id: 2, handle: "travel_adventures" },
                { id: 3, handle: "personal_brand" },
                { id: 4, handle: "mybrand" },
                { id: 5, handle: "mypersonal" },
                { id: 6, handle: "fitfuel" },
                { id: 7, handle: "sunsettravel" },
                { id: 8, handle: "coastalcafe" },
              ]);
            }

            // POST /api/batch/preflight
            if (url.endsWith("/api/batch/preflight") && method === "POST") {
              let body = {};
              try { body = JSON.parse(init.body || "{}"); } catch {}
              const toY = (d) => {
                const z = new Date(d);
                z.setHours(0, 0, 0, 0);
                return z.toISOString().slice(0, 10);
              };
              const start = new Date((body.start_date || toY(new Date())) + "T00:00:00");
              const end = new Date((body.end_date || toY(new Date())) + "T00:00:00");
              const weeklyPlan = body.weekly_plan || {};
              const isoStart = startOfISOWeek(start);

              const existingByDay = mockStore.posts
                .filter((p) => String(p.account_id) === String(body.account_id || ""))
                .reduce((acc, p) => {
                  const ymd = toY(new Date(p.scheduled_at));
                  acc[ymd] = (acc[ymd] || 0) + 1;
                  return acc;
                }, {});

              const conflictDates = [];
              let scheduledPoints = 0;
              for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
                const diff = Math.floor((d - isoStart) / 86400000);
                const weekIndex = Math.floor(diff / 7) + 1;
                const perDay = Math.max(0, Math.min(15, parseInt(weeklyPlan?.[weekIndex] || 0, 10) || 0));
                scheduledPoints += perDay;
                const ymd = toY(d);
                if ((existingByDay[ymd] || 0) > 0 && perDay > 0) conflictDates.push(ymd);
              }

              return ok({
                content_available: 500,
                conflict_dates: conflictDates,
                insufficient: false,
                override_conflicts: false,
                scheduled_points: scheduledPoints,
              });
            }

            // POST /api/batch/commit
            if (url.endsWith("/api/batch/commit") && method === "POST") {
              let body = {};
              try { body = JSON.parse(init.body || "{}"); } catch {}
              const toY = (d) => {
                const z = new Date(d);
                z.setHours(0, 0, 0, 0);
                return z.toISOString().slice(0, 10);
              };

              const accountId = String(body.account_id || "");
              const start = new Date((body.start_date || toY(new Date())) + "T00:00:00");
              const end = new Date((body.end_date || toY(new Date())) + "T00:00:00");
              const weeklyPlan = body.weekly_plan || {};
              const override = Boolean(body.override_conflicts);
              const isoStart = startOfISOWeek(start);

              // day -> existing array
              const existingByDay = mockStore.posts
                .filter((p) => String(p.account_id) === accountId)
                .reduce((acc, p) => {
                  const ymd = toY(new Date(p.scheduled_at));
                  acc[ymd] = acc[ymd] || [];
                  acc[ymd].push(p);
                  return acc;
                }, {});

              if (override) {
                for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
                  const ymd = toY(d);
                  const arr = existingByDay[ymd] || [];
                  for (const p of arr) {
                    const i = mockStore.posts.findIndex((x) => x.id === p.id);
                    if (i >= 0) mockStore.posts.splice(i, 1);
                  }
                  existingByDay[ymd] = [];
                }
              }

              let created = 0;
              for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
                const ymd = toY(d);
                const diff = Math.floor((d - isoStart) / 86400000);
                const weekIndex = Math.floor(diff / 7) + 1;
                const perDayWanted = Math.max(
                  0,
                  Math.min(15, parseInt(weeklyPlan?.[weekIndex] || 0, 10) || 0)
                );

                const have = (existingByDay[ymd] || []).length;
                const capacity = Math.max(0, 15 - have);
                const createCount = Math.min(perDayWanted, capacity);
                if (createCount <= 0) continue;

                const times = generateTimesPerDay(createCount);
                times.forEach((mins, idx) => {
                  const id = assignId();
                  const rec = {
                    id,
                    created_date: nowISO(),
                    updated_date: nowISO(),
                    created_by: "mock@local",
                    account_id: accountId,
                    media_url: `https://picsum.photos/seed/${encodeURIComponent(
                      `${accountId}-${ymd}-${idx}-${id}`
                    )}/1080/1080`,
                    media_type: "photo",
                    caption: `[BATCH MOCK] @${accountId} • ${ymd} • #${idx + 1}`,
                    first_comment: "",
                    scheduled_at: minutesToISOOnDay(d, mins),
                    status: "scheduled",
                  };
                  mockStore.posts.push(rec);
                  created += 1;
                });

                existingByDay[ymd] = (existingByDay[ymd] || []).concat(
                  new Array(createCount).fill(null)
                );
              }

              invalidateRangeCache(accountId);
              return ok({ scheduled: created, message: `Mock commit created ${created} posts.` });
            }

            // Pass through anything else
            return origFetch(input, init);
          } catch (e) {
            return err(e?.message || "Mock error", 500);
          }
        };
        g.__MOCK_FETCH_PATCHED__ = true;
        console.log(
          "%cMockBatchApi active (fetch mocks; ScheduledPost SDK override optional)",
          "color: purple; font-weight: bold;"
        );
      }
    })();

    // keep mock until full reload
    return () => {};
  }, []);

  return null;
}
