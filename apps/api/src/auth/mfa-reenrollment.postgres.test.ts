import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PostgresAuthUserStore } from "./auth-user-store.js";
import { hashReenrollmentCode } from "./mfa-reenrollment-code.js";
import { PostgresMfaSecurityNoticeStore } from "./mfa-security-notice.js";

// DEC-20261021-01 on real PostgreSQL under the `app` role: the SYSTEM_ADMIN reset writes the re-enrollment hash and
// expiry in the same statement that clears TOTP, enrollment consumes it "first wins", the schema keeps the pair
// consistent, notices stay system-scoped, and the runbook's DB recovery SQL for a system admin still applies.
const appDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_TEST_URL;
const adminDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_ADMIN_URL;
if (process.env.ACCOUNT_MANAGEMENT_POSTGRES_REQUIRED === "1" && (!appDatabaseUrl || !adminDatabaseUrl)) {
  throw new Error("EMPLOYEE_ACTIVATION_POSTGRES_URLS_REQUIRED");
}
const describePostgres = appDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;

const tenantId = "mfa-reenroll-tenant";
const ownerId = "mfa-reenroll-owner";
const systemAdminId = "mfa-reenroll-system-admin";

describePostgres("MFA re-enrollment code on PostgreSQL", () => {
  const admin = new pg.Pool({ connectionString: adminDatabaseUrl });
  const app = new pg.Pool({ connectionString: appDatabaseUrl, max: 4 });
  const users = new PostgresAuthUserStore(app);
  const startedAt = new Date();
  let createdSystemTenant = false;

  beforeAll(async () => {
    await cleanup();
    await admin.query(`INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt") VALUES ($1, $1, $1, 'ACTIVE', now())`, [tenantId]);
    await admin.query(
      `INSERT INTO "User" ("id", "tenantId", "name", "email", "emailNormalized", "passwordHash", "updatedAt")
       VALUES ($1, $2, 'Owner Reenroll', 'owner@mfa-reenroll.example.test', 'owner@mfa-reenroll.example.test', 'FIXTURE_HASH', now())`,
      [ownerId, tenantId],
    );
    await admin.query(`INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt") VALUES ($1, $2, $3, 'TENANT_OWNER', now())`, [`${ownerId}-owner`, tenantId, ownerId]);
    const system = await admin.query(`INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt") VALUES ('system', 'system', 'system', 'ACTIVE', now()) ON CONFLICT DO NOTHING RETURNING "id"`);
    createdSystemTenant = system.rows.length === 1;
    await admin.query(
      `INSERT INTO "User" ("id", "tenantId", "name", "passwordHash", "totpSecretEncrypted", "totpEnabledAt", "updatedAt")
       VALUES ($1, 'system', 'System Reenroll', 'FIXTURE_HASH', 'enc', now(), now())`,
      [systemAdminId],
    );
    await admin.query(`INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt") VALUES ($1, 'system', $2, 'SYSTEM_ADMIN', now())`, [`${systemAdminId}-sa`, systemAdminId]);
  });

  afterAll(async () => {
    await cleanup();
    await Promise.all([admin.end(), app.end()]);
  });

  async function cleanup() {
    await admin.query(`DELETE FROM "SecretDeliveryOutbox" WHERE "purpose" = 'MFA_SECURITY_NOTICE' AND "createdAt" >= $1`, [startedAt]);
    await admin.query(`DELETE FROM "TenantMembership" WHERE "userId" = ANY($1::text[])`, [[ownerId, systemAdminId]]);
    await admin.query(`DELETE FROM "User" WHERE "id" = ANY($1::text[])`, [[ownerId, systemAdminId]]);
    await admin.query(`DELETE FROM "Tenant" WHERE "id" = $1`, [tenantId]);
    if (createdSystemTenant) await admin.query(`DELETE FROM "Tenant" WHERE "id" = 'system'`);
  }

  async function row() {
    return (await admin.query<{ membershipVersion: number; totpEnabledAt: Date | null; totpReenrollmentCodeHash: string | null; totpReenrollmentExpiresAt: Date | null; membershipVersionRow: number }>(
      `SELECT u."membershipVersion", u."totpEnabledAt", u."totpReenrollmentCodeHash", u."totpReenrollmentExpiresAt", m."version" AS "membershipVersionRow"
       FROM "User" u JOIN "TenantMembership" m ON m."userId" = u."id" WHERE u."id" = $1`, [ownerId])).rows[0]!;
  }

  function enable(version: number, reenrollmentCodeHash: string | null) {
    return users.enableTotp({
      userId: ownerId, source: { tenantId, membershipVersion: version }, secretEncrypted: `enc-${Math.random()}`,
      enabledAt: new Date().toISOString(), recoveryCodeHashes: ["r1"], reenrollmentCodeHash,
    });
  }

  it("writes the grant with the reset, requires the exact unexpired hash, consumes it once and clears it atomically", async () => {
    expect(await enable(1, null)).toMatchObject({ membershipVersion: 2 });
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const codeHash = hashReenrollmentCode({ userId: ownerId, tenantId, resetVersion: 3 }, "1234-5678");
    const reset = await users.disableTotp(ownerId, { tenantId, membershipVersion: 2 }, { codeHash, expiresAt });
    expect(reset).toMatchObject({ membershipVersion: 3, totpReenrollmentCodeHash: codeHash, totpReenrollmentExpiresAt: expiresAt });
    expect(reset?.totpEnabledAt).toBeUndefined();
    expect(await row()).toMatchObject({ membershipVersion: 3, membershipVersionRow: 3, totpEnabledAt: null, totpReenrollmentCodeHash: codeHash });

    // A stale reset (old version) changes nothing.
    expect(await users.disableTotp(ownerId, { tenantId, membershipVersion: 2 }, { codeHash: "v1:3:other", expiresAt })).toBeUndefined();
    // Enrollment without the verified hash, or with another hash, cannot complete the pending reset.
    expect(await enable(3, null)).toBeUndefined();
    expect(await enable(3, "v1:3:not-the-stored-hash")).toBeUndefined();
    // An expired grant is refused by the database clock too.
    await admin.query(`UPDATE "User" SET "totpReenrollmentExpiresAt" = now() - interval '1 second' WHERE "id" = $1`, [ownerId]);
    expect(await enable(3, codeHash)).toBeUndefined();
    await admin.query(`UPDATE "User" SET "totpReenrollmentExpiresAt" = $2 WHERE "id" = $1`, [ownerId, expiresAt]);

    // Two concurrent confirmations with the right hash: exactly one wins.
    const results = await Promise.all([enable(3, codeHash), enable(3, codeHash)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await row()).toMatchObject({ membershipVersion: 4, membershipVersionRow: 4, totpReenrollmentCodeHash: null, totpReenrollmentExpiresAt: null });
    expect((await row()).totpEnabledAt).not.toBeNull();
    expect(await enable(4, codeHash)).toBeUndefined();

    // Self-service disable leaves no grant behind (password-only enrollment as before).
    expect(await users.disableTotp(ownerId, { tenantId, membershipVersion: 4 })).toMatchObject({ membershipVersion: 5 });
    expect(await row()).toMatchObject({ totpReenrollmentCodeHash: null, totpReenrollmentExpiresAt: null });
    expect(await enable(5, null)).toMatchObject({ membershipVersion: 6 });
  });

  it("schema keeps the hash and expiry paired and only on accounts without TOTP", async () => {
    // The owner has TOTP on after the previous test.
    await expect(admin.query(`UPDATE "User" SET "totpSecretEncrypted" = NULL, "totpEnabledAt" = NULL, "totpReenrollmentCodeHash" = 'v1:9:x', "totpReenrollmentExpiresAt" = NULL WHERE "id" = $1`, [ownerId]))
      .rejects.toThrow(/User_totp_reenrollment_pair_check/);
    await expect(admin.query(`UPDATE "User" SET "totpReenrollmentCodeHash" = 'v1:9:x', "totpReenrollmentExpiresAt" = now() WHERE "id" = $1`, [ownerId]))
      .rejects.toThrow(/User_totp_reenrollment_disabled_check/);
  });

  it("queues reset notices as system-scoped outbox rows that never name the tenant or the account", async () => {
    await new PostgresMfaSecurityNoticeStore(app).enqueue({ kind: "MFA_RESET_BY_SUPPORT", to: "owner@mfa-reenroll.example.test", tenantName: tenantId });
    const rows = (await admin.query<{ tenantId: string | null; sourceScope: string; sourceId: string; status: string; payloadEncrypted: string; tenantLifecycleVersion: number | null }>(
      `SELECT "tenantId", "sourceScope", "sourceId", "status", "payloadEncrypted", "tenantLifecycleVersion" FROM "SecretDeliveryOutbox" WHERE "purpose" = 'MFA_SECURITY_NOTICE' AND "createdAt" >= $1`, [startedAt])).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tenantId: null, sourceScope: "SYSTEM", status: "PENDING", tenantLifecycleVersion: null });
    expect(rows[0]!.sourceId).not.toBe(ownerId);
    expect(rows[0]!.payloadEncrypted).toMatch(/^v1:/);
    expect(rows[0]!.payloadEncrypted).not.toContain("example.test");
    await expect(admin.query(
      `INSERT INTO "SecretDeliveryOutbox" ("id", "tenantId", "purpose", "sourceId", "payloadEncrypted", "status", "expiresAt", "updatedAt", "sourceScope", "tenantLifecycleVersion")
       VALUES (gen_random_uuid()::text, $1, 'MFA_SECURITY_NOTICE', 'x', 'v1:x', 'PENDING', now() + interval '1 hour', now(), 'TENANT', 0)`, [tenantId],
    )).rejects.toThrow(/SecretDeliveryOutbox_mfa_notice_scope_check/);
  });

  it("the runbook's system-admin DB recovery SQL still applies and leaves no re-enrollment grant", async () => {
    const before = (await admin.query<{ membershipVersion: number }>(`SELECT "membershipVersion" FROM "User" WHERE "id" = $1`, [systemAdminId])).rows[0]!;
    const client = await app.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
      const result = await client.query<{ users: string }>(
        `WITH target AS (
           UPDATE "User"
              SET "totpSecretEncrypted" = NULL,
                  "totpEnabledAt" = NULL,
                  "totpRecoveryCodeHashes" = ARRAY[]::TEXT[],
                  "totpLastUsedCounter" = NULL,
                  "membershipVersion" = "membershipVersion" + 1,
                  "updatedAt" = now()
            WHERE "id" = $1 AND "tenantId" = 'system'
              AND "membershipVersion" = $2
              AND "totpEnabledAt" IS NOT NULL
           RETURNING "id", "membershipVersion"
         ), membership AS (
           UPDATE "TenantMembership" m
              SET "version" = target."membershipVersion", "updatedAt" = now()
             FROM target
            WHERE m."tenantId" = 'system' AND m."userId" = target."id" AND m."status" = 'ACTIVE'
           RETURNING m."id"
         )
         SELECT (SELECT count(*) FROM target) AS users`, [systemAdminId, before.membershipVersion]);
      expect(Number(result.rows[0]!.users)).toBe(1);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    const recovered = await users.findById(systemAdminId);
    expect(recovered).toMatchObject({ membershipVersion: before.membershipVersion + 1 });
    expect(recovered?.totpEnabledAt).toBeUndefined();
    expect(recovered?.totpReenrollmentCodeHash).toBeUndefined();
  });
});
