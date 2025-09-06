import React, { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import CalendarView from "../components/calendar/CalendarView";
import PostEditor from "../components/calendar/PostEditor";
import MovePostDialog from "@/components/calendar/MovePostDialog";
import BatchScheduleWizard from "../components/batch/BatchScheduleWizard";
import ReplacePostDialog from "../components/posts/ReplacePostDialog";
import { startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, addDays as addDaysFn, addDays } from "date-fns";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useRangedPosts } from "@/components/hooks/useRangedPosts";
import { createPost, updatePost, cancelPost } from "@/components/api/PostsClient";

export default function CalendarPage() {
  const { selectedAccountId, selectedAccount } = useOutletContext();
  const navigate = useNavigate();

  const [showEditor, setShowEditor] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [defaultDate, setDefaultDate] = useState(new Date());
  const [showBatch, setShowBatch] = useState(false);
  const [replaceTarget, setReplaceTarget] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [bulkQueue, setBulkQueue] = useState([]);
  const [bulkIndex, setBulkIndex] = useState(0);

  const [viewOnly, setViewOnly] = useState(false);

  const [moveCtx, setMoveCtx] = useState(null);
  const [moveOpen, setMoveOpen] = useState(false);

  const [multiMoveActive, setMultiMoveActive] = useState(false);
  const [multiMoveQueue, setMultiMoveQueue] = useState([]);
  const [multiMoveTargetYMD, setMultiMoveTargetYMD] = useState(null);
  const [multiMoveIndex, setMultiMoveIndex] = useState(0);
  const [multiMoveChosenTimes, setMultiMoveChosenTimes] = useState([]);

  const [monthCursor, setMonthCursor] = useState(new Date());
  const monthRange = useMemo(() => {
    const start = subDays(startOfMonth(monthCursor), 7);
    const end = addDaysFn(endOfMonth(monthCursor), 7);
    return {
      startISO: new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0).toISOString(),
      endISO: new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).toISOString(),
    };
  }, [monthCursor]);

  const { posts: rangedPosts, refetch: refetchRange } = useRangedPosts({
    accountId: selectedAccountId,
    startISO: monthRange.startISO,
    endISO: monthRange.endISO,
    fallbackAllPosts: [],
    allowListFallback: false,
  });

  const isBulk = bulkQueue.length > 0;

  const posts = selectedAccountId
    ? (rangedPosts || []).filter(p => String(p.account_id) === String(selectedAccountId))
    : [];

  const toHHmm = (date) => {
    const d = new Date(date);
    return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
  };
  const MIN_SPACING_MIN = 15;
  const toMinutes = (hhmm) => {
    const [h, m] = (hhmm || "00:00").split(":").map(Number);
    return h * 60 + m;
  };
  const fromMinutes = (mins) => {
    const h = String(Math.floor(mins / 60)).padStart(2, "0");
    const m = String(mins % 60).padStart(2, "0");
    return `${h}:${m}`;
  };
  const isTooClose = (t1, t2) => Math.abs(toMinutes(t1) - toMinutes(t2)) < MIN_SPACING_MIN;
  const getTimesOnDay = (ymd, excludeId = null) =>
    posts
      .filter(p => p.scheduled_at.slice(0, 10) === ymd && (excludeId ? p.id !== excludeId : true))
      .map(p => toHHmm(p.scheduled_at))
      .sort();

  const autoPickTimeAmong = (existingTimes) => {
    const DAY_START = 0;
    const DAY_END = 23 * 60 + 59;
    const times = (existingTimes || []).map(toMinutes).sort((a, b) => a - b);
    const points = [DAY_START, ...times, DAY_END];
    let bestGap = -1, bestPrev = DAY_START, bestNext = DAY_END;
    for (let i = 0; i < points.length - 1; i++) {
      const gap = points[i + 1] - points[i];
      if (gap > bestGap) { bestGap = gap; bestPrev = points[i]; bestNext = points[i + 1]; }
    }
    let candidate = Math.floor((bestPrev + bestNext) / 2);
    candidate += Math.floor(Math.random() * 17) - 8;
    const lower = Math.max(DAY_START, bestPrev + MIN_SPACING_MIN);
    const upper = Math.min(DAY_END, bestNext - MIN_SPACING_MIN);
    if (candidate < lower || candidate > upper || upper <= lower) {
      for (let probe = DAY_START; probe <= DAY_END; probe += MIN_SPACING_MIN) {
        const tooClose = times.some(t => Math.abs(probe - t) < MIN_SPACING_MIN);
        if (!tooClose) return fromMinutes(probe);
      }
      return null;
    }
    return fromMinutes(candidate);
  };

  const openNewForDate = (date) => {
    setEditingPost(null);
    setDefaultDate(date || new Date());
    setViewOnly(false);
    setShowEditor(true);
  };
  const handleNewPost = () => openNewForDate(new Date());

  const onPostSelect = (post) => {
    setEditingPost(post);
    setDefaultDate(new Date(post.scheduled_at));
    setViewOnly(true);
    setShowEditor(true);
  };

  const onReplacePost = (post) => setReplaceTarget(post);

  const onDayClick = (date) => {
    const d = new Date(date);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    // go to the day planner for that date
    navigate(`/dayplanner?date=${ymd}`);
  };

  const onToggleSelect = (post, isShift) => {
    const id = post.id;
    setSelectedIds(prev => {
      if (isShift) return prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id];
      return prev.length === 1 && prev[0] === id ? [] : [id];
    });
  };
  const clearSelection = () => setSelectedIds([]);

  const startBulkReplace = () => {
    const queue = posts
      .filter(p => selectedIds.includes(p.id))
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    if (queue.length === 0) return;
    setBulkQueue(queue);
    setBulkIndex(0);
    setEditingPost(queue[0]);
    setDefaultDate(new Date(queue[0].scheduled_at));
    setViewOnly(false);
    setShowEditor(true);
  };
  const advanceBulk = async () => {
    if (!isBulk) return;
    const next = bulkIndex + 1;
    if (next < bulkQueue.length) {
      setBulkIndex(next);
      const n = bulkQueue[next];
      setEditingPost(n);
      setDefaultDate(new Date(n.scheduled_at));
    } else {
      endBulk();
      await refetchRange();
    }
  };
  const endBulk = () => {
    setBulkQueue([]);
    setBulkIndex(0);
    setShowEditor(false);
    setEditingPost(null);
    setSelectedIds([]);
  };

  const updatePostTime = async (post, ymd, hhmm) => {
    const [y, m, d] = ymd.split("-").map(Number);
    const [h, min] = hhmm.split(":").map(Number);
    const when = new Date();
    when.setFullYear(y, m - 1, d);
    when.setHours(h, min, 0, 0);
    const payload = {
      account_id: selectedAccountId,
      media_url: post.media_url,
      media_type: post.media_type || "photo",
      caption: post.caption || "",
      first_comment: post.first_comment || "",
      scheduled_at: when.toISOString(),
      status: post.status || "scheduled",
    };
    await updatePost(post.id, payload);
  };

  const handleMovePost = async (postId, targetYMD) => {
    const post = posts.find(p => String(p.id) === String(postId));
    if (!post) return;
    const src = new Date(post.scheduled_at);
    const initial = `${String(src.getHours()).padStart(2, "0")}:${String(src.getMinutes()).padStart(2, "0")}`;

    const targetCount = posts.filter(p => p.scheduled_at.slice(0, 10) === targetYMD && p.id !== post.id).length;
    if (targetCount >= 15) {
      alert("Maxed scheduled posts for intended date. Remove some posts first.");
      return;
    }

    const otherTimes = getTimesOnDay(targetYMD, post.id);
    const conflict = otherTimes.some(t => isTooClose(t, initial));
    if (conflict) {
      setMoveCtx({ post, targetYMD, initialHHmm: initial, otherTimes });
      setMoveOpen(true);
      return;
    }

    await updatePostTime(post, targetYMD, initial);
    await refetchRange();
  };

  const handleMoveSelection = (ids, targetYMD) => {
    if (!Array.isArray(ids) || ids.length === 0) return;
    const queue = posts
      .filter(p => ids.includes(p.id))
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

    const targetInitial = posts.filter(p => p.scheduled_at.slice(0, 10) === targetYMD).length;
    const movedIn = queue.filter(p => p.scheduled_at.slice(0, 10) !== targetYMD).length;
    if (targetInitial + movedIn > 15) {
      alert(`This move would exceed the daily cap (15) on ${targetYMD}.`);
      return;
    }

    setMultiMoveActive(true);
    setMultiMoveQueue(queue);
    setMultiMoveTargetYMD(targetYMD);
    setMultiMoveIndex(0);
    setMultiMoveChosenTimes([]);
    processNextMultiMove(queue, targetYMD, 0, []);
  };

  const processNextMultiMove = async (queue, ymd, index, chosenTimes) => {
    if (index >= queue.length) {
      setMultiMoveActive(false);
      setMultiMoveQueue([]);
      setMultiMoveTargetYMD(null);
      setMultiMoveIndex(0);
      setMultiMoveChosenTimes([]);
      await refetchRange();
      return;
    }
    const post = queue[index];
    const initial = toHHmm(post.scheduled_at);
    const otherTimes = [...getTimesOnDay(ymd, post.id), ...chosenTimes].sort();
    const conflict = otherTimes.some(t => isTooClose(t, initial));

    if (conflict) {
      setMoveCtx({ post, targetYMD: ymd, initialHHmm: initial, otherTimes });
      setMoveOpen(true);
      setMultiMoveIndex(index);
      setMultiMoveQueue(queue);
      setMultiMoveTargetYMD(ymd);
      setMultiMoveChosenTimes(chosenTimes);
      return;
    }

    await updatePostTime(post, ymd, initial);
    processNextMultiMove(queue, ymd, index + 1, [...chosenTimes, initial]);
  };

  const autoPickAllRemaining = async () => {
    if (!multiMoveActive) return;
    setMoveOpen(false);
    setMoveCtx(null);

    const queue = [...multiMoveQueue];
    const ymd = multiMoveTargetYMD;
    let chosen = [...multiMoveChosenTimes];

    for (let idx = multiMoveIndex; idx < queue.length; idx++) {
      const post = queue[idx];
      const initial = toHHmm(post.scheduled_at);
      const otherTimes = [...getTimesOnDay(ymd, post.id), ...chosen].sort();

      let finalHHmm = initial;
      if (otherTimes.some(t => isTooClose(t, initial))) {
        finalHHmm = autoPickTimeAmong(otherTimes) || initial;
      }
      await updatePostTime(post, ymd, finalHHmm);
      chosen.push(finalHHmm);
    }

    setMultiMoveActive(false);
    setMultiMoveQueue([]);
    setMultiMoveTargetYMD(null);
    setMultiMoveIndex(0);
    setMultiMoveChosenTimes([]);
    await refetchRange();
  };

  const exceedsCap = (when, excludeId) => {
    const dayStart = startOfDay(new Date(when));
    const dayEnd = endOfDay(new Date(when));
    const count = posts.filter(p => {
      if (excludeId && p.id === excludeId) return false;
      const t = new Date(p.scheduled_at);
      return t >= dayStart && t <= dayEnd;
    }).length;
    return count >= 15;
  };

  const suggestSpillover = (when) => {
    const d = new Date(when);
    const next = addDays(d, 1);
    next.setHours(d.getHours(), d.getMinutes(), 0, 0);
    return next;
  };

  const onSave = async (data) => {
    const when = new Date(data.scheduled_at);
    if (exceedsCap(when, editingPost?.id)) {
      const suggestion = suggestSpillover(when);
      alert(`Daily cap of 15 reached. Suggestion: ${suggestion.toLocaleString()}`);
      return;
    }
    const payload = {
      account_id: selectedAccountId,
      media_url: data.media_url,
      media_type: data.media_type || "photo",
      caption: data.caption || "",
      first_comment: data.first_comment || "",
      scheduled_at: when.toISOString(),
      status: "scheduled",
    };
    if (editingPost) {
      await updatePost(editingPost.id, payload);
    } else {
      await createPost(payload);
    }
    await refetchRange();
    if (isBulk) advanceBulk();
    else { setShowEditor(false); setEditingPost(null); }
  };

  const onDelete = async (id) => {
    await cancelPost(id);
    await refetchRange();
    if (isBulk) advanceBulk();
    else { setShowEditor(false); setEditingPost(null); }
  };

  const onPostNow = async (id) => {
    await updatePost(id, { scheduled_at: new Date().toISOString(), status: "scheduled" });
    await refetchRange();
    if (isBulk) advanceBulk();
    else { setShowEditor(false); setEditingPost(null); }
  };

  return (
    <div className="p-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="tw-gradient-text text-3xl font-bold">
          Calendar
        </h1>
        <div className="flex items-center gap-2">
          {selectedAccountId && (
            <>
              <Button
                variant="outline"
                onClick={() => setShowBatch(true)}
                className="border-purple-200 text-purple-700"
                title="Batch schedule posts over a date range"
              >
                Batch schedule
              </Button>
              <Button
                variant="outline"
                disabled={selectedIds.length === 0}
                onClick={startBulkReplace}
                className="border-amber-200 text-amber-700"
                title={selectedIds.length ? `Replace ${selectedIds.length} selected post(s)` : "Select post(s) to enable"}
              >
                Replace selected{selectedIds.length ? ` (${selectedIds.length})` : ""}
              </Button>
            </>
          )}
          <Button onClick={handleNewPost} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white">
            <Plus className="w-4 h-4 mr-2" /> New Post
          </Button>
        </div>
      </div>

      <div className="mb-4 text-sm text-gray-600">
        {selectedAccountId ? (
          <>
            Selected account: <span className="font-medium">@{selectedAccount?.handle || selectedAccountId}</span>
            {selectedIds.length > 0 && (
              <button onClick={clearSelection} className="ml-3 text-amber-600 underline">Clear selection</button>
            )}
          </>
        ) : (
          "No account selected. Showing blank calendar."
        )}
      </div>

      <div className="space-y-4">
        <CalendarView
          posts={posts}
          onPostSelect={onPostSelect}
          onDayClick={onDayClick}
          onReplacePost={onReplacePost}
          selectedIds={selectedIds}
          onToggleSelect={onToggleSelect}
          onMovePost={handleMovePost}
          onMoveSelection={handleMoveSelection}
          onMonthChange={(m) => setMonthCursor(m.toDate())}
        />
      </div>

      {showEditor && (
        <PostEditor
          post={editingPost}
          defaultDate={defaultDate}
          onSave={onSave}
          onClose={() => {
            if (isBulk) { endBulk(); }
            else { setShowEditor(false); setEditingPost(null); setViewOnly(false); }
          }}
          onDelete={onDelete}
          onPostNow={onPostNow}
          selectedAccount={selectedAccount}
          accountPosts={posts}
          bulkIndex={isBulk ? bulkIndex : null}
          bulkTotal={isBulk ? bulkQueue.length : null}
          initialReadOnly={viewOnly}
        />
      )}

      {showBatch && (
        <BatchScheduleWizard
          open={showBatch}
          onClose={() => setShowBatch(false)}
          selectedAccount={selectedAccount}
          onCommitted={async () => { await refetchRange(); setSelectedIds([]); }}
          apiBase=""
        />
      )}

      {replaceTarget && (
        <ReplacePostDialog
          open={!!replaceTarget}
          onClose={() => setReplaceTarget(null)}
          post={replaceTarget}
          apiBase=""
          onReplaced={async () => { await refetchRange(); }}
        />
      )}

      {moveCtx && (
        <MovePostDialog
          open={moveOpen}
          onClose={() => {
            setMoveOpen(false); setMoveCtx(null);
            if (multiMoveActive) {
              setMultiMoveActive(false);
              setMultiMoveQueue([]); setMultiMoveTargetYMD(null);
              setMultiMoveIndex(0); setMultiMoveChosenTimes([]);
            }
          }}
          dateLabel={moveCtx.targetYMD}
          otherTimes={moveCtx.otherTimes}
          initialTime={moveCtx.initialHHmm}
          progressIndex={multiMoveActive ? (multiMoveIndex + 1) : null}
          progressTotal={multiMoveActive ? multiMoveQueue.length : null}
          onAutoPickAll={multiMoveActive ? autoPickAllRemaining : null}
          onConfirm={async (chosenHHmm) => {
            const finalHHmm = chosenHHmm || moveCtx.initialHHmm;
            await updatePostTime(moveCtx.post, moveCtx.targetYMD, finalHHmm);
            setMoveOpen(false); setMoveCtx(null);
            if (multiMoveActive) {
              const q = multiMoveQueue; const y = multiMoveTargetYMD;
              const idx = multiMoveIndex; const chosen = [...multiMoveChosenTimes, finalHHmm];
              processNextMultiMove(q, y, idx + 1, chosen);
            } else {
              await refetchRange();
            }
          }}
        />
      )}
    </div>
  );
}
