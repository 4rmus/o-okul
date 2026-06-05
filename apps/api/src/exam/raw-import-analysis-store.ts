import pg from "pg";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export const rawImportAnalysisStoreToken = Symbol("RawImportAnalysisStore");

export interface RawImportParseSummary {
  tenantId: string;
  examId: string;
  rawImportId: string;
  matchedCount: number;
  quarantinedCount: number;
  totalRows: number;
  quarantineReasons: Array<{ reason: string; count: number }>;
}

export interface RawImportEvaluationInput {
  parsedAnswerId: string;
  participantId: string;
  rawImportId: string;
  rawImportSha256: string;
  answerKeyId: string;
}

export interface RawImportAnalysisStore {
  getSummary(tenantId: string, examId: string, rawImportId: string): Promise<RawImportParseSummary | undefined>;
  listMatchedForEvaluation(input: {
    tenantId: string;
    examId: string;
    rawImportId: string;
    answerKeyId?: string;
  }): Promise<RawImportEvaluationInput[]>;
}

export class PostgresRawImportAnalysisStore implements RawImportAnalysisStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async getSummary(tenantId: string, examId: string, rawImportId: string): Promise<RawImportParseSummary | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<RawImportSummaryRow>(
        `WITH matched AS (
           SELECT COUNT(*)::int AS count
           FROM "ParsedAnswer"
           WHERE "tenantId" = $1
             AND "examId" = $2
             AND "rawImportId" = $3
             AND "status" = 'MATCHED'
             AND "deletedAt" IS NULL
         ),
         quarantined AS (
           SELECT "reason", COUNT(*)::int AS count
           FROM "ImportQuarantine"
           WHERE "tenantId" = $1
             AND "examId" = $2
             AND "rawImportId" = $3
             AND "deletedAt" IS NULL
           GROUP BY "reason"
         )
         SELECT
           ri."tenantId",
           ri."examId",
           ri."id" AS "rawImportId",
           COALESCE((SELECT count FROM matched), 0)::int AS "matchedCount",
           COALESCE((SELECT SUM(count)::int FROM quarantined), 0)::int AS "quarantinedCount",
           COALESCE(
             (SELECT jsonb_agg(jsonb_build_object('reason', "reason", 'count', count) ORDER BY "reason") FROM quarantined),
             '[]'::jsonb
           ) AS "quarantineReasons"
         FROM "RawImport" ri
         WHERE ri."tenantId" = $1
           AND ri."examId" = $2
           AND ri."id" = $3
           AND ri."deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, examId, rawImportId],
      );
      return result.rows[0] ? toSummary(result.rows[0]) : undefined;
    });
  }

  async listMatchedForEvaluation(input: {
    tenantId: string;
    examId: string;
    rawImportId: string;
    answerKeyId?: string;
  }): Promise<RawImportEvaluationInput[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<RawImportEvaluationRow>(
        `WITH selected_answer_key AS (
           SELECT "id"
           FROM "AnswerKey"
           WHERE "tenantId" = $1
             AND "examId" = $2
             AND ($4::text IS NULL OR "id" = $4)
             AND "deletedAt" IS NULL
           ORDER BY
             CASE WHEN $4::text IS NOT NULL AND "id" = $4 THEN 0 ELSE 1 END,
             "publishedAt" DESC NULLS LAST,
             "updatedAt" DESC
           LIMIT 1
         )
         SELECT
           pa."id" AS "parsedAnswerId",
           pa."participantId",
           pa."rawImportId",
           ri."sha256" AS "rawImportSha256",
           ak."id" AS "answerKeyId"
         FROM "ParsedAnswer" pa
         INNER JOIN "RawImport" ri
           ON ri."tenantId" = pa."tenantId"
          AND ri."examId" = pa."examId"
          AND ri."id" = pa."rawImportId"
          AND ri."deletedAt" IS NULL
         CROSS JOIN selected_answer_key ak
         WHERE pa."tenantId" = $1
           AND pa."examId" = $2
           AND pa."rawImportId" = $3
           AND pa."status" = 'MATCHED'
           AND pa."deletedAt" IS NULL
         ORDER BY pa."rowNumber" ASC, pa."id" ASC`,
        [input.tenantId, input.examId, input.rawImportId, input.answerKeyId ?? null],
      );
      return result.rows.map((row) => ({
        parsedAnswerId: row.parsedAnswerId,
        participantId: row.participantId,
        rawImportId: row.rawImportId,
        rawImportSha256: row.rawImportSha256,
        answerKeyId: row.answerKeyId,
      }));
    });
  }
}

export function createRawImportAnalysisStore(): RawImportAnalysisStore {
  return new PostgresRawImportAnalysisStore();
}

interface RawImportSummaryRow {
  tenantId: string;
  examId: string;
  rawImportId: string;
  matchedCount: number;
  quarantinedCount: number;
  quarantineReasons: unknown;
}

interface RawImportEvaluationRow {
  parsedAnswerId: string;
  participantId: string;
  rawImportId: string;
  rawImportSha256: string;
  answerKeyId: string;
}

function toSummary(row: RawImportSummaryRow): RawImportParseSummary {
  const quarantineReasons = parseReasons(row.quarantineReasons);
  return {
    tenantId: row.tenantId,
    examId: row.examId,
    rawImportId: row.rawImportId,
    matchedCount: row.matchedCount,
    quarantinedCount: row.quarantinedCount,
    totalRows: row.matchedCount + row.quarantinedCount,
    quarantineReasons,
  };
}

function parseReasons(value: unknown): Array<{ reason: string; count: number }> {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) {
    throw new Error("RAW_IMPORT_SUMMARY_REASONS_INVALID");
  }
  return parsed.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error("RAW_IMPORT_SUMMARY_REASONS_INVALID");
    }
    const record = item as Record<string, unknown>;
    if (typeof record.reason !== "string" || typeof record.count !== "number") {
      throw new Error("RAW_IMPORT_SUMMARY_REASONS_INVALID");
    }
    return { reason: record.reason, count: record.count };
  });
}
