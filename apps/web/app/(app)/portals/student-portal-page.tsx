"use client";

import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import type {
  AcademicTermRecord,
  AnnouncementRecord,
  AttendanceRecord,
  AttendanceSummaryRecord,
  CourseRecord,
  GuardianRecord,
  GuardianStudentRecord,
  HomeworkMaterialAssignmentRecord,
  ReportErrorBooklet,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentClassHistoryRecord,
  StudentEnrollmentRecord,
  StudentProfileRecord,
  SupportTicketRecord,
  TeacherNoteRecord,
} from "@uzman-hocam/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetch, readData } from "../../../src/api-client.js";
import type { SupportTicketFormPayload } from "../../../src/form-validation.js";
import { useAuth } from "../../providers.js";
import { AttendancePanel, TeacherNotesPanel } from "./_shared/activity-panels.js";
import { AnnouncementsPanel } from "./_shared/announcements-panel.js";
import { DevelopmentTrendPanel, type DevelopmentTrendItem } from "./_shared/development-panel.js";
import { HomeworkAssignmentsPanel } from "./_shared/homework-panels.js";
import { AccessPanel, MetricGrid, PortalFrame } from "./_shared/portal-shell.js";
import { ReportPanel } from "./_shared/report-panel.js";
import { GuardianRelationsPanel, ProfilePanel, StudentHistoryPanel } from "./_shared/student-panels.js";
import { SupportTicketsPanel } from "./_shared/support-tickets-panel.js";

const portalExamId = "exam-demo-isem-lgs-1";

export function StudentPortalPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const rolePreviewToken = searchParams.get("rolePreviewToken")?.trim() ?? "";
  const reportExamId = searchParams.get("examId")?.trim() || portalExamId;
  const isRolePreview = Boolean(rolePreviewToken);
  const canReadPortal = Boolean(auth && (auth.session.subjectType === "STUDENT" || isRolePreview));
  const queryKey = ["next-student-portal", auth?.session.userId ?? "anonymous", rolePreviewToken || "session", reportExamId];
  const query = useQuery({
    queryKey,
    queryFn: () => loadStudentPortal(auth?.accessToken ?? "", rolePreviewToken, reportExamId),
    enabled: canReadPortal,
    refetchOnWindowFocus: false,
  });

  if (!canReadPortal) {
    return <AccessPanel title="Öğrenci Portalı" demoEmail="student-a@example.test" demoLabel="Demo öğrenci" />;
  }

  const data = query.data;
  const courseNameById = new Map((data?.courses ?? []).map((course) => [course.id, course.name]));
  const termNameById = new Map((data?.terms ?? []).map((term) => [term.id, term.name]));
  return (
    <PortalFrame title="Öğrenci Portalı" subtitle={data?.profile ? `${data.profile.firstName} ${data.profile.lastName}` : "Öğrenci özeti"}>
      <MetricGrid
        items={[
          { label: "Toplam devamsızlık", value: data?.attendanceSummary.total ?? 0 },
          { label: "Geç kalma", value: data?.attendanceSummary.late ?? 0 },
          { label: "Not", value: data?.teacherNotes.length ?? 0 },
          { label: "Gelişim", value: data?.developmentAssessments.length ?? 0 },
          { label: "Ödev", value: data?.homeworkAssignments.length ?? 0 },
          { label: "Net", value: formatNumber(data?.report?.total.net) },
        ]}
      />
      {isRolePreview ? (
        <section className="next-list-panel" aria-label="Rol önizleme modu">
          <h2>Salt-okuma Önizleme</h2>
          <p>Bu ekran kurum yöneticisi için geçici rol önizleme modunda açıldı.</p>
        </section>
      ) : null}
      <ProfilePanel profile={data?.profile} />
      <GuardianRelationsPanel guardians={data?.guardians ?? []} links={data?.guardianLinks ?? []} />
      <StudentHistoryPanel
        classHistory={data?.classHistory ?? []}
        enrollments={data?.enrollments ?? []}
        termNames={termNameById}
      />
      <AnnouncementsPanel
        announcements={data?.announcements ?? []}
        readOnly={isRolePreview}
        onMarkRead={(announcement) =>
          auth && !isRolePreview ? markAnnouncementRead(auth.accessToken, `me/student/announcements/${encodeURIComponent(announcement.id)}/read`).then(() => query.refetch()) : undefined
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
          auth && !isRolePreview ? createPortalSupportTicket(auth.accessToken, "me/student/support-tickets", input).then(() => query.refetch()) : undefined
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
      <AttendancePanel records={data?.attendance ?? []} />
      <DevelopmentTrendPanel assessments={data?.developmentAssessments ?? []} />
      <TeacherNotesPanel notes={data?.teacherNotes ?? []} />
      {query.isError ? <p className="next-form-error">Öğrenci portal verisi alınamadı.</p> : null}
    </PortalFrame>
  );
}

async function loadStudentPortal(accessToken: string, rolePreviewToken = "", reportExamId = portalExamId) {
  const [profile, guardians, guardianLinks, classHistory, enrollments, announcements, homeworkAssignments, supportTickets, attendance, attendanceSummary, teacherNotes, developmentAssessments, report, errorBooklet, progress, courses, terms] = await Promise.all([
    readOnlyRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/me/student/profile`, rolePreviewToken),
    readOnlyRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/me/student/guardians`, rolePreviewToken),
    readOnlyRequest<GuardianStudentRecord[]>(accessToken, `${apiBaseUrl}/me/student/guardian-links`, rolePreviewToken),
    readOnlyRequest<StudentClassHistoryRecord[]>(accessToken, `${apiBaseUrl}/me/student/class-history`, rolePreviewToken),
    readOnlyRequest<StudentEnrollmentRecord[]>(accessToken, `${apiBaseUrl}/me/student/enrollments`, rolePreviewToken),
    readOnlyRequest<AnnouncementRecord[]>(accessToken, `${apiBaseUrl}/me/student/announcements`, rolePreviewToken),
    readOnlyRequest<HomeworkMaterialAssignmentRecord[]>(
      accessToken,
      `${apiBaseUrl}/me/student/homework/material-assignments`,
      rolePreviewToken,
    ),
    readOnlyRequest<SupportTicketRecord[]>(accessToken, `${apiBaseUrl}/me/student/support-tickets`, rolePreviewToken),
    readOnlyRequest<AttendanceRecord[]>(accessToken, `${apiBaseUrl}/me/student/attendance`, rolePreviewToken),
    readOnlyRequest<AttendanceSummaryRecord>(accessToken, `${apiBaseUrl}/me/student/attendance/summary`, rolePreviewToken),
    readOnlyRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/me/student/teacher-notes`, rolePreviewToken),
    readOnlyRequest<DevelopmentTrendItem[]>(accessToken, `${apiBaseUrl}/me/student/development-assessments`, rolePreviewToken),
    apiRequestOrNull<ReportStudentSnapshot>(accessToken, `${apiBaseUrl}/me/student/reports/${encodeURIComponent(reportExamId)}/latest`, rolePreviewToken),
    apiRequestOrNull<ReportErrorBooklet>(
      accessToken,
      `${apiBaseUrl}/me/student/reports/${encodeURIComponent(reportExamId)}/latest/error-booklet`,
      rolePreviewToken,
    ),
    apiRequestOrNull<ReportStudentProgress>(accessToken, `${apiBaseUrl}/me/student/reports/${encodeURIComponent(reportExamId)}/progress`, rolePreviewToken),
    readOnlyRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`, rolePreviewToken),
    readOnlyRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`, rolePreviewToken),
  ]);

  return { profile, guardians, guardianLinks, classHistory, enrollments, announcements, homeworkAssignments, supportTickets, attendance, attendanceSummary, teacherNotes, developmentAssessments, report, errorBooklet, progress, courses, terms };
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

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL, rolePreviewToken = ""): Promise<T | null> {
  const response = await authenticatedFetch(accessToken, input, withRolePreview({}, rolePreviewToken));
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("API_REQUEST_FAILED");
  return readData<T>(response);
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

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}
