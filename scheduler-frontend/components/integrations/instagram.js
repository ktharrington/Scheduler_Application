export async function getPublishingLimit(accountId) {
    const res = await fetch(`/api/ig/publishing_limit?account_id=${encodeURIComponent(accountId)}`, {
      method: "GET",
      credentials: "omit",
    });
    if (!res.ok) throw new Error(`publishing_limit failed (${res.status})`);
    return await res.json();
  }
  
  export async function createContainer({ accountId, payload }) {
    // payload: { image_url | video_url | is_carousel_item | children | caption | thumb_offset }
    const res = await fetch(`/api/ig/create_container`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ account_id: String(accountId), ...payload }),
    });
    if (!res.ok) throw new Error(`create_container failed (${res.status})`);
    return await res.json();
  }
  
  export async function getContainerStatus({ accountId, containerId }) {
    const res = await fetch(`/api/ig/container_status?account_id=${encodeURIComponent(accountId)}&container_id=${encodeURIComponent(containerId)}`, {
      method: "GET",
      credentials: "omit",
    });
    if (!res.ok) throw new Error(`container_status failed (${res.status})`);
    return await res.json();
  }
  
  export async function publishContainer({ accountId, containerId }) {
    const res = await fetch(`/api/ig/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "omit",
      body: JSON.stringify({ account_id: String(accountId), container_id: String(containerId) }),
    });
    if (!res.ok) throw new Error(`publish failed (${res.status})`);
    return await res.json();
  }
  
  export async function publishDue() {
    const res = await fetch(`/api/ig/publish_due`, {
      method: "POST",
      credentials: "omit",
    });
    if (!res.ok) throw new Error(`publish_due failed (${res.status})`);
    return await res.json().catch(() => ({}));
  }