import { randomUUID } from "node:crypto";
import pg from "pg";
import type { ExamRecord } from "@uzman-hocam/shared-types";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { CreateExamRepositoryInput, ExamRepository } from "./exam.service.js";

export class PostgresExamRepository implements ExamRepository {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async create(input: CreateExamRepositoryInput): Promise<ExamRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const inserted = await client.query<ExamRow>(
        `INSERT INTO "Exam" ("id", "tenantId", "title", "status", "startsAt", "updatedAt")
         VALUES ($1, $2, $3, 'DRAFT', $4, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.title, input.startsAt ?? null],
      );
      return toExamRecord(inserted.rows[0]!);
    });
  }

  async list(tenantId: string): Promise<ExamRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ExamRow>(
        `SELECT * FROM "Exam"
         WHERE "tenantId" = $1 AND "deletedAt" IS NULL
         ORDER BY "createdAt" DESC`,
        [tenantId],
      );
      return result.rows.map(toExamRecord);
    });
  }

  async findById(tenantId: string, examId: string): Promise<ExamRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ExamRow>(
        `SELECT * FROM "Exam"
         WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, examId],
      );
      const row = result.rows[0];
      return row ? toExamRecord(row) : undefined;
    });
  }

  async publish(tenantId: string, examId: string): Promise<ExamRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ExamRow>(
        `UPDATE "Exam"
         SET "status" = 'PUBLISHED', "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
         RETURNING *`,
        [tenantId, examId],
      );
      const row = result.rows[0];
      return row ? toExamRecord(row) : undefined;
    });
  }
}

interface ExamRow {
  id: string;
  tenantId: string;
  title: string;
  status: string;
  startsAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toExamRecord(row: ExamRow): ExamRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    title: row.title,
    status: row.status,
    ...(row.startsAt ? { startsAt: toIso(row.startsAt) } : {}),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function toIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}
