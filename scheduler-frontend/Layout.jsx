// scheduler-frontend/Layout.jsx
import React, { useState, useEffect, useCallback } from "react";
import { Instagram, Menu } from "lucide-react";
import { Outlet } from "react-router-dom";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

// NEW: shadcn/ui bits for the sheet + a small trigger button
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetClose,
} from "@/components/ui/sheet";

// NOTE: We intentionally do NOT statically import mock files.
// They are dynamically loaded in dev only (see useEffect below).

function normalizeAccounts(arr) {
  return (Array.isArray(arr) ? arr : []).map((a) => ({
    id: a.id ?? a.account_id ?? a.handle ?? a.name,
    handle: a.handle ?? a.username ?? a.name ?? String(a.id ?? ""),
    active: a.active !== false, // paused if false
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
    const res = await fetch("/api/accounts", {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json();
    // backend returns { items: [...] }
    return normalizeAccounts(data?.items || []);
  } catch {
    return [];
  }
}

export default function Layout() {
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [menuOpenFor, setMenuOpenFor] = useState(null);

  // NEW: control the left-side quick-nav sheet
  const [navOpen, setNavOpen] = useState(false);

  const refreshAccounts = useCallback(async () => {
    const items = await fetchAccountsDirect();
    setAccounts(items);
    // keep selection if still present
    if (selectedAccountId && !items.some(a => String(a.id) === String(selectedAccountId))) {
      const first = items?.[0]?.id ?? null;
      setSelectedAccountId(first ? String(first) : null);
      if (first) localStorage.setItem("selectedAccountId", String(first));
    }
  }, [selectedAccountId]);

  const freeze = useCallback(async (id) => {
    const ok = window.confirm(
      "Freeze this account? All scheduled posts will be marked failed and nothing will publish."
    );
    if (!ok) return;
    await fetch(`/api/accounts/${id}/freeze`, { method: "POST" });
    await refreshAccounts();
  }, [refreshAccounts]);

  const unfreeze = useCallback(async (id) => {
    const ok = window.confirm("Unfreeze this account and allow publishing?");
    if (!ok) return;
    await fetch(`/api/accounts/${id}/unfreeze`, { method: "POST" });
    await refreshAccounts();
  }, [refreshAccounts]);

  const clearOldPosts = useCallback(async (id) => {
    const ok = window.confirm(
      "Clear all old posts for this account (everything scheduled before now)? This cannot be undone."
    );
    if (!ok) return;
    try {
      const res = await fetch(`/api/accounts/${id}/clear_old_posts`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      const n = data?.deleted ?? 0;

      // tell any mounted calendars to refresh
      window.dispatchEvent(
        new CustomEvent("calendar:refresh", {
          detail: { accountId: id, reason: "clear_old_posts" },
        })
      );

      alert(`Cleared ${n} old post(s).`);
    } catch (e) {
      alert("Failed to clear old posts. Check the server logs.");
    }
  }, []);

  // dev-only mock components (lazy-loaded so they aren’t bundled in prod)
  const [MockBatchApiComp, setMockBatchApiComp] = useState(null);
  const [MockToggleComp, setMockToggleComp] = useState(null);

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
        sticky && items.some((a) => String(a.id) === String(sticky))
          ? sticky
          : first != null
          ? String(first)
          : null;
      setSelectedAccountId(initial);
      if (initial) localStorage.setItem("selectedAccountId", initial);
      setIsLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Load mock UI & API ONLY in development when enabled by env flag
  useEffect(() => {
    if (import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK_UI !== "0") {
      import("@/components/dev/mockbatchapi")
        .then((m) => {
          const Comp = m?.default || m?.MockBatchApi || null;
          if (Comp) setMockBatchApiComp(() => Comp);
        })
        .catch(() => {});

      import("@/components/dev/mocktoggle")
        .then((m) => setMockToggleComp(() => m.default || m.MockToggle))
        .catch(() => {});
    }
  }, []);

  const selectAccount = (val) => {
    const idStr = String(val);
    setSelectedAccountId(idStr);
    localStorage.setItem("selectedAccountId", idStr);
  };

  const selectedAccount =
    accounts.find((a) => String(a.id) === String(selectedAccountId)) || null;

  const outletContext = {
    accounts,
    selectedAccountId,
    selectedAccount,
    isDataLoading: isLoading,
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* DEV ONLY: mock API component if it exists and was loaded */}
      {MockBatchApiComp ? <MockBatchApiComp /> : null}

      {/* NEW: tiny launcher in the absolute top-left (mobile + desktop) */}
      <Sheet open={navOpen} onOpenChange={setNavOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="fixed top-2 left-2 z-50 h-8 w-8 rounded-md border bg-white/90 backdrop-blur text-gray-700 shadow hover:bg-white"
            title="Open quick navigation"
            aria-label="Open quick navigation"
          >
            <Menu className="w-4 h-4" />
          </Button>
        </SheetTrigger>

        {/* Left-side sheet with your navigation buttons */}
        <SheetContent side="left" className="w-72 p-0">
          <div className="p-4 border-b">
            <SheetHeader>
              <SheetTitle>Quick Navigation</SheetTitle>
              <SheetDescription>Jump to tools & sections</SheetDescription>
            </SheetHeader>
          </div>

          <nav className="p-2 space-y-1">
            {/* FIRST BUTTON → your companion app (opens in a new tab) */}
            <SheetClose asChild>
              <a
                href="https://web-production-12fe7.up.railway.app/"
                className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-gray-100 text-sm font-medium text-gray-800"
                title="Open companion app in a new tab"
              >
                🔗 Companion App
              </a>
            </SheetClose>

            {/* EXAMPLES — add more buttons here as needed */}
            {/* Internal route example (uncomment & swap path): */}
            {/*
            <SheetClose asChild>
              <a
                href="/settings"
                className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-gray-100 text-sm text-gray-700"
              >
                ⚙️ Settings
              </a>
            </SheetClose>
            */}

            {/* Placeholder external link example: */}
            {/*
            <SheetClose asChild>
              <a
                href="https://your-docs-or-dashboard.example.com"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-gray-100 text-sm text-gray-700"
              >
                📚 Docs / Dashboard
              </a>
            </SheetClose>
            */}
          </nav>
        </SheetContent>
      </Sheet>

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
                <SelectValue
                  placeholder={isLoading ? "Loading..." : "Select account"}
                />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((account) => (
                  <div key={account.id} className="relative">
                    <button
                      onClick={() => selectAccount(account.id)}
                      className={[
                        "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all border",
                        String(selectedAccountId) === String(account.id)
                          ? (account.active
                              ? "bg-purple-100 border-purple-200"
                              : "bg-blue-100 border-blue-300 ring-2 ring-blue-300")
                          : (account.active
                              ? "hover:bg-gray-100 border-transparent"
                              : "bg-blue-50 border-blue-200"),
                      ].join(" ")}
                      title={account.active ? "Active" : "Paused"}
                    >
                      <div
                        className={[
                          "w-8 h-8 rounded-full flex items-center justify-center text-white font-bold",
                          account.active ? "bg-purple-500" : "bg-blue-500",
                        ].join(" ")}
                      >
                        {(account.handle || "").charAt(0).toUpperCase() || "#"}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">@{account.handle ?? account.id}</p>
                        {!account.active && (
                          <p className="text-xs text-blue-700">Paused</p>
                        )}
                      </div>
                    </button>

                    {/* 3-dot menu */}
                    <button
                      className="absolute right-1 top-1 p-1 rounded hover:bg-gray-200"
                      aria-label="Account actions"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenFor(menuOpenFor === account.id ? null : account.id);
                      }}
                    >
                      <span className="text-xl leading-none">⋯</span>
                    </button>

                    {menuOpenFor === account.id && (
                      <div className="absolute right-1 top-9 z-10 w-40 rounded-md border bg-white shadow-md">
                        {account.active ? (
                          <button
                            className="w-full text-left px-3 py-2 hover:bg-gray-50"
                            onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); freeze(account.id); }}
                          >
                            Freeze account
                          </button>
                        ) : (
                          <button
                            className="w-full text-left px-3 py-2 hover:bg-gray-50"
                            onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); unfreeze(account.id); }}
                          >
                            Unfreeze account
                          </button>
                        )}

                        <div className="my-1 border-t" />
                        <button
                          className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-700"
                          onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); clearOldPosts(account.id); }}
                        >
                          Clear old posts
                        </button>
                      </div>
                    )}
                  </div>
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
          {isLoading && (
            <div className="text-sm text-gray-500">Loading accounts…</div>
          )}
          {!isLoading && accounts.length === 0 && (
            <div className="text-sm text-gray-500">No accounts yet</div>
          )}
          {accounts.map((account) => (
            <div key={account.id} className="relative group">
              <button
                onClick={() => selectAccount(account.id)}
                className={[
                  "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all border",
                  String(selectedAccountId) === String(account.id)
                    ? (account.active ? "bg-purple-100 border-purple-200"
                                      : "bg-blue-100 border-blue-300 ring-2 ring-blue-300")
                    : (account.active ? "hover:bg-gray-100 border-transparent"
                                      : "bg-blue-50 border-blue-200"),
                ].join(" ")}
                title={account.active ? "Active" : "Paused"}
              >
                <div className={[
                  "w-8 h-8 rounded-full flex items-center justify-center text-white font-bold",
                  account.active ? "bg-purple-500" : "bg-blue-500",
                ].join(" ")}>
                  {(account.handle || "").charAt(0).toUpperCase() || "#"}
                </div>

                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">@{account.handle ?? account.id}</p>
                  {!account.active && (
                    <span className="inline-block mt-0.5 text-[11px] px-1.5 py-0.5 rounded bg-blue-200 text-blue-900">
                      Paused
                    </span>
                  )}
                </div>
              </button>

              {/* 3-dot (kebab) menu */}
              <button
                className="absolute right-1 top-1 p-1 rounded hover:bg-gray-200"
                aria-label="Account actions"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpenFor(menuOpenFor === account.id ? null : account.id);
                }}
              >
                <span className="text-xl leading-none">⋯</span>
              </button>

              {menuOpenFor === account.id && (
                <div className="absolute right-1 top-9 z-10 w-40 rounded-md border bg-white shadow-md">
                  {account.active ? (
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-gray-50"
                      onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); freeze(account.id); }}
                    >
                      Freeze account
                    </button>
                  ) : (
                    <button
                      className="w-full text-left px-3 py-2 hover:bg-gray-50"
                      onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); unfreeze(account.id); }}
                    >
                      Unfreeze account
                   </button>
                  )}

                  <div className="my-1 border-t" />
                  <button
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 text-red-700"
                    onClick={(e) => { e.stopPropagation(); setMenuOpenFor(null); clearOldPosts(account.id); }}
                  >
                    Clear old posts
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </aside>

      {/* Pages mount here */}
      <main className="flex-1 pt-14 md:pt-0">
        <Outlet context={outletContext} />
      </main>

      {/* DEV ONLY: render toggle if it was loaded */}
      {MockToggleComp ? <MockToggleComp /> : null}
    </div>
  );
}
