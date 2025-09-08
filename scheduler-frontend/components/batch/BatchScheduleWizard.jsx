/* components/batch/BatchScheduleWizard.jsx */
import React, { useMemo, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  batchPreflight,
  batchCommit,
  listMedia,
  normalizeFolderPrefix,
} from "@/components/api/PostsClient";
import { useLocation, useSearchParams } from "react-router-dom";

/* ---------- helpers ---------- */

function useResolvedAccountId(explicitId) {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  return useMemo(() => {
    const qp = searchParams.get("account_id");
    const ls = Number(localStorage.getItem("selectedAccountId"));
    return (
      explicitId ??
      location.state?.accountId ??
      (qp ? Number(qp) : null) ??
      (Number.isFinite(ls) ? ls : null)
    );
  }, [explicitId, location.state, searchParams]);
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));



function splitIntoWeekChunks(startISO, endISO) {
  const chunks = [];
  let s = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  let idx = 0;
  while (s <= end) {
    const e = addDays(s, 6);
    chunks.push({
      index: idx++,
      startISO: iso(s),
      endISO: iso(e < end ? e : end),
    });
    s = addDays(e, 1);
  }
  return chunks;
}

function defaultPerDayForWeekIndex(i) {
  if (i < 2) return 3;
  if (i < 4) return 6;
  if (i < 6) return 10;
  return 15;
}

function weeklyPlanFromDaily(n) {
  const d = clamp(Number(n || 0), 0, 15);
  return { mon: d, tue: d, wed: d, thu: d, fri: d, sat: d, sun: d };
}

/** Turn API error into a readable string */
function formatApiError(err) {
  const detail = err?.data?.detail ?? err?.detail ?? err;
  if (Array.isArray(detail)) {
    return detail
      .map((e) => {
        const loc = Array.isArray(e?.loc) ? e.loc.join(".") : "";
        return [loc, e?.msg].filter(Boolean).join(": ");
      })
      .join("; ");
  }
  if (detail && typeof detail === "object") {
    if (detail.msg) {
      const loc = Array.isArray(detail.loc) ? detail.loc.join(".") : "";
      return [loc, detail.msg].filter(Boolean).join(": ");
    }
    try { return JSON.stringify(detail); } catch { return String(detail); }
  }
  return String(detail ?? err?.message ?? "Unknown error");
}

/* ---------- component ---------- */

export default function BatchScheduleWizard({
  account, // optional { id }
  timezone = "UTC",
  open = true, 
  onClose,
  onCommitted,
}) {
  const accountId = useResolvedAccountId(account?.id);

  // Step 1
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [useFolder, setUseFolder] = useState(true);
  const [folderPrefix, setFolderPrefix] = useState("");
  const [sort, setSort] = useState("alpha"); // alpha | date | random
  const [order, setOrder] = useState("asc"); // asc | desc
  const [extensions, setExtensions] = useState("jpg,jpeg,png,webp,mp4,mov,heic,HEIC");
  const [seed, setSeed] = useState("");
  const [manualMedia, setManualMedia] = useState("");
  const [randStart, setRandStart] = React.useState("00:01"); // default 12:01 am
  const [randEnd, setRandEnd] = React.useState("23:59");     // default 11:59 pm
  const [resolvedMedia, setResolvedMedia] = useState([]);
  const [videoMode, setVideoMode] = useState("feed_and_reels");

  // Step 2
  const [weekChunks, setWeekChunks] = useState([]);
  const [perDayByWeek, setPerDayByWeek] = useState([]);

  // Step 3
  const [slotsPerWeek, setSlotsPerWeek] = useState([]);

  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const haveDates = Boolean(startDate && endDate);
  const autoshift = true;
  const minSpacingMinutes = 15;

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  function parseManualMedia(text) {
    return text
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // simple seeded RNG for deterministic shuffle preview
  function seededRNG(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return () => {
      h = (h + 0x6d2b79f5) | 0;
      let t = Math.imul(h ^ (h >>> 15), 1 | h);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }


  const resolveMediaFromFolder = async () => {
    const raw = (folderPrefix || "").trim();
    const prefix = normalizeFolderPrefix(raw);
    const backendSort = sort === "random" ? "alpha" : (sort === "date" ? "modified" : sort);

    const res = await listMedia({
      prefix,
      sort: backendSort,
      order,
      extensions,
      limit: 5000,
    });

    const items = Array.isArray(res) ? res : (res?.items || []);
    let urls = items.map((it) => it.url);

    if (sort === "random") {
      const rng = seededRNG(seed || `${prefix}:${items.length}`);
      urls = urls.map((u) => [u, rng()]).sort((a, b) => a[1] - b[1]).map(([u]) => u);
    }
    return urls;
  };


  /* Step 1 -> Step 2 */
  async function handleStep1Continue() {
    try {
      setError("");
      if (!accountId) {
        setError("Please select an account first.");
        return;
      }
      if (!haveDates) {
        setError("Please choose a start and end date.");
        return;
      }
      setLoading(true);

      const media = useFolder
        ? await resolveMediaFromFolder()
        : parseManualMedia(manualMedia);

      setResolvedMedia(media);

      const chunks = splitIntoWeekChunks(startDate, endDate);
      setWeekChunks(chunks);
      setPerDayByWeek(chunks.map((_, i) => defaultPerDayForWeekIndex(i)));

      setStep(2);
    } catch (e) {
      console.error(e);
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }

  /* Step 2 -> Step 3 */
  async function onCalcPreview() {
    try {
      setError("");
      setLoading(true);

      const perWeekSlots = [];
      for (let i = 0; i < weekChunks.length; i++) {
        const c = weekChunks[i];
        const perDay = clamp(Number(perDayByWeek[i] ?? 0), 0, 15);

        const payload = {
          account_id: accountId,
          start_date: c.startISO,
          end_date: c.endISO,
          weekly_plan: weeklyPlanFromDaily(perDay),
          timezone,
          autoshift,
          min_spacing_minutes: minSpacingMinutes,
          media_urls: [], // not needed for slot calc
        };

        const pf = await batchPreflight(payload);
        perWeekSlots.push(Array.isArray(pf?.slots) ? pf.slots.length : 0);
      }

      setSlotsPerWeek(perWeekSlots);
      setStep(3);
    } catch (e) {
      console.error(e);
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }

  async function onCommit() {
    try {
      setError("");
      setLoading(true);

      // Make a working copy of media so we can slice per week.
      const mediaPool = [...resolvedMedia];

      for (let i = 0; i < weekChunks.length; i++) {
        const c = weekChunks[i];
        const perDay = clamp(Number(perDayByWeek[i] ?? 0), 0, 15);
        if (perDay === 0) continue;

        const weekly_plan = weeklyPlanFromDaily(perDay);
        const need = slotsPerWeek[i] || 0;
        const media_urls = mediaPool.splice(0, need);
        if (!media_urls.length) break;

        const payload = {
          account_id: accountId,
          start_date: c.startISO,
          end_date: c.endISO,
          weekly_plan,
          timezone,
          autoshift,
          min_spacing_minutes: minSpacingMinutes,
          media_urls, // ✅ what the backend expects
          video_mode: videoMode, // NEW: "feed_and_reels" | "reels_only"
          random_start: randStart, // "HH:MM"
          random_end: randEnd,     // "HH:MM"
        };

        await batchCommit(payload);
      }
      if (typeof onCommitted === "function") {
        await onCommitted();  
      }
      onClose?.();
    } catch (e) {
      console.error(e);
      setError(formatApiError(e));
    } finally {
      setLoading(false);
    }
  }

  /* ---------- render ---------- */

  function renderStep1() {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-3">Batch schedule</h2>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm">Start date</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className="text-sm">End date</label>
            <input
              type="date"
              className="w-full border rounded px-2 py-1"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
        </div>

        <div className="mt-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={useFolder}
              onChange={(e) => setUseFolder(e.target.checked)}
            />
            <span>Use R2 folder prefix</span>
          </label>

          {useFolder ? (
            <div className="space-y-2 mt-2">
              <p className="text-xs text-muted-foreground">
                Using prefix:{" "}
                <code>{normalizeFolderPrefix(folderPrefix || "")}</code>
              </p>

              <input
                className="w-full border rounded px-2 py-1"
                placeholder="e.g. tests/A3/Unposted/"
                value={folderPrefix}
                onChange={(e) => setFolderPrefix(e.target.value)}
              />
              <div className="grid grid-cols-3 gap-2">
                <select
                  className="border rounded px-2 py-1"
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                >
                  <option value="alpha">Alphabetical</option>
                  <option value="date">Last modified</option>
                  <option value="random">Random</option>
                </select>
                <select
                  className="border rounded px-2 py-1"
                  value={order}
                  onChange={(e) => setOrder(e.target.value)}
                  disabled={sort === "random"}
                >
                  <option value="asc">Ascending</option>
                  <option value="desc">Descending</option>
                </select>
                <input
                  className="border rounded px-2 py-1"
                  placeholder="Optional seed"
                  value={seed}
                  onChange={(e) => setSeed(e.target.value)}
                  disabled={sort !== "random"}
                />
              </div>
              <input
                className="w-full border rounded px-2 py-1"
                placeholder="Extensions (csv)"
                value={extensions}
                onChange={(e) => setExtensions(e.target.value)}
              />
            </div>
          ) : (
            <textarea
              className="w-full border rounded px-2 py-1 mt-2 min-h-[120px]"
              placeholder="Paste media URLs (newline-separated)…"
              value={manualMedia}
              onChange={(e) => setManualMedia(e.target.value)}
            />
          )}
        </div>
        
        {/* Video destination policy for this batch (videos only) */}
        <div className="mt-4 p-3 rounded border">
          <div className="text-sm font-medium mb-1">For videos scheduled in this batch</div>
          <label className="flex items-center gap-2 mb-1">
            <input
              type="radio"
              name="batchVideoMode"
              checked={videoMode === "feed_and_reels"}
              onChange={() => setVideoMode("feed_and_reels")}
            />
            <span className="text-sm">Post videos to main feed and Reels</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="batchVideoMode"
              checked={videoMode === "reels_only"}
              onChange={() => setVideoMode("reels_only")}
            />
            <span className="text-sm">Post videos to Reels only</span>
          </label>
          <div className="text-xs text-muted-foreground mt-1">
            Carousels aren’t supported in batch mode.
          </div>
        </div>

        {error && <p className="text-red-600 mt-3">{String(error)}</p>}

        <div className="mt-6 flex justify-end">
          <button
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            onClick={handleStep1Continue}
            disabled={loading}
          >
            {loading ? "Loading…" : "Preview schedule"}
          </button>
        </div>
      </div>
    );
  }

  function renderStep2() {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-3">Per-week posts per day</h2>
        <p className="text-sm text-muted-foreground mb-3">
          Defaults: weeks 1–2 = 3/day, weeks 3–4 = 6/day, weeks 5–6 = 10/day, week 7+ = 15/day.
        </p>

        <div className="mb-4 p-3 rounded border">
          <div className="font-medium mb-2">Randomize times between</div>
          <div className="flex items-center gap-2">
            <input
              type="time"
              value={randStart}
              onChange={(e) => setRandStart(e.target.value)}
              className="border rounded px-2 py-1"
            />
            <span>and</span>
            <input
              type="time"
              value={randEnd}
              onChange={(e) => setRandEnd(e.target.value)}
              className="border rounded px-2 py-1"
            />
            <button
              type="button"
              className="ml-2 text-sm underline"
              onClick={() => { setRandStart("00:01"); setRandEnd("23:59"); }}
            >
              Reset to full day
            </button>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Each day’s posts are randomized within this local window before spacing/autoshift rules apply.
          </div>
        </div>

        <div className="space-y-2 max-h-[50vh] overflow-auto pr-1">
          {weekChunks.map((c, i) => (
            <div
              key={i}
              className="flex items-center justify-between gap-3 border rounded px-3 py-2"
            >
              <div className="text-sm">
                <div className="font-medium">Week {i + 1}</div>
                <div className="text-muted-foreground">{`${c.startISO} → ${c.endISO}`}</div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm">Posts per day</span>
                <input
                  type="number"
                  min={0}
                  max={15}
                  className="w-24 border rounded px-2 py-1"
                  value={perDayByWeek[i] ?? 0}
                  onChange={(e) => {
                    const v = clamp(parseInt(e.target.value || "0", 10), 0, 15);
                    const next = perDayByWeek.slice();
                    next[i] = v;
                    setPerDayByWeek(next);
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {error && <p className="text-red-600 mt-3">{String(error)}</p>}

        <div className="mt-6 flex justify-between">
          <button className="px-3 py-2 rounded border" onClick={() => setStep(1)}>
            Back
          </button>
          <button
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            onClick={onCalcPreview}
            disabled={loading}
          >
            {loading ? "Calculating…" : "Continue"}
          </button>
        </div>
      </div>
    );
  }

  function renderStep3() {
    const totalPlanned = slotsPerWeek.reduce((a, b) => a + b, 0);
    const totalMedia = resolvedMedia.length;
    const short = totalPlanned > totalMedia;

    return (
      <div>
        <h2 className="text-lg font-semibold mb-3">Final check</h2>

        <div className="space-y-2">
          <div className="border rounded px-3 py-2">
            <div className="font-medium">Media found</div>
            <div className="text-sm text-muted-foreground">{totalMedia}</div>
          </div>
          <div className="border rounded px-3 py-2">
            <div className="font-medium">Posts planned</div>
            <div className="text-sm text-muted-foreground">{totalPlanned}</div>
          </div>
          <div className="border rounded px-3 py-2">
            <div className="font-medium mb-1">Per-week breakdown</div>
            <ul className="text-sm text-muted-foreground list-disc pl-5">
              {weekChunks.map((c, i) => (
                <li key={i}>
                  Week {i + 1} ({c.startISO} → {c.endISO}): {slotsPerWeek[i] || 0} posts (
                  {perDayByWeek[i] ?? 0}/day)
                </li>
              ))}
            </ul>
          </div>
        </div>

        {short && (
          <p className="text-red-600 mt-3">
            Not enough media to satisfy planned posts. Add more media or reduce per-day values.
          </p>
        )}
        {error && <p className="text-red-600 mt-3">{String(error)}</p>}

        <div className="mt-6 flex justify-between">
          <button className="px-3 py-2 rounded border" onClick={() => setStep(2)}>
            Back
          </button>
          <button
            className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            disabled={loading || short || slotsPerWeek.every((n) => !n)}
            onClick={onCommit}
          >
            {loading ? "Scheduling…" : "Commit batch"}
          </button>
        </div>
      </div>
    );
  }

  const content = (
    <div className="p-4">
      {step === 1 && renderStep1()}
      {step === 2 && renderStep2()}
      {step === 3 && renderStep3()}
    </div>
  );

  // ---------------- modal overlay via portal ----------------
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={() => onClose?.()}
      />
      {/* Panel */}
      <div 
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-2xl mx-4 rounded-2xl bg-white text-black shadow-xl border border-gray-200"
        style={{ colorScheme: "light" }} 
        onClick={(e) => e.stopPropagation()} // prevent backdrop click
      >
        {/* Top bar with close */}
        <div className="flex items-center justify-between px-4 py-3 border-b dark:border-zinc-800">
          <div className="text-base font-semibold">Batch schedule</div>
          <button
            onClick={() => onClose?.()}
            className="rounded p-1 hover:bg-black/5 dark:hover:bg-white/10"
            aria-label="Close"
            title="Close"
          >
            ×
          </button>
        </div>

        {content}
      </div>
    </div>,
    document.body
  );
}
