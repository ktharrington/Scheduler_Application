// components/calendar/PostEditor.jsx
import React, { useState, useMemo, useEffect } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { X, Save, Trash2, Send, Wand2, AlertTriangle } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";

const MIN_SPACING = 15; // minutes

// ---------- time helpers ----------
const toLocalInputValue = (dateish) =>
  format(new Date(dateish), "yyyy-MM-dd'T'HH:mm"); // correct for <input type="datetime-local">

const minutesOfDayFromHHmm = (hhmm) => {
  const [h, m] = String(hhmm || "00:00").split(":").map((n) => parseInt(n, 10) || 0);
  return h * 60 + m;
};
const minutesOfDayFromDate = (d) => {
  const dt = new Date(d);
  return dt.getHours() * 60 + dt.getMinutes();
};
const hhmm = (mins) =>
  `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
const ampm = (mins) =>
  format(new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60), "h:mm a");
const ymd = (d) => format(new Date(d), "yyyy-MM-dd");

// human-like picker: midpoint of largest gap (08:00–22:59) + small jitter, ≥15 min from neighbors
function pickHumanMinute(existingMins, dayStartMin = 8 * 60, dayEndMin = 22 * 60 + 59) {
  const times = [...existingMins].sort((a, b) => a - b);
  const pts = [dayStartMin, ...times, dayEndMin];
  let bestGap = -1,
    prev = dayStartMin,
    next = dayEndMin;

  for (let i = 0; i < pts.length - 1; i++) {
    const gap = pts[i + 1] - pts[i];
    if (gap > bestGap) {
      bestGap = gap;
      prev = pts[i];
      next = pts[i + 1];
    }
  }
  const lower = prev + MIN_SPACING;
  const upper = next - MIN_SPACING;
  if (upper <= lower) return null;

  // center + jitter [-6..+6]
  let candidate = Math.floor((lower + upper) / 2) + (Math.floor(Math.random() * 13) - 6);

  const ok = (m) => times.every((t) => Math.abs(t - m) >= MIN_SPACING);
  candidate = Math.max(lower, Math.min(upper, candidate));
  if (!ok(candidate)) {
    for (let step = 1; step <= 60; step++) {
      const fwd = candidate + step,
        back = candidate - step;
      if (fwd <= upper && ok(fwd)) return fwd;
      if (back >= lower && ok(back)) return back;
    }
    return null;
  }
  return candidate;
}

export default function PostEditor({
  post,
  defaultDate,
  onSave,
  onClose,
  onDelete,
  onPostNow, // kept for API compatibility
  selectedAccount,
  accountPosts = [],
  bulkIndex = null,
  bulkTotal = null,
  initialReadOnly = false,
}) {
  // ---------- form state ----------
  const initialWhen = post?.scheduled_at
    ? toLocalInputValue(post.scheduled_at)
    : toLocalInputValue(defaultDate || new Date());

  const [formData, setFormData] = useState({
    media_url: post?.media_url || "",
    media_type: post?.media_type || "photo",
    caption: post?.caption || "",
    first_comment: post?.first_comment || "",
    scheduled_at: initialWhen, // "yyyy-MM-dd'T'HH:mm" for datetime-local
  });

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [readOnly, setReadOnly] = useState(Boolean(initialReadOnly));
  useEffect(() => setReadOnly(Boolean(initialReadOnly)), [initialReadOnly, post?.id]);

  // ---------- compute existing same-day minutes ----------
  const sameDay = useMemo(() => (formData.scheduled_at || "").slice(0, 10), [formData.scheduled_at]);

  const existingSameDayMins = useMemo(() => {
    if (!sameDay) return [];
    return (accountPosts || [])
      .filter((p) => p.scheduled_at && p.id !== post?.id && p.scheduled_at.slice(0, 10) === sameDay)
      .map((p) => minutesOfDayFromDate(p.scheduled_at))
      .sort((a, b) => a - b);
  }, [accountPosts, post?.id, sameDay]);

  const existingSameDayChips = useMemo(
    () => existingSameDayMins.map(ampm),
    [existingSameDayMins]
  );

  // ---------- spacing check + conflict state ----------
  const [conflictMsg, setConflictMsg] = useState("");
  const hasConflict = useMemo(() => conflictMsg.length > 0, [conflictMsg]);

  const recomputeConflict = (value) => {
    // value is "YYYY-MM-DDTHH:mm"
    const hmm = value?.slice(11, 16) || "00:00";
    const chosenMin = minutesOfDayFromHHmm(hmm);
    const offender = existingSameDayMins.find((m) => Math.abs(m - chosenMin) < MIN_SPACING);
    if (offender != null) {
      setConflictMsg(
        `This time is within ${Math.abs(offender - chosenMin)} minutes of ${ampm(offender)}.`
      );
    } else {
      setConflictMsg("");
    }
  };

  useEffect(() => {
    recomputeConflict(formData.scheduled_at);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingSameDayMins.length]);

  // ---------- handlers ----------
  const handleWhenChange = (e) => {
    const v = e.target.value;
    setFormData((fd) => ({ ...fd, scheduled_at: v }));
    recomputeConflict(v);
  };

  const doSave = async (payload) => {
    setIsSubmitting(true);
    try {
      await onSave(payload);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (readOnly) return;
    if (!selectedAccount) {
      alert("Please select an account first.");
      return;
    }
    // block normal save if conflict exists
    if (hasConflict) return;
    await doSave(formData);
  };

  const handleOverrideSave = async () => {
    if (readOnly) return;
    if (!selectedAccount) {
      alert("Please select an account first.");
      return;
    }
    await doSave(formData); // bypass spacing block
  };

  const handlePostNowNew = async () => {
    if (readOnly) return;
    if (!selectedAccount) {
      alert("Please select an account first.");
      return;
    }
    if (!window.confirm("Post now?")) return;
    const nowVal = toLocalInputValue(new Date());
    await doSave({ ...formData, scheduled_at: nowVal });
  };

  const autoPickTime = () => {
    if (readOnly) return;
    if (!selectedAccount) {
      alert("Select an account first.");
      return;
    }
    const chosenDay = sameDay || ymd(new Date());
    const picked = pickHumanMinute(existingSameDayMins);
    if (picked == null) {
      alert("Couldn't find a good slot today. Try another day or adjust manually.");
      return;
    }
    const nextVal = `${chosenDay}T${hhmm(picked)}`;
    setFormData((fd) => ({ ...fd, scheduled_at: nextVal }));
    setConflictMsg(""); // picked respects spacing
  };

  // ---------- UI ----------
  const title =
    post ? `Post for @${selectedAccount?.handle}` : `New Post for @${selectedAccount?.handle}`;

  return (
    <motion.div
      initial={{ opacity: 0, x: 300 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 300 }}
      className="fixed right-0 top-0 h-full w-[400px] z-50 shadow-2xl"
    >
      <Card className="h-full border-l-0 rounded-none bg-white flex flex-col">
        <CardHeader className="border-b bg-gradient-to-r from-purple-50 to-pink-50 p-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <CardTitle className="text-xl font-bold text-gray-900">
                {title}
              </CardTitle>
              {typeof bulkIndex === "number" &&
                typeof bulkTotal === "number" &&
                bulkTotal > 1 && (
                  <Badge
                    variant="secondary"
                    className="bg-purple-100 text-purple-700 border-purple-200"
                  >
                    {bulkIndex + 1}/{bulkTotal}
                  </Badge>
                )}
            </div>
            <Button variant="ghost" size="icon" onClick={onClose} className="hover:bg-white/80">
              <X className="w-5 h-5" />
            </Button>
          </div>
        </CardHeader>

        <CardContent className="p-6 overflow-y-auto flex-1">
          <form onSubmit={handleSubmit} className="space-y-6 h-full flex flex-col">
            <div className="space-y-2">
              <Label htmlFor="media_url">Media URL</Label>
              <Input
                id="media_url"
                value={formData.media_url}
                onChange={(e) => setFormData({ ...formData, media_url: e.target.value })}
                placeholder="https://.../image.jpg"
                disabled={readOnly}
                readOnly={readOnly}
                className={readOnly ? "bg-gray-50 cursor-default" : ""}
              />
              {formData.media_url && (
                <div className="mt-2">
                  <img
                    src={formData.media_url}
                    alt="Preview"
                    className="w-full h-40 object-cover rounded-lg"
                  />
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="caption">Caption</Label>
              <Textarea
                id="caption"
                value={formData.caption}
                onChange={(e) => setFormData({ ...formData, caption: e.target.value })}
                placeholder="Write your caption..."
                className={`min-h-[120px] resize-none ${readOnly ? "bg-gray-50 cursor-default" : ""}`}
                disabled={readOnly}
                readOnly={readOnly}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="first_comment">First Comment (Optional)</Label>
              <Textarea
                id="first_comment"
                value={formData.first_comment}
                onChange={(e) => setFormData({ ...formData, first_comment: e.target.value })}
                placeholder="Add a first comment..."
                className={`min-h-[60px] resize-none ${readOnly ? "bg-gray-50 cursor-default" : ""}`}
                disabled={readOnly}
                readOnly={readOnly}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="scheduled_at">Scheduled Time</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="scheduled_at"
                  type="datetime-local"
                  value={formData.scheduled_at}
                  onChange={handleWhenChange}
                  className={`w-full ${readOnly ? "bg-gray-50 cursor-default" : ""}`}
                  disabled={readOnly}
                  readOnly={readOnly}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={autoPickTime}
                  title="Auto-pick human-like time"
                  disabled={readOnly}
                >
                  <Wand2 className="w-4 h-4 mr-2" />
                  Auto-pick
                </Button>
              </div>

              {existingSameDayChips.length > 0 && (
                <div className="mt-2">
                  <div className="text-xs text-gray-500 mb-1">Existing times that day:</div>
                  <div className="flex flex-wrap gap-1">
                    {existingSameDayChips.map((t, i) => (
                      <Badge key={i} variant="outline">
                        {t}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {hasConflict && !readOnly && (
                <div className="flex items-start gap-2 text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-2">
                  <AlertTriangle className="w-4 h-4 mt-0.5" />
                  <div className="flex-1">
                    <div className="text-xs">{conflictMsg}</div>
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleOverrideSave}
                        className="text-amber-700 border-amber-300"
                      >
                        Override &amp; Save
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {!readOnly && (
                <p className="text-xs text-gray-500 mt-1">
                  Default rule keeps at least 15 minutes between posts.
                </p>
              )}
            </div>

            <div className="pt-4 mt-auto">
              <div className="flex flex-col gap-2">
                {readOnly ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setReadOnly(false);
                    }}
                    className="w-full"
                  >
                    Edit
                  </Button>
                ) : (
                  <>
                    <Button
                      type="submit"
                      disabled={isSubmitting}
                      className="w-full bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
                    >
                      <Save className="w-4 h-4 mr-2" />
                      {isSubmitting ? "Saving..." : "Save Post"}
                    </Button>

                    {!post && (
                      <Button
                        type="button"
                        variant="outline"
                        className="text-green-600 border-green-200"
                        onClick={handlePostNowNew}
                        disabled={isSubmitting}
                      >
                        <Send className="w-4 h-4 mr-2" />
                        Post Now
                      </Button>
                    )}

                    {post && (
                      <Button
                        type="button"
                        variant="outline"
                        className="text-red-600 border-red-200"
                        onClick={() => onDelete(post.id)}
                        disabled={isSubmitting}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </Button>
                    )}
                  </>
                )}
              </div>
            </div>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
}
