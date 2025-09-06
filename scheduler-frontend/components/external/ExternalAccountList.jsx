import React from "react";
import { Badge } from "@/components/ui/badge";
import useAccounts from "../hooks/useAccounts";

function displayHandle(h) {
  return "@" + String(h || "").replace(/^@+/, "");
}

export default function ExternalAccountList({ selectedAccountId, onSelect }) {
  const { accounts, loading, error, refreshFromMeta } = useAccounts();

  if (loading) return <div className="p-4 text-sm text-gray-500">Loading accounts…</div>;
  if (error) return (
    <div className="p-4 text-sm text-red-500 space-y-2">
      <div>{error}</div>
      <button
        className="px-3 py-1 rounded bg-purple-600 text-white"
        onClick={() => refreshFromMeta(undefined, "America/Los_Angeles")}
      >
        Refresh from Meta
      </button>
    </div>
  );

  if (!accounts.length) {
    return (
      <div className="p-4 space-y-2">
        <div className="text-sm text-gray-500">No accounts found.</div>
        <button
          className="px-3 py-1 rounded bg-purple-600 text-white"
          onClick={() => refreshFromMeta(undefined, "America/Los_Angeles")}
        >
          Refresh from Meta
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-1">
      {accounts.map((a) => {
        const isSel = String(selectedAccountId) === String(a.id);
        const count = Number.isFinite(a.today_count) ? a.today_count : 0;
        return (
          <button
            key={a.id}
            onClick={() => onSelect?.(String(a.id))}
            className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all ${isSel ? "bg-purple-100" : "hover:bg-gray-100"}`}
          >
            <div className="w-8 h-8 rounded-full bg-purple-500/10 flex items-center justify-center text-purple-600 font-bold">@</div>
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{displayHandle(a.handle)}</p>
              <p className="text-xs text-gray-500">{a.timezone || "UTC"}</p>
            </div>
            <Badge variant={count >= 15 ? "destructive" : "secondary"}>{count}/15</Badge>
          </button>
        );
      })}
    </div>
  );
}
