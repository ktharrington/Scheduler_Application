import React from 'react';
export function Textarea({ className = '', ...props }) {
  return <textarea className={`border rounded-md px-3 py-2 w-full ${className}`} {...props} />;
}
export default Textarea;
