import type { ReactNode } from "react";
import { Panel } from "@o-okul/ui";

interface ReportChartPanelProps {
  className?: string;
  title: string;
  description: string;
  children: ReactNode;
}

export function ReportChartPanel({ children, className, description, title }: ReportChartPanelProps) {
  return (
    <Panel
      aria-label={title}
      className={["next-chart-panel", className].filter(Boolean).join(" ")}
      description={description}
      title={title}
    >
      {children}
    </Panel>
  );
}
