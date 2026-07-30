import type { InputHTMLAttributes } from "react";
import { classNames } from "../class-names.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  loading?: boolean;
}

export function Input({ className, invalid = false, loading = false, ...props }: InputProps) {
  return (
    <input
      {...props}
      aria-busy={loading || props["aria-busy"] || undefined}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={classNames("uh-input", invalid && "uh-input--invalid", className)}
      disabled={props.disabled || loading}
    />
  );
}
