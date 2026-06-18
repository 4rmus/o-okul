import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface TooltipProps extends HTMLAttributes<HTMLSpanElement> {
  label: ReactNode;
}

export function Tooltip({ children, className, label, ...props }: TooltipProps) {
  return (
    <span {...props} className={classNames("uh-tooltip", className)}>
      {children}
      <span className="uh-tooltip__content" role="tooltip">
        {label}
      </span>
    </span>
  );
}
