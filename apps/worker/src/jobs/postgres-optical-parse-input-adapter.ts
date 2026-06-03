import { type TenantQueryable, withTenantDb } from "@uzman-hocam/db";
import type { ParserConfigSuggestion, ParserDelimiter } from "./format-analyzer-service.js";
import type { OpticalAnswerParticipant } from "./optical-answer-parser.js";

export interface LoadOpticalParseInput {
  tenantId: string;
  rawImportId: string;
}

export interface OpticalParseInputBundle {
  tenantId: string;
  examId: string;
  rawImportId: string;
  parserConfigVersion: string;
  s3Key: string;
  fileName: string;
  parserConfig: Pick<ParserConfigSuggestion, "delimiter" | "skipHeaderLines" | "fieldMapping">;
  participants: OpticalAnswerParticipant[];
}

export class PostgresOpticalParseInputAdapter {
  constructor(private readonly pool: TenantQueryable) {}

  async load(input: LoadOpticalParseInput): Promise<OpticalParseInputBundle> {
    if (!input.tenantId || !input.rawImportId) {
      throw new Error("OPTICAL_PARSE_INPUT_LOAD_INVALID");
    }

    return withTenantDb(this.pool, { tenantId: input.tenantId }, async (client) => {
      const rawImportResult = await client.query<RawImportParserConfigRow>(
        `SELECT
           ri."tenantId" AS "tenantId",
           ri."examId" AS "examId",
           ri."id" AS "rawImportId",
           ri."parserConfigVersion" AS "parserConfigVersion",
           ri."s3Key" AS "s3Key",
           ri."fileName" AS "fileName",
           pc."delimiter" AS "delimiter",
           pc."skipHeaderLines" AS "skipHeaderLines",
           pc."fieldMapping" AS "fieldMapping"
         FROM "RawImport" ri
         INNER JOIN "ParserConfig" pc
           ON pc."tenantId" = ri."tenantId"
          AND pc."examId" = ri."examId"
          AND pc."version" = ri."parserConfigVersion"
         WHERE ri."tenantId" = $1
           AND ri."id" = $2
           AND ri."deletedAt" IS NULL
           AND pc."status" = 'APPROVED'
           AND pc."deletedAt" IS NULL
         LIMIT 1`,
        [input.tenantId, input.rawImportId],
      );
      const row = rawImportResult.rows[0];
      if (!row) {
        throw new Error("OPTICAL_PARSE_INPUT_NOT_FOUND");
      }

      const participants = await client.query<ParticipantRow>(
        `SELECT
           ep."id" AS "participantId",
           s."studentNo" AS "studentNo",
           s."nationalIdHash" AS "nationalIdHash",
           ep."participantNo" AS "participantNo",
           ep."bookletType" AS "bookletType"
         FROM "ExamParticipant" ep
         INNER JOIN "Student" s
           ON s."tenantId" = ep."tenantId"
          AND s."id" = ep."studentId"
         WHERE ep."tenantId" = $1
           AND ep."examId" = $2
           AND ep."deletedAt" IS NULL
           AND s."deletedAt" IS NULL
           AND ep."status" IN ('REGISTERED', 'ATTENDED')`,
        [input.tenantId, row.examId],
      );

      return {
        tenantId: row.tenantId,
        examId: row.examId,
        rawImportId: row.rawImportId,
        parserConfigVersion: row.parserConfigVersion,
        s3Key: row.s3Key,
        fileName: row.fileName,
        parserConfig: {
          delimiter: parseDelimiter(row.delimiter),
          skipHeaderLines: row.skipHeaderLines,
          fieldMapping: parseFieldMapping(row.fieldMapping),
        },
        participants: participants.rows,
      };
    });
  }
}

interface RawImportParserConfigRow {
  tenantId: string;
  examId: string;
  rawImportId: string;
  parserConfigVersion: string;
  s3Key: string;
  fileName: string;
  delimiter: string;
  skipHeaderLines: number;
  fieldMapping: unknown;
}

interface ParticipantRow {
  participantId: string;
  studentNo: string | null;
  nationalIdHash: string | null;
  participantNo: string | null;
  bookletType: string | null;
}

function parseDelimiter(value: string): ParserDelimiter {
  if (value === "TAB" || value === "COMMA" || value === "PIPE" || value === "FIXED") {
    return value;
  }
  throw new Error("OPTICAL_PARSE_INPUT_INVALID");
}

function parseFieldMapping(value: unknown): ParserConfigSuggestion["fieldMapping"] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("OPTICAL_PARSE_INPUT_INVALID");
  }
  const record = parsed as Partial<ParserConfigSuggestion["fieldMapping"]>;
  if (!record.studentNo || !record.bookletType || !record.answers) {
    throw new Error("OPTICAL_PARSE_INPUT_INVALID");
  }
  assertFieldSpec(record.studentNo);
  if (record.nationalId) {
    assertFieldSpec(record.nationalId);
  }
  assertFieldSpec(record.bookletType);
  assertAnswerFieldSpec(record.answers);

  return record as ParserConfigSuggestion["fieldMapping"];
}

function assertFieldSpec(value: unknown): void {
  const record = asRecord(value);
  if (record.kind === "delimited") {
    if (!isNonNegativeInteger(record.column)) {
      throw new Error("OPTICAL_PARSE_INPUT_INVALID");
    }
    return;
  }
  if (record.kind === "fixed") {
    if (!isNonNegativeInteger(record.start) || !isPositiveInteger(record.length)) {
      throw new Error("OPTICAL_PARSE_INPUT_INVALID");
    }
    return;
  }
  throw new Error("OPTICAL_PARSE_INPUT_INVALID");
}

function assertAnswerFieldSpec(value: unknown): void {
  const record = asRecord(value);
  if (!isPositiveInteger(record.estimatedQuestionCount)) {
    throw new Error("OPTICAL_PARSE_INPUT_INVALID");
  }
  if (record.kind === "delimited") {
    if (!isNonNegativeInteger(record.column)) {
      throw new Error("OPTICAL_PARSE_INPUT_INVALID");
    }
    return;
  }
  if (record.kind === "fixed") {
    if (Array.isArray(record.segments)) {
      for (const segment of record.segments) {
        const segmentRecord = asRecord(segment);
        if (!isNonNegativeInteger(segmentRecord.start) || !isPositiveInteger(segmentRecord.length)) {
          throw new Error("OPTICAL_PARSE_INPUT_INVALID");
        }
      }
      return;
    }
    if (!isNonNegativeInteger(record.start) || !isPositiveInteger(record.length)) {
      throw new Error("OPTICAL_PARSE_INPUT_INVALID");
    }
    return;
  }
  throw new Error("OPTICAL_PARSE_INPUT_INVALID");
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("OPTICAL_PARSE_INPUT_INVALID");
  }
  return value as Record<string, unknown>;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}
