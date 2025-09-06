import React from "react";

export function Checkbox({ checked, onCheckedChange, className = "", ...props }) {
  return (
    <input
      type="checkbox"
      className={`h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-2 focus:ring-purple-500 ${className}`}
      checked={!!checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  );
}

export default Checkbox;
