import pg from "pg";
import { randomUUID } from "node:crypto";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { CreatedRawImport, CreateRawImportInput, RawImportRepository } from "./raw-import-upload.service.js";

export class PostgresRawImportRepository implements RawImportRepository {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async create(input: CreateRawImportInput): Promise<CreatedRawImport> {
    const rawImportId = randomUUID();
    return withTenantQuery(this.pool, async (client) => {
      const inserted = await client.query<RawImportRow>(
        `INSERT INTO "RawImport" (
           "id",
           "tenantId",
           "examId",
           "sourceType",
           "fileName",
           "s3Key",
           "sha256",
           "parserConfigVersion",
           "metadata",
           "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())
         ON CONFLICT ("tenantId", "examId", "sha256", "parserConfigVersion")
         DO NOTHING
         RETURNING *`,
        [
          rawImportId,
          input.tenantId,
          input.examId,
          input.sourceType,
          input.fileName,
          input.s3Key,
          input.sha256,
          input.parserConfigVersion,
          input.metadata ? JSON.stringify(input.metadata) : null,
        ],
      );
      const row = inserted.rows[0] ?? await findExisting(client, input);
      if (!row) {
        throw new Error("RAW_IMPORT_CREATE_FAILED");
      }
      return toCreatedRawImport(row);
    });
  }
}

interface RawImportRow {
  id: string;
  tenantId: string;
  examId: string;
  sourceType: string;
  fileName: string;
  s3Key: string;
  sha256: string;
  parserConfigVersion: string;
  metadata: unknown;
}

async function findExisting(
  client: { query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> },
  input: CreateRawImportInput,
): Promise<RawImportRow | undefined> {
  const existing = await client.query<RawImportRow>(
    `SELECT *
       FROM "RawImport"
      WHERE "tenantId" = $1
        AND "examId" = $2
        AND "sha256" = $3
        AND "parserConfigVersion" = $4
      LIMIT 1`,
    [
      input.tenantId,
      input.examId,
      input.sha256,
      input.parserConfigVersion,
    ],
  );
  return existing.rows[0];
}

function toCreatedRawImport(row: RawImportRow): CreatedRawImport {
  return {
    id: row.id,
    tenantId: row.tenantId,
    examId: row.examId,
    sourceType: row.sourceType,
    fileName: row.fileName,
    s3Key: row.s3Key,
    sha256: row.sha256,
    parserConfigVersion: row.parserConfigVersion,
    metadata: parseMetadata(row.metadata),
  };
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    const parsed = JSON.parse(value) as unknown;
    return parseMetadata(parsed);
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("RAW_IMPORT_METADATA_INVALID");
}
