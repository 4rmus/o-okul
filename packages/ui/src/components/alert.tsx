import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  tone?: "info" | "success" | "warning" | "danger";
}

export function Alert({ children, className, title, tone = "info", ...props }: AlertProps) {
  return (
    <div {...props} className={classNames("uh-alert", `uh-alert--${tone}`, className)} role={tone === "danger" ? "alert" : "status"}>
      {title ? <strong>{title}</strong> : null}
      {children ? <div>{children}</div> : null}
    </div>
  );
}
