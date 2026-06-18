import type { HTMLAttributes, ReactNode } from "react";
import { classNames } from "../class-names.js";

export interface MetricCardProps extends HTMLAttributes<HTMLElement> {
  description?: ReactNode;
  label: ReactNode;
  tone?: "default" | "success" | "warning" | "danger" | "info";
  value: ReactNode;
}

export function MetricCard({
  className,
  description,
  label,
  tone = "default",
  value,
  ...props
}: MetricCardProps) {
  return (
    <article {...props} className={classNames("uh-metric-card", `uh-metric-card--${tone}`, className)}>
      <span className="uh-metric-card__label">{label}</span>
      <strong className="uh-metric-card__value">{value}</strong>
      {description ? <small className="uh-metric-card__description">{description}</small> : null}
    </article>
  );
}
