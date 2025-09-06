// components/dayplanner/DayPlannerView.jsx
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Clock, Plus, CheckCircle2, AlertCircle, Loader2, ArrowLeft, MoreVertical } from 'lucide-react';
import { format } from 'date-fns';
import { Link } from 'react-router-dom';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const statusConfig = {
  scheduled: { icon: Clock, color: "text-blue-500" },
  posting: { icon: Loader2, color: "text-yellow-500 animate-spin" },
  posted: { icon: CheckCircle2, color: "text-green-500" },
  failed: { icon: AlertCircle, color: "text-red-500" },
  default: { icon: Clock, color: "text-gray-400" }
};

// helpers
const minsOfDay = (d) => {
  const dt = new Date(d);
  return dt.getHours() * 60 + dt.getMinutes();
};
const toHHMM = (m) => `${String(Math.floor(m/60)).padStart(2,"0")}:${String(m%60).toString().padStart(2,"0")}`;
const label12 = (m) => format(new Date(2000, 0, 1, Math.floor(m/60), m%60), "h:mm a");

const TimelineItem = ({ post, onPostSelect, onReplacePost }) => {
  const { icon: StatusIcon, color } = statusConfig[post.status] || statusConfig.default;
  const at = new Date(post.scheduled_at);
  const ampm = format(at, "h:mm a"); // ⬅️ 12-hour display

  return (
    <div className="flex items-center gap-3 p-3 bg-white rounded-lg border hover:shadow-md transition-all w-full">
      <StatusIcon className={`w-5 h-5 shrink-0 ${color}`} />
      <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onPostSelect(post)}>
        <p className="font-medium text-sm truncate">{post.caption || "(no caption)"}</p>
        <p className="text-xs text-gray-500 mt-1">
          {ampm} • {post.media_type?.charAt(0)?.toUpperCase() || "P"} • First comment: {post.first_comment ? 'Yes' : 'No'}
        </p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="p-1 rounded hover:bg-gray-50" aria-label="Actions">
            <MoreVertical className="w-4 h-4 text-gray-500" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onReplacePost?.(post)}>
            Replace post
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};

export default function DayPlannerView({
  posts,
  selectedDate,
  onDateChange,
  onPostSelect,
  onNewPost,
  dailyPostCount,
  selectedAccount,
  onReplacePost
}) {
  // Use minute offsets for slots; display as AM/PM
  const slotStarts = Array.from({ length: 24 * 4 }, (_, i) => i * 15); // 0,15,30,...,1435

  return (
    <div className="h-full p-4 md:p-6">
      <Card className="shadow-lg border-0 bg-white/90 backdrop-blur-sm">
        <CardHeader className="border-b flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/calendar">
              <Button variant="ghost" className="mr-1">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Calendar
              </Button>
            </Link>
            <Input
              type="date"
              value={format(selectedDate, "yyyy-MM-dd")}
              onChange={(e) => onDateChange(new Date(e.target.value + 'T00:00:00'))}
              className="w-auto"
            />
            <div>
              <CardTitle className="text-xl">
                {format(selectedDate, "EEEE, MMM d")}
              </CardTitle>
              <Badge variant={dailyPostCount >= 15 ? "destructive" : "secondary"} className="mt-1">
                {dailyPostCount}/15 posts
              </Badge>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={() => onNewPost()}
              className="bg-gradient-to-r from-purple-500 to-pink-500 hover:from-purple-600 hover:to-pink-600 text-white"
              disabled={!selectedAccount}
            >
              <Plus className="w-4 h-4 mr-2" />
              New Post
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[calc(100vh-250px)] overflow-y-auto">
            {slotStarts.map(start => {
              const end = start + 15; // interval [start, end)
              const postsInSlot = (posts || [])
                .filter(p => {
                  const m = minsOfDay(p.scheduled_at);
                  return m >= start && m < end;
                })
                .sort((a, b) => minsOfDay(a.scheduled_at) - minsOfDay(b.scheduled_at));

              return (
                <div key={start} className="flex items-start gap-4 p-3 border-b border-gray-100 min-h-[60px]">
                  <div className="w-20 shrink-0 text-sm font-medium text-gray-500 pt-3">
                    {label12(start)}{/* ⬅️ 12-hour labels */}
                  </div>
                  <div className="flex-1 min-h-[40px]">
                    {postsInSlot.length > 0 ? (
                      <div className="space-y-2">
                        {postsInSlot.map(post => (
                          <TimelineItem key={post.id} post={post} onPostSelect={onPostSelect} onReplacePost={onReplacePost} />
                        ))}
                      </div>
                    ) : (
                      <button
                        onClick={() => onNewPost(toHHMM(start))} // keep HH:mm for creation hook
                        className="w-full h-full flex items-center justify-center text-gray-300 hover:text-purple-500 transition-colors"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
