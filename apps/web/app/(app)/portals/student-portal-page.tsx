"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Field, Panel, Select } from "@o-okul/ui";
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
import { ProgressSeriesPanel } from "./_shared/progress-series-panel.js";
import { ReportPanel } from "./_shared/report-panel.js";
import { StudentHomeworkFeed, buildStudentHomeworkFeed, isOpenStudentHomeworkFeedItem, studentHomeworkFeedGroup } from "./_shared/student-homework-feed.js";
import { GuardianRelationsPanel, ProfilePanel, StudentFocusPanel, StudentHistoryPanel } from "./_shared/student-panels.js";
import { SupportTicketsPanel } from "./_shared/support-tickets-panel.js";
import { formatAttendanceSummary } from "../_shared/attendance-summary.js";
import { readReportExamId } from "../_shared/report-exam-selection.js";
import { formatPercentNumber, formatStudentProgressSummary, reportQuestionCount, reportSuccessRate } from "../_shared/report-metrics.js";

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
          description="Devamsızlık, ödev, duyuru ve son sınav bilgilerin yükleniyor."
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
          description="Bilgilerin şu anda gösterilemiyor. Bağlantını kontrol edip tekrar dene."
          onRetry={() => void query.refetch()}
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
  // Açık iş = teslim edilmemiş sınıf ödevi + materyal ataması; "Bugün teslim" iki kaynağı birlikte sayar.
  const now = new Date();
  const openHomework = buildStudentHomeworkFeed({
    classHomework: data?.classHomework ?? [],
    courseNames: courseNameById,
    materialAssignments: data?.homeworkAssignments ?? [],
    termNames: termNameById,
  }).filter(isOpenStudentHomeworkFeedItem);
  const openHomeworkCount = openHomework.length;
  const homeworkStatus = `${openHomeworkCount} atama`;
  const attendanceStatus = formatAttendanceSummary(data?.attendanceSummary);
  const supportStatus = openSupportTickets > 0 ? `${openSupportTickets} açık` : "Açık talep yok";
  const portalSubtitle = studentPortalSubtitle(view, "Öğrenci özeti");
  // Berrak §5: günlük özet "bugün teslimi olan ödevler → son sınav Başarı % (öncekiyle) → duyurular".
  const dueTodayCount = openHomework.filter((item) => studentHomeworkFeedGroup(item, now) === "today").length;
  const failed = new Set(data?.failed ?? []);
  const retry = () => void query.refetch();
  const progressSummary = formatStudentProgressSummary(data?.progress ?? null);
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
      actionLabel: openHomeworkCount > 0 ? "Tamamla" : "Hazır",
      contextLabel: "Ödev",
      detail: "Materyal ve tekrar çalışması",
      href: studentPortalHref("/ogrenci/odevler", isRolePreview),
      key: "homework",
      label: "Ödevi aç",
      statusLabel: openHomeworkCount > 0 ? "Çalışma var" : "Tamam",
      tone: openHomeworkCount > 0 ? "info" : "success",
      value: `${openHomeworkCount} atama`,
    },
    {
      actionLabel: "Kontrol",
      contextLabel: "Devamsızlık",
      detail: `${data?.attendanceSummary?.total ?? 0} yoklama kaydı`,
      href: studentPortalHref("/ogrenci/devamsizlik", isRolePreview),
      key: "attendance",
      label: "Devamsızlığı kontrol et",
      statusLabel: (data?.attendanceSummary?.absent ?? 0) > 0 || (data?.attendanceSummary?.late ?? 0) > 0 ? "Dikkat" : "Düzenli",
      tone: (data?.attendanceSummary?.absent ?? 0) > 0 || (data?.attendanceSummary?.late ?? 0) > 0 ? "warning" : "success",
      value: attendanceStatus,
    },
    {
      actionLabel: openSupportTickets > 0 ? "Takip et" : isRolePreview ? "Yalnızca görüntüleme" : "Talep aç",
      contextLabel: "Destek",
      detail: isRolePreview ? "Destek talebi açma kapalı" : "Öğrenci destek takibi",
      href: studentPortalHref("/ogrenci/destek", isRolePreview),
      key: "support",
      label: "Destek talebini takip et",
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
      statusLabel: "Başarı %",
      tone: (reportSuccess ?? 0) >= 75 ? "success" : "info",
      value: formatPercentNumber(reportSuccess),
    },
    {
      actionLabel: isRolePreview ? "Yalnızca görüntüleme" : "Canlı",
      contextLabel: "Erişim",
      detail: isRolePreview ? "Yazma işlemleri kapalı" : "Okuma ve destek işlemleri açık",
      href: studentPortalHref(isRolePreview ? "/ogrenci" : "/ogrenci/profil", isRolePreview),
      key: "preview",
      label: "Önizleme durumu",
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
      title="Öğrenci Portalı"
      subtitle={portalSubtitle}
      context={studentPortalContext(view, portalSubtitle, isRolePreview)}
    >
      {view === "overview" ? (
        <>
          <PortalDailyBrief
            summary="Bugün teslim edilecek ödevler, son sınav Başarı % ve okunmamış duyurular tek bakışta."
            scope={{
              detail: isRolePreview ? "Yalnızca görüntüleme" : "Öğrenci hesabı",
              label: "Öğrenci",
              value: "Kişisel görünüm",
            }}
            items={[
              {
                label: "Bugün teslim",
                value: `${dueTodayCount} ödev`,
                detail: `${openHomeworkCount} atama içinde`,
                tone: dueTodayCount > 0 ? "warning" : "neutral",
              },
              {
                label: "Son sınav",
                value: reportSuccess == null ? "Sonuç yok" : formatPercentNumber(reportSuccess),
                detail: `${progressSummary} · ${formatNumber(reportTotal?.net)} net / ${formatNumber(reportQuestionCount(reportTotal))} soru`,
                tone: (reportSuccess ?? 0) >= 75 ? "success" : "info",
              },
              {
                label: "Duyuru",
                value: unreadAnnouncements > 0 ? `${unreadAnnouncements} okunmamış` : "Güncel",
                detail: unreadAnnouncements > 0 ? "Okunmamış okul duyurusu var" : "Okunmamış duyuru yok",
                tone: unreadAnnouncements > 0 ? "warning" : "success",
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
          profile={data?.profile ?? undefined}
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
              <StudentHomeworkFeed
                classHomework={data?.classHomework ?? []}
                classHomeworkFailed={failed.has("classHomework")}
                courseNames={courseNameById}
                limit={view === "overview" ? 3 : undefined}
                materialAssignments={data?.homeworkAssignments ?? []}
                materialAssignmentsFailed={failed.has("homeworkAssignments")}
                moreHref={view === "overview" ? studentPortalHref("/ogrenci/odevler", isRolePreview) : undefined}
                onRetry={retry}
                onSubmit={
                  view === "homework" && auth && !isRolePreview
                    ? (homeworkId) => submitHomework(auth.accessToken, homeworkId).then(() => query.refetch())
                    : undefined
                }
                readOnly={isRolePreview}
                showDone={view === "homework"}
                termNames={termNameById}
              />
            </div> : null}
            {view === "overview" ? <div id="portal-progress-series">
              <ProgressSeriesPanel
                ariaLabel="Gelişimim"
                description="Deneme sınavlarındaki Başarı % ve yayınlanmış okul notların. Ölçekler farklı olduğu için iki seri ayrı tutulur."
                examSeries={readArray(data?.overview?.examSeries)}
                onRetry={retry}
                schoolGrades={readArray(data?.overview?.schoolGrades)}
                title="Gelişimim"
                unavailable={failed.has("overview")}
              />
            </div> : null}
            {view === "overview" || view === "reports" ? <div id="portal-report">
              {failed.has("report") ? (
                <PanelLoadError label="Portal rapor özeti" onRetry={retry} subject="Sınav raporu" title="Sınav Raporu" />
              ) : (
                <>
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
                </>
              )}
            </div> : null}
            {view === "overview" || view === "announcements" ? <div id="portal-announcements">
              {failed.has("announcements") ? (
                <PanelLoadError label="Duyurular" onRetry={retry} subject="Duyurular" title="Duyurular" />
              ) : (
                <AnnouncementsPanel
                  announcements={data?.announcements ?? []}
                  limit={view === "overview" ? 3 : undefined}
                  moreHref={view === "overview" ? studentPortalHref("/ogrenci/duyurular", isRolePreview) : undefined}
                  readOnly={isRolePreview}
                  onMarkRead={(announcement) =>
                    auth && !isRolePreview ? markAnnouncementRead(auth.accessToken, `me/student/announcements/${encodeURIComponent(announcement.id)}/read`).then(() => query.refetch()) : undefined
                  }
                />
              )}
            </div> : null}
            {view === "support" ? <div id="portal-support">
              {failed.has("supportTickets") ? (
                <PanelLoadError label="Destek talepleri" onRetry={retry} subject="Destek talepleri" title="Destek Talepleri" />
              ) : (
                <SupportTicketsPanel
                  accessToken={auth?.accessToken}
                  commentsPath="me/student/support-tickets"
                  readOnly={isRolePreview}
                  tickets={data?.supportTickets ?? []}
                  onTicketChange={() => query.refetch()}
                  onCreate={(input) =>
                    auth && !isRolePreview ? createPortalSupportTicket(auth.accessToken, "me/student/support-tickets", input).then(() => query.refetch()) : undefined
                  }
                />
              )}
            </div> : null}
            {/* Devamsızlık ve Profil görünümleri ana sütunu kullanır; yan sütun yalnız bağlam panellerini taşır. */}
            {view === "attendance" ? <div id="portal-attendance">
              {failed.has("attendance") ? (
                <PanelLoadError label="Devamsızlık" onRetry={retry} subject="Devamsızlık kayıtları" title="Devamsızlık" />
              ) : (
                <AttendancePanel records={data?.attendance ?? []} summary={data?.attendanceSummary} />
              )}
            </div> : null}
            {view === "profile" ? (failed.has("profile") ? (
              <PanelLoadError label="Profil" onRetry={retry} subject="Profil bilgileri" title="Profil" />
            ) : <ProfilePanel profile={data?.profile ?? undefined} />) : null}
            {view === "profile" ? (failed.has("enrollments") ? (
              <PanelLoadError label="Sınıf ve kayıt geçmişi" onRetry={retry} subject="Kayıt geçmişi" title="Sınıf ve Kayıt Geçmişi" />
            ) : <StudentHistoryPanel
              enrollments={data?.enrollments ?? []}
              termNames={termNameById}
            />) : null}
            {view === "profile" ? (failed.has("developmentAssessments") ? (
              <PanelLoadError label="Gelişim trendi" onRetry={retry} subject="Gelişim değerlendirmeleri" title="Gelişim ve Mentorluk" />
            ) : <DevelopmentTrendPanel assessments={data?.developmentAssessments ?? []} />) : null}
          </>
        }
        side={
          <>
            {view === "attendance" ? (failed.has("profile") ? (
              <PanelLoadError label="Profil" onRetry={retry} subject="Profil bilgileri" title="Profil" />
            ) : <ProfilePanel profile={data?.profile ?? undefined} />) : null}
            {view === "profile" ? (failed.has("guardians") ? (
              <PanelLoadError label="Veli ilişkileri" onRetry={retry} subject="Veli ilişkileri" title="Veliler" />
            ) : <GuardianRelationsPanel guardians={data?.guardians ?? []} links={data?.guardianLinks ?? []} />) : null}
            {view === "profile" || view === "attendance" ? (failed.has("teacherNotes") ? (
              <PanelLoadError label="Öğretmen notları" onRetry={retry} subject="Öğretmen notları" title="Öğretmen Notları" />
            ) : <TeacherNotesPanel notes={data?.teacherNotes ?? []} courseNames={courseNameById} termNames={termNameById} />) : null}
          </>
        }
      />
    </PortalFrame>
  );
}

type StudentPortalPanelKey =
  | "announcements"
  | "attendance"
  | "classHomework"
  | "developmentAssessments"
  | "enrollments"
  | "guardians"
  | "homeworkAssignments"
  | "overview"
  | "profile"
  | "report"
  | "supportTickets"
  | "teacherNotes";

async function loadStudentPortal(
  accessToken: string,
  rolePreviewToken = "",
  requestedReportExamId = "",
  view: StudentPortalView = "overview",
) {
  const showOverview = view === "overview";
  // Günlük özet yalnız ödev, rapor ve duyuru okur. Profil sayfasındaki seçili öğrenci özeti tüm durumları
  // (Başarı %, duyuru, ödev, devamsızlık, destek) gösterdiği için o görünüm hepsini yükler.
  const showProfile = view === "profile";
  const showReports = showOverview || showProfile || view === "reports";
  const showHomework = showOverview || showProfile || view === "homework";
  const showAnnouncements = showOverview || showProfile || view === "announcements";
  const showSupport = showProfile || view === "support";
  const showAttendance = showProfile || view === "attendance";
  // Bir GET düşerse yalnız onun paneli hata ve "Tekrar dene" gösterir; sayfanın geri kalanı yerinde kalır.
  const failed: StudentPortalPanelKey[] = [];
  function settle<T>(key: StudentPortalPanelKey | null, request: Promise<T>, fallback: T): Promise<T> {
    return request.catch(() => {
      if (key && !failed.includes(key)) failed.push(key);
      return fallback;
    });
  }
  const get = <T,>(path: string) => readOnlyRequest<T>(accessToken, `${apiBaseUrl}${path}`, rolePreviewToken);

  const reportIndex = showReports
    ? await settle("report", apiRequestOrNull<PortalReportIndexItem[]>(accessToken, `${apiBaseUrl}/me/student/reports`, rolePreviewToken), null) ?? []
    : [];
  const selectedReportExamId = reportIndex.some((record) => record.examId === requestedReportExamId)
    ? requestedReportExamId
    : reportIndex[0]?.examId ?? "";
  const reportRequest = selectedReportExamId
    ? settle("report", apiRequestOrNull<ReportStudentSnapshot>(accessToken, `${apiBaseUrl}/me/student/reports/${encodeURIComponent(selectedReportExamId)}/latest`, rolePreviewToken), null)
    : Promise.resolve(null);
  const errorBookletRequest = selectedReportExamId
    ? settle("report", apiRequestOrNull<ReportErrorBooklet>(
        accessToken,
        `${apiBaseUrl}/me/student/reports/${encodeURIComponent(selectedReportExamId)}/latest/error-booklet`,
        rolePreviewToken,
      ), null)
    : Promise.resolve(null);
  const progressRequest = selectedReportExamId
    ? settle("report", apiRequestOrNull<ReportStudentProgress>(accessToken, `${apiBaseUrl}/me/student/reports/${encodeURIComponent(selectedReportExamId)}/progress?scope=all`, rolePreviewToken), null)
    : Promise.resolve(null);

  const [profile, guardians, guardianLinks, enrollments, announcements, homeworkAssignments, classHomework, supportTickets, attendance, attendanceSummary, teacherNotes, developmentAssessments, overview, report, errorBooklet, progress, courses, terms] = await Promise.all([
    settle<StudentProfileRecord | null>("profile", get<StudentProfileRecord>("/me/student/profile"), null),
    showProfile ? settle("guardians", get<GuardianRecord[]>("/me/student/guardians"), []) : Promise.resolve([]),
    showProfile ? settle("guardians", get<GuardianStudentRecord[]>("/me/student/guardian-links"), []) : Promise.resolve([]),
    showProfile ? settle("enrollments", get<StudentEnrollmentRecord[]>("/me/student/enrollments"), []) : Promise.resolve([]),
    showAnnouncements ? settle("announcements", get<AnnouncementRecord[]>("/me/student/announcements"), []) : Promise.resolve([]),
    showHomework ? settle("homeworkAssignments", get<HomeworkMaterialAssignmentRecord[]>("/me/student/homework/material-assignments"), []) : Promise.resolve([]),
    showHomework ? settle("classHomework", get<StudentHomeworkRecord[]>("/me/student/homework"), []) : Promise.resolve([]),
    showSupport ? settle("supportTickets", get<SupportTicketRecord[]>("/me/student/support-tickets"), []) : Promise.resolve([]),
    showAttendance ? settle("attendance", get<AttendanceRecord[]>("/me/student/attendance"), []) : Promise.resolve([]),
    showAttendance ? settle<AttendanceSummaryRecord | null>("attendance", get<AttendanceSummaryRecord>("/me/student/attendance/summary"), null) : Promise.resolve(null),
    showProfile || showAttendance ? settle("teacherNotes", get<TeacherNoteRecord[]>("/me/student/teacher-notes"), []) : Promise.resolve([]),
    showProfile ? settle("developmentAssessments", get<DevelopmentTrendItem[]>("/me/student/development-assessments"), []) : Promise.resolve([]),
    showOverview ? settle<StudentSelfOverview | null>("overview", get<StudentSelfOverview>("/me/student/overview"), null) : Promise.resolve(null),
    reportRequest,
    errorBookletRequest,
    progressRequest,
    // Ders ve dönem adları yalnız etiket içindir; alınamazsa paneller "bilgi yok" yazar, hata paneli açılmaz.
    showProfile || showReports || showHomework || showAttendance ? settle(null, get<CourseRecord[]>("/courses"), []) : Promise.resolve([]),
    showProfile || showReports || showHomework || showAttendance ? settle(null, get<AcademicTermRecord[]>("/academic-terms"), []) : Promise.resolve([]),
  ]);

  return { profile, guardians, guardianLinks, enrollments, announcements, homeworkAssignments, classHomework, supportTickets, attendance, attendanceSummary, teacherNotes, developmentAssessments, overview, report, errorBooklet, progress, courses, terms, reportIndex, selectedReportExamId, failed };
}

/** Bir panelin verisi alınamadığında yerine geçer; ikincil "Tekrar dene" yalnız portal verisini yeniden ister. */
function PanelLoadError({ label, onRetry, subject, title }: { label: string; onRetry: () => void; subject: string; title: string }) {
  return (
    <Panel aria-label={label} title={title}>
      <div role="alert">
        <p className="next-form-error">{subject} şu an alınamadı. Bağlantını kontrol edip tekrar dene.</p>
        <Button onClick={onRetry} variant="secondary">Tekrar dene</Button>
      </div>
    </Panel>
  );
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

