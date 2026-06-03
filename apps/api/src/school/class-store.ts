import { randomUUID } from "node:crypto";
import type { ClassRecord as SharedClassRecord } from "@uzman-hocam/shared-types";
import pg from "pg";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface ClassRecord extends SharedClassRecord {
  deletedAt?: string;
}

export interface ClassStore {
  list(): Promise<ClassRecord[]>;
  findById(id: string): Promise<ClassRecord | undefined>;
  create(input: Omit<ClassRecord, "id">): Promise<ClassRecord>;
  update(id: string, input: Partial<Pick<ClassRecord, "name" | "level" | "campusId" | "gradeLevelId" | "section">>): Promise<ClassRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<ClassRecord | undefined>;
}

export const classStoreToken = Symbol("ClassStore");

const demoClasses: ClassRecord[] = [
  { id: "class-a", tenantId: "tenant-a", name: "8-A", level: "8", campusId: "campus-main", gradeLevelId: "grade-8", section: "A" },
  { id: "class-b", tenantId: "tenant-b", name: "7-B", level: "7", gradeLevelId: "grade-7", section: "B" },
];

export class InMemoryClassStore implements ClassStore {
  private readonly classes = demoClasses.map((record) => ({ ...record }));

  async list(): Promise<ClassRecord[]> {
    return this.classes;
  }

  async findById(id: string): Promise<ClassRecord | undefined> {
    return this.classes.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<ClassRecord, "id">): Promise<ClassRecord> {
    const record = {
      id: `class-${this.classes.length + 1}`,
      ...input,
    };
    this.classes.push(record);
    return record;
  }

  async update(id: string, input: Partial<Pick<ClassRecord, "name" | "level" | "campusId" | "gradeLevelId" | "section">>): Promise<ClassRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.name !== undefined) record.name = input.name;
    if (input.level !== undefined) record.level = input.level;
    if (input.campusId !== undefined) record.campusId = input.campusId;
    if (input.gradeLevelId !== undefined) record.gradeLevelId = input.gradeLevelId;
    if (input.section !== undefined) record.section = input.section;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<ClassRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }
}

export class PostgresClassStore implements ClassStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<ClassRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ClassRow>(`SELECT * FROM "Class"`);
      return result.rows.map(toClassRecord);
    });
  }

  async findById(id: string): Promise<ClassRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ClassRow>(`SELECT * FROM "Class" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toClassRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<ClassRecord, "id">): Promise<ClassRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ClassRow>(
        `INSERT INTO "Class" ("id", "tenantId", "campusId", "gradeLevelId", "name", "level", "section", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.campusId ?? null, input.gradeLevelId ?? null, input.name, input.level ?? null, input.section ?? null],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("CLASS_CREATE_FAILED");
      }
      return toClassRecord(record);
    });
  }

  async update(id: string, input: Partial<Pick<ClassRecord, "name" | "level" | "campusId" | "gradeLevelId" | "section">>): Promise<ClassRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ClassRow>(
        `UPDATE "Class"
         SET "name" = COALESCE($2, "name"),
             "level" = CASE WHEN $3 THEN $4 ELSE "level" END,
             "campusId" = CASE WHEN $5 THEN $6 ELSE "campusId" END,
             "gradeLevelId" = CASE WHEN $7 THEN $8 ELSE "gradeLevelId" END,
             "section" = CASE WHEN $9 THEN $10 ELSE "section" END,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [
          id,
          input.name ?? null,
          input.level !== undefined,
          input.level ?? null,
          input.campusId !== undefined,
          input.campusId ?? null,
          input.gradeLevelId !== undefined,
          input.gradeLevelId ?? null,
          input.section !== undefined,
          input.section ?? null,
        ],
      );
      return result.rows[0] ? toClassRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<ClassRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ClassRow>(
        `UPDATE "Class"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toClassRecord(result.rows[0]) : undefined;
    });
  }
}

export function createClassStore(): ClassStore {
  return process.env.CLASS_STORE === "postgres" ? new PostgresClassStore() : new InMemoryClassStore();
}

interface ClassRow {
  id: string;
  tenantId: string;
  campusId: string | null;
  gradeLevelId: string | null;
  name: string;
  level: string | null;
  section: string | null;
  deletedAt: Date | null;
}

function toClassRecord(record: ClassRow): ClassRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    campusId: record.campusId ?? undefined,
    gradeLevelId: record.gradeLevelId ?? undefined,
    name: record.name,
    level: record.level ?? undefined,
    section: record.section ?? undefined,
    deletedAt: record.deletedAt?.toISOString(),
  };
}
