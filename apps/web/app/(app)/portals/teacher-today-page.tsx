"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { TeacherTodaySummary } from "@o-okul/shared-types";
import { DataTable, Panel, StatusBadge, type DataTableColumn, type StatusBadgeProps } from "@o-okul/ui";
import { apiBaseUrl, apiRequest } from "../../../src/api-client.js";
import { formatDateKey } from "../_shared/istanbul-date.js";
import { useAuth } from "../../providers.js";
import {
  AccessPanel,
  PortalActionStrip,
  PortalDailyBrief,
  PortalFrame,
  PortalStatePanel,
  isPortalActionPending,
  readRolePreviewToken,
  RolePreviewNotice,
  type PortalActionItem,
} from "./_shared/portal-shell.js";

type TodayLesson = TeacherTodaySummary["todayLessons"][number];

// Öğretmen günlük özeti (Berrak §5): bugün (şimdi/sıradaki ders) → bekleyen işler → günün ders akışı.
// Tek read model (/me/teacher/today); yazma formları Ders akışı, Ödevler ve Not defteri sayfalarındadır.
export function TeacherTodayPage() {
  const { auth } = useAuth();
  const searchParams = useSearchParams();
  const rolePreviewToken = readRolePreviewToken(searchParams);
  const isRolePreview = Boolean(rolePreviewToken);
  const canRead = Boolean(auth && (auth.session.subjectType === "TEACHER" || isRolePreview));
  const query = useQuery({
    queryKey: ["next-teacher-today", auth?.session.userId ?? "anonymous", rolePreviewToken || "session"],
    queryFn: () => apiRequest<TeacherTodaySummary>(
      auth?.accessToken ?? "",
      `${apiBaseUrl}/me/teacher/today`,
      rolePreviewToken ? { headers: { "x-role-preview-token": rolePreviewToken } } : {},
    ),
    enabled: canRead,
  });
  const href = (path: string) => (isRolePreview ? `${path}${path.includes("?") ? "&" : "?"}rolePreview=1` : path);

  if (!canRead) {
    return <AccessPanel title="Öğretmen Portalı" />;
  }
  // Odak dönüşündeki yenileme düşerse yüklü özet korunur; hata ekranı yalnız hiç veri yokken çıkar.
  if (query.isError && !query.data) {
    return (
      <PortalFrame title="Öğretmen Portalı" subtitle="Bugün">
        <PortalStatePanel description="Günlük özet şu an gösterilemiyor. Ders akışı ve ödev ekranlarından devam edebilirsiniz." onRetry={() => void query.refetch()} state="error" title="Öğretmen günlük özeti alınamadı" />
      </PortalFrame>
    );
  }
  if (!query.data) {
    return (
      <PortalFrame title="Öğretmen Portalı" subtitle="Bugün">
        <PortalStatePanel description="Bugünkü dersler ve bekleyen işler hazırlanıyor." state="loading" title="Öğretmen günlük özeti hazırlanıyor" />
      </PortalFrame>
    );
  }

  const today = query.data;
  const now = Date.now();
  const lessons = today.todayLessons;
  // Biten ders "sıradaki" sayılmaz; günün dersleri bittiyse son ders bağlam olarak gösterilir.
  const nextLesson = lessons.find((lesson) => new Date(lesson.endsAt).getTime() >= now);
  const focusLesson = nextLesson ?? lessons.at(-1);
  const focusLabel = !focusLesson ? undefined : !nextLesson ? "Son ders" : hasStarted(nextLesson, now) ? "Şimdi" : "Sıradaki ders";
  const todayLabel = formatDateKey(today.date);
  // Yoklama bağlantısı dersin sınıfını ve gününü taşır; Ders akışı yoklama formunu bu sınıfla açar.
  const attendanceHref = (lesson: TodayLesson) =>
    `${href(`/ogretmen/ders-akisi?classId=${encodeURIComponent(lesson.classId)}&date=${encodeURIComponent(today.date)}`)}#portal-teacher-attendance`;

  // Eski API yanıtında yoklama durumu yoktur; o zaman sayaç ve rozetler "bilinmiyor" kalır, sıfır gösterilmez.
  const attendanceKnown = lessons.some((lesson) => lesson.attendanceTaken !== undefined);
  const lessonsWithoutAttendance = lessons.filter((lesson) => lesson.attendanceTaken === false);
  const overdueAttendance = lessonsWithoutAttendance.some((lesson) => hasStarted(lesson, now));
  const attendanceTarget = nextLesson?.attendanceTaken === false
    ? nextLesson
    : lessonsWithoutAttendance.find((lesson) => hasStarted(lesson, now)) ?? lessonsWithoutAttendance[0] ?? nextLesson;
  const pendingSubmissionCount = today.pendingSubmissionCount ?? 0;
  const unpublishedGradeDraftCount = today.unpublishedGradeDraftCount ?? 0;
  const unreadAnnouncementCount = today.unreadAnnouncementCount ?? 0;
  const nearestHomework = today.pendingHomework[0];

  // UAT U18: ders yokken "Yoklama al" iş olarak gösterilmez; kart yalnız Ders akışına bağlantı olarak kalır.
  const attendanceAction: PortalActionItem = lessons.length === 0
    ? {
        actionLabel: isRolePreview ? "Yalnızca görüntüleme" : "Aç",
        detail: "Bugün planlı ders yok",
        href: href("/ogretmen/ders-akisi"),
        key: "attendance",
        label: "Ders akışı",
        pending: false,
        statusLabel: "Ders yok",
        tone: "neutral",
        value: "0 ders",
      }
    : !attendanceKnown
    ? {
        actionLabel: isRolePreview ? "Yalnızca görüntüleme" : "Yoklama al",
        detail: nextLesson ? lessonDetail(nextLesson, now, { withTitle: true }) : "Bugünkü dersler bitti",
        href: nextLesson ? attendanceHref(nextLesson) : href("/ogretmen/ders-akisi"),
        key: "attendance",
        label: "Yoklama al",
        // Yoklama durumu bilinmiyorsa bekleyen iş sayılmaz; sayaç bilinmeyeni sıfır ya da iş diye göstermez.
        pending: false,
        statusLabel: "Bugün",
        tone: nextLesson ? "info" : "neutral",
        value: `${lessons.length} ders`,
      }
    : lessonsWithoutAttendance.length > 0 && attendanceTarget
      ? {
          actionLabel: isRolePreview ? "Yalnızca görüntüleme" : "Yoklama al",
          detail: lessonDetail(attendanceTarget, now, { withTitle: true }),
          href: attendanceHref(attendanceTarget),
          key: "attendance",
          label: "Yoklama al",
          pending: true,
          statusLabel: overdueAttendance ? "Yoklama alınmadı" : "Yoklama bekliyor",
          tone: overdueAttendance ? "warning" : "info",
          value: `${lessonsWithoutAttendance.length} ders`,
        }
      : {
          actionLabel: isRolePreview ? "Yalnızca görüntüleme" : "Yoklamayı gör",
          detail: "Bugünkü derslerin yoklaması alındı",
          href: focusLesson ? attendanceHref(focusLesson) : href("/ogretmen/ders-akisi"),
          key: "attendance",
          label: "Yoklama al",
          pending: false,
          statusLabel: "Tamam",
          tone: "success",
          value: "Tümü alındı",
        };

  // Bekleyen işler: sayacı sıfır olan veya okunamayan yeni kalemler gösterilmez; yoklama, ödev ve rapor her zaman kalır.
  const inbox: PortalActionItem[] = [
    attendanceAction,
    ...(pendingSubmissionCount > 0
      ? [{
          actionLabel: "Kontrol et",
          detail: "Öğrencilerin teslim ettiği, kontrol bekleyen ödevler",
          href: href("/ogretmen/odevler"),
          key: "submissions",
          label: "Teslim kontrolü",
          pending: true,
          statusLabel: "Bekliyor",
          tone: "warning" as const,
          value: `${pendingSubmissionCount} teslim`,
        }]
      : []),
    ...(unpublishedGradeDraftCount > 0
      ? [{
          actionLabel: "Gözden geçir",
          detail: "Kaydedilmiş, henüz yayımlanmamış notlar",
          href: href("/ogretmen/not-defteri"),
          key: "gradeDrafts",
          label: "Not taslakları",
          pending: true,
          statusLabel: "Yayımlanmadı",
          tone: "warning" as const,
          value: `${unpublishedGradeDraftCount} değerlendirme`,
        }]
      : []),
    ...(unreadAnnouncementCount > 0
      ? [{
          actionLabel: "Oku",
          detail: "Öğretmenlere gönderilen duyurular",
          href: href("/ogretmen/duyurular"),
          key: "announcements",
          label: "Okunmamış duyurular",
          pending: true,
          statusLabel: "Okunmadı",
          tone: "info" as const,
          value: `${unreadAnnouncementCount} duyuru`,
        }]
      : []),
    {
      actionLabel: "Kontrol et",
      detail: nearestHomework ? `En yakın: ${nearestHomework.title}` : "Kontrol edilmeyen ödevler",
      href: href("/ogretmen/odevler"),
      key: "homework",
      label: "Ödev kontrolü",
      pending: today.pendingHomeworkCount > 0,
      statusLabel: today.pendingHomeworkCount > 0 ? "Bekliyor" : "Tamam",
      tone: today.pendingHomeworkCount > 0 ? "warning" : "success",
      value: `${today.pendingHomeworkCount} ödev`,
    },
    {
      actionLabel: "İncele",
      detail: today.latestReport ? today.latestReport.title : "Hazır rapor yok",
      href: href(today.latestReport ? `/ogretmen/raporlar?examId=${encodeURIComponent(today.latestReport.examId)}` : "/ogretmen/raporlar"),
      key: "report",
      label: "Son sınav raporu",
      pending: false,
      statusLabel: today.latestReport ? "Rapor hazır" : "Bekliyor",
      tone: today.latestReport ? "success" : "neutral",
      value: today.latestReport ? formatDate(today.latestReport.latestGeneratedAt) : "-",
    },
  ];
  // UAT U18: "Bekleyen iş" kartı ve "Bekleyen işler" başlığı aynı tanımdan (pending kartlar) sayılır.
  const pendingSummaries: Record<string, string> = {
    attendance: `${lessonsWithoutAttendance.length} yoklama`,
    submissions: `${pendingSubmissionCount} teslim`,
    gradeDrafts: `${unpublishedGradeDraftCount} taslak`,
    announcements: `${unreadAnnouncementCount} duyuru`,
    homework: `${today.pendingHomeworkCount} ödev`,
  };
  const pendingWork = inbox.filter(isPortalActionPending).map((item) => pendingSummaries[item.key] ?? item.value);

  const lessonColumns: Array<DataTableColumn<TodayLesson>> = [
    { key: "time", header: "Saat", mobilePriority: "primary", priority: "primary", render: (lesson) => `${formatTime(lesson.startsAt)}–${formatTime(lesson.endsAt)}` },
    {
      key: "lesson",
      header: "Ders",
      mobilePriority: "primary",
      priority: "primary",
      render: (lesson) => (lesson === nextLesson && hasStarted(lesson, now) ? <>{lesson.title} <StatusBadge tone="info">Şimdi</StatusBadge></> : lesson.title),
    },
    { key: "class", header: "Sınıf", mobilePriority: "secondary", priority: "primary", render: (lesson) => lesson.className ?? "-" },
    {
      key: "attendance",
      header: "Yoklama",
      mobilePriority: "primary",
      priority: "primary",
      render: (lesson) => {
        const state = attendanceState(lesson, now);
        return state ? <StatusBadge tone={state.tone}>{state.label}</StatusBadge> : "-";
      },
    },
    {
      // "actions" anahtarı mobil detay satırından düşürülür; bu bağlantılar telefonda detay satırında kalmalı.
      key: "lessonActions",
      header: "İşlem",
      // Mobilde işlem bağlantıları detay satırına iner; saat, ders ve yoklama durumu tam genişlikte kalır.
      mobilePriority: "hidden",
      priority: "primary",
      render: (lesson) => (
        <span className="next-row-actions next-row-actions--text">
          <Link href={attendanceHref(lesson)}>{lesson.attendanceTaken ? "Yoklamayı gör" : "Yoklama al"}</Link>
          <Link href={href("/ogretmen/odevler")}>Ödev ver</Link>
        </span>
      ),
    },
  ];

  return (
    <PortalFrame dashboard="teacher" title="Öğretmen Portalı" subtitle="Bugün">
      {isRolePreview ? <RolePreviewNotice /> : null}
      <div className="campus-teacher-board">
        <PortalDailyBrief
          primaryAction={{
            href: focusLesson ? attendanceHref(focusLesson) : href("/ogretmen/ders-akisi"),
            label: isRolePreview || !focusLesson ? "Ders akışını incele" : focusLesson.attendanceTaken ? "Yoklamayı gör" : "Yoklama al",
          }}
          items={[
            { label: "Bugünkü ders", value: `${lessons.length} ders`, detail: todayLabel, tone: lessons.length > 0 ? "info" : "neutral" },
            {
              label: "Yoklama",
              value: !attendanceKnown || lessons.length === 0 ? "-" : lessonsWithoutAttendance.length > 0 ? `${lessonsWithoutAttendance.length} ders bekliyor` : "Tamam",
              detail: !attendanceKnown || lessons.length === 0
                ? (lessons.length > 0 ? "Ders akışında görülür" : "Bugün planlı ders yok")
                : `${lessons.length - lessonsWithoutAttendance.length}/${lessons.length} ders alındı`,
              tone: !attendanceKnown || lessons.length === 0 ? "neutral" : overdueAttendance ? "warning" : lessonsWithoutAttendance.length > 0 ? "info" : "success",
            },
            {
              label: "Bekleyen iş",
              value: pendingWork.length > 0 ? `${pendingWork.length} iş` : "Tamam",
              detail: pendingWork.length > 0 ? pendingWork.join(" · ") : "Bekleyen iş yok",
              tone: pendingWork.length > 0 ? "warning" : "success",
            },
          ]}
          scope={focusLesson && focusLabel ? { label: focusLabel, value: focusLesson.title, detail: lessonDetail(focusLesson, now, { withAttendance: true }) } : undefined}
          summary="Şimdiki veya sıradaki ders, yoklama durumu ve bekleyen işler."
          title="Bugün"
        />
        <Panel className="campus-teacher-timetable" aria-label="Bugünkü dersler" description={`${todayLabel} tarihli dersler.`} title="Bugünkü dersler">
          <DataTable aria-label="Bugünkü dersler" columns={lessonColumns} density="comfortable" emptyText="Bugün planlı ders yok." getRowKey={(lesson) => lesson.id} rows={lessons} />
        </Panel>
        <PortalActionStrip ariaLabel="Öğretmen günlük aksiyonları" eyebrow="Bugün yapılacaklar" items={inbox} title="Bekleyen işler" />
      </div>
    </PortalFrame>
  );
}

function hasStarted(lesson: TodayLesson, now: number) {
  return new Date(lesson.startsAt).getTime() <= now;
}

function attendanceState(lesson: TodayLesson, now: number): { label: string; tone: StatusBadgeProps["tone"] } | undefined {
  if (lesson.attendanceTaken === undefined) return undefined;
  if (lesson.attendanceTaken) return { label: "Alındı", tone: "success" };
  return hasStarted(lesson, now) ? { label: "Alınmadı", tone: "warning" } : { label: "Bekliyor", tone: "neutral" };
}

// Şimdi/Sıradaki kartı yoklama durumunu da taşır; aksiyon kartı ders adıyla başlar.
function lessonDetail(lesson: TodayLesson, now: number, options: { withAttendance?: boolean; withTitle?: boolean } = {}) {
  const attendance = options.withAttendance ? attendanceState(lesson, now) : undefined;
  return [
    options.withTitle ? lesson.title : "",
    `${formatTime(lesson.startsAt)}–${formatTime(lesson.endsAt)}`,
    lesson.className ?? "",
    attendance ? `Yoklama ${attendance.label.toLocaleLowerCase("tr-TR")}` : "",
  ].filter(Boolean).join(" · ");
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" }).format(new Date(value));
}
