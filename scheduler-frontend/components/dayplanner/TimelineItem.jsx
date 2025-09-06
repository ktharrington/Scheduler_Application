import React from "react";
import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, AlertCircle } from "lucide-react";
import { format, parseISO } from "date-fns";

const statusConfig = {
  scheduled: { icon: Clock, color: "bg-blue-100 text-blue-800 border-blue-200" },
  posted: { icon: CheckCircle2, color: "bg-green-100 text-green-800 border-green-200" },
  failed: { icon: AlertCircle, color: "bg-red-100 text-red-800 border-red-200" }
};

export default function TimelineItem({ post, account, onClick }) {
  const { icon: StatusIcon, color } = statusConfig[post.status] || statusConfig.scheduled;
  
  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2 p-3 bg-white rounded-lg border hover:shadow-md transition-all cursor-pointer group"
    >
      <StatusIcon className="w-4 h-4 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">@{account?.handle || "unknown"}</span>
          <Badge variant="outline" className={`${color} text-xs`}>
            {format(parseISO(post.scheduled_at), "h:mm a")}
          </Badge>
        </div>
        <p className="text-xs text-gray-500 truncate mt-1">
          {post.caption?.substring(0, 40)}...
        </p>
      </div>
    </div>
  );
}