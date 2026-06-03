import type { ReactNode } from "react";

interface MetricPanel {
  label: string;
  value: ReactNode;
}

interface MetricPanelGridProps {
  ariaLabel: string;
  metrics: readonly MetricPanel[];
}

export function MetricPanelGrid({ ariaLabel, metrics }: MetricPanelGridProps) {
  return (
    <section className="next-dashboard-grid" aria-label={ariaLabel}>
      {metrics.map((metric) => (
        <article className="next-metric" key={metric.label}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
        </article>
      ))}
    </section>
  );
}
