import React from "react";

export function Button({ className = "", variant = "default", size = "md", disabled, ...props }) {
  const base =
    "inline-flex items-center justify-center rounded-md font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";

  const sizes = {
    sm: "h-8 px-3 text-sm",
    md: "h-9 px-4 text-sm",
    lg: "h-10 px-5",
  };

  const variants = {
    default: "bg-gray-900 text-white hover:bg-black/90",
    outline: "border border-gray-300 text-gray-900 hover:bg-gray-50",
    secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200",
    ghost: "bg-transparent hover:bg-gray-100",
    destructive: "bg-red-500 text-white hover:bg-red-600",
    // 🔮 purple gradient primary
    primary:
      "bg-gradient-to-r from-purple-500 to-pink-500 text-white hover:from-purple-600 hover:to-pink-600",
  };

  return (
    <button
      className={`${base} ${sizes[size] ?? sizes.md} ${variants[variant] ?? variants.default} ${className}`}
      disabled={disabled}
      {...props}
    />
  );
}

export default Button;
