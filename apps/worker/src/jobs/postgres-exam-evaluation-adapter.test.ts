import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@o-okul/db";
import type { ExamEvaluationJobInput, ExamEvaluationJobResult } from "./exam-evaluation-job.js";
import { PostgresExamEvaluationAdapter } from "./postgres-exam-evaluation-adapter.js";
import { scoringEngineVersion, type ScoringResult } from "./scoring-engine.js";

describe("postgres exam evaluation adapter", () => {
  it("tenant context içinde ParsedAnswer, ExamParticipant ve AnswerKey girdilerini yükler", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "ParsedAnswer"')) {
        return [{
          examId: "exam-a",
          studentId: "student-a",
          bookletType: "A",
          parserConfigVersion: "parser-v1",
          answers: [{ questionNo: 1, answer: "A" }, { questionNo: 2, answer: "" }],
          keyData: {
            questions: [
              { questionNo: 1, correctAnswer: "A", branch: "Matematik" },
              { questionNo: 2, correctAnswer: "B", branch: "Türkçe" },
            ],
          },
          scoringConfig: {
            wrongPenalty: 0.2,
            rawScoreMultiplier: 5,
            standardScoreBase: 50,
            standardScoreMultiplier: 2,
          },
          answerKeyVersion: "answer-key-v1",
          examType: "LGS",
        }];
      }
      return [];
    });
    const adapter = new PostgresExamEvaluationAdapter(new FakePool(client), () => "2026-05-30T03:00:00.000Z");

    const input = await adapter.loadInput(createInput());

    expect(input).toEqual({
      examId: "exam-a",
      studentId: "student-a",
      parserConfigVersion: "parser-v1",
      bookletType: "A",
      answers: [{ questionNo: 1, answer: "A" }, { questionNo: 2, answer: "" }],
      bookletVariants: [],
      answerKey: [
        { questionNo: 1, correctAnswer: "A", branch: "Matematik" },
        { questionNo: 2, correctAnswer: "B", branch: "Türkçe" },
      ],
      scoringConfig: {
        examType: "LGS",
        wrongPenalty: 0.2,
        rawScoreMultiplier: 5,
        standardScoreBase: 50,
        standardScoreMultiplier: 2,
        answerKeyVersion: "answer-key-v1",
        engineVersion: scoringEngineVersion,
        computedAt: "2026-05-30T03:00:00.000Z",
      },
    });
    expect(client.queries[0]?.sql).toBe("BEGIN");
    expect(client.queries[1]).toEqual({
      sql: "SELECT set_config('app.bypass_rls', $1, true)",
      values: ["false"],
    });
    expect(client.queries[2]).toEqual({
      sql: "SELECT set_config('app.current_tenant_id', $1, true)",
      values: ["tenant-a"],
    });
    const select = client.queries.find((query) => query.sql.includes('FROM "ParsedAnswer"'));
    expect(select?.sql).toContain('INNER JOIN "ExamParticipant" ep');
    expect(select?.sql).toContain('AND ep."examId" = pa."examId"');
    expect(select?.sql).toContain('INNER JOIN "AnswerKey" ak');
    expect(select?.sql).toContain('AND ak."examId" = pa."examId"');
    expect(select?.sql).toContain('INNER JOIN "Exam" e');
    expect(select?.sql).toContain('e."tenantId" = pa."tenantId"');
    expect(select?.sql).toContain('e."id" = pa."examId"');
    expect(select?.values).toEqual(["tenant-a", "raw-import-a", "participant-a", "answer-key-a"]);
    expect(client.queries.find((query) => query.sql.includes('FROM "ExamBookletVariant"'))?.values).toEqual([
      "tenant-a",
      "exam-a",
    ]);
    expect(client.queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("ExamBookletVariant kayıtlarını scoring input'a taşır", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "ParsedAnswer"')) {
        return [{
          examId: "exam-a",
          studentId: "student-a",
          bookletType: "B",
          parserConfigVersion: "parser-v1",
          answers: [{ questionNo: 1, answer: "B" }, { questionNo: 2, answer: "A" }],
          keyData: [{ questionNo: 1, correctAnswer: "A", branch: "Matematik" }],
          scoringConfig: null,
          answerKeyVersion: "answer-key-v1",
          examType: "TYT",
        }];
      }
      if (sql.includes('FROM "ExamBookletVariant"')) {
        return [{ code: "B", permutation: [2, 1] }];
      }
      return [];
    });
    const adapter = new PostgresExamEvaluationAdapter(new FakePool(client));

    const input = await adapter.loadInput(createInput());

    expect(input.bookletType).toBe("B");
    expect(input.bookletVariants).toEqual([{ code: "B", permutation: [2, 1] }]);
  });

  it("eski examType alanı boş sınavı geriye uyumlu yükler", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "ParsedAnswer"')) {
        return [{
          examId: "exam-a",
          studentId: "student-a",
          bookletType: "A",
          parserConfigVersion: "parser-v1",
          answers: [{ questionNo: 1, answer: "A" }],
          keyData: [{ questionNo: 1, correctAnswer: "A", branch: "Matematik" }],
          scoringConfig: null,
          answerKeyVersion: "answer-key-v1",
          examType: null,
        }];
      }
      return [];
    });
    const adapter = new PostgresExamEvaluationAdapter(new FakePool(client));

    const input = await adapter.loadInput(createInput());

    expect(input.scoringConfig).not.toHaveProperty("examType");
  });

  it("input kaydı yoksa net hata verir", async () => {
    const adapter = new PostgresExamEvaluationAdapter(new FakePool(new FakeClient(() => [])));

    await expect(adapter.loadInput(createInput())).rejects.toThrow("EXAM_EVALUATION_INPUT_NOT_FOUND");
  });

  it("ParsedAnswer yoksa çözülmüş karantinadan cevapları materyalize edip input yükler", async () => {
    let parsedAnswerSelectCount = 0;
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "ParsedAnswer"')) {
        parsedAnswerSelectCount += 1;
        if (parsedAnswerSelectCount === 1) {
          return [];
        }
        return [{
          examId: "exam-a",
          studentId: "student-a",
          bookletType: "A",
          parserConfigVersion: "parser-v1",
          answers: [{ questionNo: 1, answer: "A" }, { questionNo: 2, answer: "B" }],
          keyData: {
            questions: [
              { questionNo: 1, correctAnswer: "A", branch: "Matematik" },
              { questionNo: 2, correctAnswer: "B", branch: "Türkçe" },
            ],
          },
          scoringConfig: null,
          answerKeyVersion: "answer-key-v1",
          examType: "SCHOOL",
        }];
      }
      if (sql.includes('FROM "ImportQuarantine"')) {
        return [{
          tenantId: "tenant-a",
          examId: "exam-a",
          rawImportId: "raw-import-a",
          rowNumber: 12,
          rawRow: { line: "99999\tA\tAB" },
          parserConfigVersion: "parser-v1",
          delimiter: "TAB",
          skipHeaderLines: 0,
          fieldMapping: {
            studentNo: { kind: "delimited", column: 0 },
            bookletType: { kind: "delimited", column: 1 },
            answers: { kind: "delimited", column: 2, estimatedQuestionCount: 2 },
          },
        }];
      }
      return [];
    });
    const adapter = new PostgresExamEvaluationAdapter(new FakePool(client), () => "2026-05-30T03:00:00.000Z");

    const input = await adapter.loadInput(createInput());

    const quarantineSelect = client.queries.find((query) => query.sql.includes('FROM "ImportQuarantine"'));
    const parsedInsert = client.queries.find((query) => query.sql.includes('INSERT INTO "ParsedAnswer"'));
    expect(parsedAnswerSelectCount).toBe(2);
    expect(quarantineSelect?.sql).toContain('q."status" = \'RESOLVED\'');
    expect(quarantineSelect?.sql).toContain('ep."studentId" = q."resolvedStudentId"');
    expect(quarantineSelect?.values).toEqual(["tenant-a", "raw-import-a", "participant-a"]);
    expect(parsedInsert?.sql).toContain('ON CONFLICT ("tenantId", "rawImportId", "participantId", "parserConfigVersion")');
    expect(parsedInsert?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "exam-a",
      "raw-import-a",
      "participant-a",
      "parser-v1",
      12,
      JSON.stringify([{ questionNo: 1, answer: "A" }, { questionNo: 2, answer: "B" }]),
    ]);
    expect(input.answers).toEqual([{ questionNo: 1, answer: "A" }, { questionNo: 2, answer: "B" }]);
  });

  it("hatalı parsed answer JSON değerini reddeder", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "ParsedAnswer"')) {
        return [{
          examId: "exam-a",
          studentId: "student-a",
          bookletType: "A",
          parserConfigVersion: "parser-v1",
          answers: [{ questionNo: 0, answer: "A" }],
          keyData: [{ questionNo: 1, correctAnswer: "A", branch: "Matematik" }],
          scoringConfig: null,
          answerKeyVersion: "answer-key-v1",
          examType: "SCHOOL",
        }];
      }
      return [];
    });
    const adapter = new PostgresExamEvaluationAdapter(new FakePool(client));

    await expect(adapter.loadInput(createInput())).rejects.toThrow("EXAM_EVALUATION_INPUT_INVALID");
  });

  it("desteklenmeyen Exam.examType değerini scoring config'e taşımaz", async () => {
    const client = new FakeClient((sql) => {
      if (sql.includes('FROM "ParsedAnswer"')) {
        return [{
          examId: "exam-a",
          studentId: "student-a",
          bookletType: "A",
          parserConfigVersion: "parser-v1",
          answers: [{ questionNo: 1, answer: "A" }],
          keyData: [{ questionNo: 1, correctAnswer: "A", branch: "Matematik" }],
          scoringConfig: null,
          answerKeyVersion: "answer-key-v1",
          examType: "UNKNOWN",
        }];
      }
      return [];
    });
    const adapter = new PostgresExamEvaluationAdapter(new FakePool(client));

    await expect(adapter.loadInput(createInput())).rejects.toThrow("EXAM_EVALUATION_INPUT_INVALID");
  });

  it("ExamResult sonucunu idempotent resultKey ile yazar", async () => {
    const result = createResult();
    const client = new FakeClient((sql) => {
      if (sql.includes('INSERT INTO "ExamResult"')) return [createResultRow(result)];
      return [];
    });
    const adapter = new PostgresExamEvaluationAdapter(new FakePool(client));

    const saved = await adapter.saveResult(result);

    expect(saved).toEqual(result);
    const insert = client.queries.find((query) => query.sql.includes('INSERT INTO "ExamResult"'));
    expect(insert?.sql).toContain('ON CONFLICT ("tenantId", "participantId", "answerKeyVersion", "parserConfigVersion", "engineVersion")');
    expect(insert?.sql).toContain('"resultKey" = EXCLUDED."resultKey"');
    expect(insert?.sql).toContain('"scoreData" = EXCLUDED."scoreData"');
    expect(insert?.sql).toContain('"deletedAt" = NULL');
    expect(insert?.values?.slice(0, 11)).toEqual([
      expect.any(String),
      "tenant-a",
      "exam-a",
      "student-a",
      "participant-a",
      "raw-import-a",
      "answer-key-a",
      "answer-key-v1",
      "parser-v1",
      scoringEngineVersion,
      `participant-a_answer-key-v1_parser-v1_${scoringEngineVersion}`,
    ]);
    expect(JSON.parse(insert?.values?.[11] as string)).toEqual(result.score);
    expect(insert?.values?.[12]).toBe("2026-05-30T03:00:00.000Z");
  });

  it("insert conflict durumunda mevcut sonucu okuyup döner", async () => {
    const result = createResult();
    const existingResult = {
      ...result,
      score: {
        ...result.score,
        total: { ...result.score.total, correct: 2, net: 2, rawScore: 2, standardScore: 2 },
      },
    };
    const client = new FakeClient((sql) => {
      if (sql.includes('INSERT INTO "ExamResult"')) return [];
      if (sql.includes('FROM "ExamResult"')) return [createResultRow(existingResult)];
      return [];
    });
    const adapter = new PostgresExamEvaluationAdapter(new FakePool(client));

    await expect(adapter.saveResult(result)).resolves.toEqual(existingResult);
    expect(client.queries.find((query) => query.sql.includes('FROM "ExamResult"'))?.values).toEqual([
      "tenant-a",
      `participant-a_answer-key-v1_parser-v1_${scoringEngineVersion}`,
    ]);
  });
});

function createInput(): ExamEvaluationJobInput {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    jobId: "raw-import-a_hash-a",
    participantId: "participant-a",
    rawImportId: "raw-import-a",
    answerKeyId: "answer-key-a",
    contentHash: "hash-a",
  };
}

function createResult(): ExamEvaluationJobResult {
  return {
    tenantId: "tenant-a",
    examId: "exam-a",
    studentId: "student-a",
    participantId: "participant-a",
    rawImportId: "raw-import-a",
    answerKeyId: "answer-key-a",
    parserConfigVersion: "parser-v1",
    answerKeyVersion: "answer-key-v1",
    engineVersion: scoringEngineVersion,
    resultKey: `participant-a_answer-key-v1_parser-v1_${scoringEngineVersion}`,
    score: createScore(),
    status: "completed",
  };
}

function createScore(): ScoringResult {
  return {
    total: {
      correct: 1,
      wrong: 0,
      blank: 0,
      net: 1,
      rawScore: 1,
      standardScore: 1,
    },
    branches: [{ branch: "Matematik", correct: 1, wrong: 0, blank: 0, net: 1 }],
    questions: [{ questionNo: 1, branch: "Matematik", answer: "A", correctAnswer: "A", status: "CORRECT" }],
    _meta: {
      answerKeyVersion: "answer-key-v1",
      engineVersion: scoringEngineVersion,
      computedAt: "2026-05-30T03:00:00.000Z",
    },
  };
}

function createResultRow(result: ExamEvaluationJobResult) {
  return {
    tenantId: result.tenantId,
    examId: result.examId,
    studentId: result.studentId,
    participantId: result.participantId,
    rawImportId: result.rawImportId,
    answerKeyId: result.answerKeyId,
    answerKeyVersion: result.answerKeyVersion,
    parserConfigVersion: result.parserConfigVersion,
    engineVersion: result.engineVersion,
    resultKey: result.resultKey,
    scoreData: result.score,
    computedAt: result.score._meta.computedAt,
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
  private released = false;

  constructor(private readonly handler: (sql: string, values?: unknown[]) => unknown[]) {}

  async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    this.queries.push({ sql: sql.trim(), values });
    return { rows: this.handler(sql, values) as T[] };
  }

  release(): void {
    this.released = true;
  }
}
