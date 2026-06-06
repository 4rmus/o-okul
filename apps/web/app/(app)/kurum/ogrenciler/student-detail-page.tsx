"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type {
  AcademicTermRecord,
  AttendanceSummaryRecord,
  AuditLogRecord,
  ClassRecord,
  CourseRecord,
  ExamRecord,
  GuardianRecord,
  GuardianStudentRecord,
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportErrorBooklet,
  ReportSnapshotRecord,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentClassHistoryRecord,
  StudentEnrollmentRecord,
  StudentProfileRecord,
  TeacherAssignmentRecord,
  TeacherNoteRecord,
  TeacherRecord,
} from "@uzman-hocam/shared-types";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";
import { PageFrame } from "../_shared/page-frame.js";
import { MetricPanelGrid } from "../_shared/metric-panel-grid.js";
import { ClassCompareBar, ExamResultDonut, ProgressLineChart, TopicRadarChart } from "../../_shared/lazy-report-charts.js";
import { ReportChartPanel } from "../../_shared/report-chart-panel.js";

interface StudentBaseDetail {
  attendanceSummary: AttendanceSummaryRecord | null;
  auditLogs: AuditLogRecord[];
  classes: ClassRecord[];
  courses: CourseRecord[];
  guardianLinks: GuardianStudentRecord[];
  profile: StudentProfileRecord;
  guardians: GuardianRecord[];
  homeworkAssignments: HomeworkMaterialAssignmentRecord[];
  paymentPlans: PaymentPlanWithInstallmentsRecord[];
  classHistory: StudentClassHistoryRecord[];
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

const defaultExamId = "exam-demo-isem-lgs-1";

export function StudentDetailPage({ studentId }: { studentId: string }) {
  const { auth } = useAuth();
  const [selectedExamId, setSelectedExamId] = useState("");
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");

  const pageDataQuery = useQuery({
    queryKey: ["next-student-detail-page-data", auth?.session.tenantId ?? "anonymous", studentId],
    queryFn: () => loadStudentDetailPageData(auth?.accessToken ?? "", studentId),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });

  const reportDataQuery = useQuery({
    queryKey: [
      "next-student-detail-report-data",
      auth?.session.tenantId ?? "anonymous",
      selectedExamId,
      selectedSnapshotId || "auto",
      studentId,
    ],
    queryFn: () => loadStudentReportData(auth?.accessToken ?? "", selectedExamId, selectedSnapshotId, studentId),
    enabled: Boolean(auth && selectedExamId),
    refetchOnWindowFocus: false,
  });

  const detail = pageDataQuery.data?.detail;
  const studentAuditLogs = useMemo(
    () => (detail?.auditLogs ?? []).filter((record) => isStudentAuditLog(record, studentId)).slice(0, 5),
    [detail?.auditLogs, studentId],
  );
  const guardianNameById = useMemo(
    () => new Map((detail?.guardians ?? []).map((guardian) => [guardian.id, `${guardian.firstName} ${guardian.lastName}`])),
    [detail?.guardians],
  );
  const teacherNameById = useMemo(
    () => new Map((detail?.teachers ?? []).map((teacher) => [teacher.id, `${teacher.firstName} ${teacher.lastName}`])),
    [detail?.teachers],
  );
  const classNameById = useMemo(() => new Map((detail?.classes ?? []).map((record) => [record.id, record.name])), [detail?.classes]);
  const courseNameById = useMemo(() => new Map((detail?.courses ?? []).map((record) => [record.id, record.name])), [detail?.courses]);
  const termNameById = useMemo(() => new Map((detail?.terms ?? []).map((record) => [record.id, record.name])), [detail?.terms]);
  const exams = pageDataQuery.data?.exams ?? [];
  const snapshots = reportDataQuery.data?.snapshots ?? [];
  const selectedSnapshot = reportDataQuery.data?.selectedSnapshot ?? null;
  const report = reportDataQuery.data?.report ?? null;
  const errorBooklet = reportDataQuery.data?.errorBooklet ?? null;
  const progress = reportDataQuery.data?.progress ?? null;
  const studentName = detail ? `${detail.profile.firstName} ${detail.profile.lastName}` : "Öğrenci 360";
  const examResult = toStudentExamResult(report);
  const branchRadar = toStudentBranchRadar(report);
  const outcomeBars = toStudentOutcomeBars(report);
  const progressPoints = toProgressPoints(progress);

  useEffect(() => {
    if (exams.length === 0 || exams.some((exam) => exam.id === selectedExamId)) return;
    setSelectedExamId(exams[0]?.id ?? "");
    setSelectedSnapshotId("");
  }, [exams, selectedExamId]);

  return (
    <PageFrame
      title={studentName}
      subtitle="Öğrenci 360"
      actions={
        <Link className="uh-button uh-button--secondary" href="/kurum/ogrenciler">
          <ArrowLeft size={17} aria-hidden="true" />
          Öğrencilere dön
        </Link>
      }
    >

      <section className="next-report-panel" aria-label="Öğrenci 360 detay">
        <div className="next-detail-selects">
          <label>
            Sınav
            <select
              aria-label="Sınav"
              value={selectedExamId}
              onChange={(event) => {
                setSelectedExamId(event.target.value);
                setSelectedSnapshotId("");
              }}
            >
              {exams.map((exam) => (
                <option key={exam.id} value={exam.id}>
                  {exam.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sınav raporu
            <select
              aria-label="Sınav raporu"
              disabled={snapshots.length === 0}
              value={selectedSnapshot?.id ?? ""}
              onChange={(event) => setSelectedSnapshotId(event.target.value)}
            >
              {snapshots.length === 0 ? <option value="">Hazır rapor yok</option> : null}
              {snapshots.map((snapshot) => (
                <option key={snapshot.id} value={snapshot.id}>
                  {formatSnapshotLabel(snapshot, studentId)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {pageDataQuery.isPending ? (
          <p>Yükleniyor...</p>
        ) : pageDataQuery.isError ? (
          <p className="uh-crud-page__error">Öğrenci detayı alınamadı.</p>
        ) : detail ? (
          <>
            <MetricPanelGrid
              ariaLabel="Öğrenci özeti"
              metrics={[
                { label: "Devamsızlık", value: detail.attendanceSummary?.total ?? 0 },
                { label: "Bekleyen ödeme", value: formatPendingPayment(detail.paymentPlans) },
                { label: "Son net", value: formatNumber(report?.total?.net) },
                { label: "Hata kitapçığı", value: errorBooklet ? `${errorBooklet.items.length} soru` : "-" },
                { label: "Kayıt durumu", value: formatStudentStatus(detail.profile.status) },
                { label: "Net gelişimi", value: formatDelta(progress?.netDelta) },
                { label: "LGS puanı", value: formatNumber(readLgsScore(report?.total)) },
                { label: "Standart puan", value: formatNumber(report?.total?.standardScore) },
              ]}
            />
            <div className="next-report-visual-grid">
              <ReportChartPanel description="Soru bazlı doğruluk grafiği" title="Öğrenci Sonuç Dağılımı">
                <ExamResultDonut result={examResult} />
              </ReportChartPanel>
              <ReportChartPanel description="Rapor bazlı branş netleri" title="Branş Netleri">
                <TopicRadarChart branches={branchRadar} />
              </ReportChartPanel>
              <ReportChartPanel description="Kazanım bazlı net karşılaştırması" title="Kazanım Netleri">
                <ClassCompareBar classes={outcomeBars} />
              </ReportChartPanel>
              <ReportChartPanel description="Net ve standart puan gelişimi" title="Öğrenci Gelişim">
                <ProgressLineChart points={progressPoints} />
              </ReportChartPanel>
            </div>

            <div className="next-student-detail-grid">
              <section className="next-report-list" aria-label="İletişim ve veli">
                <h2>İletişim ve veli</h2>
                <p>Telefon: {detail.profile.phone ?? "-"}</p>
                <p>E-posta: {detail.profile.email ?? "-"}</p>
                {detail.guardians.length > 0 ? (
                  detail.guardians.map((guardian) => (
                    <p key={guardian.id}>
                      {guardian.firstName} {guardian.lastName}
                      {guardian.phone ? ` - ${guardian.phone}` : ""}
                    </p>
                  ))
                ) : (
                  <p>Bağlı veli yok</p>
                )}
              </section>

              <section className="next-report-list" aria-label="İlişki geçmişi">
                <h2>İlişki geçmişi</h2>
                {detail.guardianLinks.length > 0 ? (
                  detail.guardianLinks.map((link) => (
                    <p key={link.id}>
                      {guardianNameById.get(link.guardianId) ?? link.guardianId}: {formatRelationshipType(link.relationshipType)}
                      {link.isPrimary ? " - Birincil" : ""} - {formatGuardianPermissions(link)}
                      {link.createdAt ? ` - ${formatDateTime(link.createdAt)} tarihinde bağlandı` : ""}
                    </p>
                  ))
                ) : (
                  <p>Veli ilişkisi yok</p>
                )}
              </section>

              <section className="next-report-list" aria-label="Öğretmen notları">
                <h2>Öğretmen notları</h2>
                {detail.teacherNotes.length > 0 ? (
                  detail.teacherNotes.map((note) => <p key={note.id}>{note.body}</p>)
                ) : (
                  <p>Not yok</p>
                )}
              </section>

              <section className="next-report-list" aria-label="Öğretmen ilişkileri">
                <h2>Öğretmen ilişkileri</h2>
                {detail.teacherAssignments.length > 0 ? (
                  detail.teacherAssignments.map((assignment) => (
                    <p key={assignment.id}>
                      {teacherNameById.get(assignment.teacherId) ?? assignment.teacherId}: {formatTeacherAssignmentRole(assignment.role)}
                      {formatTeacherAssignmentScope(assignment, classNameById, courseNameById, termNameById)}
                    </p>
                  ))
                ) : (
                  <p>Öğretmen ilişkisi yok</p>
                )}
              </section>

              <section className="next-report-list" aria-label="Sınıf geçmişi">
                <h2>Sınıf geçmişi</h2>
                {detail.classHistory.length > 0 ? (
                  detail.classHistory.map((record) => (
                    <p key={record.id}>
                      {record.classId ?? "Sınıfsız"} · {formatClassHistoryAcademicContext(record)}: {formatDate(record.startsAt)}
                      {record.endsAt ? ` - ${formatDate(record.endsAt)}` : " - devam ediyor"}
                    </p>
                  ))
                ) : (
                  <p>Sınıf geçmişi yok</p>
                )}
              </section>

              <section className="next-report-list" aria-label="Kayıt geçmişi">
                <h2>Kayıt geçmişi</h2>
                {detail.enrollments.length > 0 ? (
                  detail.enrollments.map((record) => (
                    <p key={record.id}>
                      {formatEnrollmentReason(record.reason)} · {formatStudentStatus(record.status)} · {record.classId ? classNameById.get(record.classId) ?? record.classId : "Sınıfsız"} · {formatClassHistoryAcademicContext(record)}: {formatDate(record.startsAt)}
                      {record.endsAt ? ` - ${formatDate(record.endsAt)}` : " - devam ediyor"}
                    </p>
                  ))
                ) : (
                  <p>Kayıt geçmişi yok</p>
                )}
              </section>

              <section className="next-report-list" aria-label="Ödevler">
                <h2>Ödevler</h2>
                <p>{detail.homeworkAssignments.length} ödev</p>
              </section>

              <section className="next-report-list" aria-label="Hata kitapçığı">
                <h2>Hata kitapçığı</h2>
                {errorBooklet?.items.length ? (
                  errorBooklet.items.map((item) => (
                    <p key={`${item.questionNo}-${item.branch}`}>
                      {item.questionNo}. soru {item.branch}: {item.status === "BLANK" ? "Boş" : `Yanıt ${item.answer}`} / Doğru {item.correctAnswer}
                    </p>
                  ))
                ) : (
                  <p>Hata kaydı yok</p>
                )}
              </section>

              <section className="next-report-list" aria-label="Denetim özeti">
                <h2>Denetim özeti</h2>
                {studentAuditLogs.length > 0 ? (
                  studentAuditLogs.map((record) => (
                    <p key={record.id}>
                      {formatDateTime(record.createdAt)} - {formatAuditAction(record.action)}
                    </p>
                  ))
                ) : (
                  <p>Denetim kaydı yok</p>
                )}
              </section>
            </div>
          </>
        ) : null}
      </section>
    </PageFrame>
  );
}

async function loadStudentDetailPageData(accessToken: string, id: string): Promise<StudentDetailPageData> {
  const [detail, exams] = await Promise.all([
    loadStudentBaseDetail(accessToken, id),
    loadExams(accessToken),
  ]);
  return { detail, exams };
}

async function loadStudentBaseDetail(accessToken: string, id: string): Promise<StudentBaseDetail> {
  const [
    attendanceSummary,
    auditLogs,
    guardianLinks,
    profile,
    guardians,
    homeworkAssignments,
    paymentPlans,
    classHistory,
    enrollments,
    teacherAssignments,
    teachers,
    teacherNotes,
    classes,
    courses,
    terms,
  ] = await Promise.all([
    apiRequestOrNull<AttendanceSummaryRecord>(accessToken, `${apiBaseUrl}/attendance/summary?studentId=${encodeURIComponent(id)}`),
    apiRequestOrNull<AuditLogRecord[]>(accessToken, `${apiBaseUrl}/audit-logs`),
    apiRequest<GuardianStudentRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardian-links`),
    apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/profile`),
    apiRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardians`),
    loadStudentHomeworkAssignments(accessToken, id),
    apiRequest<PaymentPlanWithInstallmentsRecord[]>(accessToken, `${apiBaseUrl}/payment-plans?studentId=${encodeURIComponent(id)}`),
    apiRequest<StudentClassHistoryRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/class-history`),
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
    classHistory,
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
        id: defaultExamId,
        tenantId: "",
        title: "Demo sınav",
        status: "PUBLISHED",
        createdAt: "",
        updatedAt: "",
      }];
}

async function loadStudentSnapshots(accessToken: string, examId: string, studentId: string) {
  const snapshots = await apiRequestOrNull<ReportSnapshotRecord[]>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots`,
  );
  return (snapshots ?? []).filter((snapshot) =>
    snapshot.status === "READY" && snapshot.snapshotData?.students?.some((student) => student.studentId === studentId),
  );
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
      `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/students/${encodeURIComponent(studentId)}/progress`,
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
  const prefix = date ? new Date(date).toLocaleDateString("tr-TR") : snapshot.id;
  const student = snapshot.snapshotData?.students?.find((record) => record.studentId === studentId);
  return `${prefix} - ${formatNumber(student?.total?.net)} net`;
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

function readLgsScore(total: { estimatedRawScore?: number; standardScore?: number } | undefined) {
  return total?.estimatedRawScore ?? total?.standardScore;
}

function formatDelta(value: number | undefined) {
  if (value === undefined) return "-";
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function isStudentAuditLog(record: AuditLogRecord, studentId: string) {
  return (record.entityType === "Student" && record.entityId === studentId) ||
    (record.entityType === "GuardianStudent" && record.diff?.studentId === studentId);
}

function formatAuditAction(action: string) {
  const labels: Record<string, string> = {
    "guardian_student.linked": "Veli ilişkisi kuruldu",
    "guardian_student.unlinked": "Veli ilişkisi kaldırıldı",
    "guardian_student.updated": "Veli ilişkisi güncellendi",
    "student.created": "Öğrenci oluşturuldu",
    "student.deleted": "Öğrenci silindi",
    "student.profile_updated": "Profil güncellendi",
    "student.profile_viewed": "Profil görüntülendi",
    "student.updated": "Öğrenci bilgisi güncellendi",
  };
  return labels[action] ?? action;
}

function formatRelationshipType(value: GuardianStudentRecord["relationshipType"]) {
  const labels: Record<GuardianStudentRecord["relationshipType"], string> = {
    EMERGENCY_CONTACT: "Acil kişi",
    FATHER: "Baba",
    GUARDIAN: "Vasi",
    MOTHER: "Anne",
    OTHER: "Diğer",
  };
  return labels[value] ?? value;
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
    assignment.classId ? classNames.get(assignment.classId) ?? assignment.classId : undefined,
    assignment.courseId ? courseNames.get(assignment.courseId) ?? assignment.courseId : undefined,
    assignment.termId ? termNames.get(assignment.termId) ?? assignment.termId : undefined,
    assignment.startsAt ? formatDate(assignment.startsAt) : undefined,
    assignment.endsAt ? formatDate(assignment.endsAt) : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? ` - ${parts.join(" · ")}` : "";
}

function formatStudentStatus(status: StudentProfileRecord["status"]) {
  const labels: Record<StudentProfileRecord["status"], string> = {
    ACTIVE: "Aktif",
    GRADUATED: "Mezun",
    PASSIVE: "Pasif",
    TRANSFERRED: "Nakil",
  };
  return labels[status] ?? status;
}

function formatClassHistoryAcademicContext(record: { academicYearId?: string; termId?: string }) {
  return [record.academicYearId, record.termId].filter(Boolean).join(" / ") || "Akademik bağlam yok";
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

function formatGuardianPermissions(link: GuardianStudentRecord) {
  const permissions = [
    link.canViewFinance ? "Ödeme görür" : "Ödeme kapalı",
    link.canReceiveSms ? "SMS alır" : "SMS kapalı",
    link.canReceiveAnnouncements ? "Duyuru alır" : "Duyuru kapalı",
    link.canOpenSupportTickets ? "Destek açar" : "Destek kapalı",
  ];
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

function toStudentExamResult(report: ReportStudentSnapshot | null) {
  return {
    correct: report?.total?.correct ?? 0,
    wrong: report?.total?.wrong ?? 0,
    blank: report?.total?.blank ?? 0,
  };
}

function toStudentBranchRadar(report: ReportStudentSnapshot | null) {
  return (report?.branches ?? []).map((branch) => ({
    branch: branch.branch,
    net: branch.net ?? 0,
  }));
}

function toStudentOutcomeBars(report: ReportStudentSnapshot | null) {
  return [...(report?.outcomes ?? [])]
    .sort((first, second) => (second.net ?? 0) - (first.net ?? 0))
    .slice(0, 12)
    .map((outcome) => ({
      className: `${outcome.branch} / ${outcome.outcomeCode}`,
      net: outcome.net ?? 0,
    }));
}

function toProgressPoints(progress: ReportStudentProgress | null) {
  return progress?.points ?? [];
}
