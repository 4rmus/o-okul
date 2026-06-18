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
import {
  AccessPanel,
  MetricGrid,
  PortalActionStrip,
  PortalDailyBrief,
  PortalFrame,
  PortalStatePanel,
  PortalWorkspace,
  RolePreviewNotice,
  type PortalActionItem,
  readRolePreviewToken,
} from "./_shared/portal-shell.js";
import { ReportPanel } from "./_shared/report-panel.js";
import { GuardianRelationsPanel, ProfilePanel, StudentFocusPanel, StudentHistoryPanel } from "./_shared/student-panels.js";
import { SupportTicketsPanel } from "./_shared/support-tickets-panel.js";
import { readReportExamId, fallbackReportExamId } from "../_shared/report-exam-selection.js";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../_shared/report-metrics.js";

export function StudentPortalPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const rolePreviewToken = readRolePreviewToken(searchParams);
  const reportExamId = readReportExamId(searchParams);
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

  if (query.isPending) {
    return (
      <PortalFrame title="Öğrenci Portalı" subtitle="Öğrenci özeti">
        <PortalStatePanel
          state="loading"
          title="Öğrenci portal verileri hazırlanıyor"
          description="Devamsızlık, ödev, duyuru ve son sınav bağlamı güvenli oturum kapsamından yükleniyor."
        />
      </PortalFrame>
    );
  }

  if (query.isError) {
    return (
      <PortalFrame title="Öğrenci Portalı" subtitle="Öğrenci özeti">
        <PortalStatePanel
          state="error"
          title="Öğrenci portal verisi alınamadı"
          description="Portal verileri şu anda gösterilemiyor. Bu ekran ham kişisel veri açmadan güvenli hata durumunda kalır."
        />
      </PortalFrame>
    );
  }

  const data = query.data;
  const courseNameById = new Map((data?.courses ?? []).map((course) => [course.id, course.name]));
  const termNameById = new Map((data?.terms ?? []).map((term) => [term.id, term.name]));
  const reportTotal = data?.report?.total;
  const reportSuccess = reportSuccessRate(reportTotal);
  const unreadAnnouncements = (data?.announcements ?? []).filter((announcement) => !announcement.readAt).length;
  const openSupportTickets = (data?.supportTickets ?? []).filter(isOpenSupportTicket).length;
  const announcementStatus = unreadAnnouncements > 0 ? `${unreadAnnouncements} okunmamış` : "Güncel";
  const homeworkStatus = `${data?.homeworkAssignments.length ?? 0} atama`;
  const attendanceStatus = `${data?.attendanceSummary.total ?? 0} kayıt`;
  const supportStatus = openSupportTickets > 0 ? `${openSupportTickets} açık` : "Açık talep yok";
  const studentActionItems: PortalActionItem[] = [
    {
      actionLabel: unreadAnnouncements > 0 ? "Oku" : "Hazır",
      contextLabel: "Duyuru",
      detail: unreadAnnouncements > 0 ? "Okul duyurusunu kontrol et" : "Okunmamış duyuru yok",
      href: "#portal-announcements",
      key: "announcement",
      label: "Duyuruları oku",
      statusLabel: unreadAnnouncements > 0 ? "Bekliyor" : "Güncel",
      tone: unreadAnnouncements > 0 ? "warning" : "success",
      value: unreadAnnouncements > 0 ? `${unreadAnnouncements} okunmamış` : "Güncel",
    },
    {
      actionLabel: (data?.homeworkAssignments.length ?? 0) > 0 ? "Tamamla" : "Hazır",
      contextLabel: "Ödev",
      detail: "Materyal ve tekrar çalışması",
      href: "#portal-homework",
      key: "homework",
      label: "Ödevi aç",
      statusLabel: (data?.homeworkAssignments.length ?? 0) > 0 ? "Çalışma var" : "Tamam",
      tone: (data?.homeworkAssignments.length ?? 0) > 0 ? "info" : "success",
      value: `${data?.homeworkAssignments.length ?? 0} atama`,
    },
    {
      actionLabel: "Kontrol",
      contextLabel: "Devamsızlık",
      detail: `${data?.attendanceSummary.absent ?? 0} yok, ${data?.attendanceSummary.late ?? 0} geç`,
      href: "#portal-attendance",
      key: "attendance",
      label: "Devamsızlığı kontrol et",
      statusLabel: (data?.attendanceSummary.absent ?? 0) > 0 || (data?.attendanceSummary.late ?? 0) > 0 ? "Dikkat" : "Düzenli",
      tone: (data?.attendanceSummary.absent ?? 0) > 0 || (data?.attendanceSummary.late ?? 0) > 0 ? "warning" : "success",
      value: attendanceStatus,
    },
    {
      actionLabel: openSupportTickets > 0 ? "Takip et" : isRolePreview ? "Salt-okuma" : "Talep aç",
      contextLabel: "Destek",
      detail: isRolePreview ? "Destek talebi açma kapalı" : "Öğrenci destek takibi",
      href: "#portal-support",
      key: "support",
      label: "Destek talebini takip et",
      statusLabel: openSupportTickets > 0 ? "Açık" : isRolePreview ? "Salt-okuma" : "Hazır",
      tone: openSupportTickets > 0 ? "warning" : "neutral",
      value: supportStatus,
    },
    {
      actionLabel: "İncele",
      contextLabel: "Rapor",
      detail: `${formatNumber(reportTotal?.net)} net / ${formatNumber(reportQuestionCount(reportTotal))} soru`,
      href: "#portal-report",
      key: "report",
      label: "Son sınavı incele",
      statusLabel: "Başarı %",
      tone: (reportSuccess ?? 0) >= 75 ? "success" : "info",
      value: formatPercentNumber(reportSuccess),
    },
    {
      actionLabel: isRolePreview ? "Salt-okuma" : "Canlı",
      contextLabel: "Erişim",
      detail: isRolePreview ? "Yazma işlemleri kapalı" : "Okuma ve destek işlemleri açık",
      href: isRolePreview ? "#portal-preview" : "#portal-focus",
      key: "preview",
      label: "Önizleme durumu",
      statusLabel: isRolePreview ? "Salt-okuma" : "Canlı",
      tone: isRolePreview ? "neutral" : "info",
      value: isRolePreview ? "Salt-okuma" : "Canlı hesap",
    },
  ];
  return (
    <PortalFrame title="Öğrenci Portalı" subtitle={data?.profile ? `${data.profile.firstName} ${data.profile.lastName}` : "Öğrenci özeti"}>
      <PortalDailyBrief
        summary="Devamsızlık, ödev, duyuru ve son sınav durumu tek bakışta; öğrencinin bugün öncelik vermesi gereken işler burada toplanır."
        items={[
          {
            label: "Duyuru",
            value: unreadAnnouncements > 0 ? `${unreadAnnouncements} okunmamış` : "Güncel",
            detail: unreadAnnouncements > 0 ? "Okunmamış okul duyurusu var" : "Okunmamış duyuru yok",
            tone: unreadAnnouncements > 0 ? "warning" : "success",
          },
          {
            label: "Ödev",
            value: `${data?.homeworkAssignments.length ?? 0} atama`,
            detail: "Materyal ve tekrar çalışmaları",
            tone: (data?.homeworkAssignments.length ?? 0) > 0 ? "info" : "neutral",
          },
          {
            label: "Devamsızlık",
            value: `${data?.attendanceSummary.total ?? 0} kayıt`,
            detail: `${data?.attendanceSummary.absent ?? 0} yok, ${data?.attendanceSummary.late ?? 0} geç`,
            tone: (data?.attendanceSummary.absent ?? 0) > 0 || (data?.attendanceSummary.late ?? 0) > 0 ? "warning" : "success",
          },
          {
            label: "Son sınav",
            value: formatPercentNumber(reportSuccess),
            detail: `${formatNumber(reportTotal?.net)} net / ${formatNumber(reportQuestionCount(reportTotal))} soru`,
            tone: (reportSuccess ?? 0) >= 75 ? "success" : "info",
          },
          {
            label: "Destek",
            value: openSupportTickets > 0 ? `${openSupportTickets} açık` : "Açık talep yok",
            detail: "Öğrenci destek takibi",
            tone: openSupportTickets > 0 ? "warning" : "success",
          },
          {
            label: "Önizleme",
            value: isRolePreview ? "Salt-okuma" : "Canlı hesap",
            detail: isRolePreview ? "İşlem düğmeleri kapalıdır" : "Okuma ve destek işlemleri açık",
            tone: isRolePreview ? "neutral" : "info",
          },
        ]}
      />
      <PortalActionStrip ariaLabel="Öğrenci günlük aksiyonları" items={studentActionItems} />
      <MetricGrid
        items={[
          { label: "Toplam devamsızlık", value: data?.attendanceSummary.total ?? 0 },
          { label: "Geç kalma", value: data?.attendanceSummary.late ?? 0 },
          { label: "Not", value: data?.teacherNotes.length ?? 0 },
          { label: "Ödev", value: data?.homeworkAssignments.length ?? 0 },
          { label: "Başarı", value: formatPercentNumber(reportSuccessRate(reportTotal)) },
          { label: "Net", value: formatNumber(reportTotal?.net) },
          { label: "Soru", value: formatNumber(reportQuestionCount(reportTotal)) },
          { label: "Gelişim", value: data?.developmentAssessments.length ?? 0 },
        ]}
      />
      {isRolePreview ? (
        <div id="portal-preview">
          <RolePreviewNotice />
        </div>
      ) : null}
      <div id="portal-focus">
        <StudentFocusPanel
          announcementStatus={announcementStatus}
          attendanceStatus={attendanceStatus}
          homeworkStatus={homeworkStatus}
          mode={isRolePreview ? "read-only" : "student"}
          net={formatNumber(reportTotal?.net)}
          profile={data?.profile}
          questionCount={formatNumber(reportQuestionCount(reportTotal))}
          scopeLabel="Öğrenci hesabı"
          successRate={formatPercentNumber(reportSuccess)}
          supportStatus={supportStatus}
        />
      </div>
      <PortalWorkspace
        ariaLabel="Öğrenci portal çalışma alanı"
        main={
          <>
            <div id="portal-report">
              <ReportPanel
                context={data?.report ?? undefined}
                courseNames={courseNameById}
                errorBooklet={data?.errorBooklet ?? null}
                progress={data?.progress ?? null}
                report={data?.report ?? null}
                termNames={termNameById}
              />
            </div>
            <div id="portal-homework">
              <HomeworkAssignmentsPanel
                assignments={data?.homeworkAssignments ?? []}
                courseNames={courseNameById}
                termNames={termNameById}
              />
            </div>
            <div id="portal-announcements">
              <AnnouncementsPanel
                announcements={data?.announcements ?? []}
                readOnly={isRolePreview}
                onMarkRead={(announcement) =>
                  auth && !isRolePreview ? markAnnouncementRead(auth.accessToken, `me/student/announcements/${encodeURIComponent(announcement.id)}/read`).then(() => query.refetch()) : undefined
                }
              />
            </div>
            <div id="portal-support">
              <SupportTicketsPanel
                readOnly={isRolePreview}
                tickets={data?.supportTickets ?? []}
                onCreate={(input) =>
                  auth && !isRolePreview ? createPortalSupportTicket(auth.accessToken, "me/student/support-tickets", input).then(() => query.refetch()) : undefined
                }
              />
            </div>
          </>
        }
        side={
          <>
            <ProfilePanel profile={data?.profile} />
            <GuardianRelationsPanel guardians={data?.guardians ?? []} links={data?.guardianLinks ?? []} />
            <StudentHistoryPanel
              classHistory={data?.classHistory ?? []}
              enrollments={data?.enrollments ?? []}
              termNames={termNameById}
            />
            <div id="portal-attendance">
              <AttendancePanel records={data?.attendance ?? []} />
            </div>
            <DevelopmentTrendPanel assessments={data?.developmentAssessments ?? []} />
            <TeacherNotesPanel notes={data?.teacherNotes ?? []} courseNames={courseNameById} termNames={termNameById} />
          </>
        }
      />
    </PortalFrame>
  );
}

async function loadStudentPortal(accessToken: string, rolePreviewToken = "", reportExamId = fallbackReportExamId) {
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
    apiRequestOrNull<ReportStudentProgress>(accessToken, `${apiBaseUrl}/me/student/reports/${encodeURIComponent(reportExamId)}/progress?scope=all`, rolePreviewToken),
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

function isOpenSupportTicket(ticket: SupportTicketRecord) {
  return ticket.status === "OPEN" || ticket.status === "IN_PROGRESS";
}
