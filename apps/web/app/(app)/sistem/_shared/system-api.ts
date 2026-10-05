import { institutionResetRequestSchema } from "../../../../src/tenant-reset-request.js";
import { z } from "zod";
import type { TenantCleanResetRequest, TenantManagement } from "@o-okul/shared-types";
import type { TenantCreateFormPayload, TenantFormPayload } from "../../../../src/form-validation.js";
import type { TenantAccessStatus, TenantStatusUpdateResult, TenantStatusUpdateRequest, MfaStepUpRequest, MfaStepUpResponse } from "@o-okul/shared-types";
import { ApiRequestError, authenticatedFetchOnce, apiBaseUrl, apiListRequest, apiRequest, type ListResult } from "../../../../src/api-client.js";
import { buildListUrl, type ListQueryState } from "../../../../src/list-controls.js";

export interface TenantRecord {
  management?: TenantManagement;
  id: string;
  name: string;
  slug: string;
  plan: string;
  licenseStartsAt?: string;
  licenseEndsAt?: string;
  seatLimit?: number;
  activeSeatCount?: number;
  status: TenantAccessStatus;
  lifecycleVersion: number;
}

export interface TenantCreateResponse {
  tenant: TenantRecord;
  owner: {
    id: string;
    employeeId: string;
    tenantId: string;
    roles: string[];
  };
  campuses: Array<{ id: string; tenantId: string; name: string; code?: string; unitType?: string }>;
  licenseTerm: { id: string; tenantId: string; planCode: string; startsAt: string; endsAt: string; activeStudentLimit: number };
}

export function loadTenants(accessToken: string, listQuery: ListQueryState): Promise<ListResult<TenantRecord>> {
  return apiListRequest<TenantRecord>(accessToken, buildListUrl(`${apiBaseUrl}/tenants`, listQuery));
}

export function loadTenant(accessToken: string, id: string): Promise<TenantRecord> {
  return apiRequest<TenantRecord>(accessToken, `${apiBaseUrl}/tenants/${encodeURIComponent(id)}`);
}

export function createTenant(accessToken: string, input: TenantCreateFormPayload, idempotencyKey: string): Promise<TenantCreateResponse> {
  return apiRequest<TenantCreateResponse>(accessToken, `${apiBaseUrl}/tenants`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
    method: "POST",
  });
}

export function updateTenant(accessToken: string, id: string, input: TenantFormPayload): Promise<TenantRecord> {
  return apiRequest<TenantRecord>(accessToken, `${apiBaseUrl}/tenants/${encodeURIComponent(id)}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

export function updateTenantStatus(accessToken: string, id: string, input: TenantStatusUpdateRequest, idempotencyKey: string, stepUpToken: string): Promise<TenantStatusUpdateResult> {
  return apiRequest<TenantStatusUpdateResult>(accessToken, `${apiBaseUrl}/tenants/${encodeURIComponent(id)}/status`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey, "X-Step-Up-Token": stepUpToken },
    method: "PATCH",
  });
}

export function createLifecycleStepUp(accessToken: string, input: MfaStepUpRequest): Promise<MfaStepUpResponse> {
  return apiRequest<MfaStepUpResponse>(accessToken, `${apiBaseUrl}/auth/step-up`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
  });
}

export const resetCategoryLabels: Record<string, string> = {
  TenantMutationActivity: "Devam eden kurum işlemleri", TenantFreshResetOperation: "Temizleme işlemleri", Tenant: "Kurum profili", LicenseTerm: "Lisans dönemleri", LicenseUsage: "Lisans kullanımı", AuditLog: "Denetim kayıtları", BackupRestoreJob: "Yedekleme kayıtları",
  PlatformAccount: "Platform hesapları", PlatformIdempotencyKey: "Platform işlem kayıtları", PlatformSession: "Platform oturumları", User: "Kullanıcı hesapları", TenantMembership: "Kurum üyelikleri", Employee: "Çalışan kayıtları",
  PaymentPlan: "Ödeme planları", PaymentInstallment: "Ödeme taksitleri", PaymentTransaction: "Ödeme hareketleri", SupportTicket: "Destek talepleri", SupportTicketAttachment: "Destek ekleri", SupportTicketComment: "Destek yanıtları", WhatsAppConsent: "İletişim izinleri", WhatsAppConsentEvent: "İletişim izin geçmişi",
  DevelopmentCriterion: "Gelişim ölçütleri", DevelopmentAssessment: "Gelişim değerlendirmeleri", DevelopmentScore: "Gelişim puanları", GradeAssessment: "Not değerlendirmeleri", GradeEntry: "Notlar", NotificationDeviceToken: "Bildirim cihazları", MembershipCampusScope: "Kampüs yetkileri", AuthSession: "Kurum oturumları", IdempotencyKey: "Kurum işlem kayıtları", IdentityInvitation: "Hesap davetleri", ConsumedRefreshToken: "Kullanılmış oturum kayıtları", PasswordResetToken: "Parola yenileme kayıtları", SecretDeliveryOutbox: "Güvenli teslimat kayıtları",
  Class: "Sınıflar", GradeLevel: "Sınıf seviyeleri", Alan: "Alanlar", Campus: "Kampüsler", Course: "Dersler", GradeLevelCourse: "Seviye dersleri", AcademicYear: "Akademik yıllar", AcademicTerm: "Akademik dönemler", Student: "Öğrenciler", StudentEnrollment: "Öğrenci kayıtları", Teacher: "Öğretmenler", StudentContact: "Öğrenci iletişim kayıtları", TeacherAssignment: "Öğretmen atamaları", Guardian: "Veliler", GuardianStudent: "Veli öğrenci ilişkileri",
  Attendance: "Yoklama", TeacherNote: "Öğretmen notları", ScheduleLesson: "Ders programı", StudySession: "Etütler", StudySessionStudent: "Etüt katılımları", HomeworkMaterial: "Ödev materyalleri", HomeworkMaterialFile: "Materyal dosyaları", HomeworkMaterialAssignment: "Materyal atamaları", Homework: "Ödevler", HomeworkSubmission: "Ödev teslimleri",
  Exam: "Sınavlar", ParserConfig: "Optik okuma ayarları", OpticalFormTemplate: "Optik form şablonları", ExamParticipant: "Sınav katılımcıları", RawImport: "İçe aktarılan kayıtlar", AnswerKey: "Cevap anahtarları", ExamBookletVariant: "Sınav kitapçıkları", LearningOutcome: "Kazanımlar", ParsedAnswer: "Okunan cevaplar", ExamResult: "Sınav sonuçları", ImportQuarantine: "İnceleme bekleyen kayıtlar", ReportSnapshot: "Raporlar", Announcement: "Duyurular", AnnouncementReceipt: "Duyuru okumaları", AnnouncementDeliveryReport: "Duyuru teslimatları", MessageTemplate: "Mesaj şablonları", SmsBatchDeliveryReport: "SMS teslimatları",
};
export const resetBlockerLabels: Record<string, string> = {
  MUTATION_ACTIVITY_PRESENT: "Devam eden veya sonucu belirsiz kurum işlemi var", SOURCE_UNVERIFIED: "Veri kaynağı doğrulanamadı", INSTITUTION_REQUEST_REQUIRED: "Kurum yöneticisinin geçerli yenileme talebi gerekiyor", LEGAL_HOLD_UNVERIFIED: "Yasal saklama engeli kontrolü doğrulanamadı", WRITE_QUIESCENCE_UNVERIFIED: "Kurumdaki yazma işlemlerinin durduğu doğrulanamadı", OBJECT_INVENTORY_UNVERIFIED: "Dosya envanteri doğrulanamadı", QUEUE_STATE_UNVERIFIED: "Arka plan işleri doğrulanamadı", QUEUE_SCHEDULE_UNVERIFIED: "Planlı işler doğrulanamadı", QUEUE_WORK_PRESENT: "Bekleyen arka plan işleri var", FINANCE_RECORDS_PRESENT: "Finans kayıtları var", SUPPORT_RECORDS_PRESENT: "Destek kayıtları var", CONSENT_RECORDS_PRESENT: "İzin kayıtları var", CONSENT_HISTORY_UNVERIFIED: "İzin geçmişi doğrulanamadı", OWNER_PROJECTION_MISMATCH: "Kurum sahibi hesapları tutarsız", NO_ACTIVE_OWNER: "Aktif kurum sahibi yok", DELIVERY_WORK_PRESENT: "Bekleyen teslimatlar var", BACKUP_WORK_PRESENT: "Devam eden yedekleme var", IMPORT_WORK_PRESENT: "Devam eden içe aktarma var", TENANT_STATUS_UNSUPPORTED: "Kurum erişim durumu doğrulanamadı", LICENSE_NOT_EXPIRED: "Lisans bitişinden 91 gün geçmedi veya yeni lisans dönemi var",
};
const resetCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const resetStatusObject = z.object({
  operationId: z.string().regex(/^[a-f0-9]{32}$/), status: z.enum(["QUEUED", "RUNNING", "BLOCKED", "FAILED", "COMPLETED", "CANCELLED"]), phase: z.enum(["PREFLIGHT", "BACKUP", "DATABASE", "OBJECTS", "VERIFY", "DONE"]), errorCode: z.string().nullable(),
  result: z.object({ preservedOwnerCount: resetCount, deletedObjectCount: resetCount }).strict().nullable(),
}).strict();
export const resetStatusSchema = resetStatusObject.refine((value) => value.status !== "CANCELLED" && (value.status === "COMPLETED" ? value.phase === "DONE" && value.result !== null && value.result.preservedOwnerCount > 0 && value.errorCode === null : value.phase !== "DONE"));
// License-expiry purge (DEC-20261005-03) keeps no owner; a renewed license cancels it before any deletion.
export const purgeStatusSchema = resetStatusObject.refine((value) => value.status === "COMPLETED" ? value.phase === "DONE" && value.result !== null && value.result.preservedOwnerCount === 0 && value.errorCode === null : value.phase !== "DONE");
type ResetStatusSchema = typeof resetStatusSchema | typeof purgeStatusSchema;
export const tenantManagementSchema = z.object({ verified: z.boolean(), allowedActions: z.object({ suspend: z.boolean(), reactivate: z.boolean(), cleanReset: z.boolean() }).strict(), currentReset: resetStatusSchema.nullable() }).strict();
const resetPreviewSchema = z.object({
  institutionRequest: institutionResetRequestSchema.nullable().optional(),
  preset: z.enum(["CLEAN_SETUP_V1", "LICENSE_EXPIRY_PURGE_V1"]), lifecycleVersion: z.number().int().min(0).max(2147483646), preflightDigest: z.string().regex(/^[a-f0-9]{64}$/), preservedOwnerCount: resetCount,
  categories: z.array(z.object({ category: z.string().refine((key) => Object.hasOwn(resetCategoryLabels, key)), preserved: resetCount, deleted: resetCount, blocked: resetCount }).strict()),
  objectCount: resetCount, objectBytes: resetCount, allowed: z.boolean(), blockers: z.array(z.string().refine((key) => Object.hasOwn(resetBlockerLabels, key))),
  blockerCounts: z.array(z.object({ code: z.string().refine((key) => Object.hasOwn(resetBlockerLabels, key)), count: resetCount.nullable() }).strict()),
}).strict().refine((value) => (!value.allowed || value.preset === "LICENSE_EXPIRY_PURGE_V1" || value.institutionRequest?.status === "PENDING") && new Set(value.categories.map((row) => row.category)).size === value.categories.length && new Set(value.blockers).size === value.blockers.length && value.blockerCounts.length === value.blockers.length && new Set(value.blockerCounts.map((row) => row.code)).size === value.blockers.length && value.blockerCounts.every((row) => value.blockers.includes(row.code)));
export async function loadResetPreview(token: string, id: string, preset: "CLEAN_SETUP_V1" | "LICENSE_EXPIRY_PURGE_V1" = "CLEAN_SETUP_V1") {
  const preview = resetPreviewSchema.parse(await apiRequest<unknown>(token, `${apiBaseUrl}/tenants/${encodeURIComponent(id)}/clean-reset-preview${preset === "CLEAN_SETUP_V1" ? "" : `?preset=${preset}`}`));
  if (preview.preset !== preset || (preview.institutionRequest && preview.institutionRequest.tenantId !== id)) throw new Error("RESET_REQUEST_SCOPE_INVALID");
  return preview;
}
export async function loadResetStatus(token: string, id: string, key: string, operationId?: string, schema: ResetStatusSchema = resetStatusSchema) {
  return schema.parse(await apiRequest<unknown>(token, `${apiBaseUrl}/tenants/${encodeURIComponent(id)}/clean-reset-jobs${operationId ? `/${encodeURIComponent(operationId)}` : ""}`, { headers: { "Idempotency-Key": key } }));
}
export async function startReset(token: string, expected: { userId: string; sessionId: string; membershipVersion: number }, id: string, body: TenantCleanResetRequest, key: string, proof: string, schema: ResetStatusSchema = resetStatusSchema) {
  // One attempt: authenticatedFetch retries 401s, which is inappropriate for this destructive request.
  const response = await authenticatedFetchOnce(token, expected, `${apiBaseUrl}/tenants/${encodeURIComponent(id)}/clean-reset-jobs`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "Idempotency-Key": key, "X-Step-Up-Token": proof }, body: JSON.stringify(body) });
  if (!response.ok) {
    let code: string | undefined;
    try { const body = await response.json(); if (typeof body?.error?.code === "string") code = body.error.code; } catch { /* Unknown response remains unresolved. */ }
    throw new ApiRequestError("RESET_UNRESOLVED", response.status, code);
  }
  return schema.parse((await response.json()).data);
}

const purgeCandidateSchema = z.object({
  tenantId: z.string().min(1), name: z.string(), slug: z.string().min(1), status: z.enum(["ACTIVE", "SUSPENDED"]), lifecycleVersion: z.number().int().min(0).max(2147483646),
  licenseEndsAt: z.string().refine((value) => Number.isFinite(Date.parse(value))), daysSinceLicenseEnd: z.number().int().min(91), estimatedRowCount: resetCount,
}).strict();
export type PurgeCandidate = z.infer<typeof purgeCandidateSchema>;
export async function loadPurgeCandidates(token: string): Promise<PurgeCandidate[]> {
  return z.array(purgeCandidateSchema).parse(await apiRequest<unknown>(token, `${apiBaseUrl}/tenants/license-expiry-purge-candidates`));
}
