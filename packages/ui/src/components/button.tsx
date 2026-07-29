import type { ButtonHTMLAttributes } from "react";
import { classNames } from "../class-names.js";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";
export type ButtonSize = "sm" | "md" | "lg" | "icon";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  loading?: boolean;
  loadingLabel?: string;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export function Button({
  children,
  className,
  disabled,
  loading = false,
  loadingLabel = "İşleniyor",
  size = "md",
  type = "button",
  variant = "primary",
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      aria-label={loading ? loadingLabel : props["aria-label"]}
      className={classNames("uh-button", `uh-button--${variant}`, `uh-button--${size}`, className)}
      data-state={loading ? "loading" : undefined}
      disabled={disabled || loading}
      type={type}
    >
      <span className="uh-button__content" aria-hidden={loading || undefined}>
        {children}
      </span>
      {loading ? (
        <span className="uh-button__loading" role="status">
          <span className="uh-button__spinner" aria-hidden="true" />
          <span>{loadingLabel}</span>
        </span>
      ) : null}
    </button>
  );
}
