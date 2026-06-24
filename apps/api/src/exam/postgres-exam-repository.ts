import { randomUUID } from "node:crypto";
import pg from "pg";
import type { ExamRecord } from "@o-okul/shared-types";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { CreateExamRepositoryInput, ExamRepository, UpdateExamRepositoryInput } from "./exam.service.js";

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

  async update(tenantId: string, examId: string, input: UpdateExamRepositoryInput): Promise<ExamRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ExamRow>(
        `UPDATE "Exam"
         SET "title" = $3, "startsAt" = $4, "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
         RETURNING *`,
        [tenantId, examId, input.title, input.startsAt ?? null],
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

  async delete(tenantId: string, examId: string): Promise<ExamRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const examResult = await client.query<ExamRow>(
        `SELECT * FROM "Exam"
         WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, examId],
      );
      const exam = examResult.rows[0];
      if (!exam) {
        return undefined;
      }

      await client.query(`DELETE FROM "ReportSnapshot" WHERE "tenantId" = $1 AND "examId" = $2`, [tenantId, examId]);
      await client.query(`DELETE FROM "ExamResult" WHERE "tenantId" = $1 AND "examId" = $2`, [tenantId, examId]);
      await client.query(`DELETE FROM "ParsedAnswer" WHERE "tenantId" = $1 AND "examId" = $2`, [tenantId, examId]);
      await client.query(`DELETE FROM "ImportQuarantine" WHERE "tenantId" = $1 AND "examId" = $2`, [tenantId, examId]);
      await client.query(`DELETE FROM "ExamBookletVariant" WHERE "tenantId" = $1 AND "examId" = $2`, [tenantId, examId]);
      await client.query(`DELETE FROM "AnswerKey" WHERE "tenantId" = $1 AND "examId" = $2`, [tenantId, examId]);
      await client.query(`DELETE FROM "RawImport" WHERE "tenantId" = $1 AND "examId" = $2`, [tenantId, examId]);
      await client.query(`DELETE FROM "ParserConfig" WHERE "tenantId" = $1 AND "examId" = $2`, [tenantId, examId]);
      await client.query(`DELETE FROM "ExamParticipant" WHERE "tenantId" = $1 AND "examId" = $2`, [tenantId, examId]);
      await client.query(`DELETE FROM "Exam" WHERE "tenantId" = $1 AND "id" = $2`, [tenantId, examId]);

      return toExamRecord(exam);
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
