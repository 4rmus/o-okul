import { randomUUID } from "node:crypto";
import type { TeacherAssignmentRecord, TeacherAssignmentRole } from "@uzman-hocam/shared-types";
import pg from "pg";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export type TeacherAssignmentInput = Pick<TeacherAssignmentRecord, "tenantId" | "teacherId" | "role"> &
  Partial<Pick<TeacherAssignmentRecord, "classId" | "studentId" | "courseId" | "startsAt" | "endsAt">>;

export interface TeacherAssignmentStore {
  list(): Promise<TeacherAssignmentRecord[]>;
  findById(id: string): Promise<TeacherAssignmentRecord | undefined>;
  listByTeacher(teacherId: string): Promise<TeacherAssignmentRecord[]>;
  listByStudent(studentId: string): Promise<TeacherAssignmentRecord[]>;
  create(input: TeacherAssignmentInput): Promise<TeacherAssignmentRecord>;
  update(id: string, input: Partial<TeacherAssignmentInput>): Promise<TeacherAssignmentRecord | undefined>;
  delete(id: string): Promise<boolean>;
}

export const teacherAssignmentStoreToken = Symbol("TeacherAssignmentStore");

const demoAssignments: TeacherAssignmentRecord[] = [
  {
    id: "teacher-assignment-class-a",
    tenantId: "tenant-a",
    teacherId: "teacher-a",
    classId: "class-a",
    role: "CLASS_TEACHER",
  },
  {
    id: "teacher-assignment-student-a",
    tenantId: "tenant-a",
    teacherId: "teacher-a",
    studentId: "student-a",
    role: "RESPONSIBLE_TEACHER",
  },
];

export class InMemoryTeacherAssignmentStore implements TeacherAssignmentStore {
  private readonly assignments = demoAssignments.map((record) => ({ ...record }));

  async list(): Promise<TeacherAssignmentRecord[]> {
    return this.assignments;
  }

  async findById(id: string): Promise<TeacherAssignmentRecord | undefined> {
    return this.assignments.find((assignment) => assignment.id === id);
  }

  async listByTeacher(teacherId: string): Promise<TeacherAssignmentRecord[]> {
    return this.assignments.filter((assignment) => assignment.teacherId === teacherId);
  }

  async listByStudent(studentId: string): Promise<TeacherAssignmentRecord[]> {
    return this.assignments.filter((assignment) => assignment.studentId === studentId);
  }

  async create(input: TeacherAssignmentInput): Promise<TeacherAssignmentRecord> {
    const record = {
      id: `teacher-assignment-${this.assignments.length + 1}`,
      ...input,
    };
    this.assignments.push(record);
    return record;
  }

  async update(id: string, input: Partial<TeacherAssignmentInput>): Promise<TeacherAssignmentRecord | undefined> {
    const index = this.assignments.findIndex((assignment) => assignment.id === id);
    if (index === -1) return undefined;

    const updated = {
      ...this.assignments[index]!,
      ...input,
      updatedAt: new Date().toISOString(),
    };
    this.assignments[index] = updated;
    return updated;
  }

  async delete(id: string): Promise<boolean> {
    const index = this.assignments.findIndex((assignment) => assignment.id === id);
    if (index === -1) return false;

    this.assignments.splice(index, 1);
    return true;
  }
}

export class PostgresTeacherAssignmentStore implements TeacherAssignmentStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<TeacherAssignmentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherAssignmentRow>(`SELECT * FROM "TeacherAssignment"`);
      return result.rows.map(toTeacherAssignmentRecord);
    });
  }

  async findById(id: string): Promise<TeacherAssignmentRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherAssignmentRow>(
        `SELECT * FROM "TeacherAssignment" WHERE "id" = $1 LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toTeacherAssignmentRecord(result.rows[0]) : undefined;
    });
  }

  async listByTeacher(teacherId: string): Promise<TeacherAssignmentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherAssignmentRow>(
        `SELECT * FROM "TeacherAssignment" WHERE "teacherId" = $1`,
        [teacherId],
      );
      return result.rows.map(toTeacherAssignmentRecord);
    });
  }

  async listByStudent(studentId: string): Promise<TeacherAssignmentRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherAssignmentRow>(
        `SELECT * FROM "TeacherAssignment" WHERE "studentId" = $1`,
        [studentId],
      );
      return result.rows.map(toTeacherAssignmentRecord);
    });
  }

  async create(input: TeacherAssignmentInput): Promise<TeacherAssignmentRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherAssignmentRow>(
        `INSERT INTO "TeacherAssignment" (
           "id",
           "tenantId",
           "teacherId",
           "classId",
           "studentId",
           "courseId",
           "role",
           "startsAt",
           "endsAt",
           "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::date, $9::date, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.teacherId,
          input.classId ?? null,
          input.studentId ?? null,
          input.courseId ?? null,
          input.role,
          input.startsAt ?? null,
          input.endsAt ?? null,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("TEACHER_ASSIGNMENT_CREATE_FAILED");
      }
      return toTeacherAssignmentRecord(record);
    });
  }

  async update(id: string, input: Partial<TeacherAssignmentInput>): Promise<TeacherAssignmentRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherAssignmentRow>(
        `UPDATE "TeacherAssignment"
         SET "classId" = CASE WHEN $2 THEN $3 ELSE "classId" END,
             "studentId" = CASE WHEN $4 THEN $5 ELSE "studentId" END,
             "courseId" = CASE WHEN $6 THEN $7 ELSE "courseId" END,
             "role" = COALESCE($8, "role"),
             "startsAt" = CASE WHEN $9 THEN $10::date ELSE "startsAt" END,
             "endsAt" = CASE WHEN $11 THEN $12::date ELSE "endsAt" END,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [
          id,
          input.classId !== undefined,
          input.classId || null,
          input.studentId !== undefined,
          input.studentId || null,
          input.courseId !== undefined,
          input.courseId || null,
          input.role ?? null,
          input.startsAt !== undefined,
          input.startsAt ?? null,
          input.endsAt !== undefined,
          input.endsAt ?? null,
        ],
      );
      return result.rows[0] ? toTeacherAssignmentRecord(result.rows[0]) : undefined;
    });
  }

  async delete(id: string): Promise<boolean> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherAssignmentRow>(
        `DELETE FROM "TeacherAssignment" WHERE "id" = $1 RETURNING *`,
        [id],
      );
      return result.rows.length > 0;
    });
  }
}

export function createTeacherAssignmentStore(): TeacherAssignmentStore {
  return process.env.TEACHER_ASSIGNMENT_STORE === "postgres"
    ? new PostgresTeacherAssignmentStore()
    : new InMemoryTeacherAssignmentStore();
}

interface TeacherAssignmentRow {
  id: string;
  tenantId: string;
  teacherId: string;
  classId: string | null;
  studentId: string | null;
  courseId: string | null;
  role: TeacherAssignmentRole;
  startsAt: Date | string | null;
  endsAt: Date | string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
}

function toTeacherAssignmentRecord(row: TeacherAssignmentRow): TeacherAssignmentRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    teacherId: row.teacherId,
    classId: row.classId ?? undefined,
    studentId: row.studentId ?? undefined,
    courseId: row.courseId ?? undefined,
    role: row.role,
    startsAt: row.startsAt ? toDateString(row.startsAt) : undefined,
    endsAt: row.endsAt ? toDateString(row.endsAt) : undefined,
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
