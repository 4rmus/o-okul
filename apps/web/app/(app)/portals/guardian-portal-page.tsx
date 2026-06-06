"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type {
  AcademicTermRecord,
  AnnouncementRecord,
  AttendanceRecord,
  AttendanceSummaryRecord,
  CourseRecord,
  GuardianStudentRecord,
  HomeworkMaterialAssignmentRecord,
  PaymentPlanWithInstallmentsRecord,
  ReportErrorBooklet,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentClassHistoryRecord,
  StudentEnrollmentRecord,
  StudentProfileRecord,
  StudentRecord,
  SupportTicketRecord,
  TeacherNoteRecord,
} from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetch, readData } from "../../../src/api-client.js";
import type { SupportTicketFormPayload } from "../../../src/form-validation.js";
import { useAuth } from "../../providers.js";
import { AttendancePanel, TeacherNotesPanel } from "./_shared/activity-panels.js";
import { AnnouncementsPanel } from "./_shared/announcements-panel.js";
import { DevelopmentTrendPanel, type DevelopmentTrendItem } from "./_shared/development-panel.js";
import { GuardianRelationshipSummaryPanel, NotificationPreferencesPanel, PaymentPlansPanel } from "./_shared/guardian-panels.js";
import { HomeworkAssignmentsPanel } from "./_shared/homework-panels.js";
import { AccessPanel, MetricGrid, PortalFrame } from "./_shared/portal-shell.js";
import { ReportPanel } from "./_shared/report-panel.js";
import { ProfilePanel, StudentHistoryPanel } from "./_shared/student-panels.js";
import { SupportTicketsPanel } from "./_shared/support-tickets-panel.js";

const portalExamId = "exam-demo-isem-lgs-1";

export function GuardianPortalPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const rolePreviewToken = searchParams.get("rolePreviewToken")?.trim() ?? "";
  const reportExamId = searchParams.get("examId")?.trim() || portalExamId;
  const isRolePreview = Boolean(rolePreviewToken);
  const canReadPortal = Boolean(auth && (auth.session.subjectType === "GUARDIAN" || isRolePreview));
  const studentsQuery = useQuery({
    queryKey: ["next-guardian-students", auth?.session.userId ?? "anonymous", rolePreviewToken || "session"],
    queryFn: () => readOnlyRequest<StudentRecord[]>(auth?.accessToken ?? "", `${apiBaseUrl}/me/guardian/students`, rolePreviewToken),
    enabled: canReadPortal,
    refetchOnWindowFocus: false,
  });
  const students = studentsQuery.data ?? [];
  const [selectedStudentId, setSelectedStudentId] = useState<string | null>(null);
  const resolvedStudentId = selectedStudentId ?? students[0]?.id;
  const studentQuery = useQuery({
    queryKey: [
      "next-guardian-portal",
      auth?.session.userId ?? "anonymous",
      resolvedStudentId ?? "none",
      rolePreviewToken || "session",
      reportExamId,
    ],
    queryFn: () => loadGuardianStudentPortal(auth?.accessToken ?? "", resolvedStudentId ?? "", rolePreviewToken, reportExamId),
    enabled: Boolean(canReadPortal && resolvedStudentId),
    refetchOnWindowFocus: false,
  });
  const selectedStudent = useMemo(
    () => students.find((student) => student.id === resolvedStudentId),
    [resolvedStudentId, students],
  );

  if (!canReadPortal) {
    return <AccessPanel title="Veli Portalı" demoEmail="guardian-a@example.test" demoLabel="Demo veli" />;
  }

  const data = studentQuery.data;
  const courseNameById = new Map((data?.courses ?? []).map((course) => [course.id, course.name]));
  const termNameById = new Map((data?.terms ?? []).map((term) => [term.id, term.name]));
  const canViewFinance = data?.notificationPreferences?.canViewFinance !== false;
  return (
    <PortalFrame title="Veli Portalı" subtitle={selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "Bağlı öğrenci özeti"}>
      <div className="next-segmented" aria-label="Öğrenci seçimi">
        {students.map((student) => (
          <button
            aria-pressed={student.id === resolvedStudentId}
            key={student.id}
            onClick={() => setSelectedStudentId(student.id)}
            type="button"
          >
            {student.firstName} {student.lastName}
          </button>
        ))}
      </div>
      <MetricGrid
        items={[
          { label: "Devamsızlık", value: data?.attendanceSummary.total ?? 0 },
          { label: "Ödeme planı", value: data?.paymentPlans.length ?? 0 },
          { label: "Öğretmen notu", value: data?.teacherNotes.length ?? 0 },
          { label: "Gelişim", value: data?.developmentAssessments.length ?? 0 },
          { label: "Ödev", value: data?.homeworkAssignments.length ?? 0 },
          { label: "Bekleyen ödeme", value: canViewFinance ? formatPendingPayment(data?.paymentPlans ?? []) : "Kapalı" },
        ]}
      />
      {isRolePreview ? (
        <section className="next-list-panel" aria-label="Rol önizleme modu">
          <h2>Salt-okuma Önizleme</h2>
          <p>Bu ekran kurum yöneticisi için geçici rol önizleme modunda açıldı.</p>
        </section>
      ) : null}
      <ProfilePanel profile={data?.profile} />
      <StudentHistoryPanel
        classHistory={data?.classHistory ?? []}
        enrollments={data?.enrollments ?? []}
        termNames={termNameById}
      />
      <GuardianRelationshipSummaryPanel relationship={data?.notificationPreferences} />
      <NotificationPreferencesPanel
        preferences={data?.notificationPreferences}
        readOnly={isRolePreview}
        onUpdate={(input) =>
          auth && resolvedStudentId && !isRolePreview
            ? updateGuardianNotificationPreferences(
                auth.accessToken,
                resolvedStudentId,
                input,
              ).then(() => studentQuery.refetch())
            : undefined
        }
      />
      <AnnouncementsPanel
        announcements={data?.announcements ?? []}
        readOnly={isRolePreview}
        onMarkRead={(announcement) =>
          auth && resolvedStudentId && !isRolePreview
            ? markAnnouncementRead(
                auth.accessToken,
                `me/guardian/students/${encodeURIComponent(resolvedStudentId)}/announcements/${encodeURIComponent(announcement.id)}/read`,
              ).then(() => studentQuery.refetch())
            : undefined
        }
      />
      <HomeworkAssignmentsPanel
        assignments={data?.homeworkAssignments ?? []}
        courseNames={courseNameById}
        termNames={termNameById}
      />
      <SupportTicketsPanel
        readOnly={isRolePreview}
        tickets={data?.supportTickets ?? []}
        onCreate={(input) =>
          auth && resolvedStudentId && !isRolePreview && data?.notificationPreferences?.canOpenSupportTickets !== false
            ? createPortalSupportTicket(
                auth.accessToken,
                `me/guardian/students/${encodeURIComponent(resolvedStudentId)}/support-tickets`,
                input,
              ).then(() => studentQuery.refetch())
            : undefined
        }
      />
      <ReportPanel
        context={data?.report ?? undefined}
        courseNames={courseNameById}
        errorBooklet={data?.errorBooklet ?? null}
        progress={data?.progress ?? null}
        report={data?.report ?? null}
        termNames={termNameById}
      />
      <PaymentPlansPanel canViewFinance={canViewFinance} plans={data?.paymentPlans ?? []} />
      <DevelopmentTrendPanel assessments={data?.developmentAssessments ?? []} />
      <TeacherNotesPanel notes={data?.teacherNotes ?? []} />
      <AttendancePanel records={data?.attendance ?? []} />
      {studentsQuery.isError || studentQuery.isError ? <p className="next-form-error">Veli portal verisi alınamadı.</p> : null}
    </PortalFrame>
  );
}

async function loadGuardianStudentPortal(accessToken: string, studentId: string, rolePreviewToken = "", reportExamId = portalExamId) {
  const [profile, classHistory, enrollments, notificationPreferences, announcements, homeworkAssignments, supportTickets, attendance, attendanceSummary, teacherNotes, developmentAssessments, paymentPlans, report, errorBooklet, progress, courses, terms] = await Promise.all([
    readOnlyRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/profile`, rolePreviewToken),
    readOnlyRequest<StudentClassHistoryRecord[]>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/class-history`,
      rolePreviewToken,
    ),
    readOnlyRequest<StudentEnrollmentRecord[]>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/enrollments`,
      rolePreviewToken,
    ),
    readOnlyRequest<GuardianStudentRecord>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/notification-preferences`,
      rolePreviewToken,
    ),
    readOnlyRequest<AnnouncementRecord[]>(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/announcements`, rolePreviewToken),
    readOnlyRequest<HomeworkMaterialAssignmentRecord[]>(
      accessToken,
      `${apiBaseUrl}/me/guardian/homework/material-assignments`,
      rolePreviewToken,
    ),
    apiRequestOrEmptySupportTickets(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/support-tickets`,
      rolePreviewToken,
    ),
    readOnlyRequest<AttendanceRecord[]>(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/attendance`, rolePreviewToken),
    readOnlyRequest<AttendanceSummaryRecord>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/attendance/summary`,
      rolePreviewToken,
    ),
    readOnlyRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/teacher-notes`, rolePreviewToken),
    readOnlyRequest<DevelopmentTrendItem[]>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/development-assessments`,
      rolePreviewToken,
    ),
    apiRequestOrEmptyPaymentPlans(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/payment-plans`,
      rolePreviewToken,
    ),
    apiRequestOrNull<ReportStudentSnapshot>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/reports/${encodeURIComponent(reportExamId)}/latest`,
      rolePreviewToken,
    ),
    apiRequestOrNull<ReportErrorBooklet>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/reports/${encodeURIComponent(reportExamId)}/latest/error-booklet`,
      rolePreviewToken,
    ),
    apiRequestOrNull<ReportStudentProgress>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/reports/${encodeURIComponent(reportExamId)}/progress`,
      rolePreviewToken,
    ),
    readOnlyRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`, rolePreviewToken),
    readOnlyRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`, rolePreviewToken),
  ]);

  return {
    profile,
    classHistory,
    enrollments,
    notificationPreferences,
    announcements,
    homeworkAssignments: homeworkAssignments.filter((assignment) => assignment.studentId === studentId),
    supportTickets,
    attendance,
    attendanceSummary,
    teacherNotes,
    developmentAssessments,
    paymentPlans,
    report,
    errorBooklet,
    progress,
    courses,
    terms,
  };
}

async function markAnnouncementRead(accessToken: string, path: string) {
  return apiRequest<AnnouncementRecord>(accessToken, `${apiBaseUrl}/${path}`, {
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function createPortalSupportTicket(accessToken: string, path: string, input: SupportTicketFormPayload) {
  return apiRequest<SupportTicketRecord>(accessToken, `${apiBaseUrl}/${path}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

async function updateGuardianNotificationPreferences(
  accessToken: string,
  studentId: string,
  input: Partial<Pick<GuardianStudentRecord, "canReceiveSms" | "canReceiveAnnouncements" | "canOpenSupportTickets">>,
) {
  return apiRequest<GuardianStudentRecord>(
    accessToken,
    `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/notification-preferences`,
    {
      body: JSON.stringify(input),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    },
  );
}

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL, rolePreviewToken = ""): Promise<T | null> {
  const response = await authenticatedFetch(accessToken, input, withRolePreview({}, rolePreviewToken));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("API_REQUEST_FAILED");
  return readData<T>(response);
}

async function apiRequestOrEmptyPaymentPlans(accessToken: string, input: RequestInfo | URL, rolePreviewToken = ""): Promise<PaymentPlanWithInstallmentsRecord[]> {
  const response = await authenticatedFetch(accessToken, input, withRolePreview({}, rolePreviewToken));
  if (response.status === 403 || response.status === 404) return [];
  if (!response.ok) throw new Error("API_REQUEST_FAILED");
  return readData<PaymentPlanWithInstallmentsRecord[]>(response);
}

async function apiRequestOrEmptySupportTickets(accessToken: string, input: RequestInfo | URL, rolePreviewToken = ""): Promise<SupportTicketRecord[]> {
  const response = await authenticatedFetch(accessToken, input, withRolePreview({}, rolePreviewToken));
  if (response.status === 403 || response.status === 404) return [];
  if (!response.ok) throw new Error("API_REQUEST_FAILED");
  return readData<SupportTicketRecord[]>(response);
}

function readOnlyRequest<T>(accessToken: string, input: RequestInfo | URL, rolePreviewToken = ""): Promise<T> {
  return apiRequest<T>(accessToken, input, withRolePreview({}, rolePreviewToken));
}

function withRolePreview(init: RequestInit, rolePreviewToken: string): RequestInit {
  if (!rolePreviewToken) return init;
  return {
    ...init,
    headers: {
      ...toHeaderRecord(init.headers),
      "x-role-preview-token": rolePreviewToken,
    },
  };
}

function toHeaderRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) return Object.fromEntries(headers.entries());
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return headers;
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
