import { randomUUID } from "node:crypto";
import type { StudentClassHistoryRecord } from "@uzman-hocam/shared-types";
import pg from "pg";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export type StudentClassHistoryInput = Pick<StudentClassHistoryRecord, "tenantId" | "studentId" | "startsAt"> &
  Partial<Pick<StudentClassHistoryRecord, "classId" | "academicYearId" | "termId" | "endsAt" | "reason">>;

export interface StudentClassHistoryStore {
  listByStudent(studentId: string): Promise<StudentClassHistoryRecord[]>;
  create(input: StudentClassHistoryInput): Promise<StudentClassHistoryRecord>;
  closeActiveForStudent(studentId: string, endsAt: string): Promise<StudentClassHistoryRecord[]>;
}

export const studentClassHistoryStoreToken = Symbol("StudentClassHistoryStore");

const demoHistory: StudentClassHistoryRecord[] = [
  {
    id: "student-class-history-a",
    tenantId: "tenant-a",
    studentId: "student-a",
    classId: "class-a",
    academicYearId: "academic-year-2026",
    termId: "term-2026-spring",
    startsAt: "2026-06-01",
  },
];

export class InMemoryStudentClassHistoryStore implements StudentClassHistoryStore {
  private readonly history = demoHistory.map((record) => ({ ...record }));

  async listByStudent(studentId: string): Promise<StudentClassHistoryRecord[]> {
    return this.history
      .filter((record) => record.studentId === studentId)
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt));
  }

  async create(input: StudentClassHistoryInput): Promise<StudentClassHistoryRecord> {
    const record = {
      id: `student-class-history-${this.history.length + 1}`,
      ...input,
    };
    this.history.push(record);
    return record;
  }

  async closeActiveForStudent(studentId: string, endsAt: string): Promise<StudentClassHistoryRecord[]> {
    const updated: StudentClassHistoryRecord[] = [];
    for (const record of this.history) {
      if (record.studentId === studentId && !record.endsAt) {
        record.endsAt = endsAt;
        record.updatedAt = new Date().toISOString();
        updated.push(record);
      }
    }
    return updated;
  }
}

export class PostgresStudentClassHistoryStore implements StudentClassHistoryStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listByStudent(studentId: string): Promise<StudentClassHistoryRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentClassHistoryRow>(
        `SELECT *
         FROM "StudentClassHistory"
         WHERE "studentId" = $1
         ORDER BY "startsAt" ASC, "id" ASC`,
        [studentId],
      );
      return result.rows.map(toStudentClassHistoryRecord);
    });
  }

  async create(input: StudentClassHistoryInput): Promise<StudentClassHistoryRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentClassHistoryRow>(
        `INSERT INTO "StudentClassHistory" (
           "id",
           "tenantId",
           "studentId",
           "classId",
           "academicYearId",
           "termId",
           "startsAt",
           "endsAt",
           "reason",
           "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7::date, $8::date, $9, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.studentId,
          input.classId ?? null,
          input.academicYearId ?? null,
          input.termId ?? null,
          input.startsAt,
          input.endsAt ?? null,
          input.reason ?? null,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("STUDENT_CLASS_HISTORY_CREATE_FAILED");
      }
      return toStudentClassHistoryRecord(record);
    });
  }

  async closeActiveForStudent(studentId: string, endsAt: string): Promise<StudentClassHistoryRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudentClassHistoryRow>(
        `UPDATE "StudentClassHistory"
         SET "endsAt" = $2::date,
             "updatedAt" = now()
         WHERE "studentId" = $1
           AND "endsAt" IS NULL
         RETURNING *`,
        [studentId, endsAt],
      );
      return result.rows.map(toStudentClassHistoryRecord);
    });
  }
}

export function createStudentClassHistoryStore(): StudentClassHistoryStore {
  return process.env.STUDENT_CLASS_HISTORY_STORE === "postgres"
    ? new PostgresStudentClassHistoryStore()
    : new InMemoryStudentClassHistoryStore();
}

interface StudentClassHistoryRow {
  id: string;
  tenantId: string;
  studentId: string;
  classId: string | null;
  academicYearId: string | null;
  termId: string | null;
  startsAt: Date | string;
  endsAt: Date | string | null;
  reason: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

function toStudentClassHistoryRecord(row: StudentClassHistoryRow): StudentClassHistoryRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    classId: row.classId ?? undefined,
    academicYearId: row.academicYearId ?? undefined,
    termId: row.termId ?? undefined,
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
