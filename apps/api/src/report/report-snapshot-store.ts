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
  listGradeLevelAnalytics?(tenantId: string, filters: GradeLevelAnalyticsFilters): Promise<GradeLevelAnalyticsProjection>;
}

export const reportSnapshotStoreToken = Symbol("ReportSnapshotStore");

export const gradeLevelAnalyticsReportType = "EXAM_RESULT_SUMMARY";

export interface GradeLevelAnalyticsFilters {
  gradeLevelId: string;
  examType?: string;
  termId?: string;
}

/**
 * DEC-20261102-08 (G3) projection row: one level snapshot per exam (READY preferred over STALE, then the newest), read
 * without the student array. Only `averages` and `resultCount` leave the snapshot JSON.
 */
export interface GradeLevelAnalyticsSnapshotRow {
  snapshotId: string;
  examId: string;
  examTitle: string;
  examType?: string;
  examStartsAt?: string;
  status: "READY" | "STALE";
  generatedAt?: string;
  staleAt?: string;
  resultCount?: number;
  successRate?: number;
  net?: number;
  questionCount?: number;
}

export interface GradeLevelAnalyticsExamRow {
  examId: string;
  examTitle: string;
  examType?: string;
  examStartsAt?: string;
}

export interface GradeLevelAnalyticsProjection {
  snapshots: GradeLevelAnalyticsSnapshotRow[];
  examsWithoutLevelReport: GradeLevelAnalyticsExamRow[];
}

/** In-memory twin inputs: the exam and term columns the Postgres projection joins. */
export interface InMemoryGradeLevelAnalyticsExam {
  id: string;
  tenantId: string;
  title: string;
  status: string;
  gradeLevelId?: string;
  examType?: string;
  startsAt?: string;
  deletedAt?: string;
}

export interface InMemoryGradeLevelAnalyticsTerm {
  id: string;
  tenantId: string;
  startsAt: string;
  endsAt: string;
  deletedAt?: string;
}

export interface InMemoryReportSnapshotStoreOptions {
  snapshots?: ReportSnapshotRecord[];
  exams?: InMemoryGradeLevelAnalyticsExam[];
  terms?: InMemoryGradeLevelAnalyticsTerm[];
}

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
  private readonly snapshots: ReportSnapshotRecord[];
  private readonly exams: InMemoryGradeLevelAnalyticsExam[];
  private readonly terms: InMemoryGradeLevelAnalyticsTerm[];

  constructor(options: InMemoryReportSnapshotStoreOptions = {}) {
    this.snapshots = (options.snapshots ?? demoSnapshots).map((record) => ({ ...record }));
    this.exams = (options.exams ?? []).map((exam) => ({ ...exam }));
    this.terms = (options.terms ?? []).map((term) => ({ ...term }));
  }

  async listGradeLevelAnalytics(tenantId: string, filters: GradeLevelAnalyticsFilters): Promise<GradeLevelAnalyticsProjection> {
    const term = filters.termId
      ? this.terms.find((candidate) => candidate.tenantId === tenantId && candidate.id === filters.termId && !candidate.deletedAt)
      : undefined;
    const examMatches = (exam: InMemoryGradeLevelAnalyticsExam | undefined): exam is InMemoryGradeLevelAnalyticsExam =>
      Boolean(exam)
      && exam!.tenantId === tenantId
      && !exam!.deletedAt
      && exam!.status === "PUBLISHED"
      && (!filters.examType || exam!.examType === filters.examType);
    // Same rule as the Postgres projection: the exam's Türkiye calendar day must fall inside the term window.
    const examInTerm = (exam: InMemoryGradeLevelAnalyticsExam) =>
      Boolean(term && exam.startsAt && isIstanbulDateWithin(exam.startsAt, term.startsAt, term.endsAt));
    const snapshotMatchesTerm = (snapshot: ReportSnapshotRecord, exam: InMemoryGradeLevelAnalyticsExam) =>
      !filters.termId
      || snapshot.termId === filters.termId
      || (!snapshot.termId && examInTerm(exam));
    const isLevelSnapshot = (snapshot: ReportSnapshotRecord) =>
      snapshot.tenantId === tenantId
      && snapshot.gradeLevelId === filters.gradeLevelId
      && !snapshot.campusId
      && !snapshot.classId
      && !snapshot.courseId
      && snapshot.reportType === gradeLevelAnalyticsReportType
      && !snapshot.deletedAt
      && (snapshot.status === "READY" || snapshot.status === "STALE");

    const selected = new Map<string, { snapshot: ReportSnapshotRecord; exam: InMemoryGradeLevelAnalyticsExam }>();
    for (const snapshot of this.snapshots) {
      if (!isLevelSnapshot(snapshot)) continue;
      const exam = this.exams.find((candidate) => candidate.tenantId === tenantId && candidate.id === snapshot.examId);
      if (!examMatches(exam) || !snapshotMatchesTerm(snapshot, exam)) continue;
      const current = selected.get(snapshot.examId);
      if (!current || compareLevelSnapshotPreference(snapshot, current.snapshot) < 0) {
        selected.set(snapshot.examId, { snapshot, exam });
      }
    }

    const snapshots = [...selected.values()].map(({ snapshot, exam }) => {
      const averages = readObject(snapshot.snapshotData?.averages);
      return {
        snapshotId: snapshot.id,
        examId: exam.id,
        examTitle: exam.title,
        ...(exam.examType ? { examType: exam.examType } : {}),
        ...(exam.startsAt ? { examStartsAt: exam.startsAt } : {}),
        status: snapshot.status as "READY" | "STALE",
        ...(snapshot.generatedAt ? { generatedAt: snapshot.generatedAt } : {}),
        ...(snapshot.staleAt ? { staleAt: snapshot.staleAt } : {}),
        ...optionalNumberField("resultCount", snapshot.snapshotData?.resultCount),
        ...optionalNumberField("successRate", averages.successRate),
        ...optionalNumberField("net", averages.net),
        ...optionalNumberField("questionCount", averages.questionCount),
      } satisfies GradeLevelAnalyticsSnapshotRow;
    }).sort(compareAnalyticsRows);

    const examsWithoutLevelReport = this.exams
      .filter((exam) =>
        examMatches(exam)
        && exam.gradeLevelId === filters.gradeLevelId
        && (!filters.termId || examInTerm(exam))
        && !this.snapshots.some((snapshot) =>
          isLevelSnapshot(snapshot)
          && snapshot.examId === exam.id
          && (!filters.termId || !snapshot.termId || snapshot.termId === filters.termId)))
      .map((exam) => ({
        examId: exam.id,
        examTitle: exam.title,
        ...(exam.examType ? { examType: exam.examType } : {}),
        ...(exam.startsAt ? { examStartsAt: exam.startsAt } : {}),
      } satisfies GradeLevelAnalyticsExamRow))
      .sort(compareAnalyticsRows);

    return { snapshots, examsWithoutLevelReport };
  }

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
             'examStartsAt', snapshot."snapshotData"->'examStartsAt',
             'examTitle', snapshot."snapshotData"->'examTitle',
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

  async listGradeLevelAnalytics(tenantId: string, filters: GradeLevelAnalyticsFilters): Promise<GradeLevelAnalyticsProjection> {
    // Level snapshot = gradeLevelId = L with no campus, class or course filter. The term filter accepts a snapshot
    // generated for that term, or a term-less level snapshot of an exam held inside the term window. Exam.startsAt is a
    // timestamp without time zone holding UTC wall time (Prisma); the term window is compared on the Türkiye calendar
    // day, so an exam at 00:30 Istanbul on the first term day belongs to the term, not to the UTC day before. The exam
    // start is read back as timestamptz so node-pg returns the same instant whatever the process time zone is.
    const levelSnapshotPredicate = `
           snapshot."tenantId" = $1
           AND snapshot."gradeLevelId" = $2
           AND snapshot."campusId" IS NULL
           AND snapshot."classId" IS NULL
           AND snapshot."courseId" IS NULL
           AND snapshot."reportType" = $5
           AND snapshot."deletedAt" IS NULL
           AND snapshot."status" IN ('READY', 'STALE')`;
    const examPredicate = `
           exam."tenantId" = $1
           AND exam."deletedAt" IS NULL
           AND exam."status" = 'PUBLISHED'
           AND ($3::text IS NULL OR exam."examType" = $3)`;
    const examInTerm = `EXISTS (
             SELECT 1
             FROM "AcademicTerm" AS term
             WHERE term."tenantId" = $1
               AND term."id" = $4
               AND term."deletedAt" IS NULL
               AND ((exam."startsAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul')::date
                 BETWEEN term."startsAt" AND term."endsAt"
           )`;
    const values = [
      tenantId,
      filters.gradeLevelId,
      filters.examType ?? null,
      filters.termId ?? null,
      gradeLevelAnalyticsReportType,
    ];
    return withTenantQuery(this.pool, async (client) => {
      const snapshots = await client.query<GradeLevelAnalyticsSnapshotDbRow>(
        `SELECT DISTINCT ON (snapshot."examId")
           snapshot."id" AS "snapshotId",
           snapshot."examId",
           exam."title" AS "examTitle",
           exam."examType",
           exam."startsAt" AT TIME ZONE 'UTC' AS "examStartsAt",
           snapshot."status",
           snapshot."generatedAt",
           snapshot."staleAt",
           snapshot."snapshotData"->'resultCount' AS "resultCount",
           snapshot."snapshotData"->'averages'->'successRate' AS "successRate",
           snapshot."snapshotData"->'averages'->'net' AS "net",
           snapshot."snapshotData"->'averages'->'questionCount' AS "questionCount"
         FROM "ReportSnapshot" AS snapshot
         JOIN "Exam" AS exam
           ON exam."tenantId" = snapshot."tenantId"
          AND exam."id" = snapshot."examId"
         WHERE ${levelSnapshotPredicate}
           AND ${examPredicate}
           AND (
             $4::text IS NULL
             OR snapshot."termId" = $4
             OR (snapshot."termId" IS NULL AND ${examInTerm})
           )
         ORDER BY
           snapshot."examId",
           (snapshot."status" = 'READY') DESC,
           (snapshot."termId" IS NULL) DESC,
           snapshot."generatedAt" DESC NULLS LAST,
           snapshot."updatedAt" DESC,
           snapshot."id" ASC`,
        values,
      );
      const examsWithoutLevelReport = await client.query<GradeLevelAnalyticsExamDbRow>(
        `SELECT
           exam."id" AS "examId",
           exam."title" AS "examTitle",
           exam."examType",
           exam."startsAt" AT TIME ZONE 'UTC' AS "examStartsAt"
         FROM "Exam" AS exam
         WHERE ${examPredicate}
           AND exam."gradeLevelId" = $2
           AND ($4::text IS NULL OR ${examInTerm})
           AND NOT EXISTS (
             SELECT 1
             FROM "ReportSnapshot" AS snapshot
             WHERE ${levelSnapshotPredicate}
               AND snapshot."examId" = exam."id"
               AND ($4::text IS NULL OR snapshot."termId" IS NULL OR snapshot."termId" = $4)
           )
         ORDER BY exam."startsAt" ASC NULLS LAST, exam."id" ASC`,
        values,
      );
      return {
        snapshots: snapshots.rows.map(toGradeLevelAnalyticsSnapshotRow).sort(compareAnalyticsRows),
        examsWithoutLevelReport: examsWithoutLevelReport.rows.map(toGradeLevelAnalyticsExamRow).sort(compareAnalyticsRows),
      };
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

interface GradeLevelAnalyticsExamDbRow {
  examId: string;
  examTitle: string;
  examType: string | null;
  examStartsAt: Date | string | null;
}

interface GradeLevelAnalyticsSnapshotDbRow extends GradeLevelAnalyticsExamDbRow {
  snapshotId: string;
  status: string;
  generatedAt: Date | string | null;
  staleAt: Date | string | null;
  resultCount: unknown;
  successRate: unknown;
  net: unknown;
  questionCount: unknown;
}

function toGradeLevelAnalyticsExamRow(row: GradeLevelAnalyticsExamDbRow): GradeLevelAnalyticsExamRow {
  const examStartsAt = toOptionalIsoString(row.examStartsAt);
  return {
    examId: row.examId,
    examTitle: row.examTitle,
    ...(row.examType ? { examType: row.examType } : {}),
    ...(examStartsAt ? { examStartsAt } : {}),
  };
}

function toGradeLevelAnalyticsSnapshotRow(row: GradeLevelAnalyticsSnapshotDbRow): GradeLevelAnalyticsSnapshotRow {
  if (row.status !== "READY" && row.status !== "STALE") {
    throw new Error("REPORT_SNAPSHOT_STATUS_INVALID");
  }
  const generatedAt = toOptionalIsoString(row.generatedAt);
  const staleAt = toOptionalIsoString(row.staleAt);
  return {
    ...toGradeLevelAnalyticsExamRow(row),
    snapshotId: row.snapshotId,
    status: row.status,
    ...(generatedAt ? { generatedAt } : {}),
    ...(staleAt ? { staleAt } : {}),
    ...optionalNumberField("resultCount", row.resultCount),
    ...optionalNumberField("successRate", row.successRate),
    ...optionalNumberField("net", row.net),
    ...optionalNumberField("questionCount", row.questionCount),
  };
}

/** READY before STALE, a term-less level snapshot before a term-filtered one, then the newest generation. */
function compareLevelSnapshotPreference(left: ReportSnapshotRecord, right: ReportSnapshotRecord): number {
  return Number(right.status === "READY") - Number(left.status === "READY")
    || Number(!right.termId) - Number(!left.termId)
    || compareOptionalTimeDesc(left.generatedAt, right.generatedAt)
    || compareOptionalTimeDesc(left.updatedAt, right.updatedAt)
    || left.id.localeCompare(right.id);
}

function compareOptionalTimeDesc(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return Date.parse(right) - Date.parse(left);
}

/** Chronological by exam date (undated last), then exam id, so both store twins return the same order. */
function compareAnalyticsRows(left: GradeLevelAnalyticsExamRow, right: GradeLevelAnalyticsExamRow): number {
  if (left.examStartsAt !== right.examStartsAt) {
    if (!left.examStartsAt) return 1;
    if (!right.examStartsAt) return -1;
    const delta = Date.parse(left.examStartsAt) - Date.parse(right.examStartsAt);
    if (delta !== 0) return delta;
  }
  return left.examId < right.examId ? -1 : left.examId > right.examId ? 1 : 0;
}

const istanbulDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Istanbul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Türkiye calendar day ("2026-09-01") of an ISO instant; a bare calendar day is returned as is. */
function istanbulDateKey(value: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : istanbulDateFormatter.format(date);
}

function isIstanbulDateWithin(value: string, startsAt: string, endsAt: string): boolean {
  const day = istanbulDateKey(value);
  return day !== undefined && day >= startsAt.slice(0, 10) && day <= endsAt.slice(0, 10);
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionalNumberField<TKey extends string>(key: TKey, value: unknown): Partial<Record<TKey, number>> {
  return typeof value === "number" && Number.isFinite(value) ? { [key]: value } as Record<TKey, number> : {};
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
      ...(typeof snapshot.snapshotData?.examStartsAt === "string"
        ? { examStartsAt: snapshot.snapshotData.examStartsAt }
        : {}),
      ...(typeof snapshot.snapshotData?.examTitle === "string"
        ? { examTitle: snapshot.snapshotData.examTitle }
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
