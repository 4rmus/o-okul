import pg from "pg";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export const rawImportQuarantineStoreToken = Symbol("RawImportQuarantineStore");

export interface ImportQuarantineRecord {
  id: string;
  tenantId: string;
  examId: string;
  rawImportId: string;
  rowNumber: number;
  rawRow: Record<string, unknown>;
  reason: string;
  status: string;
  resolvedStudentId?: string;
  resolvedParticipantId?: string;
  answerKeyId?: string;
  rawImportSha256?: string;
  createdAt: string;
  updatedAt: string;
}

export interface RawImportQuarantineStore {
  countOpenByTenant(tenantId: string): Promise<number>;
  listByRawImport(tenantId: string, examId: string, rawImportId: string): Promise<ImportQuarantineRecord[]>;
  resolve(input: {
    tenantId: string;
    examId: string;
    rawImportId: string;
    quarantineId: string;
    resolvedStudentId: string;
  }): Promise<ImportQuarantineRecord | undefined>;
  markResolved(input: {
    tenantId: string;
    examId: string;
    rawImportId: string;
    quarantineId: string;
    resolvedStudentId: string;
  }): Promise<ImportQuarantineRecord | undefined>;
}

export class PostgresRawImportQuarantineStore implements RawImportQuarantineStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async countOpenByTenant(tenantId: string): Promise<number> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count
         FROM "ImportQuarantine"
         WHERE "tenantId" = $1
           AND "status" = 'OPEN'
           AND "deletedAt" IS NULL`,
        [tenantId],
      );
      return Number(result.rows[0]?.count ?? 0);
    });
  }

  async listByRawImport(tenantId: string, examId: string, rawImportId: string): Promise<ImportQuarantineRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ImportQuarantineRow>(
        `SELECT *
         FROM "ImportQuarantine"
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "rawImportId" = $3
           AND "deletedAt" IS NULL
         ORDER BY "rowNumber" ASC`,
        [tenantId, examId, rawImportId],
      );
      return result.rows.map(toRecord);
    });
  }

  async resolve(input: {
    tenantId: string;
    examId: string;
    rawImportId: string;
    quarantineId: string;
    resolvedStudentId: string;
  }): Promise<ImportQuarantineRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ImportQuarantineRow>(
        `WITH candidate AS (
           SELECT *
           FROM "ImportQuarantine"
           WHERE "tenantId" = $1
             AND "examId" = $2
             AND "rawImportId" = $3
             AND "id" = $4
             AND "status" = 'OPEN'
             AND "deletedAt" IS NULL
             AND EXISTS (
               SELECT 1
               FROM "Student"
               WHERE "Student"."tenantId" = $1
                 AND "Student"."id" = $5
                 AND "Student"."deletedAt" IS NULL
             )
         )
         SELECT
           candidate.*,
           ep."id" AS "resolvedParticipantId",
           ak."id" AS "answerKeyId",
           ri."sha256" AS "rawImportSha256"
         FROM candidate
         INNER JOIN "ExamParticipant" ep
           ON ep."tenantId" = candidate."tenantId"
          AND ep."examId" = candidate."examId"
          AND ep."studentId" = $5
          AND ep."deletedAt" IS NULL
         INNER JOIN "RawImport" ri
           ON ri."tenantId" = candidate."tenantId"
          AND ri."examId" = candidate."examId"
          AND ri."id" = candidate."rawImportId"
          AND ri."deletedAt" IS NULL
         INNER JOIN LATERAL (
           SELECT "id"
           FROM "AnswerKey"
           WHERE "tenantId" = candidate."tenantId"
             AND "examId" = candidate."examId"
             AND "deletedAt" IS NULL
           ORDER BY "publishedAt" DESC NULLS LAST, "updatedAt" DESC
           LIMIT 1
         ) ak ON TRUE`,
        [input.tenantId, input.examId, input.rawImportId, input.quarantineId, input.resolvedStudentId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : undefined;
    });
  }

  async markResolved(input: {
    tenantId: string;
    examId: string;
    rawImportId: string;
    quarantineId: string;
    resolvedStudentId: string;
  }): Promise<ImportQuarantineRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ImportQuarantineRow>(
        `UPDATE "ImportQuarantine"
         SET "status" = 'RESOLVED',
             "resolvedStudentId" = $5,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "rawImportId" = $3
           AND "id" = $4
           AND "status" = 'OPEN'
           AND "deletedAt" IS NULL
         RETURNING *`,
        [input.tenantId, input.examId, input.rawImportId, input.quarantineId, input.resolvedStudentId],
      );
      return result.rows[0] ? toRecord(result.rows[0]) : undefined;
    });
  }
}

export function createRawImportQuarantineStore(): RawImportQuarantineStore {
  return new PostgresRawImportQuarantineStore();
}

interface ImportQuarantineRow {
  id: string;
  tenantId: string;
  examId: string;
  rawImportId: string;
  rowNumber: number;
  rawRow: unknown;
  reason: string;
  status: string;
  resolvedStudentId: string | null;
  resolvedParticipantId?: string | null;
  answerKeyId?: string | null;
  rawImportSha256?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toRecord(row: ImportQuarantineRow): ImportQuarantineRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    examId: row.examId,
    rawImportId: row.rawImportId,
    rowNumber: row.rowNumber,
    rawRow: parseJsonObject(row.rawRow),
    reason: row.reason,
    status: row.status,
    ...(row.resolvedStudentId ? { resolvedStudentId: row.resolvedStudentId } : {}),
    ...(row.resolvedParticipantId ? { resolvedParticipantId: row.resolvedParticipantId } : {}),
    ...(row.answerKeyId ? { answerKeyId: row.answerKeyId } : {}),
    ...(row.rawImportSha256 ? { rawImportSha256: row.rawImportSha256 } : {}),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("IMPORT_QUARANTINE_RAW_ROW_INVALID");
  }
  return parsed as Record<string, unknown>;
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
