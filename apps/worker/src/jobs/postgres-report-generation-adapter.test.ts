import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@o-okul/db";
import { PostgresReportGenerationAdapter } from "./postgres-report-generation-adapter.js";
import { examResultSummaryReportType, type ReportSnapshotCandidate } from "./report-generation-job.js";
import type { ScoringResult } from "./scoring-engine.js";

describe("postgres report generation adapter", () => {
  it("tenant context içinde ExamResult kayıtlarını rapor girdisine çevirir", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "ExamResult"')) {
        return [{
          studentId: "student-a",
          firstName: "Ada",
          lastName: "Ak",
          studentNo: "1001",
          classId: "class-a",
          className: "8-A",
          resultKey: "result-a",
          answerKeyVersion: "answer-key-v1",
          parserConfigVersion: "parser-v1",
          engineVersion: "engine-v1",
          scoreData: createScore(),
          computedAt: new Date("2026-05-30T07:00:00.000Z"),
        }];
      }
      return [];
    });
    const adapter = new PostgresReportGenerationAdapter(new FakePool(client));

    const results = await adapter.loadResults({
      tenantId: "tenant-a",
      userId: "user-a",
      jobId: "exam-a_results-v1",
      examId: "exam-a",
      reportType: examResultSummaryReportType,
      contentHash: "results-v1",
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
    });

    expect(results).toEqual([{
      studentId: "student-a",
      displayName: "Ada Ak",
      studentNo: "1001",
      classId: "class-a",
      className: "8-A",
      resultKey: "result-a",
      answerKeyVersion: "answer-key-v1",
      parserConfigVersion: "parser-v1",
      engineVersion: "engine-v1",
      score: createScore(),
      computedAt: "2026-05-30T07:00:00.000Z",
    }]);
    expect(client.queries[0]?.sql).toBe("BEGIN");
    expect(client.queries[1]).toEqual({
      sql: "SELECT set_config('app.bypass_rls', $1, true)",
      values: ["false"],
    });
    expect(client.queries[2]).toEqual({
      sql: "SELECT set_config('app.current_tenant_id', $1, true)",
      values: ["tenant-a"],
    });
    const select = client.queries.find((query) => query.sql.includes('FROM "ExamResult"'));
    expect(select?.sql).toContain('DISTINCT ON (er."studentId")');
    expect(select?.sql).toContain('er."computedAt" DESC');
    expect(select?.sql).toContain('LEFT JOIN "Student"');
    expect(select?.sql).toContain('s."firstName"');
    expect(select?.sql).toContain('s."studentNo"');
    expect(select?.sql).toContain('LEFT JOIN "Class"');
    expect(select?.sql).toContain('AND er."deletedAt" IS NULL');
    expect(select?.sql).toContain('c."campusId" = $3');
    expect(select?.sql).toContain('c."gradeLevelId" = $4');
    expect(select?.sql).toContain('s."classId" = $5');
    expect(select?.values).toEqual(["tenant-a", "exam-a", "campus-main", "grade-8", "class-a"]);
    expect(client.queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("rapor kapsamı boşsa sonuç sorgusunu sınıf filtresi olmadan çalıştırır", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "ExamResult"')) {
        return [{
          studentId: "student-a",
          classId: "class-a",
          className: "8-A",
          resultKey: "result-a",
          answerKeyVersion: "answer-key-v1",
          parserConfigVersion: "parser-v1",
          engineVersion: "engine-v1",
          scoreData: createScore(),
          computedAt: "2026-05-30T07:00:00.000Z",
        }];
      }
      return [];
    });
    const adapter = new PostgresReportGenerationAdapter(new FakePool(client));

    await adapter.loadResults({
      tenantId: "tenant-a",
      userId: "user-a",
      jobId: "exam-a_results-v1",
      examId: "exam-a",
      reportType: examResultSummaryReportType,
      contentHash: "results-v1",
      campusId: " ",
      gradeLevelId: "",
      classId: undefined,
    });

    const select = client.queries.find((query) => query.sql.includes('FROM "ExamResult"'));
    expect(select?.values).toEqual(["tenant-a", "exam-a", null, null, null]);
  });

  it("ReportSnapshot kaydını READY status ve inputRefs ile yazar", async () => {
    const snapshot = createSnapshot();
    const client = new FakeClient((sql, values) => {
      if (sql.includes('INSERT INTO "ReportSnapshot"')) {
        return [{
          id: "snapshot-a",
          tenantId: values?.[1],
          examId: values?.[2],
          campusId: values?.[3],
          gradeLevelId: values?.[4],
          classId: values?.[5],
          courseId: values?.[6],
          termId: values?.[7],
          reportType: values?.[8],
          contentHash: values?.[9],
          status: values?.[10],
          inputRefs: JSON.parse(values?.[11] as string),
          snapshotData: JSON.parse(values?.[12] as string),
          generatedAt: values?.[13],
        }];
      }
      return [];
    });
    const adapter = new PostgresReportGenerationAdapter(new FakePool(client));

    const saved = await adapter.saveSnapshot(snapshot);

    expect(saved).toEqual({ id: "snapshot-a", ...snapshot });
    const insert = client.queries.find((query) => query.sql.includes('INSERT INTO "ReportSnapshot"'));
    expect(insert?.sql).toContain('"status"');
    expect(insert?.values?.[1]).toBe("tenant-a");
    expect(insert?.values?.[2]).toBe("exam-a");
    expect(insert?.values?.slice(3, 8)).toEqual(["campus-main", "grade-8", "class-a", "course-math", "term-2026-spring"]);
    expect(insert?.values?.[8]).toBe(examResultSummaryReportType);
    expect(insert?.values?.[9]).toBe("results-v1");
    expect(insert?.values?.[10]).toBe("READY");
    expect(JSON.parse(insert?.values?.[11] as string)).toEqual(snapshot.inputRefs);
    expect(JSON.parse(insert?.values?.[12] as string)).toEqual(snapshot.snapshotData);
    expect(insert?.values?.[13]).toBe("2026-05-30T08:00:00.000Z");
    expect(insert?.sql).toContain('ON CONFLICT ("tenantId", "contentHash") DO NOTHING');
    expect(insert?.sql).not.toContain("DO UPDATE");
  });

  it("aynı contentHash tekrarlandığında mevcut snapshot gövdesini ve durumunu değiştirmez", async () => {
    const original = createSnapshot();
    const rerun: ReportSnapshotCandidate = {
      ...original,
      campusId: "campus-rerun",
      classId: "class-rerun",
      inputRefs: {
        ...original.inputRefs,
        resultKeys: ["result-rerun"],
      },
      snapshotData: {
        ...original.snapshotData,
        generatedAt: "2026-05-30T09:00:00.000Z",
        resultCount: 99,
      },
      generatedAt: "2026-05-30T09:00:00.000Z",
    };
    const client = new FakeClient((sql) => {
      if (sql.includes('INSERT INTO "ReportSnapshot"')) {
        return [];
      }
      if (sql.includes('FROM "ReportSnapshot"')) {
        return [{
          id: "snapshot-existing",
          tenantId: original.tenantId,
          examId: original.examId,
          campusId: original.campusId,
          gradeLevelId: original.gradeLevelId,
          classId: original.classId,
          courseId: original.courseId,
          termId: original.termId,
          reportType: original.reportType,
          contentHash: original.contentHash,
          status: "STALE",
          inputRefs: original.inputRefs,
          snapshotData: original.snapshotData,
          generatedAt: original.generatedAt,
        }];
      }
      return [];
    });
    const adapter = new PostgresReportGenerationAdapter(new FakePool(client));

    const saved = await adapter.saveSnapshot(rerun);

    expect(saved).toEqual({
      id: "snapshot-existing",
      ...original,
      status: "STALE",
    });
    expect(saved.snapshotData).not.toEqual(rerun.snapshotData);
    expect(saved.generatedAt).toBe(original.generatedAt);
    expect(saved.status).toBe("STALE");
    const insert = client.queries.find((query) => query.sql.includes('INSERT INTO "ReportSnapshot"'));
    expect(insert?.sql).toContain('ON CONFLICT ("tenantId", "contentHash") DO NOTHING');
    expect(insert?.sql).not.toContain("DO UPDATE");
    const select = client.queries.find((query) => query.sql.includes('FROM "ReportSnapshot"'));
    expect(select?.values).toEqual([original.tenantId, original.contentHash]);
  });

  it("hatalı scoreData değerini reddeder", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "ExamResult"')) {
        return [{
          studentId: "student-a",
          resultKey: "result-a",
          answerKeyVersion: "answer-key-v1",
          parserConfigVersion: "parser-v1",
          engineVersion: "engine-v1",
          scoreData: { total: {} },
          computedAt: "2026-05-30T07:00:00.000Z",
        }];
      }
      return [];
    });
    const adapter = new PostgresReportGenerationAdapter(new FakePool(client));

    await expect(adapter.loadResults({
      tenantId: "tenant-a",
      userId: "user-a",
      jobId: "exam-a_results-v1",
      examId: "exam-a",
      reportType: examResultSummaryReportType,
      contentHash: "results-v1",
    })).rejects.toThrow("REPORT_RESULT_SCORE_INVALID");
  });
});

function createSnapshot(): ReportSnapshotCandidate {
  return {
    tenantId: "tenant-a",
    examId: "exam-a",
    contentHash: "results-v1",
    campusId: "campus-main",
    gradeLevelId: "grade-8",
    classId: "class-a",
    courseId: "course-math",
    termId: "term-2026-spring",
    reportType: examResultSummaryReportType,
    status: "READY",
    inputRefs: {
      resultKeys: ["result-a"],
      answerKeyVersions: ["answer-key-v1"],
      parserConfigVersions: ["parser-v1"],
      engineVersions: ["engine-v1"],
    },
    snapshotData: {
      reportType: examResultSummaryReportType,
      generatedAt: "2026-05-30T08:00:00.000Z",
      resultCount: 1,
      averages: { correct: 1, wrong: 0, blank: 0, net: 1, questionCount: 1, rawScore: 1, standardScore: 1, successRate: 100 },
      branches: [{ branch: "Matematik", resultCount: 1, correct: 1, wrong: 0, blank: 0, net: 1, questionCount: 1, successRate: 100 }],
      classes: [{
        classId: "class-a",
        className: "8-A",
        resultCount: 1,
        averages: { correct: 1, wrong: 0, blank: 0, net: 1, questionCount: 1, rawScore: 1, standardScore: 1, successRate: 100 },
        branches: [{ branch: "Matematik", resultCount: 1, correct: 1, wrong: 0, blank: 0, net: 1, questionCount: 1, successRate: 100 }],
      }],
      statistics: {
        count: 1,
        total: { meanNet: 1, sdNet: 0, meanRawScore: 1, sdRawScore: 0 },
        branches: [{ branch: "Matematik", count: 1, meanNet: 1, sdNet: 0 }],
        standardScore: { mean: 50, sd: 10 },
        version: "2026.06.cohort-v1",
      },
      students: [{
        studentId: "student-a",
        classId: "class-a",
        className: "8-A",
        resultKey: "result-a",
        total: { ...createScore().total, questionCount: 1, successRate: 100 },
        branches: createScore().branches.map((branch) => ({ ...branch, questionCount: 1, successRate: 100 })),
        questions: createScore().questions,
        statistics: {
          standardScore: 50,
          general: { rank: 1, outOf: 1, percentile: 50 },
          class: { rank: 1, outOf: 1, percentile: 50 },
          branches: [{ branch: "Matematik", standardScore: 50, general: { rank: 1, outOf: 1, percentile: 50 }, class: { rank: 1, outOf: 1, percentile: 50 } }],
        },
      }],
    },
    generatedAt: "2026-05-30T08:00:00.000Z",
  };
}

function createScore(): ScoringResult {
  return {
    total: { correct: 1, wrong: 0, blank: 0, net: 1, rawScore: 1, standardScore: 1 },
    branches: [{ branch: "Matematik", correct: 1, wrong: 0, blank: 0, net: 1 }],
    questions: [{ questionNo: 1, branch: "Matematik", answer: "A", correctAnswer: "A", status: "CORRECT" }],
    _meta: {
      answerKeyVersion: "answer-key-v1",
      engineVersion: "engine-v1",
      computedAt: "2026-05-30T07:00:00.000Z",
    },
  };
}

class FakePool implements TenantQueryable {
  constructor(private readonly client: FakeClient) {}

  async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    return this.client.query<T>(sql, values);
  }

  async connect(): Promise<FakeClient> {
    return this.client;
  }
}

class FakeClient implements Queryable {
  readonly queries: Array<{ sql: string; values?: unknown[] }> = [];

  constructor(private readonly handler: (sql: string, values?: unknown[]) => unknown[]) {}

  async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    this.queries.push({ sql: sql.trim(), values });
    return { rows: this.handler(sql, values) as T[] };
  }

  release(): void {}
}
