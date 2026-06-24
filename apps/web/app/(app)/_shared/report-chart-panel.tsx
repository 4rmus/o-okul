import type { ReactNode } from "react";
import { Panel } from "@o-okul/ui";

interface ReportChartPanelProps {
  title: string;
  description: string;
  children: ReactNode;
}

export function ReportChartPanel({ children, description, title }: ReportChartPanelProps) {
  return (
    <Panel aria-label={title} className="next-chart-panel" description={description} title={title}>
      {children}
    </Panel>
  );
}
