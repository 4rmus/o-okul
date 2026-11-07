"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Field, SegmentedControl, Select } from "@o-okul/ui";
import type {
  AcademicTermRecord,
  AnnouncementRecord,
  AttendanceRecord,
  AttendanceSummaryRecord,
  CourseRecord,
  GuardianStudentOverview,
  GuardianStudentRecord,
  HomeworkMaterialAssignmentRecord,
  PaymentPlanWithInstallmentsRecord,
  PortalReportIndexItem,
  ReportErrorBooklet,
  ReportStudentProgress,
  ReportStudentSnapshot,
  StudentEnrollmentRecord,
  StudentHomeworkRecord,
  StudentProfileRecord,
  StudentRecord,
  SupportTicketRecord,
  TeacherNoteRecord,
} from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetch, readData } from "../../../src/api-client.js";
import type { SupportTicketFormPayload } from "../../../src/form-validation.js";
import { useAuth } from "../../providers.js";
import { PushPermissionPrompt } from "../_shell/push-devices.js";
import { AttendancePanel, TeacherNotesPanel } from "./_shared/activity-panels.js";
import { AnnouncementsPanel } from "./_shared/announcements-panel.js";
import { PortalAttendanceCalendar } from "./_shared/attendance-calendar.js";
import { DevelopmentTrendPanel, type DevelopmentTrendItem } from "./_shared/development-panel.js";
import { GuardianRelationshipSummaryPanel, NotificationPreferencesPanel, PaymentPlansPanel } from "./_shared/guardian-panels.js";
import { GuardianHomeworkPanel, countOpenGuardianHomework } from "./_shared/homework-panels.js";
import {
  AccessPanel,
  PortalActionStrip,
  PortalDailyBrief,
  PortalFrame,
  PortalStatePanel,
  PortalWorkspace,
  RolePreviewNotice,
  type PortalActionItem,
  readRolePreviewToken,
} from "./_shared/portal-shell.js";
import {
  PanelLoading,
  PortalPanelGate,
  allPanelsFailed,
  emptyList,
  retryFailedPanels,
  usePortalPanelQuery,
} from "./_shared/portal-panel-state.js";
import { ProgressSeriesPanel } from "./_shared/progress-series-panel.js";
import { ReportPanel } from "./_shared/report-panel.js";
import { ProfilePanel, StudentFocusPanel, StudentHistoryPanel } from "./_shared/student-panels.js";
import { SupportTicketsPanel } from "./_shared/support-tickets-panel.js";
import { formatAttendanceSummary } from "../_shared/attendance-summary.js";
import { readReportExamId } from "../_shared/report-exam-selection.js";
import { formatPercentNumber, reportQuestionCount, reportSuccessRate } from "../_shared/report-metrics.js";

export type GuardianPortalView = "announcements" | "homework" | "notifications" | "overview" | "payments" | "reports" | "student" | "support";

export function GuardianPortalPage({ view = "overview" }: { view?: GuardianPortalView } = {}) {
  const { auth } = useAuth();
  const router = useRouter();
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
  // A link may name the ward (?studentId=, e.g. from the announcement bell). It seeds the selection only when it is one
  // of the guardian's own wards; any other value is ignored. A new value replaces an earlier manual choice.
  const requestedStudentId = searchParams.get("studentId") ?? "";
  const [seededStudentId, setSeededStudentId] = useState(requestedStudentId);
  if (seededStudentId !== requestedStudentId) {
    setSeededStudentId(requestedStudentId);
    setSelectedStudentId(null);
  }
  const requestedWardId = students.some((student) => student.id === requestedStudentId) ? requestedStudentId : undefined;
  const resolvedStudentId = selectedStudentId ?? requestedWardId ?? students[0]?.id;
  const accessToken = auth?.accessToken ?? "";
  const panels = guardianPortalPanels(view);
  const studentReady = Boolean(canReadPortal && resolvedStudentId);
  const studentId = resolvedStudentId ?? "";
  const panelKey = (panel: string, ...rest: string[]) =>
    ["next-guardian-portal", auth?.session.userId ?? "anonymous", resolvedStudentId ?? "none", rolePreviewToken || "session", panel, ...rest];
  const get = <T,>(suffix: string) => () =>
    readOnlyRequest<T>(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}${suffix}`, rolePreviewToken);
  // Her panel seçili öğrenci için kendi sorgusudur; biri düşerse yalnız o panel hata ve "Tekrar dene" gösterir.
  const preferencesQuery = usePortalPanelQuery(panelKey("notification-preferences"), studentReady && panels.notifications, get<GuardianStudentRecord>("/notification-preferences"));
  const profileQuery = usePortalPanelQuery(panelKey("profile"), studentReady, get<StudentProfileRecord>("/profile"));
  const enrollmentsQuery = usePortalPanelQuery(panelKey("enrollments"), studentReady && panels.student, get<StudentEnrollmentRecord[]>("/enrollments"));
  const announcementsQuery = usePortalPanelQuery(panelKey("announcements"), studentReady && panels.announcements, get<AnnouncementRecord[]>("/announcements"));
  const homeworkQuery = usePortalPanelQuery(
    panelKey("homework"),
    studentReady && panels.homework,
    () => readOnlyRequest<HomeworkMaterialAssignmentRecord[]>(
      accessToken,
      `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/homework/material-assignments`,
      rolePreviewToken,
    ),
  );
  // DEC-20261103-01: sınıf ödevleri (öğrencinin teslim durumuyla) ayrı sorgudur; biri düşerse diğeri yine gösterilir.
  const classHomeworkQuery = usePortalPanelQuery(panelKey("class-homework"), studentReady && panels.homework, get<StudentHomeworkRecord[]>("/homework"));
  const supportTicketsQuery = usePortalPanelQuery(
    panelKey("support-tickets"),
    studentReady && panels.support,
    () => apiRequestOrEmptySupportTickets(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/support-tickets`, rolePreviewToken),
  );
  const attendanceQuery = usePortalPanelQuery(panelKey("attendance"), studentReady && panels.student, async () => {
    const [records, summary] = await Promise.all([get<AttendanceRecord[]>("/attendance")(), get<AttendanceSummaryRecord>("/attendance/summary")()]);
    return { records, summary };
  });
  const teacherNotesQuery = usePortalPanelQuery(panelKey("teacher-notes"), studentReady && panels.student, get<TeacherNoteRecord[]>("/teacher-notes"));
  const developmentQuery = usePortalPanelQuery(panelKey("development"), studentReady && panels.student, get<DevelopmentTrendItem[]>("/development-assessments"));
  // Finans yalnız ilişki izni okunup canViewFinance === true çıktıktan sonra istenir; izin yoksa istek hiç gitmez.
  // Önbellekteki eski izin kullanılmaz: izin yeniden okunurken (sayfa geçişinde) finans beklenir ve gösterilmez.
  // Destek talebi açma da aynı kuralla açılır (fail closed): izin okunamadıysa, gelmediyse veya yenileniyorsa form kapalıdır.
  const permissionFresh = preferencesQuery.isSuccess && !preferencesQuery.isFetching;
  const canViewFinance = permissionFresh && preferencesQuery.data?.canViewFinance === true;
  const canOpenSupportTickets = permissionFresh && preferencesQuery.data?.canOpenSupportTickets === true;
  const paymentPlansQuery = usePortalPanelQuery(
    panelKey("payment-plans"),
    studentReady && panels.payments && canViewFinance,
    () => apiRequestOrEmptyPaymentPlans(accessToken, `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/payment-plans`, rolePreviewToken),
  );
  const reportQuery = usePortalPanelQuery(
    panelKey("report", reportExamId),
    studentReady && panels.reports,
    () => loadGuardianReport(accessToken, studentId, rolePreviewToken, reportExamId),
  );
  // KV-4 read model: optical and school-grade series. The legacy per-panel endpoints stay (strangler).
  const overviewQuery = usePortalPanelQuery(panelKey("overview"), studentReady && panels.overview, () => loadGuardianOverview(accessToken, studentId, rolePreviewToken));
  // Ders ve dönem adları yalnız etiket içindir; alınamazsa paneller "bilgi yok" yazar, hata paneli açılmaz.
  const lookupsQuery = usePortalPanelQuery(panelKey("lookups"), studentReady && panels.lookups, async () => {
    const [courses, terms] = await Promise.all([
      readOnlyRequest<CourseRecord[]>(accessToken, `${apiBaseUrl}/courses`, rolePreviewToken).catch(() => [] as CourseRecord[]),
      readOnlyRequest<AcademicTermRecord[]>(accessToken, `${apiBaseUrl}/academic-terms`, rolePreviewToken).catch(() => [] as AcademicTermRecord[]),
    ]);
    return { courses, terms };
  });
  const panelQueries = [
    preferencesQuery,
    profileQuery,
    enrollmentsQuery,
    announcementsQuery,
    homeworkQuery,
    classHomeworkQuery,
    supportTicketsQuery,
    attendanceQuery,
    teacherNotesQuery,
    developmentQuery,
    paymentPlansQuery,
    reportQuery,
    overviewQuery,
  ];
  const selectedStudent = useMemo(
    () => students.find((student) => student.id === resolvedStudentId),
    [resolvedStudentId, students],
  );
  function selectReportExam(examId: string) {
    const nextSearchParams = new URLSearchParams(searchParams.toString());
    if (examId) nextSearchParams.set("examId", examId);
    else nextSearchParams.delete("examId");
    router.replace(`?${nextSearchParams.toString()}`);
  }

  if (!canReadPortal) {
    return <AccessPanel title="Veli Portalı" />;
  }

  if (studentsQuery.isPending) {
    return (
      <PortalFrame title="Veli Portalı" subtitle="Bağlı öğrenci özeti">
        <PortalStatePanel
          state="loading"
          title="Veli öğrenci kapsamı hazırlanıyor"
          description="Bağlı öğrenciler ve izinler yükleniyor."
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
          description="Bağlı öğrenci listesi gösterilemiyor. Bağlantınızı kontrol edip tekrar deneyin."
          onRetry={() => void studentsQuery.refetch()}
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

  if (allPanelsFailed(panelQueries)) {
    return (
      <PortalFrame title="Veli Portalı" subtitle={selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "Bağlı öğrenci özeti"}>
        <PortalStatePanel
          state="error"
          title="Seçili öğrenci verisi alınamadı"
          description="Bu durumda finans, iletişim veya rapor detayı ham olarak açılmaz."
          onRetry={() => retryFailedPanels(...panelQueries)}
        />
      </PortalFrame>
    );
  }

  const homeworkAssignments = homeworkQuery.data ?? emptyList<HomeworkMaterialAssignmentRecord>();
  const classHomework = classHomeworkQuery.data ?? emptyList<StudentHomeworkRecord>();
  const data = {
    announcements: announcementsQuery.data ?? emptyList<AnnouncementRecord>(),
    attendance: attendanceQuery.data?.records ?? emptyList<AttendanceRecord>(),
    attendanceSummary: attendanceQuery.data?.summary,
    courses: lookupsQuery.data?.courses ?? emptyList<CourseRecord>(),
    developmentAssessments: developmentQuery.data ?? emptyList<DevelopmentTrendItem>(),
    enrollments: enrollmentsQuery.data ?? emptyList<StudentEnrollmentRecord>(),
    errorBooklet: reportQuery.data?.errorBooklet ?? null,
    homeworkAssignments,
    notificationPreferences: preferencesQuery.data,
    overview: overviewQuery.data ?? null,
    paymentPlans: paymentPlansQuery.data ?? emptyList<PaymentPlanWithInstallmentsRecord>(),
    profile: profileQuery.data,
    progress: reportQuery.data?.progress ?? null,
    report: reportQuery.data?.report ?? null,
    reportIndex: reportQuery.data?.reportIndex ?? emptyList<PortalReportIndexItem>(),
    selectedReportExamId: reportQuery.data?.selectedReportExamId ?? "",
    supportTickets: supportTicketsQuery.data ?? emptyList<SupportTicketRecord>(),
    teacherNotes: teacherNotesQuery.data ?? emptyList<TeacherNoteRecord>(),
    terms: lookupsQuery.data?.terms ?? emptyList<AcademicTermRecord>(),
  };
  const courseNameById = new Map((data?.courses ?? []).map((course) => [course.id, course.name]));
  const termNameById = new Map((data?.terms ?? []).map((term) => [term.id, term.name]));
  const reportTotal = data?.report?.total;
  const reportSuccess = reportSuccessRate(reportTotal);
  const unreadAnnouncements = (data?.announcements ?? []).filter((announcement) => !announcement.readAt).length;
  const openSupportTickets = (data?.supportTickets ?? []).filter(isOpenSupportTicket).length;
  const announcementStatus = unreadAnnouncements > 0 ? `${unreadAnnouncements} okunmamış` : "Güncel";
  // UAT U17: "Ödev" sayısı açık işleri sayar (teslim edilmemiş sınıf ödevi + materyal ataması), öğrenci portalıyla aynı.
  const openHomeworkCount = countOpenGuardianHomework(classHomework, homeworkAssignments);
  const homeworkLoading = homeworkQuery.isLoading || classHomeworkQuery.isLoading;
  const homeworkSourceQueries = [homeworkQuery, classHomeworkQuery];
  // A failed source makes the count a lower bound, never a definite (success-toned) number.
  const homeworkPartial = !homeworkLoading && homeworkSourceQueries.some((query) => query.isError);
  const homeworkStatus = homeworkPartial
    ? openHomeworkCount > 0 ? `en az ${openHomeworkCount} açık ödev` : "Alınamadı"
    : `${openHomeworkCount} açık ödev`;
  const homeworkDetail = homeworkPartial ? "Ödevlerin bir kısmı alınamadı" : "Sınıf ödevleri ve materyal atamaları";
  const homeworkGateQueries = homeworkSourceQueries.every((query) => query.isError)
    ? homeworkSourceQueries
    : homeworkSourceQueries.filter((query) => query.isLoading);
  const attendanceStatus = formatAttendanceSummary(data?.attendanceSummary);
  // İzin okunurken finans ve destek "Kapalı" değil "Yükleniyor…" gösterir; kapalı yalnız okunan izin false ise yazılır.
  const financeLoading = preferencesQuery.isLoading || (panels.payments && preferencesQuery.isFetching) || paymentPlansQuery.isLoading;
  const supportPermissionLoading = preferencesQuery.isLoading || (panels.support && preferencesQuery.isFetching);
  const supportLoading = supportPermissionLoading || supportTicketsQuery.isLoading;
  const supportStatus = supportLoading
    ? panelLoadingValue
    : canOpenSupportTickets ? (openSupportTickets > 0 ? `${openSupportTickets} açık` : "Açık talep yok") : "Kapalı";
  const financeStatus = financeLoading ? panelLoadingValue : canViewFinance ? formatPendingPayment(data?.paymentPlans ?? []) : "Kapalı";
  const supportReadOnly = isRolePreview || !canOpenSupportTickets;
  const hasPendingPayment = canViewFinance && !financeLoading && (data?.paymentPlans ?? []).some((plan) =>
    plan.installments.some((installment) => installment.status === "PENDING"));
  const selectedStudentLabel = selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "Seçilmedi";
  const selectedStudentDetail = data?.profile?.className ?? "Bağlı öğrenci";
  const portalSubtitle = guardianPortalSubtitle(view, selectedStudent ? `${selectedStudent.firstName} ${selectedStudent.lastName}` : "Bağlı öğrenci özeti");
  const guardianActionItems: PortalActionItem[] = [
    {
      actionLabel: "İzle",
      contextLabel: "Öğrenci",
      detail: selectedStudentDetail,
      href: guardianPortalHref("/veli/ogrenci", isRolePreview),
      key: "student",
      label: "Öğrenci seç",
      pending: false,
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
      pending: unreadAnnouncements > 0,
      statusLabel: unreadAnnouncements > 0 ? "Bekliyor" : "Güncel",
      tone: unreadAnnouncements > 0 ? "warning" : "success",
      value: announcementStatus,
    },
    {
      actionLabel: homeworkPartial || openHomeworkCount > 0 ? "Kontrol" : "Hazır",
      contextLabel: "Ödev",
      detail: homeworkDetail,
      href: guardianPortalHref("/veli/odevler", isRolePreview),
      key: "homework",
      label: "Ödevi kontrol et",
      pending: openHomeworkCount > 0,
      statusLabel: homeworkPartial ? "Eksik" : openHomeworkCount > 0 ? "Takip" : "Tamam",
      tone: homeworkPartial ? "warning" : openHomeworkCount > 0 ? "info" : "success",
      value: homeworkLoading ? panelLoadingValue : homeworkStatus,
    },
    {
      actionLabel: financeLoading ? "Bekle" : canViewFinance ? "Takip" : "Kapalı",
      contextLabel: "Finans",
      detail: financeLoading ? permissionLoadingDetail : canViewFinance ? "İzinli finans görünümü" : "Finans görünürlüğü kapalı",
      href: guardianPortalHref("/veli/odemeler", isRolePreview),
      key: "finance",
      label: "Ödeme durumunu gör",
      pending: hasPendingPayment,
      statusLabel: financeLoading ? "Yükleniyor" : canViewFinance ? "İzinli" : "Kapalı",
      tone: canViewFinance && (data?.paymentPlans.length ?? 0) > 0 ? "warning" : "neutral",
      value: financeLoading ? panelLoadingValue : canViewFinance ? financeStatus : "Ödeme izni kapalı",
    },
    {
      actionLabel: supportLoading && !isRolePreview ? "Bekle" : supportReadOnly ? (isRolePreview ? "Yalnızca görüntüleme" : "Kapalı") : openSupportTickets > 0 ? "Takip et" : "Talep aç",
      contextLabel: "Destek",
      detail: supportLoading && !isRolePreview
        ? permissionLoadingDetail
        : supportReadOnly ? (isRolePreview ? "Destek talebi açma kapalı" : "Destek talebi izni kapalı") : "Veli destek kapsamı",
      href: guardianPortalHref("/veli/destek", isRolePreview),
      key: "support",
      label: "Destek talebini takip et",
      pending: !supportLoading && canOpenSupportTickets && openSupportTickets > 0,
      statusLabel: supportLoading && !isRolePreview ? "Yükleniyor" : supportReadOnly ? (isRolePreview ? "Yalnızca görüntüleme" : "Kapalı") : openSupportTickets > 0 ? "Açık" : "Hazır",
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
      pending: false,
      statusLabel: "Başarı %",
      tone: (reportSuccess ?? 0) >= 75 ? "success" : "info",
      value: reportQuery.isLoading ? panelLoadingValue : formatPercentNumber(reportSuccess),
    },
    {
      actionLabel: isRolePreview ? "Yalnızca görüntüleme" : "Canlı",
      contextLabel: "Erişim",
      detail: isRolePreview ? "Yazma işlemleri kapalı" : "İzinli veli işlemleri açık",
      href: guardianPortalHref(isRolePreview ? "/veli" : "/veli/bildirimler", isRolePreview),
      key: "preview",
      label: "Önizleme durumu",
      pending: false,
      statusLabel: isRolePreview ? "Yalnızca görüntüleme" : "Canlı",
      tone: isRolePreview ? "neutral" : "info",
      value: isRolePreview ? "Yalnızca görüntüleme" : "Canlı hesap",
    },
  ];
  return (
    <PortalFrame
      dashboard={view === "overview" ? "guardian" : undefined}
      title="Veli Portalı"
      subtitle={portalSubtitle}
      context={guardianPortalContext(view, portalSubtitle, selectedStudentLabel, canViewFinance, financeLoading, isRolePreview)}
    >
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
            primaryAction={{ href: guardianPortalHref("/veli/odevler", isRolePreview), label: "Ödevleri incele" }}
            summary="Seçili öğrencinin ödevleri, okuldan haberler ve destek takibi."
            scope={{
              detail: financeLoading ? permissionLoadingDetail : canViewFinance ? "Finans görünürlüğü açık" : "Finans görünürlüğü kapalı",
              label: "Bağlı öğrenci",
              value: selectedStudentLabel,
            }}
            items={[
              {
                label: "Duyuru",
                value: announcementsQuery.isLoading ? panelLoadingValue : unreadAnnouncements > 0 ? `${unreadAnnouncements} okunmamış` : "Güncel",
                detail: unreadAnnouncements > 0 ? "Veli duyurusu bekliyor" : "Okunmamış duyuru yok",
                tone: unreadAnnouncements > 0 ? "warning" : "success",
              },
              {
                label: "Ödev",
                value: homeworkLoading ? panelLoadingValue : homeworkStatus,
                detail: homeworkDetail,
                tone: homeworkPartial ? "warning" : openHomeworkCount > 0 ? "info" : "neutral",
              },
              {
                label: "Destek",
                value: supportStatus,
                detail: supportLoading ? permissionLoadingDetail : canOpenSupportTickets ? "Veli destek kapsamı" : "Destek talebi izni kapalı",
                tone: canOpenSupportTickets && openSupportTickets > 0 ? "warning" : "success",
              },
            ]}
          />
          <PortalActionStrip
            ariaLabel="Veli günlük aksiyonları"
            items={guardianActionItems}
            priorityKeys={isRolePreview
              ? ["preview", "support", "student"]
              : ["student", "finance", "report"]}
          />
        </>
      ) : null}
      {isRolePreview ? (
        <div id="portal-preview">
          <RolePreviewNotice />
        </div>
      ) : null}
      {view === "student" ? <div id="portal-focus">
        <StudentFocusPanel
          announcementStatus={announcementStatus}
          attendanceStatus={attendanceStatus}
          financeStatus={financeStatus}
          homeworkStatus={homeworkStatus}
          mode={isRolePreview ? "read-only" : "guardian"}
          net={formatNetNumber(reportTotal?.net)}
          profile={data?.profile}
          questionCount={formatNetNumber(reportQuestionCount(reportTotal))}
          scopeLabel="Veli görünümü"
          successRate={formatPercentNumber(reportSuccess)}
          supportStatus={supportStatus}
        />
      </div> : null}
      <PortalWorkspace
        ariaLabel="Veli portal çalışma alanı"
        collapseDetails={view === "overview"}
        main={
          <>
            {view === "overview" || view === "homework" ? <div id="portal-homework">
              {/* İki kaynak da düşerse tek hata paneli; biri düşerse tablo diğerini gösterir ve eksik kaynağı yazar. */}
              <PortalPanelGate
                label="Ödevler"
                queries={homeworkGateQueries}
                subject="Ödevler"
                title="Ödevler"
              >
                <GuardianHomeworkPanel
                  classHomework={classHomework}
                  classHomeworkFailed={classHomeworkQuery.isError}
                  courseNames={courseNameById}
                  limit={view === "overview" ? 3 : undefined}
                  materialAssignments={homeworkAssignments}
                  materialAssignmentsFailed={homeworkQuery.isError}
                  moreHref={view === "overview" ? guardianPortalHref("/veli/odevler", isRolePreview) : undefined}
                  onRetry={() => retryFailedPanels(classHomeworkQuery, homeworkQuery)}
                  termNames={termNameById}
                />
              </PortalPanelGate>
            </div> : null}
            {view === "overview" || view === "announcements" ? <div id="portal-announcements">
              <PortalPanelGate label="Duyurular" queries={[announcementsQuery]} subject="Duyurular" title="Duyurular">
                <AnnouncementsPanel
                  announcements={data?.announcements ?? []}
                  limit={view === "overview" ? 3 : undefined}
                  moreHref={view === "overview" ? guardianPortalHref("/veli/duyurular", isRolePreview) : undefined}
                  readOnly={isRolePreview}
                  onMarkRead={(announcement) =>
                    auth && resolvedStudentId && !isRolePreview
                      ? markAnnouncementRead(
                          auth.accessToken,
                          `me/guardian/students/${encodeURIComponent(resolvedStudentId)}/announcements/${encodeURIComponent(announcement.id)}/read`,
                        ).then(() => announcementsQuery.refetch())
                      : undefined
                  }
                />
              </PortalPanelGate>
            </div> : null}
            {view === "overview" ? <div id="portal-progress-series">
              {overviewQuery.isLoading ? <PanelLoading label="Deneme ve okul notu serileri" title="Deneme ve Okul Notları" /> : <ProgressSeriesPanel
                examSeries={data?.overview?.examSeries ?? []}
                onRetry={overviewQuery.isError ? () => void overviewQuery.refetch() : undefined}
                schoolGrades={data?.overview?.schoolGrades ?? []}
                unavailable={!data?.overview}
              />}
            </div> : null}
            {view === "overview" || view === "payments" ? <div id="portal-payments">
              <PortalPanelGate label="Ödeme planları" queries={[preferencesQuery, paymentPlansQuery]} subject="Ödeme planları" title="Ödeme Planları">
                <PaymentPlansPanel canViewFinance={canViewFinance} plans={data?.paymentPlans ?? []} />
              </PortalPanelGate>
            </div> : null}
            {view === "overview" || view === "support" ? <div id="portal-support">
              {/* Talep açma izni okunmadan form açılmaz: izin yüklenirken panel yükleniyor, okunamazsa "Tekrar dene"li hata gösterir. */}
              <PortalPanelGate label="Destek talepleri" queries={[preferencesQuery, supportTicketsQuery]} subject="Destek talepleri" title="Destek Talepleri">
                <SupportTicketsPanel
                  readOnly={supportReadOnly}
                  readOnlyMessage={isRolePreview ? undefined : supportPermissionLoading ? "Destek talebi izni kontrol ediliyor…" : "Veli destek talebi izni kapalı."}
                  tickets={data?.supportTickets ?? []}
                  onCreate={(input) =>
                    auth && resolvedStudentId && !isRolePreview && canOpenSupportTickets
                      ? createPortalSupportTicket(
                          auth.accessToken,
                          `me/guardian/students/${encodeURIComponent(resolvedStudentId)}/support-tickets`,
                          input,
                        ).then(() => supportTicketsQuery.refetch())
                      : undefined
                  }
                />
              </PortalPanelGate>
            </div> : null}
            {view === "overview" || view === "reports" ? <div id="portal-report">
              <PortalPanelGate label="Portal rapor özeti" queries={[reportQuery]} subject="Sınav raporu" title="Sınav Raporu">
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
              </PortalPanelGate>
            </div> : null}
          </>
        }
        side={
          <>
            {/* UAT F-29: shown only when web push is enabled and this browser has not granted the permission yet. */}
            {auth && !isRolePreview && (view === "overview" || view === "notifications") ? <PushPermissionPrompt accessToken={auth.accessToken} /> : null}
            {view === "overview" || view === "student" ? (
              <PortalPanelGate label="Profil" queries={[profileQuery]} subject="Profil bilgileri" title="Profil">
                <ProfilePanel profile={data?.profile} />
              </PortalPanelGate>
            ) : null}
            {view === "overview" || view === "student" ? (
              <PortalPanelGate label="Sınıf ve kayıt geçmişi" queries={[enrollmentsQuery]} subject="Kayıt geçmişi" title="Sınıf ve Kayıt Geçmişi">
                <StudentHistoryPanel
                  enrollments={data?.enrollments ?? []}
                  termNames={termNameById}
                />
              </PortalPanelGate>
            ) : null}
            {view === "overview" || view === "student" || view === "notifications" ? (
              <PortalPanelGate label="Veli ilişki özeti" queries={[preferencesQuery]} subject="Veli ilişki bilgileri" title="Veli İlişki Özeti">
                <GuardianRelationshipSummaryPanel relationship={data?.notificationPreferences} />
              </PortalPanelGate>
            ) : null}
            {view === "overview" || view === "notifications" ? (
              <PortalPanelGate label="Bildirim tercihleri" queries={[preferencesQuery]} subject="Bildirim tercihleri" title="Bildirim Tercihleri">
                <NotificationPreferencesPanel
                  preferences={data?.notificationPreferences}
                  readOnly={isRolePreview}
                  onUpdate={(input) =>
                    auth && resolvedStudentId && !isRolePreview
                      ? updateGuardianNotificationPreferences(
                          auth.accessToken,
                          resolvedStudentId,
                          input,
                        ).then(() => preferencesQuery.refetch())
                      : undefined
                  }
                />
              </PortalPanelGate>
            ) : null}
            {view === "overview" || view === "student" ? (
              <PortalPanelGate label="Gelişim trendi" queries={[developmentQuery]} subject="Gelişim değerlendirmeleri" title="Gelişim ve Mentorluk">
                <DevelopmentTrendPanel assessments={data?.developmentAssessments ?? []} />
              </PortalPanelGate>
            ) : null}
            {view === "overview" || view === "student" ? (
              <PortalPanelGate label="Öğretmen notları" queries={[teacherNotesQuery]} subject="Öğretmen notları" title="Öğretmen Notları">
                <TeacherNotesPanel notes={data?.teacherNotes ?? []} courseNames={courseNameById} termNames={termNameById} />
              </PortalPanelGate>
            ) : null}
            {view === "overview" || view === "student" ? (
              <PortalPanelGate label="Devamsızlık" queries={[attendanceQuery]} subject="Devamsızlık kayıtları" title="Devamsızlık">
                <AttendancePanel records={data?.attendance ?? []} summary={data?.attendanceSummary} />
                {/* Aylık takvim öğrenci görünümündedir; genel bakış listeyle kalır. Veri aynı yoklama isteğinden gelir. */}
                {view === "student" ? <PortalAttendanceCalendar records={data?.attendance ?? []} /> : null}
              </PortalPanelGate>
            ) : null}
          </>
        }
      />
    </PortalFrame>
  );
}

const panelLoadingValue = "Yükleniyor…";
const permissionLoadingDetail = "İzin kontrol ediliyor";

function guardianPortalPanels(view: GuardianPortalView) {
  const overview = view === "overview";
  const student = overview || view === "student";
  const reports = overview || view === "reports";
  const homework = overview || view === "homework";
  return {
    announcements: overview || view === "announcements",
    homework,
    lookups: student || reports || homework,
    // Finans ve destek izinleri ilişki tercihlerinden okunur; bu görünümler izni okumadan finans/destek açmaz.
    notifications: overview || student || view === "notifications" || view === "payments" || view === "support",
    overview,
    payments: overview || view === "payments",
    reports,
    student,
    support: overview || view === "support",
  };
}

async function loadGuardianReport(accessToken: string, studentId: string, rolePreviewToken: string, requestedReportExamId: string) {
  const studentPath = `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}`;
  const reportIndex = await apiRequestOrNull<PortalReportIndexItem[]>(accessToken, `${studentPath}/reports`, rolePreviewToken) ?? [];
  const selectedReportExamId = reportIndex.some((record) => record.examId === requestedReportExamId)
    ? requestedReportExamId
    : reportIndex[0]?.examId ?? "";
  if (!selectedReportExamId) return { errorBooklet: null, progress: null, report: null, reportIndex, selectedReportExamId };
  const examPath = `${studentPath}/reports/${encodeURIComponent(selectedReportExamId)}`;
  const [report, errorBooklet, progress] = await Promise.all([
    apiRequestOrNull<ReportStudentSnapshot>(accessToken, `${examPath}/latest`, rolePreviewToken),
    apiRequestOrNull<ReportErrorBooklet>(accessToken, `${examPath}/latest/error-booklet`, rolePreviewToken),
    apiRequestOrNull<ReportStudentProgress>(accessToken, `${examPath}/progress?scope=all`, rolePreviewToken),
  ]);
  return { errorBooklet, progress, report, reportIndex, selectedReportExamId };
}

async function loadGuardianOverview(accessToken: string, studentId: string, rolePreviewToken = ""): Promise<GuardianStudentOverview | null> {
  const overview = await readOnlyRequest<GuardianStudentOverview>(
    accessToken,
    `${apiBaseUrl}/me/guardian/students/${encodeURIComponent(studentId)}/overview`,
    rolePreviewToken,
  );
  // Beklenmeyen şekil seri panelinde "alınamadı" notuna döner; portalın geri kalanı çalışır.
  return overview && Array.isArray(overview.examSeries) && Array.isArray(overview.schoolGrades) ? overview : null;
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
  input: Partial<Pick<GuardianStudentRecord, "canReceiveSms" | "canReceiveAnnouncements" | "canOpenSupportTickets" | "canReceiveAutoNotifications">>,
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
        .filter((installment) => installment.status === "PENDING")
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
    payments: "Ödeme planları",
    reports: "Sınav raporu",
    student: "Bağlı öğrenci",
    support: "Destek talepleri",
  };

  return subtitleByView[view];
}

function guardianPortalContext(
  view: GuardianPortalView,
  label: string,
  selectedStudentLabel: string,
  canViewFinance: boolean,
  financeLoading: boolean,
  isRolePreview: boolean,
) {
  const detailByView: Record<GuardianPortalView, string> = {
    announcements: "Veli duyuruları ve okuma durumu",
    homework: `${selectedStudentLabel} için ödev ve materyal takibi`,
    notifications: "Bildirim, finans ve destek izinleri",
    overview: `${selectedStudentLabel} için günlük veli özeti`,
    payments: financeLoading ? permissionLoadingDetail : canViewFinance ? "İzinli taksit ve alacak takibi" : "Finans görünürlüğü kapalı",
    reports: `${selectedStudentLabel} için başarı %, net ve soru bağlamı`,
    student: `${selectedStudentLabel} için öğrenci profili ve kayıt geçmişi`,
    support: "Veli destek talepleri ve yanıt durumu",
  };

  return {
    detail: detailByView[view],
    label,
    meta: isRolePreview ? "Yalnızca görüntüleme" : "Canlı veli hesabı",
  };
}
