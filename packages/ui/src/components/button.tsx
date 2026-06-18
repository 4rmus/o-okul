import type { ButtonHTMLAttributes } from "react";
import { classNames } from "../class-names.js";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({ className, size = "md", type = "button", variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      {...props}
      className={classNames("uh-button", `uh-button--${variant}`, `uh-button--${size}`, className)}
      type={type}
    />
  );
}
