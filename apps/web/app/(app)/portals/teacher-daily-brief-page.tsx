"use client";

import type { TeacherDailyBriefActionId, TeacherDailyBriefResponse } from "@o-okul/shared-types";
import {
  PortalActionStrip,
  PortalDailyBrief,
  PortalFrame,
  RolePreviewNotice,
  type PortalActionItem,
} from "./_shared/portal-shell.js";

const actionDefinitions: Record<TeacherDailyBriefActionId, {
  actionLabel: string;
  contextLabel: string;
  href: string;
  label: string;
}> = {
  attendance: { actionLabel: "Tamamla", contextLabel: "Yoklama", href: "/ogretmen/ogrenci-takibi", label: "Yoklamayı tamamla" },
  homework: { actionLabel: "Kontrol et", contextLabel: "Ödev", href: "/ogretmen/odevler", label: "Ödevleri kontrol et" },
  report: { actionLabel: "İncele", contextLabel: "Rapor", href: "/ogretmen/raporlar", label: "Son raporu incele" },
  support: { actionLabel: "Takip et", contextLabel: "Destek", href: "/ogretmen/destek", label: "Destek taleplerini takip et" },
};

export function TeacherDailyBriefPage({
  brief,
  isRolePreview,
}: {
  brief: TeacherDailyBriefResponse;
  isRolePreview: boolean;
}) {
  const totalPendingWork = brief.pendingAttendanceClassCount + brief.uncheckedHomeworkCount + brief.openSupportTicketCount;
  const actions = brief.actions.map((action): PortalActionItem => {
    const definition = actionDefinitions[action.id];
    const reportTitle = action.id === "report" ? brief.latestReadyReport?.title : undefined;
    return {
      actionLabel: definition.actionLabel,
      contextLabel: definition.contextLabel,
      detail: reportTitle ?? actionDetail(action.id),
      href: withPreview(definition.href, isRolePreview),
      key: action.id,
      label: definition.label,
      statusLabel: action.id === "report" ? "Hazır" : "Bekliyor",
      tone: action.id === "report" ? "info" : "warning",
      value: action.id === "report" ? "Yeni sonuç" : `${action.count} ${actionUnit(action.id)}`,
    };
  });

  return (
    <PortalFrame
      title="Öğretmen Portalı"
      subtitle="Bugün"
      context={{
        detail: "Ders, yoklama, ödev, destek ve son rapor özeti",
        label: "Günlük özet",
        meta: isRolePreview ? "Yalnızca görüntüleme" : "Canlı öğretmen hesabı",
      }}
    >
      <PortalDailyBrief
        title="Günlük ders akışı"
        summary="Günün dersleri ve bekleyen işler, ayrıntı listelerini indirmeden öğretmen kapsamınızda hazırlanır."
        scope={{
          detail: brief.nextLesson ? formatDateTime(brief.nextLesson.startsAt) : "Bugün",
          label: "Sıradaki ders",
          value: brief.nextLesson?.title ?? "Planlı ders yok",
        }}
        items={[
          {
            label: "Bugünkü ders",
            value: String(brief.todayLessonCount),
            detail: brief.nextLesson ? formatDateTime(brief.nextLesson.startsAt) : "Planlı ders yok",
            tone: brief.todayLessonCount > 0 ? "info" : "neutral",
          },
          {
            label: "Öğrenci kapsamı",
            value: String(brief.assignedStudentCount),
            detail: "Atanmış öğrenci sayısı",
            tone: brief.assignedStudentCount > 0 ? "info" : "neutral",
          },
          {
            label: "Bekleyen işler",
            value: String(totalPendingWork),
            detail: "Yoklama, ödev ve destek toplamı",
            tone: totalPendingWork > 0 ? "warning" : "success",
          },
          {
            label: "Son rapor",
            value: brief.latestReadyReport ? "Hazır" : "Yok",
            detail: brief.latestReadyReport?.title ?? "Hazır rapor bulunmuyor",
            tone: brief.latestReadyReport ? "success" : "neutral",
          },
        ]}
      />
      <PortalActionStrip ariaLabel="Öğretmen günlük aksiyonları" items={actions} />
      {isRolePreview ? <RolePreviewNotice /> : null}
    </PortalFrame>
  );
}

function actionDetail(id: TeacherDailyBriefActionId): string {
  if (id === "attendance") return "Kaydedilmemiş sınıf yoklaması";
  if (id === "homework") return "Kontrol bekleyen ödev";
  if (id === "support") return "Açık destek talebi";
  return "Son hazır sınav raporu";
}

function actionUnit(id: TeacherDailyBriefActionId): string {
  if (id === "attendance") return "sınıf";
  if (id === "homework") return "ödev";
  if (id === "support") return "talep";
  return "rapor";
}

function withPreview(path: string, isRolePreview: boolean): string {
  return isRolePreview ? `${path}?rolePreview=1` : path;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
