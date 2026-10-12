import { randomUUID } from "node:crypto";
import type { TeacherRecord as SharedTeacherRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery, withTenantQuery } from "../db/tenant-query.js";

export interface TeacherRecord extends SharedTeacherRecord {
  deletedAt?: string;
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
}

export interface TeacherStore {
  list(): Promise<TeacherRecord[]>;
  /** Pass tenantId when there is no request tenant (unauthenticated invitation accept). */
  findById(id: string, tenantId?: string): Promise<TeacherRecord | undefined>;
  findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<TeacherRecord | undefined>;
  findByUserId(tenantId: string, userId: string): Promise<TeacherRecord | undefined>;
  create(input: Omit<TeacherRecord, "id">): Promise<TeacherRecord>;
  update(
    id: string,
    input: Partial<Pick<TeacherRecord, "firstName" | "lastName" | "branch" | "nationalIdEncrypted" | "nationalIdHash" | "phone">>,
  ): Promise<TeacherRecord | undefined>;
  bindUser(tenantId: string, id: string, userId: string): Promise<TeacherRecord | undefined>;
  /**
   * UAT F-13: carry the teacher's account onto the Employee row linked by Teacher.employeeId when that row has
   * no account yet. Never overwrites an Employee that already has a different account.
   */
  linkEmployeeUser(tenantId: string, id: string, userId: string): Promise<TeacherEmployeeLinkResult>;
  /** The live teacher linked to an Employee row (Teacher.employeeId), if any. */
  findByEmployeeId(tenantId: string, employeeId: string): Promise<TeacherRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<TeacherRecord | undefined>;
  purgePii(id: string): Promise<TeacherRecord | undefined>;
}

export type TeacherEmployeeLinkResult = "LINKED" | "ALREADY_LINKED" | "NO_EMPLOYEE" | "CONFLICT";

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

  async findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<TeacherRecord | undefined> {
    return this.teachers.find((candidate) => candidate.tenantId === tenantId && candidate.nationalIdHash === nationalIdHash && !candidate.deletedAt);
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
    input: Partial<Pick<TeacherRecord, "firstName" | "lastName" | "branch" | "nationalIdEncrypted" | "nationalIdHash" | "phone">>,
  ): Promise<TeacherRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.firstName !== undefined) record.firstName = input.firstName;
    if (input.lastName !== undefined) record.lastName = input.lastName;
    if (input.branch !== undefined) record.branch = input.branch;
    if (input.nationalIdEncrypted !== undefined) record.nationalIdEncrypted = input.nationalIdEncrypted;
    if (input.nationalIdHash !== undefined) record.nationalIdHash = input.nationalIdHash;
    if (input.phone !== undefined) record.phone = input.phone;
    return record;
  }

  async bindUser(tenantId: string, id: string, userId: string): Promise<TeacherRecord | undefined> {
    const record = this.teachers.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && !candidate.deletedAt);
    if (!record) return undefined;

    record.userId = userId;
    return record;
  }

  // ponytail: the in-memory driver has no Teacher -> Employee link; the PostgreSQL store owns this behaviour.
  async linkEmployeeUser(): Promise<TeacherEmployeeLinkResult> {
    return "NO_EMPLOYEE";
  }

  async findByEmployeeId(): Promise<TeacherRecord | undefined> {
    return undefined;
  }

  async softDelete(id: string, deletedAt: string): Promise<TeacherRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    record.userId = undefined;
    return record;
  }

  async purgePii(id: string): Promise<TeacherRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.firstName = "Anonim";
    record.lastName = "Ogretmen";
    record.nationalIdEncrypted = undefined;
    record.nationalIdHash = undefined;
    record.phone = undefined;
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

  async findById(id: string, tenantId?: string): Promise<TeacherRecord | undefined> {
    if (tenantId) {
      return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
        return selectTeacherById(client, id);
      });
    }
    return withTenantQuery(this.pool, async (client) => {
      return selectTeacherById(client, id);
    });
  }

  async findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<TeacherRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<TeacherRow>(
        `SELECT * FROM "Teacher"
         WHERE "tenantId" = $1
           AND "nationalIdHash" = $2
           AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, nationalIdHash],
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
        `INSERT INTO "Teacher" ("id", "tenantId", "firstName", "lastName", "branch", "nationalIdEncrypted", "nationalIdHash", "phone", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.firstName,
          input.lastName,
          input.branch ?? null,
          input.nationalIdEncrypted ?? null,
          input.nationalIdHash ?? null,
          input.phone ?? null,
        ],
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
    input: Partial<Pick<TeacherRecord, "firstName" | "lastName" | "branch" | "nationalIdEncrypted" | "nationalIdHash" | "phone">>,
  ): Promise<TeacherRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherRow>(
        `UPDATE "Teacher"
         SET "firstName" = COALESCE($2, "firstName"),
             "lastName" = COALESCE($3, "lastName"),
             "branch" = CASE WHEN $4 THEN $5 ELSE "branch" END,
             "nationalIdEncrypted" = COALESCE($6, "nationalIdEncrypted"),
             "nationalIdHash" = COALESCE($7, "nationalIdHash"),
             "phone" = CASE WHEN $8 THEN $9 ELSE "phone" END,
             "updatedAt" = now()
         WHERE "id" = $1
           AND "deletedAt" IS NULL
         RETURNING *`,
        [
          id,
          input.firstName ?? null,
          input.lastName ?? null,
          input.branch !== undefined,
          input.branch ?? null,
          input.nationalIdEncrypted ?? null,
          input.nationalIdHash ?? null,
          input.phone !== undefined,
          input.phone ?? null,
        ],
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

  async linkEmployeeUser(tenantId: string, id: string, userId: string): Promise<TeacherEmployeeLinkResult> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<{ previousUserId: string | null; linked: boolean }>(
        `WITH employee AS (
           SELECT e."id", e."userId"
           FROM "Teacher" t
           JOIN "Employee" e ON e."tenantId" = t."tenantId" AND e."id" = t."employeeId" AND e."deletedAt" IS NULL
           WHERE t."tenantId" = $1 AND t."id" = $2 AND t."deletedAt" IS NULL
           FOR UPDATE OF e
         ), linked AS (
           UPDATE "Employee" e
           SET "userId" = $3, "updatedAt" = now()
           FROM employee
           WHERE e."tenantId" = $1 AND e."id" = employee."id" AND employee."userId" IS NULL
             AND NOT EXISTS (
               SELECT 1 FROM "Employee" other WHERE other."tenantId" = $1 AND other."userId" = $3
             )
           RETURNING e."id"
         )
         SELECT employee."userId" AS "previousUserId", EXISTS (SELECT 1 FROM linked) AS "linked"
         FROM employee`,
        [tenantId, id, userId],
      );
      const row = result.rows[0];
      if (!row) return "NO_EMPLOYEE";
      if (row.linked) return "LINKED";
      return row.previousUserId === userId ? "ALREADY_LINKED" : "CONFLICT";
    });
  }

  async findByEmployeeId(tenantId: string, employeeId: string): Promise<TeacherRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<TeacherRow>(
        `SELECT * FROM "Teacher" WHERE "tenantId" = $1 AND "employeeId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        [tenantId, employeeId],
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
             "nationalIdEncrypted" = NULL,
             "nationalIdHash" = NULL,
             "phone" = NULL,
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
  nationalIdEncrypted: string | null;
  nationalIdHash: string | null;
  phone: string | null;
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
    nationalIdEncrypted: row.nationalIdEncrypted ?? undefined,
    nationalIdHash: row.nationalIdHash ?? undefined,
    phone: row.phone ?? undefined,
    userId: row.userId ?? undefined,
    deletedAt: row.deletedAt?.toISOString(),
  };
}

async function selectTeacherById(client: Queryable, id: string): Promise<TeacherRecord | undefined> {
  const result = await client.query<TeacherRow>(
    `SELECT * FROM "Teacher" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
    [id],
  );
  return result.rows[0] ? toTeacherRecord(result.rows[0]) : undefined;
}
