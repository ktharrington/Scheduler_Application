import React from 'react';

export function Card({ className = '', ...props }) {
  const base = 'rounded-xl border bg-white shadow-sm';
  return <div className={`${base} ${className}`} {...props} />;
}

export function CardHeader({ className = '', ...props }) {
  const base = 'p-4 border-b';
  return <div className={`${base} ${className}`} {...props} />;
}

export function CardTitle({ className = '', ...props }) {
  const base = 'text-lg font-semibold';
  return <div className={`${base} ${className}`} {...props} />;
}

export function CardContent({ className = '', ...props }) {
  const base = 'p-4';
  return <div className={`${base} ${className}`} {...props} />;
}

// Keep default export for convenience if any code does `import Card from ...`
export default Card;
