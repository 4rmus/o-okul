"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { TeacherTodaySummary } from "@o-okul/shared-types";
import { DataTable, Panel, type DataTableColumn } from "@o-okul/ui";
import { apiBaseUrl, apiRequest } from "../../../src/api-client.js";
import { useAuth } from "../../providers.js";
import {
  AccessPanel,
  PortalActionStrip,
  PortalDailyBrief,
  PortalFrame,
  PortalStatePanel,
  readRolePreviewToken,
  RolePreviewNotice,
  type PortalActionItem,
} from "./_shared/portal-shell.js";

type TodayLesson = TeacherTodaySummary["todayLessons"][number];

// Öğretmen günlük özeti (Berrak §5): bugün → 1–3 aksiyon → detay. Tek read model (/me/teacher/today);
// yazma formları Ders akışı ve Öğrenci takibi sayfalarındadır.
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
    refetchOnWindowFocus: false,
  });
  const href = (path: string) => (isRolePreview ? `${path}${path.includes("?") ? "&" : "?"}rolePreview=1` : path);

  if (!canRead) {
    return <AccessPanel title="Öğretmen Portalı" />;
  }
  if (query.isError) {
    return (
      <PortalFrame title="Öğretmen Portalı" subtitle="Bugün">
        <PortalStatePanel description="Günlük özet şu an gösterilemiyor. Ders akışı ve ödev ekranlarından devam edebilirsiniz." state="error" title="Öğretmen günlük özeti alınamadı" />
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
  const nextLesson = today.todayLessons.find((lesson) => new Date(lesson.endsAt).getTime() >= Date.now()) ?? today.todayLessons[0];
  const actions: PortalActionItem[] = [
    {
      actionLabel: isRolePreview ? "Yalnızca görüntüleme" : "Yoklama al",
      detail: nextLesson ? `${nextLesson.title} · ${formatTime(nextLesson.startsAt)}` : "Bugün planlı ders yok",
      href: href("/ogretmen/ders-akisi"),
      key: "attendance",
      label: "Yoklama al",
      statusLabel: "Bugün",
      tone: nextLesson ? "info" : "neutral",
      value: `${today.todayLessons.length} ders`,
    },
    {
      actionLabel: "Kontrol et",
      detail: "Kontrol edilmeyen ödevler",
      href: href("/ogretmen/odevler"),
      key: "homework",
      label: "Ödev kontrolü",
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
      statusLabel: today.latestReport ? "Rapor hazır" : "Bekliyor",
      tone: today.latestReport ? "success" : "neutral",
      value: today.latestReport ? formatDate(today.latestReport.latestGeneratedAt) : "-",
    },
  ];

  const lessonColumns: Array<DataTableColumn<TodayLesson>> = [
    { key: "time", header: "Saat", mobilePriority: "primary", priority: "primary", render: (lesson) => `${formatTime(lesson.startsAt)}–${formatTime(lesson.endsAt)}` },
    { key: "lesson", header: "Ders", mobilePriority: "primary", priority: "primary", render: (lesson) => lesson.title },
    {
      key: "actions",
      header: "İşlem",
      // Mobilde işlem bağlantıları detay satırına iner; saat ve ders adı tam genişlikte kalır.
      mobilePriority: "hidden",
      priority: "primary",
      render: () => (
        <span className="next-row-actions next-row-actions--text">
          <Link href={href("/ogretmen/ders-akisi")}>Yoklama al</Link>
          <Link href={href("/ogretmen/odevler")}>Ödev ver</Link>
        </span>
      ),
    },
  ];

  return (
    <PortalFrame title="Öğretmen Portalı" subtitle="Bugün">
      {isRolePreview ? <RolePreviewNotice /> : null}
      <PortalDailyBrief
        items={[
          { label: "Bugünkü ders", value: `${today.todayLessons.length} ders`, detail: today.date, tone: today.todayLessons.length > 0 ? "info" : "neutral" },
          { label: "Sıradaki ders", value: nextLesson?.title ?? "Planlı ders yok", detail: nextLesson ? formatTime(nextLesson.startsAt) : "-", tone: nextLesson ? "info" : "neutral" },
          { label: "Ödev kontrolü", value: today.pendingHomeworkCount > 0 ? `${today.pendingHomeworkCount} bekliyor` : "Tamam", detail: "Kontrol edilmeyen ödevler", tone: today.pendingHomeworkCount > 0 ? "warning" : "success" },
        ]}
        summary="Bugünkü dersler, bekleyen ödevler ve son sınav raporu."
        title="Bugün"
      />
      <PortalActionStrip ariaLabel="Öğretmen günlük aksiyonları" items={actions} />
      <Panel aria-label="Bugünkü dersler" description={`${today.date} tarihli dersler.`} title="Bugünkü dersler">
        <DataTable caption="Bugünkü dersler" columns={lessonColumns} density="comfortable" emptyText="Bugün planlı ders yok." getRowKey={(lesson) => lesson.id} rows={today.todayLessons} />
      </Panel>
      <Panel
        actions={<Link href={href("/ogretmen/odevler")}>Ödev kontrolüne git</Link>}
        aria-label="Kontrol bekleyen ödevler"
        description={`${today.pendingHomeworkCount} ödev kontrol bekliyor.`}
        title="Kontrol bekleyen ödevler"
      >
        {today.pendingHomework.length > 0 ? (
          <ul className="next-portal-today-list">
            {today.pendingHomework.map((item) => (
              <li key={item.id}>
                <strong>{item.title}</strong>
                <span>{item.dueAt ? `Teslim: ${formatDate(item.dueAt)}` : "Teslim tarihi yok"}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="next-status-note">Kontrol bekleyen ödev yok.</p>
        )}
      </Panel>
      <Panel
        actions={<Link href={href("/ogretmen/raporlar")}>Sınav raporuna git</Link>}
        aria-label="Son sınav raporu"
        description="Başarı % ana metriktir; Net ve Soru bağlam olarak raporda gösterilir."
        title="Son sınav raporu"
      >
        {today.latestReport ? (
          <p>
            <strong>{today.latestReport.title}</strong> · {formatDate(today.latestReport.latestGeneratedAt)} tarihli rapor hazır.
          </p>
        ) : (
          <p className="next-status-note">Henüz hazır sınav raporu yok.</p>
        )}
      </Panel>
    </PortalFrame>
  );
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" }).format(new Date(value));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "medium", timeZone: "Europe/Istanbul" }).format(new Date(value));
}
