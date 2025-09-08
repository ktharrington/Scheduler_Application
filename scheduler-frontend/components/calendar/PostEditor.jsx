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
import * as PostsClient from "../api/PostsClient";


const MIN_SPACING = 15; // minutes
const CAROUSEL_ENABLED = false;



const isPlaceholderHost = (u = "") => {
  try { return /(^|\.)your-public-r2-domain\.r2\.dev$/i.test(new URL(u).hostname); }
  catch { return false; }
};

const VIDEO_EXTS = ["mp4","mov","m4v","webm"];
const looksLikeVideo = (u) => {
  if (!u) return false;
  try { u = new URL(u).pathname; } catch {}
  const m = String(u).toLowerCase().match(/\.([a-z0-9]+)(?:$|\?)/);
  const ext = m?.[1] || "";
  return VIDEO_EXTS.includes(ext);
};
const isPng = (u) => {
  if (!u) return false;
  try { u = new URL(u).pathname; } catch {}
  try { u = decodeURIComponent(u); } catch {}
  return /\.png(?:$|\?)/i.test(String(u));
};



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


function extractCaptionFromString(s) {
  if (!s) return null;
  try {
    s = new URL(s).pathname; // use path if it's a URL
  } catch (_) {}
  try { s = decodeURIComponent(s); } catch (_) {}
  const fname = String(s).split(/[\\/]/).pop() || s;
  const m = fname.match(/\*{5}([^*]{1,200})\*{5}/);
  return m ? m[1] : null;
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
    post_type: post?.post_type || "photo",
    caption: post?.caption || "",
    first_comment: post?.first_comment || "",
    scheduled_at: initialWhen, // "yyyy-MM-dd'T'HH:mm" for datetime-local
  });


  const [isSubmitting, setIsSubmitting] = useState(false);
  const [overrideSpacing, setOverrideSpacing] = useState(false);
  const [readOnly, setReadOnly] = useState(Boolean(initialReadOnly));
  useEffect(() => setReadOnly(Boolean(initialReadOnly)), [initialReadOnly, post?.id]);
  const [isCarousel, setIsCarousel] = useState(false);
  const [carouselUrls, setCarouselUrls] = useState(["",""]); // start with 2 slots
  const [reelMode, setReelMode] = useState("feed_and_reels"); // or "reels_only"

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

  const doSave = async (extras = {}) => {
    setIsSubmitting(true);
    try {
      // V1: carousels disabled
      if (isCarousel) {
        alert("Carousels are temporarily disabled in v1. Please post as a single photo or reel.");
        return; // isSubmitting resets in finally {}
}

      // Build payload for API
      let payload;

      // Carousel: package child URLs as JSON (enforced max 10 items)
      if (isCarousel) {
        const urls = (carouselUrls || [])
          .map((s) => String(s || "").trim())
          .filter(Boolean)
          .slice(0, 10);
        if (urls.length < 2) {
          alert("Carousel needs at least 2 media links (max 10).");
          setIsSubmitting(false);
          return;
        }
        payload = {
          account_id: selectedAccount.id,
          platform: "instagram",
          post_type: "carousel",
          media_url: JSON.stringify({ type: "carousel", urls }),
          caption: formData.caption,
          scheduled_at: formData.scheduled_at,
          asset_id: formData.asset_id ?? null,
          client_request_id: formData.client_request_id ?? null,
          ...extras,
        };
      } else {
        const url = String(formData.media_url || "").trim();
        if (!url) {
          alert("Please enter a media URL.");
          setIsSubmitting(false);
          return;
        }
        if (looksLikeVideo(url)) {
          payload = {
            account_id: selectedAccount.id,
            platform: "instagram",
            post_type: reelMode === "reels_only" ? "reel_only" : "reel_feed",
            media_url: url,
            caption: formData.caption,
            scheduled_at: formData.scheduled_at,
            asset_id: formData.asset_id ?? null,
            client_request_id: formData.client_request_id ?? null,
            ...extras,
          };
        } else {
          payload = {
            account_id: selectedAccount.id,
            platform: "instagram",
            post_type: "photo",
            media_url: url,
            caption: formData.caption,
            scheduled_at: formData.scheduled_at,
            asset_id: formData.asset_id ?? null,
            client_request_id: formData.client_request_id ?? null,
            ...extras,
          };
        }
      }

  
      // Call API
      const res = await PostsClient.createPost(payload);
  
      // Normalize datetime to ISO so Calendar can read it
      const dt = new Date(formData.scheduled_at);
      const scheduledISO = isNaN(dt.getTime())
        ? formData.scheduled_at
        : dt.toISOString();
  
      // Pass a post-shaped object to the parent (what Calendar expects)
      const uiPost = {
        id: res?.id,                         // backend returns { id, status }
        status: res?.status || "scheduled",
        account_id: selectedAccount.id,
        post_type: payload.post_type,
        media_url: payload.media_url,
        caption: payload.caption,
        scheduled_at: scheduledISO,
      };
  
      onSave?.(uiPost);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (readOnly) return;
    if (!selectedAccount) { alert("Please select an account first."); return; }
    if (hasConflict) return; // blocked until checkbox is checked
  
    await doSave({
      override_spacing: false,
    });
  };
  

  const handleOverrideSave = async () => {
    // legacy button path still works if you keep it anywhere
    await doSave({ override_spacing: true });
  };
  
  const handlePostNowNew = async () => {
    if (readOnly) return;
    if (!selectedAccount) { alert("Please select an account first."); return; }
    if (!window.confirm("Post now?")) return;
    const nowVal = toLocalInputValue(new Date());
    await doSave({
      scheduled_at: nowVal,
      override_spacing: true,
    });
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

  const mediaUrl = String(formData.media_url || "");

  const isVideoUrl = (u='') =>
    /\.(mp4|mov|m4v|webm)$/i.test((u.split('?')[0] || ''));
    
    
  const getPreviewSrc = (u = "") => {
    if (!u) return "";
    if (u.startsWith("blob:") || u.startsWith("data:")) return u;
    if (!/^https?:\/\//i.test(u)) return "";
    if (isPlaceholderHost(u)) return ""; // skip doomed previews
    return `/api/media/proxy?url=${encodeURIComponent(u)}&ref=${encodeURIComponent(window.location.origin)}`;
  };

  const previewSrc = getPreviewSrc(String(formData.media_url || ''));
  

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
              {/* Carousel toggle (disabled in v1) */}
              {CAROUSEL_ENABLED && (
                <div className="mb-2">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={isCarousel}
                      onChange={(e) => setIsCarousel(e.target.checked)}
                      disabled={readOnly}
                    />
                    <span className="text-sm font-medium">Carousel</span>
                    <span className="text-xs text-muted-foreground">(2–10 items via API)</span>
                  </label>
                </div>
              )}

              {CAROUSEL_ENABLED && isCarousel ? (
                <div className="space-y-2 mb-3">
                  {carouselUrls.map((v, i) => (
                    <div key={i} className="flex gap-2">
                      <Input
                        placeholder={`Media link ${i + 1}`}
                        value={v}
                        onChange={(e) => {
                          const next = [...carouselUrls];
                          next[i] = e.target.value;
                          setCarouselUrls(next);
                        }}
                        disabled={readOnly}
                        readOnly={readOnly}
                        className={readOnly ? "bg-gray-50 cursor-default" : ""}
                      />
                      {carouselUrls.length > 2 && (
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() =>
                            setCarouselUrls(carouselUrls.filter((_, idx) => idx !== i))
                          }
                          disabled={readOnly}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                  {carouselUrls.length < 10 && (
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setCarouselUrls([...carouselUrls, ""])}
                      disabled={readOnly}
                    >
                      + Add Media Link
                    </Button>
                  )}
                </div>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="media_url">Media URL</Label>
                    <Input
                      id="media_url"
                      value={formData.media_url}
                      onChange={(e) => {
                        const v = e.target.value;
                        const maybe = extractCaptionFromString(v);
                        setFormData((prev) => {
                          const next = { ...prev, media_url: v };
                          if (maybe && (!prev.caption || prev.caption.trim() === "")) {
                            next.caption = maybe;
                          }
                          return next;
                        });
                      }}
                      placeholder="https://.../image-or-video.ext"
                      disabled={readOnly}
                      readOnly={readOnly}
                      className={readOnly ? "bg-gray-50 cursor-default" : ""}
                    />
                    
                    {/* PNG warning */}
                    {formData.media_url && isPng(formData.media_url) && (
                      <div className="text-sm text-red-600 flex items-center gap-2 mt-1">
                        <AlertTriangle className="w-4 h-4" />
                        <span>PNG is not currently supported.</span>
                      </div>
                    )}

                    {previewSrc ? (
                      isVideoUrl(formData.media_url) ? (
                        <video key={previewSrc} src={previewSrc} controls preload="metadata" playsInline />
                      ) : (
                        <img src={previewSrc} alt="Preview" />
                      )
                    ) : (
                      <div style={{fontSize:12,color:"#6b7280"}}>Preview unavailable — enter a public URL.</div>
                    )}
                  </div>
              
                  {/* Video destination (only when single URL is a video) */}
                  {looksLikeVideo(formData.media_url) && (
                    <div className="mt-2">
                      <div className="text-sm font-medium mb-1">Video destination</div>
                      <label className="flex items-center gap-2 mb-1">
                        <input
                          type="radio"
                          name="reelMode"
                          checked={reelMode === "feed_and_reels"}
                          onChange={() => setReelMode("feed_and_reels")}
                          disabled={readOnly}
                        />
                        <span className="text-sm">Post to feed and Reels</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="radio"
                          name="reelMode"
                          checked={reelMode === "reels_only"}
                          onChange={() => setReelMode("reels_only")}
                          disabled={readOnly}
                        />
                        <span className="text-sm">Post as Reel only</span>
                      </label>
                    </div>
                  )}
                </>
              )}
              {/* Caption (always visible) */}
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
                    <div className="mt-2 flex items-center gap-3">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={overrideSpacing}
                          onChange={(e) => setOverrideSpacing(e.target.checked)}
                        />
                        <span className="text-sm font-medium">Override 15-minute spacing</span>
                      </label>
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
                      onClick={() => doSave({ override_spacing: overrideSpacing })}
                      disabled={isSubmitting || (hasConflict && !overrideSpacing)}
                      className="bg-gradient-to-r from-purple-500 to-pink-500 text-white disabled:opacity-60"
                      title={
                        hasConflict && !overrideSpacing
                          ? "Check 'Override 15-minute spacing' to save"
                          : "Save post"
                      }
                    >
                      Save Post
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
