// Pages/DayPlanner.jsx
import React, { useMemo, useState } from "react";
import { useOutletContext, useSearchParams, useNavigate } from "react-router-dom";
import { startOfDay, endOfDay, parseISO } from "date-fns";
import DayPlannerView from "../components/dayplanner/DayPlannerView";
import PostEditor from "@/components/calendar/PostEditor";
import ReplacePostDialog from "@/components/posts/ReplacePostDialog";
import { useRangedPosts } from "@/components/hooks/useRangedPosts";
import { createPost, updatePost, cancelPost } from "@/components/api/PostsClient";

export default function DayPlanner() {
  const { selectedAccountId, selectedAccount } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  // selected date comes from ?date=YYYY-MM-DD or defaults to today
  const selectedDate = useMemo(() => {
    const q = params.get("date");
    if (q) return parseISO(q + "T00:00:00");
    return new Date();
  }, [params]);

  const range = useMemo(() => {
    const s = startOfDay(selectedDate);
    const e = endOfDay(selectedDate);
    return { startISO: s.toISOString(), endISO: e.toISOString() };
  }, [selectedDate]);

  const { posts: ranged, refetch } = useRangedPosts({
    accountId: selectedAccountId,
    startISO: range.startISO,
    endISO: range.endISO,
  });

  const posts = useMemo(() => Array.isArray(ranged) ? ranged : [], [ranged]);
  const dailyPostCount = posts.length;

  // editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editingPost, setEditingPost] = useState(null);
  const [defaultDate, setDefaultDate] = useState(selectedDate);

  // replace dialog state
  const [replaceTarget, setReplaceTarget] = useState(null);

  const onDateChange = (nextDate) => {
    const yyyy = nextDate.getFullYear();
    const mm = String(nextDate.getMonth() + 1).padStart(2, "0");
    const dd = String(nextDate.getDate()).padStart(2, "0");
    setParams({ date: `${yyyy}-${mm}-${dd}` }, { replace: true });
  };

  const onPostSelect = (post) => {
    setEditingPost(post);
    setDefaultDate(new Date(post.scheduled_at));
    setShowEditor(true);
  };

  const onReplacePost = (post) => setReplaceTarget(post);

  const onNewPost = (hhmm) => {
    const [h, m] = (hhmm || "12:00").split(":").map((n) => parseInt(n, 10));
    const when = new Date(selectedDate);
    when.setHours(h, m ?? 0, 0, 0);
    setEditingPost(null);
    setDefaultDate(when);
    setShowEditor(true);
  };

  const onSave = async (data) => {
    const when = new Date(data.scheduled_at);
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
    await refetch();
    setShowEditor(false);
    setEditingPost(null);
  };

  const onDelete = async (id) => {
    await cancelPost(id);
    await refetch();
    setShowEditor(false);
    setEditingPost(null);
  };

  const onPostNow = async (id) => {
    await updatePost(id, { scheduled_at: new Date().toISOString(), status: "scheduled" });
    await refetch();
    setShowEditor(false);
    setEditingPost(null);
  };

  if (!selectedAccountId) {
    return <div className="p-6 text-sm text-gray-600">No account selected.</div>;
  }

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold bg-gradient-to-r from-purple-600 to-pink-600 bg-clip-text text-transparent mb-6">
        Day Planner
      </h1>

      <DayPlannerView
        posts={posts}
        selectedDate={selectedDate}
        onDateChange={onDateChange}
        onPostSelect={onPostSelect}
        onNewPost={onNewPost}
        dailyPostCount={dailyPostCount}
        selectedAccount={selectedAccount}
        onReplacePost={onReplacePost}
      />

      {showEditor && (
        <PostEditor
          post={editingPost}
          defaultDate={defaultDate}
          onSave={onSave}
          onClose={() => { setShowEditor(false); setEditingPost(null); }}
          onDelete={onDelete}
          onPostNow={onPostNow}
          selectedAccount={selectedAccount}
          accountPosts={posts}
          initialReadOnly={!!editingPost}
        />
      )}

      {replaceTarget && (
        <ReplacePostDialog
          open={!!replaceTarget}
          onClose={() => setReplaceTarget(null)}
          post={replaceTarget}
          onReplaced={async () => { await refetch(); }}
        />
      )}
    </div>
  );
}
