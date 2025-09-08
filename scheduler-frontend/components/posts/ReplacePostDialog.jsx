import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { updatePost } from "@/components/api/PostsClient";


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


export default function ReplacePostDialog({ open, onClose, post, posts, onReplaced }) {
  const [mediaUrlsText, setMediaUrlsText] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [progress, setProgress] = React.useState({ done: 0, total: 1 });

  const selectedArray = React.useMemo(() => {
    if (Array.isArray(posts) && posts.length > 0) return posts;
    return post ? [post] : [];
  }, [post, posts]);

  React.useEffect(() => {
    if (!open) {
      setMediaUrlsText("");
      setError(null);
      setLoading(false);
      setProgress({ done: 0, total: 1 });
    } else {
      setProgress({ done: 0, total: Math.max(1, selectedArray.length) });
    }
  }, [open, selectedArray.length]);

  const doReplace = async () => {
    setLoading(true);
    setError(null);
    const nowTs = Date.now();
    const bad = selectedArray.some(
      (p) =>
        !(String(p?.status || "").toLowerCase() === "scheduled" &&
          new Date(p.scheduled_at).getTime() > nowTs)
    );
    if (bad) throw new Error("Only future scheduled posts can be replaced. Deselect past or non-scheduled posts.");
    try {
      const urls = mediaUrlsText
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);

      if (urls.length === 0) throw new Error("Please provide at least one media URL.");

      for (let i = 0; i < selectedArray.length; i++) {
        const target = selectedArray[i];
        const url = urls.length === 1 ? urls[0] : urls[i] || urls[urls.length - 1];
        const cap = extractCaptionFromString(url);
        const payload = cap ? { media_url: url, caption: cap } : { media_url: url };
        await updatePost(target.id, payload);
        setProgress({ done: i + 1, total: selectedArray.length });
      }
      

      onReplaced?.();
      onClose?.();
    } catch (e) {
      setError(e?.message || "Replace failed");
    } finally {
      setLoading(false);
    }
  };

  const multi = selectedArray.length > 1;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose?.()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{multi ? `Replace ${selectedArray.length} posts` : "Replace post"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {!multi && (
            <div className="text-sm text-gray-600">
              Post: <span className="font-medium">{selectedArray[0]?.caption?.slice(0, 60) || "(no caption)"}</span>
            </div>
          )}
          {multi && (
            <div className="text-sm text-gray-600">
              Selected posts: <span className="font-medium">{selectedArray.length}</span>
            </div>
          )}

          <div>
            <Label>New media URL{multi ? "s" : ""}</Label>
            <textarea
              className="mt-2 w-full min-h-[100px] rounded border p-2 text-sm"
              placeholder={multi ? "One URL per line (will map to each selected post in order)" : "https://.../image.jpg"}
              value={mediaUrlsText}
              onChange={(e) => setMediaUrlsText(e.target.value)}
            />
            <p className="text-xs text-gray-500 mt-1">
              If you enter fewer URLs than selected posts, the last URL will be reused.
            </p>
          </div>

          {multi && <div className="text-xs text-gray-500">Progress: {progress.done}/{progress.total}</div>}
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onClose?.()}>Cancel</Button>
          <Button onClick={doReplace} disabled={loading} className="bg-gradient-to-r from-purple-500 to-pink-500 text-white">
            {loading ? (multi ? `Replacing ${progress.done}/${progress.total}...` : "Replacing...") : (multi ? "Replace all" : "Replace")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
