import React from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { batchPreflight, batchCommit } from "@/components/api/PostsClient";

/**
 * Backend-owned batch scheduling wizard.
 * - Preflight -> /api/posts/batch_preflight
 * - Commit    -> /api/posts/batch_commit
 *
 * Server contract (main.py):
 *   batch_preflight: { slots: [iso...], conflicts: [iso...] }
 *   batch_commit:    { ok: true, created: N }
 */

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function clamp01x15(n) {
  const x = parseInt(n, 10);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(15, x));
}

export default function BatchScheduleWizard({
  open,
  onClose,
  selectedAccount,
  onCommitted,
}) {
  const [step, setStep] = React.useState(1);
  const [startDate, setStartDate] = React.useState(
    format(new Date(), "yyyy-MM-dd")
  );
  const [endDate, setEndDate] = React.useState(
    format(new Date(Date.now() + 27 * 86400_000), "yyyy-MM-dd")
  );
  const [weekdayPlan, setWeekdayPlan] = React.useState([2, 2, 2, 2, 2, 1, 0]); // Mon..Sun
  const [mediaUrlsText, setMediaUrlsText] = React.useState("");

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [preflight, setPreflight] = React.useState(null);

  // Helpers
  const tz = selectedAccount?.timezone || "UTC";
  const accountId = selectedAccount?.id;

  const totalPerWeek = weekdayPlan.reduce((a, b) => a + clamp01x15(b), 0);

  async function doPreflight() {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        account_id: accountId,
        start_date: startDate, // YYYY-MM-DD
        end_date: endDate,     // YYYY-MM-DD
        weekly_plan: weekdayPlan.map(clamp01x15), // list[7] starting Monday
        timezone: tz,
      };
      const res = await batchPreflight(payload); // {slots, conflicts}
      setPreflight(res || { slots: [], conflicts: [] });
      setStep(3);
    } catch (e) {
      setError(e?.message || "Preflight failed");
    } finally {
      setLoading(false);
    }
  }

  async function doCommit({ override = false } = {}) {
    setLoading(true);
    setError(null);
    try {
      const media_urls = mediaUrlsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        account_id: accountId,
        start_date: startDate,
        end_date: endDate,
        weekly_plan: weekdayPlan.map(clamp01x15),
        timezone: tz,
        media_urls,
        override_conflicts: !!override,
      };
      const res = await batchCommit(payload); // {ok, created}
      if (!res?.ok) throw new Error("Commit failed");
      onCommitted?.();
      onClose?.();
    } catch (e) {
      setError(e?.message || "Commit failed");
    } finally {
      setLoading(false);
    }
  }

  // ---------- UI sections ----------
  const sectionPlan = (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label>Start date</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div>
          <Label>End date</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>

      <div>
        <Label>Posts per weekday (max 15 / day)</Label>
        <div className="mt-2 grid grid-cols-7 gap-2">
          {WEEKDAY_NAMES.map((name, i) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <span className="text-xs text-gray-600">{name}</span>
              <Input
                type="number"
                min="0"
                max="15"
                className="w-16 text-center"
                value={weekdayPlan[i]}
                onChange={(e) => {
                  const next = [...weekdayPlan];
                  next[i] = clamp01x15(e.target.value);
                  setWeekdayPlan(next);
                }}
              />
            </div>
          ))}
        </div>
        <p className="text-xs text-gray-500 mt-2">
          ≈ <b>{totalPerWeek}</b> posts/week • Timezone:{" "}
          <b>{tz}</b>
        </p>
      </div>

      <div>
        <Label htmlFor="media-urls">Media URLs (optional; newline-separated)</Label>
        <textarea
          id="media-urls"
          className="mt-2 w-full min-h-[100px] rounded border p-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
          placeholder="https://example.com/image1.jpg
https://example.com/image2.jpg"
          value={mediaUrlsText}
          onChange={(e) => setMediaUrlsText(e.target.value)}
        />
        <p className="text-xs text-gray-500 mt-1">
          If empty, the backend will insert placeholders you can replace later.
        </p>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );

  const sectionReview = (
    <div className="space-y-4">
      <div className="p-3 rounded-md bg-gray-50 text-sm">
        <div>
          Proposed slots:{" "}
          <Badge variant="secondary">
            {preflight?.slots?.length ?? 0}
          </Badge>
        </div>
        <div className="mt-1">
          Conflicts detected:{" "}
          <Badge variant={(preflight?.conflicts?.length ?? 0) > 0 ? "destructive" : "secondary"}>
            {preflight?.conflicts?.length ?? 0}
          </Badge>
        </div>
      </div>

      {Array.isArray(preflight?.conflicts) && preflight.conflicts.length > 0 && (
        <div className="p-3 rounded-md bg-yellow-50 text-sm">
          <div className="font-medium mb-1">Conflicting times (first 20)</div>
          <div className="flex flex-wrap gap-2">
            {preflight.conflicts.slice(0, 20).map((iso, i) => (
              <Badge key={i} variant="secondary">
                {new Date(iso).toLocaleString()}
              </Badge>
            ))}
            {preflight.conflicts.length > 20 && (
              <Badge variant="secondary">
                +{preflight.conflicts.length - 20} more
              </Badge>
            )}
          </div>
          <p className="text-xs text-gray-600 mt-2">
            You can still commit with “Ignore conflicts”; the server won’t shift
            times — it will insert as requested. Use with care.
          </p>
        </div>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );

  const body = step === 1 ? sectionPlan : sectionReview;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Batch schedule</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">{body}</div>

        <DialogFooter className="flex justify-between">
          <Button variant="ghost" onClick={() => onClose?.()}>Cancel</Button>
          <div className="flex items-center gap-2">
            {step === 1 ? (
              <Button onClick={doPreflight} disabled={loading || !accountId}>
                {loading ? "Checking..." : "Preview schedule"}
              </Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setStep(1)} disabled={loading}>
                  Back
                </Button>
                <Button
                  className="bg-gradient-to-r from-purple-500 to-pink-500 text-white"
                  onClick={() => doCommit({ override: false })}
                  disabled={loading}
                >
                  {loading ? "Scheduling..." : "Commit"}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => doCommit({ override: true })}
                  disabled={loading}
                  title="Insert even if the preflight found conflicts (no shifting)."
                >
                  Commit (Ignore conflicts)
                </Button>
              </>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
