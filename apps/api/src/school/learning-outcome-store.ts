import { randomUUID } from "node:crypto";
import type { LearningOutcomeRecord as SharedLearningOutcomeRecord } from "@uzman-hocam/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface LearningOutcomeRecord extends SharedLearningOutcomeRecord {
  deletedAt?: string;
}

export interface LearningOutcomeStore {
  list(): Promise<LearningOutcomeRecord[]>;
  findById(id: string): Promise<LearningOutcomeRecord | undefined>;
  create(input: Omit<LearningOutcomeRecord, "id">): Promise<LearningOutcomeRecord>;
  update(id: string, input: Partial<Pick<LearningOutcomeRecord, "code" | "branch" | "title" | "level">>): Promise<LearningOutcomeRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<LearningOutcomeRecord | undefined>;
}

export const learningOutcomeStoreToken = Symbol("LearningOutcomeStore");

const demoLearningOutcomes: LearningOutcomeRecord[] = [
  {
    id: "learning-outcome-demo-math",
    tenantId: "tenant-a",
    code: "MAT.8.1.1",
    branch: "Matematik",
    title: "Çarpanlar ve katlar",
    level: "8",
  },
];

export class InMemoryLearningOutcomeStore implements LearningOutcomeStore {
  private readonly outcomes = demoLearningOutcomes.map((record) => ({ ...record }));

  async list(): Promise<LearningOutcomeRecord[]> {
    return this.outcomes;
  }

  async findById(id: string): Promise<LearningOutcomeRecord | undefined> {
    return this.outcomes.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<LearningOutcomeRecord, "id">): Promise<LearningOutcomeRecord> {
    const record = {
      id: `learning-outcome-${this.outcomes.length + 1}`,
      ...input,
    };
    this.outcomes.push(record);
    return record;
  }

  async update(
    id: string,
    input: Partial<Pick<LearningOutcomeRecord, "code" | "branch" | "title" | "level">>,
  ): Promise<LearningOutcomeRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.code !== undefined) record.code = input.code;
    if (input.branch !== undefined) record.branch = input.branch;
    if (input.title !== undefined) record.title = input.title;
    if (input.level !== undefined) record.level = input.level;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<LearningOutcomeRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }
}

export class PostgresLearningOutcomeStore implements LearningOutcomeStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<LearningOutcomeRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<LearningOutcomeRow>(`SELECT * FROM "LearningOutcome"`);
      return result.rows.map(toLearningOutcomeRecord);
    });
  }

  async findById(id: string): Promise<LearningOutcomeRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<LearningOutcomeRow>(`SELECT * FROM "LearningOutcome" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toLearningOutcomeRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<LearningOutcomeRecord, "id">): Promise<LearningOutcomeRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<LearningOutcomeRow>(
        `INSERT INTO "LearningOutcome" ("id", "tenantId", "code", "branch", "title", "level", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.code, input.branch, input.title, input.level ?? null],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("LEARNING_OUTCOME_CREATE_FAILED");
      }
      return toLearningOutcomeRecord(record);
    });
  }

  async update(
    id: string,
    input: Partial<Pick<LearningOutcomeRecord, "code" | "branch" | "title" | "level">>,
  ): Promise<LearningOutcomeRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<LearningOutcomeRow>(
        `UPDATE "LearningOutcome"
         SET "code" = COALESCE($2, "code"),
             "branch" = COALESCE($3, "branch"),
             "title" = COALESCE($4, "title"),
             "level" = CASE WHEN $5 THEN $6 ELSE "level" END,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, input.code ?? null, input.branch ?? null, input.title ?? null, input.level !== undefined, input.level ?? null],
      );
      return result.rows[0] ? toLearningOutcomeRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<LearningOutcomeRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<LearningOutcomeRow>(
        `UPDATE "LearningOutcome"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toLearningOutcomeRecord(result.rows[0]) : undefined;
    });
  }
}

export function createLearningOutcomeStore(): LearningOutcomeStore {
  return resolvePersistenceDriver(process.env.LEARNING_OUTCOME_STORE) === "postgres"
    ? new PostgresLearningOutcomeStore()
    : new InMemoryLearningOutcomeStore();
}

interface LearningOutcomeRow {
  id: string;
  tenantId: string;
  code: string;
  branch: string;
  title: string;
  level: string | null;
  deletedAt: Date | null;
}

function toLearningOutcomeRecord(record: LearningOutcomeRow): LearningOutcomeRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    code: record.code,
    branch: record.branch,
    title: record.title,
    level: record.level ?? undefined,
    deletedAt: record.deletedAt?.toISOString(),
  };
}
