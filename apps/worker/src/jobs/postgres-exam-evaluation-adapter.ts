import { type Queryable, type TenantQueryable, withTenantDb } from "@uzman-hocam/db";
import {
  type ExamEvaluationJobAdapter,
  type ExamEvaluationJobInput,
  type ExamEvaluationJobResult,
  type ExamEvaluationScoringInput,
} from "./exam-evaluation-job.js";
import { scoringEngineVersion, type AnswerKeyItem, type Choice, type ScoringConfig, type ScoringResult, type StudentAnswer } from "./scoring-engine.js";

const defaultWrongPenalty = 0.25;
const choices = new Set<Choice>(["A", "B", "C", "D", "E", ""]);

export class PostgresExamEvaluationAdapter implements ExamEvaluationJobAdapter {
  constructor(
    private readonly pool: TenantQueryable,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  async loadInput(input: ExamEvaluationJobInput): Promise<ExamEvaluationScoringInput> {
    return withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      const result = await client.query<ExamEvaluationInputRow>(
        `SELECT
           pa."examId" AS "examId",
           ep."studentId" AS "studentId",
           pa."parserConfigVersion" AS "parserConfigVersion",
           pa."answers" AS "answers",
           ak."keyData" AS "keyData",
           ak."scoringConfig" AS "scoringConfig",
           ak."version" AS "answerKeyVersion"
         FROM "ParsedAnswer" pa
         INNER JOIN "RawImport" ri
           ON ri."tenantId" = pa."tenantId"
          AND ri."examId" = pa."examId"
          AND ri."id" = pa."rawImportId"
          AND ri."parserConfigVersion" = pa."parserConfigVersion"
         INNER JOIN "ExamParticipant" ep
           ON ep."tenantId" = pa."tenantId"
          AND ep."examId" = pa."examId"
          AND ep."id" = pa."participantId"
         INNER JOIN "AnswerKey" ak
           ON ak."tenantId" = pa."tenantId"
          AND ak."examId" = pa."examId"
         WHERE pa."tenantId" = $1
           AND pa."rawImportId" = $2
           AND pa."participantId" = $3
           AND ak."id" = $4
           AND pa."status" = 'MATCHED'
           AND pa."deletedAt" IS NULL
           AND ri."deletedAt" IS NULL
           AND ep."deletedAt" IS NULL
           AND ak."deletedAt" IS NULL
         LIMIT 1`,
        [input.tenantId, input.rawImportId, input.participantId, input.answerKeyId],
      );
      const row = result.rows[0];
      if (!row) {
        throw new Error("EXAM_EVALUATION_INPUT_NOT_FOUND");
      }

      return {
        examId: row.examId,
        studentId: row.studentId,
        parserConfigVersion: row.parserConfigVersion,
        answers: parseStudentAnswers(row.answers),
        answerKey: parseAnswerKey(row.keyData),
        scoringConfig: parseScoringConfig(row.scoringConfig, row.answerKeyVersion, this.now()),
      };
    });
  }

  async saveResult(result: ExamEvaluationJobResult): Promise<ExamEvaluationJobResult> {
    return withTenantDb(this.pool, { tenantId: result.tenantId }, async (client) => {
      const inserted = await client.query<ExamResultRow>(
        `INSERT INTO "ExamResult" (
           "tenantId",
           "examId",
           "studentId",
           "participantId",
           "rawImportId",
           "answerKeyId",
           "answerKeyVersion",
           "parserConfigVersion",
           "engineVersion",
           "resultKey",
           "scoreData",
           "computedAt",
           "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, now())
         ON CONFLICT ("tenantId", "resultKey") DO NOTHING
         RETURNING *`,
        toInsertValues(result),
      );

      const row = inserted.rows[0] ?? (await findExistingResult(client, result));
      if (!row) {
        throw new Error("EXAM_EVALUATION_RESULT_SAVE_FAILED");
      }
      return toExamEvaluationJobResult(row);
    });
  }
}

interface ExamEvaluationInputRow {
  examId: string;
  studentId: string;
  parserConfigVersion: string;
  answers: unknown;
  keyData: unknown;
  scoringConfig: unknown;
  answerKeyVersion: string;
}

interface ExamResultRow {
  tenantId: string;
  examId: string;
  studentId: string;
  participantId: string;
  rawImportId: string;
  answerKeyId: string;
  answerKeyVersion: string;
  parserConfigVersion: string;
  engineVersion: string;
  resultKey: string;
  scoreData: unknown;
  computedAt: Date | string;
}

async function findExistingResult(
  client: Queryable,
  result: ExamEvaluationJobResult,
): Promise<ExamResultRow | undefined> {
  const existing = await client.query<ExamResultRow>(
    `SELECT *
     FROM "ExamResult"
     WHERE "tenantId" = $1
       AND "resultKey" = $2
       AND "deletedAt" IS NULL
     LIMIT 1`,
    [result.tenantId, result.resultKey],
  );
  return existing.rows[0];
}

function toInsertValues(result: ExamEvaluationJobResult): unknown[] {
  return [
    result.tenantId,
    result.examId,
    result.studentId,
    result.participantId,
    result.rawImportId,
    result.answerKeyId,
    result.answerKeyVersion,
    result.parserConfigVersion,
    result.engineVersion,
    result.resultKey,
    JSON.stringify(result.score),
    result.score._meta.computedAt,
  ];
}

function toExamEvaluationJobResult(row: ExamResultRow): ExamEvaluationJobResult {
  const score = parseScoringResult(row.scoreData);
  return {
    tenantId: row.tenantId,
    examId: row.examId,
    studentId: row.studentId,
    participantId: row.participantId,
    rawImportId: row.rawImportId,
    answerKeyId: row.answerKeyId,
    parserConfigVersion: row.parserConfigVersion,
    answerKeyVersion: row.answerKeyVersion,
    engineVersion: row.engineVersion,
    resultKey: row.resultKey,
    score,
    status: "completed",
  };
}

function parseStudentAnswers(value: unknown): StudentAnswer[] {
  if (!Array.isArray(value)) {
    throw new Error("EXAM_EVALUATION_INPUT_INVALID");
  }
  return value.map((item) => {
    const record = asRecord(item);
    const answer = record.answer ?? record.choice;
    if (!isQuestionNo(record.questionNo) || !isChoice(answer)) {
      throw new Error("EXAM_EVALUATION_INPUT_INVALID");
    }
    return { questionNo: record.questionNo, answer };
  });
}

function parseAnswerKey(value: unknown): AnswerKeyItem[] {
  const questions = Array.isArray(value) ? value : asRecord(value).questions;
  if (!Array.isArray(questions)) {
    throw new Error("EXAM_EVALUATION_INPUT_INVALID");
  }
  return questions.map((item) => {
    const record = asRecord(item);
    if (
      !isQuestionNo(record.questionNo) ||
      !isChoice(record.correctAnswer) ||
      record.correctAnswer === "" ||
      typeof record.branch !== "string"
    ) {
      throw new Error("EXAM_EVALUATION_INPUT_INVALID");
    }
    return {
      questionNo: record.questionNo,
      correctAnswer: record.correctAnswer,
      branch: record.branch,
      ...(typeof record.outcomeCode === "string" && record.outcomeCode.trim() ? { outcomeCode: record.outcomeCode } : {}),
    };
  });
}

function parseScoringConfig(value: unknown, answerKeyVersion: string, computedAt: string): ScoringConfig {
  const record = value === null || value === undefined ? {} : asRecord(value);
  return {
    wrongPenalty: typeof record.wrongPenalty === "number" ? record.wrongPenalty : defaultWrongPenalty,
    rawScoreMultiplier: optionalNumber(record.rawScoreMultiplier),
    standardScoreBase: optionalNumber(record.standardScoreBase),
    standardScoreMultiplier: optionalNumber(record.standardScoreMultiplier),
    answerKeyVersion,
    engineVersion: scoringEngineVersion,
    computedAt,
  };
}

function parseScoringResult(value: unknown): ScoringResult {
  const score = typeof value === "string" ? JSON.parse(value) as unknown : value;
  const record = asRecord(score);
  if (!record.total || !Array.isArray(record.branches) || !record._meta) {
    throw new Error("EXAM_EVALUATION_RESULT_INVALID");
  }
  return score as ScoringResult;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("EXAM_EVALUATION_INPUT_INVALID");
  }
  return value as Record<string, unknown>;
}

function isChoice(value: unknown): value is Choice {
  return typeof value === "string" && choices.has(value as Choice);
}

function isQuestionNo(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}
