import { describe, expect, it } from "vitest";
import {
  isPreferredReportSnapshot,
  reportSnapshotPreferenceOrderBySql,
  reportSnapshotScopeFilters,
  reportSnapshotScopeWidth,
  type PreferredSnapshotCandidate,
} from "./report-snapshot-preference.js";

function snapshot(overrides: Partial<PreferredSnapshotCandidate> & { id: string }): PreferredSnapshotCandidate {
  return { createdAt: "2026-10-01T00:00:00.000Z", ...overrides };
}

describe("report snapshot preference", () => {
  it("counts the scope width over the five filters", () => {
    expect(reportSnapshotScopeWidth(snapshot({ id: "a" }))).toBe(0);
    expect(reportSnapshotScopeWidth(snapshot({ id: "a", gradeLevelId: "g" }))).toBe(1);
    expect(reportSnapshotScopeWidth(snapshot({ id: "a", campusId: "c", gradeLevelId: "g", classId: "k", courseId: "d", termId: "t" }))).toBe(5);
  });

  it("prefers the tenant-wide snapshot over a newer scoped one", () => {
    const tenantWide = snapshot({ id: "wide", generatedAt: "2026-10-01T10:00:00.000Z" });
    const classScoped = snapshot({ id: "class", classId: "class-a", generatedAt: "2026-10-02T10:00:00.000Z" });
    expect(isPreferredReportSnapshot(tenantWide, classScoped)).toBe(true);
    expect(isPreferredReportSnapshot(classScoped, tenantWide)).toBe(false);
  });

  it("falls back to the fewest filters, then the newest, then the id", () => {
    const level = snapshot({ id: "level", gradeLevelId: "g", generatedAt: "2026-10-01T10:00:00.000Z" });
    const levelClass = snapshot({ id: "level-class", gradeLevelId: "g", classId: "k", generatedAt: "2026-10-03T10:00:00.000Z" });
    expect(isPreferredReportSnapshot(level, levelClass)).toBe(true);

    const olderLevel = snapshot({ id: "older", gradeLevelId: "g", generatedAt: "2026-09-01T10:00:00.000Z" });
    expect(isPreferredReportSnapshot(level, olderLevel)).toBe(true);
    expect(isPreferredReportSnapshot(olderLevel, level)).toBe(false);

    const createdOnly = snapshot({ id: "created", gradeLevelId: "g", createdAt: "2026-10-02T10:00:00.000Z" });
    expect(isPreferredReportSnapshot(createdOnly, level)).toBe(true);

    const sameTimeA = snapshot({ id: "a", gradeLevelId: "g", generatedAt: "2026-10-01T10:00:00.000Z" });
    const sameTimeB = snapshot({ id: "b", gradeLevelId: "g", generatedAt: "2026-10-01T10:00:00.000Z" });
    expect(isPreferredReportSnapshot(sameTimeB, sameTimeA)).toBe(true);
    expect(isPreferredReportSnapshot(sameTimeA, sameTimeB)).toBe(false);
  });

  it("renders the same rule as an ORDER BY over the aliased ReportSnapshot row", () => {
    const sql = reportSnapshotPreferenceOrderBySql("snapshot");
    for (const column of reportSnapshotScopeFilters) {
      expect(sql).toContain(`(snapshot."${column}" IS NOT NULL)::int`);
    }
    expect(sql).toMatch(/^\(.+\) ASC, snapshot\."generatedAt" DESC NULLS LAST, snapshot\."createdAt" DESC, snapshot\."id" DESC$/);
  });
});
