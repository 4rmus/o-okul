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
const platformIdempotencyMigration = readFileSync(
  new URL("../prisma/migrations/20260801220000_add_platform_idempotency_key/migration.sql", import.meta.url),
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

const failures = [];
const tenantModels = ["LicenseTerm", "LicenseUsage", "Employee", "MembershipCampusScope", "StudentContact"];

for (const model of ["PlatformAccount", "PlatformSession", "PlatformIdempotencyKey", ...tenantModels]) {
  requireToken(schema, `model ${model} {`, `schema model ${model}`);
}

for (const token of [
  `CREATE TABLE "PlatformIdempotencyKey"`,
  `PlatformIdempotencyKey_account_key_operation_key`,
  `FOREIGN KEY ("platformAccountId") REFERENCES "PlatformAccount"("id") ON DELETE CASCADE`,
]) {
  requireToken(platformIdempotencyMigration, token, token);
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
