import { randomUUID } from "node:crypto";
import pg from "pg";
import type {
  AnswerKeyItemInput,
  AnswerKeyRecord,
  AnswerKeyScoringConfig,
} from "@uzman-hocam/shared-types";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import {
  summarizeAnswerKeyQuestions,
  type AnswerKeyRepository,
  type SaveAnswerKeyInput,
} from "./answer-key.service.js";

export class PostgresAnswerKeyRepository implements AnswerKeyRepository {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async create(input: SaveAnswerKeyInput): Promise<AnswerKeyRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const inserted = await client.query<AnswerKeyRow>(
        `INSERT INTO "AnswerKey" (
           "id",
           "tenantId",
           "examId",
           "version",
           "keyData",
           "scoringConfig",
           "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, now())
         ON CONFLICT ("tenantId", "examId", "version") DO NOTHING
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.examId,
          input.version,
          JSON.stringify({ questions: input.questions }),
          JSON.stringify(input.scoringConfig),
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new Error("ANSWER_KEY_VERSION_CONFLICT");
      }
      for (const variant of input.bookletVariants ?? []) {
        await client.query(
          `INSERT INTO "ExamBookletVariant" (
             "id",
             "tenantId",
             "examId",
             "code",
             "permutation",
             "updatedAt"
           )
           VALUES ($1, $2, $3, $4, $5::jsonb, now())
           ON CONFLICT ("tenantId", "examId", "code")
           DO UPDATE SET "permutation" = EXCLUDED."permutation", "deletedAt" = NULL, "updatedAt" = now()`,
          [
            randomUUID(),
            input.tenantId,
            input.examId,
            variant.code,
            JSON.stringify(variant.permutation),
          ],
        );
      }
      return toAnswerKeyRecord(row);
    });
  }

  async list(tenantId: string, examId: string): Promise<AnswerKeyRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AnswerKeyRow>(
        `SELECT *
         FROM "AnswerKey"
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "deletedAt" IS NULL
         ORDER BY "createdAt" DESC`,
        [tenantId, examId],
      );
      return result.rows.map(toAnswerKeyRecord);
    });
  }

  async publish(tenantId: string, examId: string, version: string): Promise<AnswerKeyRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AnswerKeyRow>(
        `UPDATE "AnswerKey"
         SET "publishedAt" = COALESCE("publishedAt", now()), "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "version" = $3
           AND "deletedAt" IS NULL
         RETURNING *`,
        [tenantId, examId, version],
      );
      const row = result.rows[0];
      return row ? toAnswerKeyRecord(row) : undefined;
    });
  }
}

interface AnswerKeyRow {
  id: string;
  tenantId: string;
  examId: string;
  version: string;
  keyData: unknown;
  scoringConfig: unknown;
  publishedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toAnswerKeyRecord(row: AnswerKeyRow): AnswerKeyRecord {
  const questions = parseQuestions(row.keyData);
  const summary = summarizeAnswerKeyQuestions(questions);
  const scoringConfig = parseScoringConfig(row.scoringConfig);
  return {
    id: row.id,
    tenantId: row.tenantId,
    examId: row.examId,
    version: row.version,
    questionCount: summary.questionCount,
    branches: summary.branches,
    scoringConfig,
    status: row.publishedAt ? "PUBLISHED" : "DRAFT",
    ...(row.publishedAt ? { publishedAt: toIso(row.publishedAt) } : {}),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

function parseQuestions(value: unknown): AnswerKeyItemInput[] {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  const questions = Array.isArray(parsed) ? parsed : asRecord(parsed).questions;
  if (!Array.isArray(questions)) {
    throw new Error("ANSWER_KEY_DATA_INVALID");
  }
  return questions as AnswerKeyItemInput[];
}

function parseScoringConfig(value: unknown): AnswerKeyScoringConfig {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  const record = parsed === null || parsed === undefined ? {} : asRecord(parsed);
  return {
    wrongPenalty: typeof record.wrongPenalty === "number" ? record.wrongPenalty : 0.25,
    ...(typeof record.rawScoreMultiplier === "number" ? { rawScoreMultiplier: record.rawScoreMultiplier } : {}),
    ...(typeof record.standardScoreBase === "number" ? { standardScoreBase: record.standardScoreBase } : {}),
    ...(typeof record.standardScoreMultiplier === "number" ? { standardScoreMultiplier: record.standardScoreMultiplier } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ANSWER_KEY_DATA_INVALID");
  }
  return value as Record<string, unknown>;
}

function toIso(value: Date | string): string {
  return typeof value === "string" ? value : value.toISOString();
}
