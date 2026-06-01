"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import type {
  AttendanceSummaryRecord,
  AuditLogRecord,
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
  StudentProfileRecord,
  TeacherAssignmentRecord,
  TeacherNoteRecord,
  TeacherRecord,
} from "@uzman-hocam/shared-types";
import { ArrowLeft } from "lucide-react";
import { useAuth } from "../../../providers.js";
import { apiBaseUrl, apiRequest } from "../../../../src/api-client.js";

interface StudentBaseDetail {
  attendanceSummary: AttendanceSummaryRecord | null;
  auditLogs: AuditLogRecord[];
  guardianLinks: GuardianStudentRecord[];
  profile: StudentProfileRecord;
  guardians: GuardianRecord[];
  homeworkAssignments: HomeworkMaterialAssignmentRecord[];
  paymentPlans: PaymentPlanWithInstallmentsRecord[];
  classHistory: StudentClassHistoryRecord[];
  teacherAssignments: TeacherAssignmentRecord[];
  teachers: TeacherRecord[];
  teacherNotes: TeacherNoteRecord[];
}

const defaultExamId = "exam-demo";

export function StudentDetailPage({ studentId }: { studentId: string }) {
  const { auth } = useAuth();
  const [selectedExamId, setSelectedExamId] = useState(defaultExamId);
  const [selectedSnapshotId, setSelectedSnapshotId] = useState("");

  const detailQuery = useQuery({
    queryKey: ["next-student-detail-page", auth?.session.tenantId ?? "anonymous", studentId],
    queryFn: () => loadStudentBaseDetail(auth?.accessToken ?? "", studentId),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });

  const examsQuery = useQuery({
    queryKey: ["next-student-detail-exams", auth?.session.tenantId ?? "anonymous"],
    queryFn: () => loadExams(auth?.accessToken ?? ""),
    enabled: Boolean(auth),
    refetchOnWindowFocus: false,
  });

  const snapshotsQuery = useQuery({
    queryKey: ["next-student-detail-snapshots", auth?.session.tenantId ?? "anonymous", selectedExamId, studentId],
    queryFn: () => loadStudentSnapshots(auth?.accessToken ?? "", selectedExamId, studentId),
    enabled: Boolean(auth && selectedExamId),
    refetchOnWindowFocus: false,
  });

  const snapshots = snapshotsQuery.data ?? [];
  const selectedSnapshot = useMemo(
    () => snapshots.find((snapshot) => snapshot.id === selectedSnapshotId) ?? snapshots[0] ?? null,
    [selectedSnapshotId, snapshots],
  );

  const reportQuery = useQuery({
    queryKey: [
      "next-student-detail-report",
      auth?.session.tenantId ?? "anonymous",
      selectedExamId,
      selectedSnapshot?.id ?? "none",
      studentId,
    ],
    queryFn: () => loadStudentReport(auth?.accessToken ?? "", selectedExamId, selectedSnapshot?.id ?? "", studentId),
    enabled: Boolean(auth && selectedSnapshot),
    refetchOnWindowFocus: false,
  });

  const errorBookletQuery = useQuery({
    queryKey: [
      "next-student-detail-error-booklet",
      auth?.session.tenantId ?? "anonymous",
      selectedExamId,
      selectedSnapshot?.id ?? "none",
      studentId,
    ],
    queryFn: () => loadStudentErrorBooklet(auth?.accessToken ?? "", selectedExamId, selectedSnapshot?.id ?? "", studentId),
    enabled: Boolean(auth && selectedSnapshot),
    refetchOnWindowFocus: false,
  });

  const progressQuery = useQuery({
    queryKey: ["next-student-detail-progress", auth?.session.tenantId ?? "anonymous", selectedExamId, studentId],
    queryFn: () => apiRequestOrNull<ReportStudentProgress>(
      auth?.accessToken ?? "",
      `${apiBaseUrl}/exams/${encodeURIComponent(selectedExamId)}/reports/students/${encodeURIComponent(studentId)}/progress`,
    ),
    enabled: Boolean(auth && selectedExamId),
    refetchOnWindowFocus: false,
  });

  const detail = detailQuery.data;
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
  const exams = examsQuery.data ?? [];
  const report = reportQuery.data ?? null;
  const errorBooklet = errorBookletQuery.data ?? null;
  const progress = progressQuery.data ?? null;
  const studentName = detail ? `${detail.profile.firstName} ${detail.profile.lastName}` : "Öğrenci 360";

  return (
    <div className="next-portal-stack">
      <Link className="uh-button uh-button--secondary next-detail-back" href="/kurum/ogrenciler">
        <ArrowLeft size={17} aria-hidden="true" />
        Öğrencilere dön
      </Link>

      <section className="next-report-panel" aria-label="Öğrenci 360 detay">
        <div className="next-detail-header">
          <div>
            <h1>{studentName}</h1>
            <p>Öğrenci 360</p>
          </div>
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
        </div>

        {detailQuery.isPending ? (
          <p>Yükleniyor...</p>
        ) : detailQuery.isError ? (
          <p className="uh-crud-page__error">Öğrenci detayı alınamadı.</p>
        ) : detail ? (
          <>
            <div className="next-dashboard-grid">
              <article className="next-metric">
                <span>Devamsızlık</span>
                <strong>{detail.attendanceSummary?.total ?? 0}</strong>
              </article>
              <article className="next-metric">
                <span>Bekleyen ödeme</span>
                <strong>{formatPendingPayment(detail.paymentPlans)}</strong>
              </article>
              <article className="next-metric">
                <span>Son net</span>
                <strong>{formatNumber(report?.total.net)}</strong>
              </article>
              <article className="next-metric">
                <span>Hata kitapçığı</span>
                <strong>{errorBooklet ? `${errorBooklet.items.length} soru` : "-"}</strong>
              </article>
              <article className="next-metric">
                <span>Kayıt durumu</span>
                <strong>{formatStudentStatus(detail.profile.status)}</strong>
              </article>
              <article className="next-metric">
                <span>Net gelişimi</span>
                <strong>{formatDelta(progress?.netDelta)}</strong>
              </article>
              <article className="next-metric">
                <span>Standart puan</span>
                <strong>{formatNumber(report?.total.standardScore)}</strong>
              </article>
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
                      {assignment.classId ? ` - Sınıf ${assignment.classId}` : ""}
                      {assignment.startsAt ? ` - ${formatDate(assignment.startsAt)}` : ""}
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
                      {record.classId ?? "Sınıfsız"}: {formatDate(record.startsAt)}
                      {record.endsAt ? ` - ${formatDate(record.endsAt)}` : " - devam ediyor"}
                    </p>
                  ))
                ) : (
                  <p>Sınıf geçmişi yok</p>
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
    </div>
  );
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
    teacherAssignments,
    teachers,
    teacherNotes,
  ] = await Promise.all([
    apiRequestOrNull<AttendanceSummaryRecord>(accessToken, `${apiBaseUrl}/attendance/summary?studentId=${encodeURIComponent(id)}`),
    apiRequestOrNull<AuditLogRecord[]>(accessToken, `${apiBaseUrl}/audit-logs`),
    apiRequest<GuardianStudentRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardian-links`),
    apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/profile`),
    apiRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/guardians`),
    loadStudentHomeworkAssignments(accessToken, id),
    apiRequest<PaymentPlanWithInstallmentsRecord[]>(accessToken, `${apiBaseUrl}/payment-plans?studentId=${encodeURIComponent(id)}`),
    apiRequest<StudentClassHistoryRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/class-history`),
    apiRequest<TeacherAssignmentRecord[]>(accessToken, `${apiBaseUrl}/students/${encodeURIComponent(id)}/teacher-assignments`),
    apiRequest<TeacherRecord[]>(accessToken, `${apiBaseUrl}/teachers`),
    apiRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/teacher-notes?studentId=${encodeURIComponent(id)}`),
  ]);
  return {
    attendanceSummary,
    auditLogs: auditLogs ?? [],
    guardianLinks,
    guardians,
    homeworkAssignments,
    paymentPlans,
    profile,
    classHistory,
    teacherAssignments,
    teachers,
    teacherNotes,
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

async function loadStudentReport(accessToken: string, examId: string, snapshotId: string, studentId: string) {
  return apiRequestOrNull<ReportStudentSnapshot>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/students/${encodeURIComponent(studentId)}`,
  );
}

async function loadStudentErrorBooklet(accessToken: string, examId: string, snapshotId: string, studentId: string) {
  return apiRequestOrNull<ReportErrorBooklet>(
    accessToken,
    `${apiBaseUrl}/exams/${encodeURIComponent(examId)}/reports/snapshots/${encodeURIComponent(snapshotId)}/students/${encodeURIComponent(studentId)}/error-booklet`,
  );
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

function formatStudentStatus(status: StudentProfileRecord["status"]) {
  return status === "PASSIVE" ? "Pasif" : "Aktif";
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
