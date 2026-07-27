"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { DataTable, Field, InfoGrid, InfoItem, Panel, Select, StatusBadge, TabButton, Tabs, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import type { CampusRecord, ClassRecord, ExamRecord, GradeLevelRecord, ReportSnapshotRecord, StudentRecord } from "@o-okul/shared-types";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { ApiRequestError, apiBaseUrl, apiListRequest, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import { formatCourseName, formatOutcomeCode } from "../../_shared/academic-labels.js";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";

interface ClassDetailData {
  campusName?: string;
  gradeLevelName?: string;
  record: ClassRecord;
  students: StudentRecord[];
}

type ClassDetailSection = "overview" | "reports" | "students";

export function ClassDetailPage({ classId }: { classId: string }) {
  const { auth } = useAuth();
  const [activeSection, setActiveSection] = useState<ClassDetailSection>("overview");
  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");
  const detailQuery = useQuery({
    queryKey: ["next-class-detail", auth?.session.tenantId ?? "anonymous", classId],
    queryFn: () => loadClassDetail(auth?.accessToken ?? "", classId),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });
  const detail = detailQuery.data;
  const examsQuery = useQuery({
    queryKey: ["next-class-detail-exams", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => apiRequestOrNull<ExamRecord[]>(auth?.accessToken ?? "", `${apiBaseUrl}/exams`),
    enabled: Boolean(auth && activeSection === "reports"),
    refetchOnWindowFocus: false,
  });
  const exams = examsQuery.data ?? [];
  const reportQuery = useQuery({
    queryKey: ["next-class-detail-report", auth?.session.tenantId ?? "anonymous", classId, selectedExamId, selectedSnapshotId || "auto"],
    queryFn: () => loadClassReport(auth?.accessToken ?? "", classId, selectedExamId, selectedSnapshotId),
    enabled: Boolean(auth && activeSection === "reports" && selectedExamId),
    refetchOnWindowFocus: false,
  });
  const selectedSnapshot = reportQuery.data?.selectedSnapshot ?? null;
  const reportSnapshots = reportQuery.data?.snapshots ?? [];
  const selectedExam = exams.find((exam) => exam.id === selectedExamId) ?? null;
  const classReport = toClassReport(selectedSnapshot, classId);
  const studentNameById = new Map((detail?.students ?? []).map((student) => [student.id, `${student.firstName} ${student.lastName}`]));
  const classStudentResults = toClassStudentResults(selectedSnapshot, classId);
  const classOutcomeRows = toClassOutcomeRows(selectedSnapshot, classId);
  const reportState = resolveClassReportState(reportQuery.isPending, reportQuery.isError, Boolean(selectedExamId), selectedSnapshot);
  const classDetailSummaryItems = detail ? buildClassSummaryItems(detail, classReport) : [];
  const classDetailSummaryBadges = detail ? buildClassSummaryBadges(detail, reportState) : [];
  const classDetailSummaryActions = detail
    ? buildClassSummaryActions(detail, classStudentResults, classOutcomeRows, selectedExam, selectedSnapshot, reportState)
    : [];

  const studentColumns: Array<DataTableColumn<StudentRecord>> = [
    {
      key: "name",
      header: "Öğrenci",
      mobilePriority: "primary",
      priority: "primary",
      sticky: "left",
      render: (student) => (
        <Link href={`/kurum/ogrenciler/${encodeURIComponent(student.id)}`}>
          {student.firstName} {student.lastName}
        </Link>
      ),
    },
    {
      key: "studentNo",
      header: "No",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (student) => student.studentNo ?? "-",
    },
    {
      key: "status",
      header: "Durum",
      mobilePriority: "primary",
      priority: "primary",
      render: (student) => <StatusBadge tone={studentStatusTone(student.status)}>{formatStudentStatus(student.status)}</StatusBadge>,
    },
  ];

  const resultColumns: Array<DataTableColumn<ClassStudentResultRow>> = [
    {
      key: "student",
      header: "Öğrenci",
      mobilePriority: "primary",
      priority: "primary",
      sticky: "left",
      render: (student) => (
        <span>
          {student.displayName ?? studentNameLabel(student.studentId, studentNameById)}
          {student.studentNo ? <small> #{student.studentNo}</small> : null}
        </span>
      ),
    },
    {
      key: "successRate",
      header: "Başarı %",
      align: "right",
      mobilePriority: "primary",
      priority: "primary",
      render: (student) => formatPercentNumber(student.successRate),
    },
    {
      key: "net",
      header: "Net",
      align: "right",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (student) => formatNumber(student.net),
    },
    {
      key: "questionCount",
      header: "Soru",
      align: "right",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (student) => formatNumber(student.questionCount),
    },
  ];

  const outcomeColumns: Array<DataTableColumn<ClassOutcomeRow>> = [
    {
      key: "outcome",
      header: "Kazanım",
      mobilePriority: "primary",
      priority: "primary",
      sticky: "left",
      render: (outcome) => `${formatCourseName(outcome.branch)} / ${formatOutcomeCode(outcome.outcomeCode)}`,
    },
    {
      key: "successRate",
      header: "Başarı %",
      align: "right",
      mobilePriority: "primary",
      priority: "primary",
      render: (outcome) => formatPercentNumber(outcome.successRate),
    },
    {
      key: "net",
      header: "Net",
      align: "right",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (outcome) => formatNumber(outcome.net),
    },
    {
      key: "questionCount",
      header: "Soru",
      align: "right",
      mobilePriority: "secondary",
      priority: "secondary",
      render: (outcome) => formatNumber(outcome.questionCount),
    },
  ];

  useEffect(() => {
    if (exams.length === 0 || exams.some((exam) => exam.id === selectedExamId)) return;
    setSelectedExamId(exams[0]?.id ?? "");
    setSelectedSnapshotId("");
  }, [exams, selectedExamId]);

  return (
    <PageFrame
      title={detail?.record.name ?? "Sınıf detayı"}
      subtitle="Sınıf detayı"
      actions={
        <Link className="uh-button uh-button--secondary" href="/kurum/siniflar">
          <ArrowLeft size={17} aria-hidden="true" />
          Sınıflara dön
        </Link>
      }
    >
      <section className="next-detail-workspace" aria-label="Sınıf detayı">
        {detailQuery.isPending ? <p>Yükleniyor...</p> : null}
        {detailQuery.isError ? <p className="uh-crud-page__error">Sınıf detayı alınamadı.</p> : null}
        {detail ? (
          <>
            <OperationSummary
              actions={classDetailSummaryActions}
              ariaLabel="Sınıf detay operasyon özeti"
              badges={classDetailSummaryBadges}
              items={classDetailSummaryItems}
            />
            <Tabs label="Sınıf detay bölümleri">
              <TabButton aria-controls="class-detail-panel-overview" id="class-detail-tab-overview" selected={activeSection === "overview"} onClick={() => setActiveSection("overview")}>Genel</TabButton>
              <TabButton aria-controls="class-detail-panel-students" id="class-detail-tab-students" selected={activeSection === "students"} onClick={() => setActiveSection("students")}>Öğrenciler</TabButton>
              <TabButton aria-controls="class-detail-panel-reports" id="class-detail-tab-reports" selected={activeSection === "reports"} onClick={() => setActiveSection("reports")}>Raporlar</TabButton>
            </Tabs>
            <div
              aria-labelledby={`class-detail-tab-${activeSection}`}
              id={`class-detail-panel-${activeSection}`}
              role="tabpanel"
              tabIndex={0}
            >
            {activeSection === "overview" ? <Panel
              aria-label="Sınıf profil kartı"
              description="Kampüs, seviye ve şube bağlamı ham kayıt anahtarı göstermeden okunur."
              title="Sınıf profili"
            >
              <InfoGrid className="next-class-profile-info" aria-label="Sınıf profil özeti" role="region">
                <InfoItem label="Seviye" value={gradeLevelLabel(detail)} />
                <InfoItem label="Şube" value={detail.record.section ?? "Şube yok"} />
                <InfoItem label="Kampüs" value={campusLabel(detail)} />
                <InfoItem label="Öğrenci kapsamı" value={`${formatCount(detail.students.length)} öğrenci`} />
              </InfoGrid>
            </Panel> : null}
            {activeSection === "reports" ? <Panel
              actions={<StatusBadge tone={reportState.tone}>{reportState.label}</StatusBadge>}
              aria-label="Sınıf rapor bağlamı"
              description="Sınav ve hazır snapshot seçimi sınıf sonuçlarını, başarı yüzdesini ve kazanım kırılımını besler."
              title="Rapor bağlamı"
            >
              <div className="next-detail-selects">
                <Field label="Sınav">
                  <Select
                    aria-label="Sınav"
                    value={selectedExamId}
                    onChange={(event) => {
                      setSelectedExamId(event.target.value);
                      setSelectedSnapshotId("");
                    }}
                  >
                    {exams.length === 0 ? <option value="">Sınav yok</option> : null}
                    {exams.map((exam) => (
                      <option key={exam.id} value={exam.id}>
                        {exam.title}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Rapor">
                  <Select
                    aria-label="Sınıf sınav raporu"
                    disabled={reportSnapshots.length === 0 || reportQuery.isError}
                    value={selectedSnapshot?.id ?? ""}
                    onChange={(event) => setSelectedSnapshotId(event.target.value)}
                  >
                    {reportSnapshots.length === 0 ? <option value="">Hazır rapor yok</option> : null}
                    {reportSnapshots.map((snapshot) => (
                      <option key={snapshot.id} value={snapshot.id}>
                        {formatSnapshotLabel(snapshot)}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <InfoGrid className="next-class-report-context" aria-label="Sınıf rapor bağlam özeti" role="region">
                <InfoItem label="Sınav" value={selectedExam?.title ?? "Sınav seçilmedi"} />
                <InfoItem label="Rapor tarihi" value={selectedSnapshot ? formatSnapshotLabel(selectedSnapshot) : "Hazır rapor yok"} />
                <InfoItem label="Başarı %" value={formatPercentNumber(reportSuccessRate(classReport?.averages))} />
                <InfoItem label="Soru" value={formatNumber(reportQuestionCount(classReport?.averages))} />
              </InfoGrid>
            </Panel> : null}
            {activeSection === "students" ? <Panel
              aria-label="Sınıf öğrencileri"
              description="Öğrenci adı, okul numarası ve aktif kayıt durumu yoğun tablo düzeninde izlenir."
              title="Öğrenciler"
            >
              <DataTable
                caption="Sınıf öğrenci listesi"
                columns={studentColumns}
                density="compact"
                description="Öğrenci adı, okul numarası ve aktif kayıt durumu."
                emptyText="Öğrenci yok"
                getRowKey={(student) => student.id}
                rows={detail.students}
              />
            </Panel> : null}
            {activeSection === "reports" ? <Panel
              aria-label="Sınıf sınav sonuçları"
              description="Başarı yüzdesi ana karşılaştırma metriğidir; net, soru ve puanlar bağlam olarak gösterilir."
              title="Sınav sonuçları"
            >
              <DataTable
                caption="Sınıf sınav sonucu karşılaştırması"
                columns={resultColumns}
                density="compact"
                description="Başarı yüzdesi ana karşılaştırma metriğidir; net, soru ve puanlar bağlam olarak gösterilir."
                emptyText={reportQuery.isError ? "Sınav sonucu alınamadı" : "Hazır sınav sonucu yok"}
                error={reportQuery.isError ? "Sınav sonucu alınamadı" : undefined}
                getRowKey={(student) => student.studentId}
                loading={reportQuery.isPending}
                rows={classStudentResults}
              />
            </Panel> : null}
            {activeSection === "reports" ? <Panel
              aria-label="Sınıf kazanım kırılımı"
              description="Kazanımlar başarı yüzdesine göre sıralanır; net ve soru sayısı bağlam olarak kalır."
              title="Kazanım kırılımı"
            >
              <DataTable
                caption="Sınıf kazanım kırılımı"
                columns={outcomeColumns}
                density="compact"
                description="Kazanımlar başarı yüzdesine göre sıralanır; net ve soru sayısı bağlam olarak kalır."
                emptyText={reportQuery.isError ? "Kazanım verisi alınamadı" : "Kazanım verisi yok"}
                error={reportQuery.isError ? "Kazanım verisi alınamadı" : undefined}
                getRowKey={(outcome) => `${outcome.branch}-${outcome.outcomeCode}`}
                loading={reportQuery.isPending}
                rows={classOutcomeRows}
              />
            </Panel> : null}
            </div>
          </>
        ) : null}
      </section>
    </PageFrame>
  );
}

async function loadClassDetail(accessToken: string, classId: string) {
  const record = await apiRequestOrNull<ClassRecord>(accessToken, `${apiBaseUrl}/classes/${encodeURIComponent(classId)}`);
  if (!record) return null;
  const [campuses, gradeLevels, students] = await Promise.all([
    apiListRequest<CampusRecord>(accessToken, `${apiBaseUrl}/campuses`),
    apiListRequest<GradeLevelRecord>(accessToken, `${apiBaseUrl}/grade-levels`),
    apiListRequest<StudentRecord>(accessToken, `${apiBaseUrl}/students?classId=${encodeURIComponent(classId)}`),
  ]);

  return {
    campusName: campuses.data.find((campus) => campus.id === record.campusId)?.name,
    gradeLevelName: gradeLevels.data.find((gradeLevel) => gradeLevel.id === record.gradeLevelId)?.name,
    record,
    students: students.data,
  };
}

async function loadClassReport(accessToken: string, classId: string, examId: string, selectedSnapshotId: string) {
  const snapshots = await apiRequestOrNull<ReportSnapshotRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots?classId=${encodeURIComponent(classId)}`,
  ) ?? [];
  const readySnapshots = snapshots.filter((snapshot) => snapshot.status === "READY");
  return {
    snapshots: readySnapshots,
    selectedSnapshot: readySnapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? readySnapshots[0] ?? null,
  };
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL): Promise<T | null> {
  try {
    return await apiRequest<T>(accessToken, input);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

function toClassReport(snapshot: ReportSnapshotRecord | null, classId: string) {
  return snapshot?.snapshotData?.classes?.find((record) => record.classId === classId) ?? null;
}

function buildClassSummaryItems(detail: ClassDetailData, classReport: ReturnType<typeof toClassReport>): OperationSummaryItem[] {
  const activeStudentCount = countStudentsByStatus(detail.students, "ACTIVE");
  const successRate = reportSuccessRate(classReport?.averages);
  return [
    {
      description: `${formatCount(activeStudentCount)} aktif kayıt`,
      key: "students",
      label: "Öğrenci toplamı",
      value: formatCount(detail.students.length),
    },
    {
      description: campusLabel(detail),
      key: "grade",
      label: "Seviye / şube",
      tone: detail.gradeLevelName ? "info" : "warning",
      value: `${gradeLevelLabel(detail)} / ${detail.record.section ?? "Şube yok"}`,
    },
    {
      description: "Ana karşılaştırma metriği",
      key: "success-rate",
      label: "Başarı %",
      tone: successRate === undefined ? "default" : "success",
      value: formatPercentNumber(successRate),
    },
    {
      description: `Net ${formatNumber(classReport?.averages.net)}`,
      key: "question-count",
      label: "Soru",
      value: formatNumber(reportQuestionCount(classReport?.averages)),
    },
  ];
}

function buildClassSummaryBadges(detail: ClassDetailData, reportState: ClassReportState): OperationSummaryBadge[] {
  return [
    {
      key: "report",
      label: reportState.label,
      tone: reportState.tone,
    },
    {
      key: "campus",
      label: detail.campusName ? "Kampüs eşleşti" : detail.record.campusId ? "Kampüs eşleşmedi" : "Kampüs atanmadı",
      tone: detail.campusName ? "success" : detail.record.campusId ? "warning" : "neutral",
    },
    {
      key: "grade",
      label: detail.gradeLevelName ? "Seviye eşleşti" : detail.record.gradeLevelId ? "Seviye eşleşmedi" : "Seviye atanmadı",
      tone: detail.gradeLevelName ? "success" : detail.record.gradeLevelId ? "warning" : "neutral",
    },
  ];
}

function buildClassSummaryActions(
  detail: ClassDetailData,
  classStudentResults: ClassStudentResultRow[],
  classOutcomeRows: ClassOutcomeRow[],
  selectedExam: ExamRecord | null,
  selectedSnapshot: ReportSnapshotRecord | null,
  reportState: ClassReportState,
): OperationSummaryAction[] {
  const activeStudentCount = countStudentsByStatus(detail.students, "ACTIVE");
  return [
    {
      detail: selectedSnapshot ? `${formatSnapshotLabel(selectedSnapshot)} üretildi` : "Sınav seçildiğinde hazır rapor izlenir",
      key: "report-context",
      label: "Rapor bağlamı",
      status: reportState.label,
      tone: reportState.tone,
      value: selectedExam?.title ?? "Sınav seçilmedi",
    },
    {
      detail: "Sınıf listesi ve rapordaki öğrenci sonuçları birlikte okunur",
      key: "student-scope",
      label: "Öğrenci kapsamı",
      status: classStudentResults.length > 0 ? "Sonuç var" : "Liste",
      tone: detail.students.length > 0 ? "info" : "neutral",
      value: `${formatCount(activeStudentCount)} aktif / ${formatCount(detail.students.length)} toplam`,
    },
    {
      detail: "Başarı yüzdesine göre ilk kazanım kırılımları",
      key: "outcomes",
      label: "Kazanım takibi",
      status: classOutcomeRows.length > 0 ? "İzleniyor" : "Veri yok",
      tone: classOutcomeRows.length > 0 ? "success" : "neutral",
      value: `${formatCount(classOutcomeRows.length)} kazanım`,
    },
  ];
}

interface ClassStudentResultRow {
  displayName?: string;
  net?: number;
  questionCount?: number;
  studentId: string;
  studentNo?: string;
  successRate?: number;
}

function toClassStudentResults(snapshot: ReportSnapshotRecord | null, classId: string) {
  return (snapshot?.snapshotData?.students ?? [])
    .filter((student) => student.classId === classId)
    .map((student) => ({
      displayName: student.displayName,
      net: student.total?.net,
      questionCount: reportQuestionCount(student.total),
      studentId: student.studentId,
      studentNo: student.studentNo,
      successRate: reportSuccessRate(student.total),
    })) satisfies ClassStudentResultRow[];
}

interface ClassOutcomeRow {
  branch: string;
  net?: number;
  outcomeCode: string;
  questionCount?: number;
  successRate?: number;
}

function toClassOutcomeRows(snapshot: ReportSnapshotRecord | null, classId: string) {
  const totals = new Map<string, {
    branch: string;
    count: number;
    net: number;
    outcomeCode: string;
    questionCount: number;
    successRate: number;
  }>();
  for (const student of snapshot?.snapshotData?.students ?? []) {
    if (student.classId !== classId) continue;
    for (const outcome of student.outcomes ?? []) {
      const key = `${outcome.branch}:${outcome.outcomeCode}`;
      const current = totals.get(key) ?? {
        branch: outcome.branch,
        count: 0,
        net: 0,
        outcomeCode: outcome.outcomeCode,
        questionCount: 0,
        successRate: 0,
      };
      current.net += outcome.net ?? 0;
      current.questionCount += reportQuestionCount(outcome) ?? 0;
      current.successRate += reportSuccessRate(outcome) ?? 0;
      current.count += 1;
      totals.set(key, current);
    }
  }
  return [...totals.values()]
    .map((item) => ({
      branch: item.branch,
      net: item.count ? item.net / item.count : undefined,
      outcomeCode: item.outcomeCode,
      questionCount: item.count ? item.questionCount / item.count : undefined,
      successRate: item.count ? item.successRate / item.count : undefined,
    }))
    .sort((first, second) => (second.successRate ?? -1) - (first.successRate ?? -1))
    .slice(0, 12) satisfies ClassOutcomeRow[];
}

function formatSnapshotLabel(snapshot: ReportSnapshotRecord) {
  const date = snapshot.generatedAt ?? snapshot.snapshotData?.generatedAt ?? snapshot.createdAt;
  return formatDateLabel(date) ?? "Rapor tarihi yok";
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function formatStudentStatus(status: StudentRecord["status"]) {
  const labels: Record<StudentRecord["status"], string> = {
    ACTIVE: "Aktif",
    GRADUATED: "Mezun",
    PASSIVE: "Pasif",
    TRANSFERRED: "Nakil",
  };
  return labels[status] ?? "Durum bilinmiyor";
}

function studentStatusTone(status: StudentRecord["status"]): StatusBadgeProps["tone"] {
  if (status === "ACTIVE") return "success";
  if (status === "GRADUATED") return "info";
  if (status === "TRANSFERRED") return "warning";
  return "neutral";
}

interface ClassReportState {
  label: string;
  tone: StatusBadgeProps["tone"];
}

function resolveClassReportState(
  isPending: boolean,
  isError: boolean,
  hasSelectedExam: boolean,
  selectedSnapshot: ReportSnapshotRecord | null,
): ClassReportState {
  if (!hasSelectedExam) return { label: "Sınav seçimi bekliyor", tone: "neutral" };
  if (isPending) return { label: "Rapor yükleniyor", tone: "info" };
  if (isError) return { label: "Rapor alınamadı", tone: "danger" };
  if (selectedSnapshot) return { label: "Rapor hazır", tone: "success" };
  return { label: "Hazır rapor yok", tone: "warning" };
}

function countStudentsByStatus(students: StudentRecord[], status: StudentRecord["status"]) {
  return students.filter((student) => student.status === status).length;
}

function gradeLevelLabel(detail: ClassDetailData) {
  return detail.gradeLevelName ?? "Seviye eşleşmedi";
}

function campusLabel(detail: ClassDetailData) {
  return detail.campusName ?? (detail.record.campusId ? "Kampüs eşleşmedi" : "Kampüs atanmadı");
}

function studentNameLabel(studentId: string, studentNameById: ReadonlyMap<string, string>) {
  return studentNameById.get(studentId) ?? "Öğrenci";
}

function formatDateLabel(value: string | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return new Intl.DateTimeFormat("tr-TR").format(date);
}
