import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface InfoGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function InfoGrid({ children, className, ...props }: InfoGridProps) {
  return (
    <div {...props} className={classNames("uh-info-grid", className)}>
      {children}
    </div>
  );
}

export interface InfoItemProps extends HTMLAttributes<HTMLDivElement> {
  description?: ReactNode;
  label: ReactNode;
  value: ReactNode;
}

export function InfoItem({ className, description, label, value, ...props }: InfoItemProps) {
  return (
    <div {...props} className={classNames("uh-info-item", className)}>
      <span className="uh-info-item__label">{label}</span>
      <strong className="uh-info-item__value">{value}</strong>
      {description ? <small className="uh-info-item__description">{description}</small> : null}
    </div>
  );
}
