import { readFileSync } from "node:fs";

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = readFileSync(
  new URL("../prisma/migrations/20260801190000_add_account_management_foundation/migration.sql", import.meta.url),
  "utf8",
);
const emailScopeMigration = readFileSync(
  new URL("../prisma/migrations/20260801200000_drop_global_user_email_unique/migration.sql", import.meta.url),
  "utf8",
);
const licenseUsageMigration = readFileSync(
  new URL("../prisma/migrations/20260801210000_enforce_active_student_license_usage/migration.sql", import.meta.url),
  "utf8",
);
const gateDRuntimeGrantMigration = readFileSync(
  new URL("../prisma/migrations/20260811222500_grant_gate_d_runtime_permissions/migration.sql", import.meta.url),
  "utf8",
);
const platformIdempotencyMigration = readFileSync(
  new URL("../prisma/migrations/20260801220000_add_platform_idempotency_key/migration.sql", import.meta.url),
  "utf8",
);
const platformIdempotencyGrantMigration = readFileSync(
  new URL("../prisma/migrations/20260803233000_grant_platform_idempotency_key_app/migration.sql", import.meta.url),
  "utf8",
);
const accountManagementListIndexesMigration = readFileSync(
  new URL("../prisma/migrations/20260801230000_add_account_management_list_indexes/migration.sql", import.meta.url),
  "utf8",
);
const studentPortalActivationMigration = readFileSync(
  new URL("../prisma/migrations/20260801240000_add_student_portal_activation/migration.sql", import.meta.url),
  "utf8",
);
const secretDeliveryWorkerMigration = readFileSync(
  new URL("../prisma/migrations/20260802020000_prepare_secret_delivery_worker_role/migration.sql", import.meta.url),
  "utf8",
);
const whatsappConsentMigration = readFileSync(
  new URL("../prisma/migrations/20260808150000_add_whatsapp_consent_foundation/migration.sql", import.meta.url),
  "utf8",
);
const whatsappConsentLifecycleMigration = readFileSync(
  new URL("../prisma/migrations/20260808170000_add_whatsapp_consent_lifecycle/migration.sql", import.meta.url),
  "utf8",
);
const employeePendingInvitationMigration = readFileSync(
  new URL("../prisma/migrations/20260810114500_employee_pending_invitation_unique/migration.sql", import.meta.url),
  "utf8",
);

const failures = [];
const tenantModels = ["LicenseTerm", "LicenseUsage", "Employee", "MembershipCampusScope", "StudentContact"];

for (const model of ["PlatformAccount", "PlatformSession", "PlatformIdempotencyKey", "WhatsAppConsent", "WhatsAppConsentEvent", ...tenantModels]) {
  requireToken(schema, `model ${model} {`, `schema model ${model}`);
}

for (const token of [
  `CREATE TABLE "WhatsAppConsent"`,
  `WhatsAppConsent_tenantId_phoneHash_purpose_key`,
  `WhatsAppConsent_phoneHash_check`,
  `WhatsAppConsent_purpose_check`,
  `"canReceiveWhatsapp" BOOLEAN NOT NULL DEFAULT false`,
  `WhatsAppConsent_state_check`,
  `AND ("withdrawnAt" IS NULL OR "withdrawnAt" >= "recordedAt")`,
  `ALTER TABLE "WhatsAppConsent" ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE "WhatsAppConsent" FORCE ROW LEVEL SECURITY;`,
  `CREATE POLICY "WhatsAppConsent_tenant_isolation"`,
]) {
  requireToken(whatsappConsentMigration, token, token);
}
for (const token of [
  `BEGIN;`,
  `LOCK TABLE "WhatsAppConsent" IN ACCESS EXCLUSIVE MODE;`,
  `set_config('app.bypass_rls', 'true', true)`,
  `IF (SELECT count(*) FROM "WhatsAppConsent") <> 0 THEN`,
  `set_config('app.bypass_rls', 'false', true)`,
  `WHATSAPP_CONSENT_LIFECYCLE_REQUIRES_EMPTY_PROJECTION`,
  `CREATE TABLE "WhatsAppConsentEvent"`,
  `WhatsAppConsentEvent_tenantId_whatsappConsentId_purpose_fkey`,
  `WhatsAppConsentEvent_tenantId_studentContactId_fkey`,
  `WhatsAppConsentEvent_tenantId_fkey`,
  `ON DELETE RESTRICT ON UPDATE CASCADE`,
  `WhatsAppConsentEvent_eventType_check`,
  `'^[a-z0-9][a-z0-9._-]{0,63}$'`,
  `WhatsAppConsentEvent_source_check`,
  `WhatsAppConsentEvent_commandKeyHash_check`,
  `WhatsAppConsentEvent_requestHash_check`,
  `o_okul_guard_whatsapp_consent_projection_insert`,
  `WHATSAPP_CONSENT_PROJECTION_MUST_START_INACTIVE`,
  `o_okul_record_whatsapp_consent_event`,
  `existing_event."studentContactId" = NEW."studentContactId"`,
  `existing_event."eventType" = NEW."eventType"`,
  `existing_event."noticeVersion" = NEW."noticeVersion"`,
  `existing_event."source" = NEW."source"`,
  `existing_event."requestHash" = NEW."requestHash"`,
  `WHATSAPP_CONSENT_IDEMPOTENCY_CONFLICT`,
  `FOR UPDATE`,
  `WHATSAPP_CONSENT_CONTACT_INACTIVE_OR_PHONE_MISMATCH`,
  `WHATSAPP_CONSENT_INVALID_STATE_TRANSITION`,
  `ALTER TABLE "WhatsAppConsentEvent" ENABLE ROW LEVEL SECURITY;`,
  `ALTER TABLE "WhatsAppConsentEvent" FORCE ROW LEVEL SECURITY;`,
  `CREATE POLICY "WhatsAppConsentEvent_tenant_isolation"`,
  `WITH CHECK ("tenantId" = current_setting('app.current_tenant_id', true));`,
  `REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "WhatsAppConsent" FROM app;`,
  `GRANT SELECT, INSERT ON "WhatsAppConsent" TO app;`,
  `REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON "WhatsAppConsentEvent" FROM app;`,
  `GRANT SELECT, INSERT ON "WhatsAppConsentEvent" TO app;`,
  `COMMIT;`,
]) {
  requireToken(whatsappConsentLifecycleMigration, token, token);
}
if (/\b(?:UPDATE|DELETE)\s+ON\s+"WhatsAppConsent(?:Event)?"\s+TO\s+app/.test(whatsappConsentLifecycleMigration)) {
  failures.push("WhatsApp consent lifecycle tablolarına app UPDATE/DELETE verilmemeli.");
}
for (const token of [
  `BEGIN;`,
  `LOCK TABLE "IdentityInvitation" IN SHARE ROW EXCLUSIVE MODE;`,
  `IdentityInvitation_one_pending_employee_key`,
  `COMMIT;`,
]) {
  requireToken(employeePendingInvitationMigration, token, `employee pending invitation migration ${token}`);
}
if (/GuardianStudent|canReceiveSms/.test(whatsappConsentMigration)) {
  failures.push("WhatsApp consent migration'ı GuardianStudent veya SMS iznini yeniden kullanmamalı.");
}

for (const token of [
  `CREATE TABLE "PlatformIdempotencyKey"`,
  `PlatformIdempotencyKey_account_key_operation_key`,
  `FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE`,
]) {
  requireToken(platformIdempotencyMigration, token, token);
}
requireToken(
  platformIdempotencyGrantMigration,
  `GRANT SELECT, INSERT, UPDATE ON "PlatformIdempotencyKey" TO app;`,
  "PlatformIdempotencyKey app runtime grant",
);
if (/GRANT\s+SELECT,\s*INSERT,\s*UPDATE,\s*DELETE\s+ON\s+"PlatformIdempotencyKey"\s+TO\s+app;/.test(platformIdempotencyGrantMigration)) {
  failures.push("PlatformIdempotencyKey app rolüne DELETE verilmemeli.");
}

for (const table of tenantModels) {
  requireToken(migration, `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`, `${table} ENABLE RLS`);
  requireToken(migration, `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;`, `${table} FORCE RLS`);
  requireToken(migration, `CREATE POLICY "${table}_tenant_isolation"`, `${table} tenant policy`);
}

for (const token of [
  `EXCLUDE USING GIST`,
  `tstzrange("startsAt", "endsAt", '[)')`,
  `"activeStudentLimit" > 0`,
  `"peakActiveStudentCount" >= "activeStudentCount"`,
  `TenantMembership_tenantId_userId_canonical_key`,
  `TenantMembership_persona_combination_check`,
  `StudentContact_consent_check`,
  `FOREIGN KEY ("tenantId", "membershipId") REFERENCES "TenantMembership"("tenantId", "id")`,
  `FOREIGN KEY ("tenantId", "studentId") REFERENCES "Student"("tenantId", "id")`,
  `FOREIGN KEY ("tenantId", "employeeId") REFERENCES "Employee"("tenantId", "id")`,
]) {
  requireToken(migration, token, token);
}

requireToken(emailScopeMigration, `DROP INDEX IF EXISTS "User_email_key";`, "global User email unique drop");
if (/email\s+String\?\s+@unique/.test(schema)) {
  failures.push("User.email global unique olmamalı.");
}
requireToken(schema, "@@unique([tenantId, emailNormalized])", "tenant normalized email unique");

for (const token of [
  `StudentEnrollment_one_open_active_per_student_key`,
  `CREATE OR REPLACE FUNCTION o_okul_refresh_license_usage`,
  `FOR UPDATE`,
  `MESSAGE = 'ACTIVE_STUDENT_LIMIT_REACHED'`,
  `"peakActiveStudentCount" = GREATEST(`,
  `CREATE TRIGGER "Student_sync_license_usage"`,
  `CREATE TRIGGER "StudentEnrollment_sync_license_usage"`,
]) {
  requireToken(licenseUsageMigration, token, token);
}
requireToken(
  gateDRuntimeGrantMigration,
  `GRANT EXECUTE ON FUNCTION public.o_okul_refresh_license_usage(TEXT) TO app;`,
  "license usage refresh app runtime grant",
);

for (const token of [
  `Student_portal_access_cursor_idx`,
  `User_emailNormalized_search_trgm_idx`,
  `IdentityInvitation_student_email_search_trgm_idx`,
]) {
  requireToken(accountManagementListIndexesMigration, token, token);
}

for (const token of [
  `IdentityInvitation_kind_check`,
  `IdentityInvitation_attempts_check`,
  `IdentityInvitation_kind_payload_check`,
  `IdentityInvitation_one_pending_student_code_key`,
  `IdentityInvitation_student_code_lookup_idx`,
]) {
  requireToken(studentPortalActivationMigration, token, token);
}

for (const token of [
  `SECRET_DELIVERY_WORKER_ROLE_REQUIRED`,
  `GRANT SELECT, UPDATE ON "SecretDeliveryOutbox" TO secret_delivery_worker`,
]) {
  requireToken(secretDeliveryWorkerMigration, token, token);
}
if (/\bREVOKE\b/.test(secretDeliveryWorkerMigration)) {
  failures.push("Ayrı worker rolü hazırlık migration'ı app yetkilerini geri almamalı.");
}
requireToken(
  gateDRuntimeGrantMigration,
  `GRANT USAGE ON SCHEMA public TO secret_delivery_worker;`,
  "secret delivery worker public schema usage grant",
);

if (/GRANT[\s\S]*?"PlatformAccount"[\s\S]*?TO app;/.test(migration)) {
  failures.push("PlatformAccount tenant app rolüne grant edilmemeli.");
}
if (/GRANT[\s\S]*?"PlatformSession"[\s\S]*?TO app;/.test(migration)) {
  failures.push("PlatformSession tenant app rolüne grant edilmemeli.");
}

if (failures.length > 0) {
  console.error("Account management DB foundation kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Account management DB foundation kontrolü geçti.");

function requireToken(source, token, label) {
  if (!source.includes(token)) failures.push(`${label} eksik.`);
}
