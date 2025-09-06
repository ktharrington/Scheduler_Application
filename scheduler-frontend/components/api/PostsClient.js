/* Centralized client for external backend API */

function resolveApiBase() {
  // Prefer explicit overrides; otherwise stick to relative paths so Vite's proxy handles /api/*
  try {
    if (typeof window !== "undefined") {
      if (window.__API_BASE__) return String(window.__API_BASE__).replace(/\/+$/, "");
      const ls = localStorage.getItem("api_base");
      if (ls) return String(ls).replace(/\/+$/, "");
    }
  } catch {}
  return ""; // relative: same-origin (Vite proxy in dev, reverse proxy in prod)
}

const API_BASE = resolveApiBase();

function withBase(path) {
  if (!API_BASE) return path; // relative, same origin
  if (path.startsWith("http")) return path;
  return `${API_BASE}${path.startsWith("/") ? "" : "/"}${path}`;
}

// ------------- helpers -------------
async function http(path, opts = {}) {
  const res = await fetch(withBase(path), {
    credentials: "omit",
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  const ct = res.headers.get("content-type") || "";
  const body = ct.includes("application/json") ? await res.json().catch(() => null) : await res.text().catch(() => "");
  if (!res.ok) {
    const msg = typeof body === "string" ? body : JSON.stringify(body);
    throw new Error(`HTTP ${res.status} ${res.statusText} @ ${path}\n${msg}`);
  }
  return body;
}

// ------------- Accounts -------------
export function getAccounts() {
  // backend returns: { items: [{id, handle, ig_user_id, timezone, active}, ...] }
  return http("/api/accounts", { method: "GET" });
}
export function refreshAccounts({ token, timezone } = {}) {
  const payload = {};
  if (token) payload.token = token;
  if (timezone) payload.timezone = timezone;
  return http("/api/accounts/refresh", { method: "POST", body: JSON.stringify(payload) });
}

// ------------- Posts -------------
export async function fetchPostsRange({ accountId, startISO, endISO, limit, cursor }) {
  const qs = new URLSearchParams({
    account_id: String(accountId || ""),
    start: startISO,
    end: endISO,
  });
  if (limit) qs.set("limit", String(limit));
  if (cursor) qs.set("cursor", String(cursor));

  const res = await fetch(withBase(`/api/posts/query?${qs.toString()}`), { credentials: "omit" });
  if (!res.ok) return null;
  const data = await res.json();
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.posts)) return data.posts;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items; // backend returns {items:[...]}
  return null;
}

export async function createPost(post) {
  const payload = { ...post };
  if (!payload.client_request_id) {
    payload.client_request_id = `b44_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return http("/api/posts", { method: "POST", body: JSON.stringify(payload) });
}

export async function updatePost(id, patch) {
  return http(`/api/posts/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export async function cancelPost(id) {
  return http(`/api/posts/${encodeURIComponent(id)}/cancel`, { method: "POST" });
}

// -------- Batch helpers (match backend routes) --------
export function batchPreflight(payload) {
  return http("/api/posts/batch_preflight", { method: "POST", body: JSON.stringify(payload) });
}
export function batchCommit(payload) {
  return http("/api/posts/batch_commit", { method: "POST", body: JSON.stringify(payload) });
}
