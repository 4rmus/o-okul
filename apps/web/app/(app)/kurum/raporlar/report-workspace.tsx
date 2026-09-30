"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { reportTabFromSegment } from "../sinavlar/exam-workspace-routes.js";
import { ReportsPage } from "./reports-page.js";

export function ReportWorkspace({ examId }: { examId: string }) {
  const segment = useSelectedLayoutSegment();
  return <ReportsPage routeExamId={examId} routeTab={reportTabFromSegment(segment)} />;
}
