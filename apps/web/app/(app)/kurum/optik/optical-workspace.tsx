"use client";

import { useSelectedLayoutSegment } from "next/navigation";
import { opticalTabFromSegment } from "../sinavlar/exam-workspace-routes.js";
import { ParserConfigPage } from "./parser-config-page.js";

export function OpticalWorkspace({ examId }: { examId: string }) {
  const segment = useSelectedLayoutSegment();
  return <ParserConfigPage routeExamId={examId} routeTab={opticalTabFromSegment(segment)} />;
}
