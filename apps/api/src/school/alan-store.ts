import { randomUUID } from "node:crypto";
import type { AlanRecord as SharedAlanRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface AlanRecord extends SharedAlanRecord {
  deletedAt?: string;
}

export interface AlanStore {
  list(): Promise<AlanRecord[]>;
  findById(id: string): Promise<AlanRecord | undefined>;
  create(input: Omit<AlanRecord, "id">): Promise<AlanRecord>;
  update(id: string, input: Partial<Pick<AlanRecord, "name" | "code" | "gradeLevelId">>): Promise<AlanRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<AlanRecord | undefined>;
}

export const alanStoreToken = Symbol("AlanStore");

const demoAlanlar: AlanRecord[] = [
  { id: "alan-11-sayisal", tenantId: "tenant-a", gradeLevelId: "grade-11", name: "Sayısal", code: "11-SAY" },
  { id: "alan-kpss-genel-yetenek", tenantId: "tenant-b", gradeLevelId: "grade-kpss", name: "Genel Yetenek", code: "KPSS-GY" },
];

export class InMemoryAlanStore implements AlanStore {
  private readonly alanlar = demoAlanlar.map((record) => ({ ...record }));

  async list(): Promise<AlanRecord[]> {
    return this.alanlar;
  }

  async findById(id: string): Promise<AlanRecord | undefined> {
    return this.alanlar.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<AlanRecord, "id">): Promise<AlanRecord> {
    const record = {
      id: `alan-${this.alanlar.length + 1}`,
      ...input,
    };
    this.alanlar.push(record);
    return record;
  }

  async update(id: string, input: Partial<Pick<AlanRecord, "name" | "code" | "gradeLevelId">>): Promise<AlanRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.name !== undefined) record.name = input.name;
    if (input.code !== undefined) record.code = input.code;
    if (input.gradeLevelId !== undefined) record.gradeLevelId = input.gradeLevelId;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<AlanRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }
}

export class PostgresAlanStore implements AlanStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<AlanRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AlanRow>(`SELECT * FROM "Alan"`);
      return result.rows.map(toAlanRecord);
    });
  }

  async findById(id: string): Promise<AlanRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AlanRow>(`SELECT * FROM "Alan" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toAlanRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<AlanRecord, "id">): Promise<AlanRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AlanRow>(
        `INSERT INTO "Alan" ("id", "tenantId", "gradeLevelId", "name", "code", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.gradeLevelId ?? null, input.name, input.code ?? null],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("ALAN_CREATE_FAILED");
      }
      return toAlanRecord(record);
    });
  }

  async update(id: string, input: Partial<Pick<AlanRecord, "name" | "code" | "gradeLevelId">>): Promise<AlanRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AlanRow>(
        `UPDATE "Alan"
         SET "name" = COALESCE($2, "name"),
             "code" = CASE WHEN $3 THEN $4 ELSE "code" END,
             "gradeLevelId" = CASE WHEN $5 THEN $6 ELSE "gradeLevelId" END,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [
          id,
          input.name ?? null,
          input.code !== undefined,
          input.code ?? null,
          input.gradeLevelId !== undefined,
          input.gradeLevelId ?? null,
        ],
      );
      return result.rows[0] ? toAlanRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<AlanRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AlanRow>(
        `UPDATE "Alan"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toAlanRecord(result.rows[0]) : undefined;
    });
  }
}

export function createAlanStore(): AlanStore {
  return resolvePersistenceDriver(process.env.ALAN_STORE) === "postgres" ? new PostgresAlanStore() : new InMemoryAlanStore();
}

interface AlanRow {
  id: string;
  tenantId: string;
  gradeLevelId: string | null;
  name: string;
  code: string | null;
  deletedAt: Date | null;
}

function toAlanRecord(record: AlanRow): AlanRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    gradeLevelId: record.gradeLevelId ?? undefined,
    name: record.name,
    code: record.code ?? undefined,
    deletedAt: record.deletedAt?.toISOString(),
  };
}
