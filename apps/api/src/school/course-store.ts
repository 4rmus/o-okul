import { randomUUID } from "node:crypto";
import type { CourseRecord as SharedCourseRecord } from "@uzman-hocam/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface CourseRecord extends SharedCourseRecord {
  deletedAt?: string;
}

export interface CourseStore {
  list(): Promise<CourseRecord[]>;
  findById(id: string): Promise<CourseRecord | undefined>;
  create(input: Omit<CourseRecord, "id">): Promise<CourseRecord>;
  update(id: string, input: Partial<Pick<CourseRecord, "name" | "code">>): Promise<CourseRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<CourseRecord | undefined>;
}

export const courseStoreToken = Symbol("CourseStore");

const demoCourses: CourseRecord[] = [
  { id: "course-math", tenantId: "tenant-a", name: "Matematik", code: "MAT" },
  { id: "course-turkish", tenantId: "tenant-b", name: "Turkce", code: "TUR" },
];

export class InMemoryCourseStore implements CourseStore {
  private readonly courses = demoCourses.map((record) => ({ ...record }));

  async list(): Promise<CourseRecord[]> {
    return this.courses;
  }

  async findById(id: string): Promise<CourseRecord | undefined> {
    return this.courses.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<CourseRecord, "id">): Promise<CourseRecord> {
    const record = {
      id: `course-${this.courses.length + 1}`,
      ...input,
    };
    this.courses.push(record);
    return record;
  }

  async update(id: string, input: Partial<Pick<CourseRecord, "name" | "code">>): Promise<CourseRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.name !== undefined) record.name = input.name;
    if (input.code !== undefined) record.code = input.code;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<CourseRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }
}

export class PostgresCourseStore implements CourseStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<CourseRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<CourseRow>(`SELECT * FROM "Course"`);
      return result.rows.map(toCourseRecord);
    });
  }

  async findById(id: string): Promise<CourseRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<CourseRow>(`SELECT * FROM "Course" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toCourseRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<CourseRecord, "id">): Promise<CourseRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<CourseRow>(
        `INSERT INTO "Course" ("id", "tenantId", "name", "code", "updatedAt")
         VALUES ($1, $2, $3, $4, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.name, input.code ?? null],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("COURSE_CREATE_FAILED");
      }
      return toCourseRecord(record);
    });
  }

  async update(id: string, input: Partial<Pick<CourseRecord, "name" | "code">>): Promise<CourseRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<CourseRow>(
        `UPDATE "Course"
         SET "name" = COALESCE($2, "name"),
             "code" = CASE WHEN $3 THEN $4 ELSE "code" END,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, input.name ?? null, input.code !== undefined, input.code ?? null],
      );
      return result.rows[0] ? toCourseRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<CourseRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<CourseRow>(
        `UPDATE "Course"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toCourseRecord(result.rows[0]) : undefined;
    });
  }
}

export function createCourseStore(): CourseStore {
  return resolvePersistenceDriver(process.env.COURSE_STORE) === "postgres" ? new PostgresCourseStore() : new InMemoryCourseStore();
}

interface CourseRow {
  id: string;
  tenantId: string;
  name: string;
  code: string | null;
  deletedAt: Date | null;
}

function toCourseRecord(record: CourseRow): CourseRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    code: record.code ?? undefined,
    deletedAt: record.deletedAt?.toISOString(),
  };
}
