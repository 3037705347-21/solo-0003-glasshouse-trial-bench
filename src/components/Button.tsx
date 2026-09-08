import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  tone?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
}

const toneClass: Record<NonNullable<ButtonProps["tone"]>, string> = {
  primary: "button-primary",
  secondary: "button-secondary",
  danger: "button-danger",
  ghost: "button-ghost",
};

const sizeClass: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "button-sm",
  md: "button-md",
  lg: "button-lg",
};

export function Button({
  children,
  tone = "primary",
  size = "md",
  className = "",
  type = "button",
  ...props
}: ButtonProps) {
  const classes = [
    "button",
    toneClass[tone],
    sizeClass[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
