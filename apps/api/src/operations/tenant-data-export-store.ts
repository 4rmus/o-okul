import { createHash } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import type { RequestContext } from "../context/request-context.js";
import { decryptStudentContactValue } from "../student/student-contact-pii.js";
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

export interface TenantHandoverExportFile {
  table: (typeof handoverFileTables)[number]["tableName"];
  rowId: string;
  fileName: string;
  contentType: string | null;
  byteSize: number;
  sha256: string;
  contentBase64: string;
}

export interface TenantHandoverExportPayload extends Omit<TenantDataExportPayload, "scope" | "rowLimitPerTable"> {
  exportId: string;
  scope: "license-expiry-purge-handover";
  rowLimitPerTable: null;
  files: TenantHandoverExportFile[];
}

// Product owner decision (2026-10-05): before a license-expiry purge the institution receives its data,
// with no row limit so nothing is silently truncated.
// Product owner decision (2026-10-10): the handover holds everything the purge destroys: every tenant
// table except accounts/sessions and platform records (tenant-table-coverage.test.ts), including
// consent/contact tables, the tenant's own AuditLog and the file bytes. The institution's own export is unchanged.
// Lookup hashes, national ID ciphertext and object keys are never exported; file bytes move to `files`.
const handoverOmittedColumns = ["nationalIdEncrypted", "nationalIdHash", "phoneHash", "emailHash", "commandKeyHash", "requestHash", "contentBase64", "storageKey", "s3Key", "photoKey"];
const handoverTables = [
  ...exportTables,
  table("paymentTransactions", "PaymentTransaction", [], false),
  table("employees", "Employee"),
  table("studentContacts", "StudentContact"),
  table("whatsAppConsents", "WhatsAppConsent", [], false),
  table("whatsAppConsentEvents", "WhatsAppConsentEvent", [], false),
  table("auditLogs", "AuditLog", [], false),
  table("homeworkMaterialFiles", "HomeworkMaterialFile"),
  table("homeworks", "Homework"),
  table("developmentCriteria", "DevelopmentCriterion"),
  table("developmentAssessments", "DevelopmentAssessment", [], false),
  table("developmentScores", "DevelopmentScore", [], false),
  table("scheduleLessons", "ScheduleLesson"),
  table("studySessions", "StudySession"),
  table("studySessionStudents", "StudySessionStudent", [], false),
  table("rawImports", "RawImport"),
  table("parsedAnswers", "ParsedAnswer"),
  table("importQuarantines", "ImportQuarantine"),
  table("parserConfigs", "ParserConfig"),
  table("opticalFormTemplates", "OpticalFormTemplate"),
  table("examBookletVariants", "ExamBookletVariant"),
  table("alans", "Alan"),
  table("gradeLevelCourses", "GradeLevelCourse", [], false),
  table("learningOutcomes", "LearningOutcome"),
  table("announcementReceipts", "AnnouncementReceipt", [], false),
  table("announcementDeliveryReports", "AnnouncementDeliveryReport", [], false),
  table("smsBatchDeliveryReports", "SmsBatchDeliveryReport", [], false),
].map((config) => ({ ...config, omittedColumns: [...new Set([...config.omittedColumns, ...handoverOmittedColumns])] }));
export const tenantHandoverExportTableNames: readonly string[] = handoverTables.map((config) => config.tableName);

// Same objects as the reset engine's tenantResetObjectFields. Inline bytes (contentBase64) or an object key.
const handoverFileTables = [
  { tableName: "HomeworkMaterialFile", select: `"fileName", "contentType", "byteSize", "sha256", "contentBase64", "storageKey" AS "objectKey"`, hasDeletedAt: true },
  { tableName: "SupportTicketAttachment", select: `"fileName", "contentType", "byteSize", "sha256", "contentBase64", "storageKey" AS "objectKey"`, hasDeletedAt: true },
  { tableName: "RawImport", select: `"fileName", NULL AS "contentType", NULL AS "byteSize", "sha256", NULL AS "contentBase64", "s3Key" AS "objectKey"`, hasDeletedAt: true },
  // A photo has no recorded hash: its sha256 is computed on read, so only readability is proven.
  { tableName: "Student", select: `regexp_replace("photoKey", '^.*/', '') AS "fileName", NULL AS "contentType", NULL AS "byteSize", NULL AS "sha256", NULL AS "contentBase64", "photoKey" AS "objectKey"`, hasDeletedAt: true, where: `"photoKey" IS NOT NULL` },
] as const;
interface HandoverFileRow { id: string; fileName: string; contentType: string | null; byteSize: number | null; sha256: string | null; contentBase64: string | null; objectKey: string | null }

/** Reads one object-storage file by key; the caller verifies size and hash. */
export type TenantHandoverObjectReader = (key: string) => Promise<Buffer>;

export async function createTenantHandoverExport(pool: TenantQueryable, tenantId: string, actorUserId: string, exportId: string, readObject: TenantHandoverObjectReader): Promise<TenantHandoverExportPayload> {
  const { tables, fileRows } = await withExplicitTenantQuery(pool, tenantId, async (client) => {
    const tables: Record<string, unknown[]> = {};
    for (const config of handoverTables) tables[config.key] = await readExportRows(client, config, null);
    tables.studentContacts = tables.studentContacts!.map((row) => decryptContact(row as Record<string, unknown>));
    const fileRows: Array<HandoverFileRow & { table: TenantHandoverExportFile["table"] }> = [];
    for (const config of handoverFileTables) {
      const where = [`"tenantId" = current_setting('app.current_tenant_id', true)`, `"deletedAt" IS NULL`, ...("where" in config ? [config.where] : [])];
      const result = await client.query<HandoverFileRow>(`SELECT "id", ${config.select} FROM "${config.tableName}" WHERE ${where.join(" AND ")} ORDER BY "createdAt", "id"`);
      fileRows.push(...result.rows.map((row) => ({ ...row, table: config.tableName })));
    }
    return { tables, fileRows };
  });
  // Object reads run after the database transaction so a slow bucket never holds it open.
  // ponytail: every file is held in memory as base64 inside one JSON response (about 1.4x the file
  // bytes, twice while the audit hash and the response are serialized). Fine for a school's documents;
  // if a tenant's files reach hundreds of MB, stream a zip to object storage and hand over a signed URL.
  const files: TenantHandoverExportFile[] = [];
  for (const row of fileRows) {
    let bytes: Buffer;
    try {
      if (row.contentBase64 != null) bytes = Buffer.from(row.contentBase64, "base64");
      else if (row.objectKey) bytes = await readObject(row.objectKey);
      else throw new Error("no content");
    } catch {
      throw new Error("TENANT_PURGE_EXPORT_FILE_UNREADABLE");
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    // No silent omission: a missing, truncated or altered file fails the whole export.
    if ((row.sha256 != null && row.sha256 !== sha256) || (row.byteSize != null && row.byteSize !== bytes.length)) throw new Error("TENANT_PURGE_EXPORT_FILE_HASH_MISMATCH");
    files.push({ table: row.table, rowId: row.id, fileName: row.fileName, contentType: row.contentType, byteSize: bytes.length, sha256, contentBase64: bytes.toString("base64") });
  }
  return { exportId, formatVersion: "tenant-export-v1", tenantId, generatedByUserId: actorUserId, exportedAt: new Date().toISOString(), scope: "license-expiry-purge-handover", rowLimitPerTable: null, tables, files, warnings: [] };
}

/** Contact phone/e-mail are institution-entered data: decrypted for the handover, ciphertext and lookup hashes dropped. */
function decryptContact({ phoneEncrypted, emailEncrypted, ...row }: Record<string, unknown>) {
  try {
    return { ...row, phone: typeof phoneEncrypted === "string" ? decryptStudentContactValue(phoneEncrypted) : null, email: typeof emailEncrypted === "string" ? decryptStudentContactValue(emailEncrypted) : null };
  } catch {
    throw new Error("TENANT_PURGE_EXPORT_CONTACT_UNREADABLE");
  }
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
