import pg from "pg";
import type { InstitutionDashboardSummary } from "@o-okul/shared-types";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export interface InstitutionDashboardStore {
  load(tenantId: string, attendanceDate: string): Promise<Omit<InstitutionDashboardSummary, "generatedAt">>;
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
  async load(_tenantId: string, _attendanceDate: string): Promise<Omit<InstitutionDashboardSummary, "generatedAt">> {
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
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul",
    }),
  ) {}

  async load(tenantId: string, attendanceDate: string): Promise<Omit<InstitutionDashboardSummary, "generatedAt">> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<InstitutionDashboardRow>(
        `WITH "latestExam" AS (
           SELECT "id", "title", "startsAt", "createdAt"
           FROM "Exam"
           WHERE "tenantId" = $1
             AND "status" = 'PUBLISHED'
             AND "deletedAt" IS NULL
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
           ) AS "activeStudentCount",
           (
             SELECT COUNT(*)::int
             FROM "Attendance" attendance
             WHERE attendance."tenantId" = $1
               AND attendance."date" = $2::date
               AND attendance."status" IN ('ABSENT', 'LATE')
               AND attendance."deletedAt" IS NULL
           ) AS "attendanceAlertCount",
           (
             SELECT COUNT(*)::int
             FROM "ImportQuarantine" quarantine
             WHERE quarantine."tenantId" = $1
               AND quarantine."status" = 'OPEN'
               AND quarantine."deletedAt" IS NULL
           ) AS "openImportQuarantineCount",
           (
             SELECT COUNT(*)::int
             FROM "SupportTicket" ticket
             WHERE ticket."tenantId" = $1
               AND ticket."status" IN ('OPEN', 'IN_PROGRESS')
               AND ticket."deletedAt" IS NULL
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
           SELECT
             COUNT(*) FILTER (WHERE participant."status" IN ('REGISTERED', 'ATTENDED', 'ABSENT')) AS "registeredParticipantCount",
             COUNT(*) FILTER (WHERE participant."status" = 'ATTENDED') AS "attendedParticipantCount",
             COUNT(*) FILTER (WHERE participant."status" = 'ABSENT') AS "absentParticipantCount"
           FROM "ExamParticipant" participant
           WHERE participant."tenantId" = $1
             AND participant."examId" = exam."id"
             AND participant."deletedAt" IS NULL
         ) participants ON exam."id" IS NOT NULL
         LEFT JOIN "latestReport" report ON true
         WHERE tenant."id" = $1
         LIMIT 1`,
        [tenantId, attendanceDate],
      );
      const row = result.rows[0];
      if (!row) throw new Error("INSTITUTION_DASHBOARD_NOT_FOUND");
      return toInstitutionDashboard(row);
    });
  }
}

export function createInstitutionDashboardStore(): InstitutionDashboardStore {
  return resolvePersistenceDriver() === "postgres"
    ? new PostgresInstitutionDashboardStore()
    : new InMemoryInstitutionDashboardStore();
}

function toInstitutionDashboard(row: InstitutionDashboardRow): Omit<InstitutionDashboardSummary, "generatedAt"> {
  const latestExam = row.examId && row.examTitle
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

function toReportSummary(report: Record<string, unknown>) {
  const averages = isRecord(report.averages) ? report.averages : {};
  const classes = Array.isArray(report.classes) ? report.classes : [];
  const questionCount = readQuestionCount(averages);
  const successRate = readSuccessRate(averages, questionCount);
  const net = readNumber(averages.net);

  return {
    snapshotId: readString(report.snapshotId) ?? "",
    ...(readString(report.generatedAt) ? { generatedAt: readString(report.generatedAt) } : {}),
    resultCount: readNumber(report.resultCount) ?? 0,
    ...(successRate !== undefined ? { successRate } : {}),
    ...(net !== undefined ? { net } : {}),
    ...(questionCount !== undefined ? { questionCount } : {}),
    classes: classes.flatMap((value) => {
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
    }),
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
