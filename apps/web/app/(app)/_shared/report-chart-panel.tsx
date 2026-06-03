import type { ReactNode } from "react";

interface ReportChartPanelProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function ReportChartPanel({ children, description, title }: ReportChartPanelProps) {
  return (
    <section className="next-chart-panel" aria-label={title}>
      <div className="next-chart-panel__header">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="next-chart-panel__body">{children}</div>
    </section>
  );
}
