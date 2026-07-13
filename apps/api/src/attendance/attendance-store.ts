import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { AttendanceRecord, AttendanceStatus } from "@o-okul/shared-types";

export interface AttendanceStore {
  list(): Promise<AttendanceRecord[]>;
  listByStudent(studentId: string): Promise<AttendanceRecord[]>;
  listByStudentsDate(studentIds: string[], date: string): Promise<AttendanceRecord[]>;
  upsertDaily(inputs: Array<Omit<AttendanceRecord, "id">>): Promise<AttendanceRecord[]>;
}

export const attendanceStoreToken = Symbol("AttendanceStore");

const demoAttendance: AttendanceRecord[] = [
  { id: "attendance-a", tenantId: "tenant-a", studentId: "student-a", courseId: "course-math", termId: "term-2026-spring", date: "2026-06-03", status: "ABSENT" },
  { id: "attendance-b", tenantId: "tenant-b", studentId: "student-b", date: "2026-06-03", status: "PRESENT" },
];

export class InMemoryAttendanceStore implements AttendanceStore {
  private readonly attendance = demoAttendance.map((record) => ({ ...record }));

  async list(): Promise<AttendanceRecord[]> {
    return this.attendance.filter((record) => !record.deletedAt);
  }

  async listByStudent(studentId: string): Promise<AttendanceRecord[]> {
    return this.attendance.filter((record) => record.studentId === studentId && !record.deletedAt);
  }

  async listByStudentsDate(studentIds: string[], date: string): Promise<AttendanceRecord[]> {
    const ids = new Set(studentIds);
    return this.attendance.filter((record) => ids.has(record.studentId) && record.date === date && !record.deletedAt);
  }

  async upsertDaily(inputs: Array<Omit<AttendanceRecord, "id">>): Promise<AttendanceRecord[]> {
    return inputs.map((input) => {
      const existing = this.attendance.find(
        (record) => record.tenantId === input.tenantId && record.studentId === input.studentId && record.date === input.date,
      );
      if (existing) {
        Object.assign(existing, input, { deletedAt: undefined });
        return existing;
      }
      const record = { id: `attendance-${this.attendance.length + 1}`, ...input };
      this.attendance.push(record);
      return record;
    });
  }

}

export class PostgresAttendanceStore implements AttendanceStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<AttendanceRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AttendanceRow>(
        `SELECT * FROM "Attendance" WHERE "deletedAt" IS NULL ORDER BY "date" DESC, "id" ASC`,
      );
      return result.rows.map(toAttendanceRecord);
    });
  }

  async listByStudent(studentId: string): Promise<AttendanceRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AttendanceRow>(
        `SELECT * FROM "Attendance"
         WHERE "studentId" = $1
           AND "deletedAt" IS NULL
         ORDER BY "date" DESC, "id" ASC`,
        [studentId],
      );
      return result.rows.map(toAttendanceRecord);
    });
  }

  async listByStudentsDate(studentIds: string[], date: string): Promise<AttendanceRecord[]> {
    if (studentIds.length === 0) return [];
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AttendanceRow>(
        `SELECT * FROM "Attendance"
         WHERE "studentId" = ANY($1::text[])
           AND "date" = $2::date
           AND "deletedAt" IS NULL
         ORDER BY "id" ASC`,
        [studentIds, date],
      );
      return result.rows.map(toAttendanceRecord);
    });
  }

  async upsertDaily(inputs: Array<Omit<AttendanceRecord, "id">>): Promise<AttendanceRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const records: AttendanceRecord[] = [];
      for (const input of inputs) {
        const result = await client.query<AttendanceRow>(
          `INSERT INTO "Attendance" ("id", "tenantId", "studentId", "courseId", "termId", "date", "status", "updatedAt")
           VALUES ($1, $2, $3, NULL, $4, $5::date, $6, now())
           ON CONFLICT ("tenantId", "studentId", "date")
           DO UPDATE SET "termId" = EXCLUDED."termId",
                         "status" = EXCLUDED."status",
                         "deletedAt" = NULL,
                         "updatedAt" = now()
           RETURNING *`,
          [randomUUID(), input.tenantId, input.studentId, input.termId ?? null, input.date, input.status],
        );
        const record = result.rows[0];
        if (!record) throw new Error("ATTENDANCE_DAILY_UPSERT_FAILED");
        records.push(toAttendanceRecord(record));
      }
      return records;
    });
  }

}

export function createAttendanceStore(): AttendanceStore {
  return resolvePersistenceDriver(process.env.ATTENDANCE_STORE) === "postgres" ? new PostgresAttendanceStore() : new InMemoryAttendanceStore();
}

interface AttendanceRow {
  id: string;
  tenantId: string;
  studentId: string;
  courseId: string | null;
  termId: string | null;
  date: string | Date;
  status: AttendanceStatus;
  deletedAt: Date | null;
}

function toAttendanceRecord(row: AttendanceRow): AttendanceRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    courseId: row.courseId ?? undefined,
    termId: row.termId ?? undefined,
    date: formatDate(row.date),
    status: row.status,
    deletedAt: row.deletedAt?.toISOString(),
  };
}

function formatDate(value: string | Date): string {
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return value.slice(0, 10);
}
