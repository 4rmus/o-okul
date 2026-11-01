"use client";

import Link from "next/link";
import { Button, DataTable, Panel, type DataTableColumn } from "@o-okul/ui";
import type { AnnouncementRecord } from "@o-okul/shared-types";

export function AnnouncementsPanel({
  announcements,
  limit,
  moreHref,
  onMarkRead,
  readOnly = false,
}: {
  announcements: AnnouncementRecord[];
  /** Portal özetinde yalnız ilk N duyuru; tamamı moreHref ile alt sayfada (UI/UX F7). */
  limit?: number;
  moreHref?: string;
  onMarkRead?: (announcement: AnnouncementRecord) => void | Promise<unknown>;
  readOnly?: boolean;
}) {
  const visibleAnnouncements = limit ? announcements.slice(0, limit) : announcements;
  const hiddenCount = announcements.length - visibleAnnouncements.length;
  const columns: Array<DataTableColumn<AnnouncementRecord>> = [
    {
      header: "Başlık",
      key: "title",
      priority: "primary",
      render: (announcement) => announcement.title,
      sticky: "left",
    },
    {
      header: "Tarih",
      key: "publishedAt",
      priority: "secondary",
      render: (announcement) => (announcement.publishedAt ? formatDateTime(announcement.publishedAt) : "-"),
    },
    {
      header: "Hedef",
      key: "audience",
      priority: "secondary",
      render: (announcement) => announcementAudienceLabel(announcement.audience),
    },
    {
      header: "Metin",
      key: "body",
      priority: "optional",
      render: (announcement) => announcement.body,
    },
    {
      header: "Okunma",
      key: "read",
      priority: "primary",
      render: (announcement) =>
        announcement.readAt ? (
          `Okundu ${formatDateTime(announcement.readAt)}`
        ) : readOnly ? (
          "Yalnızca görüntüleme"
        ) : (
          <Button onClick={() => void onMarkRead?.(announcement)} disabled={!onMarkRead} variant="secondary">
            Okundu işaretle
          </Button>
        ),
      sticky: "right",
    },
  ];

  return (
    <Panel
      actions={moreHref && hiddenCount > 0 ? <Link href={moreHref}>Tümünü aç ({announcements.length})</Link> : undefined}
      aria-label="Duyurular"
      description={hiddenCount > 0 ? `Son ${visibleAnnouncements.length} duyuru; ${hiddenCount} duyuru daha Duyurular sayfasında.` : "Portala görünür okul, öğrenci, veli veya öğretmen duyuruları."}
      title="Duyurular"
    >
      <DataTable
        caption="Portal duyuruları"
        columns={columns}
        description="Portala görünür okul, öğrenci, veli veya öğretmen duyuruları."
        emptyText="Duyuru yok."
        getRowKey={(announcement) => announcement.id}
        rows={visibleAnnouncements}
      />
    </Panel>
  );
}

function announcementAudienceLabel(audience: AnnouncementRecord["audience"]) {
  const labels: Record<AnnouncementRecord["audience"], string> = {
    GUARDIANS: "Veliler",
    SCHOOL: "Tüm okul",
    STUDENTS: "Öğrenciler",
    TEACHERS: "Öğretmenler",
  };
  return labels[audience];
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}
