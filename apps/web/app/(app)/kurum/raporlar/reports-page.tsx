"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  DataTable,
  EmptyState,
  Field,
  Panel,
  Select,
  StatusBadge,
  TabButton,
  Tabs,
  type DataTableColumn,
} from "@o-okul/ui";
import type {
  AcademicTermRecord,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  ExamParticipantRecord,
  ExamRecord,
  GradeLevelRecord,
  ReportGenerationJobStatus,
  ReportErrorBooklet,
  ReportSnapshotExportResult,
  ReportSnapshotRecord,
  ReportStudentQuestionSummary,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentRecord,
} from "@o-okul/shared-types";
import {
  reportCourseMatchesScoreType,
  reportCourseShortName,
  reportCourseSortOrder,
} from "@o-okul/shared-types";
import { Download, Eye, RefreshCw } from "lucide-react";
import { KarneSheet } from "../../_shared/karne-sheet.js";
import { useAuth } from "../../../providers.js";
import { ApiRequestError, apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { firstFormError, reportQueryFormSchema } from "../../../../src/form-validation.js";
import { PageFrame } from "../_shared/page-frame.js";
import { formatCourseName, formatOutcomeCode, shortCourseName } from "../../_shared/academic-labels.js";
import { ClassCompareBar, PracticeScoreBar, TopicRadarChart } from "../../_shared/lazy-report-charts.js";
import { formatNetNumber, OutcomeNetTable } from "../../_shared/outcome-net-table.js";
import { ReportChartPanel } from "../../_shared/report-chart-panel.js";
import { buildReportAnalysisRows, type ReportAnalysisRow } from "../../_shared/report-analysis.js";
import { formatPercentDelta, formatPercentNumber, isComparableStudentProgress, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";

interface ReportData {
  errorBooklet: ReportErrorBooklet | null;
  participants: ExamParticipantRecord[];
  selectedStudentId: string;
  snapshots: ReportSnapshotRecord[];
  studentReport: ReportStudentSnapshot | null;
  studentProgress: ReportStudentProgress | null;
  students: StudentRecord[];
}

interface ReportReferences {
  campuses: CampusRecord[];
  classes: ClassRecord[];
  courses: CourseRecord[];
  exams: ExamRecord[];
  gradeLevels: GradeLevelRecord[];
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
  terms: [],
};
const emptyParticipants: ExamParticipantRecord[] = [];
const emptyStudents: StudentRecord[] = [];

type ReportWorkspaceTab = "overview" | "students" | "karne" | "exports";
type ReportJobState = "idle" | "queued" | "processing" | "completed" | "error";
type ReportScoreType = "LGS" | "TYT" | "SAY" | "EA" | "SOZ";

const reportWorkspaceTabs: Array<{ id: ReportWorkspaceTab; label: string }> = [
  { id: "overview", label: "Genel Bakış" },
  { id: "students", label: "Öğrenciler" },
  { id: "karne", label: "Karne" },
  { id: "exports", label: "Çıktılar" },
];

const defaultReportWorkspaceTab: ReportWorkspaceTab = "overview";

export function ReportsPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const [examId, setExamId] = useState(() => searchParams.get("examId") ?? "");
  const [loadedExamId, setLoadedExamId] = useState("");
  const [filters, setFilters] = useState(emptyFilters);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [isReportLoading, setIsReportLoading] = useState(false);
  const [scoreType, setScoreType] = useState<ReportScoreType | "">("");
  const [error, setError] = useState("");
  const [queueMessage, setQueueMessage] = useState("");
  const [reportJobState, setReportJobState] = useState<ReportJobState>("idle");
  const [activeTab, setActiveTab] = useState<ReportWorkspaceTab>(() => readReportWorkspaceTab(searchParams));
  const examIdRef = useRef(examId);
  const selectionGeneration = useRef(0);
  const reportDataAbortController = useRef<AbortController | null>(null);
  const studentReportAbortController = useRef<AbortController | null>(null);
  const reportJobAbortController = useRef<AbortController | null>(null);
  examIdRef.current = examId;
  const tenantId = auth?.session.tenantId ?? "anonymous";
  const referencesQuery = useQuery({
    queryKey: ["next-report-refs", tenantId],
    queryFn: ({ signal }) => loadReportReferences(auth?.accessToken ?? "", signal),
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
  const participants = reportData?.participants ?? emptyParticipants;
  const students = reportData?.students ?? emptyStudents;
  const classNameById = useMemo(() => new Map(classes.map((klass) => [klass.id, klass.name])), [classes]);
  const campusNameById = useMemo(() => new Map(campuses.map((campus) => [campus.id, campus.name])), [campuses]);
  const gradeLevelNameById = useMemo(() => new Map(gradeLevels.map((level) => [level.id, level.name])), [gradeLevels]);
  const courseNameById = useMemo(() => new Map(courses.map((course) => [course.id, formatCourseName(course.name)])), [courses]);
  const termNameById = useMemo(() => new Map(terms.map((term) => [term.id, term.name])), [terms]);
  const latestSnapshot = reportData?.snapshots[0] ?? null;
  const studentReport = reportData?.studentReport ?? null;
  const selectedExam = exams.find((exam) => exam.id === (loadedExamId || examId));
  const scoreTypeOptions = useMemo(
    () => reportScoreTypeOptions(selectedExam, latestSnapshot, studentReport),
    [latestSnapshot, selectedExam, studentReport],
  );
  const activeScoreType = scoreTypeOptions.includes(scoreType as ReportScoreType) ? scoreType as ReportScoreType : scoreTypeOptions[0];
  const studentRows = useMemo(
    () => buildReportAnalysisRows({
      classes,
      participants,
      scoreType: activeScoreType,
      snapshot: latestSnapshot,
      students,
    }),
    [activeScoreType, classes, latestSnapshot, participants, students],
  );
  const snapshotContext = useMemo(
    () => latestSnapshot
      ? formatReportContext(latestSnapshot, {
          campusNameById,
          classNameById,
          courseNameById,
          gradeLevelNameById,
          termNameById,
        })
      : "-",
    [campusNameById, classNameById, courseNameById, gradeLevelNameById, latestSnapshot, termNameById],
  );
  const isSnapshotReady = latestSnapshot?.status === "READY";
  const snapshotGeneratedAt = formatSnapshotGeneratedAt(latestSnapshot);
  const snapshotInputRefs = useMemo(() => latestSnapshot ? formatSnapshotInputRefs(latestSnapshot.inputRefs) : "-", [latestSnapshot]);
  const snapshotExportReadiness = latestSnapshot
    ? isSnapshotReady
      ? "Excel/PDF hazır"
      : "READY snapshot gerekli"
    : "Hazır rapor yok";
  const selectedExamLabel = useMemo(() => formatSelectedExamLabel(loadedExamId || examId, exams), [examId, exams, loadedExamId]);
  const selectedExamExists = exams.some((exam) => exam.id === examId);
  const hasSelectedExam = Boolean(examId.trim());
  const queryStatusLabel = loadedExamId ? "Sorgulandı" : hasSelectedExam ? "Sınav seçili" : "Sınav bekliyor";
  const queryStatusTone = loadedExamId ? "success" : hasSelectedExam ? "info" : "neutral";
  const productionStatusLabel = reportJobState === "queued"
    ? "Kuyruğa alındı"
    : reportJobState === "processing"
      ? "İşleniyor"
      : reportJobState === "completed"
        ? "Tamamlandı"
        : reportJobState === "error"
          ? "Hata"
          : latestSnapshot ? formatSnapshotStatus(latestSnapshot.status) : "Snapshot yok";
  const productionStatusTone = reportJobState === "completed"
    ? "success"
    : reportJobState === "error"
      ? "danger"
      : reportJobState === "queued" || reportJobState === "processing"
        ? "warning"
        : snapshotStatusTone(latestSnapshot?.status);
  const isReportJobBusy = reportJobState === "queued" || reportJobState === "processing";
  const outputStatusTone = isSnapshotReady ? "success" : latestSnapshot ? "warning" : "neutral";
  const karneStatusLabel = studentReport ? "Karne açık" : latestSnapshot ? "Öğrenci seç" : "Rapor bekliyor";
  const karneStatusTone = studentReport ? "success" : latestSnapshot ? "info" : "neutral";
  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  useEffect(() => {
    if (!examId && exams.length > 0) {
      const nextExamId = preferredExamId(exams);
      advanceSelectionGeneration();
      examIdRef.current = nextExamId;
      setExamId(nextExamId);
    }
  }, [examId, exams]);

  useEffect(() => () => {
    selectionGeneration.current += 1;
    reportDataAbortController.current?.abort();
    studentReportAbortController.current?.abort();
    reportJobAbortController.current?.abort();
  }, []);

  useEffect(() => {
    if (!scoreTypeOptions.length) {
      setScoreType("");
      return;
    }
    if (!scoreTypeOptions.includes(scoreType as ReportScoreType)) setScoreType(scoreTypeOptions[0]!);
  }, [scoreType, scoreTypeOptions]);

  useEffect(() => {
    const nextSearchParams = new URLSearchParams(window.location.search);
    const nextTab = readReportWorkspaceTab(nextSearchParams);
    const nextExamId = nextSearchParams.get("examId") ?? "";
    setActiveTab((current) => (current === nextTab ? current : nextTab));
    if (nextExamId !== examIdRef.current) {
      advanceSelectionGeneration();
      examIdRef.current = nextExamId;
      setExamId(nextExamId);
      setLoadedExamId("");
      setReportData(null);
      setIsReportLoading(false);
      setScoreType("");
      setError("");
      setQueueMessage("");
      setReportJobState("idle");
    }
  }, [searchParamsKey]);

  function selectReportTab(tab: ReportWorkspaceTab) {
    setActiveTab(tab);
    writeWorkspaceTabToUrl(tab, defaultReportWorkspaceTab, examId);
  }

  function selectReportExam(nextExamId: string) {
    if (nextExamId === examId) return;

    advanceSelectionGeneration();
    examIdRef.current = nextExamId;
    setExamId(nextExamId);
    setLoadedExamId("");
    setReportData(null);
    setIsReportLoading(false);
    setScoreType("");
    setError("");
    setQueueMessage("");
    setReportJobState("idle");
    setActiveTab(defaultReportWorkspaceTab);
    writeWorkspaceTabToUrl(defaultReportWorkspaceTab, defaultReportWorkspaceTab, nextExamId);
  }

  function advanceSelectionGeneration() {
    selectionGeneration.current += 1;
    reportDataAbortController.current?.abort();
    studentReportAbortController.current?.abort();
    reportJobAbortController.current?.abort();
    reportDataAbortController.current = null;
    studentReportAbortController.current = null;
    reportJobAbortController.current = null;
    return selectionGeneration.current;
  }

  async function loadReports(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || isReportJobBusy) return;

    setError("");
    const parsedForm = reportQueryFormSchema.safeParse({ examId });
    if (!parsedForm.success) {
      setError(firstFormError(parsedForm.error));
      return;
    }
    const requestGeneration = advanceSelectionGeneration();
    const requestExamId = parsedForm.data.examId;
    const controller = new AbortController();
    reportDataAbortController.current = controller;
    try {
      setIsReportLoading(true);
      const data = await loadReportData(auth.accessToken, requestExamId, filters, controller.signal);
      if (controller.signal.aborted || selectionGeneration.current !== requestGeneration || examIdRef.current !== requestExamId) return;
      setReportData(data);
      setLoadedExamId(requestExamId);
      selectReportTab("overview");
    } catch (loadError) {
      if (controller.signal.aborted || selectionGeneration.current !== requestGeneration) return;
      setLoadedExamId("");
      setReportData(null);
      setError(apiErrorMessage(loadError, "Rapor alınamadı."));
    } finally {
      if (reportDataAbortController.current === controller) reportDataAbortController.current = null;
      if (selectionGeneration.current === requestGeneration) setIsReportLoading(false);
    }
  }

  async function enqueueReportGeneration() {
    if (!auth || isReportLoading || isReportJobBusy) return;

    setError("");
    setQueueMessage("Rapor üretimi kuyruğa alınıyor.");
    setReportJobState("queued");
    const parsedForm = reportQueryFormSchema.safeParse({ examId });
    if (!parsedForm.success) {
      setQueueMessage("");
      setReportJobState("idle");
      setError(firstFormError(parsedForm.error));
      return;
    }
    const requestGeneration = advanceSelectionGeneration();
    const requestExamId = parsedForm.data.examId;
    let controller: AbortController | null = null;
    try {
      const job = await enqueueReportGenerationJob(auth.accessToken, requestExamId, {
        ...filters,
      });
      if (selectionGeneration.current !== requestGeneration || examIdRef.current !== requestExamId) return;
      setQueueMessage("Rapor üretimi kuyruğa alındı.");
      selectReportTab("overview");
      setReportJobState("processing");
      setQueueMessage("Rapor üretimi işleniyor.");
      controller = new AbortController();
      reportJobAbortController.current = controller;
      await waitForReportGenerationJob(auth.accessToken, requestExamId, job.jobId, controller.signal);
      if (controller.signal.aborted || selectionGeneration.current !== requestGeneration || examIdRef.current !== requestExamId) return;
      const data = await loadReportData(auth.accessToken, requestExamId, filters, controller.signal);
      if (controller.signal.aborted || selectionGeneration.current !== requestGeneration || examIdRef.current !== requestExamId) return;
      setReportData(data);
      setLoadedExamId(requestExamId);
      setQueueMessage("Rapor üretimi tamamlandı.");
      setReportJobState("completed");
      selectReportTab("overview");
    } catch (queueError) {
      if (controller?.signal.aborted || selectionGeneration.current !== requestGeneration || isAbortError(queueError)) return;
      setReportJobState("error");
      setQueueMessage("");
      setError(queueError instanceof ReportGenerationTimeoutError
        ? queueError.message
        : apiErrorMessage(queueError, "Rapor üretimi tamamlanamadı."));
    } finally {
      if (controller && reportJobAbortController.current === controller) reportJobAbortController.current = null;
    }
  }

  async function selectStudentReport(studentId: string) {
    if (!auth || !latestSnapshot || !loadedExamId) return;

    const requestGeneration = selectionGeneration.current;
    const requestExamId = loadedExamId;
    const requestSnapshotId = latestSnapshot.id;
    studentReportAbortController.current?.abort();
    const controller = new AbortController();
    studentReportAbortController.current = controller;
    setError("");
    try {
      const selectedReport = await loadStudentReportData(
        auth.accessToken,
        requestExamId,
        requestSnapshotId,
        studentId,
        controller.signal,
      );
      if (controller.signal.aborted || selectionGeneration.current !== requestGeneration || examIdRef.current !== requestExamId) return;
      setReportData((current) => current
        ? {
            ...current,
            ...selectedReport,
            selectedStudentId: studentId,
          }
        : current);
      selectReportTab("karne");
    } catch (selectError) {
      if (controller.signal.aborted || selectionGeneration.current !== requestGeneration) return;
      setError(apiErrorMessage(selectError, "Öğrenci raporu alınamadı."));
    } finally {
      if (studentReportAbortController.current === controller) studentReportAbortController.current = null;
    }
  }

  async function exportReport(kind: "xlsx" | "pdf-summary" | "pdf-packet" | "pdf-student") {
    if (!auth || !latestSnapshot) return;

    setError("");
    try {
      const result = kind === "xlsx"
        ? await exportReportSnapshotExcel(auth.accessToken, loadedExamId, latestSnapshot.id)
        : kind === "pdf-summary"
          ? await exportReportSnapshotPdf(auth.accessToken, loadedExamId, latestSnapshot.id)
          : kind === "pdf-packet"
            ? await exportReportSnapshotKarnelerPdf(auth.accessToken, loadedExamId, latestSnapshot.id)
            : await exportStudentReportPdf(
                auth.accessToken,
                loadedExamId,
                latestSnapshot.id,
                reportData?.selectedStudentId ?? "",
              );
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
        <Panel
          as="form"
          aria-label="Rapor kontrol alanı"
          className="next-report-query-panel"
          description="Önce sınavı seçin; kapsam filtreleri yalnız gerektiğinde açılır."
          title="Raporu hazırla"
          onSubmit={(event) => void loadReports(event)}
        >
          <div className="next-report-control-row" aria-label="Rapor üst kontrolleri">
            <Field className="next-report-control-row__exam" label="Sınav">
              <Select
                disabled={isReportLoading || isReportJobBusy}
                required
                value={examId}
                onChange={(event) => selectReportExam(event.target.value)}
              >
                <option value="">Sınav seç</option>
                {exams.map((exam) => (
                  <option key={exam.id} value={exam.id}>{exam.title}</option>
                ))}
                {examId && !selectedExamExists ? <option value={examId}>Sınav seçildi</option> : null}
              </Select>
            </Field>
            <Field label="Puan türü">
              <Select disabled={!scoreTypeOptions.length} value={activeScoreType ?? ""} onChange={(event) => setScoreType(event.target.value as ReportScoreType)}>
                {!scoreTypeOptions.length ? <option value="">Eski hesaplama</option> : null}
                {scoreTypeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
              </Select>
            </Field>
            <div className="next-report-actions">
              <Button
                disabled={referencesQuery.isPending || isReportJobBusy}
                loading={isReportLoading}
                loadingLabel="Yükleniyor"
                type="submit"
              >
                <RefreshCw size={17} aria-hidden="true" />
                Raporu getir
              </Button>
              {latestSnapshot || isReportJobBusy ? (
                <Button
                  disabled={!examId || isReportLoading}
                  loading={isReportJobBusy}
                  loadingLabel="İşleniyor"
                  type="button"
                  variant="secondary"
                  onClick={() => void enqueueReportGeneration()}
                >
                  <RefreshCw size={17} aria-hidden="true" />
                  {latestSnapshot ? "Yeniden üret" : "Rapor üret"}
                </Button>
              ) : null}
            </div>
          </div>
          <details className="next-report-filter-details">
            <summary>
              <span>Kapsam filtreleri</span>
              <small>{activeFilterCount ? `${activeFilterCount} filtre seçili` : "Tüm kurum"}</small>
            </summary>
            <div className="next-report-filter-grid" aria-label="Rapor filtreleri">
              <Field label="Kampüs">
                <Select value={filters.campusId} onChange={(event) => setFilters((current) => ({ ...current, campusId: event.target.value }))}>
                  <option value="">Tümü</option>
                  {campuses.map((campus) => <option key={campus.id} value={campus.id}>{campus.name}</option>)}
                </Select>
              </Field>
              <Field label="Seviye">
                <Select value={filters.gradeLevelId} onChange={(event) => setFilters((current) => ({ ...current, gradeLevelId: event.target.value }))}>
                  <option value="">Tümü</option>
                  {gradeLevels.map((level) => <option key={level.id} value={level.id}>{level.name}</option>)}
                </Select>
              </Field>
              <Field label="Sınıf">
                <Select value={filters.classId} onChange={(event) => setFilters((current) => ({ ...current, classId: event.target.value }))}>
                  <option value="">Tümü</option>
                  {classes.map((klass) => <option key={klass.id} value={klass.id}>{klass.name}</option>)}
                </Select>
              </Field>
              <Field label="Ders">
                <Select value={filters.courseId} onChange={(event) => setFilters((current) => ({ ...current, courseId: event.target.value }))}>
                  <option value="">Tümü</option>
                  {courses.map((course) => <option key={course.id} value={course.id}>{formatCourseName(course.name)}</option>)}
                </Select>
              </Field>
              <Field label="Dönem">
                <Select value={filters.termId} onChange={(event) => setFilters((current) => ({ ...current, termId: event.target.value }))}>
                  <option value="">Tümü</option>
                  {terms.map((term) => <option key={term.id} value={term.id}>{term.name}</option>)}
                </Select>
              </Field>
            </div>
          </details>
          {referencesQuery.isError ? <p className="uh-crud-page__error" role="alert">Rapor referansları alınamadı.</p> : null}
          {error ? <p className="uh-crud-page__error" role="alert">{error}</p> : null}
          {queueMessage ? <p aria-live="polite" className="uh-crud-page__success" role="status">{queueMessage}</p> : null}
        </Panel>
        <section className="next-report-status-surface" aria-label="Rapor iş akışı">
          <div className="next-report-status-main">
            <span>Aktif rapor</span>
            <strong>{selectedExamLabel}</strong>
            <small>{snapshotContext}</small>
          </div>
          <div className="next-report-status-pills">
            <span>Sorgu <StatusBadge tone={queryStatusTone}>{queryStatusLabel}</StatusBadge></span>
            <span>Rapor <StatusBadge tone={productionStatusTone}>{productionStatusLabel}</StatusBadge></span>
            <span>Çıktı <StatusBadge tone={outputStatusTone}>{snapshotExportReadiness}</StatusBadge></span>
            <span>Karne <StatusBadge tone={karneStatusTone}>{karneStatusLabel}</StatusBadge></span>
          </div>
          <details className="next-report-meta-details">
            <summary>Rapor ayrıntıları</summary>
            <dl>
              <div><dt>Snapshot</dt><dd>{formatSnapshotStatus(latestSnapshot?.status)}</dd></div>
              <div><dt>Üretim zamanı</dt><dd>{snapshotGeneratedAt}</dd></div>
              <div><dt>Bağlam</dt><dd>{snapshotContext}</dd></div>
              <div><dt>Girdi</dt><dd>{snapshotInputRefs}</dd></div>
            </dl>
          </details>
        </section>
        <Tabs label="Rapor çalışma alanı">
          {reportWorkspaceTabs.map((tab) => (
            <TabButton
              aria-controls={activeTab === tab.id ? `report-tabpanel-${tab.id}` : undefined}
              id={`report-tab-${tab.id}`}
              key={tab.id}
              onClick={() => selectReportTab(tab.id)}
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
          {!latestSnapshot && !isReportLoading ? (
            <EmptyState
              title="Hazır rapor yok"
              description="Üstteki kontrol alanından sınavı ve kapsamı seçerek raporu getir veya üret."
              primaryAction={examId && !isReportJobBusy
                ? { label: "Rapor üret", onClick: () => void enqueueReportGeneration() }
                : undefined}
            />
          ) : null}
          {activeTab === "overview" && latestSnapshot ? (
            <ReportAnalyticsPanel
              activeScoreType={activeScoreType}
              isSnapshotReady={isSnapshotReady}
              latestSnapshot={latestSnapshot}
              snapshotContext={snapshotContext}
            />
          ) : null}
          {activeTab === "students" && latestSnapshot ? (
            <StudentResultsTable
              error={error}
              loading={isReportLoading}
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
                scoreType={activeScoreType}
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
                  <Button disabled={!isSnapshotReady} onClick={() => void exportReport("pdf-summary")}>
                    <Download size={17} aria-hidden="true" />
                    PDF indir
                  </Button>
                </div>
                <div>
                  <strong>Toplu Karneler</strong>
                  <span>Snapshot içindeki tüm öğrencilerin iki sayfalık karneleri.</span>
                  <Button disabled={!isSnapshotReady} onClick={() => void exportReport("pdf-packet")}>
                    <Download size={17} aria-hidden="true" />
                    Toplu karneleri indir
                  </Button>
                </div>
                <div>
                  <strong>Tekli Karne PDF</strong>
                  <span>Karne alanında seçili öğrencinin iki sayfalık çıktısı.</span>
                  <Button
                    disabled={!isSnapshotReady || !reportData?.selectedStudentId}
                    onClick={() => void exportReport("pdf-student")}
                  >
                    <Download size={17} aria-hidden="true" />
                    Tekli karneyi indir
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
  signal: AbortSignal,
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
      { signal },
    ),
    apiRequestOrEmpty(() => loadExamParticipants(accessToken, examId, signal)),
  ]);
  const latestSnapshot = snapshots[0];
  const students = latestSnapshot
    ? await loadReportStudents(accessToken, {
        classId: filters.classId || latestSnapshot.classId || "",
        participants,
        snapshot: latestSnapshot,
      }, signal)
    : [];
  return { errorBooklet: null, participants, selectedStudentId: "", snapshots, studentReport: null, studentProgress: null, students };
}

async function loadStudentReportData(
  accessToken: string,
  examId: string,
  snapshotId: string,
  studentId: string,
  signal: AbortSignal,
): Promise<Pick<ReportData, "errorBooklet" | "studentProgress" | "studentReport">> {
  const [studentReport, studentProgress, errorBooklet] = await Promise.all([
    apiRequestOrNull(() => apiRequest<ReportStudentSnapshot>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/students/${encodeURIComponent(studentId)}`,
      { signal },
    )),
    apiRequestOrNull(() => apiRequest<ReportStudentProgress>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/progress?scope=all`,
      { signal },
    )),
    apiRequestOrNull(() => apiRequest<ReportErrorBooklet>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/students/${encodeURIComponent(studentId)}/error-booklet`,
      { signal },
    )),
  ]);

  return { studentReport, studentProgress, errorBooklet };
}

async function loadReportReferences(accessToken: string, signal: AbortSignal): Promise<ReportReferences> {
  const [campuses, classes, courses, exams, gradeLevels, terms] = await Promise.all([
    apiListRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses`, { signal }),
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`, { signal }),
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`, { signal }),
    apiListRequest<ExamRecord>(accessToken, `${apiBaseUrl}/exams`, { signal }),
    apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`, { signal }),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`, { signal }),
  ]);
  return {
    campuses: campuses.data,
    classes: classes.data,
    courses: courses.data,
    exams: exams.data,
    gradeLevels: gradeLevels.data,
    terms: terms.data,
  };
}

async function loadReportStudents(
  accessToken: string,
  input: Pick<typeof emptyFilters, "classId"> & {
    participants: ExamParticipantRecord[];
    snapshot: ReportSnapshotRecord;
  },
  signal: AbortSignal,
) {
  if (!input.classId) {
    return loadStudentsByIds(accessToken, reportStudentIds(input.participants, input.snapshot), signal);
  }

  const studentsUrl = new URL(`${apiBaseUrl}/students`);
  studentsUrl.searchParams.set("classId", input.classId);
  const students = await apiListRequest<StudentRecord>(accessToken, studentsUrl.toString(), { signal });
  return students.data;
}

async function loadStudentsByIds(accessToken: string, studentIds: string[], signal: AbortSignal) {
  const chunks = chunk(studentIds, 200);
  const responses = await Promise.all(chunks.map(async (ids) => {
    const url = new URL(`${apiBaseUrl}/students`);
    url.searchParams.set("ids", ids.join(","));
    return apiRequestOrEmpty(async () => (await apiListRequest<StudentRecord>(accessToken, url, { signal })).data);
  }));
  return responses.flat();
}

function chunk<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function apiRequestOrNull<T>(request: () => Promise<T>): Promise<T | null> {
  try {
    return await request();
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

async function apiRequestOrEmpty<T>(request: () => Promise<T[]>): Promise<T[]> {
  return (await apiRequestOrNull(request)) ?? [];
}

function reportStudentIds(participants: ExamParticipantRecord[], snapshot: ReportSnapshotRecord) {
  return uniqueStrings([
    ...participants.map((participant) => participant.studentId),
    ...(snapshot.snapshotData?.students ?? []).map((student) => student.studentId),
  ]);
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

async function loadExamParticipants(accessToken: string, examId: string, signal: AbortSignal) {
  return apiRequest<ExamParticipantRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/participants`,
    { signal },
  );
}

function preferredExamId(exams: ExamRecord[]) {
  return exams.find((exam) => exam.status === "PUBLISHED")?.id ?? exams[0]?.id ?? "";
}

function readReportWorkspaceTab(searchParams: Pick<URLSearchParams, "get">): ReportWorkspaceTab {
  const tab = searchParams.get("tab");
  return reportWorkspaceTabs.some((candidate) => candidate.id === tab) ? tab as ReportWorkspaceTab : defaultReportWorkspaceTab;
}

function writeWorkspaceTabToUrl(tab: string, defaultTab: string, examId: string) {
  if (typeof window === "undefined") return;

  const url = new URL(window.location.href);
  if (examId) {
    url.searchParams.set("examId", examId);
  } else {
    url.searchParams.delete("examId");
  }
  if (tab === defaultTab) {
    url.searchParams.delete("tab");
  } else {
    url.searchParams.set("tab", tab);
  }
  window.history.replaceState(window.history.state, "", formatUrlForReplaceState(url));
}

function formatUrlForReplaceState(url: URL) {
  const query = url.searchParams.toString();
  return `${url.pathname}${query ? `?${query}` : ""}${url.hash}`;
}

function formatSelectedExamLabel(examId: string, exams: ExamRecord[]) {
  if (!examId) return "-";
  return exams.find((exam) => exam.id === examId)?.title ?? "Sınav seçildi";
}

async function enqueueReportGenerationJob(
  accessToken: string,
  examId: string,
  input: typeof emptyFilters,
) {
  return apiRequest<{ jobId: string; status: string }>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/generation-jobs`,
    {
      body: JSON.stringify({
        reportType: "EXAM_RESULT_SUMMARY",
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

async function waitForReportGenerationJob(accessToken: string, examId: string, jobId: string, signal: AbortSignal) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    let status: ReportGenerationJobStatus | undefined;
    try {
      status = await apiRequest<ReportGenerationJobStatus>(
        accessToken,
        `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/generation-jobs/${encodeURIComponent(jobId)}`,
        { signal },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      if (error instanceof ApiRequestError) throw error;
      // Geçici ağ hatalarında gerçek worker işini iptal edilmiş saymadan yeniden dene.
    }
    if (status?.status === "COMPLETED") return status;
    if (status?.status === "FAILED") throw new Error(status.errorCode ?? "REPORT_GENERATION_FAILED");
    await abortableDelay(1_000, signal);
  }
  throw new ReportGenerationTimeoutError();
}

function abortableDelay(duration: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      window.clearTimeout(timeout);
      reject(signal.reason);
    };
    const timeout = window.setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, duration);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError";
}

class ReportGenerationTimeoutError extends Error {
  constructor() {
    super("Rapor üretimi hâlâ işleniyor. Bir süre sonra sorguyu yenileyin.");
  }
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

async function exportReportSnapshotKarnelerPdf(accessToken: string, examId: string, snapshotId: string) {
  return apiRequest<ReportSnapshotExportResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/export.karneler.pdf`,
  );
}

async function exportStudentReportPdf(accessToken: string, examId: string, snapshotId: string, studentId: string) {
  if (!studentId) throw new Error("REPORT_STUDENT_REQUIRED");
  return apiRequest<ReportSnapshotExportResult>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/students/${encodeURIComponent(studentId)}/export.pdf`,
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

function formatTrend(progress: ReportStudentProgress | null | undefined) {
  if (!progress) return "-";
  if (!isComparableStudentProgress(progress)) {
    return progress.points.length > 0 ? `${progress.points.length} sınav sonucu` : "-";
  }
  const successRate = progress.successRateDelta === undefined
    ? "-"
    : `${formatPercentDelta(progress.successRateDelta)} başarı`;
  return successRate;
}

function formatKarneTrend(progress: ReportStudentProgress | null | undefined) {
  if (!progress) return "-";
  const successRate = progress.successRateDelta === undefined
    ? "-"
    : `${formatPercentDelta(progress.successRateDelta)} başarı`;
  const net = progress.netDelta === undefined ? "-" : `${progress.netDelta > 0 ? "+" : ""}${formatNetNumber(progress.netDelta)} net`;
  const score = progress.standardScoreDelta === undefined
    ? "-"
    : `${progress.standardScoreDelta > 0 ? "+" : ""}${formatNumber(progress.standardScoreDelta)} puan`;
  const context = [net, score].filter((item) => item !== "-").join(" / ");
  if (successRate === "-") return context || "-";
  return context ? `${successRate} (${context})` : successRate;
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

function ReportAnalyticsPanel({
  activeScoreType,
  isSnapshotReady,
  latestSnapshot,
  snapshotContext,
}: {
  activeScoreType: ReportScoreType | undefined;
  isSnapshotReady: boolean;
  latestSnapshot: ReportSnapshotRecord;
  snapshotContext: string;
}) {
  const branchRadar = useMemo(() => toBranchRadar(latestSnapshot), [latestSnapshot]);
  const outcomeRows = useMemo(() => toOutcomeRows(latestSnapshot), [latestSnapshot]);
  const classBars = useMemo(() => toClassBars(latestSnapshot), [latestSnapshot]);
  const examResult = useMemo(() => toExamResult(latestSnapshot), [latestSnapshot]);
  const scoreAverages = (latestSnapshot.snapshotData as typeof latestSnapshot.snapshotData & {
    scoreAverages?: Array<{ type: ReportScoreType; calculatedCount: number; practiceScore: number }>;
  } | undefined)?.scoreAverages ?? [];
  const scoreAverage = scoreAverages.find((average) => average.type === activeScoreType);
  const isModernSnapshot = latestSnapshot.snapshotData?.schemaVersion === 2 || Boolean(latestSnapshot.snapshotData?.scoringProfileId);
  const score = scoreAverage?.practiceScore ?? (isModernSnapshot ? undefined : legacyScore(latestSnapshot.snapshotData?.averages));
  const successRate = reportSuccessRate(latestSnapshot.snapshotData?.averages);
  const questionCount = reportQuestionCount(latestSnapshot.snapshotData?.averages);
  const comparableBranches = [...branchRadar]
    .filter((branch) => (branch.questionCount ?? 0) > 0 && branch.successRate !== undefined)
    .sort((first, second) => (second.successRate ?? 0) - (first.successRate ?? 0));
  const strongestBranch = comparableBranches[0];
  const focusBranch = comparableBranches.length > 1 ? comparableBranches.at(-1) : undefined;
  const showClassComparison = classBars.length > 1;
  const showScoreComparison = scoreAverages.length > 1;

  return (
    <section className="next-report-analytics-section" aria-label="Kurum analitiği">
      <div className="next-report-section-heading">
        <div>
          <span>Kurum performansı</span>
          <h2>Genel görünüm</h2>
          <p>{snapshotContext}</p>
        </div>
      </div>
      {!isSnapshotReady ? (
        <Alert tone="warning" title="Snapshot çıktıya hazır değil">
          Bu snapshot {formatSnapshotStatus(latestSnapshot.status)} durumunda. Analiz görüntülenebilir, Excel/PDF çıktı hazır olduğunda açılır.
        </Alert>
      ) : null}
      <section className="next-report-summary-hero" aria-label="Rapor özeti">
        <div className="next-report-summary-primary">
          <span>Başarı %</span>
          <strong>{formatPercentNumber(successRate)}</strong>
          <div className="next-report-summary-meter" aria-hidden="true">
            <span style={{ width: `${Math.min(100, Math.max(0, successRate ?? 0))}%` }} />
          </div>
          <small>{formatNetNumber(latestSnapshot.snapshotData?.averages?.net)} net / {formatNumber(questionCount)} soru</small>
        </div>
        <dl className="next-report-summary-metrics">
          <div>
            <dt>Katılımcı</dt>
            <dd>{formatNumber(latestSnapshot.snapshotData?.resultCount)}</dd>
          </div>
          <div>
            <dt>Doğru · Yanlış · Boş</dt>
            <dd>{formatNumber(examResult.correct)} · {formatNumber(examResult.wrong)} · {formatNumber(examResult.blank)}</dd>
          </div>
          <div>
            <dt>{scoreAverage ? `${scoreAverage.type} deneme puanı` : isModernSnapshot ? `${activeScoreType ?? "Puan"} puanı` : "Eski hesaplama"}</dt>
            <dd>{formatNumber(score)}</dd>
            <small>
              {scoreAverage
                ? `${scoreAverage.calculatedCount} sonuç hesaplandı`
                : isModernSnapshot
                  ? "Bu puan türü hesaplanamadı"
                  : "Yeni puan görünümü yok"}
            </small>
          </div>
        </dl>
        <div className="next-report-insights" aria-label="Öne çıkan dersler">
          <span>Ders içgörüsü</span>
          {strongestBranch ? (
            <div>
              <small>En güçlü</small>
              <strong>{strongestBranch.branch}</strong>
              <b>{formatPercentNumber(strongestBranch.successRate)}</b>
            </div>
          ) : <p>Ders karşılaştırması için veri yok.</p>}
          {focusBranch ? (
            <div>
              <small>Gelişim alanı</small>
              <strong>{focusBranch.branch}</strong>
              <b>{formatPercentNumber(focusBranch.successRate)}</b>
            </div>
          ) : null}
        </div>
      </section>
      {isModernSnapshot ? <PracticeScoreWarning /> : null}
      <div className="next-report-dashboard-grid">
        <ReportChartPanel
          className="next-report-chart-panel--primary"
          description="Derslerin soru kapsamına göre başarı yüzdesi"
          title="Ders performansı"
        >
          <TopicRadarChart branches={branchRadar} caption="Rapor ders başarıları" tableMode="details" />
        </ReportChartPanel>
        {showClassComparison || showScoreComparison ? (
          <div className="next-report-chart-stack">
            {showClassComparison ? (
              <ReportChartPanel
                className="next-report-chart-panel--compact"
                description="Sınıfların başarı yüzdesi"
                title="Sınıf karşılaştırması"
              >
                <ClassCompareBar caption="Sınıf ortalama başarıları" classes={classBars} tableMode="details" />
              </ReportChartPanel>
            ) : null}
            {showScoreComparison ? (
              <ReportChartPanel
                className="next-report-chart-panel--compact"
                description="Hesaplanan puan türlerinin kurum ortalaması"
                title="Puan profili"
              >
                <PracticeScoreBar caption="Kurum deneme puanı ortalamaları" scores={scoreAverages} tableMode="details" />
              </ReportChartPanel>
            ) : null}
          </div>
        ) : null}
      </div>
      <details className="next-report-outcome-details">
        <summary>
          <span>Kazanım ayrıntıları</span>
          <small>{outcomeRows.length} kazanım · başarı ve net karşılaştırması</small>
        </summary>
        <OutcomeNetTable caption="Rapor kazanım başarıları" rows={outcomeRows} />
      </details>
    </section>
  );
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
        {items.some((item) => item.status !== "CANCELLED") ? (
          items.filter((item) => item.status !== "CANCELLED").map((item) => (
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
    CANCELLED: "İptal",
    CORRECT: "Doğru",
    WRONG: "Yanlış",
  };
  return labels[status] ?? status;
}

function StudentResultsTable({
  error,
  loading,
  rows,
  selectedStudentId,
  onSelect,
}: {
  error?: string;
  loading: boolean;
  rows: ReportAnalysisRow[];
  selectedStudentId: string;
  onSelect: (studentId: string) => void;
}) {
  const tableRows = rows;
  const scoreTypes = reportScoreColumns(rows);
  const scoreColumns: Array<DataTableColumn<ReportAnalysisRow>> = scoreTypes.length > 0
    ? scoreTypes.map((type) => ({
      align: "right",
      header: `${scoreTypeLabel(type)} puanı`,
      key: `${type.toLocaleLowerCase("tr-TR")}Score`,
      mobilePriority: "hidden",
      priority: "secondary",
      render: (row) => (
        <span className="next-report-score-detail">
          <strong>{formatNumber(row.scoreViews?.find((view) => view.type === type)?.practiceScore)}</strong>
          <small>{formatScoreCourseSummary(row, type)}</small>
        </span>
      ),
    }))
    : [{
      align: "right",
      header: "Deneme puanı",
      key: "score",
      mobilePriority: "hidden",
      priority: "secondary",
      render: (row) => formatNumber(readRowScore(row)),
    }];
  const columns: Array<DataTableColumn<ReportAnalysisRow>> = [
    {
      header: "Öğrenci",
      key: "student",
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => (
        <span className="next-report-student-cell">
          <strong>{row.studentName}</strong>
          <span>{[row.studentNo ? `#${row.studentNo}` : "", row.className].filter(Boolean).join(" · ")}</span>
          <small>{formatParticipantMeta(row)} · {formatResultStatus(row)}</small>
        </span>
      ),
      sticky: "left",
    },
    {
      header: "Performans",
      key: "performance",
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => (
        <span className="next-report-performance-cell">
          <strong>{formatPercentNumber(reportSuccessRate(row))}</strong>
          <span>{formatNetNumber(row.net)} net / {formatNumber(reportQuestionCount(row))} soru</span>
          <small>{formatNumber(row.correct)} D · {formatNumber(row.wrong)} Y · {formatNumber(row.blank)} B</small>
        </span>
      ),
    },
    ...scoreColumns,
    {
      header: "Başarı sırası",
      key: "rank",
      mobilePriority: "hidden",
      priority: "primary",
      render: (row) => (
        <dl className="next-report-rank-cell">
          <div><dt>Kurum</dt><dd>{formatRank(row.generalRank)}</dd></div>
          <div><dt>Sınıf</dt><dd>{formatRank(row.classRank)}</dd></div>
        </dl>
      ),
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
          <Button size="icon" variant="ghost"
            aria-label={`${row.studentName} karnesini aç`}
            disabled={!row.hasResult}
            onClick={() => onSelect(row.studentId)}
            title="Karneyi aç"
            type="button"
          >
            <Eye size={17} aria-hidden="true" />
          </Button>
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
        <DataTable<ReportAnalysisRow>
          caption="Öğrenci sıralamaları"
          className="next-report-analysis-table"
          columns={columns}
          density="compact"
          description="Başarı yüzdesi, net-soru özeti, puan türleri ve kurum-sınıf başarı sırası birlikte gösterilir."
          error={error}
          emptyText={
            <EmptyState
              title="Öğrenci sonucu yok"
              description="Bu snapshot içinde öğrenci sonucu veya katılımcı kaydı bulunamadı."
            />
          }
          getRowKey={(row) => row.rowKey}
          loading={loading}
          rowClassName={(row) => (row.studentId === selectedStudentId ? "next-report-row--selected" : undefined)}
          rows={tableRows}
        />
      </div>
    </section>
  );
}

function StudentReportCard({
  report,
  progress,
  errorBooklet,
  outputStatusLabel,
  scoreType,
}: {
  report: ReportStudentSnapshot | null;
  progress: ReportStudentProgress | null;
  errorBooklet: ReportErrorBooklet | null;
  outputStatusLabel: string;
  scoreType: ReportScoreType | undefined;
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
      report={report}
      reportLabel="Öğrenci Karne Özeti"
      scoreType={scoreType}
      sheetClassName="next-report-karne-sheet next-karne-sheet next-karne-sheet--workspace"
      showEmptyOutcomes
      showProgressHistory
      summaryExtra={`Gelişim ${formatKarneTrend(progress)}`}
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

function reportScoreTypeOptions(
  exam: ExamRecord | undefined,
  snapshot: ReportSnapshotRecord | null,
  report: ReportStudentSnapshot | null,
): ReportScoreType[] {
  const examType = snapshot?.snapshotData?.examType ?? report?.examType ?? exam?.examType;
  const expected: ReportScoreType[] = examType === "LGS"
    ? ["LGS"]
    : examType === "TYT"
      ? ["TYT"]
      : examType === "AYT"
        ? ["SAY", "EA", "SOZ"]
        : [];
  const available = report?.scoreViews?.map((view) => view.type) ?? [];
  return [...new Set([...expected, ...available])];
}

function legacyScore(total: { estimatedRawScore?: number; standardScore?: number; rawScore?: number } | undefined) {
  return total?.estimatedRawScore ?? total?.standardScore ?? total?.rawScore;
}

function PracticeScoreWarning() {
  return (
    <Alert tone="warning" title="Deneme puanı uyarısı">
      Standart sapma kullanılmadan hesaplanan deneme puanıdır. Resmî MEB/ÖSYM sınav puanı değildir.
    </Alert>
  );
}

function readRowScore(row: ReportAnalysisRow): number | undefined {
  return row.practiceScore ?? row.estimatedRawScore ?? row.standardScore ?? row.rawScore;
}

function reportScoreColumns(rows: ReportAnalysisRow[]): ReportScoreType[] {
  const available = new Set(rows.flatMap((row) => row.scoreViews?.map((view) => view.type) ?? []));
  return (["LGS", "TYT", "SAY", "EA", "SOZ"] as const).filter((type) => available.has(type));
}

function scoreTypeLabel(type: ReportScoreType): string {
  if (type === "SAY") return "Sayısal";
  if (type === "SOZ") return "Sözel";
  return type;
}

function formatScoreCourseSummary(row: ReportAnalysisRow, type: ReportScoreType): string {
  const branches = row.branches
    ?.filter((branch) => reportCourseMatchesScoreType(type, branch.branch))
    .sort((left, right) => reportCourseSortOrder(type, left.branch) - reportCourseSortOrder(type, right.branch));

  return branches?.length
    ? branches.map((branch) => `${reportCourseShortName(branch.branch)} ${formatNetNumber(branch.net)}`).join(" · ")
    : "Net: -";
}

function formatRank(rank: ReportAnalysisRow["generalRank"]): string {
  return rank ? `${rank.rank}/${rank.outOf}` : "-";
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
