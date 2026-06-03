import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { ScheduleLessonRecord } from "./schedule.service.js";

export interface ScheduleStore {
  list(): Promise<ScheduleLessonRecord[]>;
  findById(id: string): Promise<ScheduleLessonRecord | undefined>;
  create(input: Omit<ScheduleLessonRecord, "id">): Promise<ScheduleLessonRecord>;
  update(
    id: string,
    input: Partial<Pick<ScheduleLessonRecord, "classId" | "teacherId" | "courseId" | "termId" | "title" | "startsAt" | "endsAt">>,
  ): Promise<ScheduleLessonRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<ScheduleLessonRecord | undefined>;
}

export const scheduleStoreToken = Symbol("ScheduleStore");

const demoLessons: ScheduleLessonRecord[] = [
  {
    id: "lesson-a",
    tenantId: "tenant-a",
    classId: "class-a",
    teacherId: "teacher-a",
    courseId: "course-math",
    termId: "term-2026-spring",
    title: "Matematik",
    startsAt: "2026-06-01T09:00:00.000Z",
    endsAt: "2026-06-01T10:00:00.000Z",
  },
  {
    id: "lesson-b",
    tenantId: "tenant-b",
    classId: "class-b",
    teacherId: "teacher-b",
    courseId: "course-turkish",
    termId: "term-2026-spring-b",
    title: "Turkce",
    startsAt: "2026-06-01T09:00:00.000Z",
    endsAt: "2026-06-01T10:00:00.000Z",
  },
];

export class InMemoryScheduleStore implements ScheduleStore {
  private readonly lessons = demoLessons.map((record) => ({ ...record }));

  async list(): Promise<ScheduleLessonRecord[]> {
    return this.lessons;
  }

  async findById(id: string): Promise<ScheduleLessonRecord | undefined> {
    return this.lessons.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<ScheduleLessonRecord, "id">): Promise<ScheduleLessonRecord> {
    const record = {
      id: `lesson-${this.lessons.length + 1}`,
      ...input,
    };
    this.lessons.push(record);
    return record;
  }

  async update(
    id: string,
    input: Partial<Pick<ScheduleLessonRecord, "classId" | "teacherId" | "courseId" | "termId" | "title" | "startsAt" | "endsAt">>,
  ): Promise<ScheduleLessonRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    if (input.classId !== undefined) record.classId = input.classId;
    if (input.teacherId !== undefined) record.teacherId = input.teacherId;
    if (input.courseId !== undefined) record.courseId = input.courseId;
    if (input.termId !== undefined) record.termId = input.termId;
    if (input.title !== undefined) record.title = input.title;
    if (input.startsAt !== undefined) record.startsAt = input.startsAt;
    if (input.endsAt !== undefined) record.endsAt = input.endsAt;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<ScheduleLessonRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }
}

export class PostgresScheduleStore implements ScheduleStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<ScheduleLessonRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ScheduleLessonRow>(`SELECT * FROM "ScheduleLesson"`);
      return result.rows.map(toScheduleLessonRecord);
    });
  }

  async findById(id: string): Promise<ScheduleLessonRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ScheduleLessonRow>(`SELECT * FROM "ScheduleLesson" WHERE "id" = $1 LIMIT 1`, [id]);
      return result.rows[0] ? toScheduleLessonRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<ScheduleLessonRecord, "id">): Promise<ScheduleLessonRecord> {
    return withTenantQuery(this.pool, async (client) => {
      await lockScheduleTeacher(client, input.tenantId, input.teacherId);
      await assertNoScheduleTeacherConflict(client, {
        tenantId: input.tenantId,
        teacherId: input.teacherId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
      });

      const result = await client.query<ScheduleLessonRow>(
        `INSERT INTO "ScheduleLesson" ("id", "tenantId", "classId", "teacherId", "courseId", "termId", "title", "startsAt", "endsAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.classId, input.teacherId, input.courseId ?? null, input.termId ?? null, input.title, input.startsAt, input.endsAt],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("SCHEDULE_LESSON_CREATE_FAILED");
      }
      return toScheduleLessonRecord(record);
    });
  }

  async update(
    id: string,
    input: Partial<Pick<ScheduleLessonRecord, "classId" | "teacherId" | "courseId" | "termId" | "title" | "startsAt" | "endsAt">>,
  ): Promise<ScheduleLessonRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const next = {
        teacherId: input.teacherId ?? existing.teacherId,
        startsAt: input.startsAt ?? existing.startsAt,
        endsAt: input.endsAt ?? existing.endsAt,
      };
      await lockScheduleTeacher(client, existing.tenantId, next.teacherId);
      await assertNoScheduleTeacherConflict(client, {
        tenantId: existing.tenantId,
        teacherId: next.teacherId,
        startsAt: next.startsAt,
        endsAt: next.endsAt,
        excludedLessonId: id,
      });

      const result = await client.query<ScheduleLessonRow>(
        `UPDATE "ScheduleLesson"
         SET "classId" = COALESCE($2, "classId"),
             "teacherId" = COALESCE($3, "teacherId"),
             "courseId" = CASE WHEN $4 THEN $5 ELSE "courseId" END,
             "termId" = CASE WHEN $6 THEN $7 ELSE "termId" END,
             "title" = COALESCE($8, "title"),
             "startsAt" = COALESCE($9, "startsAt"),
             "endsAt" = COALESCE($10, "endsAt"),
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
          input.startsAt ?? null,
          input.endsAt ?? null,
        ],
      );
      return result.rows[0] ? toScheduleLessonRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<ScheduleLessonRecord | undefined> {
    const existing = await this.findById(id);
    if (!existing) return undefined;

    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ScheduleLessonRow>(
        `UPDATE "ScheduleLesson"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toScheduleLessonRecord(result.rows[0]) : undefined;
    });
  }
}

export function createScheduleStore(): ScheduleStore {
  return resolvePersistenceDriver(process.env.SCHEDULE_STORE) === "postgres" ? new PostgresScheduleStore() : new InMemoryScheduleStore();
}

interface ScheduleLessonRow {
  id: string;
  tenantId: string;
  classId: string;
  teacherId: string;
  courseId: string | null;
  termId: string | null;
  title: string;
  startsAt: Date;
  endsAt: Date;
  deletedAt: Date | null;
}

function toScheduleLessonRecord(record: ScheduleLessonRow): ScheduleLessonRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    classId: record.classId,
    teacherId: record.teacherId,
    courseId: record.courseId ?? undefined,
    termId: record.termId ?? undefined,
    title: record.title,
    startsAt: record.startsAt.toISOString(),
    endsAt: record.endsAt.toISOString(),
    deletedAt: record.deletedAt?.toISOString(),
  };
}

async function lockScheduleTeacher(client: Queryable, tenantId: string, teacherId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [`schedule:${tenantId}:teacher:${teacherId}`]);
}

async function assertNoScheduleTeacherConflict(
  client: Queryable,
  input: { tenantId: string; teacherId: string; startsAt: string; endsAt: string; excludedLessonId?: string },
): Promise<void> {
  const result = await client.query<{ exists: number }>(
    `SELECT 1 AS exists
     FROM "ScheduleLesson"
     WHERE "tenantId" = $1
       AND "teacherId" = $2
       AND "deletedAt" IS NULL
       AND "id" <> COALESCE($5, '')
       AND "startsAt" < $4
       AND "endsAt" > $3
     LIMIT 1`,
    [input.tenantId, input.teacherId, input.startsAt, input.endsAt, input.excludedLessonId ?? null],
  );

  if (result.rows[0]) {
    throw new Error("SCHEDULE_TEACHER_CONFLICT");
  }
}
