import type { InputHTMLAttributes } from "react";
import { classNames } from "../class-names.js";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ className, invalid = false, ...props }: InputProps) {
  return (
    <input
      {...props}
      aria-invalid={invalid || props["aria-invalid"] || undefined}
      className={classNames("uh-input", invalid && "uh-input--invalid", className)}
    />
  );
}
