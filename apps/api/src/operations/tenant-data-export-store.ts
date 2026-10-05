import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import type { RequestContext } from "../context/request-context.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery, withTenantQuery } from "../db/tenant-query.js";

export interface TenantDataExportPayload {
  formatVersion: "tenant-export-v1";
  tenantId: string;
  generatedByUserId: string;
  exportedAt: string;
  scope: "tenant-user-entered-data";
  rowLimitPerTable: number;
  tables: Record<string, unknown[]>;
  warnings: string[];
}

export interface TenantDataExportStore {
  createExport(context: RequestContext): Promise<TenantDataExportPayload>;
}

export const tenantDataExportStoreToken = Symbol("tenantDataExportStore");

const rowLimitPerTable = 5000;
const commonOmittedColumns = ["tenantId", "deletedAt"];

const exportTables = [
  table("campuses", "Campus"),
  table("gradeLevels", "GradeLevel"),
  table("classes", "Class"),
  table("courses", "Course"),
  table("academicYears", "AcademicYear"),
  table("academicTerms", "AcademicTerm"),
  table("students", "Student", ["nationalIdEncrypted", "nationalIdHash", "photoKey"]),
  table("studentEnrollments", "StudentEnrollment", [], false),
  table("teachers", "Teacher"),
  table("teacherAssignments", "TeacherAssignment", [], false),
  table("guardians", "Guardian"),
  table("guardianStudents", "GuardianStudent", [], false),
  table("paymentPlans", "PaymentPlan"),
  table("paymentInstallments", "PaymentInstallment"),
  table("attendance", "Attendance"),
  table("teacherNotes", "TeacherNote"),
  table("gradeAssessments", "GradeAssessment", [], false),
  table("gradeEntries", "GradeEntry", [], false),
  table("homeworkMaterials", "HomeworkMaterial"),
  table("homeworkMaterialAssignments", "HomeworkMaterialAssignment"),
  table("homeworkSubmissions", "HomeworkSubmission", [], false),
  table("exams", "Exam"),
  table("examParticipants", "ExamParticipant"),
  table("answerKeys", "AnswerKey"),
  table("examResults", "ExamResult"),
  table("reportSnapshots", "ReportSnapshot"),
  table("announcements", "Announcement"),
  table("messageTemplates", "MessageTemplate"),
  table("supportTickets", "SupportTicket"),
  table("supportTicketAttachments", "SupportTicketAttachment", ["contentBase64", "storageKey"]),
  table("supportTicketComments", "SupportTicketComment", [], false),
] as const;

export const tenantDataExportTableNames: readonly string[] = exportTables.map((config) => config.tableName);

interface ExportTableConfig {
  key: string;
  tableName: string;
  omittedColumns: string[];
  hasDeletedAt: boolean;
}

export function createTenantDataExportStore(): TenantDataExportStore {
  return resolvePersistenceDriver(process.env.TENANT_DATA_EXPORT_STORE) === "postgres"
    ? new PostgresTenantDataExportStore()
    : new InMemoryTenantDataExportStore();
}

class InMemoryTenantDataExportStore implements TenantDataExportStore {
  async createExport(context: RequestContext): Promise<TenantDataExportPayload> {
    return createEmptyPayload(context, ["MEMORY_STORE_EXPORT_CONTAINS_NO_DURABLE_POSTGRES_ROWS"]);
  }
}

class PostgresTenantDataExportStore implements TenantDataExportStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul",
    }),
  ) {}

  async createExport(context: RequestContext): Promise<TenantDataExportPayload> {
    return withTenantQuery(this.pool, async (client) => {
      const tables: Record<string, unknown[]> = {};
      for (const config of exportTables) {
        tables[config.key] = await readExportRows(client, config);
      }

      return {
        formatVersion: "tenant-export-v1",
        tenantId: requireTenantId(context),
        generatedByUserId: context.userId,
        exportedAt: new Date().toISOString(),
        scope: "tenant-user-entered-data",
        rowLimitPerTable,
        tables,
        warnings: [],
      };
    });
  }
}

export interface TenantHandoverExportPayload extends Omit<TenantDataExportPayload, "scope" | "rowLimitPerTable"> {
  exportId: string;
  scope: "license-expiry-purge-handover";
  rowLimitPerTable: null;
}

// Product owner decision (2026-10-05): before a license-expiry purge the institution receives its data.
// Same tables and column redaction as the institution's own export, plus payment transactions (its
// accounting retention moves to this file), and no row limit so nothing is silently truncated.
const handoverTables = [...exportTables, table("paymentTransactions", "PaymentTransaction", [], false)];
export async function createTenantHandoverExport(pool: TenantQueryable, tenantId: string, actorUserId: string, exportId: string): Promise<TenantHandoverExportPayload> {
  return withExplicitTenantQuery(pool, tenantId, async (client) => {
    const tables: Record<string, unknown[]> = {};
    for (const config of handoverTables) tables[config.key] = await readExportRows(client, config, null);
    return { exportId, formatVersion: "tenant-export-v1", tenantId, generatedByUserId: actorUserId, exportedAt: new Date().toISOString(), scope: "license-expiry-purge-handover", rowLimitPerTable: null, tables, warnings: [] };
  });
}

async function readExportRows(client: Queryable, config: ExportTableConfig, limit: number | null = rowLimitPerTable): Promise<unknown[]> {
  const where = [`"tenantId" = current_setting('app.current_tenant_id', true)`];
  if (config.hasDeletedAt) {
    where.push(`"deletedAt" IS NULL`);
  }

  const result = await client.query<{ rows: unknown[] }>(
    `SELECT COALESCE(jsonb_agg(to_jsonb(t) - $2::text[] ORDER BY t."createdAt", t."id"), '[]'::jsonb) AS rows
     FROM (
       SELECT *
       FROM "${config.tableName}"
       WHERE ${where.join(" AND ")}
       ORDER BY "createdAt", "id"
       LIMIT $1
     ) t`,
    // LIMIT NULL is LIMIT ALL in PostgreSQL.
    [limit, config.omittedColumns],
  );

  return result.rows[0]?.rows ?? [];
}

function table(
  key: string,
  tableName: string,
  omittedColumns: string[] = [],
  hasDeletedAt = true,
): ExportTableConfig {
  return {
    key,
    tableName,
    omittedColumns: [...commonOmittedColumns, ...omittedColumns],
    hasDeletedAt,
  };
}

function createEmptyPayload(context: RequestContext, warnings: string[]): TenantDataExportPayload {
  return {
    formatVersion: "tenant-export-v1",
    tenantId: requireTenantId(context),
    generatedByUserId: context.userId,
    exportedAt: new Date().toISOString(),
    scope: "tenant-user-entered-data",
    rowLimitPerTable,
    tables: Object.fromEntries(exportTables.map((config) => [config.key, []])),
    warnings,
  };
}

function requireTenantId(context: RequestContext): string {
  if (!context.tenantId || context.bypassRls) {
    throw new Error("TENANT_CONTEXT_REQUIRED");
  }
  return context.tenantId;
}
