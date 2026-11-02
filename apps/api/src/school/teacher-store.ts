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
  /** Clears the account link only while it still points at userId (invitation accept rollback). */
  unbindUser(tenantId: string, id: string, userId: string): Promise<boolean>;
  /**
   * UAT F-13: carry the teacher's account onto the Employee row linked by Teacher.employeeId when that row has
   * no account yet. Never overwrites an Employee that already has a different account.
   */
  linkEmployeeUser(tenantId: string, id: string, userId: string): Promise<TeacherEmployeeLinkResult>;
  /** The live teacher linked to an Employee row (Teacher.employeeId), if any. */
  findByEmployeeId(tenantId: string, employeeId: string): Promise<TeacherRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<TeacherRecord | undefined>;
  /**
   * DEC-20261102-08: a deleted teacher's linked Employee row is ended (status ENDED, never deleted). An Employee whose
   * account still holds a staff membership keeps its status: deleting the teacher profile cuts only the teacher persona
   * (KV-3c rule B). Works on an already deleted teacher, so a retried delete stays idempotent.
   */
  endLinkedEmployee(tenantId: string, id: string, endedAt: string): Promise<TeacherEmployeeEndResult>;
  /** Anonymises the teacher and, in the same transaction, the personal fields of its linked Employee row. */
  purgePii(id: string): Promise<TeacherPiiPurgeResult | undefined>;
}

export type TeacherEmployeeLinkResult = "LINKED" | "ALREADY_LINKED" | "NO_EMPLOYEE" | "CONFLICT";
export type TeacherEmployeeEndResult = "ENDED" | "ALREADY_ENDED" | "STAFF_ACCESS_KEPT" | "NO_EMPLOYEE";

export interface TeacherPiiPurgeResult {
  teacher: TeacherRecord;
  /** The linked Employee row purged with the teacher, when the teacher has one. */
  employeeId?: string;
}

/** Same id scheme as scripts/backfill-account-management.mjs, so a backfill rerun finds the row instead of adding one. */
const teacherEmployeeIdSql = `'employee-' || md5($1::text || ':' || $2::text)`;
const teacherAnonymousFirstName = "Anonim";
const teacherAnonymousLastName = "Ogretmen";

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

  async unbindUser(tenantId: string, id: string, userId: string): Promise<boolean> {
    const record = this.teachers.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && candidate.userId === userId);
    if (!record) return false;
    record.userId = undefined;
    return true;
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

  // ponytail: like linkEmployeeUser, the Teacher -> Employee sync is owned by the PostgreSQL store.
  async endLinkedEmployee(): Promise<TeacherEmployeeEndResult> {
    return "NO_EMPLOYEE";
  }

  async purgePii(id: string): Promise<TeacherPiiPurgeResult | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.firstName = teacherAnonymousFirstName;
    record.lastName = teacherAnonymousLastName;
    record.nationalIdEncrypted = undefined;
    record.nationalIdHash = undefined;
    record.phone = undefined;
    return { teacher: record };
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
      // DEC-20261102-08: the linked Employee row is found or created in the same transaction as the teacher.
      await linkOrCreateTeacherEmployee(client, record, input.userId);
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
      if (input.nationalIdHash) {
        await assertEmployeeNationalIdFree(client, existing.tenantId, id, input.nationalIdHash);
      }
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
      const record = result.rows[0];
      if (!record) return undefined;
      await mirrorTeacherToEmployee(client, record, input);
      return toTeacherRecord(record);
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

  async unbindUser(tenantId: string, id: string, userId: string): Promise<boolean> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<{ id: string }>(
        `UPDATE "Teacher"
         SET "userId" = NULL,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "id" = $2
           AND "userId" = $3
         RETURNING "id"`,
        [tenantId, id, userId],
      );
      return result.rows.length > 0;
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

  async endLinkedEmployee(tenantId: string, id: string, endedAt: string): Promise<TeacherEmployeeEndResult> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<{ id: string; status: string; keepsStaffAccess: boolean }>(
        `SELECT e."id", e."status",
                EXISTS (
                  SELECT 1 FROM "TenantMembership" m
                  WHERE m."tenantId" = e."tenantId" AND m."userId" = e."userId"
                    AND m."staffRole" IS NOT NULL AND m."status" <> 'ENDED'
                ) AS "keepsStaffAccess"
         FROM "Teacher" t
         JOIN "Employee" e ON e."tenantId" = t."tenantId" AND e."id" = t."employeeId" AND e."deletedAt" IS NULL
         WHERE t."tenantId" = $1 AND t."id" = $2
         FOR UPDATE OF e`,
        [tenantId, id],
      );
      const employee = result.rows[0];
      if (!employee) return "NO_EMPLOYEE";
      if (employee.status === "ENDED") return "ALREADY_ENDED";
      if (employee.keepsStaffAccess) return "STAFF_ACCESS_KEPT";
      // Employee_dates_check needs employmentStartsAt < employmentEndsAt: a start on or after the deletion day ends on
      // the following day.
      await client.query(
        `UPDATE "Employee"
         SET "status" = 'ENDED',
             "employmentEndsAt" = GREATEST($3::date, COALESCE("employmentStartsAt" + 1, $3::date)),
             "endedReason" = 'TEACHER_DELETED',
             "updatedAt" = now()
         WHERE "tenantId" = $1 AND "id" = $2`,
        [tenantId, employee.id, endedAt.slice(0, 10)],
      );
      return "ENDED";
    });
  }

  async purgePii(id: string): Promise<TeacherPiiPurgeResult | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherRow>(
        `UPDATE "Teacher"
         SET "firstName" = $2,
             "lastName" = $3,
             "nationalIdEncrypted" = NULL,
             "nationalIdHash" = NULL,
             "phone" = NULL,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, teacherAnonymousFirstName, teacherAnonymousLastName],
      );
      const record = result.rows[0];
      if (!record) return undefined;
      // DEC-20261102-08: the linked Employee row is the same person. It is anonymised with the same values and its
      // work e-mail is cleared; an ended or deleted Employee row is purged as well.
      const employee = record.employeeId
        ? await client.query<{ id: string }>(
          `UPDATE "Employee"
           SET "firstName" = $3,
               "lastName" = $4,
               "nationalIdEncrypted" = NULL,
               "nationalIdHash" = NULL,
               "phone" = NULL,
               "workEmail" = NULL,
               "updatedAt" = now()
           WHERE "tenantId" = $1 AND "id" = $2
           RETURNING "id"`,
          [record.tenantId, record.employeeId, teacherAnonymousFirstName, teacherAnonymousLastName],
        )
        : undefined;
      return { teacher: toTeacherRecord(record), employeeId: employee?.rows[0]?.id };
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
  employeeId?: string | null;
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

/**
 * DEC-20261102-08: an existing Employee row is reused when it matches the teacher's account (userId) first, then its
 * national ID hash; otherwise one is inserted with the backfill's id scheme. An Employee already linked to another
 * teacher is never taken over, and a unique conflict leaves the teacher unlinked instead of failing the create (the
 * deploy backfill reports unlinked teachers as TEACHER_EMPLOYEE_BACKFILL_INCOMPLETE).
 */
async function linkOrCreateTeacherEmployee(client: Queryable, teacher: TeacherRow, userId: string | undefined): Promise<void> {
  const candidate = await client.query<{ id: string; linked: boolean }>(
    `SELECT e."id",
            EXISTS (SELECT 1 FROM "Teacher" other WHERE other."tenantId" = e."tenantId" AND other."employeeId" = e."id") AS "linked"
     FROM "Employee" e
     WHERE e."tenantId" = $1 AND e."deletedAt" IS NULL
       AND (($2::text IS NOT NULL AND e."userId" = $2) OR ($3::text IS NOT NULL AND e."nationalIdHash" = $3))
     ORDER BY CASE WHEN $2::text IS NOT NULL AND e."userId" = $2 THEN 0 ELSE 1 END, e."id"
     LIMIT 1
     FOR UPDATE OF e`,
    [teacher.tenantId, userId ?? null, teacher.nationalIdHash ?? null],
  );
  let employeeId: string | undefined;
  const match = candidate.rows[0];
  if (match) {
    employeeId = match.linked ? undefined : match.id;
  } else {
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO "Employee" (
         "id", "tenantId", "firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone", "status", "updatedAt"
       )
       VALUES (${teacherEmployeeIdSql}, $1, $3, $4, $5, $6, $7, 'ACTIVE', now())
       ON CONFLICT DO NOTHING
       RETURNING "id"`,
      [
        teacher.tenantId, teacher.id, teacher.firstName, teacher.lastName,
        teacher.nationalIdEncrypted ?? null, teacher.nationalIdHash ?? null, teacher.phone ?? null,
      ],
    );
    employeeId = inserted.rows[0]?.id;
  }
  if (!employeeId) return;
  await client.query(
    `UPDATE "Teacher" SET "employeeId" = $3, "updatedAt" = now() WHERE "tenantId" = $1 AND "id" = $2`,
    [teacher.tenantId, teacher.id, employeeId],
  );
  teacher.employeeId = employeeId;
}

/**
 * The national ID is mirrored onto the linked Employee, and Employee's (tenantId, nationalIdHash) unique index covers
 * every row, so another Employee holding it is a conflict. A teacher without a linked Employee mirrors nothing.
 */
async function assertEmployeeNationalIdFree(client: Queryable, tenantId: string, teacherId: string, nationalIdHash: string): Promise<void> {
  const result = await client.query<{ id: string }>(
    `SELECT e."id"
     FROM "Teacher" t
     JOIN "Employee" e ON e."tenantId" = t."tenantId" AND e."nationalIdHash" = $3 AND e."id" <> t."employeeId"
     WHERE t."tenantId" = $1 AND t."id" = $2 AND t."employeeId" IS NOT NULL
     LIMIT 1`,
    [tenantId, teacherId, nationalIdHash],
  );
  if (result.rows[0]) throw new Error("TEACHER_NATIONAL_ID_CONFLICT");
}

/** DEC-20261102-08: the linked Employee follows the teacher's name, phone and national ID (only the fields sent). */
async function mirrorTeacherToEmployee(
  client: Queryable,
  teacher: TeacherRow,
  input: Partial<Pick<TeacherRecord, "firstName" | "lastName" | "nationalIdHash" | "phone">>,
): Promise<void> {
  const nameChanged = input.firstName !== undefined || input.lastName !== undefined;
  const phoneChanged = input.phone !== undefined;
  const nationalIdChanged = Boolean(input.nationalIdHash);
  if (!teacher.employeeId || (!nameChanged && !phoneChanged && !nationalIdChanged)) return;
  await client.query(
    `UPDATE "Employee"
     SET "firstName" = CASE WHEN $3 THEN $4 ELSE "firstName" END,
         "lastName" = CASE WHEN $3 THEN $5 ELSE "lastName" END,
         "phone" = CASE WHEN $6 THEN $7 ELSE "phone" END,
         "nationalIdEncrypted" = CASE WHEN $8 THEN $9 ELSE "nationalIdEncrypted" END,
         "nationalIdHash" = CASE WHEN $8 THEN $10 ELSE "nationalIdHash" END,
         "updatedAt" = now()
     WHERE "tenantId" = $1 AND "id" = $2 AND "deletedAt" IS NULL`,
    [
      teacher.tenantId,
      teacher.employeeId,
      nameChanged,
      teacher.firstName,
      teacher.lastName,
      phoneChanged,
      teacher.phone,
      nationalIdChanged,
      teacher.nationalIdEncrypted,
      teacher.nationalIdHash,
    ],
  );
}
