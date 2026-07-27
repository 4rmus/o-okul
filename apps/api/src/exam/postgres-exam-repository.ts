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
        `INSERT INTO "Exam" (
           "id", "tenantId", "gradeLevelId", "alanId", "examType", "examYear",
           "scoringProfileId", "linkedTytExamId", "title", "status", "startsAt", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'DRAFT', $10, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.gradeLevelId ?? null,
          input.alanId ?? null,
          input.examType ?? null,
          input.examYear ?? null,
          input.scoringProfileId ?? null,
          input.linkedTytExamId ?? null,
          input.title,
          input.startsAt ?? null,
        ],
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

  async hasScoringArtifacts(tenantId: string, examId: string): Promise<boolean> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<{ present: boolean }>(
        `SELECT (
           EXISTS (
             SELECT 1 FROM "AnswerKey"
             WHERE "tenantId" = $1 AND "examId" = $2 AND "deletedAt" IS NULL
           )
           OR EXISTS (
             SELECT 1 FROM "ExamResult"
             WHERE "tenantId" = $1 AND "examId" = $2
           )
           OR EXISTS (
             SELECT 1 FROM "ReportSnapshot"
             WHERE "tenantId" = $1 AND "examId" = $2 AND "deletedAt" IS NULL
           )
         ) AS "present"`,
        [tenantId, examId],
      );
      return result.rows[0]?.present === true;
    });
  }

  async update(tenantId: string, examId: string, input: UpdateExamRepositoryInput): Promise<ExamRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ExamRow>(
        `UPDATE "Exam"
         SET "title" = $3,
             "gradeLevelId" = $4,
             "alanId" = $5,
             "examType" = $6,
             "examYear" = $7,
             "scoringProfileId" = $8,
             "linkedTytExamId" = $9,
             "startsAt" = $10,
             "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL
         RETURNING *`,
        [
          tenantId,
          examId,
          input.title,
          input.gradeLevelId ?? null,
          input.alanId ?? null,
          input.examType ?? null,
          input.examYear ?? null,
          input.scoringProfileId ?? null,
          input.linkedTytExamId ?? null,
          input.startsAt ?? null,
        ],
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
  gradeLevelId: string | null;
  alanId: string | null;
  examType: string | null;
  examYear: number | null;
  scoringProfileId: string | null;
  linkedTytExamId: string | null;
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
    ...(row.gradeLevelId ? { gradeLevelId: row.gradeLevelId } : {}),
    ...(row.alanId ? { alanId: row.alanId } : {}),
    ...(row.examType ? { examType: row.examType } : {}),
    ...(row.examYear !== null ? { examYear: row.examYear } : {}),
    ...(row.scoringProfileId ? { scoringProfileId: row.scoringProfileId } : {}),
    ...(row.linkedTytExamId ? { linkedTytExamId: row.linkedTytExamId } : {}),
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
