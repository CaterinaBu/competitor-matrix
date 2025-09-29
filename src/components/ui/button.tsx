import React from "react";

type Props = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "secondary" | "outline" | "destructive" | "ghost";
  size?: "sm" | "icon";
};

export function Button({ variant = "default", size, className = "", ...props }: Props) {
  const base =
    "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none";
  const sizes: Record<string, string> = { sm: "h-8 px-3", icon: "h-8 w-8 p-0" };
  const variants: Record<string, string> = {
    default: "bg-black text-white hover:bg-black/90",
    secondary: "bg-gray-100 hover:bg-gray-200",
    outline: "bg-transparent hover:bg-gray-100 border border-gray-300",
    destructive: "bg-red-600 text-white hover:bg-red-500",
    ghost: "bg-transparent hover:bg-gray-100"
  };
  const cls = [base, variants[variant] || variants.default, size && sizes[size], className]
    .filter(Boolean)
    .join(" ");
  return <button className={cls} {...props} />;
}
