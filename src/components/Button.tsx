import type {
  ButtonHTMLAttributes,
  ReactElement,
  ReactNode,
} from "react";
import { cloneElement, isValidElement } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  tone?: "primary" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  /** 把样式类合并到子元素上（通常是 react-router 的 Link），而不渲染按钮。 */
  asChild?: boolean;
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

export function buttonClassName(
  tone: NonNullable<ButtonProps["tone"]>,
  size: NonNullable<ButtonProps["size"]>,
  className = "",
): string {
  return [
    "button",
    toneClass[tone],
    sizeClass[size],
    className,
  ]
    .filter(Boolean)
    .join(" ");
}

export function Button({
  children,
  tone = "primary",
  size = "md",
  className = "",
  type = "button",
  asChild = false,
  ...props
}: ButtonProps) {
  const classes = buttonClassName(tone, size, className);
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<{ className?: string }>;
    return cloneElement(child, {
      className: [classes, child.props.className].filter(Boolean).join(" "),
    });
  }
  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
