// scheduler-frontend/Pages/Calendar.jsx
import React, { useState, useMemo, useCallback, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import CalendarView from "../components/calendar/CalendarView";
import PostEditor from "../components/calendar/PostEditor";
import MovePostDialog from "@/components/calendar/MovePostDialog";
import BatchScheduleWizard from "../components/batch/BatchScheduleWizard";
import ReplacePostDialog from "../components/posts/ReplacePostDialog";
import { startOfDay, endOfDay, startOfMonth, endOfMonth, subDays, addDays as addDaysFn, addDays } from "date-fns";
import { useNavigate, useOutletContext } from "react-router-dom";
import { useRangedPosts } from "@/components/hooks/useRangedPosts";
import { createPost, updatePost, deletePost, bulkDelete, deleteAfter, replacePost, cancelPost } from "@/components/api/PostsClient";



export default function CalendarPage() {
  const { selectedAccountId, selectedAccount } = useOutletContext();
  const isPaused = selectedAccount && selectedAccount.active === false;
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = React.useState(0);

  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
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

  // Deletion dialog state
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [showAfterMenu, setShowAfterMenu] = useState(false);

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
  });

  // Re-fetch + remount when someone asks the calendar to refresh (e.g., clear_old_posts)
  useEffect(() => {
    const onRefresh = (e) => {
      const acct = e?.detail?.accountId;
      // Only refresh if this event is for the currently-selected account (or no account specified)
      if (!acct || String(acct) === String(selectedAccountId)) {
        if (typeof refetchRange === "function") refetchRange(); // 1) re-fetch current range
        setSelectedIds([]);                                     // 2) clear any selection
        setRefreshKey((k) => k + 1);                            // 3) remount children that may cache
      }
    };
    window.addEventListener("calendar:refresh", onRefresh);
    return () => window.removeEventListener("calendar:refresh", onRefresh);
  }, [selectedAccountId, refetchRange]);


  const isBulk = bulkQueue.length > 0;

  const posts = selectedAccountId
    ? (rangedPosts || []).filter((p) => String(p.account_id) === String(selectedAccountId))
    : [];

  /* ---------- SINGLE-ACCOUNT SELECTION GUARANTEE ---------- */

  // clear selection whenever the user switches accounts
  useEffect(() => {
    setSelectedIds([]);
  }, [selectedAccountId]);

  // helper: clamp selection to only what's visible for this account
  const getValidSelection = useCallback(() => {
    const visible = new Set(posts.map((p) => p.id));
    return selectedIds.filter((id) => visible.has(id));
  }, [posts, selectedIds]);

  // flag for disabling bulk actions if selection contains stale/invalid ids
  const hasInvalidSelection = useMemo(() => {
    if (selectedIds.length === 0) return false;
    const visible = new Set(posts.map((p) => p.id));
    return selectedIds.some((id) => !visible.has(id));
  }, [posts, selectedIds]);

  // call this before any bulk action; trims selection and warns user if needed
  const ensureValidSelectionOrWarn = useCallback(
    (silent = false) => {
      const valid = getValidSelection();
      if (valid.length !== selectedIds.length) {
        setSelectedIds(valid);
        if (!silent) {
          if (valid.length === 0) {
            alert("Selection cleared (switched accounts or items no longer visible).");
          } else {
            alert("Selection updated to only include posts from the current account.");
          }
        }
      }
      return valid;
    },
    [getValidSelection, selectedIds.length]
  );

  /* ---------- Utilities / helpers ---------- */

  // Are ALL selected posts future + status==='scheduled'?
  const selectedPosts = React.useMemo(
    () => (posts || []).filter((p) => selectedIds.includes(p.id)),
    [posts, selectedIds]
  );

  const onlyFutureScheduledSelected = React.useMemo(() => {
    if (!selectedPosts.length) return false;
    const nowTs = Date.now();
    return selectedPosts.every(
      (p) =>
        String(p?.status || "").toLowerCase() === "scheduled" &&
        new Date(p.scheduled_at).getTime() > nowTs
    );
  }, [selectedPosts]);

  const replaceDisabled =
    selectedIds.length === 0 || hasInvalidSelection || !onlyFutureScheduledSelected;


  const toHHmm = (date) => {
    const d = new Date(date);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
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
      .filter((p) => p.scheduled_at.slice(0, 10) === ymd && (excludeId ? p.id !== excludeId : true))
      .map((p) => toHHmm(p.scheduled_at))
      .sort();

  const autoPickTimeAmong = (existingTimes) => {
    const DAY_START = 0;
    const DAY_END = 23 * 60 + 59;
    const times = (existingTimes || []).map(toMinutes).sort((a, b) => a - b);
    const points = [DAY_START, ...times, DAY_END];
    let bestGap = -1,
      bestPrev = DAY_START,
      bestNext = DAY_END;
    for (let i = 0; i < points.length - 1; i++) {
      const gap = points[i + 1] - points[i];
      if (gap > bestGap) {
        bestGap = gap;
        bestPrev = points[i];
        bestNext = points[i + 1];
      }
    }
    let candidate = Math.floor((bestPrev + bestNext) / 2);
    candidate += Math.floor(Math.random() * 17) - 8;
    const lower = Math.max(DAY_START, bestPrev + MIN_SPACING_MIN);
    const upper = Math.min(DAY_END, bestNext - MIN_SPACING_MIN);
    if (candidate < lower || candidate > upper || upper <= lower) {
      for (let probe = DAY_START; probe <= DAY_END; probe += MIN_SPACING_MIN) {
        const tooClose = times.some((t) => Math.abs(probe - t) < MIN_SPACING_MIN);
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
    setReplaceTarget(null);        // close Replace dialog if open
    setSelectedIds([post.id]);     // reflect selection in the grid
    setEditingPost(post);          // show this post in the editor
    setDefaultDate(new Date(post.scheduled_at));
    setViewOnly(true);
    setShowEditor(true);
  };
  

  // Replace the simple setter with this:
  const onReplacePost = (post) => {
    const isFutureScheduled =
      String(post?.status || "").toLowerCase() === "scheduled" &&
      new Date(post.scheduled_at).getTime() > Date.now();
    if (!isFutureScheduled) {
      alert("Only future scheduled posts can be replaced.");
      return;
    }
    setReplaceTarget(post);
  };


  const onDayClick = (date) => {
    const d = new Date(date);
    const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    navigate(`/dayplanner?date=${ymd}`);
  };

  const onToggleSelect = (post, isShift) => {
    const id = post.id;
    setSelectedIds((prev) => {
      if (isShift) return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      return prev.length === 1 && prev[0] === id ? [] : [id];
    });
  };
  const clearSelection = () => setSelectedIds([]);

  // ---------- Bulk replace workflow ----------
  const startBulkReplace = () => {
    // Block if any selected post is not future+scheduled
    {
      const nowTs = Date.now();
      const ok = selectedPosts.every(
        (p) =>
        String(p?.status || "").toLowerCase() === "scheduled" &&
        new Date(p.scheduled_at).getTime() > nowTs
      );
      if (!ok) {
        alert("Only future scheduled posts can be replaced. Deselect past or non-scheduled posts.");
        return;
      }
    }

    const valid = ensureValidSelectionOrWarn();
    if (valid.length === 0) return;

    const queue = posts
      .filter((p) => valid.includes(p.id))
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

  // ---------- Move helpers ----------
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
    const post = posts.find((p) => String(p.id) === String(postId));
    if (!post) return;
    const src = new Date(post.scheduled_at);
    const initial = `${String(src.getHours()).padStart(2, "0")}:${String(src.getMinutes()).padStart(2, "0")}`;

    const targetCount = posts.filter((p) => p.scheduled_at.slice(0, 10) === targetYMD && p.id !== post.id).length;
    if (targetCount >= 15) {
      alert("Maxed scheduled posts for intended date. Remove some posts first.");
      return;
    }

    const otherTimes = getTimesOnDay(targetYMD, post.id);
    const conflict = otherTimes.some((t) => isTooClose(t, initial));
    if (conflict) {
      setMoveCtx({ post, targetYMD, initialHHmm: initial, otherTimes });
      setMoveOpen(true);
      return;
    }

    await updatePostTime(post, targetYMD, initial);
    await refetchRange();
  };

  // ---------- Delete helpers ----------
  const exactlyOneSelected = selectedIds.length === 1;
  const selectedPost = useMemo(
    () => (exactlyOneSelected ? posts.find((p) => p.id === selectedIds[0]) : null),
    [exactlyOneSelected, selectedIds, posts]
  );

  const canDeleteAfter =
    !!selectedPost &&
    selectedPost.status === "scheduled" &&
    new Date(selectedPost.scheduled_at) > new Date();

  const openDeleteDialog = () => {
    const valid = ensureValidSelectionOrWarn();
    if (valid.length === 0) return;
    setDeleteOpen(true);
    setShowAfterMenu(false);
  };

  const doBulkDelete = async () => {
    try {
      const valid = ensureValidSelectionOrWarn(true);
      if (valid.length === 0) return;

      if (valid.length === 1) {
        await deletePost(valid[0]);
      } else {
        await bulkDelete(valid);
      }
      setDeleteOpen(false);
      clearSelection();
      await refetchRange();
    } catch (e) {
      alert(e?.message || "Delete failed");
    }
  };

  const doDeleteAfter = async () => {
    try {
      if (!selectedPost) return;
      await deleteAfter(selectedPost.account_id, selectedPost.scheduled_at);
      setDeleteOpen(false);
      clearSelection();
      await refetchRange();
    } catch (e) {
      alert(e?.message || "Delete after failed");
    }
  };

  // ---------- Multi-move (uses selection guard) ----------
  const handleMoveSelection = (ids, targetYMD) => {
    const valid = ensureValidSelectionOrWarn();
    if (valid.length === 0) return;

    const queue = posts
      .filter((p) => valid.includes(p.id))
      .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

    const targetInitial = posts.filter((p) => p.scheduled_at.slice(0, 10) === targetYMD).length;
    const movedIn = queue.filter((p) => p.scheduled_at.slice(0, 10) !== targetYMD).length;
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
    const conflict = otherTimes.some((t) => isTooClose(t, initial));

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
      if (otherTimes.some((t) => isTooClose(t, initial))) {
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
    const count = posts.filter((p) => {
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
    if (editingPost) await updatePost(editingPost.id, payload);
    else await createPost(payload);

    await refetchRange();
    if (isBulk) advanceBulk();
    else {
      setShowEditor(false);
      setEditingPost(null);
    }
  };

  const onDelete = async (id) => {
    await deletePost(id);
    await refetchRange();
    if (isBulk) advanceBulk();
    else {
      setShowEditor(false);
      setEditingPost(null);
    }
  };

  const onPostNow = async (id) => {
    await updatePost(id, { scheduled_at: new Date().toISOString(), status: "scheduled" });
    await refetchRange();
    if (isBulk) advanceBulk();
    else {
      setShowEditor(false);
      setEditingPost(null);
    }
  };

  // stable callback passed down:
  const handleMonthChange = useCallback((m) => {
    setMonthCursor(m.toDate());
  }, []);

  return (
    <div key={refreshKey} className="p-6">
      {/* header */}
      <div className="flex justify-between items-center mb-2">
       <h1 className="tw-gradient-text text-3xl font-bold">Calendar</h1>

       <div className="flex items-center gap-2">
         {selectedAccountId && (
           <>
             <Button
               variant="outline"
               disabled={isPaused}
               onClick={() => setShowBatch(true)}
               className="border-purple-200 text-purple-700 disabled:opacity-60"
               title={isPaused ? "Account is paused" : "Batch schedule posts over a date range"}
             >
               Batch schedule
             </Button>

             <Button
              variant="outline"
              disabled={replaceDisabled}
              onClick={startBulkReplace}
              className="border-amber-200 text-amber-700"
              title={
                selectedIds.length === 0
                  ? "Select post(s) to enable"
                  : hasInvalidSelection
                  ? "Selection includes items not in this account/view"
                  : !onlyFutureScheduledSelected
                  ? "Only future scheduled posts can be replaced"
                  : `Replace ${selectedIds.length} selected post(s)`
              }
            >
              {`Replace selected${selectedIds.length ? ` (${selectedIds.length})` : ""}`}
            </Button>


             <Button
               variant="outline"
               disabled={selectedIds.length === 0 || hasInvalidSelection}
               onClick={openDeleteDialog}
               className="border-red-200 text-red-700"
               title={
                 selectedIds.length
                   ? hasInvalidSelection
                     ? "Selection includes items not in this account/view"
                     : `Delete ${selectedIds.length} selected`
                   : "Select post(s) to enable"
               }
             >
               Delete selected{selectedIds.length ? ` (${selectedIds.length})` : ""}
             </Button>
           </>
         )}

         <Button
           onClick={handleNewPost}
           disabled={isPaused || !selectedAccountId}
           className="bg-gradient-to-r from-purple-500 to-pink-500 text-white disabled:opacity-60"
           title={isPaused ? "Account is paused" : (selectedAccountId ? "Create a new post" : "Select an account first")}
         >
           <Plus className="w-4 h-4 mr-2" /> New Post
         </Button>
       </div>
     </div>

     {/* pause banner */}
     {isPaused && selectedAccountId && (
       <div className="mb-6 text-sm rounded-md bg-blue-50 border border-blue-200 p-2 text-blue-800 flex items-center justify-between">
         <span>
           Account <strong>@{selectedAccount?.handle || selectedAccountId}</strong> is paused.
           Scheduled posts will show as <strong>failed</strong> until you unfreeze it.
         </span>
         <span className="ml-3 text-xs opacity-80">
           Use the 3-dot menu on the account in the left sidebar to Unfreeze.
         </span>
       </div>
     )}


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
          onMonthChange={handleMonthChange}
        />
      </div>

      {showEditor && (
        <PostEditor
          key={editingPost ? `post-${editingPost.id}` : `new-${(defaultDate?.getTime?.() ?? Date.now())}`}
          post={editingPost}
          selectedAccount={selectedAccount}
          accountPosts={posts}
          bulkIndex={isBulk ? bulkIndex : null}
          bulkTotal={isBulk ? bulkQueue.length : null}
          initialReadOnly={viewOnly}
          onDelete={onDelete}
          onPostNow={onPostNow}
          onClose={() => {
            if (isBulk) {
              setBulkQueue([]);
              setBulkIndex(0);
            }
            setShowEditor(false);
            setEditingPost(null);
            setViewOnly(false);
          }}
          onSave={async (_saved) => {
            if (isBulk) {
              setBulkQueue([]);
              setBulkIndex(0);
            }
            setShowEditor(false);
            setEditingPost(null);
            setViewOnly(false);
            await refetchRange();
          }}
        />
      )}


      {showBatch && (
        <BatchScheduleWizard
        open={showBatch}
        onClose={() => setShowBatch(false)}
        selectedAccount={selectedAccount}
        account={selectedAccount}
        timezone={
             selectedAccount?.timezone && selectedAccount.timezone !== "UTC"
               ? selectedAccount.timezone
               : browserTz
        }
        onCommitted={async () => {
          await refetchRange();
          setSelectedIds([]);
        }}
        apiBase=""
      />
      )}

      {replaceTarget && (
        <ReplacePostDialog
          open={!!replaceTarget}
          onClose={() => setReplaceTarget(null)}
          post={replaceTarget}
          apiBase=""
          onReplaced={async () => {
            await refetchRange();
          }}
        />
      )}

      {moveCtx && (
        <MovePostDialog
          open={moveOpen}
          onClose={() => {
            setMoveOpen(false);
            setMoveCtx(null);
            if (multiMoveActive) {
              setMultiMoveActive(false);
              setMultiMoveQueue([]);
              setMultiMoveTargetYMD(null);
              setMultiMoveIndex(0);
              setMultiMoveChosenTimes([]);
            }
          }}
          dateLabel={moveCtx.targetYMD}
          otherTimes={moveCtx.otherTimes}
          initialTime={moveCtx.initialHHmm}
          onConfirm={async (chosenHHmm) => {
            const finalHHmm = chosenHHmm || moveCtx.initialHHmm;
            await updatePostTime(moveCtx.post, moveCtx.targetYMD, finalHHmm);
            setMoveOpen(false);
            setMoveCtx(null);
            await refetchRange();
          }}
          onAutoPickAll={multiMoveActive ? autoPickAllRemaining : null}
          progressIndex={multiMoveActive ? multiMoveIndex + 1 : null}
          progressTotal={multiMoveActive ? multiMoveQueue.length : null}
        />
      )}

      {/* Delete dialog */}
      <Dialog open={deleteOpen} onOpenChange={(v) => !v && setDeleteOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirm delete</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-gray-700">
            {selectedIds.length === 1 ? "Delete this post?" : `Delete ${selectedIds.length} selected posts?`}
          </div>

          {/* 3-dot menu: only when exactly one future scheduled post is selected */}
          {canDeleteAfter && (
            <div className="mt-2">
              <button
                className="px-2 py-1 rounded border text-sm"
                onClick={() => setShowAfterMenu((v) => !v)}
                title="More options"
              >
                ⋮ More options
              </button>
              {showAfterMenu && (
                <div className="mt-2 border rounded shadow bg-white">
                  <button
                    className="px-3 py-2 hover:bg-gray-50 w-full text-left text-sm"
                    onClick={async () => {
                      const ok = window.confirm(
                        "Delete ALL future scheduled posts AFTER the selected post for this account?"
                      );
                      if (!ok) return;
                      await doDeleteAfter();
                    }}
                  >
                    Delete all posts after selected
                  </button>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteOpen(false)}>Cancel</Button>
            <Button className="bg-red-600 text-white" onClick={doBulkDelete} disabled={hasInvalidSelection}>
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
