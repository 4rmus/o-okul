"use client";

import { DataTable, Panel, type DataTableColumn } from "@o-okul/ui";
import type { GuardianExamSeriesPoint, GuardianSchoolGradeItem } from "@o-okul/shared-types";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";

/**
 * KV-4: optical exam Başarı % (0-100) and published school grades (each assessment's own scale) are two
 * separate series. They are never merged into one line because the scales differ.
 */
export function ProgressSeriesPanel({
  examSeries,
  schoolGrades,
  unavailable = false,
}: {
  examSeries: GuardianExamSeriesPoint[];
  schoolGrades: GuardianSchoolGradeItem[];
  unavailable?: boolean;
}) {
  const examColumns: Array<DataTableColumn<GuardianExamSeriesPoint>> = [
    { header: "Tarih", key: "date", priority: "primary", render: (point) => formatDate(point.generatedAt), sticky: "left" },
    { align: "right", header: "Başarı % (0-100)", key: "success", priority: "primary", render: (point) => formatPercentNumber(reportSuccessRate(point)) },
    { align: "right", header: "Net / Soru", key: "net", priority: "secondary", render: (point) => `${formatNumber(point.net)} / ${formatNumber(reportQuestionCount(point))}` },
  ];
  const gradeColumns: Array<DataTableColumn<GuardianSchoolGradeItem>> = [
    { header: "Tarih", key: "date", priority: "primary", render: (grade) => formatDate(grade.heldOn), sticky: "left" },
    { header: "Ders", key: "course", priority: "primary", render: (grade) => grade.courseName ?? "-" },
    { header: "Sınav", key: "title", priority: "secondary", render: (grade) => grade.title },
    { align: "right", header: "Not (puan / tam puan)", key: "score", priority: "primary", render: (grade) => formatGrade(grade) },
  ];

  return (
    <Panel
      aria-label="Deneme ve okul notu serileri"
      className="next-portal-progress-series-panel"
      description="Deneme sınavları Başarı % ile, okul notları sınavın kendi tam puanıyla gösterilir; iki seri ölçekleri farklı olduğu için birleştirilmez."
      title="Deneme ve Okul Notları"
    >
      {unavailable ? <p className="next-status-note">Özet şu an alınamadı; seriler daha sonra görünecek.</p> : null}
      <DataTable
        caption="Deneme sınavları: Başarı %"
        columns={examColumns}
        description="Ölçek 0-100 Başarı %. Net ve soru sayısı bağlam olarak verilir."
        density="compact"
        emptyText="Henüz hazır deneme raporu yok."
        getRowKey={(point) => point.snapshotId}
        rows={examSeries}
      />
      <DataTable
        caption="Okul notları: puan / tam puan"
        columns={gradeColumns}
        description="Ölçek her sınavın kendi tam puanıdır. Yalnız yayınlanmış geçerli sürüm gösterilir."
        density="compact"
        emptyText="Henüz yayınlanmış okul notu yok."
        getRowKey={(grade) => grade.assessmentId}
        rows={schoolGrades}
      />
    </Panel>
  );
}

function formatGrade(grade: GuardianSchoolGradeItem) {
  if (grade.absent || grade.score === null) return "Girmedi";
  return `${formatNumber(grade.score)} / ${formatNumber(grade.maxScore)}`;
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function formatDate(value: string | undefined) {
  if (!value) return "-";
  // heldOn is a calendar date; parse at noon UTC so no timezone shifts it a day.
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value);
  return Number.isNaN(date.getTime()) ? "-" : new Intl.DateTimeFormat("tr-TR", { dateStyle: "short" }).format(date);
}
