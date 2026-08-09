import { BadRequestException, ForbiddenException, Inject, Injectable } from "@nestjs/common";
import type { AuditLogCategory, AuditLogListItemRecord, StudentAuditSummaryRecord } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { isSystemAdmin } from "../rbac/roles.js";
import { auditLogStoreToken, type AuditLogStore } from "./audit-log-store.js";

export interface AuditLogRecord {
  id: string;
  tenantId?: string;
  actorUserId?: string;
  entityType: string;
  entityId?: string;
  action: string;
  diff?: Record<string, unknown>;
  createdAt: string;
}

export type CreateAuditLogInput = Omit<AuditLogRecord, "id" | "createdAt"> & {
  createdAt?: string;
};

export interface AuditLogListFilters {
  entityId?: string;
  entityType?: string;
  studentId?: string;
}

@Injectable()
export class AuditLogService {
  constructor(@Inject(auditLogStoreToken) private readonly store: AuditLogStore) {}

  async list(context: RequestContext, filters: AuditLogListFilters = {}): Promise<AuditLogRecord[]> {
    let records: AuditLogRecord[];
    if (isSystemAdmin(context.roles)) {
      records = this.store.listForAdmin ? await this.store.listForAdmin() : await this.store.list();
    } else {
      records = await this.store.list();
      if (!context.tenantId) {
        throw new ForbiddenException("TENANT_CONTEXT_MISSING");
      }
      records = records.filter((record) => record.tenantId === context.tenantId);
    }

    return filterAuditLogs(records, filters).map(sanitizeAuditLogRecord);
  }

  async safeList(context: RequestContext): Promise<AuditLogListItemRecord[]> {
    return (await this.list(context)).map(toAuditLogListItem);
  }

  async record(input: CreateAuditLogInput): Promise<AuditLogRecord> {
    return sanitizeAuditLogRecord(await this.store.create({
      ...input,
      diff: sanitizeAuditDiff(input.diff),
      createdAt: input.createdAt ?? new Date().toISOString(),
    }));
  }

  async studentSummary(context: RequestContext, studentId: string | undefined, limit = 5): Promise<StudentAuditSummaryRecord[]> {
    const normalizedStudentId = normalizeText(studentId);
    if (!normalizedStudentId) {
      throw new BadRequestException("AUDIT_STUDENT_ID_REQUIRED");
    }

    return (await this.list(context, { studentId: normalizedStudentId }))
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, Math.max(1, Math.min(limit, 20)))
      .map(toStudentAuditSummary);
  }
}

function toAuditLogListItem(record: AuditLogRecord): AuditLogListItemRecord {
  return {
    actionLabel: formatAuditAction(record.action),
    actorLabel: record.actorUserId ? "Kullanıcı kaydı" : "Sistem",
    category: auditCategory(record),
    createdAt: record.createdAt,
    entityLabel: formatAuditEntity(record),
    id: record.id,
  };
}

function toStudentAuditSummary(record: AuditLogRecord): StudentAuditSummaryRecord {
  return {
    actionLabel: formatAuditAction(record.action),
    createdAt: record.createdAt,
    id: record.id,
  };
}

function auditCategory(record: AuditLogRecord): AuditLogCategory {
  const normalizedAction = normalizeAuditSearchText(record.action);
  const normalizedEntity = normalizeAuditSearchText(record.entityType);
  const combined = `${normalizedAction} ${normalizedEntity}`;

  if (normalizedAction.startsWith("auth.") || combined.includes("rolepreviewtoken")) return "identity";
  if (normalizedAction.startsWith("identity_invitation.") || combined.includes("invitation")) return "invitation";
  if (normalizedAction.startsWith("kvkk.") || combined.includes("kvkk")) return "kvkk";
  if (normalizedAction.startsWith("tenant.") || combined.includes("tenant")) return "tenant";
  if (combined.includes("finance") || combined.includes("payment")) return "finance";
  if (normalizedAction.startsWith("report.") || combined.includes("report")) return "report";
  if (
    normalizedAction.startsWith("student.") ||
    normalizedAction.startsWith("guardian_student.") ||
    normalizedAction.startsWith("announcement.") ||
    normalizedAction.startsWith("exam.") ||
    normalizedAction.startsWith("course.") ||
    normalizedAction.startsWith("class.")
  ) {
    return "academic";
  }
  if (normalizedAction.startsWith("user.") || combined.includes("user") || combined.includes("guardian")) return "user";
  return "operation";
}

function formatAuditAction(action: string) {
  const normalizedAction = normalizeAuditSearchText(action);
  if (normalizedAction.startsWith("auth.login")) return "Oturum açıldı";
  if (normalizedAction.startsWith("auth.")) return "Kimlik olayı";
  if (normalizedAction.startsWith("identity_invitation.")) return "Davet olayı";
  if (normalizedAction.startsWith("kvkk.")) return "KVKK olayı";
  if (normalizedAction.startsWith("tenant.")) return "Kurum olayı";
  if (normalizedAction.startsWith("user.") && normalizedAction.includes("finance")) return "Finans görünürlüğü güncellendi";
  if (normalizedAction.startsWith("user.")) return "Kullanıcı kaydı güncellendi";
  const labels: Record<string, string> = {
    "guardian_student.linked": "Veli ilişkisi kuruldu",
    "guardian_student.unlinked": "Veli ilişkisi kaldırıldı",
    "guardian_student.updated": "Veli ilişkisi güncellendi",
    "student.created": "Öğrenci oluşturuldu",
    "student.deleted": "Öğrenci silindi",
    "student.profile_updated": "Profil güncellendi",
    "student.profile_viewed": "Profil görüntülendi",
    "student.updated": "Öğrenci bilgisi güncellendi",
  };
  if (labels[action]) return labels[action];
  if (normalizedAction.startsWith("announcement.created")) return "Duyuru oluşturuldu";
  if (normalizedAction.startsWith("announcement.")) return "Duyuru kaydı güncellendi";
  if (normalizedAction.startsWith("report.")) return "Rapor kaydı güncellendi";
  if (normalizedAction.startsWith("exam.")) return "Sınav kaydı güncellendi";
  if (normalizedAction.startsWith("course.")) return "Ders kaydı güncellendi";
  if (normalizedAction.startsWith("class.")) return "Sınıf kaydı güncellendi";
  if (normalizedAction.includes("rolepreviewtoken")) return "Rol önizleme kaydı";
  return "Operasyon kaydı";
}

function formatAuditEntity(record: AuditLogRecord) {
  const normalizedEntity = normalizeAuditSearchText(record.entityType);
  const normalizedAction = normalizeAuditSearchText(record.action);
  const combined = `${normalizedEntity} ${normalizedAction}`;

  if (combined.includes("auth")) return "Kimlik kaydı";
  if (combined.includes("invitation")) return "Davet kaydı";
  if (combined.includes("finance") || combined.includes("payment")) return "Finans görünürlüğü kaydı";
  if (combined.includes("guardian_student")) return "Veli ilişki kaydı";
  if (combined.includes("guardian")) return "Veli kaydı";
  if (combined.includes("student")) return "Öğrenci kaydı";
  if (combined.includes("teacher")) return "Öğretmen kaydı";
  if (combined.includes("user")) return "Kullanıcı kaydı";
  if (combined.includes("tenant")) return "Kurum kaydı";
  if (combined.includes("kvkk")) return "KVKK kaydı";
  if (combined.includes("report")) return "Rapor kaydı";
  if (combined.includes("exam")) return "Sınav kaydı";
  if (combined.includes("announcement")) return "Duyuru kaydı";
  return "Operasyon kaydı";
}

function filterAuditLogs(records: AuditLogRecord[], filters: AuditLogListFilters) {
  const entityType = normalizeText(filters.entityType);
  const entityId = normalizeText(filters.entityId);
  const studentId = normalizeText(filters.studentId);

  return records
    .filter((record) => !entityType || record.entityType === entityType)
    .filter((record) => !entityId || record.entityId === entityId)
    .filter((record) => !studentId || isStudentAuditLog(record, studentId));
}

function isStudentAuditLog(record: AuditLogRecord, studentId: string) {
  return (record.entityType === "Student" && record.entityId === studentId) ||
    (record.entityType === "GuardianStudent" && record.diff?.studentId === studentId);
}

function sanitizeAuditLogRecord(record: AuditLogRecord): AuditLogRecord {
  return {
    ...record,
    diff: sanitizeAuditDiff(record.diff),
  };
}

function sanitizeAuditDiff(diff: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!diff) return undefined;
  return sanitizeAuditValue(diff, "") as Record<string, unknown>;
}

function sanitizeAuditValue(value: unknown, key: string): unknown {
  if (key && !allowedAuditDiffKey(key)) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return sensitiveAuditKey(key) ? "[REDACTED]" : value.map((item) => sanitizeAuditValue(item, key));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        sanitizeAuditValue(entryValue, entryKey),
      ]),
    );
  }
  if (typeof value === "string" && (sensitiveAuditKey(key) || sensitiveAuditValue(value))) {
    return "[REDACTED]";
  }
  return value;
}

function allowedAuditDiffKey(key: string): boolean {
  const normalized = key.toLowerCase();
  if (sensitiveAuditKey(key)) return true;
  return allowedAuditDiffKeys.has(normalized) ||
    normalized.endsWith("id") ||
    normalized.endsWith("ids") ||
    normalized.endsWith("at") ||
    normalized.endsWith("count") ||
    normalized.endsWith("length") ||
    normalized.endsWith("present") ||
    normalized.endsWith("rows") ||
    normalized.endsWith("size") ||
    normalized.endsWith("type") ||
    normalized.startsWith("can") ||
    normalized.startsWith("is");
}

const allowedAuditDiffKeys = new Set([
  "after",
  "audience",
  "before",
  "branch",
  "capacity",
  "channel",
  "checked",
  "code",
  "course",
  "date",
  "disabled",
  "emailprovided",
  "error",
  "errorcode",
  "fieldschanged",
  "fieldspresent",
  "fieldspurged",
  "fieldsset",
  "featurekeys",
  "grade",
  "level",
  "maskedfields",
  "methods",
  "mode",
  "priority",
  "reason",
  "recoverycodesissued",
  "recoverycodesremaining",
  "relationshiptype",
  "reporttype",
  "role",
  "roles",
  "section",
  "sha256",
  "status",
  "target",
  "visibility",
]);

function sensitiveAuditKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return [
    "body",
    "contentbase64",
    "downloadurl",
    "email",
    "filebase64",
    "firstname",
    "lastname",
    "message",
    "nationalidencrypted",
    "nationalidhash",
    "password",
    "phone",
    "secret",
    "subject",
    "token",
  ].includes(normalized);
}

function sensitiveAuditValue(value: string): boolean {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value) ||
    /\b\d{11}\b/.test(value) ||
    /(?:rolePreviewToken|accessToken|refreshToken|bearer|password|secret)=?/i.test(value) ||
    /^\+?\d[\d\s().-]{8,}\d$/.test(value.trim());
}

function normalizeText(value: string | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function normalizeAuditSearchText(value: string) {
  return value.toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}
