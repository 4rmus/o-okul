import type { GradeLevelCourseRecord as SharedGradeLevelCourseRecord } from "@o-okul/shared-types";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export type GradeLevelCourseRecord = SharedGradeLevelCourseRecord;

export interface GradeLevelCourseStore {
  listByGradeLevel(gradeLevelId: string, alanId?: string): Promise<GradeLevelCourseRecord[]>;
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
