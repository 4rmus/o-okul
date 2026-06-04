"use client";

import { Button } from "@uzman-hocam/ui";
import type { AnnouncementRecord } from "@uzman-hocam/shared-types";

export function AnnouncementsPanel({
  announcements,
  onMarkRead,
  readOnly = false,
}: {
  announcements: AnnouncementRecord[];
  onMarkRead?: (announcement: AnnouncementRecord) => void | Promise<unknown>;
  readOnly?: boolean;
}) {
  return (
    <section className="next-list-panel" aria-label="Duyurular">
      <h2>Duyurular</h2>
      <table className="uh-data-table">
        <thead>
          <tr>
            <th>Başlık</th>
            <th>Hedef</th>
            <th>Metin</th>
            <th>Okunma</th>
          </tr>
        </thead>
        <tbody>
          {announcements.map((announcement) => (
            <tr key={announcement.id}>
              <td>{announcement.title}</td>
              <td>{announcementAudienceLabel(announcement.audience)}</td>
              <td>{announcement.body}</td>
              <td>
                {announcement.readAt ? (
                  `Okundu ${formatDateTime(announcement.readAt)}`
                ) : readOnly ? (
                  "Salt-okuma"
                ) : (
                  <Button onClick={() => void onMarkRead?.(announcement)} disabled={!onMarkRead}>
                    Okundu işaretle
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
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
