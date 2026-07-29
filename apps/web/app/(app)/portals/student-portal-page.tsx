"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Field, Select } from "@o-okul/ui";
import type {
  AcademicTermRecord,
  AnnouncementRecord,
  AttendanceRecord,
  AttendanceSummaryRecord,
  CourseRecord,
  GuardianRecord,
  GuardianStudentRecord,
  HomeworkMaterialAssignmentRecord,
  PortalReportIndexItem,
  ReportErrorBooklet,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentEnrollmentRecord,
  StudentProfileRecord,
  SupportTicketRecord,
  TeacherNoteRecord,
} from "@o-okul/shared-types";
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
import { readReportExamId } from "../_shared/report-exam-selection.js";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../_shared/report-metrics.js";

export type StudentPortalView = "announcements" | "attendance" | "homework" | "overview" | "profile" | "reports" | "support";

export function StudentPortalPage({ view = "overview" }: { view?: StudentPortalView } = {}) {
  const { auth } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const rolePreviewToken = readRolePreviewToken(searchParams);
  const reportExamId = readReportExamId(searchParams, "");
  const isRolePreview = Boolean(rolePreviewToken);
  const canReadPortal = Boolean(auth && (auth.session.subjectType === "STUDENT" || isRolePreview));
  const queryKey = ["next-student-portal", auth?.session.userId ?? "anonymous", rolePreviewToken || "session", view, reportExamId];
  const query = useQuery({
    queryKey,
    queryFn: () => loadStudentPortal(auth?.accessToken ?? "", rolePreviewToken, reportExamId, view),
    enabled: canReadPortal,
    refetchOnWindowFocus: false,
  });

  if (!canReadPortal) {
    return <AccessPanel title="Öğrenci Portalı" />;
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
  const profileSubtitle = data?.profile ? `${data.profile.firstName} ${data.profile.lastName}` : "Öğrenci özeti";
  const portalSubtitle = studentPortalSubtitle(view, profileSubtitle);
  function selectReportExam(examId: string) {
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    if (examId) nextSearchParams.set("examId", examId);
    else nextSearchParams.delete("examId");
    router.replace(`?${nextSearchParams.toString()}`);
  }
  const studentActionItems: PortalActionItem[] = [
    {
      actionLabel: unreadAnnouncements > 0 ? "Oku" : "Hazır",
      contextLabel: "Duyuru",
      detail: unreadAnnouncements > 0 ? "Okul duyurusunu kontrol et" : "Okunmamış duyuru yok",
      href: studentPortalHref("/ogrenci/duyurular", isRolePreview),
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
      href: studentPortalHref("/ogrenci/odevler", isRolePreview),
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
      href: studentPortalHref("/ogrenci/devamsizlik", isRolePreview),
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
      href: studentPortalHref("/ogrenci/destek", isRolePreview),
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
      href: studentPortalHref("/ogrenci/raporlar", isRolePreview),
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
      href: studentPortalHref(isRolePreview ? "/ogrenci" : "/ogrenci/profil", isRolePreview),
      key: "preview",
      label: "Önizleme durumu",
      statusLabel: isRolePreview ? "Salt-okuma" : "Canlı",
      tone: isRolePreview ? "neutral" : "info",
      value: isRolePreview ? "Salt-okuma" : "Canlı hesap",
    },
  ];
  return (
    <PortalFrame
      title="Öğrenci Portalı"
      subtitle={portalSubtitle}
      context={studentPortalContext(view, portalSubtitle, isRolePreview)}
    >
      {view === "overview" ? (
        <>
          <PortalDailyBrief
            summary="Devamsızlık, ödev, duyuru ve son sınav durumu tek bakışta; öğrencinin bugün öncelik vermesi gereken işler burada toplanır."
            scope={{
              detail: isRolePreview ? "Salt-okuma önizleme" : "Canlı öğrenci hesabı",
              label: "Öğrenci",
              value: profileSubtitle,
            }}
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
          <PortalActionStrip
            ariaLabel="Öğrenci günlük aksiyonları"
            items={studentActionItems}
            priorityKeys={isRolePreview
              ? ["preview", "announcement", "report"]
              : ["announcement", "homework", "report"]}
          />
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
        </>
      ) : null}
      {isRolePreview ? (
        <div id="portal-preview">
          <RolePreviewNotice />
        </div>
      ) : null}
      {view === "overview" || view === "profile" ? <div id="portal-focus">
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
      </div> : null}
      <PortalWorkspace
        ariaLabel="Öğrenci portal çalışma alanı"
        main={
          <>
            {view === "overview" || view === "reports" ? <div id="portal-report">
              {view === "reports" && (data?.reportIndex.length ?? 0) > 0 ? (
                <Field label="Sınav raporu">
                  <Select value={data?.selectedReportExamId ?? ""} onChange={(event) => selectReportExam(event.target.value)}>
                    {(data?.reportIndex ?? []).map((exam) => <option key={exam.examId} value={exam.examId}>{exam.title}</option>)}
                  </Select>
                </Field>
              ) : null}
              <ReportPanel
                context={data?.report ?? undefined}
                courseNames={courseNameById}
                errorBooklet={data?.errorBooklet ?? null}
                progress={data?.progress ?? null}
                report={data?.report ?? null}
                termNames={termNameById}
              />
            </div> : null}
            {view === "overview" || view === "homework" ? <div id="portal-homework">
              <HomeworkAssignmentsPanel
                assignments={data?.homeworkAssignments ?? []}
                courseNames={courseNameById}
                termNames={termNameById}
              />
            </div> : null}
            {view === "overview" || view === "announcements" ? <div id="portal-announcements">
              <AnnouncementsPanel
                announcements={data?.announcements ?? []}
                readOnly={isRolePreview}
                onMarkRead={(announcement) =>
                  auth && !isRolePreview ? markAnnouncementRead(auth.accessToken, `me/student/announcements/${encodeURIComponent(announcement.id)}/read`).then(() => query.refetch()) : undefined
                }
              />
            </div> : null}
            {view === "overview" || view === "support" ? <div id="portal-support">
              <SupportTicketsPanel
                readOnly={isRolePreview}
                tickets={data?.supportTickets ?? []}
                onCreate={(input) =>
                  auth && !isRolePreview ? createPortalSupportTicket(auth.accessToken, "me/student/support-tickets", input).then(() => query.refetch()) : undefined
                }
              />
            </div> : null}
          </>
        }
        side={
          <>
            {view !== "announcements" && view !== "homework" && view !== "reports" && view !== "support" ? <ProfilePanel profile={data?.profile} /> : null}
            {view === "overview" || view === "profile" ? <GuardianRelationsPanel guardians={data?.guardians ?? []} links={data?.guardianLinks ?? []} /> : null}
            {view === "overview" || view === "profile" ? <StudentHistoryPanel
              enrollments={data?.enrollments ?? []}
              termNames={termNameById}
            /> : null}
            {view === "overview" || view === "attendance" ? <div id="portal-attendance">
              <AttendancePanel records={data?.attendance ?? []} />
            </div> : null}
            {view === "overview" || view === "profile" ? <DevelopmentTrendPanel assessments={data?.developmentAssessments ?? []} /> : null}
            {view === "overview" || view === "profile" || view === "attendance" ? <TeacherNotesPanel notes={data?.teacherNotes ?? []} courseNames={courseNameById} termNames={termNameById} /> : null}
          </>
        }
      />
    </PortalFrame>
  );
}

async function loadStudentPortal(
  accessToken: string,
  rolePreviewToken = "",
  requestedReportExamId = "",
  view: StudentPortalView = "overview",
) {
  const showOverview = view === "overview";
  const showProfile = showOverview || view === "profile";
  const showReports = showOverview || view === "reports";
  const showHomework = showOverview || view === "homework";
  const showAnnouncements = showOverview || view === "announcements";
  const showSupport = showOverview || view === "support";
  const showAttendance = showOverview || view === "attendance";
  const reportIndex = showReports
    ? await apiRequestOrNull<PortalReportIndexItem[]>(accessToken, `${apiBaseUrl}/me/student/reports`, rolePreviewToken) ?? []
    : [];
  const selectedReportExamId = reportIndex.some((record) => record.examId === requestedReportExamId)
    ? requestedReportExamId
    : reportIndex[0]?.examId ?? "";
  const reportRequest = selectedReportExamId
    ? apiRequestOrNull<ReportStudentSnapshot>(accessToken, `${apiBaseUrl}/me/student/reports/${encodeURIComponent(selectedReportExamId)}/latest`, rolePreviewToken)
    : Promise.resolve(null);
  const errorBookletRequest = selectedReportExamId
    ? apiRequestOrNull<ReportErrorBooklet>(
        accessToken,
        `${apiBaseUrl}/me/student/reports/${encodeURIComponent(selectedReportExamId)}/latest/error-booklet`,
        rolePreviewToken,
      )
    : Promise.resolve(null);
  const progressRequest = selectedReportExamId
    ? apiRequestOrNull<ReportStudentProgress>(accessToken, `${apiBaseUrl}/me/student/reports/${encodeURIComponent(selectedReportExamId)}/progress?scope=all`, rolePreviewToken)
    : Promise.resolve(null);

  const [profile, guardians, guardianLinks, enrollments, announcements, homeworkAssignments, supportTickets, attendance, attendanceSummary, teacherNotes, developmentAssessments, report, errorBooklet, progress, courses, terms] = await Promise.all([
    readOnlyRequest<StudentProfileRecord>(accessToken, `${apiBaseUrl}/me/student/profile`, rolePreviewToken),
    showProfile ? readOnlyRequest<GuardianRecord[]>(accessToken, `${apiBaseUrl}/me/student/guardians`, rolePreviewToken) : Promise.resolve([]),
    showProfile ? readOnlyRequest<GuardianStudentRecord[]>(accessToken, `${apiBaseUrl}/me/student/guardian-links`, rolePreviewToken) : Promise.resolve([]),
    showProfile ? readOnlyRequest<StudentEnrollmentRecord[]>(accessToken, `${apiBaseUrl}/me/student/enrollments`, rolePreviewToken) : Promise.resolve([]),
    showAnnouncements ? readOnlyRequest<AnnouncementRecord[]>(accessToken, `${apiBaseUrl}/me/student/announcements`, rolePreviewToken) : Promise.resolve([]),
    showHomework ? readOnlyRequest<HomeworkMaterialAssignmentRecord[]>(
      accessToken,
      `${apiBaseUrl}/me/student/homework/material-assignments`,
      rolePreviewToken,
    ) : Promise.resolve([]),
    showSupport ? readOnlyRequest<SupportTicketRecord[]>(accessToken, `${apiBaseUrl}/me/student/support-tickets`, rolePreviewToken) : Promise.resolve([]),
    showAttendance ? readOnlyRequest<AttendanceRecord[]>(accessToken, `${apiBaseUrl}/me/student/attendance`, rolePreviewToken) : Promise.resolve([]),
    showAttendance ? readOnlyRequest<AttendanceSummaryRecord>(accessToken, `${apiBaseUrl}/me/student/attendance/summary`, rolePreviewToken) : Promise.resolve({} as AttendanceSummaryRecord),
    showProfile || showAttendance ? readOnlyRequest<TeacherNoteRecord[]>(accessToken, `${apiBaseUrl}/me/student/teacher-notes`, rolePreviewToken) : Promise.resolve([]),
    showProfile ? readOnlyRequest<DevelopmentTrendItem[]>(accessToken, `${apiBaseUrl}/me/student/development-assessments`, rolePreviewToken) : Promise.resolve([]),
    reportRequest,
    errorBookletRequest,
    progressRequest,
    showProfile || showReports || showHomework || showAttendance ? readOnlyRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`, rolePreviewToken) : Promise.resolve([]),
    showProfile || showReports || showHomework || showAttendance ? readOnlyRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`, rolePreviewToken) : Promise.resolve([]),
  ]);

  return { profile, guardians, guardianLinks, enrollments, announcements, homeworkAssignments, supportTickets, attendance, attendanceSummary, teacherNotes, developmentAssessments, report, errorBooklet, progress, courses, terms, reportIndex, selectedReportExamId };
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

function studentPortalHref(path: string, isRolePreview: boolean) {
  return isRolePreview ? `${path}?rolePreview=1` : path;
}

function studentPortalSubtitle(view: StudentPortalView, fallback: string) {
  const subtitleByView: Record<StudentPortalView, string> = {
    announcements: "Duyurular",
    attendance: "Devamsızlık",
    homework: "Ödevler",
    overview: fallback,
    profile: "Profil ve kayıt bilgileri",
    reports: "Sınav raporu",
    support: "Destek talepleri",
  };

  return subtitleByView[view];
}

function studentPortalContext(view: StudentPortalView, label: string, isRolePreview: boolean) {
  const detailByView: Record<StudentPortalView, string> = {
    announcements: "Okunmamış duyurular ve okul bilgilendirmeleri",
    attendance: "Devamsızlık kayıtları ve geç kalma özeti",
    homework: "Ödev ve materyal atamaları",
    overview: "Günlük durum, ödev, devamsızlık, duyuru ve son sınav",
    profile: "Profil, veli ilişkileri ve kayıt geçmişi",
    reports: "Son sınavda başarı %, net ve soru bağlamı",
    support: "Destek talepleri ve yanıt durumu",
  };

  return {
    detail: detailByView[view],
    label,
    meta: isRolePreview ? "Salt-okuma" : "Canlı öğrenci hesabı",
  };
}
