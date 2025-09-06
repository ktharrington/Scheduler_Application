import React, { createContext, useContext, useRef, useState, useEffect } from "react";

const Ctx = createContext(null);

export function DropdownMenu({ children, defaultOpen = false, onOpenChange }) {
  const [open, setOpen] = useState(defaultOpen);
  const rootRef = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (open && rootRef.current && !rootRef.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDocClick); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => { onOpenChange?.(open); }, [open, onOpenChange]);

  return (
    <div ref={rootRef} className="relative inline-block text-left">
      <Ctx.Provider value={{ open, setOpen }}>{children}</Ctx.Provider>
    </div>
  );
}

export function DropdownMenuTrigger({ children, asChild, ...props }) {
  const { open, setOpen } = useContext(Ctx);
  const onClick = (e) => { props.onClick?.(e); setOpen(!open); };
  if (asChild && React.isValidElement(children)) return React.cloneElement(children, { onClick });
  return <button type="button" {...props} onClick={onClick}>{children}</button>;
}

export function DropdownMenuContent({ children, align = "end", className = "", ...props }) {
  const { open } = useContext(Ctx);
  if (!open) return null;
  const alignClass = align === "start" ? "left-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "right-0";
  return (
    <div {...props} className={`absolute z-50 mt-2 min-w-[10rem] rounded-md border bg-white shadow-lg focus:outline-none ${alignClass} ${className}`} role="menu">
      <div className="py-1">{children}</div>
    </div>
  );
}

export function DropdownMenuItem({ children, className = "", onSelect, onClick, ...props }) {
  const { setOpen } = useContext(Ctx);
  const handle = (e) => { onClick?.(e); onSelect?.(e); setOpen(false); };
  return (
    <button type="button" role="menuitem" onClick={handle}
      className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-100 focus:bg-gray-100 focus:outline-none ${className}`} {...props}>
      {children}
    </button>
  );
}

export function DropdownMenuLabel({ children, className = "" }) {
  return <div className={`px-3 py-2 text-xs font-semibold text-gray-500 ${className}`}>{children}</div>;
}

export function DropdownMenuSeparator({ className = "" }) {
  return <div className={`my-1 h-px bg-gray-200 ${className}`} />;
}
