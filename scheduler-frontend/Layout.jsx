// scheduler-frontend/Layout.jsx
import React, { useState, useEffect } from "react";
import { Instagram } from "lucide-react";
import { Outlet } from "react-router-dom";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

// match on-disk lowercase filenames
import MockBatchApi from "@/components/dev/mockbatchapi";
import MockToggle from "@/components/dev/mocktoggle";

function normalizeAccounts(arr) {
  return (Array.isArray(arr) ? arr : []).map(a => ({
    id: a.id ?? a.account_id ?? a.handle ?? a.name,
    handle: a.handle ?? a.username ?? a.name ?? String(a.id ?? ""),
  }));
}

async function tryLoadAccountsFromEntity() {
  try {
    const mod = await import("@/entities/Account").catch(() => null);
    const Account = mod?.Account || mod?.default;
    if (Account?.list) return normalizeAccounts(await Account.list());
  } catch {}
  return null;
}

async function fetchAccountsDirect() {
  try {
    const res = await fetch("/api/accounts", { headers: { Accept: "application/json" } });
    if (!res.ok) return [];
    return normalizeAccounts(await res.json());
  } catch {
    return [];
  }
}

export default function Layout() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const viaEntity = await tryLoadAccountsFromEntity();
      const items = viaEntity ?? (await fetchAccountsDirect());
      if (cancelled) return;

      setAccounts(items);
      const sticky = localStorage.getItem("selectedAccountId");
      const first = items?.[0]?.id;
      const initial =
        sticky && items.some(a => String(a.id) === String(sticky))
          ? sticky
          : first != null
          ? String(first)
          : null;
      setSelectedAccountId(initial);
      if (initial) localStorage.setItem("selectedAccountId", initial);
      setIsLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const selectAccount = (val) => {
    const idStr = String(val);
    setSelectedAccountId(idStr);
    localStorage.setItem("selectedAccountId", idStr);
  };

  const selectedAccount =
    accounts.find(a => String(a.id) === String(selectedAccountId)) || null;

  const outletContext = {
    accounts,
    selectedAccountId,
    selectedAccount,
    isDataLoading: isLoading,
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      <MockBatchApi />

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-20 bg-white/80 backdrop-blur border-b">
        <div className="px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
              <Instagram className="w-5 h-5 text-white" />
            </div>
            <span className="font-semibold text-gray-900">PostCraft</span>
          </div>

          <div className="min-w-[160px]">
            <Select
              value={selectedAccountId || ""}
              onValueChange={selectAccount}
              disabled={isLoading || accounts.length === 0}
            >
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder={isLoading ? "Loading..." : "Select account"} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map(acc => (
                  <SelectItem key={acc.id} value={String(acc.id)}>
                    @{acc.handle ?? acc.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {/* Sidebar (desktop) */}
      <aside className="w-80 bg-white border-r shadow-sm hidden md:block">
        <div className="p-6 border-b">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-r from-purple-500 to-pink-500 flex items-center justify-center">
              <Instagram className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="font-bold text-gray-900">PostCraft</h2>
              <p className="text-xs text-gray-500">Instagram Scheduler</p>
            </div>
          </div>
        </div>

        <div className="p-4">
          {isLoading && <div className="text-sm text-gray-500">Loading accounts…</div>}
          {!isLoading && accounts.length === 0 && (
            <div className="text-sm text-gray-500">No accounts yet</div>
          )}
          {accounts.map(account => (
            <button
              key={account.id}
              onClick={() => selectAccount(account.id)}
              className={`w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all ${
                String(selectedAccountId) === String(account.id)
                  ? "bg-purple-100"
                  : "hover:bg-gray-100"
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-purple-500 flex items-center justify-center text-white font-bold">
                {(account.handle || "").charAt(0).toUpperCase() || "#"}
              </div>
              <div>
                <p className="font-medium">@{account.handle ?? account.id}</p>
              </div>
            </button>
          ))}
        </div>
      </aside>

      {/* Pages mount here */}
      <main className="flex-1 pt-14 md:pt-0">
        <Outlet context={outletContext} />
      </main>

      <MockToggle />
    </div>
  );
}
