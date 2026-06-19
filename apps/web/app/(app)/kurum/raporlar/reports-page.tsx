"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  InfoGrid,
  InfoItem,
  Input,
  MetricCard,
  MetricGrid,
  Panel,
  Select,
  StatusBadge,
  TabButton,
  Tabs,
  type DataTableColumn,
} from "@uzman-hocam/ui";
import type {
  AcademicTermRecord,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  ExamParticipantRecord,
  ExamRecord,
  GradeLevelRecord,
  ReportErrorBooklet,
  ReportSnapshotExportResult,
  ReportSnapshotRecord,
  ReportStudentQuestionSummary,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentRecord,
} from "@uzman-hocam/shared-types";
import { Download, Eye, RefreshCw } from "lucide-react";
import { KarneSheet } from "../../_shared/karne-sheet.js";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { firstFormError, reportQueryFormSchema } from "../../../../src/form-validation.js";
import { PageFrame } from "../_shared/page-frame.js";
import { formatCourseName, formatOutcomeCode, shortCourseName } from "../../_shared/academic-labels.js";
import { ClassCompareBar, ExamResultDonut, ProgressLineChart, TopicRadarChart } from "../../_shared/lazy-report-charts.js";
import { formatNetNumber, OutcomeNetTable } from "../../_shared/outcome-net-table.js";
import { ReportChartPanel } from "../../_shared/report-chart-panel.js";
import { buildReportAnalysisRows, type ReportAnalysisRow } from "../../_shared/report-analysis.js";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";

interface ReportData {
  errorBooklet: ReportErrorBooklet | null;
  participants: ExamParticipantRecord[];
  selectedStudentId: string;
  snapshots: ReportSnapshotRecord[];
  studentReport: ReportStudentSnapshot | null;
  studentProgress: ReportStudentProgress | null;
}

interface ReportReferences {
  campuses: CampusRecord[];
  classes: ClassRecord[];
  courses: CourseRecord[];
  exams: ExamRecord[];
  gradeLevels: GradeLevelRecord[];
  students: StudentRecord[];
  terms: AcademicTermRecord[];
}

const emptyFilters = {
  campusId: "",
  gradeLevelId: "",
  classId: "",
  courseId: "",
  termId: "",
};

const emptyReferences: ReportReferences = {
  campuses: [],
  classes: [],
  courses: [],
  exams: [],
  gradeLevels: [],
  students: [],
  terms: [],
};

type ReportWorkspaceTab = "query" | "analytics" | "students" | "karne" | "exports";

const reportWorkspaceTabs: Array<{ id: ReportWorkspaceTab; label: string }> = [
  { id: "query", label: "Sorgu / Üretim" },
  { id: "analytics", label: "Kurum Analitiği" },
  { id: "students", label: "Öğrenci Sonuçları" },
  { id: "karne", label: "Karne Önizleme" },
  { id: "exports", label: "Çıktılar" },
];

export function ReportsPage() {
  const { auth } = useAuth();
  const [examId, setExamId] = useState("");
  const [loadedExamId, setLoadedExamId] = useState("");
  const [contentHash, setContentHash] = useState("results-v1");
  const [filters, setFilters] = useState(emptyFilters);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [queueMessage, setQueueMessage] = useState("");
  const [activeTab, setActiveTab] = useState<ReportWorkspaceTab>("query");
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const referencesQuery = useQuery({
    queryKey: ["next-report-refs", tenantId],
    queryFn: () => loadReportReferences(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const references = referencesQuery.data ?? emptyReferences;
  const classes = references.classes;
  const campuses = references.campuses;
  const gradeLevels = references.gradeLevels;
  const courses = references.courses;
  const exams = references.exams;
  const terms = references.terms;
  const students = references.students;
  const classNameById = new Map(classes.map((klass) => [klass.id, klass.name]));
  const campusNameById = new Map(campuses.map((campus) => [campus.id, campus.name]));
  const gradeLevelNameById = new Map(gradeLevels.map((level) => [level.id, level.name]));
  const courseNameById = new Map(courses.map((course) => [course.id, formatCourseName(course.name)]));
  const termNameById = new Map(terms.map((term) => [term.id, term.name]));
  const latestSnapshot = reportData?.snapshots[0] ?? null;
  const studentReport = reportData?.studentReport ?? null;
  const studentRows = buildReportAnalysisRows({
    classes,
    participants: reportData?.participants ?? [],
    snapshot: latestSnapshot,
    students,
  });
  const branchRadar = toBranchRadar(latestSnapshot);
  const outcomeRows = toOutcomeRows(latestSnapshot);
  const classBars = toClassBars(latestSnapshot);
  const examResult = toExamResult(latestSnapshot);
  const progressPoints = toProgressPoints(reportData?.studentProgress ?? null);
  const snapshotContext = latestSnapshot
    ? formatReportContext(latestSnapshot, {
        campusNameById,
        classNameById,
        courseNameById,
        gradeLevelNameById,
        termNameById,
      })
    : "-";
  const isSnapshotReady = latestSnapshot?.status === "READY";
  const snapshotGeneratedAt = formatSnapshotGeneratedAt(latestSnapshot);
  const snapshotInputRefs = latestSnapshot ? formatSnapshotInputRefs(latestSnapshot.inputRefs) : "-";
  const snapshotExportReadiness = latestSnapshot
    ? isSnapshotReady
      ? "Excel/PDF hazır"
      : "READY snapshot gerekli"
    : "Hazır rapor yok";
  const selectedExamLabel = formatSelectedExamLabel(loadedExamId || examId, exams);
  const selectedExamExists = exams.some((exam) => exam.id === examId);

  useEffect(() => {
    if (!examId && exams.length > 0) {
      setExamId(preferredExamId(exams));
    }
  }, [examId, exams]);

  async function loadReports(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth) return;

    setError("");
    const parsedForm = reportQueryFormSchema.safeParse({ examId });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    try {
      setReportData(await loadReportData(auth.accessToken, parsedForm.data.examId, filters, { classes, students }));
      setLoadedExamId(parsedForm.data.examId);
      setActiveTab("analytics");
    } catch (loadError) {
      setReportData(null);
      setError(apiErrorMessage(loadError, "Rapor alınamadı."));
    }
  }

  async function enqueueReportGeneration() {
    if (!auth) return;

    setError("");
    setQueueMessage("");
    const parsedForm = reportQueryFormSchema.safeParse({ examId });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    const normalizedContentHash = contentHash.trim();
    if (!normalizedContentHash) {
      setError("Sonuç anahtarı zorunludur.");
      return;
    }
    try {
      await enqueueReportGenerationJob(auth.accessToken, parsedForm.data.examId, {
        ...filters,
        contentHash: normalizedContentHash,
      });
      setQueueMessage("Rapor üretimi kuyruğa alındı.");
      setActiveTab("query");
    } catch (queueError) {
      setError(apiErrorMessage(queueError, "Rapor üretimi kuyruğa alınamadı."));
    }
  }

  async function selectStudentReport(studentId: string) {
    if (!auth || !latestSnapshot || !loadedExamId) return;

    setError("");
    try {
      const selectedReport = await loadStudentReportData(auth.accessToken, loadedExamId, latestSnapshot.id, studentId);
      setReportData((current) => current
        ? {
            ...current,
            ...selectedReport,
            selectedStudentId: studentId,
          }
        : current);
      setActiveTab("karne");
    } catch (selectError) {
      setError(apiErrorMessage(selectError, "Öğrenci raporu alınamadı."));
    }
  }

  async function exportReport(kind: "xlsx" | "pdf") {
    if (!auth || !latestSnapshot) return;

    setError("");
    try {
      const result = kind === "xlsx"
        ? await exportReportSnapshotExcel(auth.accessToken, loadedExamId, latestSnapshot.id)
        : await exportReportSnapshotPdf(auth.accessToken, loadedExamId, latestSnapshot.id);
      downloadBase64File(result);
    } catch (exportError) {
      setError(apiErrorMessage(exportError, "Rapor çıktısı alınamadı."));
    }
  }

  return (
    <PageFrame
      title="Sınav Raporu"
      subtitle="Raporu sorgula, üret ve Excel/PDF olarak dışa aktar."
    >
      <section className="next-report-workspace" aria-label="Rapor çalışma alanı">
        <InfoGrid aria-label="Rapor bağlam özeti" className="next-report-context-strip" role="region">
          <InfoItem label="Seçili sınav" value={selectedExamLabel} />
          <InfoItem
            label="Snapshot"
            value={<StatusBadge tone={snapshotStatusTone(latestSnapshot?.status)}>{formatSnapshotStatus(latestSnapshot?.status)}</StatusBadge>}
          />
          <InfoItem label="Üretim zamanı" value={snapshotGeneratedAt} />
          <InfoItem label="Bağlam" value={snapshotContext} />
          <InfoItem label="Girdi referansı" value={snapshotInputRefs} />
          <InfoItem label="Çıktı hazırlığı" value={snapshotExportReadiness} />
        </InfoGrid>
        <Tabs label="Rapor çalışma alanı">
          {reportWorkspaceTabs.map((tab) => (
            <TabButton
              aria-controls={activeTab === tab.id ? `report-tabpanel-${tab.id}` : undefined}
              id={`report-tab-${tab.id}`}
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              selected={activeTab === tab.id}
            >
              {tab.label}
            </TabButton>
          ))}
        </Tabs>
        <div
          aria-labelledby={`report-tab-${activeTab}`}
          className="next-report-tab-panel"
          id={`report-tabpanel-${activeTab}`}
          role="tabpanel"
          tabIndex={0}
        >
          {activeTab === "query" ? (
            <Panel
              as="form"
              aria-label="Rapor sorgusu ve üretim"
              className="next-report-query-panel"
              description="Sınav, sonuç anahtarı ve kurum filtreleriyle mevcut snapshot veya yeni üretim işini yönet."
              title="Rapor sorgusu ve üretim"
              onSubmit={(event) => void loadReports(event)}
            >
              <Field label="Sınav">
                <Select required value={examId} onChange={(event) => setExamId(event.target.value)}>
                  <option value="">Sınav seç</option>
                  {exams.map((exam) => (
                    <option key={exam.id} value={exam.id}>{exam.title}</option>
                  ))}
                  {examId && !selectedExamExists ? <option value={examId}>Sınav seçildi</option> : null}
                </Select>
              </Field>
              <details className="next-advanced-details">
                <summary>Gelişmiş sınav referansı</summary>
                <Field label="Manuel sınav referansı">
                  <Input value={examId} onChange={(event) => setExamId(event.target.value)} />
                </Field>
              </details>
              <Field label="Sonuç anahtarı">
                <Input required value={contentHash} onChange={(event) => setContentHash(event.target.value)} />
              </Field>
              <div className="next-list-controls" aria-label="Rapor filtreleri">
                <Field label="Kampüs">
                  <Select
                    value={filters.campusId}
                    onChange={(event) => setFilters((current) => ({ ...current, campusId: event.target.value }))}
                  >
                    <option value="">Tümü</option>
                    {campuses.map((campus) => (
                      <option key={campus.id} value={campus.id}>{campus.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Seviye">
                  <Select
                    value={filters.gradeLevelId}
                    onChange={(event) => setFilters((current) => ({ ...current, gradeLevelId: event.target.value }))}
                  >
                    <option value="">Tümü</option>
                    {gradeLevels.map((level) => (
                      <option key={level.id} value={level.id}>{level.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Sınıf">
                  <Select
                    value={filters.classId}
                    onChange={(event) => setFilters((current) => ({ ...current, classId: event.target.value }))}
                  >
                    <option value="">Tümü</option>
                    {classes.map((klass) => (
                      <option key={klass.id} value={klass.id}>{klass.name}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Ders">
                  <Select
                    value={filters.courseId}
                    onChange={(event) => setFilters((current) => ({ ...current, courseId: event.target.value }))}
                  >
                    <option value="">Tümü</option>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>{formatCourseName(course.name)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Dönem">
                  <Select
                    value={filters.termId}
                    onChange={(event) => setFilters((current) => ({ ...current, termId: event.target.value }))}
                  >
                    <option value="">Tümü</option>
                    {terms.map((term) => (
                      <option key={term.id} value={term.id}>{term.name}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              {error ? <p className="uh-crud-page__error">{error}</p> : null}
              {queueMessage ? <p className="uh-crud-page__success">{queueMessage}</p> : null}
              <div className="next-report-actions">
                <Button type="submit">
                  <RefreshCw size={17} aria-hidden="true" />
                  Raporu getir
                </Button>
                <Button type="button" variant="secondary" onClick={() => void enqueueReportGeneration()}>
                  <RefreshCw size={17} aria-hidden="true" />
                  Rapor üret
                </Button>
              </div>
            </Panel>
          ) : null}
          {activeTab !== "query" && !latestSnapshot ? (
            <EmptyState
              title="Hazır rapor yok"
              description="Sorgu / Üretim sekmesinden sınav seçimiyle raporları getir veya rapor üretimini kuyruğa al."
            />
          ) : null}
          {activeTab === "analytics" && latestSnapshot ? (
            <section className="next-report-analytics-section" aria-label="Kurum analitiği">
              <h2>Kurum analitiği</h2>
              {!isSnapshotReady ? (
                <Alert tone="warning" title="Snapshot çıktıya hazır değil">
                  Bu snapshot {formatSnapshotStatus(latestSnapshot.status)} durumunda. Analiz görüntülenebilir, Excel/PDF çıktı hazır olduğunda açılır.
                </Alert>
              ) : null}
              <MetricGrid aria-label="Rapor özeti" role="region">
                <MetricCard
                  description={isSnapshotReady ? "READY snapshot" : "Çıktı için READY snapshot gerekli"}
                  label="Durum"
                  tone={metricStatusTone(latestSnapshot.status)}
                  value={formatSnapshotStatus(latestSnapshot.status)}
                />
                <MetricCard
                  description="Öğrenci sonuç sayısı"
                  label="Sonuç"
                  value={latestSnapshot.snapshotData?.resultCount ?? "-"}
                />
                <MetricCard
                  description="Sınav kapsamı"
                  label="Soru"
                  tone="info"
                  value={formatNumber(reportQuestionCount(latestSnapshot.snapshotData?.averages))}
                />
                <MetricCard
                  description="Ana karşılaştırma metriği"
                  label="Başarı %"
                  tone="success"
                  value={formatPercentNumber(reportSuccessRate(latestSnapshot.snapshotData?.averages))}
                />
                <MetricCard
                  description="Net, soru kapsamıyla okunur"
                  label="Ortalama net"
                  tone="info"
                  value={formatNetNumber(latestSnapshot.snapshotData?.averages?.net)}
                />
                <MetricCard
                  description="LGS bağlam metriği"
                  label="LGS puanı"
                  value={formatNumber(readLgsScore(latestSnapshot.snapshotData?.averages))}
                />
                <MetricCard
                  description="Psikometrik bağlam"
                  label="Standart puan"
                  value={formatNumber(latestSnapshot.snapshotData?.averages?.standardScore)}
                />
                <MetricCard
                  description="Filtre ve sınav bağlamı"
                  label="Bağlam"
                  span="wide"
                  value={snapshotContext}
                />
              </MetricGrid>
              <div className="next-report-visual-grid">
                <ReportChartPanel description="Soru sayısına göre başarı ve doğruluk dağılımı" title="Sınav Sonuç Dağılımı">
                  <ExamResultDonut result={examResult} />
                </ReportChartPanel>
                <ReportChartPanel description="Branş soru sayılarına göre başarı yüzdesi" title="Branş Başarıları">
                  <TopicRadarChart branches={branchRadar} caption="Rapor branş başarıları" />
                </ReportChartPanel>
                <ReportChartPanel description="Kazanım bazlı başarı ve net karşılaştırması" title="Kazanım Başarıları">
                  <OutcomeNetTable caption="Rapor kazanım başarıları" rows={outcomeRows} />
                </ReportChartPanel>
                <ReportChartPanel description="Sınıf ortalamalarının soru sayısına göre başarı yüzdesi" title="Sınıf Karşılaştırması">
                  <ClassCompareBar caption="Sınıf ortalama başarıları" classes={classBars} />
                </ReportChartPanel>
                <ReportChartPanel description="Başarı yüzdesi, net ve standart puan gelişimi" title="Öğrenci Gelişim Eğrisi">
                  <ProgressLineChart caption="Öğrenci başarı gelişimi" points={progressPoints} />
                </ReportChartPanel>
              </div>
            </section>
          ) : null}
          {activeTab === "students" && latestSnapshot ? (
            <StudentResultsTable
              rows={studentRows}
              selectedStudentId={reportData?.selectedStudentId ?? ""}
              onSelect={(studentId) => void selectStudentReport(studentId)}
            />
          ) : null}
          {activeTab === "karne" && latestSnapshot ? (
            <>
              <StudentReportCard
                report={studentReport}
                progress={reportData?.studentProgress ?? null}
                errorBooklet={reportData?.errorBooklet ?? null}
                outputStatusLabel={snapshotExportReadiness}
              />
              {reportData?.errorBooklet ? (
                <Panel
                  aria-label="Hata kitapçığı"
                  className="next-report-output-panel"
                  description="Seçili öğrencinin soru cevap inceleme bağlamı."
                  title="Hata kitapçığı"
                >
                  <ErrorBookletTable
                    caption="Seçili öğrenci hata kitapçığı"
                    emptyLabel="Hata kaydı yok"
                    items={reportData.errorBooklet.items}
                  />
                </Panel>
              ) : null}
            </>
          ) : null}
          {activeTab === "exports" && latestSnapshot ? (
            <Panel
              aria-label="Rapor çıktıları"
              className="next-report-output-panel"
              description={
                <>
                  Excel ve PDF çıktıları yalnız READY snapshot üzerinden alınır. Mevcut durum:{" "}
                  <StatusBadge tone={snapshotStatusTone(latestSnapshot.status)}>{formatSnapshotStatus(latestSnapshot.status)}</StatusBadge>
                </>
              }
              title="Çıktılar"
            >
              <div className="next-report-export-grid">
                <div>
                  <strong>Kurum Excel</strong>
                  <span>Özet, branş, sınıf ve öğrenci metrikleri.</span>
                  <Button disabled={!isSnapshotReady} onClick={() => void exportReport("xlsx")}>
                    <Download size={17} aria-hidden="true" />
                    Excel indir
                  </Button>
                </div>
                <div>
                  <strong>Kurum PDF özeti</strong>
                  <span>Nötr rapor şablonu ve seçili snapshot verisi.</span>
                  <Button disabled={!isSnapshotReady} onClick={() => void exportReport("pdf")}>
                    <Download size={17} aria-hidden="true" />
                    PDF indir
                  </Button>
                </div>
              </div>
            </Panel>
          ) : null}
        </div>
      </section>
    </PageFrame>
  );
}

async function loadReportData(
  accessToken: string,
  examId: string,
  filters: typeof emptyFilters,
  references: Pick<ReportReferences, "classes" | "students">,
): Promise<ReportData> {
  const snapshotsUrl = new URL(`${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots`);
  if (filters.campusId) snapshotsUrl.searchParams.set("campusId", filters.campusId);
  if (filters.gradeLevelId) snapshotsUrl.searchParams.set("gradeLevelId", filters.gradeLevelId);
  if (filters.classId) snapshotsUrl.searchParams.set("classId", filters.classId);
  if (filters.courseId) snapshotsUrl.searchParams.set("courseId", filters.courseId);
  if (filters.termId) snapshotsUrl.searchParams.set("termId", filters.termId);
  const [snapshots, participants] = await Promise.all([
    apiRequest<ReportSnapshotRecord[]>(
      accessToken,
      snapshotsUrl.toString(),
    ),
    loadExamParticipants(accessToken, examId).catch(() => []),
  ]);
  const latestSnapshot = snapshots[0];
  const studentId = buildReportAnalysisRows({
    classes: references.classes,
    participants,
    snapshot: latestSnapshot,
    students: references.students,
  }).find((row) => row.hasResult)?.studentId;

  if (!latestSnapshot || !studentId) {
    return { errorBooklet: null, participants, selectedStudentId: "", snapshots, studentReport: null, studentProgress: null };
  }

  const studentReportData = await loadStudentReportData(accessToken, examId, latestSnapshot.id, studentId);
  return { snapshots, participants, selectedStudentId: studentId, ...studentReportData };
}

async function loadStudentReportData(
  accessToken: string,
  examId: string,
  snapshotId: string,
  studentId: string,
): Promise<Pick<ReportData, "errorBooklet" | "studentProgress" | "studentReport">> {
  const [studentReport, studentProgress, errorBooklet] = await Promise.all([
    apiRequest<ReportStudentSnapshot>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/students/${encodeURIComponent(studentId)}`,
    ).catch(() => null),
    apiRequest<ReportStudentProgress>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/progress?scope=all`,
    ).catch(() => null),
    apiRequest<ReportErrorBooklet>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/students/${encodeURIComponent(studentId)}/error-booklet`,
    ).catch(() => null),
  ]);

  return { studentReport, studentProgress, errorBooklet };
}

async function loadReportReferences(accessToken: string): Promise<ReportReferences> {
  const [campuses, classes, courses, exams, gradeLevels, students, terms] = await Promise.all([
    apiListRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses`),
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`),
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`),
    apiListRequest<ExamRecord>(accessToken, `${apiBaseUrl}/exams`),
    apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`),
    apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students`),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return {
    campuses: campuses.data,
    classes: classes.data,
    courses: courses.data,
    exams: exams.data,
    gradeLevels: gradeLevels.data,
    students: students.data,
    terms: terms.data,
  };
}

async function loadExamParticipants(accessToken: string, examId: string) {
  return apiRequest<ExamParticipantRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/participants`,
  );
}

function preferredExamId(exams: ExamRecord[]) {
  return exams.find((exam) => exam.status === "PUBLISHED")?.id ?? exams[0]?.id ?? "";
}

function formatSelectedExamLabel(examId: string, exams: ExamRecord[]) {
  if (!examId) return "-";
  return exams.find((exam) => exam.id === examId)?.title ?? "Sınav seçildi";
}

async function enqueueReportGenerationJob(
  accessToken: string,
  examId: string,
  input: typeof emptyFilters & { contentHash: string },
) {
  return apiRequest<{ jobId: string; status: string }>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/generation-jobs`,
    {
      body: JSON.stringify({
        reportType: "EXAM_RESULT_SUMMARY",
        contentHash: input.contentHash,
        campusId: input.campusId || undefined,
        gradeLevelId: input.gradeLevelId || undefined,
        classId: input.classId || undefined,
        courseId: input.courseId || undefined,
        termId: input.termId || undefined,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    },
  );
}

async function exportReportSnapshotExcel(accessToken: string, examId: string, snapshotId: string) {
  return apiRequest<ReportSnapshotExportResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/export.xlsx`,
  );
}

async function exportReportSnapshotPdf(accessToken: string, examId: string, snapshotId: string) {
  return apiRequest<ReportSnapshotExportResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/export.pdf`,
  );
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 2 }).format(value);
}

function formatSnapshotStatus(status: string | undefined) {
  if (status === "READY") return "Hazır";
  if (status === "STALE") return "Eski";
  if (status === "PENDING") return "Bekliyor";
  if (status === "FAILED") return "Hatalı";
  return status ?? "Yok";
}

function snapshotStatusTone(status: string | undefined) {
  if (status === "READY") return "success";
  if (status === "STALE" || status === "PENDING") return "warning";
  if (status === "FAILED") return "danger";
  return "neutral";
}

function metricStatusTone(status: string | undefined) {
  if (status === "READY") return "success";
  if (status === "FAILED") return "danger";
  if (status === "STALE" || status === "PENDING") return "warning";
  return "default";
}

function formatSnapshotGeneratedAt(snapshot: ReportSnapshotRecord | null) {
  const generatedAt = snapshot?.snapshotData?.generatedAt;
  if (!generatedAt) return "-";
  const parsedDate = new Date(generatedAt);
  if (Number.isNaN(parsedDate.getTime())) return generatedAt;
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsedDate);
}

function readLgsScore(total: { estimatedRawScore?: number; standardScore?: number } | undefined) {
  return total?.estimatedRawScore ?? total?.standardScore;
}

function formatTrend(progress: ReportStudentProgress | null | undefined) {
  if (!progress) return "-";
  const net = progress.netDelta === undefined ? "-" : `${progress.netDelta > 0 ? "+" : ""}${formatNetNumber(progress.netDelta)} net`;
  const score = progress.standardScoreDelta === undefined
    ? "-"
    : `${progress.standardScoreDelta > 0 ? "+" : ""}${formatNumber(progress.standardScoreDelta)} puan`;
  if (net === "-") return score;
  if (score === "-") return net;
  return `${net} / ${score}`;
}

function formatReportContext(
  snapshot: ReportSnapshotRecord,
  maps: {
    campusNameById: Map<string, string>;
    classNameById: Map<string, string>;
    courseNameById: Map<string, string>;
    gradeLevelNameById: Map<string, string>;
    termNameById: Map<string, string>;
  },
) {
  const parts = [
    snapshot.campusId ? (maps.campusNameById.get(snapshot.campusId) ?? "Kampüs bilgisi yok") : "",
    snapshot.gradeLevelId ? (maps.gradeLevelNameById.get(snapshot.gradeLevelId) ?? "Seviye bilgisi yok") : "",
    snapshot.classId ? (maps.classNameById.get(snapshot.classId) ?? "Sınıf bilgisi yok") : "",
    snapshot.courseId ? (maps.courseNameById.get(snapshot.courseId) ?? "Ders bilgisi yok") : "",
    snapshot.termId ? (maps.termNameById.get(snapshot.termId) ?? "Dönem bilgisi yok") : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function formatSnapshotInputRefs(inputRefs: Record<string, unknown> | undefined) {
  if (!inputRefs) return "-";

  const resultKeys = Array.isArray(inputRefs.resultKeys) ? inputRefs.resultKeys.length : 0;
  const namedRefs = [
    inputRefs.rawImportId ? "ham optik" : "",
    inputRefs.answerKeyId ? "cevap anahtarı" : "",
    inputRefs.parserConfigId ? "parser" : "",
    inputRefs.staleReason ? "yenileme nedeni" : "",
  ].filter(Boolean);
  const parts = [
    resultKeys > 0 ? `${resultKeys} sonuç girdisi` : "",
    ...namedRefs,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : `${Object.keys(inputRefs).length} referans`;
}

function toBranchRadar(snapshot: ReportSnapshotRecord | null) {
  return (snapshot?.snapshotData?.branches ?? []).map((branch) => ({
    branch: formatCourseName(branch.branch),
    chartLabel: shortCourseName(branch.branch),
    blank: branch.blank,
    correct: branch.correct,
    net: branch.net,
    questionCount: branch.questionCount ?? reportQuestionCount(branch),
    resultCount: branch.resultCount,
    successRate: branch.successRate ?? reportSuccessRate(branch),
    wrong: branch.wrong,
  }));
}

function toOutcomeRows(snapshot: ReportSnapshotRecord | null) {
  return [...(snapshot?.snapshotData?.outcomes ?? [])]
    .sort((first, second) => (reportSuccessRate(second) ?? Number.NEGATIVE_INFINITY) - (reportSuccessRate(first) ?? Number.NEGATIVE_INFINITY))
    .slice(0, 12)
    .map((outcome, index) => ({
      courseName: formatCourseName(outcome.branch),
      id: `${outcome.branch}-${outcome.outcomeCode}-${index}`,
      net: outcome.net,
      outcomeCode: formatOutcomeCode(outcome.outcomeCode),
      questionCount: outcome.questionCount ?? reportQuestionCount(outcome),
      successRate: outcome.successRate ?? reportSuccessRate(outcome),
    }));
}

function toClassBars(snapshot: ReportSnapshotRecord | null) {
  return (snapshot?.snapshotData?.classes ?? []).map((record) => ({
    classId: record.classId,
    className: record.className ?? "Sınıfsız",
    net: record.averages.net,
    questionCount: record.averages.questionCount ?? reportQuestionCount(record.averages),
    standardScore: record.averages.standardScore,
    successRate: record.averages.successRate ?? reportSuccessRate(record.averages),
  }));
}

function toExamResult(snapshot: ReportSnapshotRecord | null) {
  const averages = snapshot?.snapshotData?.averages;
  return {
    correct: averages?.correct ?? 0,
    wrong: averages?.wrong ?? 0,
    blank: averages?.blank ?? 0,
    net: averages?.net ?? 0,
    questionCount: averages?.questionCount ?? reportQuestionCount(averages),
    successRate: averages?.successRate ?? reportSuccessRate(averages),
  };
}

function toProgressPoints(progress: ReportStudentProgress | null) {
  return progress?.points ?? [];
}

function ErrorBookletTable({
  caption,
  emptyLabel,
  items,
}: {
  caption: string;
  emptyLabel: string;
  items: ReportStudentQuestionSummary[];
}) {
  return (
    <table className="uh-chart-table next-error-booklet-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Soru</th>
          <th scope="col">Ders</th>
          <th scope="col">Kazanım</th>
          <th scope="col">Durum</th>
          <th scope="col">Yanıt</th>
          <th scope="col">Doğru</th>
        </tr>
      </thead>
      <tbody>
        {items.length > 0 ? (
          items.map((item) => (
            <tr key={`${item.questionNo}-${item.branch}-${item.status}`}>
              <th scope="row">{item.questionNo}</th>
              <td>{formatCourseName(item.branch)}</td>
              <td>{item.outcomeCode ? formatOutcomeCode(item.outcomeCode) : "-"}</td>
              <td>{formatQuestionStatus(item.status)}</td>
              <td>{item.status === "BLANK" ? "Boş" : item.answer}</td>
              <td>{item.correctAnswer}</td>
            </tr>
          ))
        ) : (
          <tr>
            <td colSpan={6}>{emptyLabel}</td>
          </tr>
        )}
      </tbody>
    </table>
  );
}

function formatQuestionStatus(status: ReportStudentQuestionSummary["status"]) {
  const labels: Record<ReportStudentQuestionSummary["status"], string> = {
    BLANK: "Boş",
    CORRECT: "Doğru",
    WRONG: "Yanlış",
  };
  return labels[status] ?? status;
}

function StudentResultsTable({
  rows,
  selectedStudentId,
  onSelect,
}: {
  rows: ReportAnalysisRow[];
  selectedStudentId: string;
  onSelect: (studentId: string) => void;
}) {
  const tableRows = rows.map((row, index) => ({ ...row, displayIndex: index + 1 }));
  const columns: Array<DataTableColumn<StudentResultTableRow>> = [
    {
      align: "right",
      header: "#",
      key: "index",
      mobilePriority: "hidden",
      priority: "primary",
      render: (row) => row.displayIndex,
    },
    {
      header: "Öğrenci",
      key: "student",
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => (
        <>
          <span className="next-report-student-name">{row.studentName}</span>
          {row.studentNo ? <small>#{row.studentNo}</small> : null}
        </>
      ),
      sticky: "left",
    },
    {
      header: "Sınıf",
      key: "class",
      mobilePriority: "secondary",
      priority: "primary",
      render: (row) => row.className,
    },
    {
      header: "Katılım",
      key: "participation",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatParticipantMeta(row),
    },
    {
      header: "Durum",
      key: "status",
      mobilePriority: "secondary",
      priority: "primary",
      render: (row) => formatResultStatus(row),
    },
    {
      align: "right",
      header: "Başarı %",
      key: "successRate",
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => formatPercentNumber(reportSuccessRate(row)),
    },
    {
      align: "right",
      header: "Net",
      key: "net",
      mobilePriority: "secondary",
      priority: "primary",
      render: (row) => formatNetNumber(row.net),
    },
    {
      align: "right",
      header: "Soru",
      key: "questionCount",
      mobilePriority: "secondary",
      priority: "primary",
      render: (row) => formatNumber(reportQuestionCount(row)),
    },
    {
      align: "right",
      header: "Doğru",
      key: "correct",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatNumber(row.correct),
    },
    {
      align: "right",
      header: "Yanlış",
      key: "wrong",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatNumber(row.wrong),
    },
    {
      align: "right",
      header: "Boş",
      key: "blank",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatNumber(row.blank),
    },
    {
      align: "right",
      header: "Puan",
      key: "score",
      mobilePriority: "hidden",
      priority: "secondary",
      render: (row) => formatNumber(readRowScore(row)),
    },
    {
      align: "right",
      header: "Genel sıra",
      key: "generalRank",
      mobilePriority: "hidden",
      priority: "primary",
      render: (row) => formatRank(row.generalRank),
    },
    {
      align: "right",
      header: "Sınıf sıra",
      key: "classRank",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatRank(row.classRank),
    },
    {
      align: "right",
      header: "Yüzdelik",
      key: "percentile",
      mobilePriority: "hidden",
      priority: "optional",
      render: (row) => formatPercentile(row.percentile),
    },
    {
      align: "center",
      header: "Karne",
      key: "actions",
      mobileLabel: "Karne",
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => (
        <div className="next-row-actions">
          <button
            aria-label={`${row.studentName} karnesini aç`}
            disabled={!row.hasResult}
            onClick={() => onSelect(row.studentId)}
            title="Karneyi aç"
            type="button"
          >
            <Eye size={17} aria-hidden="true" />
          </button>
        </div>
      ),
      sticky: "right",
    },
  ];

  return (
    <section className="next-report-table-section" aria-label="Öğrenci sonuç listesi">
      <div className="next-report-table-header">
        <div>
          <h3>Öğrenci sıralamaları</h3>
          <p>{rows.length} katılımcı</p>
        </div>
      </div>
      <div className="next-grid-scroll">
        <DataTable<StudentResultTableRow>
          caption="Öğrenci sıralamaları"
          className="next-report-analysis-table"
          columns={columns}
          density="compact"
          description="Başarı % ana karşılaştırma metriğidir; net, soru, puan ve sıralama bağlam olarak gösterilir."
          emptyText={
            <EmptyState
              title="Öğrenci sonucu yok"
              description="Bu snapshot içinde öğrenci sonucu veya katılımcı kaydı bulunamadı."
            />
          }
          getRowKey={(row) => row.rowKey}
          rowClassName={(row) => (row.studentId === selectedStudentId ? "next-report-row--selected" : undefined)}
          rows={tableRows}
        />
      </div>
    </section>
  );
}

type StudentResultTableRow = ReportAnalysisRow & { displayIndex: number };

function StudentReportCard({
  report,
  progress,
  errorBooklet,
  outputStatusLabel,
}: {
  report: ReportStudentSnapshot | null;
  progress: ReportStudentProgress | null;
  errorBooklet: ReportErrorBooklet | null;
  outputStatusLabel: string;
}) {
  return (
    <KarneSheet
      ariaLabel="Öğrenci karne özeti"
      branchCaption="Öğrenci branş karne tablosu"
      emptyClassName="next-report-karne-empty"
      emptyTitle="Öğrenci Karne Özeti"
      emptyTitleLevel="h3"
      errorBooklet={errorBooklet}
      outcomeAriaLabel="Kazanım radar grafiği"
      outcomeCaption="Kazanım radar tablosu"
      outcomeHeadingLevel="h3"
      outcomeSectionClassName="next-karne-block next-karne-block--wide next-karne-outcome-block"
      outputStatusLabel={outputStatusLabel}
      progress={progress}
      rankFormat="simple"
      report={report}
      reportLabel="Öğrenci Karne Özeti"
      scoreGeneralLabel="SIRA"
      sheetClassName="next-report-karne-sheet next-karne-sheet next-karne-sheet--workspace"
      showEmptyOutcomes
      summaryExtra={`Gelişim ${formatTrend(progress)}`}
      titleLevel="h3"
    />
  );
}

function formatParticipantMeta(row: ReportAnalysisRow): string {
  const parts = [row.participantNo, row.bookletType ? `${row.bookletType} kitapçık` : ""].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function formatResultStatus(row: ReportAnalysisRow): string {
  if (row.resultStatus === "READY") return "Sonuç var";
  if (row.resultStatus === "ABSENT") return "Katılmadı";
  return "Sonuç yok";
}

function readRowScore(row: ReportAnalysisRow): number | undefined {
  return row.estimatedRawScore ?? row.standardScore ?? row.rawScore;
}

function formatRank(rank: ReportAnalysisRow["generalRank"]): string {
  return rank ? `${rank.rank}/${rank.outOf}` : "-";
}

function formatPercentile(value: number | undefined): string {
  return value === undefined ? "-" : `%${formatNumber(value)}`;
}

function downloadBase64File(file: ReportSnapshotExportResult): void {
  const binary = atob(file.fileBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: file.contentType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.fileName;
  link.click();
  URL.revokeObjectURL(url);
}
