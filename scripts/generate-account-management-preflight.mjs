import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const expectedFoundationTables = [
  "PlatformAccount",
  "PlatformSession",
  "LicenseTerm",
  "LicenseUsage",
  "Employee",
  "MembershipCampusScope",
  "StudentContact",
];
const outputPath = readOption("--output") ?? process.env.ACCOUNT_MANAGEMENT_PREFLIGHT_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV;
const databaseUrl = process.env.DIRECT_DATABASE_URL;
const guardianClassification = process.env.ACCOUNT_MANAGEMENT_GUARDIAN_CLASSIFICATION?.trim() || "UNVERIFIED";
const guardianEvidenceReference = process.env.ACCOUNT_MANAGEMENT_GUARDIAN_EVIDENCE_REFERENCE?.trim() || null;

const failures = [];
requireValue(outputPath, "ACCOUNT_MANAGEMENT_PREFLIGHT_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireValue(databaseUrl, "DIRECT_DATABASE_URL", failures);
requireOneOf(
  guardianClassification,
  "ACCOUNT_MANAGEMENT_GUARDIAN_CLASSIFICATION",
  ["UNVERIFIED", "FIXTURE_ONLY", "CUSTOMER_DATA_PRESENT"],
  failures,
);
if (guardianClassification !== "UNVERIFIED") {
  requireDecisionReference(guardianEvidenceReference, "ACCOUNT_MANAGEMENT_GUARDIAN_EVIDENCE_REFERENCE", failures);
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
let client;
try {
  client = await pool.connect();
  await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '30s'");
  await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
  const checks = await collectChecks(client);
  await client.query("COMMIT");

  const blockers = deriveBlockers(checks);
  const report = {
    schemaVersion: 1,
    result: blockers.length === 0 ? "PASS" : "BLOCKED",
    environment,
    checkedAt: new Date().toISOString(),
    databaseReadOnly: true,
    checks,
    blockers,
    gaps: [...blockers],
  };

  mkdirSync(dirname(outputFile), { recursive: true });
  validateOutputTarget(outputFile);
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  validateOutputTarget(outputFile);

  const checked = spawnSync(process.execPath, ["scripts/check-account-management-preflight.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET: pathToFileURL(outputFile).href,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (checked.status !== 0) process.exit(checked.status ?? 1);
  console.log(`Account management preflight yazıldı: ${outputFile}`);
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client?.release();
  await pool.end();
}

async function collectChecks(client) {
  const foundation = await client.query(
    `SELECT count(*)::int AS "presentTables"
     FROM unnest($1::text[]) AS expected("tableName")
     WHERE to_regclass(format('public.%I', expected."tableName")) IS NOT NULL`,
    [expectedFoundationTables],
  );
  const presentTables = number(foundation.rows[0]?.presentTables);
  if (presentTables !== expectedFoundationTables.length) {
    fail([`Account management foundation eksik: ${presentTables}/${expectedFoundationTables.length} tablo.`]);
  }

  const tenantEmailCollisions = await one(client, `
    WITH collisions AS (
      SELECT "tenantId", lower(btrim("email")) AS normalized, count(*)::int AS accounts
      FROM "User"
      WHERE "tenantId" IS NOT NULL AND "email" IS NOT NULL AND btrim("email") <> ''
      GROUP BY "tenantId", lower(btrim("email"))
      HAVING count(*) > 1
    )
    SELECT count(*)::int AS groups,
           coalesce(sum(accounts), 0)::int AS accounts,
           count(DISTINCT "tenantId")::int AS "tenantsAffected"
    FROM collisions`);

  const multipleOpenEnrollments = await one(client, `
    WITH duplicates AS (
      SELECT "tenantId", "studentId", count(*)::int AS enrollments
      FROM "StudentEnrollment"
      WHERE "status" = 'ACTIVE' AND "endsAt" IS NULL
      GROUP BY "tenantId", "studentId"
      HAVING count(*) > 1
    )
    SELECT count(*)::int AS students,
           coalesce(sum(enrollments), 0)::int AS enrollments,
           count(DISTINCT "tenantId")::int AS "tenantsAffected"
    FROM duplicates`);

  const invalidRoleCombinations = await one(client, `
    WITH role_sets AS (
      SELECT "tenantId", "userId",
             count(DISTINCT "role")::int AS role_count,
             count(DISTINCT "role") FILTER (
               WHERE "role"::text IN ('TENANT_OWNER', 'TENANT_ADMIN', 'ASSISTANT_ADMIN', 'OPERATIONS_STAFF', 'FINANCE_STAFF')
             )::int AS staff_role_count,
             bool_or("role"::text = 'SYSTEM_ADMIN') AS has_system,
             bool_or("role"::text = 'STUDENT') AS has_student,
             bool_or("role"::text = 'GUARDIAN') AS has_guardian
      FROM "TenantMembership"
      GROUP BY "tenantId", "userId"
    ), invalid AS (
      SELECT "tenantId", "userId"
      FROM role_sets
      WHERE has_system
         OR staff_role_count > 1
         OR (has_student AND role_count > 1)
         OR (has_guardian AND role_count > 1)
    )
    SELECT count(*)::int AS accounts,
           count(DISTINCT "tenantId")::int AS "tenantsAffected"
    FROM invalid`);

  const orphanProfileLinks = await one(client, `
    WITH profile_links AS (
      SELECT "tenantId", "userId", 'STUDENT'::text AS role FROM "Student" WHERE "deletedAt" IS NULL AND "userId" IS NOT NULL
      UNION ALL
      SELECT "tenantId", "userId", 'TEACHER'::text AS role FROM "Teacher" WHERE "deletedAt" IS NULL AND "userId" IS NOT NULL
      UNION ALL
      SELECT "tenantId", "userId", 'GUARDIAN'::text AS role FROM "Guardian" WHERE "deletedAt" IS NULL AND "userId" IS NOT NULL
    ), orphaned AS (
      SELECT profile."tenantId", profile."userId", profile.role
      FROM profile_links profile
      LEFT JOIN "User" account
        ON account."tenantId" = profile."tenantId" AND account."id" = profile."userId"
      LEFT JOIN "TenantMembership" membership
        ON membership."tenantId" = profile."tenantId"
       AND membership."userId" = profile."userId"
       AND membership."role"::text = profile.role
      WHERE account."id" IS NULL OR membership."id" IS NULL
    )
    SELECT count(*)::int AS profiles,
           count(DISTINCT "tenantId")::int AS "tenantsAffected"
    FROM orphaned`);

  const orphanSubjectMemberships = await one(client, `
    WITH subject_memberships AS (
      SELECT "tenantId", "userId", "role"::text AS role
      FROM "TenantMembership"
      WHERE "role"::text IN ('STUDENT', 'TEACHER', 'GUARDIAN')
    ), orphaned AS (
      SELECT membership."tenantId", membership."userId"
      FROM subject_memberships membership
      WHERE (membership.role = 'STUDENT' AND NOT EXISTS (
               SELECT 1 FROM "Student" subject
               WHERE subject."tenantId" = membership."tenantId" AND subject."userId" = membership."userId" AND subject."deletedAt" IS NULL
            ))
         OR (membership.role = 'TEACHER' AND NOT EXISTS (
               SELECT 1 FROM "Teacher" subject
               WHERE subject."tenantId" = membership."tenantId" AND subject."userId" = membership."userId" AND subject."deletedAt" IS NULL
            ))
         OR (membership.role = 'GUARDIAN' AND NOT EXISTS (
               SELECT 1 FROM "Guardian" subject
               WHERE subject."tenantId" = membership."tenantId" AND subject."userId" = membership."userId" AND subject."deletedAt" IS NULL
            ))
    )
    SELECT count(*)::int AS accounts,
           count(DISTINCT "tenantId")::int AS "tenantsAffected"
    FROM orphaned`);

  const teacherEmployeeBackfill = await one(client, `
    SELECT count(*)::int AS teachers,
           count(*) FILTER (WHERE teacher."employeeId" IS NULL)::int AS "missingEmployeeLinks",
           count(DISTINCT teacher."tenantId") FILTER (WHERE teacher."employeeId" IS NULL)::int AS "tenantsAffected"
    FROM "Teacher" teacher
    WHERE teacher."deletedAt" IS NULL`);

  const guardianInventory = await one(client, `
    SELECT
      (SELECT count(*)::int FROM "Guardian" WHERE "deletedAt" IS NULL) AS guardians,
      (SELECT count(*)::int FROM "GuardianStudent") AS "studentLinks",
      (SELECT count(*)::int FROM "Guardian" WHERE "deletedAt" IS NULL AND "userId" IS NOT NULL) AS "linkedAccounts",
      (SELECT count(*)::int FROM "AuthSession" WHERE "subjectType" = 'GUARDIAN' AND "status" = 'ACTIVE') AS "activeSessions",
      (SELECT count(*)::int FROM "IdentityInvitation" WHERE "subjectType" = 'GUARDIAN' AND "status" = 'PENDING') AS "pendingInvitations",
      (SELECT count(DISTINCT "tenantId")::int FROM "Guardian" WHERE "deletedAt" IS NULL) AS "tenantsAffected"`);

  return {
    foundation: { expectedTables: expectedFoundationTables.length, presentTables },
    tenantEmailCollisions,
    multipleOpenEnrollments,
    invalidRoleCombinations,
    orphanProfileLinks,
    orphanSubjectMemberships,
    teacherEmployeeBackfill,
    guardianInventory: {
      ...guardianInventory,
      classification: guardianClassification,
      classificationEvidenceReference: guardianEvidenceReference,
    },
  };
}

function deriveBlockers(checks) {
  const blockers = [];
  if (checks.tenantEmailCollisions.groups > 0) blockers.push("TENANT_EMAIL_COLLISIONS");
  if (checks.multipleOpenEnrollments.students > 0) blockers.push("MULTIPLE_OPEN_ENROLLMENTS");
  if (checks.invalidRoleCombinations.accounts > 0) blockers.push("INVALID_ROLE_COMBINATIONS");
  if (checks.orphanProfileLinks.profiles > 0) blockers.push("ORPHAN_PROFILE_LINKS");
  if (checks.orphanSubjectMemberships.accounts > 0) blockers.push("ORPHAN_SUBJECT_MEMBERSHIPS");
  if (checks.guardianInventory.guardians > 0 && checks.guardianInventory.classification === "UNVERIFIED") {
    blockers.push("GUARDIAN_DATA_PROVENANCE_UNVERIFIED");
  }
  if (checks.guardianInventory.guardians > 0 && checks.guardianInventory.classification === "CUSTOMER_DATA_PRESENT") {
    blockers.push("GUARDIAN_CUSTOMER_DATA_PRESENT");
  }
  return blockers;
}

async function one(client, sql) {
  const result = await client.query(sql);
  const row = result.rows[0] ?? {};
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, number(value)]));
}

function number(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("ACCOUNT_MANAGEMENT_PREFLIGHT_COUNT_INVALID");
  return parsed;
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail([`${name} için değer gerekli.`]);
  return value;
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") output.push(`${label} boş bırakılamaz.`);
}

function requireOneOf(value, label, allowed, output) {
  if (!allowed.includes(value)) output.push(`${label} ${allowed.join(" veya ")} olmalı.`);
}

function requireDecisionReference(value, label, output) {
  requireValue(value, label, output);
  if (typeof value !== "string") return;
  const normalized = value.toLowerCase();
  if (["example", "placeholder", "redacted", "__set", "todo", "tbd", ".test", "localhost"].some((token) => normalized.includes(token))) {
    output.push(`${label} gerçek kanıt referansı olmalı.`);
  }
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_OUTPUT lokal temp path olmamalı."]);
  assertParentPathAllowed(dirname(filePath));
  if (!existsSync(filePath)) return;
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_OUTPUT symlink olmayan file artifact olmalı."]);
  }
}

function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["ACCOUNT_MANAGEMENT_PREFLIGHT_OUTPUT parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return ["/tmp", "/var/tmp", "/private/tmp"].some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function fail(messages) {
  console.error("Account management preflight üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
