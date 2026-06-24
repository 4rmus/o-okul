"use client";

import { Button, DataTable, Panel, type DataTableColumn } from "@o-okul/ui";
import type { AnnouncementRecord } from "@o-okul/shared-types";

export function AnnouncementsPanel({
  announcements,
  onMarkRead,
  readOnly = false,
}: {
  announcements: AnnouncementRecord[];
  onMarkRead?: (announcement: AnnouncementRecord) => void | Promise<unknown>;
  readOnly?: boolean;
}) {
  const columns: Array<DataTableColumn<AnnouncementRecord>> = [
    {
      header: "Başlık",
      key: "title",
      priority: "primary",
      render: (announcement) => announcement.title,
      sticky: "left",
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
          "Salt-okuma"
        ) : (
          <Button onClick={() => void onMarkRead?.(announcement)} disabled={!onMarkRead}>
            Okundu işaretle
          </Button>
        ),
      sticky: "right",
    },
  ];

  return (
    <Panel
      aria-label="Duyurular"
      description="Portala görünür okul, öğrenci, veli veya öğretmen duyuruları."
      title="Duyurular"
    >
      <DataTable
        caption="Portal duyuruları"
        columns={columns}
        description="Portala görünür okul, öğrenci, veli veya öğretmen duyuruları."
        emptyText="Duyuru yok."
        getRowKey={(announcement) => announcement.id}
        rows={announcements}
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
