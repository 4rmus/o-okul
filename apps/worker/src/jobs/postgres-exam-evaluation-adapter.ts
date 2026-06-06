import { randomUUID } from "node:crypto";
import { type Queryable, type TenantQueryable, withTenantDb } from "@uzman-hocam/db";
import type { ParserConfigSuggestion, ParserDelimiter } from "./format-analyzer-service.js";
import {
  type ExamEvaluationJobAdapter,
  type ExamEvaluationJobInput,
  type ExamEvaluationJobResult,
  type ExamEvaluationScoringInput,
} from "./exam-evaluation-job.js";
import type { ExamBookletVariantInput } from "./booklet-alignment.js";
import { OpticalAnswerParser } from "./optical-answer-parser.js";
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
      let row = await findEvaluationInput(client, input);
      if (!row) {
        await materializeResolvedQuarantineParsedAnswer(client, input);
        row = await findEvaluationInput(client, input);
      }
      if (!row) {
        throw new Error("EXAM_EVALUATION_INPUT_NOT_FOUND");
      }
      const variants = await client.query<ExamBookletVariantRow>(
        `SELECT "code", "permutation"
         FROM "ExamBookletVariant"
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "deletedAt" IS NULL
         ORDER BY "code" ASC`,
        [input.tenantId, row.examId],
      );

      return {
        examId: row.examId,
        studentId: row.studentId,
        parserConfigVersion: row.parserConfigVersion,
        bookletType: row.bookletType,
        answers: parseStudentAnswers(row.answers),
        bookletVariants: variants.rows.map(toExamBookletVariant),
        answerKey: parseAnswerKey(row.keyData),
        scoringConfig: parseScoringConfig(row.scoringConfig, row.answerKeyVersion, this.now()),
      };
    });
  }

  async saveResult(result: ExamEvaluationJobResult): Promise<ExamEvaluationJobResult> {
    return withTenantDb(this.pool, { tenantId: result.tenantId }, async (client) => {
      const inserted = await client.query<ExamResultRow>(
        `INSERT INTO "ExamResult" (
           "id",
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
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, now())
         ON CONFLICT ("tenantId", "resultKey")
         DO UPDATE SET
           "examId" = EXCLUDED."examId",
           "studentId" = EXCLUDED."studentId",
           "participantId" = EXCLUDED."participantId",
           "rawImportId" = EXCLUDED."rawImportId",
           "answerKeyId" = EXCLUDED."answerKeyId",
           "answerKeyVersion" = EXCLUDED."answerKeyVersion",
           "parserConfigVersion" = EXCLUDED."parserConfigVersion",
           "engineVersion" = EXCLUDED."engineVersion",
           "scoreData" = EXCLUDED."scoreData",
           "computedAt" = EXCLUDED."computedAt",
           "deletedAt" = NULL,
           "updatedAt" = now()
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

async function findEvaluationInput(
  client: Queryable,
  input: ExamEvaluationJobInput,
): Promise<ExamEvaluationInputRow | undefined> {
  const result = await client.query<ExamEvaluationInputRow>(
    `SELECT
           pa."examId" AS "examId",
           ep."studentId" AS "studentId",
           ep."bookletType" AS "bookletType",
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
  return result.rows[0];
}

async function materializeResolvedQuarantineParsedAnswer(
  client: Queryable,
  input: ExamEvaluationJobInput,
): Promise<void> {
  const result = await client.query<ResolvedQuarantineInputRow>(
    `SELECT
       q."tenantId" AS "tenantId",
       q."examId" AS "examId",
       q."rawImportId" AS "rawImportId",
       q."rowNumber" AS "rowNumber",
       q."rawRow" AS "rawRow",
       ri."parserConfigVersion" AS "parserConfigVersion",
       pc."delimiter" AS "delimiter",
       pc."skipHeaderLines" AS "skipHeaderLines",
       pc."fieldMapping" AS "fieldMapping"
     FROM "ImportQuarantine" q
     INNER JOIN "RawImport" ri
       ON ri."tenantId" = q."tenantId"
      AND ri."examId" = q."examId"
      AND ri."id" = q."rawImportId"
     INNER JOIN "ParserConfig" pc
       ON pc."tenantId" = ri."tenantId"
      AND pc."examId" = ri."examId"
      AND pc."version" = ri."parserConfigVersion"
     INNER JOIN "ExamParticipant" ep
       ON ep."tenantId" = q."tenantId"
      AND ep."examId" = q."examId"
      AND ep."studentId" = q."resolvedStudentId"
     WHERE q."tenantId" = $1
       AND q."rawImportId" = $2
       AND ep."id" = $3
       AND q."status" = 'RESOLVED'
       AND q."deletedAt" IS NULL
       AND ri."deletedAt" IS NULL
       AND pc."status" = 'APPROVED'
       AND pc."deletedAt" IS NULL
       AND ep."deletedAt" IS NULL
     ORDER BY q."updatedAt" DESC
     LIMIT 1`,
    [input.tenantId, input.rawImportId, input.participantId],
  );
  const row = result.rows[0];
  if (!row) return;

  const rawRow = parseJsonObject(row.rawRow);
  const line = rawRow.line;
  if (typeof line !== "string") {
    throw new Error("EXAM_EVALUATION_RESOLVED_QUARANTINE_INVALID");
  }

  const parsed = new OpticalAnswerParser().parseResolvedQuarantine({
    tenantId: row.tenantId,
    examId: row.examId,
    rawImportId: row.rawImportId,
    parserConfigVersion: row.parserConfigVersion,
    line,
    rowNumber: row.rowNumber,
    parserConfig: {
      delimiter: parseDelimiter(row.delimiter),
      skipHeaderLines: row.skipHeaderLines,
      fieldMapping: parseFieldMapping(row.fieldMapping),
    },
    participantId: input.participantId,
  });

  await client.query(
    `INSERT INTO "ParsedAnswer" (
       "id",
       "tenantId",
       "examId",
       "rawImportId",
       "participantId",
       "parserConfigVersion",
       "rowNumber",
       "answers",
       "status",
       "updatedAt"
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'MATCHED', now())
     ON CONFLICT ("tenantId", "rawImportId", "participantId", "parserConfigVersion")
     DO UPDATE SET
       "rowNumber" = EXCLUDED."rowNumber",
       "answers" = EXCLUDED."answers",
       "status" = 'MATCHED',
       "deletedAt" = NULL,
       "updatedAt" = now()`,
    [
      randomUUID(),
      parsed.tenantId,
      parsed.examId,
      parsed.rawImportId,
      parsed.participantId,
      parsed.parserConfigVersion,
      parsed.rowNumber,
      JSON.stringify(parsed.answers),
    ],
  );
}

interface ResolvedQuarantineInputRow {
  tenantId: string;
  examId: string;
  rawImportId: string;
  rowNumber: number;
  rawRow: unknown;
  parserConfigVersion: string;
  delimiter: string;
  skipHeaderLines: number;
  fieldMapping: unknown;
}

interface ExamEvaluationInputRow {
  examId: string;
  studentId: string;
  bookletType: string | null;
  parserConfigVersion: string;
  answers: unknown;
  keyData: unknown;
  scoringConfig: unknown;
  answerKeyVersion: string;
}

interface ExamBookletVariantRow {
  code: string;
  permutation: unknown;
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
    randomUUID(),
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
      ...(typeof record.topic === "string" && record.topic.trim() ? { topic: record.topic } : {}),
    };
  });
}

function toExamBookletVariant(row: ExamBookletVariantRow): ExamBookletVariantInput {
  const parsed = typeof row.permutation === "string" ? JSON.parse(row.permutation) as unknown : row.permutation;
  if (!Array.isArray(parsed)) {
    throw new Error("EXAM_EVALUATION_INPUT_INVALID");
  }
  return {
    code: row.code,
    permutation: parsed.map((value) => {
      if (!isQuestionNo(value)) {
        throw new Error("EXAM_EVALUATION_INPUT_INVALID");
      }
      return value;
    }),
  };
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

function parseDelimiter(value: string): ParserDelimiter {
  if (value === "TAB" || value === "COMMA" || value === "PIPE" || value === "FIXED") {
    return value;
  }
  throw new Error("EXAM_EVALUATION_RESOLVED_QUARANTINE_INVALID");
}

function parseFieldMapping(value: unknown): ParserConfigSuggestion["fieldMapping"] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("EXAM_EVALUATION_RESOLVED_QUARANTINE_INVALID");
  }
  const record = parsed as Partial<ParserConfigSuggestion["fieldMapping"]>;
  if (!record.studentNo || !record.bookletType || !record.answers) {
    throw new Error("EXAM_EVALUATION_RESOLVED_QUARANTINE_INVALID");
  }
  return record as ParserConfigSuggestion["fieldMapping"];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("EXAM_EVALUATION_RESOLVED_QUARANTINE_INVALID");
  }
  return parsed as Record<string, unknown>;
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
