import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@uzman-hocam/db";
import { PostgresReportGenerationAdapter } from "./postgres-report-generation-adapter.js";
import { examResultSummaryReportType, type ReportSnapshotCandidate } from "./report-generation-job.js";
import type { ScoringResult } from "./scoring-engine.js";

describe("postgres report generation adapter", () => {
  it("tenant context içinde ExamResult kayıtlarını rapor girdisine çevirir", async () => {
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
    });

    expect(results).toEqual([{
      studentId: "student-a",
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
    expect(select?.sql).toContain('LEFT JOIN "Student"');
    expect(select?.sql).toContain('LEFT JOIN "Class"');
    expect(select?.sql).toContain('AND er."deletedAt" IS NULL');
    expect(select?.values).toEqual(["tenant-a", "exam-a"]);
    expect(client.queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("ReportSnapshot kaydını READY status ve inputRefs ile yazar", async () => {
    const snapshot = createSnapshot();
    const client = new FakeClient((sql, values) => {
      if (sql.includes('INSERT INTO "ReportSnapshot"')) {
        return [{
          id: "snapshot-a",
          tenantId: values?.[1],
          examId: values?.[2],
          reportType: values?.[3],
          inputRefs: JSON.parse(values?.[5] as string),
          snapshotData: JSON.parse(values?.[6] as string),
          generatedAt: values?.[7],
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
    expect(insert?.values?.[3]).toBe(examResultSummaryReportType);
    expect(insert?.values?.[4]).toBe("READY");
    expect(JSON.parse(insert?.values?.[5] as string)).toEqual(snapshot.inputRefs);
    expect(JSON.parse(insert?.values?.[6] as string)).toEqual(snapshot.snapshotData);
    expect(insert?.values?.[7]).toBe("2026-05-30T08:00:00.000Z");
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
      averages: { correct: 1, wrong: 0, blank: 0, net: 1, rawScore: 1, standardScore: 1 },
      branches: [{ branch: "Matematik", resultCount: 1, correct: 1, wrong: 0, blank: 0, net: 1 }],
      classes: [{
        classId: "class-a",
        className: "8-A",
        resultCount: 1,
        averages: { correct: 1, wrong: 0, blank: 0, net: 1, rawScore: 1, standardScore: 1 },
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
        total: createScore().total,
        branches: createScore().branches,
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
