// src/components/ui/sheet.jsx
import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";

export const Sheet = Dialog.Root;
export const SheetTrigger = Dialog.Trigger;
export const SheetClose = Dialog.Close;

const SheetPortal = Dialog.Portal;

const SheetOverlay = React.forwardRef(function SheetOverlay(
  { className = "", ...props },
  ref
) {
  return (
    <Dialog.Overlay
      ref={ref}
      className={`fixed inset-0 bg-black/30 ${className}`}
      {...props}
    />
  );
});

export const SheetContent = React.forwardRef(function SheetContent(
  { side = "left", className = "", children, ...props },
  ref
) {
  const sideClasses =
    side === "left"
      ? "inset-y-0 left-0 w-72"
      : side === "right"
      ? "inset-y-0 right-0 w-72"
      : side === "top"
      ? "inset-x-0 top-0 h-72"
      : "inset-x-0 bottom-0 h-72";

  return (
    <SheetPortal>
      <SheetOverlay />
      <Dialog.Content
        ref={ref}
        className={`fixed z-50 bg-white shadow-2xl outline-none ${sideClasses} ${className}`}
        {...props}
      >
        {children}
      </Dialog.Content>
    </SheetPortal>
  );
});

export const SheetHeader = ({ className = "", ...props }) => (
  <div className={`px-4 py-2 ${className}`} {...props} />
);

export const SheetTitle = Dialog.Title;
export const SheetDescription = Dialog.Description;
