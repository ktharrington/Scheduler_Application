import React from 'react';
export function Badge({ className = '', ...props }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700 ${className}`} {...props} />;
}
export default Badge;
