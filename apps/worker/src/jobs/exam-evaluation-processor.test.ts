import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@o-okul/db";
import { createJobId, type QueueJob } from "../queue/queues.js";
import { createExamEvaluationProcessor } from "./exam-evaluation-processor.js";
import type { ExamEvaluationJobPayload } from "./exam-evaluation-job.js";
import { scoringEngineVersion } from "./scoring-engine.js";

describe("exam evaluation processor composition", () => {
  it("Postgres adapter'ı tenant-aware pool ile job processor'a bağlar", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "ParsedAnswer"')) {
        return [{
          examId: "exam-a",
          studentId: "student-a",
          parserConfigVersion: "parser-v1",
          answers: [{ questionNo: 1, answer: "A" }],
          keyData: [{ questionNo: 1, correctAnswer: "A", branch: "Matematik" }],
          scoringConfig: null,
          answerKeyVersion: "answer-key-v1",
          examType: "SCHOOL",
        }];
      }
      if (sql.includes('INSERT INTO "ExamResult"')) {
        return [{
          tenantId: "tenant-a",
          examId: "exam-a",
          studentId: "student-a",
          participantId: "participant-a",
          rawImportId: "raw-import-a",
          answerKeyId: "answer-key-a",
          answerKeyVersion: "answer-key-v1",
          parserConfigVersion: "parser-v1",
          engineVersion: scoringEngineVersion,
          resultKey: `participant-a_answer-key-v1_parser-v1_${scoringEngineVersion}`,
          scoreData: {
            total: { correct: 1, wrong: 0, blank: 0, net: 1, rawScore: 1, standardScore: 1 },
            branches: [{ branch: "Matematik", correct: 1, wrong: 0, blank: 0, net: 1 }],
            _meta: {
              answerKeyVersion: "answer-key-v1",
              engineVersion: scoringEngineVersion,
              computedAt: "2026-05-30T03:00:00.000Z",
            },
          },
          computedAt: "2026-05-30T03:00:00.000Z",
        }];
      }
      return [];
    });
    const processor = createExamEvaluationProcessor({
      pool: new FakePool(client),
      now: () => "2026-05-30T03:00:00.000Z",
    });

    const result = await processor(createJob());

    expect(result.resultKey).toBe(`participant-a_answer-key-v1_parser-v1_${scoringEngineVersion}`);
    expect(client.queries.filter((query) => query.sql === "BEGIN")).toHaveLength(2);
    expect(client.queries.some((query) => query.sql.includes('FROM "ParsedAnswer"'))).toBe(true);
    expect(client.queries.some((query) => query.sql.includes('INSERT INTO "ExamResult"'))).toBe(true);
  });
});

function createJob(): QueueJob<ExamEvaluationJobPayload> {
  const payload: ExamEvaluationJobPayload = {
    tenantId: "tenant-a",
    userId: "user-a",
    entityId: "raw-import-a",
    contentHash: "hash-a",
    participantId: "participant-a",
    rawImportId: "raw-import-a",
    answerKeyId: "answer-key-a",
  };
  return {
    id: createJobId(payload.entityId, payload.contentHash),
    name: "exam-evaluation",
    payload,
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
