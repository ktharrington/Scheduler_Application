import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { format, isToday } from "date-fns";

function clean(h) {
  return String(h || "").replace(/^@+/, "");
}
function displayHandle(h) {
  return "@" + clean(h);
}

const AccountItem = ({ account, isSelected, onSelect, postCount }) => {
  const initial = clean(account.handle).charAt(0).toUpperCase() || "A";
  const color = account.color || "#8B5CF6"; // purple fallback
  const expires = account.token_expires_at ? new Date(account.token_expires_at) : null;
  const isValid = expires ? expires > new Date() : true;

  return (
    <button
      onClick={() => onSelect?.(account.id)}
      className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all duration-200 ${
        isSelected ? "bg-gradient-to-r from-purple-100 to-pink-100 shadow-sm" : "hover:bg-gray-100"
      }`}
    >
      <div className="relative">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-purple-600"
          style={{ backgroundImage: `linear-gradient(135deg, ${color}33, ${color})` }}
        >
          {initial || "@"}
        </div>
        {expires && (
          isValid
            ? <CheckCircle2 className="absolute -bottom-1 -right-1 w-4 h-4 text-green-500 bg-white rounded-full p-0.5" />
            : <AlertTriangle className="absolute -bottom-1 -right-1 w-4 h-4 text-yellow-500 bg-white rounded-full p-0.5" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-semibold truncate ${isSelected ? "text-purple-800" : "text-gray-800"}`}>
          {displayHandle(account.handle)}
        </p>
        {expires ? (
          <p className="text-xs text-gray-500">Token {isValid ? "expires" : "expired"} {format(expires, "MMM d")}</p>
        ) : (
          <p className="text-xs text-gray-500">{account.timezone || "UTC"}</p>
        )}
      </div>
      <Badge variant={postCount >= 15 ? "destructive" : "secondary"} className="ml-auto">
        {postCount}/15
      </Badge>
    </button>
  );
};

export default function AccountList({ posts, accounts, selectedAccountId, selectAccount, isLoading }) {
  const [searchTerm, setSearchTerm] = useState("");

  const filteredAccounts = (accounts || []).filter((acc) =>
    clean(acc.handle).toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="p-4 flex justify-center">
        <Loader2 className="animate-spin text-purple-500" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <Input
        placeholder="Find account…"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        className="w-full"
      />
      <div className="space-y-1">
        {filteredAccounts.map((account) => {
          const todayPostCount = (posts || []).filter(
            (p) => String(p.account_id) === String(account.id) && isToday(new Date(p.scheduled_at))
          ).length;
          return (
            <AccountItem
              key={account.id}
              account={account}
              isSelected={String(selectedAccountId) === String(account.id)}
              onSelect={selectAccount}
              postCount={todayPostCount}
            />
          );
        })}
      </div>
    </div>
  );
}
