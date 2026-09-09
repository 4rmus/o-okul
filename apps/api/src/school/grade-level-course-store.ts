import { randomUUID } from "node:crypto";
import type { GradeLevelCourseRecord as SharedGradeLevelCourseRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export type GradeLevelCourseRecord = SharedGradeLevelCourseRecord;

interface EnsureGradeLevelCourseInput {
  tenantId: string;
  gradeLevelId: string;
  courseId: string;
  courseName: string;
  courseCode?: string;
}

export interface GradeLevelCourseStore {
  listByGradeLevel(gradeLevelId: string, alanId?: string): Promise<GradeLevelCourseRecord[]>;
  ensure(input: EnsureGradeLevelCourseInput): Promise<string | undefined>;
}

export const gradeLevelCourseStoreToken = Symbol("GradeLevelCourseStore");

const demoGradeLevelCourses: GradeLevelCourseRecord[] = [
  {
    id: "grade-course-8-math",
    tenantId: "tenant-a",
    gradeLevelId: "grade-8",
    courseId: "course-math",
    isDefault: true,
    sortOrder: 10,
    courseName: "Matematik",
    courseCode: "MAT",
  },
];

export class InMemoryGradeLevelCourseStore implements GradeLevelCourseStore {
  private readonly records = demoGradeLevelCourses.map((record) => ({ ...record }));

  async listByGradeLevel(gradeLevelId: string, alanId?: string): Promise<GradeLevelCourseRecord[]> {
    return this.records
      .filter((record) => record.gradeLevelId === gradeLevelId && (!record.alanId || record.alanId === alanId))
      .sort(compareGradeLevelCourses);
  }

  async ensure(input: EnsureGradeLevelCourseInput): Promise<string | undefined> {
    const existing = this.records.find((record) =>
      record.tenantId === input.tenantId
      && record.gradeLevelId === input.gradeLevelId
      && record.courseId === input.courseId
      && !record.alanId,
    );
    if (existing) return undefined;

    const record: GradeLevelCourseRecord = {
      id: `grade-course-${this.records.length + 1}`,
      ...input,
      isDefault: true,
      sortOrder: 0,
    };
    this.records.push(record);
    return record.id;
  }
}

export class PostgresGradeLevelCourseStore implements GradeLevelCourseStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listByGradeLevel(gradeLevelId: string, alanId?: string): Promise<GradeLevelCourseRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<GradeLevelCourseRow>(
        `SELECT
           glc."id",
           glc."tenantId",
           glc."gradeLevelId",
           glc."courseId",
           glc."alanId",
           glc."isDefault",
           glc."sortOrder",
           course."name" AS "courseName",
           course."code" AS "courseCode",
           alan."name" AS "alanName"
         FROM "GradeLevelCourse" glc
         JOIN "Course" course
           ON course."tenantId" = glc."tenantId"
          AND course."id" = glc."courseId"
          AND course."deletedAt" IS NULL
         LEFT JOIN "Alan" alan
           ON alan."tenantId" = glc."tenantId"
          AND alan."id" = glc."alanId"
          AND alan."deletedAt" IS NULL
         WHERE glc."gradeLevelId" = $1
           AND (glc."alanId" IS NULL OR glc."alanId" = $2)
         ORDER BY glc."sortOrder" ASC, course."name" ASC`,
        [gradeLevelId, alanId ?? null],
      );
      return result.rows.map(toGradeLevelCourseRecord);
    });
  }

  async ensure(input: EnsureGradeLevelCourseInput): Promise<string | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO "GradeLevelCourse" ("id", "tenantId", "gradeLevelId", "courseId", "isDefault", "sortOrder", "updatedAt")
         VALUES ($1, $2, $3, $4, true, 0, now())
         ON CONFLICT ("tenantId", "gradeLevelId", "courseId") WHERE "alanId" IS NULL DO NOTHING
         RETURNING "id"`,
        [randomUUID(), input.tenantId, input.gradeLevelId, input.courseId],
      );
      return inserted.rows[0]?.id;
    });
  }
}

export function createGradeLevelCourseStore(): GradeLevelCourseStore {
  return resolvePersistenceDriver(process.env.GRADE_LEVEL_COURSE_STORE) === "postgres"
    ? new PostgresGradeLevelCourseStore()
    : new InMemoryGradeLevelCourseStore();
}

interface GradeLevelCourseRow {
  id: string;
  tenantId: string;
  gradeLevelId: string;
  courseId: string;
  alanId: string | null;
  isDefault: boolean;
  sortOrder: number;
  courseName: string;
  courseCode: string | null;
  alanName: string | null;
}

function toGradeLevelCourseRecord(row: GradeLevelCourseRow): GradeLevelCourseRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    gradeLevelId: row.gradeLevelId,
    courseId: row.courseId,
    alanId: row.alanId ?? undefined,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    courseName: row.courseName,
    courseCode: row.courseCode ?? undefined,
    alanName: row.alanName ?? undefined,
  };
}

function compareGradeLevelCourses(left: GradeLevelCourseRecord, right: GradeLevelCourseRecord): number {
  return left.sortOrder - right.sortOrder || left.courseName.localeCompare(right.courseName, "tr");
}
