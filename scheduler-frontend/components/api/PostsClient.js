// /components/api/PostsClient.js — DROP-IN REPLACEMENT
// Works with the FastAPI backend in main.py (vite proxy `/api` -> 8080)

//
// --------------------------- tiny utils ---------------------------
//
function qstr(params = {}) {
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x) => usp.append(k, x));
    else usp.set(k, String(v));
  });
  return usp.toString();
}

async function http(path, { method = "GET", headers = {}, body, signal } = {}) {
  const url = path.startsWith("http") ? path : path; // vite dev proxy handles /api/*
  const init = {
    method,
    headers: {
      ...(body && !(body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      Accept: "application/json",
      ...headers,
    },
    signal,
  };
  if (body !== undefined) {
    init.body = body instanceof FormData ? body : JSON.stringify(body);
  }
  const res = await fetch(url, init);
  const isJSON = (res.headers.get("content-type") || "").includes("application/json");
  const data = isJSON ? await res.json().catch(() => null) : await res.text().catch(() => null);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} ${res.statusText} for ${method} ${url}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

//
// --------------------------- shared mappers ---------------------------
//

function normalizeFolderPrefix(prefix) {
  if (!prefix) return "";
  let raw = String(prefix).trim();

  // Full URL → peel path (e.g., /bucket/folder/…)
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw);
      raw = u.pathname;
    }
  } catch (_) {}

  // s3:// or r2:// → strip scheme
  raw = raw.replace(/^(s3|r2):\/\//i, "");

  // Remove leading slashes
  raw = raw.replace(/^\/+/, "");

  // If first segment looks like a bucket name, drop it
  const parts = raw.split("/").filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const bucketLike = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/i.test(first) && !/\.\./.test(first);
    const envBucket = (import.meta?.env?.VITE_MEDIA_BUCKET || "").trim();
    if (bucketLike && (!envBucket || first === envBucket)) {
      parts.shift();
    }
  }

  let p = parts.join("/");
  p = p.replace(/\/+/g, "/");
  if (!p.endsWith("/")) p += "/";
  return p;
}
export { normalizeFolderPrefix };



function mapEditorPayloadToPostCreate(input = {}) {
  // Accept camelCase or snake_case from the UI; map to backend model.
  const account_id =
    input.account_id ?? input.accountId ?? input.account?.id ?? input.account;
  const scheduled_at =
    input.scheduled_at ?? input.scheduledAt ?? input.time ?? input.datetime;
  // UI sometimes uses media_type; backend expects post_type
  const post_type = input.post_type ?? input.media_type ?? input.type ?? "photo";

  const out = {
    account_id,
    post_type,
    scheduled_at,
    caption: input.caption ?? "",
  };

  if (input.media_url) out.media_url = input.media_url;
  if (input.asset_id != null) out.asset_id = input.asset_id;
  if (input.client_request_id) out.client_request_id = input.client_request_id;
  if (input.override_spacing != null) out.override_spacing = !!input.override_spacing;

  return out;
}

//
// --------------------------- media ---------------------------
//
// components/api/PostsClient.js
export async function listMedia({ prefix, sort, order, extensions, limit, signal } = {}) {
  const qs = new URLSearchParams();
  if (prefix) qs.set("prefix", prefix);
  if (sort) qs.set("sort", sort);
  if (order) qs.set("order", order);
  if (extensions) qs.set("extensions", extensions);
  if (limit) qs.set("limit", String(limit));

  const res = await fetch(`/api/media/list?${qs.toString()}`, { signal, headers: { Accept: "application/json" } });
  const data = await res.json().catch(() => ({}));

  // Normalize to a consistent return shape
  const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data) ? data : []);
  return { items };
}


//
// --------------------------- posts range ---------------------------
//
export async function fetchPostsRange(params = {}) {
  const account_id = params.account_id ?? params.accountId;
  const start = params.start ?? params.startISO;
  const end = params.end ?? params.endISO;
  const signal = params.signal;

  const query = qstr({ account_id, start, end });
  const data = await http(`/api/posts/query?${query}`, { signal });
  // backend returns { items: [...] }
  return Array.isArray(data?.items) ? data.items : [];
}

//
// --------------------------- CRUD ---------------------------
//
export async function getPost(postId, { signal } = {}) {
  return http(`/api/posts/${postId}`, { method: "GET", signal });
}

export async function createPost(data) {
  // normalize datetime to ISO even if it's "YYYY-MM-DDTHH:mm"
  const dt = new Date(data.scheduled_at);
  const scheduled_at = isNaN(dt.getTime()) ? data.scheduled_at : dt.toISOString();

  const body = {
    account_id: data.account_id,
    platform: data.platform || "instagram",
    post_type: data.post_type || "photo",
    media_url: data.media_url,
    caption: data.caption,
    scheduled_at,
    asset_id: data.asset_id ?? null,
    client_request_id: data.client_request_id ?? null,
    override_spacing: !!data.override_spacing,
  };

  // IMPORTANT: first arg is path, second is options
  return http("/api/posts", { method: "POST", body });
}


export async function deletePost(postId) {
  return http(`/api/posts/${postId}`, { method: "DELETE" });
}

// Update semantics:
// 1) try PUT /api/posts/{id} if server supports it
// 2) if not supported, emulate by delete -> create, but first GET the original
//    to merge required fields like account_id, media_url, post_type, caption.
export async function updatePost(postId, payload) {
  const candidate = mapEditorPayloadToPostCreate(payload);
  try {
    const put = await http(`/api/posts/${postId}`, { method: "PUT", body: candidate });
    return put;
  } catch (err) {
    if (err?.status && ![404, 405, 501].includes(err.status)) throw err;

    // Fallback: read existing, merge, then delete->create
    let original = {};
    try {
      original = (await getPost(postId)) || {};
    } catch {
      // ignore; we’ll just rely on candidate if GET fails
    }

    const merged = mapEditorPayloadToPostCreate({
      // required fields from original if missing in candidate
      account_id: candidate.account_id ?? original.account_id,
      post_type: candidate.post_type ?? original.post_type ?? "photo",
      media_url: candidate.media_url ?? original.media_url,
      asset_id: candidate.asset_id ?? original.asset_id,
      caption: candidate.caption ?? original.caption,
      scheduled_at: candidate.scheduled_at ?? original.scheduled_at,
      client_request_id: candidate.client_request_id ?? original.client_request_id,
      override_spacing: candidate.override_spacing ?? false,
    });

    // Safety: we need at least account_id and either media_url or asset_id
    if (!merged?.account_id || (!merged?.media_url && merged?.asset_id == null)) {
      const e = new Error("updatePost fallback requires account_id and media_url/asset_id");
      e.data = { postId, merged, candidate, original };
      throw e;
    }

    await deletePost(postId).catch(() => {});
    return createPost(merged);
  }
}

// For UI code that still calls "cancelPost", keep an alias
export const cancelPost = deletePost;

// Explicit "replace" operation (delete then create)
export async function replacePost(postId, payload) {
  const body = mapEditorPayloadToPostCreate(payload);
  await deletePost(postId).catch(() => {});
  return createPost(body);
}

export async function bulkDelete(ids = []) {
  const body = { ids: Array.isArray(ids) ? ids : [ids] };
  try {
    // preferred: backend bulk endpoint
    return await http(`/api/posts/bulk_delete`, { method: "POST", body });
  } catch {
    // fallback: fan-out
    const results = await Promise.allSettled(
      (body.ids || []).map((id) => deletePost(id))
    );
    const deleted = results.filter((r) => r.status === "fulfilled").length;
    return { deleted };
  }
}

export async function deleteAfter(account_id, afterISO) {
  const body = { account_id, after: afterISO };
  return http(`/api/posts/delete_after`, { method: "POST", body });
}

//
// --------------------------- batch scheduling ---------------------------
//
export async function batchPreflight({
  account_id,
  start_date,
  end_date,
  weekly_plan,
  timezone,
  autoshift,
  min_spacing_minutes,
}) {
  return http(`/api/posts/batch_preflight`, {
    method: "POST",
    body: {
      account_id,
      start_date,
      end_date,
      weekly_plan,
      timezone,
      autoshift,
      min_spacing_minutes,
    },
  });
}

export async function batchCommit(params) {
  const body = {
    account_id: params.account_id,
    start_date: params.start_date,
    end_date: params.end_date,
    weekly_plan: params.weekly_plan,
    timezone: params.timezone,
    autoshift: !!params.autoshift,
    min_spacing_minutes: params.min_spacing_minutes,
    media_urls: params.media_urls || null,
    random_start: params.random_start || null,
    random_end: params.random_end || null,
    override_conflicts: !!params.override_conflicts,
    video_mode: params.video_mode || "feed_and_reels", // <— NEW
  };
  return http(`/api/posts/batch/commit`, { method: "POST", body });
}

// also export the helpers some components import
export const utils = { qstr, normalizeFolderPrefix, mapEditorPayloadToPostCreate };
export default {
  listMedia,
  fetchPostsRange,
  getPost,
  createPost,
  updatePost,
  deletePost,
  cancelPost,
  replacePost,
  bulkDelete,
  deleteAfter,
  batchPreflight,
  batchCommit,
  utils,
  normalizeFolderPrefix,
};
