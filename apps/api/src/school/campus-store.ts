import { randomUUID } from "node:crypto";
import type { CampusRecord as SharedCampusRecord } from "@uzman-hocam/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface CampusRecord extends SharedCampusRecord {
  deletedAt?: string;
}

export interface CampusStore {
  list(): Promise<CampusRecord[]>;
  findById(id: string): Promise<CampusRecord | undefined>;
  create(input: Omit<CampusRecord, "id">): Promise<CampusRecord>;
  update(id: string, input: Partial<Pick<CampusRecord, "name" | "code">>): Promise<CampusRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<CampusRecord | undefined>;
}

export const campusStoreToken = Symbol("CampusStore");

const demoCampuses: CampusRecord[] = [
  { id: "campus-main", tenantId: "tenant-a", name: "Merkez Kampus", code: "MRK" },
  { id: "campus-b", tenantId: "tenant-b", name: "B Kampus", code: "B" },
];

export class InMemoryCampusStore implements CampusStore {
  private readonly campuses = demoCampuses.map((record) => ({ ...record }));

  async list(): Promise<CampusRecord[]> {
    return this.campuses;
  }

  async findById(id: string): Promise<CampusRecord | undefined> {
    return this.campuses.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<CampusRecord, "id">): Promise<CampusRecord> {
    const record = {
      id: `campus-${this.campuses.length + 1}`,
      ...input,
    };
    this.campuses.push(record);
    return record;
  }

  async update(id: string, input: Partial<Pick<CampusRecord, "name" | "code">>): Promise<CampusRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.name !== undefined) record.name = input.name;
    if (input.code !== undefined) record.code = input.code;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<CampusRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }
}

export class PostgresCampusStore implements CampusStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<CampusRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<CampusRow>(`SELECT * FROM "Campus"`);
      return result.rows.map(toCampusRecord);
    });
  }

  async findById(id: string): Promise<CampusRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<CampusRow>(`SELECT * FROM "Campus" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toCampusRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<CampusRecord, "id">): Promise<CampusRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<CampusRow>(
        `INSERT INTO "Campus" ("id", "tenantId", "name", "code", "updatedAt")
         VALUES ($1, $2, $3, $4, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.name, input.code ?? null],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("CAMPUS_CREATE_FAILED");
      }
      return toCampusRecord(record);
    });
  }

  async update(id: string, input: Partial<Pick<CampusRecord, "name" | "code">>): Promise<CampusRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<CampusRow>(
        `UPDATE "Campus"
         SET "name" = COALESCE($2, "name"),
             "code" = CASE WHEN $3 THEN $4 ELSE "code" END,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, input.name ?? null, input.code !== undefined, input.code ?? null],
      );
      return result.rows[0] ? toCampusRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<CampusRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<CampusRow>(
        `UPDATE "Campus"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toCampusRecord(result.rows[0]) : undefined;
    });
  }
}

export function createCampusStore(): CampusStore {
  return resolvePersistenceDriver(process.env.CAMPUS_STORE) === "postgres" ? new PostgresCampusStore() : new InMemoryCampusStore();
}

interface CampusRow {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  deletedAt: Date | null;
}

function toCampusRecord(record: CampusRow): CampusRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    code: record.code ?? undefined,
    deletedAt: record.deletedAt?.toISOString(),
  };
}
