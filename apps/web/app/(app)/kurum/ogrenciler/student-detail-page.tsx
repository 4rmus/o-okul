"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type {
  AcademicTermRecord,
  AttendanceSummaryRecord,
  ClassRecord,
  CourseRecord,
  ExamRecord,
  GuardianRecord,
  GuardianStudentRecord,
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportErrorBooklet,
  ReportStudentQuestionSummary,
  ReportSnapshotRecord,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentEnrollmentRecord,
  StudentAuditSummaryRecord,
  StudentProfileRecord,
  TeacherAssignmentRecord,
  TeacherNoteRecord,
  TeacherRecord,
} from "@o-okul/shared-types";
import { ArrowLeft, BarChart3, ChevronRight, LayoutDashboard } from "lucide-react";
import { ActionCard, DataTable, Field, InfoGrid, InfoItem, Panel, Select, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { isSmsEnabled } from "../../../../src/sms-feature.js";
import { PageFrame } from "../_shared/page-frame.js";
import { hasCapabilityForRoles } from "../../_shared/access.js";
import { formatCourseName, formatOutcomeCode, shortCourseName } from "../../_shared/academic-labels.js";
import { ExamResultDonut, ProgressLineChart, TopicRadarChart } from "../../_shared/lazy-report-charts.js";
import { formatNetNumber, OutcomeNetTable } from "../../_shared/outcome-net-table.js";
import { ReportChartPanel } from "../../_shared/report-chart-panel.js";
import { formatPercentDelta, formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../../_shared/report-metrics.js";
import { fallbackReportExamId, readReportExamId } from "../../_shared/report-exam-selection.js";
import { OperationSummary, type OperationSummaryAction, type OperationSummaryBadge, type OperationSummaryItem } from "../_shared/operation-summary.js";
import { RevealablePhone } from "../_shared/revealable-phone.js";

interface StudentBaseDetail {
  attendanceSummary: AttendanceSummaryRecord | null;
  auditLogs: StudentAuditSummaryRecord[];
  classes: ClassRecord[];
  courses: CourseRecord[];
  guardianLinks: GuardianStudentRecord[];
  profile: StudentProfileRecord;
  guardians: GuardianRecord[];
  homeworkAssignments: HomeworkMaterialAssignmentRecord[];
  paymentPlans: PaymentPlanWithInstallmentsRecord[];
  enrollments: StudentEnrollmentRecord[];
  teacherAssignments: TeacherAssignmentRecord[];
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
  detail: ReactNode;
  id: string;
  meta?: string;
  primary: string;
  status?: string;
  tone?: StatusBadgeProps["tone"];
}

interface StudentRelationshipItem {
  detail: string;
  id: string;
  label: string;
}

interface StudentRelationshipData {
  classNode: StudentRelationshipItem;
  guardians: StudentRelationshipItem[];
  student: StudentRelationshipItem;
  teachers: StudentRelationshipItem[];
}

const studentDetailTableColumns: Array<DataTableColumn<StudentDetailTableRow>> = [
  {
    key: "primary",
    header: "Kayıt",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => row.primary,
    sticky: "left",
  },
  {
    key: "status",
    header: "Durum",
    mobilePriority: "secondary",
    priority: "secondary",
    render: (row) => row.status ? <StatusBadge tone={row.tone ?? "info"}>{row.status}</StatusBadge> : "-",
  },
  {
    key: "detail",
    header: "Bağlam",
    mobilePriority: "primary",
    priority: "primary",
    render: (row) => row.detail,
  },
  {
    key: "meta",
    header: "Tarih",
    mobilePriority: "secondary",
    priority: "optional",
    render: (row) => row.meta ?? "-",
  },
];

export function StudentDetailPage({ mode = "dashboard", studentId }: { mode?: StudentDetailMode; studentId: string }) {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const requestedReportExamId = readReportExamId(searchParams);
  const canViewFinance = hasCapabilityForRoles(auth?.session.roles ?? [], "finance:manage");
  const canRevealPhone = hasCapabilityForRoles(auth?.session.roles ?? [], "privacy:manage");
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
  const exams = pageDataQuery.data?.exams ?? [];
  const activeExamId = selectedExamId || preferredExamId(exams, requestedReportExamId);
  const reportDataQuery = useQuery({
    queryKey: [
      "next-student-detail-report-data",
      auth?.session.tenantId ?? "anonymous",
      activeExamId,
      selectedSnapshotId || "auto",
      studentId,
    ],
    queryFn: () => loadStudentReportData(auth?.accessToken ?? "", activeExamId, selectedSnapshotId, studentId),
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
      subtitle={mode === "exams" ? "Sınav detayları" : "Öğrenci dashboard"}
      actions={
        <div className="next-student-detail-actions">
          <Link className="uh-button uh-button--secondary" href="/kurum/ogrenciler">
            <ArrowLeft size={17} aria-hidden="true" />
            Öğrencilere dön
          </Link>
          {mode === "exams" ? (
            <Link className="uh-button uh-button--secondary" href={studentDashboardHref}>
              <LayoutDashboard size={17} aria-hidden="true" />
              Dashboard'a dön
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
          aria-label={mode === "exams" ? "Öğrenci sınav detayları" : "Öğrenci dashboard"}
          className="next-detail-state-panel"
          title={mode === "exams" ? "Öğrenci sınav detayları" : "Öğrenci dashboard"}
        >
          <p>Yükleniyor...</p>
        </Panel>
      ) : pageDataQuery.isError ? (
        <Panel
          aria-label={mode === "exams" ? "Öğrenci sınav detayları" : "Öğrenci dashboard"}
          className="next-detail-state-panel"
          title={mode === "exams" ? "Öğrenci sınav detayları" : "Öğrenci dashboard"}
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
          canRevealPhone={canRevealPhone}
          canViewFinance={canViewFinance}
          courseNameById={courseNameById}
          detail={detail}
          errorBooklet={errorBooklet}
          guardianNameById={guardianNameById}
          progress={progress}
          progressPoints={progressPoints}
          report={report}
          selectedSnapshot={selectedSnapshot}
          studentAuditLogs={studentAuditLogs}
          studentExamsHref={studentExamsHref}
          studentId={studentId}
          termNameById={termNameById}
          teacherNameById={teacherNameById}
        />
      ) : null}
    </PageFrame>
  );
}

function StudentDashboard({
  classNameById,
  canRevealPhone,
  canViewFinance,
  courseNameById,
  detail,
  errorBooklet,
  guardianNameById,
  progress,
  progressPoints,
  report,
  selectedSnapshot,
  studentAuditLogs,
  studentExamsHref,
  studentId,
  teacherNameById,
  termNameById,
}: {
  classNameById: ReadonlyMap<string, string>;
  canRevealPhone: boolean;
  canViewFinance: boolean;
  courseNameById: ReadonlyMap<string, string>;
  detail: StudentBaseDetail;
  errorBooklet: ReportErrorBooklet | null;
  guardianNameById: ReadonlyMap<string, string>;
  progress: ReportStudentProgress | null;
  progressPoints: ReturnType<typeof toProgressPoints>;
  report: ReportStudentSnapshot | null;
  selectedSnapshot: ReportSnapshotRecord | null;
  studentAuditLogs: StudentAuditSummaryRecord[];
  studentExamsHref: string;
  studentId: string;
  teacherNameById: ReadonlyMap<string, string>;
  termNameById: ReadonlyMap<string, string>;
}) {
  const currentClass = formatCurrentClass(detail.profile.classId, classNameById);
  const guardianLink = detail.guardianLinks[0];
  const guardianLinkName = guardianLink ? guardianNameById.get(guardianLink.guardianId) ?? "Veli kaydı" : "Veli bağı yok";
  const activeEnrollment = resolveActiveEnrollment(detail.enrollments);
  const studentDashboardSummaryItems = buildStudentDashboardSummaryItems(detail, report, progress, currentClass);
  const studentDashboardSummaryBadges = buildStudentDashboardSummaryBadges(detail, report, guardianLink);
  const studentDashboardSummaryActions = buildStudentDashboardSummaryActions({
    detail,
    errorBooklet,
    canViewFinance,
    primaryGuardianName: guardianLinkName,
    progress,
    report,
    selectedSnapshot,
  });
  const relationshipData = buildStudentRelationshipData({
    activeEnrollment,
    classNameById,
    courseNameById,
    currentClass,
    detail,
    guardianNameById,
    teacherNameById,
    termNameById,
  });

  return (
    <section className="next-detail-workspace" aria-label="Öğrenci dashboard">
      <OperationSummary
        actions={studentDashboardSummaryActions}
        ariaLabel="Öğrenci detay operasyon özeti"
        badges={studentDashboardSummaryBadges}
        items={studentDashboardSummaryItems}
      />
      <Panel
        actions={
          <Link className="uh-button" href={studentExamsHref}>
            <BarChart3 size={17} aria-hidden="true" />
            Sınav detayları
          </Link>
        }
        aria-label="Öğrenci profil kartı"
        description="Kayıt durumu, sınıf, veli ve rapor bağlamı ham öğrenci anahtarı göstermeden tek yüzeyde okunur."
        title="Öğrenci profili"
      >
        <InfoGrid className="next-student-profile-info" aria-label="Öğrenci profil özeti" role="region">
          <InfoItem
            label="Kayıt durumu"
            value={<StatusBadge tone={studentStatusTone(detail.profile.status)}>{formatStudentStatus(detail.profile.status)}</StatusBadge>}
          />
          <InfoItem label="Kurum sınıfı" value={currentClass} />
          <InfoItem label="Veli bağlantısı" value={guardianLinkName} />
          <InfoItem label="Öğrenci no" value={detail.profile.studentNo ?? "Öğrenci no yok"} />
        </InfoGrid>
      </Panel>

      <ReportChartPanel description="Hazır raporu olan tüm sınavlardaki başarı yüzdesi, net ve standart puan gelişimi" title="Öğrenci Gelişim Grafiği">
        <ProgressLineChart caption="Tüm sınav başarı gelişimi" points={progressPoints} />
      </ReportChartPanel>

      <Panel
        aria-label="Öğrenci ilişki haritası"
        className="next-student-relationship-section"
        description="Sınıf, veli ve öğretmen bağları öğrenci merkezli ve liste görünümünde gösterilir."
        title="İlişki haritası"
      >
        <div className="next-student-relationship-fallback" aria-label="İlişki haritası liste görünümü">
          <RelationshipList title="Öğrenci" items={[relationshipData.student]} />
          <RelationshipList title="Sınıf" items={[relationshipData.classNode]} />
          <RelationshipList title="Veliler" items={relationshipData.guardians} />
          <RelationshipList title="Öğretmenler" items={relationshipData.teachers} />
        </div>
      </Panel>

      <Panel
        aria-label="Öğrenci karar kartları"
        description="Rapor, kayıt, veli ve takip odağı günlük operasyon kararları için özetlenir."
        title="Karar alanları"
      >
        <div className="next-student-decision-grid">
          <ActionCard
            as="a"
            className="next-student-decision-card"
            detail={
              <>
                {selectedSnapshot ? formatSnapshotLabel(selectedSnapshot, studentId) : "Hazır rapor bekleniyor"}
                <ChevronRight size={15} aria-hidden="true" />
              </>
            }
            href={studentExamsHref}
            label="Sınav performansı"
            tone="info"
            value={formatPercentNumber(reportSuccessRate(report?.total))}
          />
          <ActionCard
            className="next-student-decision-card"
            detail={activeEnrollment ? `${formatEnrollmentReason(activeEnrollment.reason)} · ${formatDate(activeEnrollment.startsAt)}` : "Aktif kayıt bulunamadı"}
            label="Kurum bağı"
            tone="info"
            value={currentClass}
          />
          <ActionCard
            className="next-student-decision-card"
            detail={guardianLink ? "İzinler veli bağlantısında kontrollü gösterilir" : "Veli izinleri tanımlı değil"}
            label="Veli erişimi"
            tone={guardianLink ? "success" : "warning"}
            value={guardianLinkName}
          />
          <ActionCard
            className="next-student-decision-card"
            detail={formatTeacherNoteSummary(detail.teacherNotes)}
            label="Takip odağı"
            tone={errorBooklet ? "warning" : "success"}
            value={errorBooklet ? `${errorBooklet.items.length} soru` : "Hata yok"}
          />
        </div>
      </Panel>

      <div className="next-student-detail-grid">
        <Panel
          aria-label="İletişim ve veli"
          className="next-student-detail-panel next-student-detail-panel--wide"
          description="Öğrenci telefonu ve e-postası maskeli kalır; veli telefonu yetkili kullanıcı isterse açılıp gizlenebilir."
          title="İletişim ve veli"
        >
          <StudentDetailRowsTable
            caption="İletişim ve veli kayıtları"
            emptyText="İletişim kaydı yok"
            rows={buildContactRows(detail, { canRevealPhone })}
          />
        </Panel>

        <Panel
          aria-label="İlişki geçmişi"
          className="next-student-detail-panel next-student-detail-panel--wide"
          description={
            canViewFinance
              ? "Finans görünürlüğü ve bildirim izinleri kontrollü özet diliyle gösterilir."
              : "Bildirim ve destek izinleri kontrollü özet diliyle gösterilir."
          }
          title="İlişki geçmişi"
        >
          <StudentDetailRowsTable
            caption="Veli ilişki geçmişi"
            emptyText="Veli ilişkisi yok"
            rows={buildGuardianRelationshipRows(detail.guardianLinks, guardianNameById, canViewFinance)}
          />
        </Panel>

        <Panel
          aria-label="Öğretmen ilişkileri"
          className="next-student-detail-panel next-student-detail-panel--wide"
          description="Sorumlu öğretmen, branş, sınıf ve dönem bağları güvenli referans metinleriyle okunur."
          title="Öğretmen ilişkileri"
        >
          <StudentDetailRowsTable
            caption="Öğretmen ilişki kayıtları"
            emptyText="Öğretmen ilişkisi yok"
            rows={buildTeacherAssignmentRows(detail.teacherAssignments, teacherNameById, classNameById, courseNameById, termNameById)}
          />
        </Panel>

        <Panel
          aria-label="Öğretmen notları"
          className="next-student-detail-panel"
          description="Not gövdesi açılmadan görünürlük, gelişim durumu ve tarih bağlamı verilir."
          title="Öğretmen notları"
        >
          <StudentDetailRowsTable
            caption="Öğretmen not kayıtları"
            emptyText="Not yok"
            rows={buildTeacherNoteRows(detail.teacherNotes)}
          />
        </Panel>

        <Panel
          aria-label="Kayıt geçmişi"
          className="next-student-detail-panel next-student-detail-panel--wide"
          description="Kayıt başlangıcı, durum ve akademik dönem geçmişi operasyon bağlamında listelenir."
          title="Kayıt geçmişi"
        >
          <StudentDetailRowsTable
            caption="Kayıt geçmişi kayıtları"
            emptyText="Kayıt geçmişi yok"
            rows={buildEnrollmentRows(detail.enrollments, classNameById, termNameById)}
          />
        </Panel>

        <Panel
          aria-label="Ödevler"
          className="next-student-detail-panel"
          description="Bu öğrenciye atanmış materyal ve ödev sayısı."
          title="Ödevler"
        >
          <StudentDetailRowsTable
            caption="Öğrenci ödev kayıtları"
            emptyText="Ödev yok"
            rows={buildHomeworkRows(detail.homeworkAssignments, courseNameById, termNameById)}
          />
        </Panel>

        <Panel
          aria-label="Denetim özeti"
          className="next-student-detail-panel next-student-detail-panel--wide"
          description="Öğrenciye özel özet denetim kayıtları aksiyon etiketiyle gösterilir; ham denetim ayrıntıları açılmaz."
          title="Denetim özeti"
        >
          <StudentDetailRowsTable
            caption="Öğrenci denetim kayıtları"
            emptyText="Denetim kaydı yok"
            rows={buildAuditRows(studentAuditLogs)}
          />
        </Panel>
      </div>
    </section>
  );
}

function RelationshipList({ items, title }: { items: StudentRelationshipItem[]; title: string }) {
  return (
    <section>
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item.id}>
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p>Tanımlı kayıt yok.</p>
      )}
    </section>
  );
}

function StudentDetailRowsTable({
  caption,
  emptyText,
  rows,
}: {
  caption: string;
  emptyText: string;
  rows: StudentDetailTableRow[];
}) {
  return (
    <DataTable
      caption={caption}
      columns={studentDetailTableColumns}
      density="compact"
      emptyText={emptyText}
      getRowKey={(row) => row.id}
      rows={rows}
    />
  );
}

function buildContactRows(detail: StudentBaseDetail, options: { canRevealPhone: boolean }): StudentDetailTableRow[] {
  return [
    {
      detail: maskPhoneNumber(detail.profile.phone),
      id: "student-phone",
      meta: "Profil",
      primary: "Öğrenci telefonu",
      status: "Maskeli",
      tone: "success",
    },
    {
      detail: maskEmail(detail.profile.email),
      id: "student-email",
      meta: "Profil",
      primary: "Öğrenci e-postası",
      status: "Maskeli",
      tone: "success",
    },
    ...detail.guardians.map((guardian): StudentDetailTableRow => ({
      detail: <RevealablePhone canReveal={options.canRevealPhone} value={guardian.phone} />,
      id: `guardian-contact-${guardian.id}`,
      meta: "Veli iletişimi",
      primary: `${guardian.firstName} ${guardian.lastName}`,
      status: "Veli",
      tone: "info",
    })),
  ];
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
    status: "Veli bağlantısı",
    tone: "info",
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
    detail: "Not gövdesi kapalı; yalnız görünürlük ve gelişim durumu gösterilir",
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
    status: formatStudentStatus(record.status),
    tone: studentStatusTone(record.status),
  }));
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
    status: assignment.dueAt ? "Teslim tarihi" : "Atandı",
    tone: assignment.dueAt ? "warning" : "info",
  }));
}

function buildAuditRows(records: StudentAuditSummaryRecord[]): StudentDetailTableRow[] {
  return records.map((record) => ({
    detail: "Ham denetim alanları gizli",
    id: record.id,
    meta: formatDateTime(record.createdAt),
    primary: record.actionLabel,
    status: "Özet",
    tone: "info",
  }));
}

function buildStudentDashboardSummaryItems(
  detail: StudentBaseDetail,
  report: ReportStudentSnapshot | null,
  progress: ReportStudentProgress | null,
  currentClass: string,
): OperationSummaryItem[] {
  const successRate = reportSuccessRate(report?.total);
  return [
    {
      description: currentClass,
      key: "status",
      label: "Kayıt durumu",
      tone: detail.profile.status === "ACTIVE" ? "success" : detail.profile.status === "PASSIVE" ? "warning" : "default",
      value: formatStudentStatus(detail.profile.status),
    },
    {
      description: `Net ${formatNetNumber(report?.total?.net)} / Soru ${formatNumber(reportQuestionCount(report?.total))}`,
      key: "success-rate",
      label: "Başarı %",
      tone: successRate === undefined ? "default" : "success",
      value: formatPercentNumber(successRate),
    },
    {
      description: `${formatCount(detail.guardians.length)} veli kaydı`,
      key: "guardians",
      label: "Veli bağı",
      tone: detail.guardianLinks.length > 0 ? "info" : "warning",
      value: formatCount(detail.guardianLinks.length),
    },
    {
      description: `Başarı gelişimi ${formatPercentDelta(progress?.successRateDelta)}`,
      key: "follow-up",
      label: "Takip odağı",
      tone: detail.teacherNotes.length > 0 ? "info" : "default",
      value: `${formatCount(detail.teacherNotes.length)} not`,
    },
  ];
}

function buildStudentDashboardSummaryBadges(
  detail: StudentBaseDetail,
  report: ReportStudentSnapshot | null,
  primaryGuardian: GuardianStudentRecord | undefined,
): OperationSummaryBadge[] {
  return [
    {
      key: "status",
      label: `${formatStudentStatus(detail.profile.status)} öğrenci`,
      tone: studentStatusTone(detail.profile.status),
    },
    {
      key: "report",
      label: report ? "Rapor hazır" : "Hazır rapor bekleniyor",
      tone: report ? "success" : "warning",
    },
    {
      key: "audit",
      label: detail.auditLogs.length > 0 ? "Denetim özeti var" : "Denetim kaydı yok",
      tone: detail.auditLogs.length > 0 ? "info" : "neutral",
    },
    {
      key: "guardian",
      label: primaryGuardian ? "Veli bağlantısı var" : "Veli bağlantısı yok",
      tone: primaryGuardian ? "success" : "warning",
    },
    {
      key: "pii",
      label: "PII maskeli",
      tone: "success",
    },
  ];
}

function buildStudentDashboardSummaryActions({
  canViewFinance,
  detail,
  errorBooklet,
  primaryGuardianName,
  progress,
  report,
  selectedSnapshot,
}: {
  canViewFinance: boolean;
  detail: StudentBaseDetail;
  errorBooklet: ReportErrorBooklet | null;
  primaryGuardianName: string;
  progress: ReportStudentProgress | null;
  report: ReportStudentSnapshot | null;
  selectedSnapshot: ReportSnapshotRecord | null;
}): OperationSummaryAction[] {
  return [
    {
      detail: selectedSnapshot ? `${formatSnapshotLabel(selectedSnapshot, detail.profile.id)} raporu` : "Sınav detaylarında hazır rapor beklenir",
      key: "exam-performance",
      label: "Sınav performansı",
      status: report ? "Hazır" : "Bekliyor",
      tone: report ? "success" : "warning",
      value: formatPercentNumber(reportSuccessRate(report?.total)),
    },
    {
      detail: `${formatCount(detail.guardianLinks.length)} veli / ${formatCount(detail.teacherAssignments.length)} öğretmen`,
      key: "relationship-map",
      label: "İlişki kontrolü",
      status: detail.guardianLinks.length > 0 && detail.teacherAssignments.length > 0 ? "Bağlı" : "Eksik",
      tone: detail.guardianLinks.length > 0 && detail.teacherAssignments.length > 0 ? "info" : "warning",
      value: primaryGuardianName,
    },
    {
      detail: canViewFinance
        ? `${formatPendingPayment(detail.paymentPlans)} bekleyen ödeme; başarı gelişimi ${formatPercentDelta(progress?.successRateDelta)}`
        : `Finans bilgisi yetkiye bağlı; başarı gelişimi ${formatPercentDelta(progress?.successRateDelta)}`,
      key: "finance-and-follow-up",
      label: canViewFinance ? "Finans ve takip" : "Takip yetkisi",
      status: errorBooklet ? "Takip" : "Normal",
      tone: errorBooklet ? "warning" : "neutral",
      value: errorBooklet ? `${formatCount(errorBooklet.items.length)} hata sorusu` : formatTeacherNoteSummary(detail.teacherNotes),
    },
  ];
}

function buildStudentRelationshipData({
  activeEnrollment,
  classNameById,
  courseNameById,
  currentClass,
  detail,
  guardianNameById,
  teacherNameById,
  termNameById,
}: {
  activeEnrollment: StudentEnrollmentRecord | undefined;
  classNameById: ReadonlyMap<string, string>;
  courseNameById: ReadonlyMap<string, string>;
  currentClass: string;
  detail: StudentBaseDetail;
  guardianNameById: ReadonlyMap<string, string>;
  teacherNameById: ReadonlyMap<string, string>;
  termNameById: ReadonlyMap<string, string>;
}): StudentRelationshipData {
  return {
    student: {
      id: detail.profile.id,
      label: `${detail.profile.firstName} ${detail.profile.lastName}`,
      detail: formatStudentStatus(detail.profile.status),
    },
    classNode: {
      id: detail.profile.classId ?? "no-class",
      label: currentClass,
      detail: activeEnrollment
        ? `${formatEnrollmentReason(activeEnrollment.reason)} · ${formatDate(activeEnrollment.startsAt)}`
        : "Aktif kayıt bulunamadı",
    },
    guardians: detail.guardianLinks.map((link) => ({
      id: link.id,
      label: guardianNameById.get(link.guardianId) ?? "Veli kaydı",
      detail: [
        "Veli bağlantısı",
        "İzinler bağlantı kapsamında",
      ].filter(Boolean).join(" · "),
    })),
    teachers: detail.teacherAssignments.map((assignment) => ({
      id: assignment.id,
      label: teacherNameById.get(assignment.teacherId) ?? "Öğretmen kaydı",
      detail: [
        formatTeacherAssignmentRole(assignment.role),
        formatTeacherAssignmentScope(assignment, classNameById, courseNameById, termNameById).replace(/^ - /, ""),
      ].filter(Boolean).join(" · "),
    })),
  };
}

function StudentExamDetails({
  branchRadar,
  errorBooklet,
  examResult,
  exams,
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
  const examSummaryItems = buildStudentExamSummaryItems(report, errorBooklet, progress);
  const examSummaryBadges = buildStudentExamSummaryBadges(report, selectedSnapshot, snapshots);
  const examSummaryActions = buildStudentExamSummaryActions(report, errorBooklet, progress, outcomeRows);
  const selectedExam = exams.find((exam) => exam.id === selectedExamId);

  return (
    <section className="next-detail-workspace" aria-label="Öğrenci sınav detayları">
      <OperationSummary
        actions={examSummaryActions}
        ariaLabel="Öğrenci sınav operasyon özeti"
        badges={examSummaryBadges}
        items={examSummaryItems}
      />
      <Panel
        actions={<StatusBadge tone={report ? "success" : "warning"}>{report ? "Rapor hazır" : "Hazır rapor yok"}</StatusBadge>}
        aria-label="Öğrenci sınav rapor bağlamı"
        description="Sınav ve hazır rapor seçimi başarı yüzdesi, net, soru ve hata kitapçığı bağlamını belirler."
        title="Rapor bağlamı"
      >
        <div className="next-detail-selects">
          <Field label="Sınav">
            <Select aria-label="Sınav" value={selectedExamId} onChange={(event) => onExamChange(event.target.value)}>
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Sınav raporu">
            <Select
              aria-label="Sınav raporu"
              disabled={snapshots.length === 0}
              value={selectedSnapshot?.id ?? ""}
              onChange={(event) => onSnapshotChange(event.target.value)}
            >
              {snapshots.length === 0 ? <option value="">Hazır rapor yok</option> : null}
              {snapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {formatSnapshotLabel(snapshot, studentId)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <InfoGrid className="next-student-report-context" aria-label="Öğrenci rapor bağlam özeti" role="region">
          <InfoItem label="Sınav" value={selectedExam?.title ?? "Sınav seçilmedi"} />
          <InfoItem label="Rapor tarihi" value={selectedSnapshot ? formatSnapshotLabel(selectedSnapshot, studentId) : "Hazır rapor yok"} />
          <InfoItem label="Başarı %" value={formatPercentNumber(reportSuccessRate(report?.total))} />
          <InfoItem label="Net" value={formatNetNumber(report?.total?.net)} />
          <InfoItem label="Soru" value={formatNumber(reportQuestionCount(report?.total))} />
          <InfoItem label="LGS puanı" value={formatNumber(readLgsScore(report?.total))} />
          <InfoItem label="Standart puan" value={formatNumber(report?.total?.standardScore)} />
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
            <ReportChartPanel description="Kazanım bazlı başarı ve net karşılaştırması" title="Kazanım Başarıları">
              <OutcomeNetTable caption="Öğrenci kazanım başarıları" rows={outcomeRows} />
            </ReportChartPanel>
            <ReportChartPanel description="Başarı yüzdesi, net ve standart puan gelişimi" title="Öğrenci Gelişim">
              <ProgressLineChart caption="Öğrenci başarı gelişimi" points={progressPoints} />
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
          <p>Bu öğrenci için seçili sınava ait hazır rapor bulunamadı.</p>
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
      description: `Başarı gelişimi ${formatPercentDelta(progress?.successRateDelta)}`,
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
      description: `Standart ${formatNumber(report?.total?.standardScore)}`,
      key: "score",
      label: "Puan",
      value: formatNumber(readLgsScore(report?.total)),
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
    {
      key: "snapshot",
      label: selectedSnapshot ? "Snapshot seçili" : "Snapshot bekleniyor",
      tone: selectedSnapshot ? "info" : "neutral",
    },
    {
      key: "history",
      label: `${formatCount(snapshots.length)} hazır rapor`,
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
      detail: `Başarı gelişimi ${formatPercentDelta(progress?.successRateDelta)}`,
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
  const [
    attendanceSummary,
    auditLogs,
    guardianLinks,
    profile,
    guardians,
    homeworkAssignments,
    paymentPlans,
    enrollments,
    teacherAssignments,
    teachers,
    teacherNotes,
    classes,
    courses,
    terms,
  ] = await Promise.all([
    apiRequestOrNull<AttendanceSummaryRecord>(accessToken, `${apiBaseUrl}/attendance/summary?studentId=${encodeURIComponent(id)}`),
    apiRequestOrNull<StudentAuditSummaryRecord[]>(
      accessToken,
      `${apiBaseUrl}/audit-logs/student-summary?studentId=${encodeURIComponent(id)}&limit=5`,
    ),
    apiRequest<GuardianStudentRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardian-links`),
    apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/profile`),
    apiRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardians`),
    loadStudentHomeworkAssignments(accessToken, id),
    options.canViewFinance
      ? apiRequest<PaymentPlanWithInstallmentsRecord[]>(accessToken, `${apiBaseUrl}/payment-plans?studentId=${encodeURIComponent(id)}`)
      : Promise.resolve([]),
    apiRequest<StudentEnrollmentRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/enrollments`),
    apiRequest<TeacherAssignmentRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/teacher-assignments`),
    apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`),
    apiRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/teacher-notes?studentId=${encodeURIComponent(id)}`),
    apiRequest<ClassRecord[]>(accessToken, `${apiBaseUrl}/classes`),
    apiRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`),
    apiRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`),
  ]);
  return {
    attendanceSummary,
    auditLogs: auditLogs ?? [],
    classes,
    courses,
    guardianLinks,
    guardians,
    homeworkAssignments,
    paymentPlans,
    profile,
    enrollments,
    teacherAssignments,
    teachers,
    teacherNotes,
    terms,
  };
}

async function loadExams(accessToken: string): Promise<ExamRecord[]> {
  const exams = await apiRequestOrNull<ExamRecord[]>(accessToken, `${apiBaseUrl}/exams`);
  return exams && exams.length > 0
    ? exams
    : [{
        id: fallbackReportExamId,
        tenantId: "",
        title: "Demo sınav",
        status: "PUBLISHED",
        createdAt: "",
        updatedAt: "",
      }];
}

function preferredExamId(exams: ExamRecord[], requestedExamId = fallbackReportExamId) {
  return exams.find((exam) => exam.id === requestedExamId)?.id
    ?? exams.find((exam) => exam.status === "PUBLISHED")?.id
    ?? exams[0]?.id
    ?? requestedExamId;
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
): Promise<StudentReportData> {
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
    apiRequestOrNull<ReportStudentProgress>(
      accessToken,
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/progress?scope=all`,
    ),
  ]);
  return { errorBooklet, progress, report, selectedSnapshot, snapshots };
}

async function loadStudentHomeworkAssignments(accessToken: string, studentId: string) {
  const materials = await apiRequest<HomeworkMaterialRecord[]>(accessToken, `${apiBaseUrl}/homework/materials`);
  const assignmentLists = await Promise.all(
    materials.map((material) =>
      apiRequest<HomeworkMaterialAssignmentRecord[]>(
        accessToken,
        `${apiBaseUrl}/homework/materials/${encodeURIComponent(material.id)}/assignments`,
      ),
    ),
  );
  return assignmentLists.flat().filter((assignment) => assignment.studentId === studentId);
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL): Promise<T | null> {
  try {
    return await apiRequest<T>(accessToken, input);
  } catch {
    return null;
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
        .filter((installment) => installment.status === "PENDING" || installment.status === "OVERDUE")
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

function readLgsScore(total: { estimatedRawScore?: number; standardScore?: number } | undefined) {
  return total?.estimatedRawScore ?? total?.standardScore;
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
    RENEWED: "Kayıt yenileme",
    TRANSFERRED: "Nakil",
  };
  return reason ? labels[reason] ?? reason : "Kayıt";
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
  return [...(report?.outcomes ?? [])]
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

function toProgressPoints(progress: ReportStudentProgress | null) {
  return progress?.points ?? [];
}
