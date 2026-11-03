import pg from "pg";
import type { InstitutionDashboardReportSummary, InstitutionDashboardSummary } from "@o-okul/shared-types";
import { PostgresClassOverviewStore } from "../class-overview/class-overview.store.js";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

/**
 * campusIds set: only rows attributable to these campuses are counted; unattributable tenant-wide counters read 0, and
 * the latest exam is left out because exams and report snapshots are tenant-wide (the exam module serves them to
 * tenant-wide staff only).
 */
export interface InstitutionDashboardScope {
  campusIds?: readonly string[];
}

export interface InstitutionDashboardOptions {
  /** DEC-20261102-04: also load the academic-ops counts (same campus scope); left out when they cannot be read. */
  academicOps?: boolean;
}

export interface InstitutionDashboardStore {
  load(
    tenantId: string,
    attendanceDate: string,
    scope?: InstitutionDashboardScope,
    options?: InstitutionDashboardOptions,
  ): Promise<Omit<InstitutionDashboardSummary, "generatedAt">>;
}

export const institutionDashboardStoreToken = Symbol("InstitutionDashboardStore");

interface InstitutionDashboardRow {
  name: string;
  institutionType: string | null;
  contactEmail: string | null;
  logoUrl: string | null;
  activeStudentCount: number;
  attendanceAlertCount: number;
  openImportQuarantineCount: number;
  openSupportTicketCount: number;
  examId: string | null;
  examTitle: string | null;
  examStartsAt: Date | string | null;
  registeredParticipantCount: number;
  attendedParticipantCount: number;
  absentParticipantCount: number;
  report: unknown;
}

export class InMemoryInstitutionDashboardStore implements InstitutionDashboardStore {
  async load(
    _tenantId: string,
    _attendanceDate: string,
    _scope?: InstitutionDashboardScope,
    _options?: InstitutionDashboardOptions,
  ): Promise<Omit<InstitutionDashboardSummary, "generatedAt">> {
    // academicOps is left out: other modules' in-memory stores are separate instances, so unknown beats a false zero.
    return {
      institution: {
        name: "Kurum Paneli",
        institutionType: "study-center",
      },
      activeStudentCount: 0,
      attention: {
        attendanceAlertCount: 0,
        openImportQuarantineCount: 0,
        openSupportTicketCount: 0,
      },
    };
  }
}

export class PostgresInstitutionDashboardStore implements InstitutionDashboardStore {
  private readonly academicOps: PostgresClassOverviewStore;

  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul",
    }),
  ) {
    // Class 360 and the dashboard share one rule set for roster, roll call and grade entry (DEC-20261102-04).
    this.academicOps = new PostgresClassOverviewStore(pool);
  }

  async load(
    tenantId: string,
    attendanceDate: string,
    scope: InstitutionDashboardScope = {},
    options: InstitutionDashboardOptions = {},
  ): Promise<Omit<InstitutionDashboardSummary, "generatedAt">> {
    const dashboard = await this.loadSummary(tenantId, attendanceDate, scope);
    if (!options.academicOps) return dashboard;
    // An unreadable academic-ops source drops the field, not the dashboard (the teacher "Bugün" T3 rule).
    const counts = await this.academicOps
      .loadAcademicOps(tenantId, attendanceDate, scope.campusIds)
      .catch(() => undefined);
    return counts ? { ...dashboard, academicOps: { date: attendanceDate, ...counts } } : dashboard;
  }

  private async loadSummary(
    tenantId: string,
    attendanceDate: string,
    scope: InstitutionDashboardScope,
  ): Promise<Omit<InstitutionDashboardSummary, "generatedAt">> {
    const campusIds = scope.campusIds ? [...new Set(scope.campusIds)] : null;
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<InstitutionDashboardRow>(
        `WITH "latestExam" AS (
           SELECT "id", "title", "startsAt", "createdAt"
           FROM "Exam"
           WHERE "tenantId" = $1
             AND "status" = 'PUBLISHED'
             AND "deletedAt" IS NULL
             AND $3::text[] IS NULL
           ORDER BY COALESCE("startsAt", "createdAt") DESC, "createdAt" DESC
           LIMIT 1
         ),
         "latestReport" AS (
           SELECT jsonb_build_object(
             'snapshotId', snapshot."id",
             'generatedAt', COALESCE(snapshot."snapshotData"->>'generatedAt', snapshot."generatedAt"::text),
             'resultCount', COALESCE(snapshot."snapshotData"->'resultCount', '0'::jsonb),
             'averages', COALESCE(snapshot."snapshotData"->'averages', '{}'::jsonb),
             'classes', COALESCE(snapshot."snapshotData"->'classes', '[]'::jsonb)
           ) AS "report"
           FROM "ReportSnapshot" snapshot
           INNER JOIN "latestExam" exam ON exam."id" = snapshot."examId"
           WHERE snapshot."tenantId" = $1
             AND snapshot."status" = 'READY'
             AND snapshot."snapshotData" IS NOT NULL
             AND snapshot."deletedAt" IS NULL
           ORDER BY snapshot."generatedAt" DESC NULLS LAST, snapshot."createdAt" DESC
           LIMIT 1
         ),
         "scopedClass" AS (
           SELECT "id"
           FROM "Class"
           WHERE "tenantId" = $1
             AND "deletedAt" IS NULL
             AND "campusId" = ANY($3::text[])
         ),
         "scopedStudent" AS (
           SELECT student."id"
           FROM "Student" student
           INNER JOIN "scopedClass" scoped_class ON scoped_class."id" = student."classId"
           WHERE student."tenantId" = $1
         )
         SELECT
           tenant."name",
           tenant."institutionType",
           tenant."contactEmail",
           tenant."logoUrl",
           (
             SELECT COUNT(*)::int
             FROM "Student" student
             WHERE student."tenantId" = $1
               AND student."status" = 'ACTIVE'
               AND student."deletedAt" IS NULL
               AND ($3::text[] IS NULL OR student."id" IN (SELECT "id" FROM "scopedStudent"))
           ) AS "activeStudentCount",
           (
             SELECT COUNT(*)::int
             FROM "Attendance" attendance
             WHERE attendance."tenantId" = $1
               AND attendance."date" = $2::date
               AND attendance."status" IN ('ABSENT', 'LATE')
               AND attendance."deletedAt" IS NULL
               AND ($3::text[] IS NULL OR attendance."studentId" IN (SELECT "id" FROM "scopedStudent"))
           ) AS "attendanceAlertCount",
           (
             SELECT COUNT(*)::int
             FROM "ImportQuarantine" quarantine
             WHERE quarantine."tenantId" = $1
               AND quarantine."status" = 'OPEN'
               AND quarantine."deletedAt" IS NULL
               AND $3::text[] IS NULL
           ) AS "openImportQuarantineCount",
           (
             SELECT COUNT(*)::int
             FROM "SupportTicket" ticket
             WHERE ticket."tenantId" = $1
               AND ticket."status" IN ('OPEN', 'IN_PROGRESS')
               AND ticket."deletedAt" IS NULL
               AND (
                 $3::text[] IS NULL
                 -- Same attribution as the support-ticket service: ticket campus, else the live class's campus, else
                 -- the live student's live class campus; nothing attributable is not counted.
                 OR COALESCE(
                   ticket."campusId",
                   (SELECT ticket_class."campusId" FROM "Class" ticket_class
                     WHERE ticket_class."tenantId" = $1 AND ticket_class."id" = ticket."classId"
                       AND ticket_class."deletedAt" IS NULL),
                   (SELECT student_class."campusId" FROM "Student" ticket_student
                     INNER JOIN "Class" student_class
                       ON student_class."tenantId" = ticket_student."tenantId" AND student_class."id" = ticket_student."classId"
                     WHERE ticket_student."tenantId" = $1 AND ticket_student."id" = ticket."studentId"
                       AND ticket_student."deletedAt" IS NULL AND student_class."deletedAt" IS NULL)
                 ) = ANY($3::text[])
               )
           ) AS "openSupportTicketCount",
           exam."id" AS "examId",
           exam."title" AS "examTitle",
           exam."startsAt" AS "examStartsAt",
           COALESCE(participants."registeredParticipantCount", 0)::int AS "registeredParticipantCount",
           COALESCE(participants."attendedParticipantCount", 0)::int AS "attendedParticipantCount",
           COALESCE(participants."absentParticipantCount", 0)::int AS "absentParticipantCount",
           report."report"
         FROM "Tenant" tenant
         LEFT JOIN "latestExam" exam ON true
         LEFT JOIN LATERAL (
           -- The raw import matches answers to participants by writing ExamResult rows; it never moves the participant
           -- status off REGISTERED. A participant with a live result therefore attended, whatever its status says;
           -- ABSENT counts only a participant marked absent that has no result.
           SELECT
             COUNT(*) FILTER (WHERE participant."status" IN ('REGISTERED', 'ATTENDED', 'ABSENT')) AS "registeredParticipantCount",
             COUNT(*) FILTER (
               WHERE participant."status" IN ('REGISTERED', 'ATTENDED', 'ABSENT')
                 AND (participant."status" = 'ATTENDED' OR participant_result."hasResult")
             ) AS "attendedParticipantCount",
             COUNT(*) FILTER (WHERE participant."status" = 'ABSENT' AND NOT participant_result."hasResult") AS "absentParticipantCount"
           FROM "ExamParticipant" participant
           CROSS JOIN LATERAL (
             SELECT EXISTS (
               SELECT 1
               FROM "ExamResult" result
               WHERE result."tenantId" = $1
                 AND result."examId" = participant."examId"
                 AND result."participantId" = participant."id"
                 AND result."deletedAt" IS NULL
             ) AS "hasResult"
           ) participant_result
           WHERE participant."tenantId" = $1
             AND participant."examId" = exam."id"
             AND participant."deletedAt" IS NULL
             AND ($3::text[] IS NULL OR participant."studentId" IN (SELECT "id" FROM "scopedStudent"))
         ) participants ON exam."id" IS NOT NULL
         LEFT JOIN "latestReport" report ON true
         WHERE tenant."id" = $1
         LIMIT 1`,
        [tenantId, attendanceDate, campusIds],
      );
      const row = result.rows[0];
      if (!row) throw new Error("INSTITUTION_DASHBOARD_NOT_FOUND");
      return toInstitutionDashboard(row, campusIds !== null);
    });
  }
}

export function createInstitutionDashboardStore(): InstitutionDashboardStore {
  return resolvePersistenceDriver() === "postgres"
    ? new PostgresInstitutionDashboardStore()
    : new InMemoryInstitutionDashboardStore();
}

function toInstitutionDashboard(
  row: InstitutionDashboardRow,
  campusScoped: boolean,
): Omit<InstitutionDashboardSummary, "generatedAt"> {
  const latestExam = !campusScoped && row.examId && row.examTitle
    ? {
        examId: row.examId,
        title: row.examTitle,
        ...(row.examStartsAt ? { startsAt: toIsoString(row.examStartsAt) } : {}),
        registeredParticipantCount: row.registeredParticipantCount,
        attendedParticipantCount: row.attendedParticipantCount,
        absentParticipantCount: row.absentParticipantCount,
        reportStatus: isRecord(row.report) ? "READY" as const : "MISSING" as const,
        ...(isRecord(row.report) ? { report: toReportSummary(row.report) } : {}),
      }
    : undefined;

  return {
    institution: {
      name: row.name,
      ...(row.institutionType ? { institutionType: row.institutionType } : {}),
      ...(row.contactEmail ? { contactEmail: row.contactEmail } : {}),
      ...(row.logoUrl ? { logoUrl: row.logoUrl } : {}),
    },
    activeStudentCount: row.activeStudentCount,
    attention: {
      attendanceAlertCount: row.attendanceAlertCount,
      openImportQuarantineCount: row.openImportQuarantineCount,
      openSupportTicketCount: row.openSupportTicketCount,
    },
    ...(latestExam ? { latestExam } : {}),
  };
}

function toReportSummary(report: Record<string, unknown>): InstitutionDashboardReportSummary {
  const averages = isRecord(report.averages) ? report.averages : {};
  const classes = Array.isArray(report.classes) ? report.classes : [];
  const questionCount = readQuestionCount(averages);
  const successRate = readSuccessRate(averages, questionCount);
  const net = readNumber(averages.net);

  const classSummaries = classes.flatMap((value) => {
    if (!isRecord(value)) return [];
    const classAverages = isRecord(value.averages) ? value.averages : {};
    const classQuestionCount = readQuestionCount(classAverages);
    const classSuccessRate = readSuccessRate(classAverages, classQuestionCount);
    const classNet = readNumber(classAverages.net);
    return [{
      ...(readString(value.classId) ? { classId: readString(value.classId) } : {}),
      ...(readString(value.className) ? { className: readString(value.className) } : {}),
      resultCount: readNumber(value.resultCount) ?? 0,
      ...(classSuccessRate !== undefined ? { successRate: classSuccessRate } : {}),
      ...(classNet !== undefined ? { net: classNet } : {}),
      ...(classQuestionCount !== undefined ? { questionCount: classQuestionCount } : {}),
    }];
  });

  return {
    snapshotId: readString(report.snapshotId) ?? "",
    ...(readString(report.generatedAt) ? { generatedAt: readString(report.generatedAt) } : {}),
    resultCount: readNumber(report.resultCount) ?? 0,
    ...(successRate !== undefined ? { successRate } : {}),
    ...(net !== undefined ? { net } : {}),
    ...(questionCount !== undefined ? { questionCount } : {}),
    classes: classSummaries,
  };
}

function readQuestionCount(value: Record<string, unknown>): number | undefined {
  const explicit = readNumber(value.questionCount);
  if (explicit !== undefined) return explicit;
  const correct = readNumber(value.correct);
  const wrong = readNumber(value.wrong);
  const blank = readNumber(value.blank);
  if (correct === undefined || wrong === undefined || blank === undefined) return undefined;
  return correct + wrong + blank;
}

function readSuccessRate(value: Record<string, unknown>, questionCount: number | undefined): number | undefined {
  const explicit = readNumber(value.successRate);
  if (explicit !== undefined) return explicit;
  const net = readNumber(value.net);
  if (net === undefined || questionCount === undefined || questionCount <= 0) return undefined;
  return Math.round((net / questionCount) * 10_000) / 100;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
