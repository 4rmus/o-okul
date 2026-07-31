import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { ReportSnapshotRecord } from "./report-generation.service.js";

export interface ReportSnapshotStore {
  listByExam(tenantId: string, examId: string): Promise<ReportSnapshotRecord[]>;
  listByTenant(tenantId: string): Promise<ReportSnapshotRecord[]>;
  listReadyByStudent(tenantId: string, studentId: string, examId?: string): Promise<ReportSnapshotRecord[]>;
  listIndexByTenant?(tenantId: string): Promise<ReportSnapshotRecord[]>;
  findById(tenantId: string, examId: string, snapshotId: string): Promise<ReportSnapshotRecord | undefined>;
  markStaleByExam(tenantId: string, examId: string, reason: string): Promise<number>;
  purgeStudentIdentity?(tenantId: string, studentId: string): Promise<number>;
}

export const reportSnapshotStoreToken = Symbol("ReportSnapshotStore");

const demoSnapshots: ReportSnapshotRecord[] = [
  {
    id: "snapshot-demo",
    tenantId: "tenant-a",
    examId: "exam-demo",
    campusId: "campus-main",
    gradeLevelId: "grade-8",
    classId: "class-a",
    courseId: "course-math",
    termId: "term-2026-spring",
    reportType: "EXAM_RESULT_SUMMARY",
    status: "READY",
    inputRefs: {
      resultKeys: ["participant-a_v1_parser-v1_engine-v1"],
      answerKeyVersions: ["v1"],
      parserConfigVersions: ["parser-v1"],
      engineVersions: ["engine-v1"],
    },
    snapshotData: {
      reportType: "EXAM_RESULT_SUMMARY",
      generatedAt: "2026-06-06T09:00:00.000Z",
      resultCount: 1,
      averages: {
        correct: 18,
        wrong: 2,
        blank: 0,
        net: 17.5,
        rawScore: 87.5,
        standardScore: 87.5,
      },
      branches: [
        {
          branch: "Matematik",
          resultCount: 1,
          correct: 18,
          wrong: 2,
          blank: 0,
          net: 17.5,
        },
      ],
      classes: [
        {
          classId: "class-a",
          className: "8-A",
          resultCount: 1,
          averages: {
            correct: 18,
            wrong: 2,
            blank: 0,
            net: 17.5,
            rawScore: 87.5,
            standardScore: 87.5,
          },
        },
      ],
      students: [
        {
          studentId: "student-a",
          displayName: "Ada A",
          studentNo: "1001",
          classId: "class-a",
          className: "8-A",
          resultKey: "participant-a_v1_parser-v1_engine-v1",
          total: {
            correct: 18,
            wrong: 2,
            blank: 0,
            net: 17.5,
            rawScore: 87.5,
            standardScore: 87.5,
          },
          branches: [
            {
              branch: "Matematik",
              correct: 18,
              wrong: 2,
              blank: 0,
              net: 17.5,
            },
          ],
        },
      ],
    },
    generatedAt: "2026-06-06T09:00:00.000Z",
    createdAt: "2026-06-06T09:00:00.000Z",
    updatedAt: "2026-06-06T09:00:00.000Z",
  },
];

export class InMemoryReportSnapshotStore implements ReportSnapshotStore {
  private readonly snapshots = demoSnapshots.map((record) => ({ ...record }));

  async listByExam(tenantId: string, examId: string): Promise<ReportSnapshotRecord[]> {
    return this.snapshots.filter(
      (snapshot) => snapshot.tenantId === tenantId && snapshot.examId === examId && !snapshot.deletedAt,
    );
  }

  async listByTenant(tenantId: string): Promise<ReportSnapshotRecord[]> {
    return this.snapshots.filter((snapshot) => snapshot.tenantId === tenantId && !snapshot.deletedAt);
  }

  async listReadyByStudent(tenantId: string, studentId: string, examId?: string): Promise<ReportSnapshotRecord[]> {
    return this.snapshots
      .filter((snapshot) =>
        snapshot.tenantId === tenantId
        && snapshot.status === "READY"
        && !snapshot.deletedAt
        && (!examId || snapshot.examId === examId)
        && snapshotStudents(snapshot).some((student) => student.studentId === studentId))
      .map((snapshot) => toStudentProgressRecord(snapshot, studentId));
  }

  async listIndexByTenant(tenantId: string): Promise<ReportSnapshotRecord[]> {
    return (await this.listByTenant(tenantId)).map(toReportIndexRecord);
  }

  async findById(tenantId: string, examId: string, snapshotId: string): Promise<ReportSnapshotRecord | undefined> {
    return this.snapshots.find(
      (snapshot) =>
        snapshot.tenantId === tenantId &&
        snapshot.examId === examId &&
        snapshot.id === snapshotId &&
        !snapshot.deletedAt,
    );
  }

  async markStaleByExam(tenantId: string, examId: string, reason: string): Promise<number> {
    const staleAt = new Date().toISOString();
    let changed = 0;
    for (const snapshot of this.snapshots) {
      if (
        snapshot.tenantId !== tenantId ||
        (
          snapshot.examId !== examId
          && !readStringArray(snapshot.inputRefs.linkedTytExamIds).includes(examId)
        ) ||
        snapshot.deletedAt ||
        snapshot.status === "STALE"
      ) {
        continue;
      }
      snapshot.status = "STALE";
      snapshot.staleAt = staleAt;
      snapshot.updatedAt = staleAt;
      snapshot.inputRefs = {
        ...snapshot.inputRefs,
        staleReason: reason,
      };
      changed += 1;
    }
    return changed;
  }

  async purgeStudentIdentity(tenantId: string, studentId: string): Promise<number> {
    const updatedAt = new Date().toISOString();
    let changed = 0;
    for (const snapshot of this.snapshots) {
      if (snapshot.tenantId !== tenantId || !snapshot.snapshotData || !Array.isArray(snapshot.snapshotData.students)) {
        continue;
      }
      let snapshotChanged = false;
      const students = snapshot.snapshotData.students.map((value) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return value;
        const student = value as Record<string, unknown>;
        if (student.studentId !== studentId || (!Object.hasOwn(student, "displayName") && !Object.hasOwn(student, "studentNo"))) {
          return student;
        }
        const purged = { ...student };
        delete purged.displayName;
        delete purged.studentNo;
        snapshotChanged = true;
        return purged;
      });
      if (!snapshotChanged) continue;
      snapshot.snapshotData = { ...snapshot.snapshotData, students };
      snapshot.updatedAt = updatedAt;
      changed += 1;
    }
    return changed;
  }
}

export class PostgresReportSnapshotStore implements ReportSnapshotStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul",
    }),
  ) {}

  async listByExam(tenantId: string, examId: string): Promise<ReportSnapshotRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ReportSnapshotRow>(
        `SELECT
           "id",
           "tenantId",
           "examId",
           "campusId",
           "gradeLevelId",
           "classId",
           "courseId",
           "termId",
           "reportType",
           "status",
           "inputRefs",
           "snapshotData",
           "generatedAt",
           "staleAt",
           "deletedAt",
           "createdAt",
           "updatedAt"
         FROM "ReportSnapshot"
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "deletedAt" IS NULL
         ORDER BY "generatedAt" DESC NULLS LAST, "createdAt" DESC`,
        [tenantId, examId],
      );
      return result.rows.map(toReportSnapshotRecord);
    });
  }

  async listByTenant(tenantId: string): Promise<ReportSnapshotRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ReportSnapshotRow>(
        `SELECT
           "id",
           "tenantId",
           "examId",
           "campusId",
           "gradeLevelId",
           "classId",
           "courseId",
           "termId",
           "reportType",
           "status",
           "inputRefs",
           "snapshotData",
           "generatedAt",
           "staleAt",
           "deletedAt",
           "createdAt",
           "updatedAt"
         FROM "ReportSnapshot"
         WHERE "tenantId" = $1
           AND "deletedAt" IS NULL
         ORDER BY "generatedAt" DESC NULLS LAST, "createdAt" DESC`,
        [tenantId],
      );
      return result.rows.map(toReportSnapshotRecord);
    });
  }

  async listReadyByStudent(tenantId: string, studentId: string, examId?: string): Promise<ReportSnapshotRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ReportSnapshotRow>(
        `SELECT
           snapshot."id",
           snapshot."tenantId",
           snapshot."examId",
           snapshot."campusId",
           snapshot."gradeLevelId",
           snapshot."classId",
           snapshot."courseId",
           snapshot."termId",
           snapshot."reportType",
           snapshot."status",
           '{}'::jsonb AS "inputRefs",
           jsonb_build_object(
             'generatedAt', snapshot."snapshotData"->'generatedAt',
             'students', (
               SELECT jsonb_agg(student ORDER BY ordinality)
               FROM jsonb_array_elements(snapshot."snapshotData"->'students')
                 WITH ORDINALITY AS entries(student, ordinality)
               WHERE student->>'studentId' = $2
             )
           ) AS "snapshotData",
           snapshot."generatedAt",
           snapshot."staleAt",
           snapshot."deletedAt",
           snapshot."createdAt",
           snapshot."updatedAt"
         FROM "ReportSnapshot" AS snapshot
         WHERE snapshot."tenantId" = $1
           AND snapshot."status" = 'READY'
           AND snapshot."deletedAt" IS NULL
           AND ($3::text IS NULL OR snapshot."examId" = $3)
           AND jsonb_typeof(snapshot."snapshotData"->'students') = 'array'
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements(snapshot."snapshotData"->'students') AS entries(student)
             WHERE student->>'studentId' = $2
           )
         ORDER BY snapshot."generatedAt" DESC NULLS LAST, snapshot."createdAt" DESC`,
        [tenantId, studentId, examId ?? null],
      );
      return result.rows.map(toReportSnapshotRecord);
    });
  }

  async listIndexByTenant(tenantId: string): Promise<ReportSnapshotRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ReportSnapshotRow>(
        `SELECT
           snapshot."id",
           snapshot."tenantId",
           snapshot."examId",
           snapshot."campusId",
           snapshot."gradeLevelId",
           snapshot."classId",
           snapshot."courseId",
           snapshot."termId",
           snapshot."reportType",
           snapshot."status",
           '{}'::jsonb AS "inputRefs",
           CASE
             WHEN snapshot."snapshotData" IS NULL THEN NULL
             ELSE jsonb_build_object(
               'generatedAt', snapshot."snapshotData"->'generatedAt',
               'students', COALESCE((
                 SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
                   'studentId', student->>'studentId',
                   'classId', student->>'classId'
                 )))
                 FROM jsonb_array_elements(
                   CASE
                     WHEN jsonb_typeof(snapshot."snapshotData"->'students') = 'array'
                       THEN snapshot."snapshotData"->'students'
                     ELSE '[]'::jsonb
                   END
                 ) AS entries(student)
               ), '[]'::jsonb)
             )
           END AS "snapshotData",
           snapshot."generatedAt",
           snapshot."staleAt",
           snapshot."deletedAt",
           snapshot."createdAt",
           snapshot."updatedAt"
         FROM "ReportSnapshot" AS snapshot
         WHERE snapshot."tenantId" = $1
           AND snapshot."deletedAt" IS NULL
         ORDER BY snapshot."generatedAt" DESC NULLS LAST, snapshot."createdAt" DESC`,
        [tenantId],
      );
      return result.rows.map(toReportSnapshotRecord);
    });
  }

  async findById(tenantId: string, examId: string, snapshotId: string): Promise<ReportSnapshotRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<ReportSnapshotRow>(
        `SELECT
           "id",
           "tenantId",
           "examId",
           "campusId",
           "gradeLevelId",
           "classId",
           "courseId",
           "termId",
           "reportType",
           "status",
           "inputRefs",
           "snapshotData",
           "generatedAt",
           "staleAt",
           "deletedAt",
           "createdAt",
           "updatedAt"
         FROM "ReportSnapshot"
         WHERE "tenantId" = $1
           AND "examId" = $2
           AND "id" = $3
           AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, examId, snapshotId],
      );
      return result.rows[0] ? toReportSnapshotRecord(result.rows[0]) : undefined;
    });
  }

  async markStaleByExam(tenantId: string, examId: string, reason: string): Promise<number> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE "ReportSnapshot" AS snapshot
         SET "status" = 'STALE',
             "staleAt" = COALESCE("staleAt", now()),
             "inputRefs" = COALESCE("inputRefs", '{}'::jsonb) || $3::jsonb,
             "updatedAt" = now()
         WHERE snapshot."tenantId" = $1
           AND (
             snapshot."examId" = $2
             OR EXISTS (
               SELECT 1
               FROM "Exam" AS linked_exam
               WHERE linked_exam."tenantId" = $1
                 AND linked_exam."id" = snapshot."examId"
                 AND linked_exam."linkedTytExamId" = $2
                 AND linked_exam."deletedAt" IS NULL
             )
           )
           AND snapshot."deletedAt" IS NULL
           AND snapshot."status" <> 'STALE'`,
        [tenantId, examId, JSON.stringify({ staleReason: reason })],
      );
      return result.rowCount ?? 0;
    });
  }

  async purgeStudentIdentity(tenantId: string, studentId: string): Promise<number> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query(
        `UPDATE "ReportSnapshot" AS snapshot
         SET "snapshotData" = jsonb_set(
               snapshot."snapshotData",
               '{students}',
               (
                 SELECT jsonb_agg(
                   CASE
                     WHEN student->>'studentId' = $2 THEN student - 'displayName' - 'studentNo'
                     ELSE student
                   END
                   ORDER BY ordinality
                 )
                 FROM jsonb_array_elements(snapshot."snapshotData"->'students')
                   WITH ORDINALITY AS entries(student, ordinality)
               ),
               false
             ),
             "updatedAt" = now()
         WHERE snapshot."tenantId" = $1
           AND jsonb_typeof(snapshot."snapshotData"->'students') = 'array'
           AND EXISTS (
             SELECT 1
             FROM jsonb_array_elements(snapshot."snapshotData"->'students') AS entries(student)
             WHERE student->>'studentId' = $2
               AND (student ? 'displayName' OR student ? 'studentNo')
           )`,
        [tenantId, studentId],
      );
      return result.rowCount ?? 0;
    });
  }
}

export function createReportSnapshotStore(): ReportSnapshotStore {
  return resolvePersistenceDriver(process.env.REPORT_SNAPSHOT_STORE) === "postgres"
    ? new PostgresReportSnapshotStore()
    : new InMemoryReportSnapshotStore();
}

interface ReportSnapshotRow {
  id: string;
  tenantId: string;
  examId: string;
  campusId: string | null;
  gradeLevelId: string | null;
  classId: string | null;
  courseId: string | null;
  termId: string | null;
  reportType: string;
  status: string;
  inputRefs: unknown;
  snapshotData: unknown;
  generatedAt: Date | string | null;
  staleAt: Date | string | null;
  deletedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
}

function toReportSnapshotRecord(row: ReportSnapshotRow): ReportSnapshotRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    examId: row.examId,
    campusId: row.campusId ?? undefined,
    gradeLevelId: row.gradeLevelId ?? undefined,
    classId: row.classId ?? undefined,
    courseId: row.courseId ?? undefined,
    termId: row.termId ?? undefined,
    reportType: row.reportType,
    status: row.status,
    inputRefs: parseJsonObject(row.inputRefs),
    snapshotData: row.snapshotData === null ? undefined : parseJsonObject(row.snapshotData),
    generatedAt: toOptionalIsoString(row.generatedAt),
    staleAt: toOptionalIsoString(row.staleAt),
    deletedAt: toOptionalIsoString(row.deletedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toReportIndexRecord(snapshot: ReportSnapshotRecord): ReportSnapshotRecord {
  const students = Array.isArray(snapshot.snapshotData?.students)
    ? snapshot.snapshotData.students.flatMap((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const student = value as Record<string, unknown>;
      return [{
        ...(typeof student.studentId === "string" ? { studentId: student.studentId } : {}),
        ...(typeof student.classId === "string" ? { classId: student.classId } : {}),
      }];
    })
    : [];
  return {
    ...snapshot,
    inputRefs: {},
    snapshotData: snapshot.snapshotData
      ? {
        ...(typeof snapshot.snapshotData.generatedAt === "string"
          ? { generatedAt: snapshot.snapshotData.generatedAt }
          : {}),
        students,
      }
      : undefined,
  };
}

function toStudentProgressRecord(snapshot: ReportSnapshotRecord, studentId: string): ReportSnapshotRecord {
  return {
    ...snapshot,
    inputRefs: {},
    snapshotData: {
      ...(typeof snapshot.snapshotData?.generatedAt === "string"
        ? { generatedAt: snapshot.snapshotData.generatedAt }
        : {}),
      students: snapshotStudents(snapshot).filter((student) => student.studentId === studentId),
    },
  };
}

function snapshotStudents(snapshot: ReportSnapshotRecord): Array<Record<string, unknown>> {
  return Array.isArray(snapshot.snapshotData?.students)
    ? snapshot.snapshotData.students.filter(
      (student): student is Record<string, unknown> =>
        Boolean(student) && typeof student === "object" && !Array.isArray(student),
    )
    : [];
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("REPORT_SNAPSHOT_JSON_INVALID");
  }
  return parsed as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toOptionalIsoString(value: Date | string | null): string | undefined {
  return value ? toIsoString(value) : undefined;
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
