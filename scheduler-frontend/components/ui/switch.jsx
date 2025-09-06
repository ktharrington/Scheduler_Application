import React from 'react';
export function Switch({ checked, onCheckedChange, className = '', ...props }) {
  return (
    <input
      type="checkbox"
      className={className}
      checked={!!checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      {...props}
    />
  );
}
export default Switch;
