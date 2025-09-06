import React from "react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

export default function MockToggle() {
  const getActive = () => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const mockParam = (urlParams.get("mock") || "").toLowerCase();
      const byParam = mockParam === "1" || mockParam === "true" || mockParam === "all";
      const byLS = localStorage.getItem("mock_batch_api") === "true";
      const byGlobal = typeof window !== "undefined" && window.__MOCK_BATCH_API__ === true;
      return byParam || byLS || byGlobal;
    } catch {
      return false;
    }
  };

  const [active, setActive] = React.useState(getActive());

  // Centralized setter: updates both old + new flags and notifies listeners
  function setMock(on) {
    try {
      // old flag (kept for your mock batch API override)
      if (on) localStorage.setItem("mock_batch_api", "true");
      else localStorage.removeItem("mock_batch_api");

      // new flag (used by useAccounts/useRangedPosts hooks)
      localStorage.setItem("use_mock", on ? "1" : "0");

      // tell hooks to re-fetch immediately (no double-toggle needed)
      window.dispatchEvent(new Event("mock:changed"));
    } catch {
      /* ignore */
    }
  }

  const toggle = (checked) => {
    setActive(checked);
    setMock(checked);

    // If your mock batch API relies on remounting a fetch override,
    // keep the reload. If not needed, you can comment this out.
    window.location.reload();
  };

  return (
    <div className="fixed bottom-4 right-4 z-50">
      <div className="px-3 py-2 rounded-lg shadow-lg bg-white/90 border flex items-center gap-3">
        <Badge variant={active ? "secondary" : "outline"} className={active ? "bg-purple-100 text-purple-700" : ""}>
          Mock {active ? "ON" : "OFF"}
        </Badge>
        <Switch checked={active} onCheckedChange={toggle} />
      </div>
    </div>
  );
}
