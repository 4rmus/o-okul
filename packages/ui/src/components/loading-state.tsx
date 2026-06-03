import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface LoadingStateProps extends HTMLAttributes<HTMLDivElement> {
  label?: ReactNode;
}

export function LoadingState({ className, label = "Yükleniyor…", ...props }: LoadingStateProps) {
  return (
    <div {...props} className={classNames("uh-loading-state", className)} role="status">
      <span aria-hidden className="uh-spinner" />
      <span className="uh-loading-state__label">{label}</span>
    </div>
  );
}
