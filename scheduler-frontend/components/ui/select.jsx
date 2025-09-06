import React, { createContext, useContext } from 'react';

const Ctx = createContext({ value: '', onValueChange: undefined });

function collectItems(nodes, out = []) {
  React.Children.forEach(nodes, (child) => {
    if (!child) return;
    if (child.type && child.type.displayName === 'SelectItem') {
      out.push({ value: child.props.value, label: child.props.children });
    } else if (child.props && child.props.children) {
      collectItems(child.props.children, out);
    }
  });
  return out;
}

export function Select({ value, defaultValue, onValueChange, children, className = '' }) {
  const items = collectItems(children, []);
  const curr = value ?? defaultValue ?? '';
  return (
    <Ctx.Provider value={{ value: curr, onValueChange }}>
      <select
        className={`border rounded-md px-3 py-2 ${className}`}
        value={curr}
        onChange={(e) => onValueChange?.(e.target.value)}
      >
        {items.map((it) => (
          <option key={it.value} value={it.value}>{it.label}</option>
        ))}
      </select>
    </Ctx.Provider>
  );
}
export function SelectTrigger({ children }) { return <>{children}</>; }
export function SelectValue() { const _ = useContext(Ctx); return null; }
export function SelectContent({ children }) { return <>{children}</>; }

export function SelectItem({ value, children, ...props }) {
  return <option value={value} {...props}>{children}</option>;
}
SelectItem.displayName = 'SelectItem';

export default Select;
