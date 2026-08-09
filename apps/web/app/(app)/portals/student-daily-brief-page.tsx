"use client";

import type { StudentDailyBriefActionId, StudentDailyBriefResponse } from "@o-okul/shared-types";
import {
  PortalActionStrip,
  PortalDailyBrief,
  PortalFrame,
  RolePreviewNotice,
  type PortalActionItem,
} from "./_shared/portal-shell.js";

const actionDefinitions: Record<StudentDailyBriefActionId, {
  actionLabel: string;
  contextLabel: string;
  href: string;
  label: string;
}> = {
  announcement: { actionLabel: "Oku", contextLabel: "Duyuru", href: "/ogrenci/duyurular", label: "Duyuruları oku" },
  attendance: { actionLabel: "Kontrol et", contextLabel: "Devamsızlık", href: "/ogrenci/devamsizlik", label: "Devamsızlığı kontrol et" },
  homework: { actionLabel: "Tamamla", contextLabel: "Ödev", href: "/ogrenci/odevler", label: "Ödevi aç" },
  report: { actionLabel: "İncele", contextLabel: "Rapor", href: "/ogrenci/raporlar", label: "Son sınavı incele" },
  support: { actionLabel: "Takip et", contextLabel: "Destek", href: "/ogrenci/destek", label: "Destek talebini takip et" },
};

export function StudentDailyBriefPage({
  brief,
  isRolePreview,
}: {
  brief: StudentDailyBriefResponse;
  isRolePreview: boolean;
}) {
  const attendanceAlertCount = brief.absenceCount + brief.lateCount;
  const actions = brief.actions.map((action): PortalActionItem => {
    const definition = actionDefinitions[action.id];
    return {
      actionLabel: definition.actionLabel,
      contextLabel: definition.contextLabel,
      detail: action.id === "report" ? brief.latestReadyReport?.title ?? "Son hazır sınav raporu" : actionDetail(action.id),
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
      title="Öğrenci Portalı"
      subtitle="Bugün"
      context={{
        detail: "Duyuru, ödev, devamsızlık, destek ve son rapor özeti",
        label: "Günlük özet",
        meta: isRolePreview ? "Yalnızca görüntüleme" : "Öğrenci hesabı",
      }}
    >
      <PortalDailyBrief
        summary="Bugün öncelik vermen gereken işler, ayrıntı listeleri indirilmeden kişisel kapsamından hazırlanır."
        scope={{
          detail: isRolePreview ? "Yalnızca görüntüleme" : "Öğrenci hesabı",
          label: "Öğrenci",
          value: "Kişisel görünüm",
        }}
        items={[
          {
            detail: brief.unreadAnnouncementCount > 0 ? "Okunmamış okul duyurusu var" : "Okunmamış duyuru yok",
            label: "Duyuru",
            tone: brief.unreadAnnouncementCount > 0 ? "warning" : "success",
            value: brief.unreadAnnouncementCount > 0 ? `${brief.unreadAnnouncementCount} okunmamış` : "Güncel",
          },
          {
            detail: "Materyal ve tekrar çalışmaları",
            label: "Ödev",
            tone: brief.homeworkAssignmentCount > 0 ? "info" : "neutral",
            value: `${brief.homeworkAssignmentCount} atama`,
          },
          {
            detail: `${brief.absenceCount} yok, ${brief.lateCount} geç`,
            label: "Devamsızlık",
            tone: attendanceAlertCount > 0 ? "warning" : "success",
            value: `${brief.attendanceRecordCount} kayıt`,
          },
          {
            detail: brief.latestReadyReport?.title ?? "Hazır rapor bulunmuyor",
            label: "Son sınav",
            tone: brief.latestReadyReport ? "success" : "neutral",
            value: brief.latestReadyReport ? "Hazır" : "Yok",
          },
        ]}
      />
      <PortalActionStrip ariaLabel="Öğrenci günlük aksiyonları" items={actions} />
      {isRolePreview ? <RolePreviewNotice /> : null}
    </PortalFrame>
  );
}

function actionDetail(id: StudentDailyBriefActionId): string {
  if (id === "announcement") return "Okunmamış okul duyurusu";
  if (id === "attendance") return "Devamsızlık veya geç kalma kaydı";
  if (id === "homework") return "Atanmış materyal ve tekrar çalışması";
  if (id === "support") return "Açık destek talebi";
  return "Son hazır sınav raporu";
}

function actionUnit(id: StudentDailyBriefActionId): string {
  if (id === "announcement") return "okunmamış";
  if (id === "attendance") return "uyarı";
  if (id === "homework") return "atama";
  if (id === "support") return "talep";
  return "rapor";
}

function withPreview(path: string, isRolePreview: boolean): string {
  return isRolePreview ? `${path}?rolePreview=1` : path;
}
