import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery, withTenantQuery } from "../db/tenant-query.js";
import type { StudentRecord } from "./student.service.js";

type StudentInput = Omit<StudentRecord, "id" | "status"> & Partial<Pick<StudentRecord, "status" | "studentNo">>;
const studentNoStart = 100;

export interface StudentProfileStorageRecord extends StudentRecord {
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  photoKey?: string;
}

export type StudentProfileUpdate = {
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  photoKey?: string;
};

export interface StudentStore {
  list(): Promise<StudentRecord[]>;
  findById(id: string): Promise<StudentRecord | undefined>;
  findProfileById(id: string): Promise<StudentProfileStorageRecord | undefined>;
  findByUserId(tenantId: string, userId: string): Promise<StudentRecord | undefined>;
  findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<StudentProfileStorageRecord | undefined>;
  create(input: StudentInput): Promise<StudentRecord>;
  createMany(inputs: StudentInput[]): Promise<StudentRecord[]>;
  update(id: string, input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "classId" | "responsibleTeacherId" | "status">>): Promise<StudentRecord | undefined>;
  updateProfile(id: string, input: StudentProfileUpdate): Promise<StudentProfileStorageRecord | undefined>;
  bindUser(tenantId: string, id: string, userId: string): Promise<StudentRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<StudentRecord | undefined>;
  purgePii(id: string): Promise<StudentRecord | undefined>;
  updateTenant(id: string, tenantId: string): Promise<StudentRecord | undefined>;
}

export const studentStoreToken = Symbol("StudentStore");

const demoStudents: StudentProfileStorageRecord[] = [
  {
    id: "student-a",
    tenantId: "tenant-a",
    firstName: "Ada",
    lastName: "A",
    studentNo: "100",
    userId: "student-tenant-a",
    classId: "class-a",
    responsibleTeacherId: "teacher-a",
    status: "ACTIVE",
  },
  { id: "student-b", tenantId: "tenant-b", firstName: "Bora", lastName: "B", studentNo: "100", status: "ACTIVE" },
];

export class InMemoryStudentStore implements StudentStore {
  private readonly students = demoStudents.map((record) => ({ ...record }));

  async list(): Promise<StudentRecord[]> {
    return this.students.filter((student) => !student.deletedAt);
  }

  async findById(id: string): Promise<StudentRecord | undefined> {
    return this.students.find((candidate) => candidate.id === id && !candidate.deletedAt);
  }

  async findProfileById(id: string): Promise<StudentProfileStorageRecord | undefined> {
    return this.students.find((candidate) => candidate.id === id && !candidate.deletedAt);
  }

  async findByUserId(tenantId: string, userId: string): Promise<StudentRecord | undefined> {
    return this.students.find((candidate) => candidate.tenantId === tenantId && candidate.userId === userId && !candidate.deletedAt);
  }

  async findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<StudentProfileStorageRecord | undefined> {
    return this.students.find((candidate) => candidate.tenantId === tenantId && candidate.nationalIdHash === nationalIdHash && !candidate.deletedAt);
  }

  async create(input: StudentInput): Promise<StudentRecord> {
    const studentNo = normalizeStudentNo(input.studentNo) ?? this.nextStudentNo(input.tenantId);
    const student = {
      id: `student-${this.students.length + 1}`,
      status: "ACTIVE" as const,
      ...input,
      studentNo,
    };
    this.students.push(student);
    return student;
  }

  async createMany(inputs: StudentInput[]): Promise<StudentRecord[]> {
    const created: StudentRecord[] = [];
    for (const input of inputs) {
      const studentNo = normalizeStudentNo(input.studentNo) ?? this.nextStudentNo(input.tenantId, created);
      const student = {
        id: `student-${this.students.length + created.length + 1}`,
        status: "ACTIVE" as const,
        ...input,
        studentNo,
      };
      created.push(student);
    }
    this.students.push(...created);
    return created;
  }

  private nextStudentNo(tenantId: string, pending: StudentRecord[] = []): string {
    const activeNumbers = new Set(
      [...this.students, ...pending]
        .filter((student) => student.tenantId === tenantId && !student.deletedAt)
        .map((student) => Number(student.studentNo))
        .filter((studentNo) => Number.isInteger(studentNo) && studentNo >= studentNoStart),
    );
    let candidate = studentNoStart;
    while (activeNumbers.has(candidate)) {
      candidate += 1;
    }
    return String(candidate);
  }

  async update(
    id: string,
    input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "classId" | "responsibleTeacherId" | "status">>,
  ): Promise<StudentRecord | undefined> {
    const student = await this.findById(id);
    if (!student) return undefined;

    if (input.firstName !== undefined) student.firstName = input.firstName;
    if (input.lastName !== undefined) student.lastName = input.lastName;
    if (input.classId !== undefined) student.classId = input.classId || undefined;
    if (input.responsibleTeacherId !== undefined) student.responsibleTeacherId = input.responsibleTeacherId || undefined;
    if (input.status !== undefined) student.status = input.status;
    return student;
  }

  async updateProfile(id: string, input: StudentProfileUpdate): Promise<StudentProfileStorageRecord | undefined> {
    const student = await this.findProfileById(id);
    if (!student) return undefined;

    if (input.nationalIdEncrypted !== undefined) student.nationalIdEncrypted = input.nationalIdEncrypted;
    if (input.nationalIdHash !== undefined) student.nationalIdHash = input.nationalIdHash;
    if (input.birthDate !== undefined) student.birthDate = input.birthDate;
    if (input.phone !== undefined) student.phone = input.phone;
    if (input.email !== undefined) student.email = input.email;
    if (input.photoKey !== undefined) student.photoKey = input.photoKey;
    return student;
  }

  async bindUser(tenantId: string, id: string, userId: string): Promise<StudentRecord | undefined> {
    const student = this.students.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && !candidate.deletedAt);
    if (!student) return undefined;

    student.userId = userId;
    return student;
  }

  async softDelete(id: string, deletedAt: string): Promise<StudentRecord | undefined> {
    const student = await this.findById(id);
    if (!student) return undefined;

    student.deletedAt = deletedAt;
    return student;
  }

  async purgePii(id: string): Promise<StudentRecord | undefined> {
    const student = await this.findById(id);
    if (!student) return undefined;

    student.firstName = "Anonim";
    student.lastName = "Ogrenci";
    return student;
  }

  async updateTenant(id: string, tenantId: string): Promise<StudentRecord | undefined> {
    const student = await this.findById(id);
    if (!student) return undefined;

    student.tenantId = tenantId;
    return student;
  }
}

export class PostgresStudentStore implements StudentStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<StudentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(`SELECT * FROM "Student" WHERE "deletedAt" IS NULL`);
      return result.rows.map(toStudentRecord);
    });
  }

  async findById(id: string): Promise<StudentRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `SELECT * FROM "Student" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async findProfileById(id: string): Promise<StudentProfileStorageRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `SELECT * FROM "Student" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toStudentProfileStorageRecord(result.rows[0]) : undefined;
    });
  }

  async findByUserId(tenantId: string, userId: string): Promise<StudentRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<StudentRow>(
        `SELECT * FROM "Student" WHERE "tenantId" = $1 AND "userId" = $2 AND "deletedAt" IS NULL LIMIT 1`,
        [tenantId, userId],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async findByNationalIdHash(tenantId: string, nationalIdHash: string): Promise<StudentProfileStorageRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<StudentRow>(
        `SELECT * FROM "Student"
         WHERE "tenantId" = $1
           AND "nationalIdHash" = $2
           AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, nationalIdHash],
      );
      return result.rows[0] ? toStudentProfileStorageRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: StudentInput): Promise<StudentRecord> {
    return withTenantQuery(this.pool, async (client) => {
      await lockStudentNoAllocation(client, input.tenantId);
      const studentNo = normalizeStudentNo(input.studentNo) ?? await nextStudentNo(client, input.tenantId);
      const result = await client.query<StudentRow>(
        `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "classId", "responsibleTeacherId", "status", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          studentNo,
          input.firstName,
          input.lastName,
          input.classId ?? null,
          input.responsibleTeacherId ?? null,
          input.status ?? "ACTIVE",
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("STUDENT_CREATE_FAILED");
      }
      return toStudentRecord(record);
    });
  }

  async createMany(inputs: StudentInput[]): Promise<StudentRecord[]> {
    if (inputs.length === 0) return [];

    return withTenantQuery(this.pool, async (client) => {
      const created: StudentRecord[] = [];
      for (const input of inputs) {
        await lockStudentNoAllocation(client, input.tenantId);
        const studentNo = normalizeStudentNo(input.studentNo) ?? await nextStudentNo(client, input.tenantId);
        const result = await client.query<StudentRow>(
          `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "classId", "status", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           RETURNING *`,
          [randomUUID(), input.tenantId, studentNo, input.firstName, input.lastName, input.classId ?? null, input.status ?? "ACTIVE"],
        );
        if (!result.rows[0]) {
          throw new Error("STUDENT_CREATE_FAILED");
        }
        created.push(toStudentRecord(result.rows[0]));
      }
      return created;
    });
  }

  async update(
    id: string,
    input: Partial<Pick<StudentRecord, "firstName" | "lastName" | "classId" | "responsibleTeacherId" | "status">>,
  ): Promise<StudentRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `UPDATE "Student"
         SET "firstName" = COALESCE($2, "firstName"),
             "lastName" = COALESCE($3, "lastName"),
             "classId" = CASE WHEN $4 THEN $5 ELSE "classId" END,
             "responsibleTeacherId" = CASE WHEN $6 THEN $7 ELSE "responsibleTeacherId" END,
             "status" = COALESCE($8, "status"),
             "updatedAt" = now()
         WHERE "id" = $1
           AND "deletedAt" IS NULL
         RETURNING *`,
        [
          id,
          input.firstName ?? null,
          input.lastName ?? null,
          input.classId !== undefined,
          input.classId || null,
          input.responsibleTeacherId !== undefined,
          input.responsibleTeacherId || null,
          input.status ?? null,
        ],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async updateProfile(id: string, input: StudentProfileUpdate): Promise<StudentProfileStorageRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `UPDATE "Student"
         SET "nationalIdEncrypted" = COALESCE($2, "nationalIdEncrypted"),
             "nationalIdHash" = COALESCE($3, "nationalIdHash"),
             "birthDate" = CASE WHEN $4 THEN $5::date ELSE "birthDate" END,
             "phone" = CASE WHEN $6 THEN $7 ELSE "phone" END,
             "email" = CASE WHEN $8 THEN $9 ELSE "email" END,
             "photoKey" = CASE WHEN $10 THEN $11 ELSE "photoKey" END,
             "updatedAt" = now()
         WHERE "id" = $1
           AND "deletedAt" IS NULL
         RETURNING *`,
        [
          id,
          input.nationalIdEncrypted ?? null,
          input.nationalIdHash ?? null,
          input.birthDate !== undefined,
          input.birthDate ?? null,
          input.phone !== undefined,
          input.phone ?? null,
          input.email !== undefined,
          input.email ?? null,
          input.photoKey !== undefined,
          input.photoKey ?? null,
        ],
      );
      return result.rows[0] ? toStudentProfileStorageRecord(result.rows[0]) : undefined;
    });
  }

  async bindUser(tenantId: string, id: string, userId: string): Promise<StudentRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<StudentRow>(
        `UPDATE "Student"
         SET "userId" = $3,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "id" = $2
           AND "deletedAt" IS NULL
         RETURNING *`,
        [tenantId, id, userId],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<StudentRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `UPDATE "Student"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async purgePii(id: string): Promise<StudentRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `UPDATE "Student"
         SET "firstName" = 'Anonim',
             "lastName" = 'Ogrenci',
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }

  async updateTenant(id: string, tenantId: string): Promise<StudentRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentRow>(
        `UPDATE "Student"
         SET "tenantId" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, tenantId],
      );
      return result.rows[0] ? toStudentRecord(result.rows[0]) : undefined;
    });
  }
}

export function createStudentStore(): StudentStore {
  return resolvePersistenceDriver(process.env.STUDENT_STORE) === "postgres" ? new PostgresStudentStore() : new InMemoryStudentStore();
}

async function lockStudentNoAllocation(client: Queryable, tenantId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [tenantId]);
}

async function nextStudentNo(client: Queryable, tenantId: string): Promise<string> {
  const result = await client.query<{ studentNo: string }>(
    `SELECT candidate::text AS "studentNo"
     FROM generate_series(
       ${studentNoStart},
       (
         SELECT GREATEST(
           COALESCE(
             MAX(
               CASE
                 WHEN "studentNo" ~ '^[0-9]+$' AND "studentNo"::integer >= ${studentNoStart}
                   THEN "studentNo"::integer
                 ELSE NULL
               END
             ),
             0
           ) + 1,
           ${studentNoStart}
         )
         FROM "Student"
         WHERE "tenantId" = $1
           AND "deletedAt" IS NULL
       )
     ) AS candidate
     WHERE NOT EXISTS (
       SELECT 1
       FROM "Student"
       WHERE "tenantId" = $1
         AND "deletedAt" IS NULL
         AND "studentNo" = candidate::text
     )
     ORDER BY candidate
     LIMIT 1`,
    [tenantId],
  );
  const studentNo = result.rows[0]?.studentNo;
  if (!studentNo) {
    throw new Error("STUDENT_NO_ALLOCATION_FAILED");
  }
  return studentNo;
}

function normalizeStudentNo(value: string | undefined): string | undefined {
  const studentNo = value?.trim();
  return studentNo ? studentNo : undefined;
}

interface StudentRow {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  studentNo: string | null;
  classId: string | null;
  responsibleTeacherId: string | null;
  status: StudentRecord["status"];
  nationalIdEncrypted: string | null;
  nationalIdHash: string | null;
  birthDate: Date | null;
  phone: string | null;
  email: string | null;
  photoKey: string | null;
  userId: string | null;
  deletedAt: Date | null;
}

function toStudentRecord(row: StudentRow): StudentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentNo: row.studentNo ?? undefined,
    firstName: row.firstName,
    lastName: row.lastName,
    classId: row.classId ?? undefined,
    responsibleTeacherId: row.responsibleTeacherId ?? undefined,
    status: row.status,
    userId: row.userId ?? undefined,
    deletedAt: row.deletedAt?.toISOString(),
  };
}

function toStudentProfileStorageRecord(row: StudentRow): StudentProfileStorageRecord {
  return {
    ...toStudentRecord(row),
    nationalIdEncrypted: row.nationalIdEncrypted ?? undefined,
    nationalIdHash: row.nationalIdHash ?? undefined,
    birthDate: row.birthDate?.toISOString().slice(0, 10),
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    photoKey: row.photoKey ?? undefined,
  };
}
