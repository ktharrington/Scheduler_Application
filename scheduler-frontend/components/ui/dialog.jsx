import React from 'react';

export function Dialog({ open, onOpenChange, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
         onClick={() => onOpenChange?.(false)}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full"
           onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
export const DialogContent = ({ className = '', ...p }) => <div className={`p-4 ${className}`} {...p} />;
export const DialogHeader  = ({ className = '', ...p }) => <div className={`px-4 pt-4 ${className}`} {...p} />;
export const DialogTitle   = ({ className = '', ...p }) => <h3 className={`text-lg font-semibold ${className}`} {...p} />;
export const DialogFooter  = ({ className = '', ...p }) => <div className={`px-4 pb-4 flex justify-end gap-2 ${className}`} {...p} />;
export default Dialog;
