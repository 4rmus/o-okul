import { requireNoTenantMutationActivity } from "./tenant-mutation-activity.js";
import { assertInstitutionResetRequest, requireResetInstitutionRequest } from "./tenant-reset-request.js";
import { randomBytes, randomUUID } from "node:crypto";
import { withTenantDb, type Queryable, type TenantQueryable } from "./tenant-db.js";
import { readResetSnapshot } from "./tenant-reset-snapshot.js";
import { resetOwnerIds, resetOwnerMemberships, resetSnapshotBlockers, type TenantResetSnapshot } from "./index.js";
import { licenseExpiryPurgeBlockers, licenseExpiryPurgePreset, licenseExpiryPurgeTables, requireLicenseExpiryPurgeClearance } from "./tenant-expiry-purge.js";

export type FreshResetPreset = "CLEAN_SETUP_V1" | "LICENSE_EXPIRY_PURGE_V1";
export interface FreshResetRequest { preset: FreshResetPreset; expectedLifecycleVersion: number; preflightDigest: string; confirmationText: string; reason: "SECURITY_REVIEW" | "INSTITUTION_REQUEST" | "OPERATIONS_REVIEW" | "LICENSE_EXPIRED"; }
export interface FreshResetOperation {
  id: string; institutionRequestId?: string | null; tenantId: string; actorUserId: string; idempotencyKey: string; requestHash: string;
  preset: FreshResetPreset; expectedLifecycleVersion: number; preflightDigest: string; reason: string;
  /** CANCELLED: a license-expiry purge stopped before its database phase committed (license renewed). */
  status: "QUEUED" | "RUNNING" | "BLOCKED" | "FAILED" | "COMPLETED" | "CANCELLED";
  phase: "PREFLIGHT" | "BACKUP" | "DATABASE" | "OBJECTS" | "VERIFY" | "DONE";
  errorCode: string | null; backupReceipt: Record<string, unknown> | null; result: { preservedOwnerCount: number; deletedObjectCount: number; deletedRowCount?: number } | null;
}
export const isLicenseExpiryPurge = (op: { preset?: string }) => op.preset === licenseExpiryPurgePreset;
export const freshResetFinished = (op: { status: string }) => op.status === "COMPLETED" || op.status === "CANCELLED";
export function freshResetStatus(op: FreshResetOperation) {
  return { operationId: op.id, status: op.status, phase: op.phase, errorCode: op.errorCode == null ? null : /^RESET_[A-Z_]+$/.test(op.errorCode) ? op.errorCode : "RESET_EXECUTION_FAILED", result: op.result ? { preservedOwnerCount: op.result.preservedOwnerCount, deletedObjectCount: op.result.deletedObjectCount } : null };
}
export const freshResetJobId = (operationId: string) => `tenant-fresh-reset-${operationId}`;
export const freshResetQueue = "tenant-fresh-reset";
// Authority is the persisted institution request, never an environment flag.
export async function requireResetLegalClearance(tenantId: string, db?: Queryable, operation?: Pick<FreshResetOperation, "id" | "institutionRequestId"> & Partial<Pick<FreshResetOperation, "preset" | "phase">>): Promise<void> {
  if (!db) throw new Error("RESET_INSTITUTION_REQUEST_REQUIRED");
  if (operation && isLicenseExpiryPurge(operation)) {
    // DEC-20261005-03 is the authority. Once the database purge committed, remaining objects must still go.
    if (operation.phase === "OBJECTS" || operation.phase === "VERIFY" || operation.phase === "DONE") return;
    return requireLicenseExpiryPurgeClearance(db, tenantId);
  }
  await requireResetInstitutionRequest(db, tenantId, operation);
}
export async function requireResetWriteQuiescence(_tenantId: string): Promise<void> { throw new Error("RESET_WRITE_QUIESCENCE_UNVERIFIED"); }

export class PostgresFreshResetStore {
  constructor(readonly pool: TenantQueryable) {}
  async create(tenantId: string, body: FreshResetRequest, actor: { userId: string; sessionId: string; membershipVersion: number; key: string; requestHash: string }, validate: () => Promise<void>): Promise<FreshResetOperation> {
    return withTenantDb(this.pool, { bypassRls: true, tenantId }, async (db) => {
      if (tenantId === "system") throw new Error("RESET_TARGET_INVALID");
      const session = await db.query<{ id: string }>(`SELECT "id" FROM "AuthSession" WHERE "id" = $1 AND "userId" = $2 AND "tenantId" = 'system' AND "status" = 'ACTIVE' AND "expiresAt" > now() AND "membershipVersion" = $3 FOR SHARE`, [actor.sessionId, actor.userId, actor.membershipVersion]);
      if (!session.rows.length) throw new Error("MFA_STEP_UP_CONTEXT_INVALID");
      // Serialize key claims before tenant locks, including a key reused for another tenant.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`fresh-reset-key:${actor.userId}:${actor.key}`]);
      const previous = await db.query<FreshResetOperation>('SELECT * FROM "TenantFreshResetOperation" WHERE "actorUserId" = $1 AND "idempotencyKey" = $2', [actor.userId, actor.key]);
      if (previous.rows[0]) {
        if (previous.rows[0].requestHash !== actor.requestHash) throw new Error("IDEMPOTENCY_KEY_BODY_MISMATCH");
        return previous.rows[0];
      }
      const current = await db.query<{ slug: string; status: string; lifecycleVersion: number; resetRequest: unknown }>('SELECT "slug", "status", "lifecycleVersion", "resetRequest" FROM "Tenant" WHERE "id" = $1 FOR UPDATE', [tenantId]);
      const tenant = current.rows[0];
      if (!tenant) throw new Error("RESET_TARGET_INVALID");
      if (tenant.slug !== body.confirmationText) throw new Error("RESET_CONFIRMATION_MISMATCH");
      if (tenant.lifecycleVersion !== body.expectedLifecycleVersion) throw new Error("TENANT_LIFECYCLE_VERSION_CONFLICT");
      if (tenant.status !== "SUSPENDED") throw new Error("RESET_REQUIRES_SUSPENDED");
      const purge = isLicenseExpiryPurge(body);
      if (purge !== (body.reason === "LICENSE_EXPIRED")) throw new Error("RESET_TARGET_INVALID");
      const busy = await db.query<{ status: string }>('SELECT "status" FROM "TenantFreshResetOperation" WHERE "tenantId" = $1 AND ("status" NOT IN (\'COMPLETED\', \'CANCELLED\') OR ("preset" = $2 AND "status" = \'COMPLETED\'))', [tenantId, licenseExpiryPurgePreset]);
      if (busy.rows.some((row) => row.status === "COMPLETED")) throw new Error("RESET_TARGET_INVALID");
      if (busy.rows.length) throw new Error("RESET_OPERATION_IN_PROGRESS");
      // Purge authority is the license state under the Tenant row lock, never an institution request.
      const request = purge ? undefined : assertInstitutionResetRequest(tenant.resetRequest, { id: tenantId, ...tenant });
      if (purge) await requireLicenseExpiryPurgeClearance(db, tenantId);
      await validate();
      const id = randomBytes(16).toString("hex");
      const inserted = await db.query<FreshResetOperation>(`INSERT INTO "TenantFreshResetOperation" ("id", "tenantId", "actorUserId", "idempotencyKey", "requestHash", "preset", "expectedLifecycleVersion", "preflightDigest", "reason", "institutionRequestId") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [id, tenantId, actor.userId, actor.key, actor.requestHash, body.preset, body.expectedLifecycleVersion, body.preflightDigest, body.reason, request?.id ?? null]);
      if (request) await db.query('UPDATE "Tenant" SET "resetRequest" = $2::jsonb WHERE "id" = $1', [tenantId, JSON.stringify({ ...request, status: "ACCEPTED", operationId: id })]);
      await resetAudit(db, { id, tenantId, actorUserId: actor.userId }, "tenant.reset.queued", { phase: "PREFLIGHT" });
      return inserted.rows[0]!;
    });
  }
  async find(tenantId: string, id: string): Promise<FreshResetOperation | undefined> {
    return withTenantDb(this.pool, { bypassRls: true, tenantId, readOnly: true }, async (db) => (await db.query<FreshResetOperation>('SELECT * FROM "TenantFreshResetOperation" WHERE "tenantId" = $1 AND "id" = $2', [tenantId, id])).rows[0]);
  }
  async findByKey(tenantId: string, actorUserId: string, key: string): Promise<FreshResetOperation | undefined> {
    return withTenantDb(this.pool, { bypassRls: true, tenantId, readOnly: true }, async (db) => (await db.query<FreshResetOperation>('SELECT * FROM "TenantFreshResetOperation" WHERE "tenantId" = $1 AND "actorUserId" = $2 AND "idempotencyKey" = $3', [tenantId, actorUserId, key])).rows[0]);
  }
  async pending(): Promise<FreshResetOperation[]> {
    return withTenantDb(this.pool, { bypassRls: true, tenantId: null }, async (db) => (await db.query<FreshResetOperation>('SELECT * FROM "TenantFreshResetOperation" WHERE "status" IN (\'QUEUED\', \'RUNNING\') OR ("status" = \'FAILED\' AND "errorCode" = \'RESET_EXECUTION_FAILED\') ORDER BY "updatedAt" LIMIT 100')).rows);
  }
}
export async function resetAudit(db: Queryable, op: Pick<FreshResetOperation, "id" | "tenantId" | "actorUserId">, action: string, diff: object) {
  await db.query('INSERT INTO "AuditLog" ("id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff") VALUES ($1,$2,$3,\'TenantFreshResetOperation\',$4,$5,$6::jsonb)', [randomUUID(), op.tenantId, op.actorUserId, op.id, action, JSON.stringify(diff)]);
}
export async function assertResetWorkerRole(db: Queryable): Promise<void> {
  const role = await db.query<{ valid: boolean }>(`SELECT current_user = 'o_okul_reset_worker' AND session_user = current_user AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = r.oid) AND NOT has_table_privilege(current_user, '"Tenant"', 'DELETE') AND NOT has_table_privilege(current_user, '"AuditLog"', 'DELETE,UPDATE,TRUNCATE') AND NOT has_table_privilege(current_user, '"Tenant"', 'TRUNCATE') AND NOT has_schema_privilege(current_user, 'public', 'CREATE') AND NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relowner = r.oid) AND NOT EXISTS (SELECT 1 FROM unnest(ARRAY['PaymentPlan','PaymentInstallment','PaymentTransaction','SupportTicket','SupportTicketAttachment','SupportTicketComment','WhatsAppConsent','WhatsAppConsentEvent']) AS t(name) WHERE has_table_privilege(current_user, format('"%s"', t.name), 'DELETE,UPDATE,TRUNCATE')) AS valid FROM pg_roles r WHERE rolname = current_user`);
  if (role.rows[0]?.valid !== true) throw new Error("RESET_DATABASE_ROLE_INVALID");
}
// Reviewed child-first allowlist. Unknown catalog additions are checked before execution.
export const resetDeleteOrder = ["SecretDeliveryOutbox", "ConsumedRefreshToken", "PasswordResetToken", "NotificationDeviceToken", "AuthSession", "IdentityInvitation", "MembershipCampusScope", "GradeEntry", "GradeAssessment", "DevelopmentScore", "DevelopmentAssessment", "DevelopmentCriterion", "AnnouncementReceipt", "AnnouncementDeliveryReport", "Announcement", "SmsBatchDeliveryReport", "MessageTemplate", "ReportSnapshot", "ExamResult", "ParsedAnswer", "ImportQuarantine", "AnswerKey", "ExamBookletVariant", "ExamParticipant", "RawImport", "ParserConfig", "Exam", "OpticalFormTemplate", "LearningOutcome", "HomeworkMaterialAssignment", "HomeworkMaterialFile", "HomeworkSubmission", "Homework", "HomeworkMaterial", "StudySessionStudent", "StudySession", "ScheduleLesson", "TeacherNote", "Attendance", "TeacherAssignment", "StudentContact", "GuardianStudent", "StudentEnrollment", "Student", "Guardian", "Teacher", "TenantMembership", "Employee", "User", "Class", "GradeLevelCourse", "Alan", "AcademicTerm", "AcademicYear", "GradeLevel", "Course", "Campus", "IdempotencyKey"] as const;

export async function purgeResetDatabase(db: Queryable, op: FreshResetOperation, expectedDataDigest: string, clearance: typeof requireResetLegalClearance = requireResetLegalClearance, quiescence: typeof requireResetWriteQuiescence = requireResetWriteQuiescence): Promise<number> {
  await requireNoTenantMutationActivity(db, op.tenantId);
  await clearance(op.tenantId, db, op);
  await quiescence(op.tenantId);
  await assertResetWorkerRole(db);
  const locked = await db.query<{ status: string; lifecycleVersion: number }>('SELECT "status", "lifecycleVersion" FROM "Tenant" WHERE "id" = $1 FOR UPDATE', [op.tenantId]);
  if (locked.rows[0]?.status !== "SUSPENDED" || locked.rows[0].lifecycleVersion !== op.expectedLifecycleVersion) throw new Error("RESET_SOURCE_CHANGED");
  const snapshot = await readResetSnapshot(db, op.tenantId, op.id);
  if (snapshot.dataDigest !== expectedDataDigest) throw new Error("RESET_SOURCE_CHANGED");
  const purge = isLicenseExpiryPurge(op);
  const blockers = (purge ? licenseExpiryPurgeBlockers(resetSnapshotBlockers(snapshot)) : resetSnapshotBlockers(snapshot)).filter((code) => !["INSTITUTION_REQUEST_REQUIRED", "WRITE_QUIESCENCE_UNVERIFIED"].includes(code));
  if (blockers.length) throw new Error("RESET_PREFLIGHT_BLOCKED");
  if (purge) {
    // Records the worker role may never delete (finance, support, consent, usage, audit) go through one
    // SECURITY DEFINER function which re-checks the license under the Tenant lock. Children before parents.
    await db.query("SELECT o_okul_license_expiry_purge($1, $2, false)", [op.tenantId, op.id]);
    await deleteResetTables(db, op.tenantId, snapshot, [], [], []);
    await verifyResetPostconditions(db, op, 0);
    return 0;
  }
  const owners = [...resetOwnerIds(snapshot.tables, new Date(snapshot.capturedAt))];
  const memberships = resetOwnerMemberships(snapshot.tables, new Date(snapshot.capturedAt)).filter((row) => owners.includes(String(row.userId))).map((row) => String(row.id));
  const employees = snapshot.tables.Employee.filter((row) => owners.includes(String(row.userId)) && row.status === "ACTIVE" && row.deletedAt == null).map((row) => String(row.id));
  if (!owners.length || memberships.length !== owners.length || employees.length !== owners.length) throw new Error("RESET_OWNER_UNVERIFIED");
  await deleteResetTables(db, op.tenantId, snapshot, owners, memberships, employees);
  await db.query('UPDATE "TenantMembership" SET "role" = \'TENANT_OWNER\', "staffRole" = \'TENANT_OWNER\', "scopeMode" = \'TENANT\', "hasTeacherPersona" = false, "hasStudentPersona" = false, "version" = "version" + 1, "updatedAt" = now() WHERE "tenantId" = $1 AND "id" = ANY($2::text[])', [op.tenantId, memberships]);
  await db.query('UPDATE "User" u SET "mustChangePassword" = true, "membershipVersion" = m."version", "updatedAt" = now() FROM "TenantMembership" m WHERE u."tenantId" = $1 AND m."tenantId" = $1 AND u."id" = m."userId" AND m."id" = ANY($2::text[])', [op.tenantId, memberships]);
  await verifyResetPostconditions(db, op, owners.length);
  return owners.length;
}
async function deleteResetTables(db: Queryable, tenantId: string, snapshot: TenantResetSnapshot, owners: string[], memberships: string[], employees: string[]): Promise<void> {
  await db.query('UPDATE "Exam" SET "linkedTytExamId" = NULL WHERE "tenantId" = $1', [tenantId]);
  for (const table of resetDeleteOrder) {
    let predicate = '"tenantId" = $1';
    if (table === "ConsumedRefreshToken") predicate = '"tokenFamilyId" IN (SELECT "tokenFamilyId" FROM "AuthSession" WHERE "tenantId" = $1)';
    if (table === "PasswordResetToken") predicate = '"userId" IN (SELECT "id" FROM "User" WHERE "tenantId" = $1)';
    if (table === "SecretDeliveryOutbox") predicate = '"tenantId" = $1 OR ("purpose" = \'PASSWORD_RESET\' AND "sourceId" IN (SELECT p."id" FROM "PasswordResetToken" p JOIN "User" u ON u."id" = p."userId" WHERE u."tenantId" = $1)) OR ("purpose" = \'IDENTITY_INVITATION\' AND "sourceId" IN (SELECT "id" FROM "IdentityInvitation" WHERE "tenantId" = $1))';
    const keep = table === "TenantMembership" ? memberships : table === "Employee" ? employees : owners;
    if (table === "User" || table === "TenantMembership" || table === "Employee") predicate += ' AND NOT ("id" = ANY($2::text[]))';
    await db.query(`DELETE FROM "${table}" WHERE ${predicate}`, [tenantId, ...(["User", "TenantMembership", "Employee"].includes(table) ? [keep] : [])]);
    if (table === "ConsumedRefreshToken") {
      // RLS sees families only while their AuthSession parents still exist.
      const families = snapshot.tables.AuthSession.map((row) => String(row.tokenFamilyId));
      const tokens = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM "ConsumedRefreshToken" WHERE "tokenFamilyId" = ANY($1::text[])', [families]);
      if (tokens.rows[0]?.count !== 0) throw new Error("RESET_POSTCONDITION_FAILED");
    }
  }
}
export async function verifyResetPostconditions(db: Queryable, op: FreshResetOperation, ownerCount: number): Promise<void> {
  const snapshot = await readResetSnapshot(db, op.tenantId, op.id);
  if (isLicenseExpiryPurge(op)) {
    // AuditLog is excluded: phase records written after the purge are removed with the final receipt.
    const left = licenseExpiryPurgeTables().filter((table) => table !== "AuditLog" && snapshot.tables[table as keyof typeof snapshot.tables].length);
    if (ownerCount !== 0 || left.length || licenseExpiryPurgeBlockers(resetSnapshotBlockers(snapshot)).some((code) => code !== "WRITE_QUIESCENCE_UNVERIFIED")) throw new Error("RESET_POSTCONDITION_FAILED");
    return;
  }
  const owners = resetOwnerIds(snapshot.tables, new Date(snapshot.capturedAt));
  if (owners.size !== ownerCount || !ownerCount || snapshot.tables.User.length !== ownerCount || snapshot.tables.Employee.length !== ownerCount || snapshot.tables.TenantMembership.length !== ownerCount || snapshot.tables.User.some((row) => row.mustChangePassword !== true) || snapshot.tables.TenantMembership.some((row) => row.hasTeacherPersona || row.hasStudentPersona || row.scopeMode !== "TENANT")) throw new Error("RESET_POSTCONDITION_FAILED");
  for (const table of resetDeleteOrder) if (!["User", "Employee", "TenantMembership"].includes(table) && snapshot.tables[table].length) throw new Error("RESET_POSTCONDITION_FAILED");
  if (resetSnapshotBlockers(snapshot).some((code) => !["INSTITUTION_REQUEST_REQUIRED", "WRITE_QUIESCENCE_UNVERIFIED"].includes(code))) throw new Error("RESET_POSTCONDITION_FAILED");
}
