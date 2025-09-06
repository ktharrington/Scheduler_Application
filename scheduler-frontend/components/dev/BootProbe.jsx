import React from "react";

export default function BootProbe({ tag }) {
  React.useEffect(() => {
    console.log(`[BootProbe] mounted: ${tag}`);
    window.addEventListener("error", (e)=>console.error("[window.onerror]", e.message, e.error));
    window.addEventListener("unhandledrejection", (e)=>console.error("[unhandledrejection]", e.reason));
  }, [tag]);
  return null;
}
