import type { ReportSnapshotRecord } from "@o-okul/shared-types";

/**
 * Read-side preference among the READY snapshots of one exam, shared by the student progress series (L7, one point
 * per exam) and the institution dashboard headline: the broadest scope wins, that is the fewest of the campus, grade
 * level, class, course and term filters, so a tenant-wide snapshot beats a level or class one. Within the same width
 * the most recent snapshot wins by COALESCE(generatedAt, createdAt), then by createdAt; the snapshot id breaks a
 * remaining tie deterministically. The SQL form below renders the same three keys (report-snapshot-preference.fixture.ts
 * pins both). Snapshot generation, shape and the frozen ReportSnapshot contract are untouched.
 */
export const reportSnapshotScopeFilters = ["campusId", "gradeLevelId", "classId", "courseId", "termId"] as const;

type ScopedSnapshot = Pick<ReportSnapshotRecord, (typeof reportSnapshotScopeFilters)[number]>;

export type PreferredSnapshotCandidate = ScopedSnapshot & Pick<ReportSnapshotRecord, "id" | "createdAt" | "generatedAt">;

export function reportSnapshotScopeWidth(snapshot: ScopedSnapshot): number {
  return reportSnapshotScopeFilters.filter((key) => Boolean(snapshot[key])).length;
}

export function isPreferredReportSnapshot(candidate: PreferredSnapshotCandidate, current: PreferredSnapshotCandidate): boolean {
  const widthDiff = reportSnapshotScopeWidth(candidate) - reportSnapshotScopeWidth(current);
  if (widthDiff !== 0) return widthDiff < 0;
  const timeDiff = snapshotTime(candidate.generatedAt ?? candidate.createdAt) - snapshotTime(current.generatedAt ?? current.createdAt);
  if (timeDiff !== 0 && !Number.isNaN(timeDiff)) return timeDiff > 0;
  const createdDiff = snapshotTime(candidate.createdAt) - snapshotTime(current.createdAt);
  if (createdDiff !== 0 && !Number.isNaN(createdDiff)) return createdDiff > 0;
  return candidate.id.localeCompare(current.id) > 0;
}

/**
 * The same preference as an ORDER BY clause for a `ReportSnapshot` row aliased as `alias`: scope width ascending,
 * then COALESCE(generatedAt, createdAt) descending, then creation time and id descending.
 */
export function reportSnapshotPreferenceOrderBySql(alias: string): string {
  const width = reportSnapshotScopeFilters.map((column) => `(${alias}."${column}" IS NOT NULL)::int`).join(" + ");
  return `(${width}) ASC, COALESCE(${alias}."generatedAt", ${alias}."createdAt") DESC, ${alias}."createdAt" DESC, ${alias}."id" DESC`;
}

function snapshotTime(value: string | undefined): number {
  return value ? new Date(value).getTime() : 0;
}
