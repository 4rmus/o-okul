import { randomUUID } from "node:crypto";
import type { TeacherRecord as SharedTeacherRecord } from "@uzman-hocam/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withExplicitTenantQuery, withTenantQuery } from "../db/tenant-query.js";

export interface TeacherRecord extends SharedTeacherRecord {
  deletedAt?: string;
}

export interface TeacherStore {
  list(): Promise<TeacherRecord[]>;
  findById(id: string): Promise<TeacherRecord | undefined>;
  findByUserId(tenantId: string, userId: string): Promise<TeacherRecord | undefined>;
  create(input: Omit<TeacherRecord, "id">): Promise<TeacherRecord>;
  update(
    id: string,
    input: Partial<Pick<TeacherRecord, "firstName" | "lastName" | "branch">>,
  ): Promise<TeacherRecord | undefined>;
  bindUser(tenantId: string, id: string, userId: string): Promise<TeacherRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<TeacherRecord | undefined>;
  purgePii(id: string): Promise<TeacherRecord | undefined>;
}

export const teacherStoreToken = Symbol("TeacherStore");

const demoTeachers: TeacherRecord[] = [
  {
    id: "teacher-a",
    tenantId: "tenant-a",
    firstName: "Ayse",
    lastName: "Ogretmen",
    branch: "Matematik",
    userId: "teacher-tenant-a",
  },
  { id: "teacher-b", tenantId: "tenant-b", firstName: "Berk", lastName: "Ogretmen", branch: "Turkce" },
];

export class InMemoryTeacherStore implements TeacherStore {
  private readonly teachers = demoTeachers.map((record) => ({ ...record }));

  async list(): Promise<TeacherRecord[]> {
    return this.teachers;
  }

  async findById(id: string): Promise<TeacherRecord | undefined> {
    return this.teachers.find((candidate) => candidate.id === id && !candidate.deletedAt);
  }

  async findByUserId(tenantId: string, userId: string): Promise<TeacherRecord | undefined> {
    return this.teachers.find((candidate) => candidate.tenantId === tenantId && candidate.userId === userId && !candidate.deletedAt);
  }

  async create(input: Omit<TeacherRecord, "id">): Promise<TeacherRecord> {
    const record = {
      id: `teacher-${this.teachers.length + 1}`,
      ...input,
    };
    this.teachers.push(record);
    return record;
  }

  async update(
    id: string,
    input: Partial<Pick<TeacherRecord, "firstName" | "lastName" | "branch">>,
  ): Promise<TeacherRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.firstName !== undefined) record.firstName = input.firstName;
    if (input.lastName !== undefined) record.lastName = input.lastName;
    if (input.branch !== undefined) record.branch = input.branch;
    return record;
  }

  async bindUser(tenantId: string, id: string, userId: string): Promise<TeacherRecord | undefined> {
    const record = this.teachers.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && !candidate.deletedAt);
    if (!record) return undefined;

    record.userId = userId;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<TeacherRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }

  async purgePii(id: string): Promise<TeacherRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.firstName = "Anonim";
    record.lastName = "Ogretmen";
    return record;
  }
}

export class PostgresTeacherStore implements TeacherStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<TeacherRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherRow>(`SELECT * FROM "Teacher" WHERE "deletedAt" IS NULL`);
      return result.rows.map(toTeacherRecord);
    });
  }

  async findById(id: string): Promise<TeacherRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherRow>(
        `SELECT * FROM "Teacher" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toTeacherRecord(result.rows[0]) : undefined;
    });
  }

  async findByUserId(tenantId: string, userId: string): Promise<TeacherRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<TeacherRow>(
        `SELECT * FROM "Teacher" WHERE "tenantId" = $1 AND "userId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        [tenantId, userId],
      );
      return result.rows[0] ? toTeacherRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<TeacherRecord, "id">): Promise<TeacherRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherRow>(
        `INSERT INTO "Teacher" ("id", "tenantId", "firstName", "lastName", "branch", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.firstName, input.lastName, input.branch ?? null],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("TEACHER_CREATE_FAILED");
      }
      return toTeacherRecord(record);
    });
  }

  async update(
    id: string,
    input: Partial<Pick<TeacherRecord, "firstName" | "lastName" | "branch">>,
  ): Promise<TeacherRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherRow>(
        `UPDATE "Teacher"
         SET "firstName" = COALESCE($2, "firstName"),
             "lastName" = COALESCE($3, "lastName"),
             "branch" = CASE WHEN $4 THEN $5 ELSE "branch" END,
             "updatedAt" = now()
         WHERE "id" = $1
           AND "deletedAt" IS NULL
         RETURNING *`,
        [id, input.firstName ?? null, input.lastName ?? null, input.branch !== undefined, input.branch ?? null],
      );
      return result.rows[0] ? toTeacherRecord(result.rows[0]) : undefined;
    });
  }

  async bindUser(tenantId: string, id: string, userId: string): Promise<TeacherRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<TeacherRow>(
        `UPDATE "Teacher"
         SET "userId" = $3,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "id" = $2
           AND "deletedAt" IS NULL
         RETURNING *`,
        [tenantId, id, userId],
      );
      return result.rows[0] ? toTeacherRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<TeacherRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherRow>(
        `UPDATE "Teacher"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toTeacherRecord(result.rows[0]) : undefined;
    });
  }

  async purgePii(id: string): Promise<TeacherRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherRow>(
        `UPDATE "Teacher"
         SET "firstName" = 'Anonim',
             "lastName" = 'Ogretmen',
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id],
      );
      return result.rows[0] ? toTeacherRecord(result.rows[0]) : undefined;
    });
  }
}

export function createTeacherStore(): TeacherStore {
  return resolvePersistenceDriver(process.env.TEACHER_STORE) === "postgres" ? new PostgresTeacherStore() : new InMemoryTeacherStore();
}

interface TeacherRow {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  branch: string | null;
  userId: string | null;
  deletedAt: Date | null;
}

function toTeacherRecord(row: TeacherRow): TeacherRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    firstName: row.firstName,
    lastName: row.lastName,
    branch: row.branch ?? undefined,
    userId: row.userId ?? undefined,
    deletedAt: row.deletedAt?.toISOString(),
  };
}
