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

export interface RemoveGradeLevelCourseInput {
  tenantId: string;
  gradeLevelId: string;
  courseId: string;
}

export type RemoveGradeLevelCourseResult =
  | { outcome: "REMOVED"; id: string }
  | { outcome: "IN_USE" }
  | { outcome: "NOT_FOUND" };

export interface GradeLevelCourseStore {
  listByGradeLevel(gradeLevelId: string, alanId?: string): Promise<GradeLevelCourseRecord[]>;
  ensure(input: EnsureGradeLevelCourseInput): Promise<string | undefined>;
  /**
   * UAT F-11: removes the level-wide (alan-less) link; alan-scoped template rows are left untouched.
   * The Postgres adapter refuses (IN_USE) in the same statement when a class of the level still has an
   * active teacher assignment for the course that no alan-scoped row covers; the memory adapter relies on
   * the service pre-check.
   */
  remove(input: RemoveGradeLevelCourseInput): Promise<RemoveGradeLevelCourseResult>;
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

  async remove(input: RemoveGradeLevelCourseInput): Promise<RemoveGradeLevelCourseResult> {
    const index = this.records.findIndex((record) =>
      record.tenantId === input.tenantId
      && record.gradeLevelId === input.gradeLevelId
      && record.courseId === input.courseId
      && !record.alanId,
    );
    if (index < 0) return { outcome: "NOT_FOUND" };
    const [removed] = this.records.splice(index, 1);
    return { outcome: "REMOVED", id: removed!.id };
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

  async remove(input: RemoveGradeLevelCourseInput): Promise<RemoveGradeLevelCourseResult> {
    return withTenantQuery(this.pool, async (client) => {
      const values = [input.tenantId, input.gradeLevelId, input.courseId];
      // Guard and delete in one statement so an assignment created between a separate check and the
      // delete cannot end up pointing at a course the level no longer offers.
      const deleted = await client.query<{ id: string }>(
        `DELETE FROM "GradeLevelCourse" glc
         WHERE glc."tenantId" = $1 AND glc."gradeLevelId" = $2 AND glc."courseId" = $3 AND glc."alanId" IS NULL
           AND NOT EXISTS (
             SELECT 1
             FROM "TeacherAssignment" ta
             JOIN "Class" c ON c."tenantId" = ta."tenantId" AND c."id" = ta."classId" AND c."deletedAt" IS NULL
             WHERE ta."tenantId" = $1 AND ta."courseId" = $3 AND c."gradeLevelId" = $2
               AND (ta."endsAt" IS NULL OR ta."endsAt" >= CURRENT_DATE)
               AND NOT EXISTS (
                 SELECT 1 FROM "GradeLevelCourse" alt
                 WHERE alt."tenantId" = c."tenantId" AND alt."gradeLevelId" = c."gradeLevelId"
                   AND alt."courseId" = ta."courseId" AND alt."alanId" IS NOT NULL AND alt."alanId" = c."alanId"
               )
           )
         RETURNING glc."id"`,
        values,
      );
      if (deleted.rows[0]) return { outcome: "REMOVED", id: deleted.rows[0].id };
      const existing = await client.query<{ id: string }>(
        `SELECT "id" FROM "GradeLevelCourse"
         WHERE "tenantId" = $1 AND "gradeLevelId" = $2 AND "courseId" = $3 AND "alanId" IS NULL`,
        values,
      );
      return existing.rows[0] ? { outcome: "IN_USE" } : { outcome: "NOT_FOUND" };
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
