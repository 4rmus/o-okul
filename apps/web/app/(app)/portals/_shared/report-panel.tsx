"use client";

import { useState } from "react";
import type {
  ReportErrorBooklet,
  ReportStudentProgress,
  ReportStudentSnapshot,
} from "@o-okul/shared-types";
import { Alert, Button, DataTable, MetricCard, MetricGrid, Panel, StatusBadge, type DataTableColumn } from "@o-okul/ui";
import { formatCourseName } from "../../_shared/academic-labels.js";
import { KarneSheet } from "../../_shared/karne-sheet.js";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";

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
  const [isKarneDetailOpen, setIsKarneDetailOpen] = useState(false);
  const reportContext = formatReportContext(context, courseNames, termNames);
  const branchColumns: Array<DataTableColumn<ReportStudentSnapshot["branches"][number]>> = [
    {
      key: "branch",
      header: "Ders",
      priority: "primary",
      render: (branch) => formatCourseName(branch.branch),
      sticky: "left",
    },
    {
      align: "right",
      key: "successRate",
      header: "Başarı %",
      priority: "primary",
      render: (branch) => formatPercentNumber(reportSuccessRate(branch)),
    },
    {
      align: "right",
      key: "net",
      header: "Net",
      priority: "secondary",
      render: (branch) => formatNetNumber(branch.net),
    },
    {
      align: "right",
      key: "questionCount",
      header: "Soru",
      priority: "secondary",
      render: (branch) => formatNumber(reportQuestionCount(branch)),
    },
  ];

  if (!report) {
    return (
      <Panel
        aria-label="Portal rapor özeti"
        className="next-portal-report-summary next-portal-progress-panel"
        title="Sınav Raporu"
        description={reportContext === "-" ? "Son sınav raporu bekleniyor." : reportContext}
        tone="warning"
      >
        <Alert tone="warning" title="Rapor bekleniyor">
          Bu çalışma alanı için hazır rapor bulunamadı. Rapor hazırlandığında başarı, net ve soru bilgileri burada görünür.
        </Alert>
      </Panel>
    );
  }

  const totalSuccessRate = reportSuccessRate(report.total);
  const totalQuestionCount = reportQuestionCount(report.total);
  const scoreView = preferredScoreView(report);
  const isModernReport = Boolean(report.scoringProfileId || report.scoreViews?.length);
  const score = scoreView?.practiceScore ?? (isModernReport ? undefined : report.total.estimatedRawScore ?? report.total.standardScore ?? report.total.rawScore);

  return (
    <>
      <Panel
        aria-label="Portal rapor özeti"
        className="next-portal-report-summary next-portal-progress-panel"
        title="Sınav Raporu"
        description={buildReportSummary(report, reportContext)}
        actions={
          <>
            <StatusBadge tone="success">Rapor hazır</StatusBadge>
            <Button
              aria-controls={isKarneDetailOpen ? "portal-karne-detail" : undefined}
              aria-expanded={isKarneDetailOpen}
              type="button"
              variant="secondary"
              onClick={() => setIsKarneDetailOpen((current) => !current)}
            >
              {isKarneDetailOpen ? "Karne detayını gizle" : "Karne detayını göster"}
            </Button>
          </>
        }
      >
        <MetricGrid aria-label="Portal rapor metrikleri" role="region">
          <MetricCard className="next-student-growth-primary-metric" label="Başarı %" value={formatPercentNumber(totalSuccessRate)} description="Ana karşılaştırma metriği" tone={successTone(totalSuccessRate)} />
          <MetricCard label="Net" value={formatNetNumber(report.total.net)} description="Soru sayısıyla birlikte okunur" />
          <MetricCard label="Soru" value={formatNumber(totalQuestionCount)} description="Sınav kapsamı" />
          <MetricCard label={scoreView ? scoreViewLabel(scoreView) : isModernReport ? "Puan hesaplanamadı" : "Eski hesaplama"} value={formatNumber(score)} description={formatGeneratedAt(report.generatedAt)} tone="info" />
        </MetricGrid>
        {isModernReport ? (
          <Alert tone="warning" title="Deneme puanı uyarısı">
            Standart sapma kullanılmadan hesaplanan deneme puanıdır. Resmî MEB/ÖSYM sınav puanı değildir.
          </Alert>
        ) : null}
        <DataTable
          caption="Portal branş başarıları"
          columns={branchColumns}
          density="compact"
          description="Soru sayıları farklı raporlar Başarı % ile karşılaştırılır; Net ve Soru sonucu açıklar."
          emptyText="Branş kırılımı yok"
          getRowKey={(branch) => branch.branch}
          rows={report.branches}
        />
      </Panel>
      {isKarneDetailOpen ? (
        <div className="next-portal-karne-detail" id="portal-karne-detail">
          <KarneSheet
            ariaLabel="Sınav raporu"
            branchCaption="Branş psikometri tablosu"
            emptyClassName="next-portal-karne-empty"
            emptyTitle="Sınav Raporu"
            emptyTitleLevel="h2"
            errorBooklet={errorBooklet}
            outcomeAriaLabel="Portal kazanım radar grafiği"
            outcomeCaption="Portal kazanım radar tablosu"
            outcomeHeadingLevel="h4"
            outcomeSectionClassName="next-karne-block"
            outputStatusLabel="Rapor hazır"
            progress={progress}
            report={report}
            reportLabel="Sınav Raporu"
            scoreType={scoreView?.type}
            sheetClassName="next-portal-karne-sheet next-karne-sheet next-karne-sheet--portal"
            showProgressHistory
            summaryExtra={reportContext}
            titleLevel="h2"
          />
        </div>
      ) : null}
    </>
  );
}

function formatReportContext(
  context: ReportPanelContext | undefined,
  courseNames: ReadonlyMap<string, string> | undefined,
  termNames: ReadonlyMap<string, string> | undefined,
) {
  if (!context) return "-";

  const parts = [
    context.courseId ? courseNames?.get(context.courseId) ?? "Ders bilgisi yok" : "",
    context.termId ? termNames?.get(context.termId) ?? "Dönem bilgisi yok" : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function buildReportSummary(report: ReportStudentSnapshot, reportContext: string) {
  const examTitle = report.examTitle || "Son sınav";
  const generatedAt = formatGeneratedAt(report.generatedAt);
  const context = reportContext === "-" ? "" : `${reportContext} / `;
  return `${context}${examTitle}${generatedAt === "-" ? "" : ` / ${generatedAt}`}`;
}

function formatGeneratedAt(value: string | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("tr-TR");
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
}

function formatNetNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

function successTone(value: number | undefined) {
  if (value === undefined) return "default";
  if (value >= 75) return "success";
  if (value >= 50) return "info";
  return "warning";
}

function scoreViewLabel(view: NonNullable<ReportStudentSnapshot["scoreViews"]>[number]) {
  if (view.status === "MISSING_TYT") return "Bağlı TYT deneme puanı yok";
  if (view.status === "NOT_ELIGIBLE") return `${view.type} hesaplanamadı`;
  return `${view.type} deneme puanı`;
}

function preferredScoreView(report: ReportStudentSnapshot) {
  return report.scoreViews?.find((view) => view.status === "CALCULATED") ?? report.scoreViews?.[0];
}
