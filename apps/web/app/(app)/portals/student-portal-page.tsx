"use client";

import { useQuery } from "@tanstack/react-query";
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
  const queryKey = ["next-student-portal", auth?.session.userId ?? "anonymous"];
  const query = useQuery({
    queryKey,
    queryFn: () => loadStudentPortal(auth?.accessToken ?? ""),
    enabled: Boolean(auth && auth.session.subjectType === "STUDENT"),
    refetchOnWindowFocus: false,
  });

  if (auth?.session.subjectType !== "STUDENT") {
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
      <ProfilePanel profile={data?.profile} />
      <GuardianRelationsPanel guardians={data?.guardians ?? []} links={data?.guardianLinks ?? []} />
      <StudentHistoryPanel
        classHistory={data?.classHistory ?? []}
        enrollments={data?.enrollments ?? []}
        termNames={termNameById}
      />
      <AnnouncementsPanel
        announcements={data?.announcements ?? []}
        onMarkRead={(announcement) =>
          auth ? markAnnouncementRead(auth.accessToken, `me/student/announcements/${encodeURIComponent(announcement.id)}/read`).then(() => query.refetch()) : undefined
        }
      />
      <HomeworkAssignmentsPanel
        assignments={data?.homeworkAssignments ?? []}
        courseNames={courseNameById}
        termNames={termNameById}
      />
      <SupportTicketsPanel
        tickets={data?.supportTickets ?? []}
        onCreate={(input) =>
          auth ? createPortalSupportTicket(auth.accessToken, "me/student/support-tickets", input).then(() => query.refetch()) : undefined
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

async function loadStudentPortal(accessToken: string) {
  const [profile, guardians, guardianLinks, classHistory, enrollments, announcements, homeworkAssignments, supportTickets, attendance, attendanceSummary, teacherNotes, developmentAssessments, report, errorBooklet, progress, courses, terms] = await Promise.all([
    apiRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/me/student/profile`),
    apiRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/me/student/guardians`),
    apiRequest<GuardianStudentRecord[]>(accessToken, `${apiBaseUrl}/me/student/guardian-links`),
    apiRequest<StudentClassHistoryRecord[]>(accessToken, `${apiBaseUrl}/me/student/class-history`),
    apiRequest<StudentEnrollmentRecord[]>(accessToken, `${apiBaseUrl}/me/student/enrollments`),
    apiRequest<AnnouncementRecord[]>(accessToken, `${apiBaseUrl}/me/student/announcements`),
    apiRequest<HomeworkMaterialAssignmentRecord[]>(
      accessToken,
      `${apiBaseUrl}/me/student/homework/material-assignments`,
    ),
    apiRequest<SupportTicketRecord[]>(accessToken, `${apiBaseUrl}/me/student/support-tickets`),
    apiRequest<AttendanceRecord[]>(accessToken, `${apiBaseUrl}/me/student/attendance`),
    apiRequest<AttendanceSummaryRecord>(accessToken, `${apiBaseUrl}/me/student/attendance/summary`),
    apiRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/me/student/teacher-notes`),
    apiRequest<DevelopmentTrendItem[]>(accessToken, `${apiBaseUrl}/me/student/development-assessments`),
    apiRequestOrNull<ReportStudentSnapshot>(accessToken, `${apiBaseUrl}/me/student/reports/${portalExamId}/latest`),
    apiRequestOrNull<ReportErrorBooklet>(
      accessToken,
      `${apiBaseUrl}/me/student/reports/${portalExamId}/latest/error-booklet`,
    ),
    apiRequestOrNull<ReportStudentProgress>(accessToken, `${apiBaseUrl}/me/student/reports/${portalExamId}/progress`),
    apiRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`),
    apiRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`),
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

async function apiRequestOrNull<T>(accessToken: string, input: RequestInfo | URL): Promise<T | null> {
  const response = await authenticatedFetch(accessToken, input);
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("API_REQUEST_FAILED");
  return readData<T>(response);
}

function formatNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}
