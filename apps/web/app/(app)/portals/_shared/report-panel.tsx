"use client";

import type {
  ReportErrorBooklet,
  ReportStudentProgress,
  ReportStudentSnapshot,
} from "@uzman-hocam/shared-types";
import { KarneSheet } from "../../_shared/karne-sheet.js";

interface ReportPanelContext {
  courseId?: string;
  termId?: string;
}

interface ReportPanelProps {
  context?: ReportPanelContext;
  courseNames?: ReadonlyMap<string, string>;
  errorBooklet: ReportErrorBooklet | null;
  progress: ReportStudentProgress | null;
  report: ReportStudentSnapshot | null;
  termNames?: ReadonlyMap<string, string>;
}

export function ReportPanel({
  context,
  courseNames,
  errorBooklet,
  progress,
  report,
  termNames,
}: ReportPanelProps) {
  return (
    <KarneSheet
      ariaLabel="Sınav raporu"
      branchCaption="Branş psikometri tablosu"
      emptyClassName="next-list-panel"
      emptyTitle="Sınav Raporu"
      emptyTitleLevel="h2"
      errorBooklet={errorBooklet}
      outcomeAriaLabel="Portal kazanım radar grafiği"
      outcomeCaption="Portal kazanım radar tablosu"
      outcomeHeadingLevel="h4"
      outcomeSectionClassName="next-karne-block"
      progress={progress}
      rankFormat="percentile"
      report={report}
      reportLabel="Sınav Raporu"
      scoreGeneralLabel="GENEL"
      sheetClassName="next-list-panel next-karne-sheet next-karne-sheet--portal"
      showProgressHistory
      summaryExtra={formatReportContext(context, courseNames, termNames)}
      titleLevel="h2"
    />
  );
}

function formatReportContext(
  context: ReportPanelContext | undefined,
  courseNames: ReadonlyMap<string, string> | undefined,
  termNames: ReadonlyMap<string, string> | undefined,
) {
  if (!context) return "-";

  const parts = [
    context.courseId ? courseNames?.get(context.courseId) ?? context.courseId : "",
    context.termId ? termNames?.get(context.termId) ?? context.termId : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}
