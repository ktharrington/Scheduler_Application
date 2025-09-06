import React from "react";
import { getAccounts, refreshAccounts } from "../api/PostsClient";
import mockAccountsJson from "../entities/Account.json"; // <- your existing mock data

function normalize(list) {
  return (list || []).map((a) => ({
    id: a.id,
    handle: String(a.handle || "").replace(/^@+/, ""), // store without '@'
    ig_user_id: a.ig_user_id,
    timezone: a.timezone || "UTC",
    active: a.active !== false,
    today_count: a.today_count ?? 0,
  }));
}

function readUseMock() {
  try {
    if (typeof window !== "undefined") {
      const lsKeys = ["use_mock", "mock", "mockMode"];
      for (const k of lsKeys) {
        const v = window.localStorage.getItem(k);
        if (v != null) return v === "1" || v === "true";
      }
      if (typeof window.__USE_MOCK__ !== "undefined") return !!window.__USE_MOCK__;
    }
  } catch {}
  const env = import.meta.env?.VITE_USE_MOCK;
  return env === "1" || env === "true";
}

export function useAccounts() {
  const [accounts, setAccounts] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState(null);
  const [useMock, setUseMock] = React.useState(readUseMock);

  // react to toggles (same-tab custom event + cross-tab storage)
  React.useEffect(() => {
    const onStorage = (e) => {
      if (["use_mock", "mock", "mockMode"].includes(e.key)) setUseMock(readUseMock());
    };
    const onCustom = () => setUseMock(readUseMock());
    window.addEventListener("storage", onStorage);
    window.addEventListener("mock:changed", onCustom);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("mock:changed", onCustom);
    };
  }, []);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (useMock) {
        // from bundled JSON
        const list = Array.isArray(mockAccountsJson?.items)
          ? mockAccountsJson.items
          : Array.isArray(mockAccountsJson)
          ? mockAccountsJson
          : [];
        setAccounts(normalize(list));
      } else {
        const res = await getAccounts(); // {items:[...]}
        const list = Array.isArray(res?.items) ? res.items : Array.isArray(res) ? res : [];
        setAccounts(normalize(list));
      }
    } catch (e) {
      setError(e?.message || "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, [useMock]);

  // load on mount + whenever mock mode changes
  React.useEffect(() => { load(); }, [load]);

  const refreshFromMeta = React.useCallback(async (token, timezone) => {
    if (useMock) return; // no-op in mock
    await refreshAccounts({ token, timezone });
    await load();
  }, [useMock, load]);

  return { accounts, loading, error, refetch: load, refreshFromMeta, useMock };
}

export default useAccounts;
