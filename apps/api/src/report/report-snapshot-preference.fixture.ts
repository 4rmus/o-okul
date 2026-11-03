import type { PreferredSnapshotCandidate } from "./report-snapshot-preference.js";

/**
 * One fixture for both halves of the snapshot preference: the TS comparator (isPreferredReportSnapshot) and the SQL
 * ORDER BY (reportSnapshotPreferenceOrderBySql) must rank these rows identically. Every row but `pref-wide` carries
 * one scope filter (campusId), so width breaks nothing among them; `pref-created-only` has no generatedAt and is
 * placed by its createdAt (COALESCE), not last.
 */
export const reportSnapshotPreferenceFixture: ReadonlyArray<PreferredSnapshotCandidate & { generatedAt?: string }> = [
  { id: "pref-tie-b", campusId: "campus-pref", generatedAt: "2026-10-01T10:00:00.000Z", createdAt: "2026-09-28T10:00:00.000Z" },
  { id: "pref-gen-old", campusId: "campus-pref", generatedAt: "2026-10-01T10:00:00.000Z", createdAt: "2026-10-01T10:00:00.000Z" },
  { id: "pref-wide", generatedAt: "2026-01-01T10:00:00.000Z", createdAt: "2026-01-01T10:00:00.000Z" },
  { id: "pref-created-only", campusId: "campus-pref", createdAt: "2026-10-02T10:00:00.000Z" },
  { id: "pref-tie-c", campusId: "campus-pref", generatedAt: "2026-10-01T10:00:00.000Z", createdAt: "2026-09-28T10:00:00.000Z" },
  { id: "pref-gen-new", campusId: "campus-pref", generatedAt: "2026-10-03T10:00:00.000Z", createdAt: "2026-09-30T10:00:00.000Z" },
  { id: "pref-tie-a", campusId: "campus-pref", generatedAt: "2026-10-01T10:00:00.000Z", createdAt: "2026-09-29T10:00:00.000Z" },
];

/** Width ascending, then COALESCE(generatedAt, createdAt) descending, then createdAt descending, then id descending. */
export const reportSnapshotPreferenceExpectedOrder = [
  "pref-wide",
  "pref-gen-new",
  "pref-created-only",
  "pref-gen-old",
  "pref-tie-a",
  "pref-tie-c",
  "pref-tie-b",
] as const;
