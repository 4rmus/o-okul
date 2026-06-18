import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
  children: ReactNode;
}

export function StatusBadge({ children, className, tone = "neutral", ...props }: StatusBadgeProps) {
  return (
    <span {...props} className={classNames("uh-status-badge", `uh-status-badge--${tone}`, className)}>
      {children}
    </span>
  );
}
