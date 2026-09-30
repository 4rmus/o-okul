import pg from "pg";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export const examWorkspaceProgressStoreToken = Symbol("ExamWorkspaceProgressStore");

// Sınav çalışma alanının optik → rapor ilerlemesi (Berrak §4). Yalnız sayım ve varlık döner; PII yok.
export interface ExamWorkspaceProgress {
  approvedLayout: boolean;
  latestRawImportId?: string;
  openQuarantineCount: number;
  matchedCount: number;
  evaluatedCount: number;
  readyReport: boolean;
}

export interface ExamWorkspaceProgressStore {
  load(tenantId: string, examId: string): Promise<ExamWorkspaceProgress>;
}

export class PostgresExamWorkspaceProgressStore implements ExamWorkspaceProgressStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async load(tenantId: string, examId: string): Promise<ExamWorkspaceProgress> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ProgressRow>(
        `WITH latest_import AS (
           SELECT "id"
           FROM "RawImport"
           WHERE "tenantId" = $1 AND "examId" = $2 AND "deletedAt" IS NULL
           ORDER BY "createdAt" DESC, "id" DESC
           LIMIT 1
         )
         SELECT
           EXISTS (
             SELECT 1 FROM "ParserConfig"
             WHERE "tenantId" = $1 AND "examId" = $2 AND "status" = 'APPROVED' AND "deletedAt" IS NULL
           ) AS "approvedLayout",
           (SELECT "id" FROM latest_import) AS "latestRawImportId",
           (SELECT COUNT(*)::int FROM "ImportQuarantine"
             WHERE "tenantId" = $1 AND "examId" = $2 AND "status" = 'OPEN' AND "deletedAt" IS NULL) AS "openQuarantineCount",
           (SELECT COUNT(*)::int FROM "ParsedAnswer"
             WHERE "tenantId" = $1 AND "examId" = $2 AND "status" = 'MATCHED' AND "deletedAt" IS NULL
               AND "rawImportId" = (SELECT "id" FROM latest_import)) AS "matchedCount",
           (SELECT COUNT(*)::int FROM "ExamResult"
             WHERE "tenantId" = $1 AND "examId" = $2 AND "deletedAt" IS NULL
               AND "rawImportId" = (SELECT "id" FROM latest_import)) AS "evaluatedCount",
           EXISTS (
             SELECT 1 FROM "ReportSnapshot"
             WHERE "tenantId" = $1 AND "examId" = $2 AND "status" = 'READY' AND "deletedAt" IS NULL
           ) AS "readyReport"`,
        [tenantId, examId],
      );
      const row = result.rows[0];
      return {
        approvedLayout: Boolean(row?.approvedLayout),
        ...(row?.latestRawImportId ? { latestRawImportId: row.latestRawImportId } : {}),
        openQuarantineCount: Number(row?.openQuarantineCount ?? 0),
        matchedCount: Number(row?.matchedCount ?? 0),
        evaluatedCount: Number(row?.evaluatedCount ?? 0),
        readyReport: Boolean(row?.readyReport),
      };
    });
  }
}

export function createExamWorkspaceProgressStore(): ExamWorkspaceProgressStore {
  return new PostgresExamWorkspaceProgressStore();
}

interface ProgressRow {
  approvedLayout: boolean;
  latestRawImportId: string | null;
  openQuarantineCount: number;
  matchedCount: number;
  evaluatedCount: number;
  readyReport: boolean;
}
