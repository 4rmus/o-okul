import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  tone?: ToastTone;
  title?: ReactNode;
}

export function Toast({ children, className, title, tone = "info", ...props }: ToastProps) {
  return (
    <div {...props} className={classNames("uh-toast", `uh-toast--${tone}`, className)} role={props.role ?? "status"}>
      {title ? <strong className="uh-toast__title">{title}</strong> : null}
      {children ? <div className="uh-toast__body">{children}</div> : null}
    </div>
  );
}
