import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { GradeLevelAnalyticsService } from "./grade-level-analytics.service.js";
import { createGradeLevelAnalyticsFixtures, gradeLevelAnalyticsExam as exam, gradeLevelAnalyticsSnapshot as levelSnapshot } from "./grade-level-analytics.test-support.js";
import type { ReportSnapshotRecord } from "./report-generation.service.js";
import { InMemoryReportSnapshotStore, type InMemoryGradeLevelAnalyticsExam } from "./report-snapshot-store.js";

const adminContext: RequestContext = {
  userId: "user-admin",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
  activePersona: "STAFF",
  campusScope: { scopeMode: "TENANT", campusIds: [] },
};

describe("GradeLevelAnalyticsService (DEC-20261102-08 G3)", () => {
  it("yalnız seviye snapshot'larını, READY ve yayınlanmış sınavlardan, sınav türü başına çizgi olarak döner", async () => {
    const service = createService();

    const analytics = await service.getGradeLevelAnalytics(adminContext, { gradeLevelId: "grade-8" });

    expect(analytics.tenantId).toBe("tenant-a");
    expect(analytics.series.map((series) => series.examType)).toEqual(["LGS", "TYT"]);
    expect(analytics.series[0]?.points).toEqual([
      {
        examId: "exam-lgs-1",
        examTitle: "LGS Deneme 1",
        examType: "LGS",
        startsAt: "2026-09-10T07:00:00.000Z",
        snapshotId: "level-lgs-1",
        generatedAt: "2026-09-11T09:00:00.000Z",
        participantCount: 40,
        successRate: 61.5,
        net: 55.35,
        questionCount: 90,
      },
      {
        examId: "exam-lgs-2",
        examTitle: "LGS Deneme 2",
        examType: "LGS",
        startsAt: "2026-10-10T07:00:00.000Z",
        snapshotId: "level-lgs-2",
        generatedAt: "2026-10-11T09:00:00.000Z",
        participantCount: 38,
        successRate: 64.25,
        net: 57.8,
        questionCount: 90,
      },
    ]);
    expect(analytics.series[1]?.points.map((point) => point.snapshotId)).toEqual(["level-tyt-1"]);
    const plottedSnapshotIds = analytics.series.flatMap((series) => series.points.map((point) => point.snapshotId));
    // Class, campus and course snapshots, other grade levels, DRAFT exams and deleted snapshots never become points.
    expect(plottedSnapshotIds).not.toContain("class-lgs-1");
    expect(plottedSnapshotIds).not.toContain("campus-lgs-1");
    expect(plottedSnapshotIds).not.toContain("course-lgs-1");
    expect(plottedSnapshotIds).not.toContain("level-grade-7");
    expect(plottedSnapshotIds).not.toContain("level-draft");
    expect(plottedSnapshotIds).not.toContain("level-deleted");
    expect(plottedSnapshotIds).not.toContain("level-tenant-b");
  });

  it("STALE seviye snapshot'ını nokta yapmaz, yenilenmeli listesinde döner", async () => {
    const service = createService();

    const analytics = await service.getGradeLevelAnalytics(adminContext, { gradeLevelId: "grade-8" });

    expect(analytics.needsRefresh).toEqual([{
      examId: "exam-lgs-3",
      examTitle: "LGS Deneme 3",
      examType: "LGS",
      startsAt: "2026-11-01T07:00:00.000Z",
      snapshotId: "level-lgs-3-stale",
      staleAt: "2026-11-02T08:00:00.000Z",
    }]);
    expect(analytics.series.flatMap((series) => series.points).some((point) => point.examId === "exam-lgs-3")).toBe(false);
  });

  it("aynı sınavda READY seviye snapshot'ı STALE olana tercih edilir", async () => {
    const service = createService({
      extraSnapshots: [levelSnapshot("level-lgs-1-old-stale", "exam-lgs-1", {
        status: "STALE",
        termId: "term-fall",
        generatedAt: "2026-09-12T09:00:00.000Z",
        staleAt: "2026-09-13T09:00:00.000Z",
      })],
    });

    const analytics = await service.getGradeLevelAnalytics(adminContext, { gradeLevelId: "grade-8" });

    expect(analytics.series[0]?.points[0]?.snapshotId).toBe("level-lgs-1");
    expect(analytics.needsRefresh.map((item) => item.examId)).toEqual(["exam-lgs-3"]);
  });

  it("seviye raporu üretilmemiş yayınlanmış sınavları ayrı listeler", async () => {
    const service = createService();

    const analytics = await service.getGradeLevelAnalytics(adminContext, { gradeLevelId: "grade-8" });

    expect(analytics.withoutLevelReport).toEqual([{
      examId: "exam-lgs-no-level",
      examTitle: "LGS Deneme Sınıf Raporlu",
      examType: "LGS",
      startsAt: "2026-10-20T07:00:00.000Z",
    }]);
  });

  it("sınav türü ve dönem süzgecini uygular", async () => {
    const service = createService();

    const lgsOnly = await service.getGradeLevelAnalytics(adminContext, { gradeLevelId: "grade-8", examType: "LGS" });
    expect(lgsOnly.examType).toBe("LGS");
    expect(lgsOnly.series.map((series) => series.examType)).toEqual(["LGS"]);

    const fallOnly = await service.getGradeLevelAnalytics(adminContext, { gradeLevelId: "grade-8", termId: "term-fall" });
    expect(fallOnly.termId).toBe("term-fall");
    expect(fallOnly.series.flatMap((series) => series.points.map((point) => point.examId))).toEqual(["exam-lgs-1", "exam-tyt-1"]);
    expect(fallOnly.needsRefresh).toEqual([]);
    expect(fallOnly.withoutLevelReport).toEqual([]);
  });

  it("snapshot'ta saklanmayan Başarı %'yi yeniden hesaplamaz ve sonuçsuz seviye snapshot'ını çizmez", async () => {
    const service = createService({
      extraExams: [
        exam("exam-legacy", "Eski Deneme", { examType: "SCHOOL", startsAt: "2026-09-20T07:00:00.000Z" }),
        exam("exam-empty", "Boş Deneme", { examType: "SCHOOL", startsAt: "2026-09-21T07:00:00.000Z" }),
      ],
      extraSnapshots: [
        levelSnapshot("level-legacy", "exam-legacy", { averages: { net: 20, questionCount: 40 }, resultCount: 12 }),
        levelSnapshot("level-empty", "exam-empty", { averages: { net: 0, questionCount: 0, successRate: 0 }, resultCount: 0 }),
      ],
    });

    const analytics = await service.getGradeLevelAnalytics(adminContext, { gradeLevelId: "grade-8", examType: "SCHOOL" });

    expect(analytics.series).toEqual([{
      examType: "SCHOOL",
      points: [{
        examId: "exam-legacy",
        examTitle: "Eski Deneme",
        examType: "SCHOOL",
        startsAt: "2026-09-20T07:00:00.000Z",
        snapshotId: "level-legacy",
        generatedAt: "2026-09-11T09:00:00.000Z",
        participantCount: 12,
        net: 20,
        questionCount: 40,
      }],
    }]);
  });

  it("kampüs kısıtlı personel 403 alır", async () => {
    const service = createService();

    await expect(service.getGradeLevelAnalytics({
      ...adminContext,
      roles: ["OPERATIONS_STAFF"],
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-a"] },
    }, { gradeLevelId: "grade-8" })).rejects.toMatchObject({
      status: 403,
      message: "REPORT_CAMPUS_SCOPE_FORBIDDEN",
    });
    await expect(service.getGradeLevelAnalytics({ ...adminContext, campusScope: undefined }, { gradeLevelId: "grade-8" }))
      .rejects.toMatchObject({ status: 403 });
    await expect(service.getGradeLevelAnalytics({ ...adminContext, bypassRls: true }, { gradeLevelId: "grade-8" }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("seviye olmadan istek reddedilir", async () => {
    const service = createService();

    await expect(service.getGradeLevelAnalytics(adminContext, { gradeLevelId: "  " })).rejects.toMatchObject({
      status: 400,
      message: "REPORT_GRADE_LEVEL_REQUIRED",
    });
  });

  it("başka tenant'ın snapshot ve sınavları görünmez", async () => {
    const service = createService();

    const analytics = await service.getGradeLevelAnalytics({ ...adminContext, tenantId: "tenant-b" }, { gradeLevelId: "grade-8" });

    expect(analytics.series.flatMap((series) => series.points.map((point) => point.snapshotId))).toEqual(["level-tenant-b"]);
    expect(analytics.withoutLevelReport).toEqual([]);
  });
});

function createService(extra: { extraExams?: InMemoryGradeLevelAnalyticsExam[]; extraSnapshots?: ReportSnapshotRecord[] } = {}) {
  return new GradeLevelAnalyticsService(new InMemoryReportSnapshotStore(createGradeLevelAnalyticsFixtures(extra)));
}
