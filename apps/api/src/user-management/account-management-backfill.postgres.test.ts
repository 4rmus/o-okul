import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

// UAT F-16: scripts/backfill-account-management.mjs runs with APPLY on every staging deploy. It must keep campus scope,
// keep SUSPENDED/ENDED persona flags, repair what earlier runs cleared, and write nothing on a second run.
const adminDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_ADMIN_URL;
// The migration role applies the migrations, as in the CI "Apply database migrations" step.
const migrationDatabaseUrl = process.env.DIRECT_DATABASE_URL;
const postgresRequired = process.env.ACCOUNT_MANAGEMENT_POSTGRES_REQUIRED === "1";
if (postgresRequired && (!adminDatabaseUrl || !migrationDatabaseUrl)) throw new Error("EMPLOYEE_ACTIVATION_POSTGRES_URLS_REQUIRED");

const describePostgres = adminDatabaseUrl && migrationDatabaseUrl ? describe : describe.skip;
// vitest runs with the apps/api package as cwd (pnpm --filter @o-okul/api exec vitest).
const repoRoot = resolve(process.cwd(), "../..");
const outputRoot = resolve(repoRoot, "artifacts/local/account-management-backfill-postgres");
const tenantId = "f16-backfill-tenant";
// The backfill reads every ACTIVE tenant, so it runs against its own freshly migrated database; tenants other tests
// leave in the shared database would otherwise block it (e.g. OWNER_SOURCE_MISSING).
const databaseName = "o_okul_account_backfill_test";
const databaseUrl = adminDatabaseUrl ? withDatabase(adminDatabaseUrl, databaseName) : "";

describePostgres("account-management backfill on PostgreSQL (UAT F-16)", () => {
  const server = new pg.Pool({ connectionString: adminDatabaseUrl, max: 1 });
  let admin: pg.Pool;

  beforeAll(async () => {
    await server.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await server.query(`CREATE DATABASE ${databaseName}`);
    await server.query(`GRANT CONNECT ON DATABASE ${databaseName} TO app, migration`);
    admin = new pg.Pool({ connectionString: databaseUrl });
    // An idle client the server closes after end() must not become an uncaught exception; queries report their own errors.
    admin.on("error", () => {});
    // Same bootstrap as docker/postgres/init (001 roles, 004 extensions, 006 device restore schema).
    await admin.query("ALTER SCHEMA public OWNER TO migration");
    await admin.query("CREATE EXTENSION IF NOT EXISTS pg_trgm");
    await admin.query("CREATE EXTENSION IF NOT EXISTS btree_gist");
    await admin.query("CREATE SCHEMA IF NOT EXISTS device_existing_restore AUTHORIZATION migration");
    const migrationUrl = withDatabase(migrationDatabaseUrl!, databaseName);
    const migrated = spawnSync("pnpm", ["--filter", "@o-okul/db", "exec", "prisma", "migrate", "deploy", "--config", "prisma.config.ts"], {
      cwd: repoRoot,
      env: { ...process.env, DIRECT_DATABASE_URL: migrationUrl, DATABASE_URL: migrationUrl },
      encoding: "utf8",
    });
    expect(migrated.status, migrated.stderr.slice(-2000)).toBe(0);
    await seed(admin);
  }, 180_000);

  afterAll(async () => {
    // pg-pool's end() resolves before its client sockets close. A FORCE drop at that moment terminates
    // the still-open backends, the dropped clients emit a pool "error" and vitest fails the run with
    // "terminating connection due to administrator command" (main CI 2026-10-13, twice). Wait until the
    // server no longer sees those sessions before dropping the database.
    await admin?.end();
    await waitForSessionsToClose(server, databaseName);
    await server.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
    await server.end();
    rmSync(outputRoot, { recursive: true, force: true });
  });

  it("DRY_RUN reports READY and writes nothing", async () => {
    const before = await snapshot(admin);
    const report = runBackfill("DRY_RUN");
    expect(report).toMatchObject({ result: "READY", databaseMutationApplied: false, blockers: [] });
    expect(await snapshot(admin)).toEqual(before);
  });

  it("APPLY keeps campus scope and suspended flags and repairs what earlier runs widened or cleared", async () => {
    expect(runBackfill("APPLY")).toMatchObject({ result: "PASS", databaseMutationApplied: true, blockers: [] });
    const rows = await memberships(admin);

    expect(rows["f16-m-campus"]).toMatchObject({ scopeMode: "CAMPUSES", staffRole: "OPERATIONS_STAFF", status: "ACTIVE", scopes: 1 });
    expect(rows["f16-m-suspended"]).toMatchObject({ status: "SUSPENDED", staffRole: "TENANT_ADMIN", hasTeacherPersona: true, scopeMode: "CAMPUSES", scopes: 1 });
    expect(rows["f16-m-suspended-teacher"]).toMatchObject({ status: "SUSPENDED", staffRole: null, hasTeacherPersona: false });
    // Cleared by an earlier APPLY: restored from the legacy role column.
    expect(rows["f16-m-cleared"]).toMatchObject({ status: "SUSPENDED", staffRole: "FINANCE_STAFF", hasTeacherPersona: true });
    expect(rows["f16-m-cleared-teacher"]).toMatchObject({ status: "SUSPENDED", staffRole: null, hasTeacherPersona: false });
    // Widened by an earlier APPLY: restored only with matching tenant_membership.updated audit evidence.
    expect(rows["f16-m-widened"]).toMatchObject({ scopeMode: "CAMPUSES", scopes: 1 });
    expect(rows["f16-m-widened-no-audit"]).toMatchObject({ scopeMode: "TENANT", scopes: 1 });
    expect(rows["f16-m-owner"]).toMatchObject({ staffRole: "TENANT_OWNER", scopeMode: "TENANT", version: 3 });
  });

  it("a second APPLY is a no-op", async () => {
    const before = await snapshot(admin);
    expect(runBackfill("APPLY")).toMatchObject({ result: "PASS", blockers: [] });
    expect(await snapshot(admin)).toEqual(before);
  });
});

function runBackfill(mode: "DRY_RUN" | "APPLY"): Record<string, unknown> {
  const output = resolve(outputRoot, `${mode.toLowerCase()}-${Date.now()}.json`);
  const result = spawnSync(process.execPath, ["scripts/backfill-account-management.mjs"], {
    cwd: repoRoot,
    env: {
      PATH: process.env.PATH,
      STAGING_ENVIRONMENT: "staging",
      DIRECT_DATABASE_URL: databaseUrl,
      ACCOUNT_MANAGEMENT_BACKFILL_MODE: mode,
      ACCOUNT_MANAGEMENT_BACKFILL_OUTPUT: output,
      ACCOUNT_MANAGEMENT_BACKFILL_CONFIRM: mode === "APPLY" ? "apply-pr4-backfill" : "",
    },
    encoding: "utf8",
  });
  const report = JSON.parse(readFileSync(output, "utf8")) as Record<string, unknown>;
  expect(result.status, `${result.stdout}\n${result.stderr}\n${JSON.stringify(report.blockers)}`).toBe(0);
  return report;
}

interface MembershipState {
  status: string;
  staffRole: string | null;
  hasTeacherPersona: boolean;
  scopeMode: string;
  version: number;
  scopes: number;
}

async function memberships(pool: pg.Pool): Promise<Record<string, MembershipState>> {
  const result = await pool.query<MembershipState & { id: string }>(
    `SELECT m."id", m."status", m."staffRole"::text AS "staffRole", m."hasTeacherPersona", m."scopeMode", m."version",
            (SELECT count(*)::int FROM "MembershipCampusScope" s WHERE s."membershipId" = m."id") AS scopes
     FROM "TenantMembership" m WHERE m."tenantId" = $1`,
    [tenantId],
  );
  return Object.fromEntries(result.rows.map(({ id, ...row }) => [id, row]));
}

async function snapshot(pool: pg.Pool): Promise<unknown> {
  const [members, scopes, users] = await Promise.all([
    pool.query(`SELECT * FROM "TenantMembership" WHERE "tenantId" = $1 ORDER BY "id"`, [tenantId]),
    pool.query(`SELECT * FROM "MembershipCampusScope" WHERE "tenantId" = $1 ORDER BY "id"`, [tenantId]),
    pool.query(`SELECT * FROM "User" WHERE "tenantId" = $1 ORDER BY "id"`, [tenantId]),
  ]);
  return { members: members.rows, scopes: scopes.rows, users: users.rows };
}

async function waitForSessionsToClose(server: pg.Pool, database: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await server.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [database],
    );
    if (rows[0]?.count === 0) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
}

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

async function seed(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO "Tenant" ("id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status", "updatedAt")
     VALUES ($1, $1, 'f16-backfill', 'TEST', now() - interval '1 day', now() + interval '1 day', 10, 'ACTIVE', now())`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO "Campus" ("id", "tenantId", "name", "updatedAt") VALUES ('f16-campus', $1, 'Kampus A', now())`,
    [tenantId],
  );
  const users = ["owner", "campus", "suspended", "cleared", "widened", "widened-no-audit"];
  for (const user of users) {
    await pool.query(
      `INSERT INTO "User" ("id", "tenantId", "name", "email", "passwordHash", "membershipVersion", "updatedAt")
       VALUES ($1, $2, $3, $4, 'scrypt:v2:fixture', 3, now())`,
      [`f16-u-${user}`, tenantId, `F16 ${user}`, `f16.${user}@example.test`],
    );
  }
  // [membership id, user, legacy role, staffRole, hasTeacherPersona, status, scopeMode, version]
  const rows: Array<[string, string, string, string | null, boolean, string, string, number]> = [
    ["f16-m-owner", "owner", "TENANT_OWNER", "TENANT_OWNER", false, "ACTIVE", "TENANT", 3],
    ["f16-m-campus", "campus", "OPERATIONS_STAFF", "OPERATIONS_STAFF", false, "ACTIVE", "CAMPUSES", 3],
    ["f16-m-suspended", "suspended", "TENANT_ADMIN", "TENANT_ADMIN", true, "SUSPENDED", "CAMPUSES", 2],
    ["f16-m-suspended-teacher", "suspended", "TEACHER", null, false, "SUSPENDED", "CAMPUSES", 2],
    ["f16-m-cleared", "cleared", "FINANCE_STAFF", null, false, "SUSPENDED", "TENANT", 2],
    ["f16-m-cleared-teacher", "cleared", "TEACHER", null, false, "SUSPENDED", "TENANT", 2],
    ["f16-m-widened", "widened", "OPERATIONS_STAFF", "OPERATIONS_STAFF", false, "ACTIVE", "TENANT", 3],
    ["f16-m-widened-no-audit", "widened-no-audit", "OPERATIONS_STAFF", "OPERATIONS_STAFF", false, "ACTIVE", "TENANT", 3],
  ];
  for (const [id, user, role, staffRole, hasTeacherPersona, status, scopeMode, version] of rows) {
    await pool.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "status", "scopeMode", "version", "updatedAt")
       VALUES ($1, $2, $3, $4::"TenantRole", $5::"StaffRole", $6, $7, $8, $9, now() - interval '1 hour')`,
      [id, tenantId, `f16-u-${user}`, role, staffRole, hasTeacherPersona, status, scopeMode, version],
    );
  }
  for (const membershipId of ["f16-m-campus", "f16-m-suspended", "f16-m-widened", "f16-m-widened-no-audit"]) {
    await pool.query(
      `INSERT INTO "MembershipCampusScope" ("id", "tenantId", "membershipId", "campusId") VALUES ($1, $2, $3, 'f16-campus')`,
      [`f16-scope-${membershipId}`, tenantId, membershipId],
    );
  }
  // GUARDIAN persona sessions (UAT F-25, staging deploy 2026-10-27): a staff account that is also a parent (KV-3b) on its
  // canonical membership, and a guardian-only account on its own GUARDIAN membership row. Both must count as matching.
  await pool.query(
    `INSERT INTO "User" ("id", "tenantId", "name", "email", "passwordHash", "membershipVersion", "updatedAt")
     VALUES ('f16-u-guardian', $1, 'F16 guardian', 'f16.guardian@example.test', 'scrypt:v2:fixture', 1, now())`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "status", "version", "updatedAt") VALUES
       ('f16-m-campus-guardian', $1, 'f16-u-campus', 'GUARDIAN', 'ACTIVE', 3, now() - interval '1 hour'),
       ('f16-m-guardian', $1, 'f16-u-guardian', 'GUARDIAN', 'ACTIVE', 1, now() - interval '1 hour')`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO "Guardian" ("id", "tenantId", "userId", "firstName", "lastName", "updatedAt") VALUES
       ('f16-guardian-a', $1, 'f16-u-campus', 'F16', 'VELİ A', now()),
       ('f16-guardian-b', $1, 'f16-u-guardian', 'F16', 'VELİ B', now())`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO "AuthSession" ("id", "userId", "tenantId", "membershipId", "activePersona", "roles", "subjectType", "subjectId",
       "tokenFamilyId", "refreshTokenHash", "status", "membershipVersion", "expiresAt", "updatedAt") VALUES
       ('f16-s-campus-guardian', 'f16-u-campus', $1, 'f16-m-campus', 'GUARDIAN', ARRAY['GUARDIAN'], 'GUARDIAN', 'f16-guardian-a',
        'f16-family-1', 'f16-hash-1', 'ACTIVE', 3, now() + interval '1 day', now()),
       ('f16-s-guardian', 'f16-u-guardian', $1, 'f16-m-guardian', 'GUARDIAN', ARRAY['GUARDIAN'], 'GUARDIAN', 'f16-guardian-b',
        'f16-family-2', 'f16-hash-2', 'ACTIVE', 1, now() + interval '1 day', now())`,
    [tenantId],
  );
  // Same shape as UserManagementService.updateMembership writes (scopeMode itself is redacted; campusCount is kept).
  await pool.query(
    `INSERT INTO "AuditLog" ("id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff", "createdAt")
     VALUES ('f16-audit-1', $1, 'f16-u-owner', 'TenantMembership', 'f16-m-widened', 'tenant_membership.updated',
             '{"scopeMode":"[REDACTED]","campusCount":1,"status":"ACTIVE"}'::jsonb, now() - interval '1 hour')`,
    [tenantId],
  );
}
