import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface MetricCardProps extends HTMLAttributes<HTMLElement> {
  description?: ReactNode;
  label: ReactNode;
  span?: "default" | "wide";
  tone?: "default" | "success" | "warning" | "danger" | "info";
  value: ReactNode;
}

export function MetricCard({
  className,
  description,
  label,
  span = "default",
  tone = "default",
  value,
  ...props
}: MetricCardProps) {
  return (
    <article {...props} className={classNames("uh-metric-card", `uh-metric-card--${tone}`, span === "wide" && "uh-metric-card--wide", className)}>
      <span className="uh-metric-card__label">{label}</span>
      <strong className="uh-metric-card__value">{value}</strong>
      {description ? <small className="uh-metric-card__description">{description}</small> : null}
    </article>
  );
}

export interface MetricGridProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
}

export function MetricGrid({ children, className, ...props }: MetricGridProps) {
  return (
    <div {...props} className={classNames("uh-metric-grid", className)}>
      {children}
    </div>
  );
}
