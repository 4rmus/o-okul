import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { StudySessionRecord } from "./study-session.service.js";

export interface StudySessionStore {
  list(): Promise<StudySessionRecord[]>;
  findById(id: string): Promise<StudySessionRecord | undefined>;
  create(input: Omit<StudySessionRecord, "id">): Promise<StudySessionRecord>;
  update(
    id: string,
    input: Partial<Pick<StudySessionRecord, "classId" | "teacherId" | "courseId" | "termId" | "studentIds" | "title" | "capacity" | "startsAt" | "endsAt">>,
  ): Promise<StudySessionRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<StudySessionRecord | undefined>;
}

export const studySessionStoreToken = Symbol("StudySessionStore");

const demoSessions: StudySessionRecord[] = [
  {
    id: "study-a",
    tenantId: "tenant-a",
    classId: "class-a",
    teacherId: "teacher-a",
    courseId: "course-math",
    termId: "term-2026-spring",
    studentIds: ["student-a"],
    title: "Matematik Etut",
    capacity: 4,
    startsAt: "2026-06-02T13:00:00.000Z",
    endsAt: "2026-06-02T14:00:00.000Z",
  },
  {
    id: "study-b",
    tenantId: "tenant-b",
    classId: "class-b",
    teacherId: "teacher-b",
    courseId: "course-turkish",
    termId: "term-2026-spring-b",
    studentIds: ["student-b"],
    title: "Turkce Etut",
    capacity: 4,
    startsAt: "2026-06-02T13:00:00.000Z",
    endsAt: "2026-06-02T14:00:00.000Z",
  },
];

export class InMemoryStudySessionStore implements StudySessionStore {
  private readonly sessions = demoSessions.map((record) => ({ ...record, studentIds: [...record.studentIds] }));

  async list(): Promise<StudySessionRecord[]> {
    return this.sessions;
  }

  async findById(id: string): Promise<StudySessionRecord | undefined> {
    return this.sessions.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<StudySessionRecord, "id">): Promise<StudySessionRecord> {
    const record = {
      id: `study-${this.sessions.length + 1}`,
      ...input,
      studentIds: [...input.studentIds],
    };
    this.sessions.push(record);
    return record;
  }

  async update(
    id: string,
    input: Partial<Pick<StudySessionRecord, "classId" | "teacherId" | "courseId" | "termId" | "studentIds" | "title" | "capacity" | "startsAt" | "endsAt">>,
  ): Promise<StudySessionRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.classId !== undefined) record.classId = input.classId;
    if (input.teacherId !== undefined) record.teacherId = input.teacherId;
    if (input.courseId !== undefined) record.courseId = input.courseId;
    if (input.termId !== undefined) record.termId = input.termId;
    if (input.studentIds !== undefined) record.studentIds = [...input.studentIds];
    if (input.title !== undefined) record.title = input.title;
    if (input.capacity !== undefined) record.capacity = input.capacity;
    if (input.startsAt !== undefined) record.startsAt = input.startsAt;
    if (input.endsAt !== undefined) record.endsAt = input.endsAt;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<StudySessionRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }
}

export class PostgresStudySessionStore implements StudySessionStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<StudySessionRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudySessionRow>(`${selectStudySessionsSql()} GROUP BY s."id"`);
      return result.rows.map(toStudySessionRecord);
    });
  }

  async findById(id: string): Promise<StudySessionRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudySessionRow>(`${selectStudySessionsSql()} WHERE s."id" = $1 GROUP BY s."id" LIMIT 1`, [
        id,
      ]);
      return result.rows[0] ? toStudySessionRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<StudySessionRecord, "id">): Promise<StudySessionRecord> {
    return withTenantQuery(this.pool, async (client) => {
      await lockStudySessionResources(client, input.tenantId, input.teacherId, input.studentIds);
      await assertNoStudySessionConflict(client, {
        tenantId: input.tenantId,
        teacherId: input.teacherId,
        studentIds: input.studentIds,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      });

      const result = await client.query<StudySessionBaseRow>(
        `INSERT INTO "StudySession" ("id", "tenantId", "classId", "teacherId", "courseId", "termId", "title", "capacity", "startsAt", "endsAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.classId, input.teacherId, input.courseId ?? null, input.termId ?? null, input.title, input.capacity, input.startsAt, input.endsAt],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("STUDY_SESSION_CREATE_FAILED");
      }

      await this.replaceStudents(client, record.tenantId, record.id, input.studentIds);
      return toStudySessionRecord({ ...record, studentIds: input.studentIds });
    });
  }

  async update(
    id: string,
    input: Partial<Pick<StudySessionRecord, "classId" | "teacherId" | "courseId" | "termId" | "studentIds" | "title" | "capacity" | "startsAt" | "endsAt">>,
  ): Promise<StudySessionRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const next = {
        teacherId: input.teacherId ?? existing.teacherId,
        studentIds: input.studentIds ?? existing.studentIds,
        startsAt: input.startsAt ?? existing.startsAt,
        endsAt: input.endsAt ?? existing.endsAt,
      };
      await lockStudySessionResources(client, existing.tenantId, next.teacherId, next.studentIds);
      await assertNoStudySessionConflict(client, {
        tenantId: existing.tenantId,
        teacherId: next.teacherId,
        studentIds: next.studentIds,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        excludedSessionId: id,
      });

      const result = await client.query<StudySessionBaseRow>(
        `UPDATE "StudySession"
         SET "classId" = COALESCE($2, "classId"),
             "teacherId" = COALESCE($3, "teacherId"),
             "courseId" = CASE WHEN $4 THEN $5 ELSE "courseId" END,
             "termId" = CASE WHEN $6 THEN $7 ELSE "termId" END,
             "title" = COALESCE($8, "title"),
             "capacity" = COALESCE($9, "capacity"),
             "startsAt" = COALESCE($10, "startsAt"),
             "endsAt" = COALESCE($11, "endsAt"),
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [
          id,
          input.classId ?? null,
          input.teacherId ?? null,
          input.courseId !== undefined,
          input.courseId || null,
          input.termId !== undefined,
          input.termId || null,
          input.title ?? null,
          input.capacity ?? null,
          input.startsAt ?? null,
          input.endsAt ?? null,
        ],
      );
      const record = result.rows[0];
      if (!record) return undefined;

      if (input.studentIds !== undefined) {
        await this.replaceStudents(client, record.tenantId, record.id, input.studentIds);
      }
      return toStudySessionRecord({ ...record, studentIds: input.studentIds ?? existing.studentIds });
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<StudySessionRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<StudySessionBaseRow>(
        `UPDATE "StudySession"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      const record = result.rows[0];
      return record ? toStudySessionRecord({ ...record, studentIds: existing.studentIds }) : undefined;
    });
  }

  private async replaceStudents(
    client: Queryable,
    tenantId: string,
    studySessionId: string,
    studentIds: string[],
  ): Promise<void> {
    await client.query(`DELETE FROM "StudySessionStudent" WHERE "tenantId" = $1 AND "studySessionId" = $2`, [
      tenantId,
      studySessionId,
    ]);
    await client.query(
      `INSERT INTO "StudySessionStudent" ("id", "tenantId", "studySessionId", "studentId", "updatedAt")
       SELECT id, $2, $3, "studentId", now()
       FROM unnest($1::text[], $4::text[]) AS input(id, "studentId")`,
      [studentIds.map(() => randomUUID()), tenantId, studySessionId, studentIds],
    );
  }
}

export function createStudySessionStore(): StudySessionStore {
  return resolvePersistenceDriver(process.env.STUDY_SESSION_STORE) === "postgres" ? new PostgresStudySessionStore() : new InMemoryStudySessionStore();
}

interface StudySessionBaseRow {
  id: string;
  tenantId: string;
  classId: string;
  teacherId: string;
  courseId: string | null;
  termId: string | null;
  title: string;
  capacity: number;
  startsAt: Date;
  endsAt: Date;
  deletedAt: Date | null;
}

interface StudySessionRow extends StudySessionBaseRow {
  studentIds: string[];
}

function selectStudySessionsSql(): string {
  return `SELECT s.*,
          COALESCE(array_remove(array_agg(ss."studentId" ORDER BY ss."studentId"), NULL), ARRAY[]::text[]) AS "studentIds"
          FROM "StudySession" s
          LEFT JOIN "StudySessionStudent" ss
            ON ss."tenantId" = s."tenantId" AND ss."studySessionId" = s."id"`;
}

async function lockStudySessionResources(
  client: Queryable,
  tenantId: string,
  teacherId: string,
  studentIds: string[],
): Promise<void> {
  const keys = [
    `study:${tenantId}:teacher:${teacherId}`,
    ...[...new Set(studentIds)].sort().map((studentId) => `study:${tenantId}:student:${studentId}`),
  ];
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended(key, 0))
     FROM unnest($1::text[]) AS locks(key)`,
    [keys],
  );
}

async function assertNoStudySessionConflict(
  client: Queryable,
  input: {
    tenantId: string;
    teacherId: string;
    studentIds: string[];
    startsAt: string;
    endsAt: string;
    excludedSessionId?: string;
  },
): Promise<void> {
  const teacherConflict = await client.query<{ exists: number }>(
    `SELECT 1 AS exists
     FROM "StudySession"
     WHERE "tenantId" = $1
       AND "teacherId" = $2
       AND "deletedAt" IS NULL
       AND "id" <> COALESCE($5, '')
       AND "startsAt" < $4
       AND "endsAt" > $3
     LIMIT 1`,
    [input.tenantId, input.teacherId, input.startsAt, input.endsAt, input.excludedSessionId ?? null],
  );
  if (teacherConflict.rows[0]) {
    throw new Error("STUDY_SESSION_TEACHER_CONFLICT");
  }

  const studentConflict = await client.query<{ exists: number }>(
    `SELECT 1 AS exists
     FROM "StudySession" s
     INNER JOIN "StudySessionStudent" ss
       ON ss."tenantId" = s."tenantId" AND ss."studySessionId" = s."id"
     WHERE s."tenantId" = $1
       AND ss."studentId" = ANY($2::text[])
       AND s."deletedAt" IS NULL
       AND s."id" <> COALESCE($5, '')
       AND s."startsAt" < $4
       AND s."endsAt" > $3
     LIMIT 1`,
    [input.tenantId, input.studentIds, input.startsAt, input.endsAt, input.excludedSessionId ?? null],
  );
  if (studentConflict.rows[0]) {
    throw new Error("STUDY_SESSION_STUDENT_CONFLICT");
  }
}

function toStudySessionRecord(record: StudySessionRow): StudySessionRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    classId: record.classId,
    teacherId: record.teacherId,
    courseId: record.courseId ?? undefined,
    termId: record.termId ?? undefined,
    studentIds: record.studentIds,
    title: record.title,
    capacity: record.capacity,
    startsAt: record.startsAt.toISOString(),
    endsAt: record.endsAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString(),
  };
}
