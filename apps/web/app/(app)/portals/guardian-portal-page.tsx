"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { SegmentedControl } from "@o-okul/ui";
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
} from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetch, readData } from "../../../src/api-client.js";
import type { SupportTicketFormPayload } from "../../../src/form-validation.js";
import { useAuth } from "../../providers.js";
import { AttendancePanel, TeacherNotesPanel } from "./_shared/activity-panels.js";
import { AnnouncementsPanel } from "./_shared/announcements-panel.js";
import { DevelopmentTrendPanel, type DevelopmentTrendItem } from "./_shared/development-panel.js";
import { GuardianRelationshipSummaryPanel, NotificationPreferencesPanel, PaymentPlansPanel } from "./_shared/guardian-panels.js";
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
import { ProfilePanel, StudentFocusPanel, StudentHistoryPanel } from "./_shared/student-panels.js";
import { SupportTicketsPanel } from "./_shared/support-tickets-panel.js";
import { readReportExamId } from "../_shared/report-exam-selection.js";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../_shared/report-metrics.js";

export type GuardianPortalView = "announcements" | "homework" | "notifications" | "overview" | "payments" | "reports" | "student" | "support";

export function GuardianPortalPage({ view = "overview" }: { view?: GuardianPortalView } = {}) {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const rolePreviewToken = readRolePreviewToken(searchParams);
  const reportExamId = readReportExamId(searchParams, "");
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

  if (studentsQuery.isPending) {
    return (
      <PortalFrame title="Veli Portalı" subtitle="Bağlı öğrenci özeti">
        <PortalStatePanel
          state="loading"
          title="Veli öğrenci kapsamı hazırlanıyor"
          description="Bağlı öğrenciler ve izin kapsamı güvenli oturumdan yükleniyor."
        />
      </PortalFrame>
    );
  }

  if (studentsQuery.isError) {
    return (
      <PortalFrame title="Veli Portalı" subtitle="Bağlı öğrenci özeti">
        <PortalStatePanel
          state="error"
          title="Veli öğrenci kapsamı alınamadı"
          description="Bağlı öğrenci listesi gösterilemiyor. Finans ve iletişim bilgileri hata durumunda açılmaz."
        />
      </PortalFrame>
    );
  }

  if (!resolvedStudentId) {
    return (
      <PortalFrame title="Veli Portalı" subtitle="Bağlı öğrenci özeti">
        <PortalStatePanel
          state="empty"
          title="Bağlı öğrenci bulunamadı"
          description="Bu veli hesabı için görüntülenebilir öğrenci ilişkisi yok."
        />
      </PortalFrame>
    );
  }

  if (studentQuery.isPending) {
    return (
      <PortalFrame title="Veli Portalı" subtitle={selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "Bağlı öğrenci özeti"}>
        <PortalStatePanel
          state="loading"
          title="Seçili öğrenci verileri hazırlanıyor"
          description="Duyuru, ödev, rapor ve izin verilen finans bağlamı seçili öğrenci için yükleniyor."
        />
      </PortalFrame>
    );
  }

  if (studentQuery.isError) {
    return (
      <PortalFrame title="Veli Portalı" subtitle={selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "Bağlı öğrenci özeti"}>
        <PortalStatePanel
          state="error"
          title="Seçili öğrenci verisi alınamadı"
          description="Bu durumda finans, iletişim veya rapor detayı ham olarak açılmaz."
        />
      </PortalFrame>
    );
  }

  const data = studentQuery.data;
  const courseNameById = new Map((data?.courses ?? []).map((course) => [course.id, course.name]));
  const termNameById = new Map((data?.terms ?? []).map((term) => [term.id, term.name]));
  const canViewFinance = data?.notificationPreferences?.canViewFinance === true;
  const reportTotal = data?.report?.total;
  const reportSuccess = reportSuccessRate(reportTotal);
  const unreadAnnouncements = (data?.announcements ?? []).filter((announcement) => !announcement.readAt).length;
  const openSupportTickets = (data?.supportTickets ?? []).filter(isOpenSupportTicket).length;
  const canOpenSupportTickets = data?.notificationPreferences?.canOpenSupportTickets !== false;
  const announcementStatus = unreadAnnouncements > 0 ? `${unreadAnnouncements} okunmamış` : "Güncel";
  const homeworkStatus = `${data?.homeworkAssignments.length ?? 0} atama`;
  const attendanceStatus = `${data?.attendanceSummary.total ?? 0} kayıt`;
  const supportStatus = canOpenSupportTickets ? (openSupportTickets > 0 ? `${openSupportTickets} açık` : "Açık talep yok") : "Kapalı";
  const financeStatus = canViewFinance ? formatPendingPayment(data?.paymentPlans ?? []) : "Kapalı";
  const supportReadOnly = isRolePreview || !canOpenSupportTickets;
  const selectedStudentLabel = selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "Seçilmedi";
  const selectedStudentDetail = data?.profile?.className ?? "Bağlı öğrenci";
  const guardianActionItems: PortalActionItem[] = [
    {
      actionLabel: "İzle",
      contextLabel: "Öğrenci",
      detail: selectedStudentDetail,
      href: guardianPortalHref("/veli/ogrenci", isRolePreview),
      key: "student",
      label: "Öğrenci seç",
      statusLabel: selectedStudent ? "Seçili" : "Bekliyor",
      tone: selectedStudent ? "info" : "neutral",
      value: selectedStudentLabel,
    },
    {
      actionLabel: unreadAnnouncements > 0 ? "Oku" : "Hazır",
      contextLabel: "Duyuru",
      detail: unreadAnnouncements > 0 ? "Veli duyurusunu kontrol et" : "Okunmamış duyuru yok",
      href: guardianPortalHref("/veli/duyurular", isRolePreview),
      key: "announcement",
      label: "Duyuruları oku",
      statusLabel: unreadAnnouncements > 0 ? "Bekliyor" : "Güncel",
      tone: unreadAnnouncements > 0 ? "warning" : "success",
      value: announcementStatus,
    },
    {
      actionLabel: (data?.homeworkAssignments.length ?? 0) > 0 ? "Kontrol" : "Hazır",
      contextLabel: "Ödev",
      detail: "Öğrenci çalışma takibi",
      href: guardianPortalHref("/veli/odevler", isRolePreview),
      key: "homework",
      label: "Ödevi kontrol et",
      statusLabel: (data?.homeworkAssignments.length ?? 0) > 0 ? "Takip" : "Tamam",
      tone: (data?.homeworkAssignments.length ?? 0) > 0 ? "info" : "success",
      value: homeworkStatus,
    },
    {
      actionLabel: canViewFinance ? "Takip" : "Kapalı",
      contextLabel: "Finans",
      detail: canViewFinance ? "İzinli finans görünümü" : "Finans görünürlüğü kapalı",
      href: guardianPortalHref("/veli/odemeler", isRolePreview),
      key: "finance",
      label: "Ödeme durumunu gör",
      statusLabel: canViewFinance ? "İzinli" : "Kapalı",
      tone: canViewFinance && (data?.paymentPlans.length ?? 0) > 0 ? "warning" : "neutral",
      value: canViewFinance ? financeStatus : "Ödeme izni kapalı",
    },
    {
      actionLabel: supportReadOnly ? (isRolePreview ? "Salt-okuma" : "Kapalı") : openSupportTickets > 0 ? "Takip et" : "Talep aç",
      contextLabel: "Destek",
      detail: supportReadOnly ? (isRolePreview ? "Destek talebi açma kapalı" : "Destek talebi izni kapalı") : "Veli destek kapsamı",
      href: guardianPortalHref("/veli/destek", isRolePreview),
      key: "support",
      label: "Destek talebini takip et",
      statusLabel: supportReadOnly ? (isRolePreview ? "Salt-okuma" : "Kapalı") : openSupportTickets > 0 ? "Açık" : "Hazır",
      tone: !supportReadOnly && openSupportTickets > 0 ? "warning" : "neutral",
      value: supportStatus,
    },
    {
      actionLabel: "İncele",
      contextLabel: "Rapor",
      detail: `${formatNetNumber(reportTotal?.net)} net / ${formatNetNumber(reportQuestionCount(reportTotal))} soru`,
      href: guardianPortalHref("/veli/raporlar", isRolePreview),
      key: "report",
      label: "Son sınavı incele",
      statusLabel: "Başarı %",
      tone: (reportSuccess ?? 0) >= 75 ? "success" : "info",
      value: formatPercentNumber(reportSuccess),
    },
    {
      actionLabel: isRolePreview ? "Salt-okuma" : "Canlı",
      contextLabel: "Erişim",
      detail: isRolePreview ? "Yazma işlemleri kapalı" : "İzinli veli işlemleri açık",
      href: guardianPortalHref(isRolePreview ? "/veli" : "/veli/bildirimler", isRolePreview),
      key: "preview",
      label: "Önizleme durumu",
      statusLabel: isRolePreview ? "Salt-okuma" : "Canlı",
      tone: isRolePreview ? "neutral" : "info",
      value: isRolePreview ? "Salt-okuma" : "Canlı hesap",
    },
  ];
  return (
    <PortalFrame title="Veli Portalı" subtitle={guardianPortalSubtitle(view, selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "Bağlı öğrenci özeti")}>
      <SegmentedControl className="next-segmented" id="portal-student-picker" label="Öğrenci seçimi">
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
      </SegmentedControl>
      {view === "overview" ? (
        <>
          <PortalDailyBrief
            summary="Veli için bugün izlenecek başlıklar seçili öğrenciye göre daraltılır; finans ve destek alanları yalnız izin verilen kapsamda görünür."
            items={[
              {
                label: "Öğrenci",
                value: selectedStudentLabel,
                detail: selectedStudentDetail,
                tone: selectedStudent ? "info" : "neutral",
              },
              {
                label: "Duyuru",
                value: unreadAnnouncements > 0 ? `${unreadAnnouncements} okunmamış` : "Güncel",
                detail: unreadAnnouncements > 0 ? "Veli duyurusu bekliyor" : "Okunmamış duyuru yok",
                tone: unreadAnnouncements > 0 ? "warning" : "success",
              },
              {
                label: "Ödev",
                value: `${data?.homeworkAssignments.length ?? 0} atama`,
                detail: "Öğrenci çalışma takibi",
                tone: (data?.homeworkAssignments.length ?? 0) > 0 ? "info" : "neutral",
              },
              {
                label: "Ödeme",
                value: canViewFinance ? formatPendingPayment(data?.paymentPlans ?? []) : "Ödeme izni kapalı",
                detail: canViewFinance ? "Bekleyen veya geciken tutar" : "Finans görünürlüğü kapalı",
                tone: canViewFinance && (data?.paymentPlans.length ?? 0) > 0 ? "warning" : "neutral",
              },
              {
                label: "Destek",
                value: canOpenSupportTickets ? (openSupportTickets > 0 ? `${openSupportTickets} açık` : "Açık talep yok") : "Kapalı",
                detail: canOpenSupportTickets ? "Veli destek kapsamı" : "Destek talebi izni kapalı",
                tone: canOpenSupportTickets && openSupportTickets > 0 ? "warning" : "success",
              },
              {
                label: "Son sınav",
                value: formatPercentNumber(reportSuccess),
                detail: `${formatNetNumber(reportTotal?.net)} net / ${formatNetNumber(reportQuestionCount(reportTotal))} soru`,
                tone: (reportSuccess ?? 0) >= 75 ? "success" : "info",
              },
            ]}
          />
          <PortalActionStrip ariaLabel="Veli günlük aksiyonları" items={guardianActionItems} />
          <MetricGrid
            items={[
              { label: "Devamsızlık", value: data?.attendanceSummary.total ?? 0 },
              { label: "Öğretmen notu", value: data?.teacherNotes.length ?? 0 },
              { label: "Ödev", value: data?.homeworkAssignments.length ?? 0 },
              { label: "Başarı", value: formatPercentNumber(reportSuccessRate(reportTotal)) },
              { label: "Net", value: formatNetNumber(reportTotal?.net) },
              { label: "Soru", value: formatNetNumber(reportQuestionCount(reportTotal)) },
              { label: "Ödeme planı", value: canViewFinance ? data?.paymentPlans.length ?? 0 : "Kapalı" },
              { label: "Bekleyen ödeme", value: canViewFinance ? formatPendingPayment(data?.paymentPlans ?? []) : "Kapalı" },
            ]}
          />
        </>
      ) : null}
      {isRolePreview ? (
        <div id="portal-preview">
          <RolePreviewNotice />
        </div>
      ) : null}
      {view === "overview" || view === "student" ? <div id="portal-focus">
        <StudentFocusPanel
          announcementStatus={announcementStatus}
          attendanceStatus={attendanceStatus}
          financeStatus={financeStatus}
          homeworkStatus={homeworkStatus}
          mode={isRolePreview ? "read-only" : "guardian"}
          net={formatNetNumber(reportTotal?.net)}
          profile={data?.profile}
          questionCount={formatNetNumber(reportQuestionCount(reportTotal))}
          scopeLabel={data?.notificationPreferences ? guardianRelationshipLabel(data.notificationPreferences.relationshipType) : "Veli kapsamı"}
          successRate={formatPercentNumber(reportSuccess)}
          supportStatus={supportStatus}
        />
      </div> : null}
      <PortalWorkspace
        ariaLabel="Veli portal çalışma alanı"
        main={
          <>
            {view === "overview" || view === "reports" ? <div id="portal-report">
              <ReportPanel
                context={data?.report ?? undefined}
                courseNames={courseNameById}
                errorBooklet={data?.errorBooklet ?? null}
                progress={data?.progress ?? null}
                report={data?.report ?? null}
                termNames={termNameById}
              />
            </div> : null}
            {view === "overview" || view === "payments" ? <div id="portal-payments">
              <PaymentPlansPanel canViewFinance={canViewFinance} plans={data?.paymentPlans ?? []} />
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
                  auth && resolvedStudentId && !isRolePreview
                    ? markAnnouncementRead(
                        auth.accessToken,
                        `me/guardian/students/${encodeURIComponent(resolvedStudentId)}/announcements/${encodeURIComponent(announcement.id)}/read`,
                      ).then(() => studentQuery.refetch())
                    : undefined
                }
              />
            </div> : null}
            {view === "overview" || view === "support" ? <div id="portal-support">
              <SupportTicketsPanel
                readOnly={supportReadOnly}
                readOnlyMessage={isRolePreview ? undefined : "Veli destek talebi izni kapalı."}
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
            </div> : null}
          </>
        }
        side={
          <>
            {view === "overview" || view === "student" ? <ProfilePanel profile={data?.profile} /> : null}
            {view === "overview" || view === "student" ? <StudentHistoryPanel
              classHistory={data?.classHistory ?? []}
              enrollments={data?.enrollments ?? []}
              termNames={termNameById}
            /> : null}
            {view === "overview" || view === "student" || view === "notifications" ? <GuardianRelationshipSummaryPanel relationship={data?.notificationPreferences} /> : null}
            {view === "overview" || view === "notifications" ? <NotificationPreferencesPanel
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
            /> : null}
            {view === "overview" || view === "student" ? <DevelopmentTrendPanel assessments={data?.developmentAssessments ?? []} /> : null}
            {view === "overview" || view === "student" ? <TeacherNotesPanel notes={data?.teacherNotes ?? []} courseNames={courseNameById} termNames={termNameById} /> : null}
            {view === "overview" || view === "student" ? <AttendancePanel records={data?.attendance ?? []} /> : null}
          </>
        }
      />
    </PortalFrame>
  );
}

async function loadGuardianStudentPortal(accessToken: string, studentId: string, rolePreviewToken = "", reportExamId = "") {
  const notificationPreferences = await readOnlyRequest<GuardianStudentRecord>(
    accessToken,
    `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/notification-preferences`,
    rolePreviewToken,
  );
  const canViewFinance = notificationPreferences.canViewFinance === true;
  const reportRequest = reportExamId
    ? apiRequestOrNull<ReportStudentSnapshot>(
        accessToken,
        `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/reports/${encodeURIComponent(reportExamId)}/latest`,
        rolePreviewToken,
      )
    : Promise.resolve(null);
  const errorBookletRequest = reportExamId
    ? apiRequestOrNull<ReportErrorBooklet>(
        accessToken,
        `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/reports/${encodeURIComponent(reportExamId)}/latest/error-booklet`,
        rolePreviewToken,
      )
    : Promise.resolve(null);
  const progressRequest = reportExamId
    ? apiRequestOrNull<ReportStudentProgress>(
        accessToken,
        `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/reports/${encodeURIComponent(reportExamId)}/progress?scope=all`,
        rolePreviewToken,
      )
    : Promise.resolve(null);
  const [profile, classHistory, enrollments, announcements, homeworkAssignments, supportTickets, attendance, attendanceSummary, teacherNotes, developmentAssessments, paymentPlans, report, errorBooklet, progress, courses, terms] = await Promise.all([
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
    readOnlyRequest<AnnouncementRecord[]>(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/announcements`, rolePreviewToken),
    readOnlyRequest<HomeworkMaterialAssignmentRecord[]>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/homework/material-assignments`,
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
    canViewFinance
      ? apiRequestOrEmptyPaymentPlans(
          accessToken,
          `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/payment-plans`,
          rolePreviewToken,
        )
      : Promise.resolve([]),
    reportRequest,
    errorBookletRequest,
    progressRequest,
    readOnlyRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`, rolePreviewToken),
    readOnlyRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`, rolePreviewToken),
  ]);

  return {
    profile,
    classHistory,
    enrollments,
    notificationPreferences,
    announcements,
    homeworkAssignments,
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

function guardianRelationshipLabel(value: GuardianStudentRecord["relationshipType"]) {
  const labels: Record<GuardianStudentRecord["relationshipType"], string> = {
    EMERGENCY_CONTACT: "Acil kişi",
    FATHER: "Baba",
    GUARDIAN: "Vasi",
    MOTHER: "Anne",
    OTHER: "Diğer",
  };
  return labels[value];
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

function formatNetNumber(value: number | undefined) {
  return value === undefined ? "-" : value.toLocaleString("tr-TR", { maximumFractionDigits: 2 });
}

function isOpenSupportTicket(ticket: SupportTicketRecord) {
  return ticket.status === "OPEN" || ticket.status === "IN_PROGRESS";
}

function guardianPortalHref(path: string, isRolePreview: boolean) {
  return isRolePreview ? `${path}?rolePreview=1` : path;
}

function guardianPortalSubtitle(view: GuardianPortalView, fallback: string) {
  const subtitleByView: Record<GuardianPortalView, string> = {
    announcements: "Duyurular",
    homework: "Ödevler",
    notifications: "Bildirim tercihleri",
    overview: fallback,
    payments: "Ödemeler",
    reports: "Sınav raporu",
    student: "Bağlı öğrenci",
    support: "Destek talepleri",
  };

  return subtitleByView[view];
}
