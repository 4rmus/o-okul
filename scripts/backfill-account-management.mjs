import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const mode = (process.env.ACCOUNT_MANAGEMENT_BACKFILL_MODE ?? "DRY_RUN").trim().toUpperCase();
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV;
const databaseUrl = process.env.DIRECT_DATABASE_URL;
const outputPath = process.env.ACCOUNT_MANAGEMENT_BACKFILL_OUTPUT;
const ownerDecisionsTarget = process.env.ACCOUNT_MANAGEMENT_OWNER_DECISIONS_TARGET;
const applyConfirmation = process.env.ACCOUNT_MANAGEMENT_BACKFILL_CONFIRM;

const inputFailures = [];
requireOneOf(mode, "ACCOUNT_MANAGEMENT_BACKFILL_MODE", ["DRY_RUN", "APPLY"], inputFailures);
requireOneOf(environment, "environment", ["staging", "production"], inputFailures);
requireValue(databaseUrl, "DIRECT_DATABASE_URL", inputFailures);
requireValue(outputPath, "ACCOUNT_MANAGEMENT_BACKFILL_OUTPUT", inputFailures);
if (mode === "APPLY" && applyConfirmation !== "apply-pr4-backfill") {
  inputFailures.push("ACCOUNT_MANAGEMENT_BACKFILL_CONFIRM apply-pr4-backfill olmalı.");
}
if (inputFailures.length > 0) fail(inputFailures);

const ownerDecisions = readOwnerDecisions(ownerDecisionsTarget);
const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
let client;
let report;
try {
  client = await pool.connect();
  await client.query(mode === "APPLY" ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '60s'");
  await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
  if (mode === "APPLY") {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('o-okul:account-management:pr4-backfill'))");
  }

  const foundation = await collectFoundation(client);
  const ownerResolution = await resolveOwners(client, ownerDecisions);
  const preconditions = await collectPreconditions(client);
  const before = await collectReadiness(client, ownerResolution.selections);
  const blockers = deriveBlockers(foundation, preconditions, ownerResolution, before);

  if (mode === "APPLY" && blockers.length === 0) {
    await applyBackfill(client, ownerResolution.selections);
  }

  const after = mode === "APPLY" && blockers.length === 0
    ? await collectReadiness(client, ownerResolution.selections)
    : before;
  if (mode === "APPLY" && blockers.length === 0) {
    blockers.push(...derivePostconditionBlockers(after));
  }

  const result = blockers.length > 0 ? "BLOCKED" : mode === "APPLY" ? "PASS" : "READY";
  report = {
    schemaVersion: 1,
    result,
    mode,
    environment,
    checkedAt: new Date().toISOString(),
    databaseMutationApplied: mode === "APPLY" && result === "PASS",
    checks: {
      foundation,
      preconditions,
      owners: ownerResolution.counts,
      tenantAccounts: {
        total: after.tenantAccounts.total,
        ready: after.tenantAccounts.ready,
        plannedWrites: Math.max(0, before.tenantAccounts.total - before.tenantAccounts.ready),
      },
      platformAccounts: {
        sourceAccounts: after.platformAccounts.sourceAccounts,
        readyAccounts: after.platformAccounts.readyAccounts,
        sourceSessions: after.platformAccounts.sourceSessions,
        readySessions: after.platformAccounts.readySessions,
      },
      memberships: after.memberships,
      employees: after.employees,
      sessions: after.sessions,
    },
    blockers: [...new Set(blockers)],
    gaps: [...new Set(blockers)],
  };

  if (mode === "APPLY" && report.result === "PASS") await client.query("COMMIT");
  else await client.query("ROLLBACK");
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client?.release();
  await pool.end();
}

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile);

const checked = spawnSync(process.execPath, ["scripts/check-account-management-backfill.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    ACCOUNT_MANAGEMENT_BACKFILL_TARGET: pathToFileURL(outputFile).href,
    ACCOUNT_MANAGEMENT_BACKFILL_ALLOW_READY: mode === "DRY_RUN" ? "1" : "0",
  },
  stdio: "inherit",
});
if (checked.status !== 0) process.exit(checked.status ?? 1);
console.log(`Account management backfill raporu yazıldı: ${outputFile}`);

async function collectFoundation(queryable) {
  const expectedTables = [
    "PlatformAccount",
    "PlatformSession",
    "LicenseTerm",
    "LicenseUsage",
    "Employee",
    "MembershipCampusScope",
    "StudentContact",
  ];
  const result = await queryable.query(
    `SELECT count(*)::int AS present
     FROM unnest($1::text[]) AS expected(name)
     WHERE to_regclass(format('public.%I', expected.name)) IS NOT NULL`,
    [expectedTables],
  );
  return { expectedTables: expectedTables.length, presentTables: number(result.rows[0]?.present) };
}

async function resolveOwners(queryable, decisions) {
  const tenants = await queryable.query(
    `SELECT "id"
     FROM "Tenant"
     WHERE "id" <> 'system' AND "status" NOT IN ('DELETED', 'CLOSED')
     ORDER BY "id"`,
  );
  const candidates = await queryable.query(
    `SELECT m."tenantId", m."userId", m."role"::text AS role,
            (u."passwordChangedAt" IS NOT NULL OR u."totpEnabledAt" IS NOT NULL) AS verified,
            m."createdAt" AS "membershipCreatedAt", u."createdAt" AS "userCreatedAt"
     FROM "TenantMembership" m
     JOIN "User" u ON u."tenantId" = m."tenantId" AND u."id" = m."userId"
     WHERE m."status" = 'ACTIVE' AND m."role"::text IN ('TENANT_OWNER', 'TENANT_ADMIN')
     ORDER BY m."tenantId", m."createdAt", u."createdAt", m."userId"`,
  );
  const byTenant = new Map();
  for (const row of candidates.rows) {
    const values = byTenant.get(row.tenantId) ?? [];
    values.push(row);
    byTenant.set(row.tenantId, values);
  }
  const decisionByTenant = new Map(decisions.map((decision) => [decision.tenantId, decision]));
  const knownTenantIds = new Set(tenants.rows.map((row) => row.id));
  const blockers = [];
  const selections = [];
  const counts = {
    activeTenants: tenants.rows.length,
    existingOwners: 0,
    automaticallyVerified: 0,
    decisionBacked: 0,
    missing: 0,
  };

  for (const decision of decisions) {
    if (!knownTenantIds.has(decision.tenantId)) blockers.push("OWNER_DECISION_TENANT_UNKNOWN");
  }
  for (const tenant of tenants.rows) {
    const rows = byTenant.get(tenant.id) ?? [];
    const existingOwners = rows.filter((row) => row.role === "TENANT_OWNER");
    if (existingOwners.length > 1) {
      blockers.push("OWNER_MULTIPLE_EXISTING");
      counts.missing += 1;
      continue;
    }
    if (existingOwners.length === 1) {
      selections.push({ tenantId: tenant.id, userId: existingOwners[0].userId });
      counts.existingOwners += 1;
      if (decisionByTenant.has(tenant.id)) blockers.push("OWNER_DECISION_REDUNDANT");
      continue;
    }

    const admins = rows.filter((row) => row.role === "TENANT_ADMIN");
    const decision = decisionByTenant.get(tenant.id);
    if (decision) {
      if (!admins.some((row) => row.userId === decision.userId)) {
        blockers.push("OWNER_DECISION_USER_NOT_ACTIVE_ADMIN");
        counts.missing += 1;
        continue;
      }
      selections.push({ tenantId: tenant.id, userId: decision.userId });
      counts.decisionBacked += 1;
      continue;
    }

    const verified = admins.find((row) => row.verified);
    if (verified) {
      selections.push({ tenantId: tenant.id, userId: verified.userId });
      counts.automaticallyVerified += 1;
    } else {
      blockers.push(admins.length > 0 ? "OWNER_VERIFICATION_REQUIRED" : "OWNER_SOURCE_MISSING");
      counts.missing += 1;
    }
  }
  return { selections, counts, blockers };
}

async function collectPreconditions(queryable) {
  const result = await queryable.query(`
    WITH email_collisions AS (
      SELECT "tenantId", lower(btrim("email")) AS normalized
      FROM "User"
      WHERE "tenantId" IS NOT NULL AND "email" IS NOT NULL AND btrim("email") <> ''
      GROUP BY "tenantId", lower(btrim("email"))
      HAVING count(*) > 1
    ), planned_logins AS (
      SELECT u."tenantId", u."id",
             coalesce(
               nullif(lower(btrim(u."loginNameNormalized")), ''),
               nullif(lower(btrim(u."loginName")), ''),
               nullif(lower(btrim(u."emailNormalized")), ''),
               nullif(lower(btrim(u."email")), ''),
               nullif(lower(btrim(student."studentNo")), ''),
               'account-' || lower(u."id")
             ) AS normalized
      FROM "User" u
      LEFT JOIN "Student" student
        ON student."tenantId" = u."tenantId" AND student."userId" = u."id" AND student."deletedAt" IS NULL
      WHERE u."tenantId" IS NOT NULL AND u."tenantId" <> 'system'
    ), login_collisions AS (
      SELECT "tenantId", normalized
      FROM planned_logins
      GROUP BY "tenantId", normalized
      HAVING count(*) > 1
    ), role_sets AS (
      SELECT m."tenantId", m."userId",
             count(DISTINCT m."role")::int AS role_count,
             count(DISTINCT m."role") FILTER (
               WHERE m."role"::text IN ('TENANT_OWNER', 'TENANT_ADMIN', 'ASSISTANT_ADMIN', 'OPERATIONS_STAFF', 'FINANCE_STAFF')
             )::int AS staff_role_count,
             bool_or(m."role"::text = 'STUDENT') AS has_student,
             bool_or(m."role"::text = 'GUARDIAN') AS has_guardian
      FROM "TenantMembership" m
      WHERE m."status" = 'ACTIVE' AND m."role"::text <> 'SYSTEM_ADMIN'
      GROUP BY m."tenantId", m."userId"
    ), invalid_roles AS (
      SELECT "tenantId", "userId" FROM role_sets
      WHERE staff_role_count > 1 OR (has_student AND role_count > 1) OR (has_guardian AND role_count > 1)
    ), profile_links AS (
      SELECT "tenantId", "userId", 'STUDENT'::text AS role FROM "Student" WHERE "deletedAt" IS NULL AND "userId" IS NOT NULL
      UNION ALL
      SELECT "tenantId", "userId", 'TEACHER'::text AS role FROM "Teacher" WHERE "deletedAt" IS NULL AND "userId" IS NOT NULL
      UNION ALL
      SELECT "tenantId", "userId", 'GUARDIAN'::text AS role FROM "Guardian" WHERE "deletedAt" IS NULL AND "userId" IS NOT NULL
    ), orphan_profiles AS (
      SELECT profile."tenantId", profile."userId"
      FROM profile_links profile
      LEFT JOIN "User" account ON account."tenantId" = profile."tenantId" AND account."id" = profile."userId"
      LEFT JOIN "TenantMembership" membership
        ON membership."tenantId" = profile."tenantId" AND membership."userId" = profile."userId"
       AND membership."role"::text = profile.role AND membership."status" = 'ACTIVE'
      WHERE account."id" IS NULL OR membership."id" IS NULL
    ), subject_memberships AS (
      SELECT "tenantId", "userId", "role"::text AS role
      FROM "TenantMembership"
      WHERE "status" = 'ACTIVE' AND "role"::text IN ('STUDENT', 'TEACHER', 'GUARDIAN')
    ), orphan_memberships AS (
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
    ), ambiguous_employees AS (
      SELECT teacher."tenantId", teacher."id"
      FROM "Teacher" teacher
      WHERE teacher."deletedAt" IS NULL AND teacher."employeeId" IS NULL
        AND 1 < (
          SELECT count(*) FROM "Employee" employee
          WHERE employee."tenantId" = teacher."tenantId"
            AND ((teacher."userId" IS NOT NULL AND employee."userId" = teacher."userId")
              OR (teacher."nationalIdHash" IS NOT NULL AND employee."nationalIdHash" = teacher."nationalIdHash"))
        )
    ), platform_identities AS (
      SELECT account."id",
             coalesce(nullif(lower(btrim(account."loginNameNormalized")), ''),
                      nullif(lower(btrim(account."loginName")), ''),
                      nullif(lower(btrim(account."email")), ''),
                      'platform-' || lower(account."id")) AS normalized_login,
             nullif(lower(btrim(account."email")), '') AS normalized_email
      FROM "User" account
      JOIN "TenantMembership" membership
        ON membership."tenantId" = account."tenantId" AND membership."userId" = account."id"
      WHERE membership."role"::text = 'SYSTEM_ADMIN' AND membership."status" = 'ACTIVE'
    ), platform_login_collisions AS (
      SELECT normalized_login FROM platform_identities GROUP BY normalized_login HAVING count(*) > 1
      UNION ALL
      SELECT planned.normalized_login
      FROM platform_identities planned
      JOIN "PlatformAccount" existing ON existing."loginNameNormalized" = planned.normalized_login AND existing."id" <> planned."id"
    ), platform_email_collisions AS (
      SELECT normalized_email FROM platform_identities
      WHERE normalized_email IS NOT NULL
      GROUP BY normalized_email HAVING count(*) > 1
      UNION ALL
      SELECT planned.normalized_email
      FROM platform_identities planned
      JOIN "PlatformAccount" existing ON existing."emailNormalized" = planned.normalized_email AND existing."id" <> planned."id"
      WHERE planned.normalized_email IS NOT NULL
    )
    SELECT
      (SELECT count(*)::int FROM email_collisions) AS "emailCollisionGroups",
      (SELECT count(*)::int FROM login_collisions) AS "plannedLoginCollisionGroups",
      (SELECT count(*)::int FROM invalid_roles) AS "invalidRoleAccounts",
      (SELECT count(*)::int FROM orphan_profiles) AS "orphanProfileLinks",
      (SELECT count(*)::int FROM orphan_memberships) AS "orphanSubjectMemberships",
      (SELECT count(*)::int FROM ambiguous_employees) AS "employeeAmbiguousMatches",
      (SELECT count(*)::int FROM platform_login_collisions) AS "platformLoginCollisionGroups",
      (SELECT count(*)::int FROM platform_email_collisions) AS "platformEmailCollisionGroups"`);
  return numberRow(result.rows[0]);
}

async function collectReadiness(queryable, owners) {
  const ownerTenantIds = owners.map((owner) => owner.tenantId);
  const ownerUserIds = owners.map((owner) => owner.userId);
  const result = await queryable.query(`
    WITH owners AS (
      SELECT * FROM unnest($1::text[], $2::text[]) AS owner("tenantId", "userId")
    ), planned_accounts AS (
      SELECT u."tenantId", u."id",
             CASE WHEN u."email" IS NULL OR btrim(u."email") = '' THEN NULL ELSE lower(btrim(u."email")) END AS email_normalized,
             coalesce(
               nullif(lower(btrim(u."loginNameNormalized")), ''),
               nullif(lower(btrim(u."loginName")), ''),
               nullif(lower(btrim(u."emailNormalized")), ''),
               nullif(lower(btrim(u."email")), ''),
               nullif(lower(btrim(student."studentNo")), ''),
               'account-' || lower(u."id")
             ) AS login_normalized,
             CASE WHEN u."passwordHash" LIKE 'scrypt:v2:%' THEN 2 ELSE 1 END AS hash_version,
             CASE WHEN u."accountStatus" IN ('LOCKED', 'DISABLED') THEN u."accountStatus"
                  WHEN u."passwordHash" = '' THEN 'DISABLED'
                  WHEN u."mustChangePassword" THEN 'PENDING_ACTIVATION'
                  ELSE 'ACTIVE' END AS account_status
      FROM "User" u
      LEFT JOIN "Student" student
        ON student."tenantId" = u."tenantId" AND student."userId" = u."id" AND student."deletedAt" IS NULL
      WHERE u."tenantId" IS NOT NULL AND u."tenantId" <> 'system'
    ), account_readiness AS (
      SELECT account.*, (
        actual."emailNormalized" IS NOT DISTINCT FROM account.email_normalized
        AND actual."loginNameNormalized" = account.login_normalized
        AND actual."loginName" IS NOT NULL
        AND actual."passwordHashVersion" = account.hash_version
        AND actual."accountStatus" = account.account_status
      ) AS ready
      FROM planned_accounts account
      JOIN "User" actual ON actual."tenantId" = account."tenantId" AND actual."id" = account."id"
    ), system_accounts AS (
      SELECT account.*,
             coalesce(nullif(lower(btrim(account."loginNameNormalized")), ''),
                      nullif(lower(btrim(account."loginName")), ''),
                      nullif(lower(btrim(account."email")), ''),
                      'platform-' || lower(account."id")) AS planned_login,
             CASE WHEN account."passwordHash" LIKE 'scrypt:v2:%' THEN 2 ELSE 1 END AS planned_hash_version,
             CASE WHEN account."accountStatus" IN ('LOCKED', 'DISABLED') THEN account."accountStatus"
                  WHEN account."passwordHash" = '' THEN 'DISABLED'
                  WHEN account."mustChangePassword" THEN 'PENDING_ACTIVATION'
                  ELSE 'ACTIVE' END AS planned_status
      FROM "User" account
      JOIN "TenantMembership" membership
        ON membership."tenantId" = account."tenantId" AND membership."userId" = account."id"
      WHERE membership."role"::text = 'SYSTEM_ADMIN' AND membership."status" = 'ACTIVE'
    ), role_sets AS (
      SELECT membership."tenantId", membership."userId",
             bool_or(membership."role"::text = 'TEACHER') AS has_teacher,
             bool_or(membership."role"::text = 'STUDENT') AS has_student,
             max(CASE membership."role"::text
               WHEN 'TENANT_OWNER' THEN 'TENANT_OWNER'
               WHEN 'TENANT_ADMIN' THEN CASE WHEN owner."userId" IS NOT NULL THEN 'TENANT_OWNER' ELSE 'TENANT_ADMIN' END
               WHEN 'ASSISTANT_ADMIN' THEN 'OPERATIONS_STAFF'
               WHEN 'OPERATIONS_STAFF' THEN 'OPERATIONS_STAFF'
               WHEN 'FINANCE_STAFF' THEN 'FINANCE_STAFF'
             END) AS staff_role
      FROM "TenantMembership" membership
      LEFT JOIN owners owner ON owner."tenantId" = membership."tenantId" AND owner."userId" = membership."userId"
      WHERE membership."status" = 'ACTIVE' AND membership."role"::text <> 'SYSTEM_ADMIN'
      GROUP BY membership."tenantId", membership."userId"
    ), ranked AS (
      SELECT membership."tenantId", membership."userId", membership."id",
             row_number() OVER (
               PARTITION BY membership."tenantId", membership."userId"
               ORDER BY CASE
                 WHEN membership."role"::text IN ('TENANT_OWNER','TENANT_ADMIN','ASSISTANT_ADMIN','OPERATIONS_STAFF','FINANCE_STAFF') THEN 1
                 WHEN membership."role"::text = 'STUDENT' THEN 2
                 WHEN membership."role"::text = 'TEACHER' THEN 3
                 ELSE 99 END,
                 membership."createdAt", membership."id"
             ) AS rank
      FROM "TenantMembership" membership
      WHERE membership."status" = 'ACTIVE' AND membership."role"::text <> 'SYSTEM_ADMIN'
    ), expected_memberships AS (
      SELECT roles."tenantId", roles."userId", ranked."id", roles.staff_role,
             roles.has_teacher, roles.has_student, account."membershipVersion"
      FROM role_sets roles
      JOIN ranked ON ranked."tenantId" = roles."tenantId" AND ranked."userId" = roles."userId" AND ranked.rank = 1
      JOIN "User" account ON account."tenantId" = roles."tenantId" AND account."id" = roles."userId"
      WHERE roles.staff_role IS NOT NULL OR roles.has_teacher OR roles.has_student
    ), legacy_session_roles AS (
      SELECT membership."tenantId", membership."userId",
             array_agg(DISTINCT membership."role"::text ORDER BY membership."role"::text) AS roles,
             account."membershipVersion"
      FROM "TenantMembership" membership
      JOIN "User" account ON account."tenantId" = membership."tenantId" AND account."id" = membership."userId"
      WHERE membership."status" = 'ACTIVE'
      GROUP BY membership."tenantId", membership."userId", account."membershipVersion"
    )
    SELECT
      (SELECT count(*)::int FROM account_readiness) AS "tenantAccountsTotal",
      (SELECT count(*)::int FROM account_readiness WHERE ready) AS "tenantAccountsReady",
      (SELECT count(*)::int FROM system_accounts) AS "platformSourceAccounts",
      (SELECT count(*)::int FROM system_accounts source JOIN "PlatformAccount" target ON target."id" = source."id"
        WHERE target."loginNameNormalized" = source.planned_login
          AND target."passwordHash" = source."passwordHash"
          AND target."passwordHashVersion" = source.planned_hash_version
          AND target."status" = source.planned_status) AS "platformReadyAccounts",
      (SELECT count(*)::int FROM "AuthSession" WHERE "tenantId" = 'system') AS "platformSourceSessions",
      (SELECT count(*)::int FROM "AuthSession" source JOIN "PlatformSession" target ON target."id" = source."id"
        WHERE source."tenantId" = 'system' AND target."platformAccountId" = source."userId"
          AND target."tokenFamilyId" = source."tokenFamilyId" AND target."refreshTokenHash" = source."refreshTokenHash") AS "platformReadySessions",
      (SELECT count(*)::int FROM expected_memberships) AS "canonicalMembershipAccounts",
      (SELECT count(*)::int FROM expected_memberships expected JOIN "TenantMembership" actual ON actual."id" = expected."id"
        WHERE actual."staffRole"::text IS NOT DISTINCT FROM expected.staff_role
          AND actual."hasTeacherPersona" = expected.has_teacher
          AND actual."hasStudentPersona" = expected.has_student
          AND actual."version" = expected."membershipVersion") AS "canonicalMembershipReady",
      (SELECT count(*)::int FROM "Teacher" WHERE "deletedAt" IS NULL) AS teachers,
      (SELECT count(*)::int FROM "Teacher" teacher JOIN "Employee" employee
        ON employee."tenantId" = teacher."tenantId" AND employee."id" = teacher."employeeId"
        WHERE teacher."deletedAt" IS NULL AND employee."deletedAt" IS NULL) AS "teachersLinked",
      (SELECT count(*)::int FROM "AuthSession" WHERE "status" = 'ACTIVE') AS "activeSessions",
      (SELECT count(*)::int FROM "AuthSession" session JOIN legacy_session_roles expected
        ON expected."tenantId" = session."tenantId" AND expected."userId" = session."userId"
        WHERE session."status" = 'ACTIVE' AND session."membershipVersion" = expected."membershipVersion") AS "sessionVersionMatches",
      (SELECT count(*)::int
       FROM "AuthSession" session
       LEFT JOIN legacy_session_roles legacy
         ON legacy."tenantId" = session."tenantId" AND legacy."userId" = session."userId"
       LEFT JOIN expected_memberships canonical
         ON canonical."tenantId" = session."tenantId" AND canonical."userId" = session."userId"
        AND canonical."id" = session."membershipId"
       WHERE session."status" = 'ACTIVE'
         AND (
           (session."membershipId" IS NULL AND session."activePersona" IS NULL
             AND ARRAY(SELECT DISTINCT role FROM unnest(session.roles) role ORDER BY role) = legacy.roles)
           OR
           (session."membershipId" = canonical."id" AND (
             (session."activePersona" = 'STAFF' AND canonical.staff_role IS NOT NULL
               AND ARRAY(SELECT DISTINCT role FROM unnest(session.roles) role ORDER BY role) = ARRAY[canonical.staff_role])
             OR (session."activePersona" = 'TEACHER' AND canonical.has_teacher
               AND ARRAY(SELECT DISTINCT role FROM unnest(session.roles) role ORDER BY role) = ARRAY['TEACHER']::text[])
             OR (session."activePersona" = 'STUDENT' AND canonical.has_student
               AND ARRAY(SELECT DISTINCT role FROM unnest(session.roles) role ORDER BY role) = ARRAY['STUDENT']::text[])
           ))
         )) AS "sessionLegacyRoleMatches"`,
    [ownerTenantIds, ownerUserIds],
  );
  const row = numberRow(result.rows[0]);
  return {
    tenantAccounts: { total: row.tenantAccountsTotal, ready: row.tenantAccountsReady },
    platformAccounts: {
      sourceAccounts: row.platformSourceAccounts,
      readyAccounts: row.platformReadyAccounts,
      sourceSessions: row.platformSourceSessions,
      readySessions: row.platformReadySessions,
    },
    memberships: { canonicalAccounts: row.canonicalMembershipAccounts, readyAccounts: row.canonicalMembershipReady },
    employees: { teachers: row.teachers, linkedTeachers: row.teachersLinked },
    sessions: {
      activeSessions: row.activeSessions,
      membershipVersionMatches: row.sessionVersionMatches,
      legacyRoleMatches: row.sessionLegacyRoleMatches,
    },
  };
}

async function applyBackfill(queryable, owners) {
  const ownerTenantIds = owners.map((owner) => owner.tenantId);
  const ownerUserIds = owners.map((owner) => owner.userId);
  await queryable.query(`
    WITH planned AS (
      SELECT u."tenantId", u."id",
             CASE WHEN u."email" IS NULL OR btrim(u."email") = '' THEN NULL ELSE lower(btrim(u."email")) END AS email_normalized,
             coalesce(nullif(lower(btrim(u."loginNameNormalized")), ''), nullif(lower(btrim(u."loginName")), ''),
                      nullif(lower(btrim(u."emailNormalized")), ''),
                      nullif(lower(btrim(u."email")), ''), nullif(lower(btrim(student."studentNo")), ''),
                      'account-' || lower(u."id")) AS login_normalized,
             CASE WHEN u."passwordHash" LIKE 'scrypt:v2:%' THEN 2 ELSE 1 END AS hash_version,
             CASE WHEN u."accountStatus" IN ('LOCKED', 'DISABLED') THEN u."accountStatus"
                  WHEN u."passwordHash" = '' THEN 'DISABLED'
                  WHEN u."mustChangePassword" THEN 'PENDING_ACTIVATION' ELSE 'ACTIVE' END AS account_status
      FROM "User" u
      LEFT JOIN "Student" student
        ON student."tenantId" = u."tenantId" AND student."userId" = u."id" AND student."deletedAt" IS NULL
      WHERE u."tenantId" IS NOT NULL
    )
    UPDATE "User" account
    SET "emailNormalized" = planned.email_normalized,
        "loginName" = coalesce(nullif(btrim(account."loginName"), ''), planned.login_normalized),
        "loginNameNormalized" = planned.login_normalized,
        "passwordHashVersion" = planned.hash_version,
        "accountStatus" = planned.account_status,
        "updatedAt" = now()
    FROM planned
    WHERE account."tenantId" = planned."tenantId" AND account."id" = planned."id"`);

  await queryable.query(`
    UPDATE "Teacher" teacher
    SET "employeeId" = employee."id", "updatedAt" = now()
    FROM "Employee" employee
    WHERE teacher."employeeId" IS NULL AND teacher."deletedAt" IS NULL
      AND employee."tenantId" = teacher."tenantId" AND employee."deletedAt" IS NULL
      AND ((teacher."userId" IS NOT NULL AND employee."userId" = teacher."userId")
        OR (teacher."nationalIdHash" IS NOT NULL AND employee."nationalIdHash" = teacher."nationalIdHash"))`);
  await queryable.query(`
    INSERT INTO "Employee" (
      "id", "tenantId", "firstName", "lastName", "nationalIdEncrypted", "nationalIdHash",
      "workEmail", "phone", "userId", "status", "updatedAt"
    )
    SELECT 'employee-' || md5(teacher."tenantId" || ':' || teacher."id"), teacher."tenantId",
           teacher."firstName", teacher."lastName", teacher."nationalIdEncrypted", teacher."nationalIdHash",
           account."email", teacher."phone", teacher."userId", 'ACTIVE', now()
    FROM "Teacher" teacher
    LEFT JOIN "User" account ON account."tenantId" = teacher."tenantId" AND account."id" = teacher."userId"
    WHERE teacher."deletedAt" IS NULL AND teacher."employeeId" IS NULL
    ON CONFLICT DO NOTHING`);
  await queryable.query(`
    UPDATE "Teacher" teacher
    SET "employeeId" = employee."id", "updatedAt" = now()
    FROM "Employee" employee
    WHERE teacher."employeeId" IS NULL AND teacher."deletedAt" IS NULL
      AND employee."tenantId" = teacher."tenantId" AND employee."deletedAt" IS NULL
      AND (employee."id" = 'employee-' || md5(teacher."tenantId" || ':' || teacher."id")
        OR (teacher."userId" IS NOT NULL AND employee."userId" = teacher."userId")
        OR (teacher."nationalIdHash" IS NOT NULL AND employee."nationalIdHash" = teacher."nationalIdHash"))`);

  await queryable.query(`
    UPDATE "TenantMembership"
    SET "staffRole" = NULL, "hasTeacherPersona" = false, "hasStudentPersona" = false, "updatedAt" = now()
    WHERE "role"::text <> 'SYSTEM_ADMIN'
      AND ("staffRole" IS NOT NULL OR "hasTeacherPersona" OR "hasStudentPersona")`);
  await queryable.query(`
    WITH owners AS (
      SELECT * FROM unnest($1::text[], $2::text[]) AS owner("tenantId", "userId")
    ), role_sets AS (
      SELECT membership."tenantId", membership."userId",
             bool_or(membership."role"::text = 'TEACHER') AS has_teacher,
             bool_or(membership."role"::text = 'STUDENT') AS has_student,
             max(CASE membership."role"::text
               WHEN 'TENANT_OWNER' THEN 'TENANT_OWNER'
               WHEN 'TENANT_ADMIN' THEN CASE WHEN owner."userId" IS NOT NULL THEN 'TENANT_OWNER' ELSE 'TENANT_ADMIN' END
               WHEN 'ASSISTANT_ADMIN' THEN 'OPERATIONS_STAFF'
               WHEN 'OPERATIONS_STAFF' THEN 'OPERATIONS_STAFF'
               WHEN 'FINANCE_STAFF' THEN 'FINANCE_STAFF'
             END) AS staff_role
      FROM "TenantMembership" membership
      LEFT JOIN owners owner ON owner."tenantId" = membership."tenantId" AND owner."userId" = membership."userId"
      WHERE membership."status" = 'ACTIVE' AND membership."role"::text <> 'SYSTEM_ADMIN'
      GROUP BY membership."tenantId", membership."userId"
    ), ranked AS (
      SELECT membership."tenantId", membership."userId", membership."id",
             row_number() OVER (PARTITION BY membership."tenantId", membership."userId" ORDER BY
               CASE WHEN membership."role"::text IN ('TENANT_OWNER','TENANT_ADMIN','ASSISTANT_ADMIN','OPERATIONS_STAFF','FINANCE_STAFF') THEN 1
                    WHEN membership."role"::text = 'STUDENT' THEN 2
                    WHEN membership."role"::text = 'TEACHER' THEN 3 ELSE 99 END,
               membership."createdAt", membership."id") AS rank
      FROM "TenantMembership" membership
      WHERE membership."status" = 'ACTIVE' AND membership."role"::text <> 'SYSTEM_ADMIN'
    ), targets AS (
      SELECT roles.*, ranked."id"
      FROM role_sets roles JOIN ranked ON ranked."tenantId" = roles."tenantId" AND ranked."userId" = roles."userId" AND ranked.rank = 1
      WHERE roles.staff_role IS NOT NULL OR roles.has_teacher OR roles.has_student
    )
    UPDATE "TenantMembership" membership
    SET "staffRole" = targets.staff_role::"StaffRole",
        "hasTeacherPersona" = targets.has_teacher,
        "hasStudentPersona" = targets.has_student,
        "status" = 'ACTIVE', "version" = account."membershipVersion", "scopeMode" = 'TENANT',
        "endsAt" = NULL, "endedReason" = NULL, "updatedAt" = now()
    FROM targets
    JOIN "User" account ON account."tenantId" = targets."tenantId" AND account."id" = targets."userId"
    WHERE membership."id" = targets."id"`,
    [ownerTenantIds, ownerUserIds],
  );

  await queryable.query(`
    INSERT INTO "PlatformAccount" (
      "id", "loginName", "loginNameNormalized", "email", "emailNormalized", "name", "passwordHash",
      "passwordHashVersion", "status", "totpSecretEncrypted", "totpEnabledAt", "updatedAt"
    )
    SELECT account."id",
           coalesce(nullif(account."loginName", ''), 'platform-' || lower(account."id")),
           coalesce(nullif(account."loginNameNormalized", ''), nullif(lower(btrim(account."loginName")), ''),
                    nullif(lower(btrim(account."email")), ''), 'platform-' || lower(account."id")),
           account."email", account."emailNormalized", account."name", account."passwordHash",
           account."passwordHashVersion", account."accountStatus", account."totpSecretEncrypted", account."totpEnabledAt", now()
    FROM "User" account
    JOIN "TenantMembership" membership ON membership."tenantId" = account."tenantId" AND membership."userId" = account."id"
    WHERE membership."role"::text = 'SYSTEM_ADMIN' AND membership."status" = 'ACTIVE'
    ON CONFLICT ("id") DO UPDATE
    SET "loginName" = EXCLUDED."loginName", "loginNameNormalized" = EXCLUDED."loginNameNormalized",
        "email" = EXCLUDED."email", "emailNormalized" = EXCLUDED."emailNormalized", "name" = EXCLUDED."name",
        "passwordHash" = EXCLUDED."passwordHash", "passwordHashVersion" = EXCLUDED."passwordHashVersion",
        "status" = EXCLUDED."status", "totpSecretEncrypted" = EXCLUDED."totpSecretEncrypted",
        "totpEnabledAt" = EXCLUDED."totpEnabledAt", "updatedAt" = now()`);
  await queryable.query(`
    INSERT INTO "PlatformSession" (
      "id", "platformAccountId", "tokenFamilyId", "refreshTokenHash", "status", "expiresAt", "updatedAt"
    )
    SELECT session."id", session."userId", session."tokenFamilyId", session."refreshTokenHash",
           CASE WHEN session."status" IN ('ACTIVE','REVOKED','COMPROMISED') THEN session."status" ELSE 'REVOKED' END,
           session."expiresAt", now()
    FROM "AuthSession" session
    JOIN "PlatformAccount" account ON account."id" = session."userId"
    WHERE session."tenantId" = 'system'
    ON CONFLICT ("id") DO UPDATE
    SET "platformAccountId" = EXCLUDED."platformAccountId", "tokenFamilyId" = EXCLUDED."tokenFamilyId",
        "refreshTokenHash" = EXCLUDED."refreshTokenHash", "status" = EXCLUDED."status",
        "expiresAt" = EXCLUDED."expiresAt", "updatedAt" = now()`);
}

function deriveBlockers(foundation, preconditions, owners, readiness) {
  const blockers = [...owners.blockers];
  if (foundation.presentTables !== foundation.expectedTables) blockers.push("FOUNDATION_TABLES_MISSING");
  for (const [key, value] of Object.entries(preconditions)) {
    if (value > 0) blockers.push(camelToBlocker(key));
  }
  if (readiness.sessions.membershipVersionMatches !== readiness.sessions.activeSessions) blockers.push("ACTIVE_SESSION_VERSION_DRIFT");
  if (readiness.sessions.legacyRoleMatches !== readiness.sessions.activeSessions) blockers.push("ACTIVE_SESSION_LEGACY_ROLE_DRIFT");
  return blockers;
}

function derivePostconditionBlockers(readiness) {
  const blockers = [];
  if (readiness.tenantAccounts.ready !== readiness.tenantAccounts.total) blockers.push("TENANT_ACCOUNT_BACKFILL_INCOMPLETE");
  if (readiness.platformAccounts.readyAccounts !== readiness.platformAccounts.sourceAccounts) blockers.push("PLATFORM_ACCOUNT_BACKFILL_INCOMPLETE");
  if (readiness.platformAccounts.readySessions !== readiness.platformAccounts.sourceSessions) blockers.push("PLATFORM_SESSION_BACKFILL_INCOMPLETE");
  if (readiness.memberships.readyAccounts !== readiness.memberships.canonicalAccounts) blockers.push("MEMBERSHIP_BACKFILL_INCOMPLETE");
  if (readiness.employees.linkedTeachers !== readiness.employees.teachers) blockers.push("TEACHER_EMPLOYEE_BACKFILL_INCOMPLETE");
  return blockers;
}

function readOwnerDecisions(target) {
  if (!target) return [];
  let url;
  try {
    url = new URL(target);
  } catch {
    fail(["ACCOUNT_MANAGEMENT_OWNER_DECISIONS_TARGET file:// URL olmalı."]);
  }
  if (url.protocol !== "file:") fail(["ACCOUNT_MANAGEMENT_OWNER_DECISIONS_TARGET yalnız file:// destekler."]);
  const path = fileURLToPath(url);
  validateInputTarget(path, "ACCOUNT_MANAGEMENT_OWNER_DECISIONS_TARGET");
  let payload;
  try {
    payload = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail(["ACCOUNT_MANAGEMENT_OWNER_DECISIONS_TARGET geçerli JSON olmalı."]);
  }
  const keys = Object.keys(payload ?? {}).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["decisions", "schemaVersion"])) {
    fail(["Owner decisions top-level alanları exact olmalı: schemaVersion, decisions."]);
  }
  if (payload.schemaVersion !== 1 || !Array.isArray(payload.decisions)) fail(["Owner decisions schemaVersion 1 ve decisions listesi zorunlu."]);
  const seenTenants = new Set();
  const decisions = payload.decisions.map((decision) => {
    if (!decision || typeof decision !== "object" || Array.isArray(decision)) fail(["Owner decision nesnesi zorunlu."]);
    const decisionKeys = Object.keys(decision).sort();
    if (JSON.stringify(decisionKeys) !== JSON.stringify(["tenantId", "userId", "verificationReference"].sort())) {
      fail(["Owner decision alanları exact olmalı: tenantId, userId, verificationReference."]);
    }
    for (const key of ["tenantId", "userId", "verificationReference"]) requireValue(decision[key], `ownerDecision.${key}`, inputFailures);
    if (hasPlaceholder(decision.verificationReference)) inputFailures.push("ownerDecision.verificationReference gerçek değer olmalı.");
    if (seenTenants.has(decision.tenantId)) inputFailures.push("Her tenant için en fazla bir owner decision olmalı.");
    seenTenants.add(decision.tenantId);
    return decision;
  });
  if (inputFailures.length > 0) fail(inputFailures);
  return decisions;
}

function validateInputTarget(filePath, label) {
  if (isLocalTempPath(filePath)) fail([`${label} lokal temp path olmamalı.`]);
  if (!existsSync(filePath)) fail([`${label} mevcut bir file olmalı.`]);
  assertParentPathAllowed(dirname(filePath), label);
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail([`${label} symlink olmayan file olmalı.`]);
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) fail(["ACCOUNT_MANAGEMENT_BACKFILL_OUTPUT lokal temp path olmamalı."]);
  assertParentPathAllowed(dirname(filePath), "ACCOUNT_MANAGEMENT_BACKFILL_OUTPUT", true);
  if (!existsSync(filePath)) return;
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(["ACCOUNT_MANAGEMENT_BACKFILL_OUTPUT symlink olmayan file artifact olmalı."]);
}

function assertParentPathAllowed(parentPath, label, allowMissing = false) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (allowMissing && !existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail([`${label} parent dizini symlink olmayan dizin olmalı.`]);
  }
}

function numberRow(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, number(value)]));
}

function number(value) {
  const parsed = Number(value ?? 0);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("ACCOUNT_MANAGEMENT_BACKFILL_COUNT_INVALID");
  return parsed;
}

function camelToBlocker(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") output.push(`${label} boş bırakılamaz.`);
}

function requireOneOf(value, label, allowed, output) {
  if (!allowed.includes(value)) output.push(`${label} ${allowed.join(" veya ")} olmalı.`);
}

function hasPlaceholder(value) {
  const normalized = String(value).toLowerCase();
  return ["example", "placeholder", "redacted", "__set", "todo", "tbd", ".test", "localhost"].some((token) => normalized.includes(token));
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return ["/tmp", "/var/tmp", "/private/tmp"].some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

function fail(messages) {
  console.error("Account management backfill başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
