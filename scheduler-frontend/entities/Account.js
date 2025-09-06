// Entities/Account.js
export const Account = {
  async list() {
    const res = await fetch("/api/accounts", { headers: { Accept: "application/json" }, credentials: "omit" });
    if (!res.ok) throw new Error(`Failed to load accounts: ${res.status}`);
    const data = await res.json();

    const arr = Array.isArray(data?.items) ? data.items : Array.isArray(data) ? data : [];
    return arr.map((a) => ({
      id: a.id,
      // store WITHOUT "@"
      handle: String(a.handle || "").replace(/^@+/, ""),
      timezone: a.timezone || "UTC",
      ig_user_id: a.ig_user_id,
      active: a.active !== false,
    }));
  },
};

export default Account;
