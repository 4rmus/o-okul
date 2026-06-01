import { randomUUID } from "node:crypto";
import pg from "pg";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { TeacherNoteRecord, TeacherNoteVisibility } from "@uzman-hocam/shared-types";

export interface TeacherNoteStore {
  list(): Promise<TeacherNoteRecord[]>;
  listByStudent(studentId: string): Promise<TeacherNoteRecord[]>;
  findById(id: string): Promise<TeacherNoteRecord | undefined>;
  create(input: Omit<TeacherNoteRecord, "id" | "createdAt">): Promise<TeacherNoteRecord>;
  update(
    id: string,
    input: Pick<TeacherNoteRecord, "body" | "visibility"> & Pick<Partial<TeacherNoteRecord>, "developmentStatus">,
  ): Promise<TeacherNoteRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<TeacherNoteRecord | undefined>;
}

export const teacherNoteStoreToken = Symbol("TeacherNoteStore");

const demoNotes: TeacherNoteRecord[] = [
  {
    id: "teacher-note-internal-a",
    tenantId: "tenant-a",
    studentId: "student-a",
    teacherId: "teacher-a",
    visibility: "INTERNAL",
    body: "Dikkat takibi iç notu",
    developmentStatus: "FOLLOW_UP",
    createdAt: "2026-06-04T09:00:00.000Z",
  },
  {
    id: "teacher-note-visible-a",
    tenantId: "tenant-a",
    studentId: "student-a",
    teacherId: "teacher-a",
    visibility: "GUARDIAN_STUDENT",
    body: "Problem çözme rutini güçleniyor.",
    developmentStatus: "IMPROVING",
    createdAt: "2026-06-04T10:00:00.000Z",
  },
  {
    id: "teacher-note-b",
    tenantId: "tenant-b",
    studentId: "student-b",
    teacherId: "teacher-b",
    visibility: "GUARDIAN_STUDENT",
    body: "Tenant B notu",
    createdAt: "2026-06-04T10:00:00.000Z",
  },
];

export class InMemoryTeacherNoteStore implements TeacherNoteStore {
  private readonly notes = demoNotes.map((record) => ({ ...record }));

  async list(): Promise<TeacherNoteRecord[]> {
    return this.notes.filter((record) => !record.deletedAt);
  }

  async listByStudent(studentId: string): Promise<TeacherNoteRecord[]> {
    return this.notes.filter((record) => record.studentId === studentId && !record.deletedAt);
  }

  async findById(id: string): Promise<TeacherNoteRecord | undefined> {
    return this.notes.find((record) => record.id === id && !record.deletedAt);
  }

  async create(input: Omit<TeacherNoteRecord, "id" | "createdAt">): Promise<TeacherNoteRecord> {
    const record = {
      id: `teacher-note-${this.notes.length + 1}`,
      createdAt: new Date().toISOString(),
      ...input,
    };
    this.notes.push(record);
    return record;
  }

  async update(
    id: string,
    input: Pick<TeacherNoteRecord, "body" | "visibility"> & Pick<Partial<TeacherNoteRecord>, "developmentStatus">,
  ): Promise<TeacherNoteRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.body = input.body;
    record.visibility = input.visibility;
    record.developmentStatus = input.developmentStatus;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<TeacherNoteRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }
}

export class PostgresTeacherNoteStore implements TeacherNoteStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<TeacherNoteRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherNoteRow>(
        `SELECT * FROM "TeacherNote" WHERE "deletedAt" IS NULL ORDER BY "createdAt" ASC, "id" ASC`,
      );
      return result.rows.map(toTeacherNoteRecord);
    });
  }

  async listByStudent(studentId: string): Promise<TeacherNoteRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherNoteRow>(
        `SELECT * FROM "TeacherNote"
         WHERE "studentId" = $1
           AND "deletedAt" IS NULL
         ORDER BY "createdAt" ASC, "id" ASC`,
        [studentId],
      );
      return result.rows.map(toTeacherNoteRecord);
    });
  }

  async findById(id: string): Promise<TeacherNoteRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherNoteRow>(
        `SELECT * FROM "TeacherNote" WHERE "id" = $1 AND "deletedAt" IS NULL LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toTeacherNoteRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<TeacherNoteRecord, "id" | "createdAt">): Promise<TeacherNoteRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherNoteRow>(
        `INSERT INTO "TeacherNote"
           ("id", "tenantId", "studentId", "teacherId", "visibility", "body", "developmentStatus", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId,
          input.studentId,
          input.teacherId,
          input.visibility,
          input.body,
          input.developmentStatus ?? null,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("TEACHER_NOTE_CREATE_FAILED");
      }
      return toTeacherNoteRecord(record);
    });
  }

  async update(
    id: string,
    input: Pick<TeacherNoteRecord, "body" | "visibility"> & Pick<Partial<TeacherNoteRecord>, "developmentStatus">,
  ): Promise<TeacherNoteRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherNoteRow>(
        `UPDATE "TeacherNote"
         SET "body" = $2,
             "visibility" = $3,
             "developmentStatus" = $4,
             "updatedAt" = now()
         WHERE "id" = $1
           AND "deletedAt" IS NULL
         RETURNING *`,
        [id, input.body, input.visibility, input.developmentStatus ?? null],
      );
      return result.rows[0] ? toTeacherNoteRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<TeacherNoteRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<TeacherNoteRow>(
        `UPDATE "TeacherNote"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
           AND "deletedAt" IS NULL
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toTeacherNoteRecord(result.rows[0]) : undefined;
    });
  }
}

export function createTeacherNoteStore(): TeacherNoteStore {
  return process.env.TEACHER_NOTE_STORE === "postgres" ? new PostgresTeacherNoteStore() : new InMemoryTeacherNoteStore();
}

interface TeacherNoteRow {
  id: string;
  tenantId: string;
  studentId: string;
  teacherId: string;
  visibility: TeacherNoteVisibility;
  body: string;
  developmentStatus: string | null;
  createdAt: Date;
  deletedAt: Date | null;
}

function toTeacherNoteRecord(row: TeacherNoteRow): TeacherNoteRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    studentId: row.studentId,
    teacherId: row.teacherId,
    visibility: row.visibility,
    body: row.body,
    developmentStatus: row.developmentStatus ?? undefined,
    createdAt: row.createdAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString(),
  };
}
