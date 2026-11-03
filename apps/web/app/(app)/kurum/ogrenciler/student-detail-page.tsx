"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AcademicTermRecord,
  AttendanceSummaryRecord,
  ClassRecord,
  CourseRecord,
  ExamRecord,
  GuardianRecord,
  GuardianStudentRecord,
  HomeworkMaterialAssignmentRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportErrorBooklet,
  ReportStudentQuestionSummary,
  ReportSnapshotRecord,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentEnrollmentRecord,
  StudentAuditSummaryRecord,
  StudentContactGuardianLinkResult,
  StudentContactRecord,
  StudentOverviewLatestExamRecord,
  StudentOverviewRecord,
  StudentHomeworkRecord,
  StudentProfileRecord,
  TeacherAssignmentRecord,
  TeacherNoteRecord,
  TeacherRecord,
} from "@o-okul/shared-types";
import { ArrowLeft, BarChart3, KeyRound, LayoutDashboard, NotebookTabs, Pencil } from "lucide-react";
import { Alert, Button, DataTable, Field, InfoGrid, InfoItem, Input, Panel, Select, StatusBadge, TabButton, Tabs, type DataTableColumn, type StatusBadgeProps, useConfirmDialog } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { ApiRequestError, apiBaseUrl, apiRequest, withQueryParams } from "../../../../src/api-client.js";
import { isSmsEnabled } from "../../../../src/sms-feature.js";
import { PageFrame } from "../_shared/page-frame.js";
import { canAccessHref, hasCapabilityForRoles } from "../../_shared/access.js";
import { formatAttendanceSummary } from "../../_shared/attendance-summary.js";
import { formatCourseName, formatOutcomeCode, shortCourseName } from "../../_shared/academic-labels.js";
import { ErrorBookletTable } from "../../_shared/error-booklet-table.js";
import { ExamResultDonut, ProgressLineChart, TopicRadarChart } from "../../_shared/lazy-report-charts.js";
import { formatNetNumber, OutcomeNetTable, sortOutcomesWeakestFirst } from "../../_shared/outcome-net-table.js";
import { ReportChartPanel } from "../../_shared/report-chart-panel.js";
import { formatPercentNumber, formatStudentProgressSummary, isComparableStudentProgress, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";
import { readReportExamId } from "../../_shared/report-exam-selection.js";
import { GuardianLinkRetryAlert, isGuardianLinkConcurrentUpdate } from "../_shared/guardian-link-retry.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";
import { StudentFormModal } from "./student-form-modal.js";
import { StudentAttendanceCalendar, StudentTimelinePanel } from "./student-timeline.js";

interface StudentBaseDetail {
  attendanceSummary: AttendanceSummaryRecord | null;
  auditLogs: StudentAuditSummaryRecord[];
  classes: ClassRecord[];
  courses: CourseRecord[];
  contacts: StudentContactRecord[];
  guardianLinks: GuardianStudentRecord[];
  profile: StudentProfileRecord;
  guardians: GuardianRecord[];
  homeworkAssignments: HomeworkMaterialAssignmentRecord[];
  latestExam?: StudentOverviewLatestExamRecord;
  openHomeworkCount: number;
  paymentPlans: PaymentPlanWithInstallmentsRecord[];
  enrollments: StudentEnrollmentRecord[];
  teacherAssignments: TeacherAssignmentRecord[];
  teacherNoteCount: number;
  teachers: TeacherRecord[];
  teacherNotes: TeacherNoteRecord[];
  terms: AcademicTermRecord[];
}

interface StudentDetailPageData {
  detail: StudentBaseDetail;
  exams: ExamRecord[];
}

interface StudentReportData {
  errorBooklet: ReportErrorBooklet | null;
  progress: ReportStudentProgress | null;
  report: ReportStudentSnapshot | null;
  selectedSnapshot: ReportSnapshotRecord | null;
  snapshots: ReportSnapshotRecord[];
}

type StudentDetailMode = "dashboard" | "exams";

interface StudentDetailTableRow {
  detail?: ReactNode;
  id: string;
  meta?: string;
  primary: string;
  status?: string;
  tone?: StatusBadgeProps["tone"];
}

interface StudentDetailTableHeaders {
  detail?: string;
  meta?: string;
  primary: string;
  status?: string;
}

// Her tablo kendi sütun adlarını taşır; genel "Kayıt/Durum/Bağlam/Tarih" seti kullanılmaz.
function studentDetailTableColumns(headers: StudentDetailTableHeaders): Array<DataTableColumn<StudentDetailTableRow>> {
  const columns: Array<DataTableColumn<StudentDetailTableRow> | undefined> = [
    {
      key: "primary",
      header: headers.primary,
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => row.primary,
      sticky: "left",
    },
    headers.status ? {
      key: "status",
      header: headers.status,
      mobilePriority: "secondary",
      priority: "secondary",
      render: (row) => row.status ? <StatusBadge tone={row.tone ?? "info"}>{row.status}</StatusBadge> : "-",
    } : undefined,
    headers.detail ? {
      key: "detail",
      header: headers.detail,
      mobilePriority: "primary",
      priority: "primary",
      render: (row) => row.detail ?? "-",
    } : undefined,
    headers.meta ? {
      key: "meta",
      header: headers.meta,
      mobilePriority: "secondary",
      priority: "optional",
      render: (row) => row.meta ?? "-",
    } : undefined,
  ];
  return columns.filter((column): column is DataTableColumn<StudentDetailTableRow> => Boolean(column));
}

export function StudentDetailPage({ mode = "dashboard", studentId }: { mode?: StudentDetailMode; studentId: string }) {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const requestedReportExamId = readReportExamId(searchParams);
  const canViewFinance = hasCapabilityForRoles(auth?.session.roles ?? [], "finance:manage");
  const canManageStudent = hasCapabilityForRoles(auth?.session.roles ?? [], "student:manage");
  const canRevealPhone = hasCapabilityForRoles(auth?.session.roles ?? [], "privacy:manage");
  const [isEditOpen, setIsEditOpen] = useState(false);
  const canOpenNotes = canAccessHref(auth?.session.roles ?? [], "/kurum/notlar", auth?.session.activePersona);
  const canOpenPortalAccess = canAccessHref(auth?.session.roles ?? [], "/kurum/ogrenci-portal-erisimi", auth?.session.activePersona);
  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");

  const pageDataQuery = useQuery({
    queryKey: ["next-student-detail-page-data", auth?.session.tenantId ?? "anonymous", studentId, canViewFinance ? "finance" : "no-finance"],
    queryFn: () => loadStudentDetailPageData(auth?.accessToken ?? "", studentId, { canViewFinance }),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });

  const detail = pageDataQuery.data?.detail;
  const studentAuditLogs = useMemo(() => (detail?.auditLogs ?? []).slice(0, 5), [detail?.auditLogs]);
  const guardianNameById = useMemo(
    () => new Map((detail?.guardians ?? []).map((guardian) => [guardian.id, `${guardian.firstName} ${guardian.lastName}`])),
    [detail?.guardians],
  );
  const teacherNameById = useMemo(
    () => new Map((detail?.teachers ?? []).map((teacher) => [teacher.id, `${teacher.firstName} ${teacher.lastName}`])),
    [detail?.teachers],
  );
  const classNameById = useMemo(() => new Map((detail?.classes ?? []).map((record) => [record.id, record.name])), [detail?.classes]);
  const courseNameById = useMemo(() => new Map((detail?.courses ?? []).map((record) => [record.id, formatCourseName(record.name)])), [detail?.courses]);
  const termNameById = useMemo(() => new Map((detail?.terms ?? []).map((record) => [record.id, record.name])), [detail?.terms]);
  const latestExamId = detail?.latestExam?.examId;
  const exams = useMemo(() => sortExamsForStudent(pageDataQuery.data?.exams ?? [], latestExamId), [latestExamId, pageDataQuery.data?.exams]);
  const activeExamId = selectedExamId || preferredExamId(exams, requestedReportExamId, latestExamId);
  const reportDataQuery = useQuery({
    queryKey: [
      "next-student-detail-report-data",
      auth?.session.tenantId ?? "anonymous",
      mode,
      activeExamId,
      selectedSnapshotId || "auto",
      studentId,
    ],
    queryFn: () => loadStudentReportData(auth?.accessToken ?? "", activeExamId, selectedSnapshotId, studentId, mode),
    enabled: Boolean(auth && activeExamId),
    refetchOnWindowFocus: false,
  });
  const snapshots = reportDataQuery.data?.snapshots ?? [];
  const selectedSnapshot = reportDataQuery.data?.selectedSnapshot ?? null;
  const report = reportDataQuery.data?.report ?? null;
  const errorBooklet = reportDataQuery.data?.errorBooklet ?? null;
  const progress = reportDataQuery.data?.progress ?? null;
  const studentName = detail ? `${detail.profile.firstName} ${detail.profile.lastName}` : "Öğrenci 360";
  const examResult = toStudentExamResult(report);
  const branchRadar = toStudentBranchRadar(report);
  const outcomeRows = toStudentOutcomeRows(report);
  const progressPoints = toProgressPoints(progress);
  const studentDashboardHref = `/kurum/ogrenciler/${encodeURIComponent(studentId)}`;
  const studentExamsHref = `${studentDashboardHref}/sinavlar`;

  useEffect(() => {
    if (!selectedExamId || exams.some((exam) => exam.id === selectedExamId)) return;
    setSelectedExamId("");
    setSelectedSnapshotId("");
  }, [exams, selectedExamId]);

  return (
    <PageFrame
      title={studentName}
      subtitle={mode === "exams" ? "Sınav detayları" : "Öğrenci özeti"}
      actions={
        <div className="next-student-detail-actions">
          <Link className="uh-button uh-button--secondary" href="/kurum/ogrenciler">
            <ArrowLeft size={17} aria-hidden="true" />
            Öğrencilere dön
          </Link>
          {canManageStudent && detail ? (
            <Button onClick={() => setIsEditOpen(true)} type="button" variant="secondary">
              <Pencil size={17} aria-hidden="true" />
              Düzenle
            </Button>
          ) : null}
          {mode === "exams" ? (
            <Link className="uh-button uh-button--secondary" href={studentDashboardHref}>
              <LayoutDashboard size={17} aria-hidden="true" />
              Öğrenci özetine dön
            </Link>
          ) : (
            <Link className="uh-button" href={studentExamsHref}>
              <BarChart3 size={17} aria-hidden="true" />
              Sınav detayları
            </Link>
          )}
        </div>
      }
    >
      {pageDataQuery.isPending ? (
        <Panel
          aria-label={mode === "exams" ? "Öğrenci sınav detayları" : "Öğrenci özeti"}
          className="next-detail-state-panel"
          title={mode === "exams" ? "Öğrenci sınav detayları" : "Öğrenci özeti"}
        >
          <p>Yükleniyor...</p>
        </Panel>
      ) : pageDataQuery.isError ? (
        <Panel
          aria-label={mode === "exams" ? "Öğrenci sınav detayları" : "Öğrenci özeti"}
          className="next-detail-state-panel"
          title={mode === "exams" ? "Öğrenci sınav detayları" : "Öğrenci özeti"}
          tone="danger"
        >
          <p className="uh-crud-page__error">Öğrenci detayı alınamadı.</p>
        </Panel>
      ) : detail && mode === "exams" ? (
        <StudentExamDetails
          branchRadar={branchRadar}
          errorBooklet={errorBooklet}
          examResult={examResult}
          exams={exams}
          latestExamId={latestExamId}
          outcomeRows={outcomeRows}
          progress={progress}
          progressPoints={progressPoints}
          report={report}
          selectedExamId={activeExamId}
          selectedSnapshot={selectedSnapshot}
          snapshots={snapshots}
          studentId={studentId}
          onExamChange={(nextExamId) => {
            setSelectedExamId(nextExamId);
            setSelectedSnapshotId("");
          }}
          onSnapshotChange={setSelectedSnapshotId}
        />
      ) : detail ? (
        <StudentDashboard
          classNameById={classNameById}
          canManageStudent={canManageStudent}
          canOpenNotes={canOpenNotes}
          canOpenPortalAccess={canOpenPortalAccess}
          canViewFinance={canViewFinance}
          courseNameById={courseNameById}
          detail={detail}
          guardianNameById={guardianNameById}
          progress={progress}
          progressPoints={progressPoints}
          studentAuditLogs={studentAuditLogs}
          studentId={studentId}
          termNameById={termNameById}
          teacherNameById={teacherNameById}
        />
      ) : null}
      {canManageStudent && detail ? (
        <StudentFormModal
          canRevealPhone={canRevealPhone}
          detail={detail}
          detailLoading={pageDataQuery.isFetching}
          onClose={() => setIsEditOpen(false)}
          open={isEditOpen}
          student={detail.profile}
        />
      ) : null}
    </PageFrame>
  );
}

function StudentDashboard({
  classNameById,
  canManageStudent,
  canOpenNotes,
  canOpenPortalAccess,
  canViewFinance,
  courseNameById,
  detail,
  guardianNameById,
  progress,
  progressPoints,
  studentAuditLogs,
  studentId,
  teacherNameById,
  termNameById,
}: {
  classNameById: ReadonlyMap<string, string>;
  canManageStudent: boolean;
  canOpenNotes: boolean;
  canOpenPortalAccess: boolean;
  canViewFinance: boolean;
  courseNameById: ReadonlyMap<string, string>;
  detail: StudentBaseDetail;
  guardianNameById: ReadonlyMap<string, string>;
  progress: ReportStudentProgress | null;
  progressPoints: ReturnType<typeof toProgressPoints>;
  studentAuditLogs: StudentAuditSummaryRecord[];
  studentId: string;
  teacherNameById: ReadonlyMap<string, string>;
  termNameById: ReadonlyMap<string, string>;
}) {
  const { auth } = useAuth();
  const [activeSection, setActiveSection] = useState<"overview" | "records">("overview");
  // UAT U1 / DEC-20261103-01: "Açık ödev" ve Ödevler paneli sınıf ödevini de sayar. Zaman çizelgesiyle aynı sorgu
  // anahtarı tek isteği paylaşır; rol ödev okuyamıyorsa istek atılmaz ve yalnız materyal atamaları görünür.
  const canReadClassHomework = hasCapabilityForRoles(auth?.session.roles ?? [], "homework:read-assigned");
  const classHomeworkQuery = useQuery({
    queryKey: ["next-student-timeline-homework", auth?.session.tenantId ?? "anonymous", studentId],
    queryFn: () => apiRequest<StudentHomeworkRecord[]>(auth?.accessToken ?? "", `${apiBaseUrl}/homework/students/${encodeURIComponent(studentId)}`),
    enabled: Boolean(auth) && canReadClassHomework,
    refetchOnWindowFocus: false,
    // Kayıtlar sekmesi açılınca zaman çizelgesi aynı veriyi yeniden istemez.
    staleTime: 60_000,
  });
  const classHomework = classHomeworkQuery.data ?? [];
  const progressIsComparable = isComparableStudentProgress(progress);
  const currentClass = formatCurrentClass(detail.profile.classId, classNameById);
  const activeEnrollment = resolveActiveEnrollment(detail.enrollments);
  const studentDashboardSummaryItems = buildStudentDashboardSummaryItems(detail, classHomework);
  const studentDashboardSummaryBadges = buildStudentDashboardSummaryBadges(detail, canViewFinance);
  // Not ve portal ekranları henüz öğrenci ön seçimi almaz; not ekranı öğrencinin sınıfına süzülmüş açılır.
  const notesHref = detail.profile.classId ? `/kurum/notlar?classId=${encodeURIComponent(detail.profile.classId)}` : "/kurum/notlar";

  return (
    <section className="next-detail-workspace next-student-growth-workspace" aria-label="Öğrenci özeti">
      <OperationSummary
        ariaLabel="Öğrenci detay özeti"
        badges={studentDashboardSummaryBadges}
        items={studentDashboardSummaryItems}
      />
      <Panel
        actions={canOpenNotes || canOpenPortalAccess ? (
          <div className="next-student-detail-actions" aria-label="Öğrenci hızlı işlemleri" role="group">
            {canOpenNotes ? (
              <Link className="uh-button uh-button--secondary uh-button--sm" href={notesHref}>
                <NotebookTabs size={16} aria-hidden="true" />
                Öğretmen notları
              </Link>
            ) : null}
            {canOpenPortalAccess ? (
              <Link className="uh-button uh-button--secondary uh-button--sm" href="/kurum/ogrenci-portal-erisimi">
                <KeyRound size={16} aria-hidden="true" />
                Portal erişimi
              </Link>
            ) : null}
          </div>
        ) : undefined}
        aria-label="Öğrenci profil kartı"
        description={canManageStudent ? "Sınıfı, kayıt durumunu veya iletişim bilgilerini değiştirmek için üstteki Düzenle'yi kullanın." : undefined}
        title="Öğrenci profili"
      >
        <InfoGrid className="next-student-profile-info" aria-label="Öğrenci profil özeti" role="region">
          <InfoItem
            label="Kayıt durumu"
            value={<StatusBadge tone={studentStatusTone(detail.profile.status)}>{formatStudentStatus(detail.profile.status)}</StatusBadge>}
          />
          <InfoItem label="Sınıf" value={currentClass} />
          <InfoItem label="Öğrenci no" value={detail.profile.studentNo ?? "Öğrenci no yok"} />
          <InfoItem
            label="Kayıt"
            value={activeEnrollment ? `${formatEnrollmentReason(activeEnrollment.reason)} · ${formatDate(activeEnrollment.startsAt)}` : "Aktif kayıt yok"}
          />
        </InfoGrid>
      </Panel>

      <Tabs label="Öğrenci detay bölümleri">
        <TabButton aria-controls="student-detail-panel-overview" id="student-detail-tab-overview" selected={activeSection === "overview"} onClick={() => setActiveSection("overview")}>Genel bakış</TabButton>
        <TabButton aria-controls="student-detail-panel-records" id="student-detail-tab-records" selected={activeSection === "records"} onClick={() => setActiveSection("records")}>İlişkiler ve kayıtlar</TabButton>
      </Tabs>

      {activeSection === "overview" ? <div className="next-student-growth-tabpanel" aria-labelledby="student-detail-tab-overview" id="student-detail-panel-overview" role="tabpanel" tabIndex={0}>
        <ReportChartPanel
          className="next-student-growth-chart next-student-growth-chart--student"
          description={progressIsComparable
            ? "Aynı ders bağlamındaki sınavlarda Başarı % değişimi; Net/Soru açıklayıcı bağlamdır."
            : "Farklı kapsamdaki sınav sonuçları tarih sırasıyla gösterilir; yönlü gelişim yorumu yapılmaz."}
          title={progressIsComparable ? "Öğrenci gelişimi" : "Sınav geçmişi"}
        >
          <ProgressLineChart caption={progressIsComparable ? "Öğrenci başarı gelişimi" : "Öğrenci sınav geçmişi"} points={progressPoints} />
        </ReportChartPanel>

        <div className="next-student-detail-grid">
          <Panel
            aria-label="Öğretmen notları"
            className="next-student-detail-panel"
            description="Not içeriğini okumak veya yeni not eklemek için Öğretmen notları ekranını açın."
            title="Öğretmen notları"
          >
            <StudentDetailRowsTable
              caption="Öğretmen not kayıtları"
              emptyText="Henüz not yok"
              headers={{ primary: "Görünürlük", status: "Gelişim", meta: "Tarih" }}
              rows={buildTeacherNoteRows(detail.teacherNotes)}
            />
          </Panel>

          <Panel
            aria-label="Ödevler"
            className="next-student-detail-panel"
            description="Sınıf ödevleri öğrencinin teslim durumuyla, materyal atamaları ders ve dönem bağlamıyla; teslim tarihi olanları buradan izleyin."
            title="Ödevler"
          >
            {classHomeworkQuery.isError ? (
              <Alert tone="warning">
                {"Sınıf ödevleri şu an alınamadı; yalnız materyal atamaları listeleniyor. "}
                <Button size="sm" type="button" variant="secondary" onClick={() => void classHomeworkQuery.refetch()}>Tekrar dene</Button>
              </Alert>
            ) : null}
            <StudentDetailRowsTable
              caption="Öğrenci ödev kayıtları"
              emptyText={classHomeworkQuery.isLoading ? "Ödevler yükleniyor…" : "Sınıf ödevi veya materyal ataması yok"}
              headers={{ primary: "Ödev", detail: "Bağlam", status: "Durum", meta: "Teslim" }}
              rows={[
                ...buildClassHomeworkRows(classHomework),
                ...buildHomeworkRows(detail.homeworkAssignments, courseNameById, termNameById),
              ]}
            />
          </Panel>
        </div>
      </div> : null}

      {activeSection === "records" ? <div aria-labelledby="student-detail-tab-records" id="student-detail-panel-records" role="tabpanel" tabIndex={0}>
      <div className="next-student-detail-grid">
        {/* DEC-20261102-08: zaman çizelgesi ve yoklama takvimi yalnız bu sekme açıldığında istek atar. */}
        <StudentTimelinePanel
          canViewFinance={canViewFinance}
          materialAssignments={detail.homeworkAssignments}
          overviewCourses={detail.courses}
          paymentPlans={detail.paymentPlans}
          progress={progress}
          studentId={studentId}
          teacherNotes={detail.teacherNotes}
        />

        <StudentAttendanceCalendar className="next-student-detail-panel next-student-detail-panel--wide" studentId={studentId} />

        <Panel
          aria-label="Öğrenci ilişki haritası"
          className="next-student-detail-panel next-student-detail-panel--wide"
          description={
            canViewFinance
              ? "Veli izinleri (finans, duyuru, destek) ve öğretmen görevleri. Veli bağlamak için iletişim kişilerini kullanın."
              : "Veli izinleri (duyuru, destek) ve öğretmen görevleri. Veli bağlamak için iletişim kişilerini kullanın."
          }
          title="İlişki haritası"
        >
          <div className="next-student-relationship-section">
          <StudentDetailRowsTable
            caption="Veli bağlantıları"
            emptyText="Bağlı veli yok"
            headers={{ primary: "Veli", detail: "İzinler", meta: "Bağlantı tarihi" }}
            rows={buildGuardianRelationshipRows(detail.guardianLinks, guardianNameById, canViewFinance)}
          />
          <StudentDetailRowsTable
            caption="Öğretmen görevleri"
            emptyText="Atanmış öğretmen yok"
            headers={{ primary: "Öğretmen", status: "Görev", detail: "Kapsam", meta: "Tarih" }}
            rows={buildTeacherAssignmentRows(detail.teacherAssignments, teacherNameById, classNameById, courseNameById, termNameById)}
          />
          </div>
        </Panel>

        <StudentContactPanel
          canManageStudent={canManageStudent}
          detail={detail}
          studentId={studentId}
        />

        <Panel
          aria-label="Kayıt geçmişi"
          className="next-student-detail-panel next-student-detail-panel--wide"
          description="Öğrencinin sınıf ve dönem geçmişi; her satır bir kayıt işlemini tarih aralığıyla gösterir."
          title="Kayıt geçmişi"
        >
          <StudentDetailRowsTable
            caption="Kayıt geçmişi kayıtları"
            emptyText="Kayıt geçmişi yok"
            headers={{ primary: "İşlem", status: "Durum", detail: "Sınıf ve dönem", meta: "Tarih" }}
            rows={buildEnrollmentRows(detail.enrollments, classNameById, termNameById)}
          />
        </Panel>

        <Panel
          aria-label="Denetim özeti"
          className="next-student-detail-panel next-student-detail-panel--wide"
          description="Bu öğrencinin kaydında yapılan son değişiklikler."
          title="Denetim özeti"
        >
          <StudentDetailRowsTable
            caption="Öğrenci denetim kayıtları"
            emptyText="Denetim kaydı yok"
            headers={{ primary: "İşlem", meta: "Tarih" }}
            rows={buildAuditRows(studentAuditLogs)}
          />
        </Panel>
      </div>
      </div> : null}
    </section>
  );
}

function StudentDetailRowsTable({
  caption,
  emptyText,
  headers,
  rows,
}: {
  caption: string;
  emptyText: string;
  headers: StudentDetailTableHeaders;
  rows: StudentDetailTableRow[];
}) {
  return (
    <DataTable
      caption={caption}
      columns={studentDetailTableColumns(headers)}
      density="compact"
      emptyText={emptyText}
      getRowKey={(row) => row.id}
      rows={rows}
    />
  );
}

function StudentContactPanel({
  canManageStudent,
  detail,
  studentId,
}: {
  canManageStudent: boolean;
  detail: StudentBaseDetail;
  studentId: string;
}) {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const canLinkGuardian = canManageStudent && hasCapabilityForRoles(auth?.session.roles ?? [], "user:manage");
  const [form, setForm] = useState({ firstName: "", lastName: "", relationType: "OTHER", phone: "", email: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pendingCreate = useRef<{ body: string; idempotencyKey: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!auth || saving) return;
    setSaving(true);
    setError("");
    try {
      const body = JSON.stringify({
        firstName: form.firstName,
        lastName: form.lastName,
        relationType: form.relationType,
        phone: form.phone || undefined,
        email: form.email || undefined,
      });
      if (pendingCreate.current?.body !== body) {
        pendingCreate.current = { body, idempotencyKey: crypto.randomUUID() };
      }
      await apiRequest<StudentContactRecord>(auth.accessToken, `${apiBaseUrl}/students/${encodeURIComponent(studentId)}/contacts`, {
        body,
        headers: {
          "content-type": "application/json",
          "Idempotency-Key": pendingCreate.current.idempotencyKey,
        },
        method: "POST",
      });
      pendingCreate.current = null;
      setForm({ firstName: "", lastName: "", relationType: "OTHER", phone: "", email: "" });
      await queryClient.invalidateQueries({ queryKey: ["next-student-detail-page-data"] });
    } catch {
      setError("İletişim kişisi kaydedilemedi.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      aria-label="Öğrenci iletişim kişileri"
      className="next-student-detail-panel next-student-detail-panel--wide"
      description="İletişim kişisi eklemek portal hesabı açmaz. Yasal temsilciyi mevcut bir veliye bağlayarak veli portalını açabilirsiniz."
      title="İletişim kişileri"
    >
      <StudentDetailRowsTable
        caption="Öğrenci iletişim kişisi kayıtları"
        emptyText="İletişim kaydı yok"
        headers={{ primary: "Kişi", status: "Durum", detail: "İletişim", meta: "İlişki" }}
        rows={buildContactRows(detail)}
      />
      {canLinkGuardian ? <StudentContactGuardianLinkControls detail={detail} studentId={studentId} /> : null}
      {canManageStudent ? (
        <form className="next-form-section" onSubmit={(event) => void submit(event)}>
          <p className="next-form-section-title">İletişim kişisi ekle</p>
          <div className="next-form-grid">
            <Field label="Ad"><Input required value={form.firstName} onChange={(event) => setForm((current) => ({ ...current, firstName: event.target.value }))} /></Field>
            <Field label="Soyad"><Input required value={form.lastName} onChange={(event) => setForm((current) => ({ ...current, lastName: event.target.value }))} /></Field>
            <Field label="İlişki">
              <Select value={form.relationType} onChange={(event) => setForm((current) => ({ ...current, relationType: event.target.value }))}>
                <option value="MOTHER">Anne</option>
                <option value="FATHER">Baba</option>
                <option value="LEGAL_GUARDIAN">Yasal temsilci</option>
                <option value="OTHER">Diğer</option>
              </Select>
            </Field>
            <Field label="Telefon"><Input inputMode="tel" value={form.phone} onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))} /></Field>
            <Field label="E-posta"><Input type="email" value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></Field>
          </div>
          {error ? <Alert tone="danger">{error}</Alert> : null}
          <Button disabled={saving} type="submit">{saving ? "Kaydediliyor…" : "İletişim kişisi ekle"}</Button>
        </form>
      ) : null}
    </Panel>
  );
}

/**
 * KV-3b (DEC-20261003-01): the admin links a LEGAL_GUARDIAN contact to an existing guardian picked from the guardian
 * search, or (product owner decision 2026-10-05) to an existing staff/teacher user of the institution who is also a
 * parent: no second account, the GUARDIAN role is added to that user. Removing the link also removes the portal access.
 */
type GuardianLinkTarget = "guardian" | "user";

interface GuardianLinkRequest {
  action: "link" | "unlink";
  body: string;
  contactId: string;
  idempotencyKey: string;
  successText: string;
}

interface GuardianLinkUserOption {
  id: string;
  name: string;
  roles: string[];
}

function StudentContactGuardianLinkControls({ detail, studentId }: { detail: StudentBaseDetail; studentId: string }) {
  const { auth } = useAuth();
  const queryClient = useQueryClient();
  const { confirm, confirmationDialog } = useConfirmDialog();
  const legalContacts = detail.contacts.filter((contact) => contact.relationType === "LEGAL_GUARDIAN");
  const [contactId, setContactId] = useState("");
  const [target, setTarget] = useState<GuardianLinkTarget>("guardian");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const pending = useRef<{ request: string; idempotencyKey: string } | null>(null);
  const [retryRequest, setRetryRequest] = useState<GuardianLinkRequest | null>(null);
  const contact = legalContacts.find((candidate) => candidate.id === contactId) ?? legalContacts[0];
  const searchTerm = search.trim();
  const canSearch = Boolean(auth && contact && !contact.guardianId);
  const guardiansQuery = useQuery({
    queryKey: ["next-student-contact-guardian-search", auth?.session.tenantId ?? "anonymous", searchTerm],
    queryFn: () => apiRequest<GuardianRecord[]>(
      auth?.accessToken ?? "",
      withQueryParams(`${apiBaseUrl}/guardians`, { q: searchTerm, limit: "20", page: "1" }),
    ),
    enabled: canSearch && target === "guardian",
    refetchOnWindowFocus: false,
  });
  const usersQuery = useQuery({
    queryKey: ["next-student-contact-guardian-user-search", auth?.session.tenantId ?? "anonymous", searchTerm],
    queryFn: () => apiRequest<GuardianLinkUserOption[]>(
      auth?.accessToken ?? "",
      withQueryParams(`${apiBaseUrl}/tenant-users`, { q: searchTerm, limit: "20" }),
    ),
    enabled: canSearch && target === "user",
    refetchOnWindowFocus: false,
  });
  const options = target === "guardian"
    ? (guardiansQuery.data ?? []).map((guardian) => ({ id: guardian.id, label: `${guardian.firstName} ${guardian.lastName}` }))
    : (usersQuery.data ?? [])
      // Staff/teacher accounts only; student accounts can never hold the guardian role (the API refuses them too).
      .filter((user) => !user.roles.includes("STUDENT") && user.roles.some((role) => role !== "GUARDIAN"))
      .map((user) => ({ id: user.id, label: user.name }));
  const optionsPending = target === "guardian" ? guardiansQuery.isPending : usersQuery.isPending;
  const linkedGuardianName = contact?.guardianId
    ? detail.guardians.find((guardian) => guardian.id === contact.guardianId)
    : undefined;

  if (legalContacts.length === 0 || !contact) return null;
  const contactName = `${contact.firstName} ${contact.lastName}`;
  const searchLabel = target === "guardian" ? "Veli ara" : "Kullanıcı ara";
  const selectLabel = target === "guardian" ? "Veli seçimi" : "Kullanıcı seçimi";
  const linkLabel = target === "guardian" ? "Mevcut veliye bağla" : "Mevcut kullanıcıya bağla";

  async function submit(action: "link" | "unlink") {
    if (!auth || saving || !contact) return;
    const selected = options.find((option) => option.id === selectedId);
    if (action === "link" && !selected) return;
    const confirmed = await confirm(action === "link"
      ? target === "guardian"
        ? {
          confirmLabel: "Bağla",
          confirmVariant: "primary",
          description: "Veli hesabı açılmaz; öğrenci–veli bağı yoksa tüm izinler kapalı olarak eklenir.",
          message: `${contactName} iletişim kaydı ${selected?.label ?? ""} velisine bağlansın mı?`,
          title: "Mevcut veliye bağla",
        }
        : {
          confirmLabel: "Bağla",
          confirmVariant: "primary",
          description: "Ayrı hesap açılmaz; kullanıcının mevcut rolleri korunur, Veli rolü eklenir ve açık oturumları kapanır. Öğrenci–veli bağı tüm izinler kapalı olarak eklenir.",
          message: `${contactName} iletişim kaydı ${selected?.label ?? ""} kullanıcısına bağlansın mı?`,
          title: "Mevcut kullanıcıya bağla",
        }
      : {
        confirmLabel: "Bağı kaldır",
        description: "İletişim kaydındaki bağ ve öğrencinin veli portalı erişimi kaldırılır (öğrencinin başka bir iletişim kaydı aynı veliye bağlıysa erişim kalır).",
        message: `${contactName} iletişim kaydının veli bağı kaldırılsın mı?`,
        title: "Veli bağını kaldır",
      });
    if (!confirmed) return;

    const body = action === "link" ? JSON.stringify(target === "guardian" ? { guardianId: selectedId } : { userId: selectedId }) : "";
    const request = `${action}:${contact.id}:${body}`;
    if (pending.current?.request !== request) pending.current = { request, idempotencyKey: crypto.randomUUID() };
    await send({
      action,
      body,
      contactId: contact.id,
      idempotencyKey: pending.current.idempotencyKey,
      successText: action === "unlink"
        ? "Veli bağı ve portal erişimi kaldırıldı."
        : target === "guardian" ? "İletişim kaydı veliye bağlandı." : "Kullanıcıya veli rolü eklendi ve iletişim kaydı bağlandı.",
    });
  }

  // KV-3e: "Tekrar dene" resends the exact failed request with the same Idempotency-Key (no new confirmation).
  async function send(request: GuardianLinkRequest) {
    if (!auth) return;
    setSaving(true);
    setMessage(null);
    // The retry alert stays (with its button disabled) until the resent request settles.
    try {
      await apiRequest<StudentContactGuardianLinkResult>(
        auth.accessToken,
        `${apiBaseUrl}/students/${encodeURIComponent(studentId)}/contacts/${encodeURIComponent(request.contactId)}/guardian`,
        {
          ...(request.action === "link" ? { body: request.body } : {}),
          headers: { "content-type": "application/json", "Idempotency-Key": request.idempotencyKey },
          method: request.action === "link" ? "PUT" : "DELETE",
        },
      );
      pending.current = null;
      setRetryRequest(null);
      setSelectedId("");
      setMessage({ tone: "success", text: request.successText });
      await queryClient.invalidateQueries({ queryKey: ["next-student-detail-page-data"] });
    } catch (error) {
      const concurrent = isGuardianLinkConcurrentUpdate(error);
      setRetryRequest(concurrent ? request : null);
      if (!concurrent) setMessage({ tone: "danger", text: formatGuardianLinkError(error) });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="next-form-section">
      <p className="next-form-section-title">Veli bağı</p>
      <div className="next-list-controls" aria-label="Veli bağı">
        <Field label="Yasal temsilci">
          <Select value={contact.id} onChange={(event) => { setContactId(event.target.value); setSelectedId(""); setMessage(null); setRetryRequest(null); }}>
            {legalContacts.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.firstName} {candidate.lastName}</option>
            ))}
          </Select>
        </Field>
        {contact.guardianId ? (
          <>
            <p role="status">Bağlı veli: {linkedGuardianName ? `${linkedGuardianName.firstName} ${linkedGuardianName.lastName}` : "Veli kaydı"}</p>
            <Button disabled={saving} type="button" variant="secondary" onClick={() => void submit("unlink")}>Bağı kaldır</Button>
          </>
        ) : (
          <>
            <Field label="Bağlanacak kişi">
              <Select value={target} onChange={(event) => { setTarget(event.target.value as GuardianLinkTarget); setSelectedId(""); setMessage(null); setRetryRequest(null); }}>
                <option value="guardian">Mevcut veli</option>
                <option value="user">Mevcut kullanıcı (personel)</option>
              </Select>
            </Field>
            <Field label={searchLabel}>
              <Input type="search" value={search} onChange={(event) => setSearch(event.target.value)} />
            </Field>
            <Field label={selectLabel}>
              <Select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
                <option value="">{optionsPending ? "Yükleniyor…" : options.length > 0 ? (target === "guardian" ? "Veli seçin" : "Kullanıcı seçin") : (target === "guardian" ? "Veli bulunamadı" : "Kullanıcı bulunamadı")}</option>
                {options.map((option) => (
                  <option key={option.id} value={option.id}>{option.label}</option>
                ))}
              </Select>
            </Field>
            <Button disabled={saving || !selectedId} type="button" onClick={() => void submit("link")}>{linkLabel}</Button>
          </>
        )}
      </div>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {retryRequest ? <GuardianLinkRetryAlert retrying={saving} onRetry={() => void send(retryRequest)} /> : null}
      {confirmationDialog}
    </div>
  );
}

const guardianLinkErrorMessages: Record<string, string> = {
  STUDENT_CONTACT_GUARDIAN_ALREADY_LINKED: "İletişim kaydı başka bir veliye bağlı; önce bağı kaldırın.",
  STUDENT_CONTACT_GUARDIAN_NOT_FOUND: "Seçilen veli kaydı bulunamadı. Personel veya öğretmen için \"Mevcut kullanıcı (personel)\" seçeneğini kullanın.",
  STUDENT_CONTACT_NOT_LEGAL_GUARDIAN: "Yalnız yasal temsilci iletişim kaydı veliye bağlanabilir.",
  STUDENT_CONTACT_USER_NOT_ELIGIBLE: "Bu kullanıcıya veli rolü eklenemez (öğrenci hesabı veya kurum üyeliği eksik).",
  STUDENT_CONTACT_USER_NOT_FOUND: "Seçilen kullanıcı bu kurumda bulunamadı.",
};

function formatGuardianLinkError(error: unknown): string {
  const code = error instanceof ApiRequestError ? error.code : undefined;
  return (code && guardianLinkErrorMessages[code]) || "Veli bağı güncellenemedi.";
}

function buildContactRows(detail: StudentBaseDetail): StudentDetailTableRow[] {
  return [
    {
      detail: detail.profile.phone ? maskPhoneNumber(detail.profile.phone) : (detail.profile.phoneMasked ?? "-"),
      id: "student-phone",
      meta: "Profil",
      primary: "Öğrenci telefonu",
      status: "Maskeli",
      tone: "success",
    },
    {
      detail: detail.profile.email ? maskEmail(detail.profile.email) : (detail.profile.emailMasked ?? "-"),
      id: "student-email",
      meta: "Profil",
      primary: "Öğrenci e-postası",
      status: "Maskeli",
      tone: "success",
    },
    ...detail.contacts.map((contact): StudentDetailTableRow => ({
      detail: [contact.phoneMasked, contact.emailMasked].filter(Boolean).join(" · ") || "İletişim bilgisi yok",
      id: `student-contact-${contact.id}`,
      meta: formatStudentContactRelation(contact.relationType),
      primary: `${contact.firstName} ${contact.lastName}`,
      status: contact.guardianId ? "Veliye bağlı" : "İletişim kişisi",
      tone: contact.guardianId ? "success" : "info",
    })),
  ];
}

function formatStudentContactRelation(relationType: StudentContactRecord["relationType"]): string {
  return { MOTHER: "Anne", FATHER: "Baba", LEGAL_GUARDIAN: "Yasal temsilci", OTHER: "Diğer" }[relationType];
}

function buildGuardianRelationshipRows(
  links: GuardianStudentRecord[],
  guardianNameById: ReadonlyMap<string, string>,
  canViewFinance: boolean,
): StudentDetailTableRow[] {
  return links.map((link) => ({
    detail: formatGuardianPermissionLabels(link, canViewFinance),
    id: link.id,
    meta: link.createdAt ? `${formatDateTime(link.createdAt)} tarihinde bağlandı` : "Tarih yok",
    primary: guardianNameById.get(link.guardianId) ?? "Veli kaydı",
  }));
}

function buildTeacherAssignmentRows(
  assignments: TeacherAssignmentRecord[],
  teacherNameById: ReadonlyMap<string, string>,
  classNameById: ReadonlyMap<string, string>,
  courseNameById: ReadonlyMap<string, string>,
  termNameById: ReadonlyMap<string, string>,
): StudentDetailTableRow[] {
  return assignments.map((assignment) => ({
    detail: formatTeacherAssignmentScopeLabel(assignment, classNameById, courseNameById, termNameById),
    id: assignment.id,
    meta: formatDateRange(assignment.startsAt, assignment.endsAt),
    primary: teacherNameById.get(assignment.teacherId) ?? "Öğretmen kaydı",
    status: formatTeacherAssignmentRole(assignment.role),
    tone: "info",
  }));
}

function buildTeacherNoteRows(notes: TeacherNoteRecord[]): StudentDetailTableRow[] {
  return notes.map((note) => ({
    id: note.id,
    meta: formatDate(note.createdAt),
    primary: formatTeacherNoteVisibility(note.visibility),
    status: formatTeacherNoteDevelopmentStatus(note.developmentStatus),
    tone: note.developmentStatus === "WATCH" ? "warning" : "info",
  }));
}

function buildEnrollmentRows(
  records: StudentEnrollmentRecord[],
  classNameById: ReadonlyMap<string, string>,
  termNameById: ReadonlyMap<string, string>,
): StudentDetailTableRow[] {
  return records.map((record) => ({
    detail: [
      record.classId ? classNameById.get(record.classId) ?? "Sınıf kaydı" : "Sınıfsız",
      formatEnrollmentAcademicContext(record, termNameById),
    ].join(" · "),
    id: record.id,
    meta: formatDateRange(record.startsAt, record.endsAt),
    primary: formatEnrollmentReason(record.reason),
    status: formatEnrollmentStatus(record),
    tone: record.endsAt && record.status === "ACTIVE" ? "neutral" : studentStatusTone(record.status),
  }));
}

/** UAT U15: bitiş tarihi olan kayıt kapanmıştır; yenilemede eski satır API'de ACTIVE kalsa da "Aktif" yazılmaz. */
function formatEnrollmentStatus(record: Pick<StudentEnrollmentRecord, "endsAt" | "status">) {
  if (record.endsAt && record.status === "ACTIVE") return "Kapandı";
  return formatStudentStatus(record.status);
}

const classHomeworkStatusLabels: Record<StudentHomeworkRecord["submission"]["status"], string> = {
  CHECKED: "Kontrol edildi",
  NOT_SUBMITTED: "Teslim edilmedi",
  SUBMITTED: "Teslim edildi",
};

/** Açık sınıf ödevleri (teslim edilmemiş) teslim tarihine göre önce, teslim edilenler sonra listelenir. */
function buildClassHomeworkRows(records: StudentHomeworkRecord[], now = new Date()): StudentDetailTableRow[] {
  return [...records]
    .sort((left, right) => {
      const leftOpen = left.submission.status === "NOT_SUBMITTED" ? 0 : 1;
      const rightOpen = right.submission.status === "NOT_SUBMITTED" ? 0 : 1;
      return leftOpen - rightOpen || (left.dueAt ?? "9999").localeCompare(right.dueAt ?? "9999");
    })
    .map((record) => {
      const overdue = record.submission.status === "NOT_SUBMITTED" && Boolean(record.dueAt) && new Date(record.dueAt!).getTime() < now.getTime();
      return {
        detail: ["Sınıf ödevi", record.sourceMaterialTitle].filter(Boolean).join(" · "),
        id: `class-homework-${record.id}`,
        meta: record.dueAt ? formatDate(record.dueAt) : "Teslim tarihi yok",
        primary: record.title,
        status: overdue ? "Teslim edilmedi · süresi geçti" : classHomeworkStatusLabels[record.submission.status],
        tone: record.submission.status === "NOT_SUBMITTED" ? (overdue ? "danger" : "warning") : record.submission.status === "CHECKED" ? "success" : "info",
      };
    });
}

function buildHomeworkRows(
  assignments: HomeworkMaterialAssignmentRecord[],
  courseNameById: ReadonlyMap<string, string>,
  termNameById: ReadonlyMap<string, string>,
): StudentDetailTableRow[] {
  return assignments.map((assignment) => ({
    detail: [
      assignment.courseId ? courseNameById.get(assignment.courseId) ?? "Ders kaydı" : undefined,
      assignment.termId ? termNameById.get(assignment.termId) ?? "Dönem kaydı" : undefined,
      assignment.note ? "Not kayıtlı" : undefined,
    ].filter(Boolean).join(" · ") || "Öğrenciye atanmış materyal",
    id: assignment.id,
    meta: assignment.dueAt ? formatDate(assignment.dueAt) : formatDate(assignment.createdAt),
    primary: assignment.materialTitle ?? "Ödev kaydı",
    status: assignment.dueAt ? "Teslim tarihli" : "Atandı",
    tone: assignment.dueAt ? "warning" : "info",
  }));
}

function buildAuditRows(records: StudentAuditSummaryRecord[]): StudentDetailTableRow[] {
  return records.map((record) => ({
    id: record.id,
    meta: formatDateTime(record.createdAt),
    primary: record.actionLabel,
  }));
}

function buildStudentDashboardSummaryItems(detail: StudentBaseDetail, classHomework: StudentHomeworkRecord[]): OperationSummaryItem[] {
  // Açık ödev = teslim edilmemiş sınıf ödevi + açık materyal ataması (öğrenci ve veli portalıyla aynı tanım).
  const openClassHomeworkCount = classHomework.filter((record) => record.submission.status === "NOT_SUBMITTED").length;
  const openHomeworkCount = detail.openHomeworkCount + openClassHomeworkCount;
  const attendance = detail.attendanceSummary;
  const latestExam = detail.latestExam;
  const latestSuccessRate = reportSuccessRate(latestExam?.total);
  const watchNoteCount = detail.teacherNotes.filter((note) => note.developmentStatus === "WATCH").length;
  return [
    {
      description: attendance && attendance.total > 0 ? `${formatCount(attendance.total)} yoklama kaydı` : "Yoklama kaydı yok",
      key: "attendance",
      label: "Devamsızlık",
      tone: attendance && attendance.absent > 0 ? "warning" : "default",
      value: formatAttendanceSummary(attendance),
    },
    {
      description: latestExam
        ? `Net ${formatNetNumber(latestExam.total.net)} / Soru ${formatNumber(reportQuestionCount(latestExam.total))}`
        : "Hazır sınav raporu yok",
      key: "latest-exam",
      label: "Son sınav Başarı %",
      tone: latestSuccessRate === undefined ? "default" : "success",
      value: formatPercentNumber(latestSuccessRate),
    },
    {
      // Metin aynı kalır (route-family-student-detail-768 golden); sayı artık sınıf ödevini de içerir.
      description: "Öğrenciye atanan ödev ve materyal",
      key: "homework",
      label: "Açık ödev",
      tone: openHomeworkCount > 0 ? "info" : "default",
      value: formatCount(openHomeworkCount),
    },
    {
      description: watchNoteCount > 0 ? `${formatCount(watchNoteCount)} not takipte` : formatTeacherNoteSummary(detail.teacherNotes),
      key: "teacher-notes",
      label: "Öğretmen notu",
      tone: watchNoteCount > 0 ? "warning" : "default",
      value: formatCount(detail.teacherNoteCount),
    },
  ];
}

function buildStudentDashboardSummaryBadges(detail: StudentBaseDetail, canViewFinance: boolean): OperationSummaryBadge[] {
  const latestExamTitle = detail.latestExam?.examTitle;
  const hasPendingPayment = detail.paymentPlans.some((plan) => plan.installments.some((installment) => installment.status === "PENDING"));
  return [
    {
      key: "status",
      label: `${formatStudentStatus(detail.profile.status)} öğrenci`,
      tone: studentStatusTone(detail.profile.status),
    },
    {
      key: "guardian",
      label: detail.guardianLinks.length > 0 ? `${formatCount(detail.guardianLinks.length)} veli bağlı` : "Veli bağlantısı yok",
      tone: detail.guardianLinks.length > 0 ? "success" : "warning",
    },
    ...(latestExamTitle ? [{ key: "latest-exam", label: `Son sınav: ${latestExamTitle}`, tone: "info" as const }] : []),
    ...(canViewFinance && hasPendingPayment
      ? [{ key: "finance", label: `${formatPendingPayment(detail.paymentPlans)} bekleyen ödeme`, tone: "warning" as const }]
      : []),
    {
      key: "pii",
      label: "Kişisel bilgiler maskeli",
      tone: "success",
    },
  ];
}

function StudentExamDetails({
  branchRadar,
  errorBooklet,
  examResult,
  exams,
  latestExamId,
  outcomeRows,
  progress,
  progressPoints,
  report,
  selectedExamId,
  selectedSnapshot,
  snapshots,
  studentId,
  onExamChange,
  onSnapshotChange,
}: {
  branchRadar: ReturnType<typeof toStudentBranchRadar>;
  errorBooklet: ReportErrorBooklet | null;
  examResult: ReturnType<typeof toStudentExamResult>;
  exams: ExamRecord[];
  latestExamId: string | undefined;
  outcomeRows: ReturnType<typeof toStudentOutcomeRows>;
  progress: ReportStudentProgress | null;
  progressPoints: ReturnType<typeof toProgressPoints>;
  report: ReportStudentSnapshot | null;
  selectedExamId: string;
  selectedSnapshot: ReportSnapshotRecord | null;
  snapshots: ReportSnapshotRecord[];
  studentId: string;
  onExamChange: (examId: string) => void;
  onSnapshotChange: (snapshotId: string) => void;
}) {
  const progressIsComparable = isComparableStudentProgress(progress);
  const examSummaryItems = buildStudentExamSummaryItems(report, errorBooklet, progress);
  const examSummaryBadges = buildStudentExamSummaryBadges(report, selectedSnapshot, snapshots);
  const examSummaryActions = buildStudentExamSummaryActions(report, errorBooklet, progress, outcomeRows);
  const selectedExam = exams.find((exam) => exam.id === selectedExamId);
  const scoreView = report ? preferredScoreView(report) : undefined;
  const isModernReport = Boolean(report?.scoringProfileId || report?.scoreViews?.length);
  const score = scoreView?.practiceScore ?? (isModernReport ? undefined : legacyReportScore(report));
  const latestExam = latestExamId ? exams.find((exam) => exam.id === latestExamId) : undefined;
  const publishedExams = exams.filter((exam) => exam.id !== latestExamId && exam.status === "PUBLISHED");
  const otherExams = exams.filter((exam) => exam.id !== latestExamId && exam.status !== "PUBLISHED");
  const renderExamOption = (exam: ExamRecord) => <option key={exam.id} value={exam.id}>{exam.title}</option>;

  return (
    <section className="next-detail-workspace" aria-label="Öğrenci sınav detayları">
      <OperationSummary
        actions={examSummaryActions}
        ariaLabel="Öğrenci sınav özeti"
        badges={examSummaryBadges}
        items={examSummaryItems}
      />
      <Panel
        actions={<StatusBadge tone={report ? "success" : "warning"}>{report ? "Rapor hazır" : "Hazır rapor yok"}</StatusBadge>}
        aria-label="Öğrenci sınav rapor bağlamı"
        description="İncelemek istediğiniz sınavı seçin; öğrencinin sonucu olan son sınav listenin başındadır."
        title="Rapor bağlamı"
      >
        <div className="next-detail-selects">
          <Field label="Sınav">
            <Select aria-label="Sınav" value={selectedExamId} onChange={(event) => onExamChange(event.target.value)}>
              {latestExam ? <optgroup label="Son sonucu olan sınav">{renderExamOption(latestExam)}</optgroup> : null}
              {publishedExams.length > 0 ? <optgroup label="Yayımlanan sınavlar">{publishedExams.map(renderExamOption)}</optgroup> : null}
              {otherExams.length > 0 ? <optgroup label="Taslak sınavlar">{otherExams.map(renderExamOption)}</optgroup> : null}
            </Select>
          </Field>
        </div>
        {snapshots.length > 1 ? (
          <details className="next-list-disclosure">
            <summary>Önceki rapor sürümleri</summary>
            <div className="next-list-disclosure__content next-detail-selects">
              <Field label="Rapor sürümü" description="Varsayılan olarak en güncel rapor gösterilir.">
                <Select
                  aria-label="Rapor sürümü"
                  value={selectedSnapshot?.id ?? ""}
                  onChange={(event) => onSnapshotChange(event.target.value)}
                >
                  {snapshots.map((snapshot, index) => (
                    <option key={snapshot.id} value={snapshot.id}>
                      {formatSnapshotLabel(snapshot, studentId)}{index === 0 ? " (güncel)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </details>
        ) : null}
        <InfoGrid className="next-student-report-context" aria-label="Öğrenci rapor bağlam özeti" role="region">
          <InfoItem label="Sınav" value={selectedExam?.title ?? "Sınav seçilmedi"} />
          <InfoItem label="Rapor tarihi" value={selectedSnapshot ? formatSnapshotLabel(selectedSnapshot, studentId) : "Hazır rapor yok"} />
          <InfoItem label="Başarı %" value={formatPercentNumber(reportSuccessRate(report?.total))} />
          <InfoItem label="Net" value={formatNetNumber(report?.total?.net)} />
          <InfoItem label="Soru" value={formatNumber(reportQuestionCount(report?.total))} />
          <InfoItem label={scoreView ? scoreViewLabel(scoreView) : isModernReport ? "Puan hesaplanamadı" : "Puan (eski biçim)"} value={formatNumber(score)} />
        </InfoGrid>
      </Panel>

      {report ? (
        <>
          <div className="next-report-visual-grid">
            <ReportChartPanel description="Soru sayısına göre başarı ve doğruluk dağılımı" title="Öğrenci Sonuç Dağılımı">
              <ExamResultDonut result={examResult} />
            </ReportChartPanel>
            <ReportChartPanel description="Rapor bazlı branş başarıları" title="Branş Başarıları">
              <TopicRadarChart branches={branchRadar} caption="Öğrenci branş başarıları" />
            </ReportChartPanel>
            <ReportChartPanel description="En düşük başarılı kazanımlar önce; net ve soru bağlam olarak kalır" title="Kazanım Başarıları">
              <OutcomeNetTable caption="Öğrenci kazanım başarıları" rows={outcomeRows} />
            </ReportChartPanel>
            <ReportChartPanel
              className="next-student-growth-chart next-student-growth-chart--student"
              description={progressIsComparable
                ? "Aynı ders bağlamındaki sınavlarda Başarı % değişimi; Net/Soru açıklayıcı bağlamdır."
                : "Farklı kapsamdaki sınav sonuçları tarih sırasıyla gösterilir; yönlü gelişim yorumu yapılmaz."}
              title={progressIsComparable ? "Öğrenci gelişimi" : "Sınav geçmişi"}
            >
              <ProgressLineChart caption={progressIsComparable ? "Öğrenci başarı gelişimi" : "Öğrenci sınav geçmişi"} points={progressPoints} />
            </ReportChartPanel>
          </div>

          <Panel
            aria-label="Hata kitapçığı"
            description="Yanlış ve boş sorular ders, kazanım, yanıt ve doğru cevap bağlamıyla listelenir."
            title="Hata kitapçığı"
          >
            <ErrorBookletTable
              caption="Öğrenci hata kitapçığı"
              emptyLabel="Hata kaydı yok"
              items={errorBooklet?.items ?? []}
            />
          </Panel>
        </>
      ) : (
        <Panel aria-label="Hazır rapor durumu" title="Hazır rapor yok" tone="warning">
          <p>Bu öğrencinin seçili sınavda hazır raporu yok. Listenin başındaki son sonucu olan sınavı seçebilirsiniz.</p>
        </Panel>
      )}
    </section>
  );
}

function buildStudentExamSummaryItems(
  report: ReportStudentSnapshot | null,
  errorBooklet: ReportErrorBooklet | null,
  progress: ReportStudentProgress | null,
): OperationSummaryItem[] {
  const successRate = reportSuccessRate(report?.total);
  return [
    {
      description: `Net ${formatNetNumber(report?.total?.net)} / Soru ${formatNumber(reportQuestionCount(report?.total))}`,
      key: "success-rate",
      label: "Başarı %",
      tone: successRate === undefined ? "default" : "success",
      value: formatPercentNumber(successRate),
    },
    {
      description: "Son hazır rapor neti",
      key: "net",
      label: "Net",
      value: formatNetNumber(report?.total?.net),
    },
    {
      description: formatStudentProgressSummary(progress),
      key: "question-count",
      label: "Soru",
      value: formatNumber(reportQuestionCount(report?.total)),
    },
    {
      description: "Yanlış ve boş sorular",
      key: "error-booklet",
      label: "Hata kitapçığı",
      tone: errorBooklet && errorBooklet.items.length > 0 ? "warning" : "default",
      value: errorBooklet ? `${formatCount(errorBooklet.items.length)} soru` : "-",
    },
    {
      description: report && preferredScoreView(report) ? scoreViewLabel(preferredScoreView(report)!) : "Puan (eski biçim)",
      key: "score",
      label: "Deneme puanı",
      value: formatNumber((report ? preferredScoreView(report)?.practiceScore : undefined) ?? (report?.scoringProfileId || report?.scoreViews?.length ? undefined : legacyReportScore(report))),
    },
  ];
}

function buildStudentExamSummaryBadges(
  report: ReportStudentSnapshot | null,
  selectedSnapshot: ReportSnapshotRecord | null,
  snapshots: ReportSnapshotRecord[],
): OperationSummaryBadge[] {
  return [
    {
      key: "report",
      label: report ? "Rapor hazır" : "Hazır rapor yok",
      tone: report ? "success" : "warning",
    },
    ...(selectedSnapshot && snapshots.length > 1 && selectedSnapshot.id !== snapshots[0]?.id
      ? [{ key: "snapshot", label: "Önceki rapor sürümü gösteriliyor", tone: "warning" as const }]
      : []),
    {
      key: "history",
      label: `${formatCount(snapshots.length)} rapor sürümü`,
      tone: snapshots.length > 0 ? "info" : "neutral",
    },
  ];
}

function buildStudentExamSummaryActions(
  report: ReportStudentSnapshot | null,
  errorBooklet: ReportErrorBooklet | null,
  progress: ReportStudentProgress | null,
  outcomeRows: ReturnType<typeof toStudentOutcomeRows>,
): OperationSummaryAction[] {
  return [
    {
      detail: `Net ${formatNetNumber(report?.total?.net)} / Soru ${formatNumber(reportQuestionCount(report?.total))}`,
      key: "score-context",
      label: "Performans bağlamı",
      status: report ? "Hazır" : "Bekliyor",
      tone: report ? "success" : "warning",
      value: formatPercentNumber(reportSuccessRate(report?.total)),
    },
    {
      detail: formatStudentProgressSummary(progress),
      key: "progress",
      label: "Gelişim",
      status: progress ? "İzleniyor" : "Veri yok",
      tone: progress ? "info" : "neutral",
      value: progress ? `${formatCount(progress.points.length)} nokta` : "-",
    },
    {
      detail: `${formatCount(outcomeRows.length)} kazanım, ${errorBooklet ? formatCount(errorBooklet.items.length) : "0"} hata sorusu`,
      key: "error-focus",
      label: "Hata odağı",
      status: errorBooklet && errorBooklet.items.length > 0 ? "Takip" : "Normal",
      tone: errorBooklet && errorBooklet.items.length > 0 ? "warning" : "neutral",
      value: errorBooklet ? `${formatCount(errorBooklet.items.length)} soru` : "Hata yok",
    },
  ];
}

async function loadStudentDetailPageData(
  accessToken: string,
  id: string,
  options: { canViewFinance: boolean },
): Promise<StudentDetailPageData> {
  const [detail, exams] = await Promise.all([
    loadStudentBaseDetail(accessToken, id, options),
    loadExams(accessToken),
  ]);
  return { detail, exams };
}

async function loadStudentBaseDetail(
  accessToken: string,
  id: string,
  options: { canViewFinance: boolean },
): Promise<StudentBaseDetail> {
  const overview = await apiRequest<StudentOverviewRecord>(
    accessToken,
    `${apiBaseUrl}/students/${encodeURIComponent(id)}/overview`,
  );
  const paymentPlans = options.canViewFinance && overview.canViewFinance
    ? await apiRequest<PaymentPlanWithInstallmentsRecord[]>(accessToken, `${apiBaseUrl}/payment-plans?studentId=${encodeURIComponent(id)}`)
    : [];
  return {
    attendanceSummary: overview.attendance,
    auditLogs: overview.activity,
    classes: overview.classes,
    courses: overview.courses,
    contacts: overview.contacts,
    guardianLinks: overview.guardianLinks,
    guardians: overview.guardians,
    homeworkAssignments: overview.homeworkAssignments,
    latestExam: overview.latestExam,
    openHomeworkCount: overview.openHomeworkCount ?? overview.homeworkAssignments.length,
    paymentPlans,
    profile: overview.profile,
    enrollments: overview.enrollments,
    teacherAssignments: overview.teacherAssignments,
    teacherNoteCount: overview.teacherNoteCount ?? overview.teacherNotes.length,
    teachers: overview.teachers,
    teacherNotes: overview.teacherNotes,
    terms: overview.terms,
  };
}

async function loadExams(accessToken: string): Promise<ExamRecord[]> {
  const exams = await apiRequestOrNull<ExamRecord[]>(accessToken, `${apiBaseUrl}/exams`);
  return exams ?? [];
}

function preferredExamId(exams: ExamRecord[], requestedExamId = "", latestExamId?: string) {
  return exams.find((exam) => exam.id === requestedExamId)?.id
    ?? exams.find((exam) => exam.id === latestExamId)?.id
    ?? exams.find((exam) => exam.status === "PUBLISHED")?.id
    ?? exams[0]?.id
    ?? requestedExamId;
}

// Öğrencinin sonucu olan son sınav (overview.latestExam) önce, ardından yayımlanan sınavlar gelir.
function sortExamsForStudent(exams: ExamRecord[], latestExamId: string | undefined): ExamRecord[] {
  const rank = (exam: ExamRecord) => (exam.id === latestExamId ? 0 : exam.status === "PUBLISHED" ? 1 : 2);
  return [...exams].sort((left, right) => rank(left) - rank(right));
}

async function loadStudentSnapshots(accessToken: string, examId: string, studentId: string) {
  const snapshots = await apiRequestOrNull<ReportSnapshotRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/snapshots`,
  );
  return (snapshots ?? []).filter((snapshot) => snapshot.status === "READY");
}

async function loadStudentReportData(
  accessToken: string,
  examId: string,
  selectedSnapshotId: string,
  studentId: string,
  mode: StudentDetailMode,
): Promise<StudentReportData> {
  const progressRequest = apiRequestOrNull<ReportStudentProgress>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/progress?scope=all`,
  );
  // Genel bakış yalnız gelişim grafiğini çizer; rapor sürümleri ve hata kitapçığı Sınav detaylarında yüklenir.
  if (mode === "dashboard") {
    return { errorBooklet: null, progress: await progressRequest, report: null, selectedSnapshot: null, snapshots: [] };
  }
  const snapshots = await loadStudentSnapshots(accessToken, examId, studentId);
  const selectedSnapshot = snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? snapshots[0] ?? null;
  const [report, errorBooklet, progress] = await Promise.all([
    selectedSnapshot
      ? apiRequestOrNull<ReportStudentSnapshot>(
          accessToken,
          `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(selectedSnapshot.id)}/students/${encodeURIComponent(studentId)}`,
        )
      : Promise.resolve(null),
    selectedSnapshot
      ? apiRequestOrNull<ReportErrorBooklet>(
          accessToken,
          `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(selectedSnapshot.id)}/students/${encodeURIComponent(studentId)}/error-booklet`,
        )
      : Promise.resolve(null),
    progressRequest,
  ]);
  return { errorBooklet, progress, report, selectedSnapshot, snapshots };
}

async function loadStudentHomeworkAssignments(accessToken: string, studentId: string) {
  return apiRequest<HomeworkMaterialAssignmentRecord[]>(
    accessToken,
    `${apiBaseUrl}/homework/material-assignments?studentId=${encodeURIComponent(studentId)}`,
  );
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL): Promise<T | null> {
  try {
    return await apiRequest<T>(accessToken, input);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) return null;
    throw error;
  }
}

function formatSnapshotLabel(snapshot: ReportSnapshotRecord, studentId: string) {
  const date = snapshot.generatedAt ?? snapshot.snapshotData?.generatedAt ?? snapshot.createdAt;
  const prefix = date ? new Date(date).toLocaleDateString("tr-TR") : "Rapor tarihi yok";
  const student = snapshot.snapshotData?.students?.find((record) => record.studentId === studentId);
  return `${prefix} - ${formatNetNumber(student?.total?.net)} net`;
}

function formatMoney(amount: number, currency: string) {
  return `${(amount / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} ${currency}`;
}

function formatPendingPayment(plans: PaymentPlanWithInstallmentsRecord[]) {
  const total = plans.reduce(
    (sum, plan) =>
      sum + plan.installments
        .filter((installment) => installment.status === "PENDING")
        .reduce((installmentSum, installment) => installmentSum + installment.amount, 0),
    0,
  );
  return formatMoney(total, plans[0]?.currency ?? "TRY");
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function formatCount(value: number) {
  return new Intl.NumberFormat("tr-TR").format(value);
}

function legacyReportScore(report: ReportStudentSnapshot | null | undefined) {
  return report?.total.estimatedRawScore ?? report?.total.standardScore ?? report?.total.rawScore;
}

function scoreViewLabel(view: NonNullable<ReportStudentSnapshot["scoreViews"]>[number]) {
  if (view.status === "MISSING_TYT") return "Bağlı TYT deneme puanı yok";
  if (view.status === "NOT_ELIGIBLE") return `${view.type} hesaplanamadı`;
  return `${view.type} deneme puanı`;
}

function preferredScoreView(report: ReportStudentSnapshot) {
  return report.scoreViews?.find((view) => view.status === "CALCULATED") ?? report.scoreViews?.[0];
}

function formatTeacherNoteSummary(notes: TeacherNoteRecord[]) {
  if (notes.length === 0) return "Öğretmen notu yok";
  return `${notes.length} not · son kayıt ${formatDate(notes[0]?.createdAt ?? "")}`;
}

function formatTeacherNoteVisibility(value: TeacherNoteRecord["visibility"]) {
  const labels: Record<TeacherNoteRecord["visibility"], string> = {
    GUARDIAN_STUDENT: "Veli/öğrenci görünür",
    INTERNAL: "Kurum içi",
  };
  return labels[value] ?? "Görünürlük kaydı";
}

function formatTeacherNoteDevelopmentStatus(value: string | undefined) {
  const labels: Record<string, string> = {
    IMPROVING: "Gelişim olumlu",
    WATCH: "Takipte",
  };
  return value ? labels[value] ?? "Gelişim durumu kayıtlı" : "Gelişim durumu yok";
}

function formatTeacherAssignmentRole(role: TeacherAssignmentRecord["role"]) {
  const labels: Record<TeacherAssignmentRecord["role"], string> = {
    BRANCH_TEACHER: "Branş öğretmeni",
    CLASS_TEACHER: "Sınıf öğretmeni",
    GUIDANCE_COUNSELOR: "Rehber öğretmen",
    RESPONSIBLE_TEACHER: "Sorumlu öğretmen",
  };
  return labels[role] ?? role;
}

function formatTeacherAssignmentScope(
  assignment: TeacherAssignmentRecord,
  classNames: ReadonlyMap<string, string>,
  courseNames: ReadonlyMap<string, string>,
  termNames: ReadonlyMap<string, string>,
) {
  const parts = [
    assignment.classId ? classNames.get(assignment.classId) ?? "Sınıf kaydı" : undefined,
    assignment.courseId ? courseNames.get(assignment.courseId) ?? "Ders kaydı" : undefined,
    assignment.termId ? termNames.get(assignment.termId) ?? "Dönem kaydı" : undefined,
    assignment.startsAt ? formatDate(assignment.startsAt) : undefined,
    assignment.endsAt ? formatDate(assignment.endsAt) : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? ` - ${parts.join(" · ")}` : "";
}

function formatTeacherAssignmentScopeLabel(
  assignment: TeacherAssignmentRecord,
  classNames: ReadonlyMap<string, string>,
  courseNames: ReadonlyMap<string, string>,
  termNames: ReadonlyMap<string, string>,
) {
  return formatTeacherAssignmentScope(assignment, classNames, courseNames, termNames).replace(/^ - /, "") || "Kapsam kaydı yok";
}

function formatStudentStatus(status: StudentProfileRecord["status"]) {
  const labels: Record<StudentProfileRecord["status"], string> = {
    ACTIVE: "Aktif",
    GRADUATED: "Mezun",
    PASSIVE: "Pasif",
    TRANSFERRED: "Nakil",
  };
  return labels[status] ?? "Durum bilinmiyor";
}

function studentStatusTone(status: StudentProfileRecord["status"]): StatusBadgeProps["tone"] {
  if (status === "ACTIVE") return "success";
  if (status === "GRADUATED" || status === "TRANSFERRED" || status === "PASSIVE") return "warning";
  return "neutral";
}

function formatCurrentClass(classId: string | undefined, classNameById: ReadonlyMap<string, string>) {
  return classId ? classNameById.get(classId) ?? "Sınıf kaydı" : "Sınıfsız";
}

function resolveActiveEnrollment(records: StudentEnrollmentRecord[]) {
  return records.find((record) => !record.endsAt) ?? records[0];
}

function formatEnrollmentAcademicContext(record: { termId?: string }, termNameById: ReadonlyMap<string, string>) {
  return record.termId ? termNameById.get(record.termId) ?? "Dönem kaydı" : "Akademik dönem yok";
}

function formatDateRange(startsAt: string | undefined, endsAt: string | undefined) {
  if (!startsAt && !endsAt) return "Tarih yok";
  const start = startsAt ? formatDate(startsAt) : "Başlangıç yok";
  return endsAt ? `${start} - ${formatDate(endsAt)}` : `${start} - devam ediyor`;
}

function formatEnrollmentReason(reason: string | undefined) {
  const labels: Record<string, string> = {
    CLASS_CHANGED: "Sınıf değişikliği",
    CREATED: "İlk kayıt",
    GRADE_LEVEL_CHANGED: "Seviye değişikliği",
    REACTIVATED: "Yeniden etkinleştirme",
    RENEWED: "Kayıt yenileme",
    TRANSFERRED: "Nakil",
  };
  // Bilinmeyen sistem kodu ham gösterilmez; serbest metin neden olduğu gibi yazılır.
  return reason ? labels[reason] ?? (/^[A-Z0-9_]+$/.test(reason) ? "Kayıt değişikliği" : reason) : "Kayıt";
}

function formatGuardianPermissionLabels(link: GuardianStudentRecord, includeFinance = true) {
  const permissions = [
    includeFinance ? `Finans görünürlüğü: ${link.canViewFinance ? "açık" : "kapalı"}` : undefined,
    isSmsEnabled ? `SMS: ${link.canReceiveSms ? "açık" : "kapalı"}` : undefined,
    `Duyuru: ${link.canReceiveAnnouncements ? "açık" : "kapalı"}`,
    `Destek: ${link.canOpenSupportTickets ? "açık" : "kapalı"}`,
  ].filter(Boolean);
  return permissions.join(", ");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("tr-TR", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function formatDate(value: string) {
  return new Date(value).toLocaleDateString("tr-TR");
}

function maskPhoneNumber(value: string | undefined) {
  if (!value) return "-";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 0) return "Telefon kayıtlı";
  return `••• ••• ••${digits.slice(-2).padStart(2, "•")}`;
}

function maskEmail(value: string | undefined) {
  if (!value) return "-";
  const [localPart = "", domain = ""] = value.split("@");
  if (!domain) return "E-posta kayıtlı";
  const visible = localPart.slice(0, 2).padEnd(Math.min(localPart.length, 2), "•");
  return `${visible || "••"}••@${domain.replace(/^[^.]*/, "•••")}`;
}

function toStudentExamResult(report: ReportStudentSnapshot | null) {
  return {
    correct: report?.total?.correct ?? 0,
    wrong: report?.total?.wrong ?? 0,
    blank: report?.total?.blank ?? 0,
    net: report?.total?.net ?? 0,
    questionCount: report?.total?.questionCount ?? reportQuestionCount(report?.total),
    successRate: report?.total?.successRate ?? reportSuccessRate(report?.total),
  };
}

function toStudentBranchRadar(report: ReportStudentSnapshot | null) {
  return (report?.branches ?? []).map((branch) => ({
    branch: formatCourseName(branch.branch),
    chartLabel: shortCourseName(branch.branch),
    blank: branch.blank,
    correct: branch.correct,
    net: branch.net ?? 0,
    questionCount: branch.questionCount ?? reportQuestionCount(branch),
    successRate: branch.successRate ?? reportSuccessRate(branch),
    wrong: branch.wrong,
  }));
}

function toStudentOutcomeRows(report: ReportStudentSnapshot | null) {
  return sortOutcomesWeakestFirst(report?.outcomes ?? [], reportSuccessRate)
    .map((outcome, index) => ({
      courseName: formatCourseName(outcome.branch),
      id: `${outcome.branch}-${outcome.outcomeCode}-${index}`,
      net: outcome.net,
      outcomeCode: formatOutcomeCode(outcome.outcomeCode),
      questionCount: outcome.questionCount ?? reportQuestionCount(outcome),
      successRate: outcome.successRate ?? reportSuccessRate(outcome),
    }));
}

function toProgressPoints(progress: ReportStudentProgress | null) {
  return progress?.points ?? [];
}
