import type { AnnouncementRecord } from "@o-okul/shared-types";

// DEC-20261102-06: the portal bell counts only what the portal listing already returns; no extra visibility rule.
export interface PortalUnreadAnnouncement {
  id: string;
  publishedAt: string;
  /** Guardian only: the ward whose list carries the announcement; the mark-read path is scoped to it. */
  studentId?: string;
  title: string;
}

export interface PortalAnnouncementSource {
  announcements: readonly AnnouncementRecord[];
  studentId?: string;
}

/**
 * Merges one or more portal announcement lists (one per guardian ward) into the unread set.
 * The same announcement reached through several wards is counted once; a copy that is already read wins.
 * Newest first, so the popover shows the latest titles.
 */
export function collectPortalUnreadAnnouncements(sources: readonly PortalAnnouncementSource[]): PortalUnreadAnnouncement[] {
  const readIds = new Set<string>();
  const unreadById = new Map<string, PortalUnreadAnnouncement>();
  for (const source of sources) {
    for (const announcement of source.announcements) {
      if (announcement.readAt) {
        readIds.add(announcement.id);
        continue;
      }
      if (unreadById.has(announcement.id)) continue;
      unreadById.set(announcement.id, {
        id: announcement.id,
        publishedAt: announcement.publishedAt,
        studentId: source.studentId,
        title: announcement.title,
      });
    }
  }
  return [...unreadById.values()]
    .filter((announcement) => !readIds.has(announcement.id))
    .sort((left, right) => publishedTime(right) - publishedTime(left));
}

function publishedTime(announcement: PortalUnreadAnnouncement) {
  const time = new Date(announcement.publishedAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

// Query keys are shared with the portal pages (student-portal-page / guardian-portal-page), so the shell bell and the
// page read one cached list and a mark-read on either side refreshes both. Keep them in step with those pages.
export function studentAnnouncementsQueryKey(userId: string) {
  return ["next-student-portal", userId, "session", "announcements"] as const;
}

export function guardianStudentsQueryKey(userId: string) {
  return ["next-guardian-students", userId, "session"] as const;
}

export function guardianAnnouncementsQueryKey(userId: string, studentId: string) {
  return ["next-guardian-portal", userId, studentId, "session", "announcements"] as const;
}
