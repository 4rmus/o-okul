import { randomUUID } from "node:crypto";
import type { GradeLevelRecord as SharedGradeLevelRecord } from "@uzman-hocam/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface GradeLevelRecord extends SharedGradeLevelRecord {
  deletedAt?: string;
}

export interface GradeLevelStore {
  list(): Promise<GradeLevelRecord[]>;
  findById(id: string): Promise<GradeLevelRecord | undefined>;
  create(input: Omit<GradeLevelRecord, "id">): Promise<GradeLevelRecord>;
  update(id: string, input: Partial<Pick<GradeLevelRecord, "name" | "code">>): Promise<GradeLevelRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<GradeLevelRecord | undefined>;
}

export const gradeLevelStoreToken = Symbol("GradeLevelStore");

const demoGradeLevels: GradeLevelRecord[] = [
  { id: "grade-8", tenantId: "tenant-a", name: "8. Sınıf", code: "8" },
  { id: "grade-7", tenantId: "tenant-b", name: "7. Sınıf", code: "7" },
];

export class InMemoryGradeLevelStore implements GradeLevelStore {
  private readonly gradeLevels = demoGradeLevels.map((record) => ({ ...record }));

  async list(): Promise<GradeLevelRecord[]> {
    return this.gradeLevels;
  }

  async findById(id: string): Promise<GradeLevelRecord | undefined> {
    return this.gradeLevels.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<GradeLevelRecord, "id">): Promise<GradeLevelRecord> {
    const record = {
      id: `grade-level-${this.gradeLevels.length + 1}`,
      ...input,
    };
    this.gradeLevels.push(record);
    return record;
  }

  async update(id: string, input: Partial<Pick<GradeLevelRecord, "name" | "code">>): Promise<GradeLevelRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.name !== undefined) record.name = input.name;
    if (input.code !== undefined) record.code = input.code;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<GradeLevelRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }
}

export class PostgresGradeLevelStore implements GradeLevelStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<GradeLevelRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GradeLevelRow>(`SELECT * FROM "GradeLevel"`);
      return result.rows.map(toGradeLevelRecord);
    });
  }

  async findById(id: string): Promise<GradeLevelRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GradeLevelRow>(`SELECT * FROM "GradeLevel" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toGradeLevelRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<GradeLevelRecord, "id">): Promise<GradeLevelRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GradeLevelRow>(
        `INSERT INTO "GradeLevel" ("id", "tenantId", "name", "code", "updatedAt")
         VALUES ($1, $2, $3, $4, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.name, input.code ?? null],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("GRADE_LEVEL_CREATE_FAILED");
      }
      return toGradeLevelRecord(record);
    });
  }

  async update(id: string, input: Partial<Pick<GradeLevelRecord, "name" | "code">>): Promise<GradeLevelRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GradeLevelRow>(
        `UPDATE "GradeLevel"
         SET "name" = COALESCE($2, "name"),
             "code" = CASE WHEN $3 THEN $4 ELSE "code" END,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, input.name ?? null, input.code !== undefined, input.code ?? null],
      );
      return result.rows[0] ? toGradeLevelRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<GradeLevelRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GradeLevelRow>(
        `UPDATE "GradeLevel"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toGradeLevelRecord(result.rows[0]) : undefined;
    });
  }
}

export function createGradeLevelStore(): GradeLevelStore {
  return resolvePersistenceDriver(process.env.GRADE_LEVEL_STORE) === "postgres" ? new PostgresGradeLevelStore() : new InMemoryGradeLevelStore();
}

interface GradeLevelRow {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  deletedAt: Date | null;
}

function toGradeLevelRecord(record: GradeLevelRow): GradeLevelRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    code: record.code ?? undefined,
    deletedAt: record.deletedAt?.toISOString(),
  };
}
