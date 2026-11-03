"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Alert, DataTable, EmptyState, Field, Panel, Select, type DataTableColumn } from "@o-okul/ui";
import type {
  AcademicTermRecord,
  GradeLevelAnalytics,
  GradeLevelAnalyticsExamRef,
  GradeLevelAnalyticsPoint,
  GradeLevelAnalyticsSeries,
  GradeLevelRecord,
} from "@o-okul/shared-types";
import { useAuth } from "../../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest, withQueryParams } from "../../../../../src/api-client.js";
import { PageFrame } from "../../_shared/page-frame.js";
import { formatDate } from "../../../_shared/format.js";
import { ProgressLineChart } from "../../../_shared/lazy-report-charts.js";
import { formatNetNumber } from "../../../_shared/outcome-net-table.js";
import { formatPercentNumber } from "../../../_shared/report-metrics.js";
import { reportWorkspaceHref } from "../../sinavlar/exam-workspace-routes.js";

// DEC-20261102-08 (G3): seviye raporu üretilmiş, yayınlanmış sınavlarda seviyenin Başarı % gidişi. Sınav türü başına
// bir çizgi; Net ve Soru bağlamdır. Sınıf, kampüs veya ders raporları seviye rakamı olarak gösterilmez.
const examTypeOptions = [
  { value: "SCHOOL", label: "Okul sınavı" },
  { value: "LGS", label: "LGS" },
  { value: "TYT", label: "TYT" },
  { value: "AYT", label: "AYT" },
  { value: "KPSS", label: "KPSS" },
] as const;

interface LevelAnalyticsFilters {
  examType: string;
  gradeLevelId: string;
  termId: string;
}

const emptyFilters: LevelAnalyticsFilters = { examType: "", gradeLevelId: "", termId: "" };

export function LevelAnalyticsPage() {
  const { auth } = useAuth();
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const [filters, setFilters] = useState<LevelAnalyticsFilters>(emptyFilters);
  const referencesQuery = useQuery({
    queryKey: ["next-level-analytics-refs", tenantId],
    queryFn: ({ signal }) => loadReferences(auth?.accessToken ?? "", signal),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const analyticsQuery = useQuery({
    queryKey: ["next-level-analytics", tenantId, filters],
    queryFn: ({ signal }) => loadLevelAnalytics(auth?.accessToken ?? "", filters, signal),
    enabled: Boolean(auth && filters.gradeLevelId),
    refetchOnWindowFocus: false,
  });
  const gradeLevels = referencesQuery.data?.gradeLevels ?? [];
  const terms = referencesQuery.data?.terms ?? [];
  const selectedLevel = gradeLevels.find((level) => level.id === filters.gradeLevelId);
  const analytics = analyticsQuery.data;
  const isBusy = referencesQuery.isLoading || (Boolean(filters.gradeLevelId) && analyticsQuery.isLoading);

  return (
    <PageFrame
      title="Seviye Analitiği"
      subtitle="Seviye raporu hazırlanmış yayınlanmış sınavlarda seviyenin Başarı % gidişini sınav türüne göre izleyin."
    >
      <section className="next-report-workspace" aria-label="Seviye analitiği" aria-busy={isBusy}>
        <Panel
          title="Seviye ve sınav türü"
          description="Sınavlar arası karşılaştırma Başarı % ile yapılır; Net ve Soru sayısı bağlam olarak gösterilir."
        >
          <div className="next-list-controls" aria-label="Seviye analitiği filtreleri">
            <Field label="Seviye">
              <Select
                required
                value={filters.gradeLevelId}
                onChange={(event) => setFilters((current) => ({ ...current, gradeLevelId: event.target.value }))}
              >
                <option value="">Seviye seçin</option>
                {gradeLevels.map((level) => (
                  <option key={level.id} value={level.id}>{level.name}</option>
                ))}
              </Select>
            </Field>
            <Field label="Sınav türü">
              <Select
                value={filters.examType}
                onChange={(event) => setFilters((current) => ({ ...current, examType: event.target.value }))}
              >
                <option value="">Tüm türler</option>
                {examTypeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </Field>
            <Field label="Dönem">
              <Select
                value={filters.termId}
                onChange={(event) => setFilters((current) => ({ ...current, termId: event.target.value }))}
              >
                <option value="">Tüm dönemler</option>
                {terms.map((term) => (
                  <option key={term.id} value={term.id}>{term.name}</option>
                ))}
              </Select>
            </Field>
          </div>
        </Panel>

        {referencesQuery.error ? (
          <Alert tone="danger">{apiErrorMessage(referencesQuery.error, "Seviye ve dönem listesi yüklenemedi.")}</Alert>
        ) : null}
        {analyticsQuery.error ? (
          <Alert tone="danger">{apiErrorMessage(analyticsQuery.error, "Seviye analitiği yüklenemedi.")}</Alert>
        ) : null}

        {!filters.gradeLevelId ? (
          <EmptyState
            title="Seviye seçin"
            description="Seçtiğiniz seviyenin seviye raporlarından sınav türü başına Başarı % çizgisi oluşur."
          />
        ) : analytics ? (
          <LevelAnalyticsResult analytics={analytics} levelName={selectedLevel?.name ?? "Seçilen seviye"} />
        ) : null}
      </section>
    </PageFrame>
  );
}

function LevelAnalyticsResult({ analytics, levelName }: { analytics: GradeLevelAnalytics; levelName: string }) {
  // Sonuçsuz READY seviye raporu ayrı listelenir; alanı taşımayan eski API yanıtında liste boş sayılır.
  const noParticipants = analytics.noParticipants ?? [];
  return (
    <>
      {analytics.series.length === 0 ? (
        <EmptyState
          title="Çizilecek seviye raporu yok"
          description={`${levelName} için seviye raporu hazır olan yayınlanmış sınav bulunmuyor. Rapor ekranında yalnız seviyeyi seçerek seviye raporu hazırlayabilirsiniz.`}
        />
      ) : (
        analytics.series.map((series) => (
          <LevelSeriesPanel key={series.examType ?? "untyped"} levelName={levelName} series={series} />
        ))
      )}
      {analytics.needsRefresh.length > 0 ? (
        <Panel
          aria-label="Yenilenmesi gereken seviye raporları"
          title="Yenilenmesi gereken seviye raporları"
          description="Bu sınavlarda sonuçlar seviye raporundan sonra değişti; rapor yenilenene kadar grafikte gösterilmez."
          tone="warning"
        >
          <ExamLinkList exams={analytics.needsRefresh} />
        </Panel>
      ) : null}
      {noParticipants.length > 0 ? (
        <Panel
          aria-label="Katılımcısı olmayan seviye raporları"
          title="Katılımcısı olmayan seviye raporları"
          description="Bu seviye raporlarında sonuç bulunmuyor; %0 başarı gibi görünmemesi için grafikte gösterilmez. Sonuçları yükledikten sonra raporu yenileyin."
          tone="muted"
        >
          <ExamLinkList exams={noParticipants} />
        </Panel>
      ) : null}
      {analytics.withoutLevelReport.length > 0 ? (
        <Panel
          aria-label="Bu seviye için seviye raporu üretilmemiş sınavlar"
          title="Bu seviye için seviye raporu üretilmemiş sınavlar"
          description="Sınıf, kampüs veya ders raporları seviye rakamı olarak kullanılmaz. Rapor ekranında yalnız seviyeyi seçerek seviye raporu hazırlayın."
          tone="muted"
        >
          <ExamLinkList exams={analytics.withoutLevelReport} />
        </Panel>
      ) : null}
    </>
  );
}

function LevelSeriesPanel({ levelName, series }: { levelName: string; series: GradeLevelAnalyticsSeries }) {
  const typeLabel = examTypeLabel(series.examType);
  // Grafik yalnız seviye raporunda saklanan Başarı %'yi çizer; saklanmamışsa nokta tabloda kalır.
  const chartPoints = series.points
    .filter((point) => point.successRate !== undefined)
    .map((point) => ({
      snapshotId: point.snapshotId,
      examTitle: point.examTitle,
      generatedAt: point.startsAt ?? point.generatedAt,
      total: { net: point.net, questionCount: point.questionCount, successRate: point.successRate },
    }));
  const columns: Array<DataTableColumn<GradeLevelAnalyticsPoint>> = [
    { key: "exam", header: "Sınav", priority: "primary", render: (point) => point.examTitle },
    { key: "date", header: "Tarih", render: (point) => formatDate(point.startsAt ?? point.generatedAt) },
    { key: "participants", header: "Katılımcı", align: "right", render: (point) => point.participantCount.toLocaleString("tr-TR") },
    { key: "success", header: "Başarı %", align: "right", priority: "primary", render: (point) => formatPercentNumber(point.successRate) },
    { key: "net", header: "Net", align: "right", render: (point) => formatNetNumber(point.net) },
    { key: "questions", header: "Soru", align: "right", render: (point) => formatQuestionCount(point.questionCount) },
  ];

  return (
    <Panel
      aria-label={`${typeLabel} Başarı % gidişi`}
      className="next-chart-panel"
      title={`${typeLabel} Başarı % gidişi`}
      description={`${levelName} seviye raporları; soru sayısı farklı sınavlar Başarı % ile karşılaştırılır.`}
    >
      <ProgressLineChart
        caption={`${typeLabel} Başarı % gidişi`}
        emptyLabel="Başarı % saklanmış seviye raporu yok"
        points={chartPoints}
        tableMode="details"
      />
      <DataTable
        caption={`${typeLabel} seviye raporları`}
        columns={columns}
        density="compact"
        getRowKey={(point) => point.snapshotId}
        rows={series.points}
      />
    </Panel>
  );
}

function ExamLinkList({ exams }: { exams: GradeLevelAnalyticsExamRef[] }) {
  return (
    <ul>
      {exams.map((exam) => (
        <li key={exam.examId}>
          <Link href={reportWorkspaceHref(exam.examId)}>{exam.examTitle}</Link>
          {" · "}
          {examTypeLabel(exam.examType)}
          {exam.startsAt ? ` · ${formatDate(exam.startsAt)}` : null}
        </li>
      ))}
    </ul>
  );
}

function examTypeLabel(value: string | undefined) {
  if (!value) return "Türü belirtilmemiş sınavlar";
  return examTypeOptions.find((option) => option.value === value)?.label ?? value;
}

function formatQuestionCount(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 1 });
}

async function loadReferences(accessToken: string, signal: AbortSignal) {
  const [gradeLevels, terms] = await Promise.all([
    apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`, { signal }),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`, { signal }),
  ]);
  return { gradeLevels: gradeLevels.data, terms: terms.data };
}

async function loadLevelAnalytics(accessToken: string, filters: LevelAnalyticsFilters, signal: AbortSignal) {
  return apiRequest<GradeLevelAnalytics>(
    accessToken,
    withQueryParams(`${apiBaseUrl}/reports/grade-level-analytics`, filters),
    { signal },
  );
}
