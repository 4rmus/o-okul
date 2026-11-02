import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

/**
 * T3 read helper for the teacher "Bugün" inbox. The caller passes ids that the owning services already filtered to the
 * teacher's scope (today's own lessons, open homework, teacher-visible students, authorable assessments); this store
 * only aggregates over those ids inside the tenant transaction, so it never widens what the teacher can see.
 */
export interface TeacherTodayInboxInput {
  tenantId: string;
  date: string;
  classIds: readonly string[];
  homeworkIds: readonly string[];
  /** Students the teacher may see (StudentService.list); undefined when unreadable, the submission count is then left out. */
  studentIds?: readonly string[];
  /** Undefined when the gradebook scope could not be read; the draft count is then left out. */
  assessmentIds?: readonly string[];
}

export interface TeacherTodayInboxCounts {
  attendanceClassIds: string[];
  pendingSubmissionCount?: number;
  unpublishedGradeDraftCount?: number;
}

export interface TeacherTodayStore {
  /** Undefined when the persistence driver cannot read the source tables (in-memory driver). */
  loadInbox(input: TeacherTodayInboxInput): Promise<TeacherTodayInboxCounts | undefined>;
}

export const teacherTodayStoreToken = Symbol("TeacherTodayStore");

export class InMemoryTeacherTodayStore implements TeacherTodayStore {
  async loadInbox(_input: TeacherTodayInboxInput): Promise<TeacherTodayInboxCounts | undefined> {
    // In-memory stores of other modules are separate instances; unknown is reported instead of a false zero.
    return undefined;
  }
}

export class PostgresTeacherTodayStore implements TeacherTodayStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul",
    }),
  ) {}

  async loadInbox(input: TeacherTodayInboxInput): Promise<TeacherTodayInboxCounts | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      // Same rule as AttendanceService.getDailyRoster: a record of a student enrolled in the class on that date.
      const attendance = input.classIds.length > 0
        ? await client.query<{ classId: string }>(
            `SELECT DISTINCT enrollment."classId"
             FROM "Attendance" attendance
             INNER JOIN "StudentEnrollment" enrollment
               ON enrollment."tenantId" = attendance."tenantId"
              AND enrollment."studentId" = attendance."studentId"
              AND enrollment."startsAt" <= attendance."date"
              AND (enrollment."endsAt" IS NULL OR enrollment."endsAt" >= attendance."date")
             WHERE attendance."tenantId" = $1
               AND attendance."date" = $2::date
               AND attendance."deletedAt" IS NULL
               AND enrollment."classId" = ANY($3::text[])`,
            [input.tenantId, input.date, [...input.classIds]],
          )
        : { rows: [] };
      // Same rule as HomeworkService.listSubmissions: students the teacher may see who are current, non-deleted members
      // of the homework class. Homework already closed at the homework level (checkedAt) is not waiting any more.
      const studentIds = input.studentIds;
      const submissions = studentIds && studentIds.length > 0 && input.homeworkIds.length > 0
        ? await client.query<{ count: number }>(
            `SELECT COUNT(*)::int AS "count"
             FROM "HomeworkSubmission" submission
             INNER JOIN "Homework" homework
               ON homework."tenantId" = submission."tenantId"
              AND homework."id" = submission."homeworkId"
             INNER JOIN "Student" student
               ON student."tenantId" = submission."tenantId"
              AND student."id" = submission."studentId"
             WHERE submission."tenantId" = $1
               AND submission."homeworkId" = ANY($2::text[])
               AND submission."studentId" = ANY($3::text[])
               AND submission."submittedAt" IS NOT NULL
               AND submission."checkedAt" IS NULL
               AND homework."deletedAt" IS NULL
               AND homework."checkedAt" IS NULL
               AND student."deletedAt" IS NULL
               AND student."classId" = homework."classId"`,
            [input.tenantId, [...input.homeworkIds], [...studentIds]],
          )
        : { rows: [{ count: 0 }] };
      const assessmentIds = input.assessmentIds;
      const drafts = assessmentIds && assessmentIds.length > 0
        ? await client.query<{ count: number }>(
            `SELECT COUNT(DISTINCT entry."assessmentId")::int AS "count"
             FROM "GradeEntry" entry
             WHERE entry."tenantId" = $1
               AND entry."assessmentId" = ANY($2::text[])
               AND entry."publishedAt" IS NULL`,
            [input.tenantId, [...assessmentIds]],
          )
        : { rows: [{ count: 0 }] };
      return {
        attendanceClassIds: attendance.rows.map((row) => row.classId),
        ...(studentIds ? { pendingSubmissionCount: Number(submissions.rows[0]?.count ?? 0) } : {}),
        ...(assessmentIds ? { unpublishedGradeDraftCount: Number(drafts.rows[0]?.count ?? 0) } : {}),
      };
    });
  }
}

export function createTeacherTodayStore(): TeacherTodayStore {
  return resolvePersistenceDriver() === "postgres" ? new PostgresTeacherTodayStore() : new InMemoryTeacherTodayStore();
}
