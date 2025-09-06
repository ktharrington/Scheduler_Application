// components/calendar/MovePostDialog.jsx
import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const MIN_SPACING = 15; // minutes

// helpers
const minutesOfDay = (hhmm) => {
  if (!hhmm) return 0;
  const [h, m] = String(hhmm).split(":").map(n => parseInt(n, 10) || 0);
  return h * 60 + m;
};
const hhmm = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const ok = (m, taken) => taken.every(t => Math.abs(t - m) >= MIN_SPACING);

// pick a natural (non-grid) minute near the middle of the largest gap, with small jitter
function pickNaturalMinute(taken) {
  const DAY0 = 0, DAY1 = 24*60 - 1;
  const times = [...taken].sort((a,b)=>a-b);
  const pts = [DAY0, ...times, DAY1];

  let bestGap = -1, prev = DAY0, next = DAY1;
  for (let i=0;i<pts.length-1;i++){
    const gap = pts[i+1] - pts[i];
    if (gap > bestGap){ bestGap = gap; prev = pts[i]; next = pts[i+1]; }
  }
  const lower = prev + MIN_SPACING;
  const upper = next - MIN_SPACING;
  if (upper <= lower) return null;

  let candidate = Math.floor((lower + upper) / 2) + (Math.floor(Math.random() * 13) - 6);
  candidate = clamp(candidate, lower, upper);

  if (!ok(candidate, times)) {
    for (let step = 1; step <= 60; step++) {
      const fwd = candidate + step, back = candidate - step;
      if (fwd <= upper && ok(fwd, times)) return fwd;
      if (back >= lower && ok(back, times)) return back;
    }
    return null;
  }
  return candidate;
}

/**
 * Props:
 *  - open, onClose
 *  - dateLabel: 'YYYY-MM-DD'
 *  - otherTimes: string[] of 'HH:mm' (existing that day, excluding this post)
 *  - initialTime: 'HH:mm'
 *  - progressIndex, progressTotal (optional)
 *  - onAutoPickAll (optional)
 *  - onConfirm(hhmm|null)
 */
export default function MovePostDialog({
  open,
  onClose,
  dateLabel,
  otherTimes = [],
  initialTime,
  progressIndex = null,
  progressTotal = null,
  onAutoPickAll = null,
  onConfirm
}) {
  const taken = React.useMemo(() => (otherTimes || []).map(minutesOfDay).sort((a,b)=>a-b), [otherTimes]);

  const [value, setValue] = React.useState(initialTime || "00:00");
  const [conflict, setConflict] = React.useState(false);

  React.useEffect(() => {
    setValue(initialTime || "00:00");
    setConflict(false);
  }, [initialTime, open]);

  const checkConflict = (v) => {
    const m = minutesOfDay(v);
    const c = !ok(m, taken);
    setConflict(c);
    return !c;
  };

  const onTimeChange = (e) => {
    const v = e.target.value || "00:00";
    setValue(v);
    checkConflict(v);
  };

  const autoPickOne = () => {
    const m = pickNaturalMinute(taken);
    if (m == null) return;
    const v = hhmm(m);
    setValue(v);
    setConflict(false);
  };

  const confirm = () => {
    // normal path: block if conflict
    if (!value) return onConfirm?.(null);
    if (!checkConflict(value)) return;
    if (value === initialTime) return onConfirm?.(null);
    onConfirm?.(value);
  };

  const overrideConfirm = () => {
    // override path: allow even if conflict
    if (!value) return onConfirm?.(null);
    onConfirm?.(value);
  };

  return (
    <Dialog open={!!open} onOpenChange={(v) => { if (!v) onClose?.(); }}>
      <DialogContent className="max-w-md w-full">
        <DialogHeader>
          <DialogTitle>
            Move post to {dateLabel}
            {progressIndex != null && progressTotal != null && (
              <span className="ml-2 text-sm text-gray-500">
                ({progressIndex}/{progressTotal})
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="p-2 space-y-4">
          <p className="text-sm text-gray-600">
            Pick any minute. Default rule keeps at least 15 minutes between posts.
          </p>

          {/* Time row with inline Auto-pick */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-700 w-24">Time</span>
            <div className="flex items-center gap-2">
              <Input
                type="time"
                step="60"            // minute precision
                value={value}
                onChange={onTimeChange}
                className="w-32"
              />
              <Button type="button" variant="secondary" onClick={autoPickOne}>
                Auto-pick time
              </Button>
            </div>
          </div>

          {conflict && (
            <div className="rounded-md border border-red-200 bg-red-50 text-red-700 text-sm p-2">
              This time is within 15 minutes of another post. You can choose a different time
              or override to keep this time.
            </div>
          )}
        </div>

        <DialogFooter>
          {/* Left: bulk auto-pick (multi-move only) */}
          {onAutoPickAll && (
            <Button type="button" variant="secondary" className="mr-auto" onClick={onAutoPickAll}>
              Auto-pick all (remaining)
            </Button>
          )}

          {/* Right: cancel / (optional override) / confirm */}
          <Button type="button" variant="ghost" onClick={() => onClose?.()}>Cancel</Button>
          {conflict && (
            <Button type="button" variant="outline" onClick={overrideConfirm}>
              Override & Confirm
            </Button>
          )}
          <Button type="button" onClick={confirm}>
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
