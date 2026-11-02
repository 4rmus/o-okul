import pg from "pg";
import type { InstitutionDashboardAcademicOps, TeacherAssignmentRole } from "@o-okul/shared-types";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

/**
 * DEC-20261102-04 read model: Class 360 and the dashboard academic-ops counters share the rules in this file.
 * - Roster: active, non-deleted students whose enrollment in the class covers the day (AttendanceService.getDailyRoster).
 * - Roll call: a roster student with a live attendance row on the day (the teacher "Bugün" rule).
 * - Lessons: live schedule lessons whose start falls on the Istanbul day.
 * - Waiting submissions: submitted, unchecked submissions of open homework by live students of the homework class
 *   (HomeworkService.listSubmissions, teacher "Bugün").
 * - Assessments: those of the class whose live term covers the day; entries are counted per roster student, drafts only
 *   as presence. Scores, averages and draft values are never read (ADR-0011).
 * - Teacher assignments: active CLASS_TEACHER/BRANCH_TEACHER assignments of live teachers; a teacher with an account
 *   needs a live teacher membership.
 */
export interface ClassOverviewClass {
  id: string;
  campusId?: string;
}

export interface ClassOverviewAssignmentSource {
  id: string;
  teacherId: string;
  teacherName: string;
  role: TeacherAssignmentRole;
  courseId?: string;
  courseName?: string;
  termId?: string;
}

export interface ClassOverviewAssessmentSource {
  id: string;
  title: string;
  kind: string;
  heldOn: string;
  courseId: string;
  courseName?: string;
  termId: string;
  enteredCount: number;
  hasDraft: boolean;
  publishedVersion?: number;
}

export interface ClassOverviewSource {
  rosterCount: number;
  lessonCount: number;
  markedCount: number;
  openHomeworkCount: number;
  waitingSubmissionCount: number;
  assignments: ClassOverviewAssignmentSource[];
  assessments: ClassOverviewAssessmentSource[];
}

export type AcademicOpsCounts = Omit<InstitutionDashboardAcademicOps, "date">;

export interface ClassOverviewStore {
  /** The class when it exists in the tenant and is not soft-deleted. */
  findLiveClass(tenantId: string, classId: string): Promise<ClassOverviewClass | undefined>;
  loadSource(tenantId: string, classId: string, date: string): Promise<ClassOverviewSource>;
  /** campusIds set: only classes of these campuses count; undefined: every live class of the tenant. */
  loadAcademicOps(tenantId: string, date: string, campusIds?: readonly string[]): Promise<AcademicOpsCounts>;
}

export const classOverviewStoreToken = Symbol("ClassOverviewStore");

const gradeWriterRoles: readonly TeacherAssignmentRole[] = ["CLASS_TEACHER", "BRANCH_TEACHER"];

export interface ClassOverviewMemoryData {
  classes: Array<{ id: string; tenantId: string; campusId?: string; deletedAt?: string }>;
  students: Array<{ id: string; tenantId: string; classId?: string; status: string; deletedAt?: string }>;
  enrollments: Array<{ tenantId: string; studentId: string; classId?: string; startsAt: string; endsAt?: string }>;
  attendance: Array<{ tenantId: string; studentId: string; date: string; deletedAt?: string }>;
  lessons: Array<{ tenantId: string; classId: string; startsAt: string; deletedAt?: string }>;
  homework: Array<{ id: string; tenantId: string; classId: string; checkedAt?: string; deletedAt?: string }>;
  submissions: Array<{ tenantId: string; homeworkId: string; studentId: string; submittedAt?: string; checkedAt?: string }>;
  terms: Array<{ id: string; tenantId: string; startsAt: string; endsAt: string; deletedAt?: string }>;
  courses: Array<{ id: string; tenantId: string; name: string }>;
  assessments: Array<{
    id: string;
    tenantId: string;
    classId: string;
    courseId: string;
    termId: string;
    kind: string;
    title: string;
    heldOn: string;
    publishedVersion?: number;
  }>;
  entries: Array<{ tenantId: string; assessmentId: string; studentId: string; publishedAt?: string }>;
  teachers: Array<{ id: string; tenantId: string; firstName: string; lastName: string; userId?: string; deletedAt?: string }>;
  memberships: Array<{
    tenantId: string;
    userId: string;
    role: string;
    hasTeacherPersona?: boolean;
    status: string;
    startsAt: string;
    endsAt?: string;
  }>;
  assignments: Array<{
    id: string;
    tenantId: string;
    teacherId: string;
    role: TeacherAssignmentRole;
    classId?: string;
    courseId?: string;
    termId?: string;
    startsAt?: string;
    endsAt?: string;
  }>;
}

export function emptyClassOverviewMemoryData(): ClassOverviewMemoryData {
  return {
    classes: [],
    students: [],
    enrollments: [],
    attendance: [],
    lessons: [],
    homework: [],
    submissions: [],
    terms: [],
    courses: [],
    assessments: [],
    entries: [],
    teachers: [],
    memberships: [],
    assignments: [],
  };
}

/** Mirrors the demo classes of InMemoryClassStore so the in-memory API answers the same ids; other sources start empty. */
function demoClassOverviewMemoryData(): ClassOverviewMemoryData {
  return {
    ...emptyClassOverviewMemoryData(),
    classes: [
      { id: "class-a", tenantId: "tenant-a", campusId: "campus-main" },
      { id: "class-b", tenantId: "tenant-b" },
    ],
  };
}

/** In-memory twin of the Postgres store; the same rules over plain arrays. */
export class InMemoryClassOverviewStore implements ClassOverviewStore {
  constructor(
    private readonly data: ClassOverviewMemoryData = demoClassOverviewMemoryData(),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findLiveClass(tenantId: string, classId: string): Promise<ClassOverviewClass | undefined> {
    const record = this.data.classes.find((candidate) => candidate.tenantId === tenantId && candidate.id === classId && !candidate.deletedAt);
    return record ? { id: record.id, ...(record.campusId ? { campusId: record.campusId } : {}) } : undefined;
  }

  async loadSource(tenantId: string, classId: string, date: string): Promise<ClassOverviewSource> {
    const roster = this.roster(tenantId, classId, date);
    const openHomework = this.data.homework.filter((homework) =>
      homework.tenantId === tenantId && homework.classId === classId && !homework.deletedAt && !homework.checkedAt);
    const openHomeworkIds = new Set(openHomework.map((homework) => homework.id));
    const waitingSubmissionCount = this.data.submissions.filter((submission) => {
      if (submission.tenantId !== tenantId || !openHomeworkIds.has(submission.homeworkId)) return false;
      if (!submission.submittedAt || submission.checkedAt) return false;
      const student = this.data.students.find((candidate) => candidate.tenantId === tenantId && candidate.id === submission.studentId);
      return Boolean(student && !student.deletedAt && student.classId === classId);
    }).length;
    const courseName = (courseId?: string) =>
      courseId ? this.data.courses.find((course) => course.tenantId === tenantId && course.id === courseId)?.name : undefined;

    return {
      rosterCount: roster.size,
      lessonCount: this.data.lessons.filter((lesson) =>
        lesson.tenantId === tenantId && lesson.classId === classId && !lesson.deletedAt && istanbulDay(lesson.startsAt) === date).length,
      markedCount: this.markedStudents(tenantId, roster, date).size,
      openHomeworkCount: openHomework.length,
      waitingSubmissionCount,
      assignments: this.data.assignments
        .filter((assignment) =>
          assignment.tenantId === tenantId &&
          assignment.classId === classId &&
          gradeWriterRoles.includes(assignment.role) &&
          (!assignment.startsAt || assignment.startsAt <= date) &&
          (!assignment.endsAt || assignment.endsAt >= date))
        .flatMap((assignment) => {
          const teacher = this.data.teachers.find((candidate) => candidate.tenantId === tenantId && candidate.id === assignment.teacherId);
          if (!teacher || teacher.deletedAt || !this.hasLiveTeacherMembership(tenantId, teacher.userId)) return [];
          const name = courseName(assignment.courseId);
          return [{
            id: assignment.id,
            teacherId: teacher.id,
            teacherName: `${teacher.firstName} ${teacher.lastName}`.trim(),
            role: assignment.role,
            ...(assignment.courseId ? { courseId: assignment.courseId } : {}),
            ...(name ? { courseName: name } : {}),
            ...(assignment.termId ? { termId: assignment.termId } : {}),
            sortKey: `${teacher.lastName}\u0000${teacher.firstName}\u0000${assignment.id}`,
          }];
        })
        .sort((left, right) => left.sortKey.localeCompare(right.sortKey))
        .map(({ sortKey: _sortKey, ...assignment }) => assignment),
      assessments: this.currentAssessments(tenantId, [classId], date)
        .map((assessment) => {
          const entries = this.data.entries.filter((entry) => entry.tenantId === tenantId && entry.assessmentId === assessment.id);
          const name = courseName(assessment.courseId);
          return {
            id: assessment.id,
            title: assessment.title,
            kind: assessment.kind,
            heldOn: assessment.heldOn,
            courseId: assessment.courseId,
            ...(name ? { courseName: name } : {}),
            termId: assessment.termId,
            enteredCount: new Set(entries.filter((entry) => roster.has(entry.studentId)).map((entry) => entry.studentId)).size,
            hasDraft: entries.some((entry) => !entry.publishedAt),
            ...(assessment.publishedVersion !== undefined ? { publishedVersion: assessment.publishedVersion } : {}),
          };
        })
        .sort((left, right) => right.heldOn.localeCompare(left.heldOn) || left.id.localeCompare(right.id)),
    };
  }

  async loadAcademicOps(tenantId: string, date: string, campusIds?: readonly string[]): Promise<AcademicOpsCounts> {
    const campuses = campusIds ? new Set(campusIds) : undefined;
    const classIds = this.data.classes
      .filter((record) => record.tenantId === tenantId && !record.deletedAt && (!campuses || Boolean(record.campusId && campuses.has(record.campusId))))
      .map((record) => record.id);
    const rosters = new Map(classIds.map((classId) => [classId, this.roster(tenantId, classId, date)]));
    const rollCallMissingClassCount = classIds.filter((classId) => {
      const roster = rosters.get(classId)!;
      const hasLesson = this.data.lessons.some((lesson) =>
        lesson.tenantId === tenantId && lesson.classId === classId && !lesson.deletedAt && istanbulDay(lesson.startsAt) === date);
      return hasLesson && roster.size > 0 && this.markedStudents(tenantId, roster, date).size === 0;
    }).length;
    const assessments = this.currentAssessments(tenantId, classIds, date);
    const entriesOf = (assessmentId: string) =>
      this.data.entries.filter((entry) => entry.tenantId === tenantId && entry.assessmentId === assessmentId);
    return {
      rollCallMissingClassCount,
      missingGradeEntryAssessmentCount: assessments.filter((assessment) => {
        const roster = rosters.get(assessment.classId)!;
        const entered = new Set(entriesOf(assessment.id).filter((entry) => roster.has(entry.studentId)).map((entry) => entry.studentId));
        return roster.size > entered.size;
      }).length,
      unpublishedDraftAssessmentCount: assessments.filter((assessment) => entriesOf(assessment.id).some((entry) => !entry.publishedAt)).length,
    };
  }

  private roster(tenantId: string, classId: string, date: string): Set<string> {
    const live = new Set(this.data.students
      .filter((student) => student.tenantId === tenantId && !student.deletedAt && student.status === "ACTIVE")
      .map((student) => student.id));
    return new Set(this.data.enrollments
      .filter((enrollment) =>
        enrollment.tenantId === tenantId &&
        enrollment.classId === classId &&
        live.has(enrollment.studentId) &&
        enrollment.startsAt <= date &&
        (!enrollment.endsAt || enrollment.endsAt >= date))
      .map((enrollment) => enrollment.studentId));
  }

  private markedStudents(tenantId: string, roster: ReadonlySet<string>, date: string): Set<string> {
    return new Set(this.data.attendance
      .filter((record) => record.tenantId === tenantId && record.date === date && !record.deletedAt && roster.has(record.studentId))
      .map((record) => record.studentId));
  }

  private currentAssessments(tenantId: string, classIds: readonly string[], date: string) {
    const classes = new Set(classIds);
    const currentTerms = new Set(this.data.terms
      .filter((term) => term.tenantId === tenantId && !term.deletedAt && term.startsAt <= date && term.endsAt >= date)
      .map((term) => term.id));
    return this.data.assessments.filter((assessment) =>
      assessment.tenantId === tenantId && classes.has(assessment.classId) && currentTerms.has(assessment.termId));
  }

  private hasLiveTeacherMembership(tenantId: string, userId: string | undefined): boolean {
    if (!userId) return true;
    const now = this.now().toISOString();
    return this.data.memberships.some((membership) =>
      membership.tenantId === tenantId &&
      membership.userId === userId &&
      membership.status === "ACTIVE" &&
      (membership.role === "TEACHER" || membership.hasTeacherPersona === true) &&
      membership.startsAt <= now &&
      (!membership.endsAt || membership.endsAt > now));
  }
}

interface ClassOverviewCountsRow {
  rosterCount: number;
  lessonCount: number;
  markedCount: number;
  openHomeworkCount: number;
  waitingSubmissionCount: number;
}

interface ClassOverviewAssignmentRow {
  id: string;
  teacherId: string;
  firstName: string;
  lastName: string;
  role: TeacherAssignmentRole;
  courseId: string | null;
  courseName: string | null;
  termId: string | null;
}

interface ClassOverviewAssessmentRow {
  id: string;
  title: string;
  kind: string;
  heldOn: string;
  courseId: string;
  courseName: string | null;
  termId: string;
  enteredCount: number;
  hasDraft: boolean;
  publishedVersion: number | null;
}

// Roster of class $2 on day $3 inside tenant $1; the same rule as AttendanceService.getDailyRoster for today.
const classRosterCte = `"roster" AS (
  SELECT DISTINCT student."id"
  FROM "Student" student
  INNER JOIN "StudentEnrollment" enrollment
    ON enrollment."tenantId" = student."tenantId"
   AND enrollment."studentId" = student."id"
  WHERE student."tenantId" = $1
    AND student."deletedAt" IS NULL
    AND student."status" = 'ACTIVE'
    AND enrollment."classId" = $2
    AND enrollment."startsAt" <= $3::date
    AND (enrollment."endsAt" IS NULL OR enrollment."endsAt" >= $3::date)
)`;

export class PostgresClassOverviewStore implements ClassOverviewStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul",
    }),
  ) {}

  async findLiveClass(tenantId: string, classId: string): Promise<ClassOverviewClass | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<{ id: string; campusId: string | null }>(
        `SELECT "id", "campusId"
         FROM "Class"
         WHERE "tenantId" = $1
           AND "id" = $2
           AND "deletedAt" IS NULL
         LIMIT 1`,
        [tenantId, classId],
      );
      const row = result.rows[0];
      return row ? { id: row.id, ...(row.campusId ? { campusId: row.campusId } : {}) } : undefined;
    });
  }

  async loadSource(tenantId: string, classId: string, date: string): Promise<ClassOverviewSource> {
    return withTenantQuery(this.pool, async (client) => {
      const counts = await client.query<ClassOverviewCountsRow>(
        `WITH ${classRosterCte}
         SELECT
           (SELECT COUNT(*)::int FROM "roster") AS "rosterCount",
           (
             SELECT COUNT(*)::int
             FROM "ScheduleLesson" lesson
             WHERE lesson."tenantId" = $1
               AND lesson."classId" = $2
               AND lesson."deletedAt" IS NULL
               AND ((lesson."startsAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul')::date = $3::date
           ) AS "lessonCount",
           (
             SELECT COUNT(DISTINCT attendance."studentId")::int
             FROM "Attendance" attendance
             WHERE attendance."tenantId" = $1
               AND attendance."date" = $3::date
               AND attendance."deletedAt" IS NULL
               AND attendance."studentId" IN (SELECT "id" FROM "roster")
           ) AS "markedCount",
           (
             SELECT COUNT(*)::int
             FROM "Homework" homework
             WHERE homework."tenantId" = $1
               AND homework."classId" = $2
               AND homework."deletedAt" IS NULL
               AND homework."checkedAt" IS NULL
           ) AS "openHomeworkCount",
           (
             SELECT COUNT(*)::int
             FROM "HomeworkSubmission" submission
             INNER JOIN "Homework" homework
               ON homework."tenantId" = submission."tenantId"
              AND homework."id" = submission."homeworkId"
             INNER JOIN "Student" student
               ON student."tenantId" = submission."tenantId"
              AND student."id" = submission."studentId"
             WHERE submission."tenantId" = $1
               AND homework."classId" = $2
               AND homework."deletedAt" IS NULL
               AND homework."checkedAt" IS NULL
               AND submission."submittedAt" IS NOT NULL
               AND submission."checkedAt" IS NULL
               AND student."deletedAt" IS NULL
               AND student."classId" = homework."classId"
           ) AS "waitingSubmissionCount"`,
        [tenantId, classId, date],
      );
      const assignments = await client.query<ClassOverviewAssignmentRow>(
        `SELECT
           assignment."id",
           assignment."teacherId",
           teacher."firstName",
           teacher."lastName",
           assignment."role",
           assignment."courseId",
           course."name" AS "courseName",
           assignment."termId"
         FROM "TeacherAssignment" assignment
         INNER JOIN "Teacher" teacher
           ON teacher."tenantId" = assignment."tenantId"
          AND teacher."id" = assignment."teacherId"
         LEFT JOIN "Course" course
           ON course."tenantId" = assignment."tenantId"
          AND course."id" = assignment."courseId"
         WHERE assignment."tenantId" = $1
           AND assignment."classId" = $2
           AND assignment."role" = ANY($4::text[])
           AND (assignment."startsAt" IS NULL OR assignment."startsAt" <= $3::date)
           AND (assignment."endsAt" IS NULL OR assignment."endsAt" >= $3::date)
           AND teacher."deletedAt" IS NULL
           AND (
             teacher."userId" IS NULL
             OR EXISTS (
               SELECT 1
               FROM "TenantMembership" membership
               WHERE membership."tenantId" = teacher."tenantId"
                 AND membership."userId" = teacher."userId"
                 AND membership."status" = 'ACTIVE'
                 AND (membership."role" = 'TEACHER' OR membership."hasTeacherPersona")
                 AND membership."startsAt" <= now()
                 AND (membership."endsAt" IS NULL OR membership."endsAt" > now())
             )
           )
         ORDER BY teacher."lastName", teacher."firstName", assignment."id"`,
        [tenantId, classId, date, [...gradeWriterRoles]],
      );
      const assessments = await client.query<ClassOverviewAssessmentRow>(
        `WITH ${classRosterCte}
         SELECT
           assessment."id",
           assessment."title",
           assessment."kind",
           to_char(assessment."heldOn", 'YYYY-MM-DD') AS "heldOn",
           assessment."courseId",
           course."name" AS "courseName",
           assessment."termId",
           assessment."publishedVersion",
           (
             SELECT COUNT(DISTINCT entry."studentId")::int
             FROM "GradeEntry" entry
             WHERE entry."tenantId" = $1
               AND entry."assessmentId" = assessment."id"
               AND entry."studentId" IN (SELECT "id" FROM "roster")
           ) AS "enteredCount",
           EXISTS (
             SELECT 1
             FROM "GradeEntry" entry
             WHERE entry."tenantId" = $1
               AND entry."assessmentId" = assessment."id"
               AND entry."publishedAt" IS NULL
           ) AS "hasDraft"
         FROM "GradeAssessment" assessment
         INNER JOIN "AcademicTerm" term
           ON term."tenantId" = assessment."tenantId"
          AND term."id" = assessment."termId"
         LEFT JOIN "Course" course
           ON course."tenantId" = assessment."tenantId"
          AND course."id" = assessment."courseId"
         WHERE assessment."tenantId" = $1
           AND assessment."classId" = $2
           AND term."deletedAt" IS NULL
           AND term."startsAt" <= $3::date
           AND term."endsAt" >= $3::date
         ORDER BY assessment."heldOn" DESC, assessment."id"`,
        [tenantId, classId, date],
      );
      const row = counts.rows[0];
      return {
        rosterCount: Number(row?.rosterCount ?? 0),
        lessonCount: Number(row?.lessonCount ?? 0),
        markedCount: Number(row?.markedCount ?? 0),
        openHomeworkCount: Number(row?.openHomeworkCount ?? 0),
        waitingSubmissionCount: Number(row?.waitingSubmissionCount ?? 0),
        assignments: assignments.rows.map((assignment) => ({
          id: assignment.id,
          teacherId: assignment.teacherId,
          teacherName: `${assignment.firstName} ${assignment.lastName}`.trim(),
          role: assignment.role,
          ...(assignment.courseId ? { courseId: assignment.courseId } : {}),
          ...(assignment.courseName ? { courseName: assignment.courseName } : {}),
          ...(assignment.termId ? { termId: assignment.termId } : {}),
        })),
        assessments: assessments.rows.map((assessment) => ({
          id: assessment.id,
          title: assessment.title,
          kind: assessment.kind,
          heldOn: assessment.heldOn,
          courseId: assessment.courseId,
          ...(assessment.courseName ? { courseName: assessment.courseName } : {}),
          termId: assessment.termId,
          enteredCount: Number(assessment.enteredCount),
          hasDraft: assessment.hasDraft === true,
          ...(assessment.publishedVersion === null ? {} : { publishedVersion: Number(assessment.publishedVersion) }),
        })),
      };
    });
  }

  async loadAcademicOps(tenantId: string, date: string, campusIds?: readonly string[]): Promise<AcademicOpsCounts> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AcademicOpsCounts>(
        `WITH "scopedClass" AS (
           SELECT "id"
           FROM "Class"
           WHERE "tenantId" = $1
             AND "deletedAt" IS NULL
             AND ($3::text[] IS NULL OR "campusId" = ANY($3::text[]))
         ),
         "roster" AS (
           SELECT DISTINCT enrollment."classId", student."id" AS "studentId"
           FROM "Student" student
           INNER JOIN "StudentEnrollment" enrollment
             ON enrollment."tenantId" = student."tenantId"
            AND enrollment."studentId" = student."id"
           WHERE student."tenantId" = $1
             AND student."deletedAt" IS NULL
             AND student."status" = 'ACTIVE'
             AND enrollment."classId" IN (SELECT "id" FROM "scopedClass")
             AND enrollment."startsAt" <= $2::date
             AND (enrollment."endsAt" IS NULL OR enrollment."endsAt" >= $2::date)
         ),
         "rosterSize" AS (
           SELECT "classId", COUNT(*)::int AS "size"
           FROM "roster"
           GROUP BY "classId"
         ),
         "lessonClass" AS (
           SELECT DISTINCT lesson."classId"
           FROM "ScheduleLesson" lesson
           WHERE lesson."tenantId" = $1
             AND lesson."deletedAt" IS NULL
             AND lesson."classId" IN (SELECT "id" FROM "scopedClass")
             AND ((lesson."startsAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Istanbul')::date = $2::date
         ),
         "markedClass" AS (
           SELECT DISTINCT roster."classId"
           FROM "roster" roster
           INNER JOIN "Attendance" attendance
             ON attendance."tenantId" = $1
            AND attendance."studentId" = roster."studentId"
           WHERE attendance."date" = $2::date
             AND attendance."deletedAt" IS NULL
         ),
         "currentAssessment" AS (
           SELECT assessment."id", assessment."classId"
           FROM "GradeAssessment" assessment
           INNER JOIN "AcademicTerm" term
             ON term."tenantId" = assessment."tenantId"
            AND term."id" = assessment."termId"
           WHERE assessment."tenantId" = $1
             AND assessment."classId" IN (SELECT "id" FROM "scopedClass")
             AND term."deletedAt" IS NULL
             AND term."startsAt" <= $2::date
             AND term."endsAt" >= $2::date
         )
         SELECT
           (
             SELECT COUNT(*)::int
             FROM "lessonClass" lesson_class
             INNER JOIN "rosterSize" roster_size ON roster_size."classId" = lesson_class."classId"
             WHERE lesson_class."classId" NOT IN (SELECT "classId" FROM "markedClass")
           ) AS "rollCallMissingClassCount",
           (
             SELECT COUNT(*)::int
             FROM "currentAssessment" current_assessment
             INNER JOIN "rosterSize" roster_size ON roster_size."classId" = current_assessment."classId"
             WHERE roster_size."size" > (
               SELECT COUNT(DISTINCT entry."studentId")
               FROM "GradeEntry" entry
               INNER JOIN "roster" roster
                 ON roster."studentId" = entry."studentId"
                AND roster."classId" = current_assessment."classId"
               WHERE entry."tenantId" = $1
                 AND entry."assessmentId" = current_assessment."id"
             )
           ) AS "missingGradeEntryAssessmentCount",
           (
             SELECT COUNT(*)::int
             FROM "currentAssessment" current_assessment
             WHERE EXISTS (
               SELECT 1
               FROM "GradeEntry" entry
               WHERE entry."tenantId" = $1
                 AND entry."assessmentId" = current_assessment."id"
                 AND entry."publishedAt" IS NULL
             )
           ) AS "unpublishedDraftAssessmentCount"`,
        [tenantId, date, campusIds ? [...new Set(campusIds)] : null],
      );
      const row = result.rows[0];
      return {
        rollCallMissingClassCount: Number(row?.rollCallMissingClassCount ?? 0),
        missingGradeEntryAssessmentCount: Number(row?.missingGradeEntryAssessmentCount ?? 0),
        unpublishedDraftAssessmentCount: Number(row?.unpublishedDraftAssessmentCount ?? 0),
      };
    });
  }
}

export function createClassOverviewStore(): ClassOverviewStore {
  return resolvePersistenceDriver() === "postgres" ? new PostgresClassOverviewStore() : new InMemoryClassOverviewStore();
}

function istanbulDay(value: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date(value));
}
