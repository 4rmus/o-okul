import { randomUUID } from "node:crypto";
import type { StudentEnrollmentRecord, StudentStatus } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export type StudentEnrollmentInput = Pick<StudentEnrollmentRecord, "tenantId" | "studentId" | "startsAt" | "status"> &
  Partial<Pick<StudentEnrollmentRecord, "academicYearId" | "termId" | "classId" | "endsAt" | "reason">>;

export interface StudentEnrollmentStore {
  listByStudent(studentId: string): Promise<StudentEnrollmentRecord[]>;
  listByStudents(studentIds: string[]): Promise<StudentEnrollmentRecord[]>;
  create(input: StudentEnrollmentInput): Promise<StudentEnrollmentRecord>;
  closeActiveForStudent(studentId: string, endsAt: string, status?: StudentStatus): Promise<StudentEnrollmentRecord[]>;
}

export const studentEnrollmentStoreToken = Symbol("StudentEnrollmentStore");

const demoEnrollments: StudentEnrollmentRecord[] = [
  {
    id: "student-enrollment-a",
    tenantId: "tenant-a",
    studentId: "student-a",
    academicYearId: "academic-year-2026",
    termId: "term-2026-spring",
    classId: "class-a",
    status: "ACTIVE",
    startsAt: "2026-06-01",
    reason: "CREATED",
  },
];

export class InMemoryStudentEnrollmentStore implements StudentEnrollmentStore {
  private readonly enrollments = demoEnrollments.map((record) => ({ ...record }));

  async listByStudent(studentId: string): Promise<StudentEnrollmentRecord[]> {
    return this.enrollments
      .filter((record) => record.studentId === studentId)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  }

  async listByStudents(studentIds: string[]): Promise<StudentEnrollmentRecord[]> {
    const ids = new Set(studentIds);
    return this.enrollments
      .filter((record) => ids.has(record.studentId))
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  }

  async create(input: StudentEnrollmentInput): Promise<StudentEnrollmentRecord> {
    const record = {
      id: `student-enrollment-${this.enrollments.length + 1}`,
      ...input,
    };
    this.enrollments.push(record);
    return record;
  }

  async closeActiveForStudent(studentId: string, endsAt: string, status?: StudentStatus): Promise<StudentEnrollmentRecord[]> {
    const updated: StudentEnrollmentRecord[] = [];
    for (const record of this.enrollments) {
      if (record.studentId === studentId && !record.endsAt) {
        record.endsAt = endsAt;
        if (status) record.status = status;
        record.updatedAt = new Date().toISOString();
        updated.push(record);
      }
    }
    return updated;
  }
}

export class PostgresStudentEnrollmentStore implements StudentEnrollmentStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listByStudent(studentId: string): Promise<StudentEnrollmentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentEnrollmentRow>(
        `SELECT *
         FROM "StudentEnrollment"
         WHERE "studentId" = $1
         ORDER BY "startsAt" ASC, "id" ASC`,
        [studentId],
      );
      return result.rows.map(toStudentEnrollmentRecord);
    });
  }

  async listByStudents(studentIds: string[]): Promise<StudentEnrollmentRecord[]> {
    if (studentIds.length === 0) return [];
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentEnrollmentRow>(
        `SELECT *
         FROM "StudentEnrollment"
         WHERE "studentId" = ANY($1::text[])
         ORDER BY "startsAt" ASC, "id" ASC`,
        [studentIds],
      );
      return result.rows.map(toStudentEnrollmentRecord);
    });
  }

  async create(input: StudentEnrollmentInput): Promise<StudentEnrollmentRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentEnrollmentRow>(
        `INSERT INTO "StudentEnrollment" (
           "id",
           "tenantId",
           "studentId",
           "academicYearId",
           "termId",
           "classId",
           "status",
           "startsAt",
           "endsAt",
           "reason",
           "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, $10, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.studentId,
          input.academicYearId ?? null,
          input.termId ?? null,
          input.classId ?? null,
          input.status,
          input.startsAt,
          input.endsAt ?? null,
          input.reason ?? null,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("STUDENT_ENROLLMENT_CREATE_FAILED");
      }
      return toStudentEnrollmentRecord(record);
    });
  }

  async closeActiveForStudent(studentId: string, endsAt: string, status?: StudentStatus): Promise<StudentEnrollmentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentEnrollmentRow>(
        `UPDATE "StudentEnrollment"
         SET "endsAt" = $2::date,
             "status" = COALESCE($3, "status"),
             "updatedAt" = now()
         WHERE "studentId" = $1
           AND "endsAt" IS NULL
         RETURNING *`,
        [studentId, endsAt, status ?? null],
      );
      return result.rows.map(toStudentEnrollmentRecord);
    });
  }
}

export function createStudentEnrollmentStore(): StudentEnrollmentStore {
  return resolvePersistenceDriver(process.env.STUDENT_ENROLLMENT_STORE) === "postgres"
    ? new PostgresStudentEnrollmentStore()
    : new InMemoryStudentEnrollmentStore();
}

interface StudentEnrollmentRow {
  id: string;
  tenantId: string;
  studentId: string;
  academicYearId: string | null;
  termId: string | null;
  classId: string | null;
  status: StudentStatus;
  startsAt: Date | string;
  endsAt: Date | string | null;
  reason: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

function toStudentEnrollmentRecord(row: StudentEnrollmentRow): StudentEnrollmentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    academicYearId: row.academicYearId ?? undefined,
    termId: row.termId ?? undefined,
    classId: row.classId ?? undefined,
    status: row.status,
    startsAt: toDateString(row.startsAt),
    endsAt: row.endsAt ? toDateString(row.endsAt) : undefined,
    reason: row.reason ?? undefined,
    createdAt: row.createdAt ? toIsoString(row.createdAt) : undefined,
    updatedAt: row.updatedAt ? toIsoString(row.updatedAt) : undefined,
  };
}

function toDateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString().slice(0, 10) : value;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
