"use client";

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
  StudentHomeworkRecord,
  StudentProfileRecord,
  StudentSelfOverview,
  SupportTicketRecord,
  TeacherNoteRecord,
} from "@o-okul/shared-types";
import { apiBaseUrl, apiRequest, authenticatedFetch, readData } from "../../../src/api-client.js";
import type { SupportTicketFormPayload } from "../../../src/form-validation.js";
import { useAuth } from "../../providers.js";
import { AttendancePanel, TeacherNotesPanel } from "./_shared/activity-panels.js";
import { AnnouncementsPanel } from "./_shared/announcements-panel.js";
import { PortalAttendanceCalendar } from "./_shared/attendance-calendar.js";
import { DevelopmentTrendPanel, type DevelopmentTrendItem } from "./_shared/development-panel.js";
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
import { StudentHomeworkFeed, buildStudentHomeworkFeed, isOpenStudentHomeworkFeedItem, studentHomeworkFeedGroup } from "./_shared/student-homework-feed.js";
import { GuardianRelationsPanel, ProfilePanel, StudentFocusPanel, StudentHistoryPanel } from "./_shared/student-panels.js";
import { SupportTicketsPanel } from "./_shared/support-tickets-panel.js";
import { formatAttendanceSummary } from "../_shared/attendance-summary.js";
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
  const accessToken = auth?.accessToken ?? "";
  const panels = studentPortalPanels(view);
  const panelKey = (panel: string, ...rest: string[]) =>
    ["next-student-portal", auth?.session.userId ?? "anonymous", rolePreviewToken || "session", panel, ...rest];
  const get = <T,>(path: string) => () => readOnlyRequest<T>(accessToken, `${apiBaseUrl}${path}`, rolePreviewToken);
  // Her panel kendi sorgusudur; biri düşerse yalnız o panel hata ve "Tekrar dene" gösterir.
  const profileQuery = usePortalPanelQuery(panelKey("profile"), canReadPortal, get<StudentProfileRecord>("/me/student/profile"));
  const guardiansQuery = usePortalPanelQuery(panelKey("guardians"), canReadPortal && panels.profile, async () => {
    const [guardians, links] = await Promise.all([
      get<GuardianRecord[]>("/me/student/guardians")(),
      get<GuardianStudentRecord[]>("/me/student/guardian-links")(),
    ]);
    return { guardians, links };
  });
  const enrollmentsQuery = usePortalPanelQuery(panelKey("enrollments"), canReadPortal && panels.profile, get<StudentEnrollmentRecord[]>("/me/student/enrollments"));
  const announcementsQuery = usePortalPanelQuery(panelKey("announcements"), canReadPortal && panels.announcements, get<AnnouncementRecord[]>("/me/student/announcements"));
  const homeworkAssignmentsQuery = usePortalPanelQuery(
    panelKey("homework-assignments"),
    canReadPortal && panels.homework,
    get<HomeworkMaterialAssignmentRecord[]>("/me/student/homework/material-assignments"),
  );
  const classHomeworkQuery = usePortalPanelQuery(panelKey("class-homework"), canReadPortal && panels.homework, get<StudentHomeworkRecord[]>("/me/student/homework"));
  const supportTicketsQuery = usePortalPanelQuery(panelKey("support-tickets"), canReadPortal && panels.support, get<SupportTicketRecord[]>("/me/student/support-tickets"));
  const attendanceQuery = usePortalPanelQuery(panelKey("attendance"), canReadPortal && panels.attendance, async () => {
    const [records, summary] = await Promise.all([
      get<AttendanceRecord[]>("/me/student/attendance")(),
      get<AttendanceSummaryRecord>("/me/student/attendance/summary")(),
    ]);
    return { records, summary };
  });
  const teacherNotesQuery = usePortalPanelQuery(panelKey("teacher-notes"), canReadPortal && (panels.profile || panels.attendance), get<TeacherNoteRecord[]>("/me/student/teacher-notes"));
  const developmentQuery = usePortalPanelQuery(panelKey("development"), canReadPortal && panels.profile, get<DevelopmentTrendItem[]>("/me/student/development-assessments"));
  const overviewQuery = usePortalPanelQuery(panelKey("overview"), canReadPortal && panels.overview, get<StudentSelfOverview>("/me/student/overview"));
  const reportQuery = usePortalPanelQuery(
    panelKey("report", reportExamId),
    canReadPortal && panels.reports,
    () => loadStudentReport(accessToken, rolePreviewToken, reportExamId),
  );
  // Ders ve dönem adları yalnız etiket içindir; alınamazsa paneller "bilgi yok" yazar, hata paneli açılmaz.
  const lookupsQuery = usePortalPanelQuery(panelKey("lookups"), canReadPortal && panels.lookups, async () => {
    const [courses, terms] = await Promise.all([
      get<CourseRecord[]>("/courses")().catch(() => [] as CourseRecord[]),
      get<AcademicTermRecord[]>("/academic-terms")().catch(() => [] as AcademicTermRecord[]),
    ]);
    return { courses, terms };
  });
  const panelQueries = [
    profileQuery,
    guardiansQuery,
    enrollmentsQuery,
    announcementsQuery,
    homeworkAssignmentsQuery,
    classHomeworkQuery,
    supportTicketsQuery,
    attendanceQuery,
    teacherNotesQuery,
    developmentQuery,
    overviewQuery,
    reportQuery,
  ];

  if (!canReadPortal) {
    return <AccessPanel title="Öğrenci Portalı" />;
  }

  if (allPanelsFailed(panelQueries)) {
    return (
      <PortalFrame title="Öğrenci Portalı" subtitle="Öğrenci özeti">
        <PortalStatePanel
          state="error"
          title="Öğrenci portal verisi alınamadı"
          description="Bilgilerin şu anda gösterilemiyor. Bağlantını kontrol edip tekrar dene."
          onRetry={() => retryFailedPanels(...panelQueries)}
        />
      </PortalFrame>
    );
  }

  const data = {
    announcements: announcementsQuery.data ?? emptyList<AnnouncementRecord>(),
    attendance: attendanceQuery.data?.records ?? emptyList<AttendanceRecord>(),
    attendanceSummary: attendanceQuery.data?.summary ?? null,
    classHomework: classHomeworkQuery.data ?? emptyList<StudentHomeworkRecord>(),
    courses: lookupsQuery.data?.courses ?? emptyList<CourseRecord>(),
    developmentAssessments: developmentQuery.data ?? emptyList<DevelopmentTrendItem>(),
    enrollments: enrollmentsQuery.data ?? emptyList<StudentEnrollmentRecord>(),
    errorBooklet: reportQuery.data?.errorBooklet ?? null,
    guardianLinks: guardiansQuery.data?.links ?? emptyList<GuardianStudentRecord>(),
    guardians: guardiansQuery.data?.guardians ?? emptyList<GuardianRecord>(),
    homeworkAssignments: homeworkAssignmentsQuery.data ?? emptyList<HomeworkMaterialAssignmentRecord>(),
    overview: overviewQuery.data ?? null,
    profile: profileQuery.data ?? null,
    progress: reportQuery.data?.progress ?? null,
    report: reportQuery.data?.report ?? null,
    reportIndex: reportQuery.data?.reportIndex ?? emptyList<PortalReportIndexItem>(),
    selectedReportExamId: reportQuery.data?.selectedReportExamId ?? "",
    supportTickets: supportTicketsQuery.data ?? emptyList<SupportTicketRecord>(),
    teacherNotes: teacherNotesQuery.data ?? emptyList<TeacherNoteRecord>(),
    terms: lookupsQuery.data?.terms ?? emptyList<AcademicTermRecord>(),
  };
  const courseNameById = new Map(data.courses.map((course) => [course.id, course.name]));
  const termNameById = new Map(data.terms.map((term) => [term.id, term.name]));
  const reportTotal = data.report?.total;
  const reportSuccess = reportSuccessRate(reportTotal);
  const unreadAnnouncements = data.announcements.filter((announcement) => !announcement.readAt).length;
  const openSupportTickets = data.supportTickets.filter(isOpenSupportTicket).length;
  const announcementStatus = unreadAnnouncements > 0 ? `${unreadAnnouncements} okunmamış` : "Güncel";
  // Açık iş = teslim edilmemiş sınıf ödevi + materyal ataması; "Bugün teslim" iki kaynağı birlikte sayar.
  const now = new Date();
  const openHomework = buildStudentHomeworkFeed({
    classHomework: data.classHomework,
    courseNames: courseNameById,
    materialAssignments: data.homeworkAssignments,
    termNames: termNameById,
  }).filter(isOpenStudentHomeworkFeedItem);
  const openHomeworkCount = openHomework.length;
  const homeworkStatus = `${openHomeworkCount} atama`;
  const attendanceStatus = formatAttendanceSummary(data.attendanceSummary);
  const supportStatus = openSupportTickets > 0 ? `${openSupportTickets} açık` : "Açık talep yok";
  const portalSubtitle = studentPortalSubtitle(view, "Öğrenci özeti");
  // Berrak §5: günlük özet "bugün teslimi olan ödevler → son sınav Başarı % (öncekiyle) → duyurular".
  const dueTodayCount = openHomework.filter((item) => studentHomeworkFeedGroup(item, now) === "today").length;
  // Özet ve aksiyon şeridi alt paneller yüklenirken de görünür; verisi gelmeyen kutu "Yükleniyor…" yazar.
  const homeworkLoading = homeworkAssignmentsQuery.isLoading || classHomeworkQuery.isLoading;
  // A failed homework source makes the count a lower bound, never a definite "Tamam".
  const homeworkPartial = !homeworkLoading && (homeworkAssignmentsQuery.isError || classHomeworkQuery.isError);
  const reportLoading = reportQuery.isLoading;
  const announcementsLoading = announcementsQuery.isLoading;
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
      pending: unreadAnnouncements > 0,
      statusLabel: unreadAnnouncements > 0 ? "Bekliyor" : "Güncel",
      tone: unreadAnnouncements > 0 ? "warning" : "success",
      value: announcementsLoading ? panelLoadingValue : unreadAnnouncements > 0 ? `${unreadAnnouncements} okunmamış` : "Güncel",
    },
    {
      actionLabel: openHomeworkCount > 0 ? "Tamamla" : homeworkPartial ? "Kontrol" : "Hazır",
      contextLabel: "Ödev",
      detail: homeworkPartial ? "Ödevlerin bir kısmı alınamadı" : "Materyal ve tekrar çalışması",
      href: studentPortalHref("/ogrenci/odevler", isRolePreview),
      key: "homework",
      label: "Ödevi aç",
      pending: openHomeworkCount > 0,
      statusLabel: homeworkPartial ? "Eksik" : openHomeworkCount > 0 ? "Çalışma var" : "Tamam",
      tone: homeworkPartial ? "warning" : openHomeworkCount > 0 ? "info" : "success",
      value: homeworkLoading
        ? panelLoadingValue
        : homeworkPartial ? (openHomeworkCount > 0 ? `en az ${openHomeworkCount} atama` : "Alınamadı") : `${openHomeworkCount} atama`,
    },
    {
      actionLabel: "Kontrol",
      contextLabel: "Devamsızlık",
      detail: `${data.attendanceSummary?.total ?? 0} yoklama kaydı`,
      href: studentPortalHref("/ogrenci/devamsizlik", isRolePreview),
      key: "attendance",
      label: "Devamsızlığı kontrol et",
      pending: false,
      statusLabel: (data.attendanceSummary?.absent ?? 0) > 0 || (data.attendanceSummary?.late ?? 0) > 0 ? "Dikkat" : "Düzenli",
      tone: (data.attendanceSummary?.absent ?? 0) > 0 || (data.attendanceSummary?.late ?? 0) > 0 ? "warning" : "success",
      value: attendanceStatus,
    },
    {
      actionLabel: openSupportTickets > 0 ? "Takip et" : isRolePreview ? "Yalnızca görüntüleme" : "Talep aç",
      contextLabel: "Destek",
      detail: isRolePreview ? "Destek talebi açma kapalı" : "Öğrenci destek takibi",
      href: studentPortalHref("/ogrenci/destek", isRolePreview),
      key: "support",
      label: "Destek talebini takip et",
      pending: openSupportTickets > 0,
      statusLabel: openSupportTickets > 0 ? "Açık" : isRolePreview ? "Yalnızca görüntüleme" : "Hazır",
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
      pending: false,
      statusLabel: "Başarı %",
      tone: (reportSuccess ?? 0) >= 75 ? "success" : "info",
      value: reportLoading ? panelLoadingValue : formatPercentNumber(reportSuccess),
    },
    {
      actionLabel: isRolePreview ? "Yalnızca görüntüleme" : "Canlı",
      contextLabel: "Erişim",
      detail: isRolePreview ? "Yazma işlemleri kapalı" : "Okuma ve destek işlemleri açık",
      href: studentPortalHref(isRolePreview ? "/ogrenci" : "/ogrenci/profil", isRolePreview),
      key: "preview",
      label: "Önizleme durumu",
      pending: false,
      statusLabel: isRolePreview ? "Yalnızca görüntüleme" : "Canlı",
      tone: isRolePreview ? "neutral" : "info",
      value: isRolePreview ? "Yalnızca görüntüleme" : "Canlı hesap",
    },
  ];
  const studentPriorityKeys = isRolePreview
    ? ["preview", "homework", "report"]
    : ["homework", "report", "announcement"];
  const studentPriorityItems = studentPriorityKeys
    .map((key) => studentActionItems.find((item) => item.key === key))
    .filter((item): item is PortalActionItem => Boolean(item));
  return (
    <PortalFrame
      dashboard={view === "overview" ? "student" : undefined}
      title="Öğrenci Portalı"
      subtitle={portalSubtitle}
      context={studentPortalContext(view, portalSubtitle, isRolePreview)}
    >
      {view === "overview" ? (
        <>
          <PortalDailyBrief
            primaryAction={{ href: studentPortalHref("/ogrenci/odevler", isRolePreview), label: "Ödevlerimi aç" }}
            summary="Bugün teslim edilecek ödevler ve sıradaki çalışmanız."
            scope={{
              detail: isRolePreview ? "Yalnızca görüntüleme" : "Öğrenci hesabı",
              label: "Bugünün odağı",
              value: homeworkLoading ? panelLoadingValue : openHomework.find((item) => studentHomeworkFeedGroup(item, now) === "today")?.title ?? openHomework[0]?.title ?? "Bugünün çalışmaları",
            }}
            items={[
              {
                label: "Bugün teslim",
                value: homeworkLoading ? panelLoadingValue : homeworkPartial ? (dueTodayCount > 0 ? `en az ${dueTodayCount} ödev` : "Alınamadı") : `${dueTodayCount} ödev`,
                detail: homeworkPartial ? "Ödevlerin bir kısmı alınamadı" : `${openHomeworkCount} atama içinde`,
                tone: homeworkPartial || dueTodayCount > 0 ? "warning" : "neutral",
              },
            ]}
          />
          <PortalActionStrip
            ariaLabel="Öğrenci günlük aksiyonları"
            items={studentPriorityItems}
          />
        </>
      ) : null}
      {isRolePreview ? (
        <div id="portal-preview">
          <RolePreviewNotice />
        </div>
      ) : null}
      {view === "profile" ? <div id="portal-focus">
        <StudentFocusPanel
          announcementStatus={announcementStatus}
          attendanceStatus={attendanceStatus}
          homeworkStatus={homeworkStatus}
          mode={isRolePreview ? "read-only" : "student"}
          net={formatNumber(reportTotal?.net)}
          profile={data.profile ?? undefined}
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
            {view === "overview" || view === "homework" ? <div id="portal-homework">
              {homeworkLoading ? <PanelLoading label="Ödevlerim" title="Ödevlerim" /> : <StudentHomeworkFeed
                classHomework={data.classHomework}
                classHomeworkFailed={classHomeworkQuery.isError}
                courseNames={courseNameById}
                limit={view === "overview" ? 3 : undefined}
                materialAssignments={data.homeworkAssignments}
                materialAssignmentsFailed={homeworkAssignmentsQuery.isError}
                moreHref={view === "overview" ? studentPortalHref("/ogrenci/odevler", isRolePreview) : undefined}
                onRetry={() => retryFailedPanels(classHomeworkQuery, homeworkAssignmentsQuery)}
                onSubmit={
                  view === "homework" && auth && !isRolePreview
                    ? (homeworkId) => submitHomework(auth.accessToken, homeworkId).then(() => classHomeworkQuery.refetch())
                    : undefined
                }
                readOnly={isRolePreview}
                showDone={view === "homework"}
                termNames={termNameById}
              />}
            </div> : null}
            {view === "overview" || view === "announcements" ? <div id="portal-announcements">
              <PortalPanelGate label="Duyurular" queries={[announcementsQuery]} subject="Duyurular" title="Duyurular">
                <AnnouncementsPanel
                  announcements={data.announcements}
                  limit={view === "overview" ? 3 : undefined}
                  moreHref={view === "overview" ? studentPortalHref("/ogrenci/duyurular", isRolePreview) : undefined}
                  readOnly={isRolePreview}
                  onMarkRead={(announcement) =>
                    auth && !isRolePreview ? markAnnouncementRead(auth.accessToken, `me/student/announcements/${encodeURIComponent(announcement.id)}/read`).then(() => announcementsQuery.refetch()) : undefined
                  }
                />
              </PortalPanelGate>
            </div> : null}
            {view === "overview" ? <div id="portal-progress-series">
              {overviewQuery.isLoading ? <PanelLoading label="Gelişimim" title="Gelişimim" /> : <ProgressSeriesPanel
                ariaLabel="Gelişimim"
                description="Deneme sınavlarındaki Başarı % ve yayınlanmış okul notların. Ölçekler farklı olduğu için iki seri ayrı tutulur."
                examSeries={readArray(data.overview?.examSeries)}
                onRetry={() => void overviewQuery.refetch()}
                schoolGrades={readArray(data.overview?.schoolGrades)}
                title="Gelişimim"
                unavailable={overviewQuery.isError}
              />}
            </div> : null}
            {view === "overview" || view === "reports" ? <div id="portal-report">
              <PortalPanelGate label="Portal rapor özeti" queries={[reportQuery]} subject="Sınav raporu" title="Sınav Raporu">
                {view === "reports" && data.reportIndex.length > 0 ? (
                  <Field label="Sınav raporu">
                    <Select value={data.selectedReportExamId} onChange={(event) => selectReportExam(event.target.value)}>
                      {data.reportIndex.map((exam) => <option key={exam.examId} value={exam.examId}>{exam.title}</option>)}
                    </Select>
                  </Field>
                ) : null}
                <ReportPanel
                  context={data.report ?? undefined}
                  courseNames={courseNameById}
                  errorBooklet={data.errorBooklet}
                  progress={data.progress}
                  report={data.report}
                  termNames={termNameById}
                />
              </PortalPanelGate>
            </div> : null}
            {view === "support" ? <div id="portal-support">
              <PortalPanelGate label="Destek talepleri" queries={[supportTicketsQuery]} subject="Destek talepleri" title="Destek Talepleri">
                <SupportTicketsPanel
                  accessToken={auth?.accessToken}
                  commentsPath="me/student/support-tickets"
                  readOnly={isRolePreview}
                  tickets={data.supportTickets}
                  onTicketChange={() => supportTicketsQuery.refetch()}
                  onCreate={(input) =>
                    auth && !isRolePreview ? createPortalSupportTicket(auth.accessToken, "me/student/support-tickets", input).then(() => supportTicketsQuery.refetch()) : undefined
                  }
                />
              </PortalPanelGate>
            </div> : null}
            {/* Devamsızlık ve Profil görünümleri ana sütunu kullanır; yan sütun yalnız bağlam panellerini taşır. */}
            {view === "attendance" ? <div id="portal-attendance">
              <PortalPanelGate label="Devamsızlık" queries={[attendanceQuery]} subject="Devamsızlık kayıtları" title="Devamsızlık">
                <AttendancePanel records={data.attendance} summary={data.attendanceSummary ?? undefined} />
                <PortalAttendanceCalendar records={data.attendance} />
              </PortalPanelGate>
            </div> : null}
            {view === "profile" ? (
              <PortalPanelGate label="Profil" queries={[profileQuery]} subject="Profil bilgileri" title="Profil">
                <ProfilePanel profile={data.profile ?? undefined} />
              </PortalPanelGate>
            ) : null}
            {view === "profile" ? (
              <PortalPanelGate label="Sınıf ve kayıt geçmişi" queries={[enrollmentsQuery]} subject="Kayıt geçmişi" title="Sınıf ve Kayıt Geçmişi">
                <StudentHistoryPanel
                  enrollments={data.enrollments}
                  termNames={termNameById}
                />
              </PortalPanelGate>
            ) : null}
            {view === "profile" ? (
              <PortalPanelGate label="Gelişim trendi" queries={[developmentQuery]} subject="Gelişim değerlendirmeleri" title="Gelişim ve Mentorluk">
                <DevelopmentTrendPanel assessments={data.developmentAssessments} />
              </PortalPanelGate>
            ) : null}
          </>
        }
        side={
          <>
            {view === "attendance" ? (
              <PortalPanelGate label="Profil" queries={[profileQuery]} subject="Profil bilgileri" title="Profil">
                <ProfilePanel profile={data.profile ?? undefined} />
              </PortalPanelGate>
            ) : null}
            {view === "profile" ? (
              <PortalPanelGate label="Veli ilişkileri" queries={[guardiansQuery]} subject="Veli ilişkileri" title="Veliler">
                <GuardianRelationsPanel guardians={data.guardians} links={data.guardianLinks} />
              </PortalPanelGate>
            ) : null}
            {view === "profile" || view === "attendance" ? (
              <PortalPanelGate label="Öğretmen notları" queries={[teacherNotesQuery]} subject="Öğretmen notları" title="Öğretmen Notları">
                <TeacherNotesPanel notes={data.teacherNotes} courseNames={courseNameById} termNames={termNameById} />
              </PortalPanelGate>
            ) : null}
          </>
        }
      />
    </PortalFrame>
  );
}

const panelLoadingValue = "Yükleniyor…";

function studentPortalPanels(view: StudentPortalView) {
  const overview = view === "overview";
  // Günlük özet yalnız ödev, rapor ve duyuru okur. Profil sayfasındaki seçili öğrenci özeti tüm durumları
  // (Başarı %, duyuru, ödev, devamsızlık, destek) gösterdiği için o görünüm hepsini yükler.
  const profile = view === "profile";
  const reports = overview || profile || view === "reports";
  const homework = overview || profile || view === "homework";
  const announcements = overview || profile || view === "announcements";
  const support = profile || view === "support";
  const attendance = profile || view === "attendance";
  return {
    announcements,
    attendance,
    homework,
    lookups: profile || reports || homework || attendance,
    overview,
    profile,
    reports,
    support,
  };
}

async function loadStudentReport(accessToken: string, rolePreviewToken: string, requestedReportExamId: string) {
  const reportIndex = await apiRequestOrNull<PortalReportIndexItem[]>(accessToken, `${apiBaseUrl}/me/student/reports`, rolePreviewToken) ?? [];
  const selectedReportExamId = reportIndex.some((record) => record.examId === requestedReportExamId)
    ? requestedReportExamId
    : reportIndex[0]?.examId ?? "";
  if (!selectedReportExamId) return { errorBooklet: null, progress: null, report: null, reportIndex, selectedReportExamId };
  const examPath = `${apiBaseUrl}/me/student/reports/${encodeURIComponent(selectedReportExamId)}`;
  const [report, errorBooklet, progress] = await Promise.all([
    apiRequestOrNull<ReportStudentSnapshot>(accessToken, `${examPath}/latest`, rolePreviewToken),
    apiRequestOrNull<ReportErrorBooklet>(accessToken, `${examPath}/latest/error-booklet`, rolePreviewToken),
    apiRequestOrNull<ReportStudentProgress>(accessToken, `${examPath}/progress?scope=all`, rolePreviewToken),
  ]);
  return { errorBooklet, progress, report, reportIndex, selectedReportExamId };
}

function readArray<T>(value: T[] | undefined): T[] {
  return Array.isArray(value) ? value : [];
}

async function submitHomework(accessToken: string, homeworkId: string) {
  return apiRequest(accessToken, `${apiBaseUrl}/me/student/homework/${encodeURIComponent(homeworkId)}/submission`, { method: "POST" });
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
    overview: "Bugün teslim, son sınav ve duyurular",
    profile: "Profil, veli ilişkileri ve kayıt geçmişi",
    reports: "Son sınavda başarı %, net ve soru bağlamı",
    support: "Destek talepleri ve yanıt durumu",
  };

  return {
    detail: detailByView[view],
    label,
    meta: isRolePreview ? "Yalnızca görüntüleme" : "Öğrenci hesabı",
  };
}

