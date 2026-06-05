"use client";

import { type FormEvent, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Button,
  EmptyState,
  Input,
} from "@uzman-hocam/ui";
import type {
  AcademicTermRecord,
  CampusRecord,
  ClassRecord,
  CourseRecord,
  ExamRecord,
  GradeLevelRecord,
  ReportErrorBooklet,
  ReportSnapshotExportResult,
  ReportSnapshotRecord,
  ReportStudentProgress,
  ReportStudentSnapshot,
} from "@uzman-hocam/shared-types";
import { Download, RefreshCw } from "lucide-react";
import { KarneSheet } from "../../_shared/karne-sheet.js";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiErrorMessage, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { firstFormError, reportQueryFormSchema } from "../../../../src/form-validation.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";
import { ClassCompareBar, ExamResultDonut, ProgressLineChart, TopicRadarChart } from "../../_shared/lazy-report-charts.js";
import { ReportChartPanel } from "../../_shared/report-chart-panel.js";

interface ReportData {
  snapshots: ReportSnapshotRecord[];
  studentReport: ReportStudentSnapshot | null;
  studentProgress: ReportStudentProgress | null;
  errorBooklet: ReportErrorBooklet | null;
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

export function ReportsPage() {
  const { auth } = useAuth();
  const [examId, setExamId] = useState("");
  const [loadedExamId, setLoadedExamId] = useState("");
  const [contentHash, setContentHash] = useState("results-v1");
  const [filters, setFilters] = useState(emptyFilters);
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [error, setError] = useState("");
  const [queueMessage, setQueueMessage] = useState("");
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
  const classNameById = new Map(classes.map((klass) => [klass.id, klass.name]));
  const campusNameById = new Map(campuses.map((campus) => [campus.id, campus.name]));
  const gradeLevelNameById = new Map(gradeLevels.map((level) => [level.id, level.name]));
  const courseNameById = new Map(courses.map((course) => [course.id, course.name]));
  const termNameById = new Map(terms.map((term) => [term.id, term.name]));
  const latestSnapshot = reportData?.snapshots[0] ?? null;
  const studentReport = reportData?.studentReport ?? null;
  const branchRadar = toBranchRadar(latestSnapshot);
  const outcomeBars = toOutcomeBars(latestSnapshot);
  const classBars = toClassBars(latestSnapshot);
  const examResult = toExamResult(latestSnapshot);
  const progressPoints = toProgressPoints(reportData?.studentProgress ?? null);

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
      setReportData(await loadReportData(auth.accessToken, parsedForm.data.examId, filters));
      setLoadedExamId(parsedForm.data.examId);
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
      const result = await enqueueReportGenerationJob(auth.accessToken, parsedForm.data.examId, {
        ...filters,
        contentHash: normalizedContentHash,
      });
      setQueueMessage(`${result.jobId} kuyruğa alındı.`);
    } catch (queueError) {
      setError(apiErrorMessage(queueError, "Rapor üretimi kuyruğa alınamadı."));
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
      <form className="next-support-tool" onSubmit={(event) => void loadReports(event)}>
        <h2>Rapor sorgusu</h2>
        <label>
          Rapor sınav ID
          <Input
            list="report-exam-options"
            required
            value={examId}
            onChange={(event) => setExamId(event.target.value)}
          />
          <datalist id="report-exam-options">
            {exams.map((exam) => (
              <option key={exam.id} value={exam.id}>{exam.title}</option>
            ))}
          </datalist>
        </label>
        <label>
          Sonuç anahtarı
          <Input required value={contentHash} onChange={(event) => setContentHash(event.target.value)} />
        </label>
        <div className="next-list-controls" aria-label="Rapor filtreleri">
          <label>
            Kampüs
            <select
              value={filters.campusId}
              onChange={(event) => setFilters((current) => ({ ...current, campusId: event.target.value }))}
            >
              <option value="">Tümü</option>
              {campuses.map((campus) => (
                <option key={campus.id} value={campus.id}>{campus.name}</option>
              ))}
            </select>
          </label>
          <label>
            Seviye
            <select
              value={filters.gradeLevelId}
              onChange={(event) => setFilters((current) => ({ ...current, gradeLevelId: event.target.value }))}
            >
              <option value="">Tümü</option>
              {gradeLevels.map((level) => (
                <option key={level.id} value={level.id}>{level.name}</option>
              ))}
            </select>
          </label>
          <label>
            Sınıf
            <select
              value={filters.classId}
              onChange={(event) => setFilters((current) => ({ ...current, classId: event.target.value }))}
            >
              <option value="">Tümü</option>
              {classes.map((klass) => (
                <option key={klass.id} value={klass.id}>{klass.name}</option>
              ))}
            </select>
          </label>
          <label>
            Ders
            <select
              value={filters.courseId}
              onChange={(event) => setFilters((current) => ({ ...current, courseId: event.target.value }))}
            >
              <option value="">Tümü</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>{course.name}</option>
              ))}
            </select>
          </label>
          <label>
            Dönem
            <select
              value={filters.termId}
              onChange={(event) => setFilters((current) => ({ ...current, termId: event.target.value }))}
            >
              <option value="">Tümü</option>
              {terms.map((term) => (
                <option key={term.id} value={term.id}>{term.name}</option>
              ))}
            </select>
          </label>
        </div>
        {error ? <p className="uh-crud-page__error">{error}</p> : null}
        {queueMessage ? <p className="uh-crud-page__success">{queueMessage}</p> : null}
        <Button type="submit">
          <RefreshCw size={17} aria-hidden="true" />
          Raporu getir
        </Button>
        <Button type="button" variant="secondary" onClick={() => void enqueueReportGeneration()}>
          <RefreshCw size={17} aria-hidden="true" />
          Rapor üret
        </Button>
      </form>
      <section className="next-report-panel" aria-label="Rapor özeti">
            <h2>Rapor Özeti</h2>
            {latestSnapshot ? (
              <>
            <MetricPanelGrid
              ariaLabel="Rapor özeti"
              metrics={[
                { label: "Durum", value: latestSnapshot.status },
                { label: "Sonuç", value: latestSnapshot.snapshotData?.resultCount ?? "-" },
                { label: "Ortalama net", value: formatNumber(latestSnapshot.snapshotData?.averages?.net) },
                { label: "Standart puan", value: formatNumber(latestSnapshot.snapshotData?.averages?.standardScore) },
                {
                  label: "Bağlam",
                  value: formatReportContext(latestSnapshot, {
                    campusNameById,
                    classNameById,
                    courseNameById,
                    gradeLevelNameById,
                    termNameById,
                  }),
                },
              ]}
            />
            <div className="next-report-visual-grid">
              <ReportChartPanel description="Soru bazlı doğruluk dağılımı" title="Sınav Sonuç Dağılımı">
                <ExamResultDonut result={examResult} />
              </ReportChartPanel>
              <ReportChartPanel description="Branş ortalaması" title="Branş Netleri">
                <TopicRadarChart branches={branchRadar} />
              </ReportChartPanel>
              <ReportChartPanel description="Kazanım bazlı net karşılaştırması" title="Kazanım Netleri">
                <ClassCompareBar classes={outcomeBars} />
              </ReportChartPanel>
              <ReportChartPanel description="Sınıf ortalama netleri" title="Sınıf Karşılaştırması">
                <ClassCompareBar classes={classBars} />
              </ReportChartPanel>
              <ReportChartPanel description="Net ve standart puan gelişimi" title="Öğrenci Gelişim Eğrisi">
                <ProgressLineChart points={progressPoints} />
              </ReportChartPanel>
            </div>
            <StudentReportCard
              report={studentReport}
              progress={reportData?.studentProgress ?? null}
              errorBooklet={reportData?.errorBooklet ?? null}
            />
            {reportData?.errorBooklet ? (
              <section className="next-report-list" aria-label="Hata kitapçığı">
                <h3>Hata kitapçığı</h3>
                <p>{reportData.errorBooklet.items.length} soru</p>
                {reportData.errorBooklet.items.map((item) => (
                  <p key={`${item.questionNo}-${item.status}`}>
                    {item.questionNo}. soru {item.status === "BLANK" ? "Boş" : `Yanıt ${item.answer}`} Doğru {item.correctAnswer}
                  </p>
                ))}
              </section>
            ) : null}
            <div className="next-report-actions">
              <Button onClick={() => void exportReport("xlsx")}>
                <Download size={17} aria-hidden="true" />
                Excel indir
              </Button>
              <Button onClick={() => void exportReport("pdf")}>
                <Download size={17} aria-hidden="true" />
                PDF indir
              </Button>
            </div>
          </>
        ) : (
          <EmptyState
            title="Hazır rapor yok"
            description="Sınav ID ile raporları getir veya rapor üretimini kuyruğa al."
          />
        )}
      </section>
    </PageFrame>
  );
}

async function loadReportData(accessToken: string, examId: string, filters: typeof emptyFilters): Promise<ReportData> {
  const snapshotsUrl = new URL(`${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots`);
  if (filters.campusId) snapshotsUrl.searchParams.set("campusId", filters.campusId);
  if (filters.gradeLevelId) snapshotsUrl.searchParams.set("gradeLevelId", filters.gradeLevelId);
  if (filters.classId) snapshotsUrl.searchParams.set("classId", filters.classId);
  if (filters.courseId) snapshotsUrl.searchParams.set("courseId", filters.courseId);
  if (filters.termId) snapshotsUrl.searchParams.set("termId", filters.termId);
  const snapshots = await apiRequest<ReportSnapshotRecord[]>(
    accessToken,
    snapshotsUrl.toString(),
  );
  const latestSnapshot = snapshots[0];
  const studentId = latestSnapshot?.snapshotData?.students?.[0]?.studentId;

  if (!latestSnapshot || !studentId) {
    return { snapshots, studentReport: null, studentProgress: null, errorBooklet: null };
  }

  const [studentReport, studentProgress, errorBooklet] = await Promise.all([
    apiRequest<ReportStudentSnapshot>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(latestSnapshot.id)}/students/${encodeURIComponent(studentId)}`,
    ).catch(() => null),
    apiRequest<ReportStudentProgress>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/progress`,
    ).catch(() => null),
    apiRequest<ReportErrorBooklet>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(latestSnapshot.id)}/students/${encodeURIComponent(studentId)}/error-booklet`,
    ).catch(() => null),
  ]);

  return { snapshots, studentReport, studentProgress, errorBooklet };
}

async function loadReportReferences(accessToken: string): Promise<ReportReferences> {
  const [campuses, classes, courses, exams, gradeLevels, terms] = await Promise.all([
    apiListRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses`),
    apiListRequest<ClassRecord>(accessToken, `${apiBaseUrl}/classes`),
    apiListRequest<CourseRecord>(accessToken, `${apiBaseUrl}/courses`),
    apiListRequest<ExamRecord>(accessToken, `${apiBaseUrl}/exams`),
    apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`),
    apiListRequest<AcademicTermRecord>(accessToken, `${apiBaseUrl}/academic-terms`),
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

function preferredExamId(exams: ExamRecord[]) {
  return exams.find((exam) => exam.status === "PUBLISHED")?.id ?? exams[0]?.id ?? "";
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

function formatTrend(progress: ReportStudentProgress | null | undefined) {
  if (!progress) return "-";
  const net = progress.netDelta === undefined ? "-" : `${progress.netDelta > 0 ? "+" : ""}${formatNumber(progress.netDelta)} net`;
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
    snapshot.campusId ? (maps.campusNameById.get(snapshot.campusId) ?? snapshot.campusId) : "",
    snapshot.gradeLevelId ? (maps.gradeLevelNameById.get(snapshot.gradeLevelId) ?? snapshot.gradeLevelId) : "",
    snapshot.classId ? (maps.classNameById.get(snapshot.classId) ?? snapshot.classId) : "",
    snapshot.courseId ? (maps.courseNameById.get(snapshot.courseId) ?? snapshot.courseId) : "",
    snapshot.termId ? (maps.termNameById.get(snapshot.termId) ?? snapshot.termId) : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "-";
}

function toBranchRadar(snapshot: ReportSnapshotRecord | null) {
  return (snapshot?.snapshotData?.branches ?? []).map((branch) => ({
    branch: branch.branch,
    net: branch.net,
    resultCount: branch.resultCount,
  }));
}

function toOutcomeBars(snapshot: ReportSnapshotRecord | null) {
  return [...(snapshot?.snapshotData?.outcomes ?? [])]
    .sort((first, second) => second.net - first.net)
    .slice(0, 12)
    .map((outcome) => ({
      className: `${outcome.branch} / ${outcome.outcomeCode}`,
      net: outcome.net,
    }));
}

function toClassBars(snapshot: ReportSnapshotRecord | null) {
  return (snapshot?.snapshotData?.classes ?? []).map((record) => ({
    classId: record.classId,
    className: record.className ?? "Sınıfsız",
    net: record.averages.net,
    standardScore: record.averages.standardScore,
  }));
}

function toExamResult(snapshot: ReportSnapshotRecord | null) {
  const averages = snapshot?.snapshotData?.averages;
  return {
    correct: averages?.correct ?? 0,
    wrong: averages?.wrong ?? 0,
    blank: averages?.blank ?? 0,
  };
}

function toProgressPoints(progress: ReportStudentProgress | null) {
  return progress?.points ?? [];
}

function StudentReportCard({
  report,
  progress,
  errorBooklet,
}: {
  report: ReportStudentSnapshot | null;
  progress: ReportStudentProgress | null;
  errorBooklet: ReportErrorBooklet | null;
}) {
  return (
    <KarneSheet
      ariaLabel="Öğrenci karne özeti"
      branchCaption="Öğrenci branş karne tablosu"
      emptyClassName="next-report-list"
      emptyTitle="Öğrenci Karne Özeti"
      emptyTitleLevel="h3"
      errorBooklet={errorBooklet}
      outcomeAriaLabel="Kazanım radar grafiği"
      outcomeCaption="Kazanım radar tablosu"
      outcomeHeadingLevel="h3"
      outcomeSectionClassName="next-report-list"
      progress={progress}
      rankFormat="simple"
      report={report}
      reportLabel="Öğrenci Karne Özeti"
      scoreGeneralLabel="SIRA"
      sheetClassName="next-report-list next-karne-sheet"
      showEmptyOutcomes
      summaryExtra={`Gelişim ${formatTrend(progress)}`}
      titleLevel="h3"
    />
  );
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
