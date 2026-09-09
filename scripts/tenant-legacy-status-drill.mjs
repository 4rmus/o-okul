import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
export const statusMigration = "20260904120000_enforce_tenant_access_status";
const linkedTables = ["User", "AuthSession", "LicenseTerm", "LicenseUsage", "TenantMembership", "Teacher", "Employee", "PlatformAccount", "PlatformSession"];
async function snapshot(pool) {
  const tenants = (await pool.query('SELECT to_jsonb(t) AS row FROM "Tenant" t ORDER BY "id"')).rows.map((r) => r.row);
  const linked = {};
  for (const table of linkedTables) linked[table] = (await pool.query(`SELECT to_jsonb(t) AS row FROM "${table}" t ORDER BY "id"`)).rows.map((r) => r.row);
  return { tenants, linked };
}
export async function seedLegacyStatusUpgrade(pool, sql) {
  assert.equal(Number((await pool.query('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')).rows[0].count), 109, "LEGACY_BASELINE_CHANGED");
  for (const [id, status] of [["system", "ACTIVE"], ["legacy-active", "ACTIVE"], ["legacy-suspended", "SUSPENDED"], ["legacy-trial", "TRIAL"], ...Array.from({ length: 12 }, (_, i) => [`legacy-closed-${i + 1}`, "CLOSED"])]) {
    await pool.query('INSERT INTO "Tenant" ("id","name","slug","status","plan","updatedAt") VALUES ($1,$1,$1,$2,\'TRIAL\',\'2026-08-25T22:49:56.048Z\')', [id, status]);
    if (id === "system") {
      await pool.query(`INSERT INTO "User" ("id","tenantId","name","passwordHash","loginName","loginNameNormalized","totpSecretEncrypted","totpEnabledAt","updatedAt") VALUES ('legacy-system','system','synthetic','noncredential','system-login','system-login','synthetic-ciphertext',now(),now())`);
      await pool.query(`INSERT INTO "TenantMembership" ("id","tenantId","userId","role","updatedAt") VALUES ('legacy-system','system','legacy-system','SYSTEM_ADMIN',now())`);
      await pool.query(`INSERT INTO "PlatformAccount" ("id","name","passwordHash","passwordHashVersion","loginName","loginNameNormalized","status","totpSecretEncrypted","totpEnabledAt") SELECT "id","name","passwordHash","passwordHashVersion","loginName","loginNameNormalized","accountStatus","totpSecretEncrypted","totpEnabledAt" FROM "User" WHERE "id"='legacy-system'`);
      for (const sessionStatus of ["ACTIVE", "REVOKED"]) {
        await pool.query(`INSERT INTO "AuthSession" ("id","tenantId","userId","roles","tokenFamilyId","refreshTokenHash","status","expiresAt","updatedAt") VALUES ($1,'system','legacy-system',ARRAY['SYSTEM_ADMIN'],$1,$1,$2,now()+interval '1 hour',now())`, [`system-${sessionStatus}`, sessionStatus]);
      }
      await pool.query(`INSERT INTO "PlatformSession" ("id","platformAccountId","tokenFamilyId","refreshTokenHash","status","expiresAt") SELECT "id","userId","tokenFamilyId","refreshTokenHash","status","expiresAt" FROM "AuthSession" WHERE "tenantId"='system'`);
      continue;
    }
    await pool.query('INSERT INTO "User" ("id","tenantId","name","passwordHash","updatedAt") VALUES ($1,$1,\'synthetic\',\'noncredential\',\'2026-08-25T22:49:56.048Z\')', [id]);
    if (status === "CLOSED") await pool.query('INSERT INTO "LicenseTerm" ("id","tenantId","planCode","startsAt","endsAt","activeStudentLimit") VALUES ($1,$1,\'TRIAL\',\'2026-08-01T00:00:00Z\',\'2027-08-01T00:00:00Z\',100)', [id]);
    await pool.query('INSERT INTO "AuthSession" ("id","tenantId","userId","roles","tokenFamilyId","refreshTokenHash","expiresAt","updatedAt") VALUES ($1,$1,$1,ARRAY[\'TENANT_ADMIN\',\'TEACHER\'],$1,$1,now()+interval \'1 hour\',now())', [id]);
    await pool.query(`INSERT INTO "TenantMembership" ("id","tenantId","userId","role","staffRole","hasTeacherPersona","updatedAt")
      VALUES ($1 || '-admin',$1,$1,'TENANT_ADMIN','TENANT_ADMIN',true,now()), ($1 || '-teacher',$1,$1,'TEACHER',NULL,false,now())`, [id]);
    await pool.query(`INSERT INTO "Teacher" ("id","tenantId","userId","firstName","lastName","updatedAt") VALUES ($1,$1,$1,'synthetic','teacher',now())`, [id]);
    if (status === "ACTIVE" || status === "TRIAL") {
      await pool.query(`UPDATE "User" SET "passwordChangedAt" = now() WHERE "id" = $1`, [id]);
      await pool.query(`UPDATE "Tenant" SET "licenseStartsAt" = '2026-08-01', "licenseEndsAt" = '2027-08-01', "seatLimit" = 100 WHERE "id" = $1`, [id]);
    }
  }
  const before = await snapshot(pool);
  // Each rejected SQL file runs on one connection, then rolls back its own BEGIN.
  const client = await pool.connect();
  try {
    await client.query('INSERT INTO "Tenant" ("id","name","slug","status","updatedAt") VALUES (\'legacy-invalid\',\'synthetic\',\'legacy-invalid\',\'UNKNOWN\',now())');
    await assert.rejects(client.query(sql), /TENANT_STATUS_UNSUPPORTED/); await client.query("ROLLBACK");
    assert.equal((await client.query('SELECT "status" FROM "Tenant" WHERE "id" = \'legacy-closed-1\'')).rows[0].status, "CLOSED");
    await client.query('DELETE FROM "Tenant" WHERE "id" = \'legacy-invalid\'');
    await client.query('UPDATE "Tenant" SET "status" = \'CLOSED\' WHERE "id" = \'system\'');
    await assert.rejects(client.query(sql), /SYSTEM_TENANT_STATUS_INVALID/); await client.query("ROLLBACK");
    await client.query('UPDATE "Tenant" SET "status" = \'ACTIVE\' WHERE "id" = \'system\'');
  } finally { await client.query("ROLLBACK"); client.release(); }
  assert.deepEqual(await snapshot(pool), before, "REJECTED_MIGRATION_CHANGED_DATA");
  return before;
}
export async function verifyLegacyStatusUpgrade(pool, before) {
  const after = await snapshot(pool);
  assert.equal(after.tenants.length, before.tenants.length);
  assert.deepEqual(after.linked, before.linked, "LEGACY_LINKED_DATA_CHANGED");
  for (const old of before.tenants) {
    const current = after.tenants.find((row) => row.id === old.id);
    assert.ok(current);
    const previousColumns = Object.fromEntries(Object.keys(old).map((key) => [key, current[key]]));
    const expected = { ...old, status: old.status === "CLOSED" ? "SUSPENDED" : old.status === "TRIAL" ? "ACTIVE" : old.status };
    if (old.status === "TRIAL") { assert.ok(Date.parse(current.updatedAt) >= Date.parse(old.updatedAt)); expected.updatedAt = current.updatedAt; }
    assert.deepEqual(previousColumns, expected, "LEGACY_TENANT_DATA_CHANGED");
    assert.equal(current.lifecycleVersion, 0);
    assert.equal(current.suspendedReason, null); assert.equal(current.suspendedAt, null); assert.equal(current.resetRequest, null);
  }
  await assert.rejects(pool.query('UPDATE "Tenant" SET "status" = \'CLOSED\' WHERE "id" = \'legacy-closed-1\''), (e) => e.code === "23514");
  return { status: "PASS", baselineMigrations: 109, closedRowsPreserved: 12, linkedRowsPreserved: Object.values(before.linked).reduce((sum, rows) => sum + rows.length, 0), unknownStatusRejected: true, systemClosureRejected: true, closureTimestampPreserved: true, licensePlanPreserved: true, rollbackAfterRejectedInputVerified: true, currentClosedConstraintRejected: true };
}

export async function verifyLegacyBackfills(pool, run, outputDirectory) {
  const allBefore = await snapshot(pool);
  const inactive = (state) => {
    const ids = new Set(state.tenants.filter((row) => row.status === "SUSPENDED" || row.id === "system").map((row) => row.id));
    return { tenants: state.tenants.filter((row) => ids.has(row.id)), linked: Object.fromEntries(Object.entries(state.linked).map(([table, rows]) => [table, rows.filter((row) => ids.has(row.tenantId) && row.tenantId !== "system")])) };
  };
  const protectedBefore = inactive(allBefore);
  // The existing backfill refreshes updatedAt; every credential/session field must stay identical.
  const systemAccounts = (state) => Object.fromEntries(Object.entries(state.linked).map(([table, rows]) => [table,
    rows.filter((row) => row.tenantId === "system" || row.platformAccountId === "legacy-system" || row.id === "legacy-system")
      .map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== "updatedAt"))),
  ]));
  const systemBefore = systemAccounts(allBefore);
  for (const mode of ["DRY_RUN", "APPLY", "APPLY"]) {
    for (const [script, prefix, confirmation] of [
      ["account-management", "ACCOUNT_MANAGEMENT", "apply-pr4-backfill"],
      ["license-terms", "LICENSE_TERM", "apply-pr5-license-term-backfill"],
    ]) {
      const output = `${outputDirectory}/${script}-${mode.toLowerCase()}.json`;
      await run(`scripts/backfill-${script}.mjs`, {
        [`${prefix}_BACKFILL_MODE`]: mode,
        [`${prefix}_BACKFILL_CONFIRM`]: confirmation,
        [`${prefix}_BACKFILL_OUTPUT`]: output,
      });
      const report = JSON.parse(await readFile(output, "utf8"));
      assert.equal(report.result, mode === "DRY_RUN" ? "READY" : "PASS");
      assert.equal(report.databaseMutationApplied, mode === "APPLY");
      assert.equal(script === "account-management" ? report.checks.owners.activeTenants : report.checks.eligibleTenants, 2);
      const current = await snapshot(pool);
      assert.deepEqual(inactive(current), protectedBefore, "BACKFILL_CHANGED_PROTECTED_TENANTS");
      assert.deepEqual(systemAccounts(current), systemBefore, "BACKFILL_CHANGED_SYSTEM_CREDENTIALS_OR_SESSIONS");
    }
    if (mode === "DRY_RUN") assert.deepEqual(await snapshot(pool), allBefore, "BACKFILL_DRY_RUN_CHANGED_DATA");
  }
  const after = await snapshot(pool);
  for (const id of ["legacy-active", "legacy-trial"]) {
    assert.equal(after.linked.User.find((row) => row.id === id).loginNameNormalized, `account-${id}`);
    assert.equal(after.linked.TenantMembership.find((row) => row.id === `${id}-admin`).staffRole, "TENANT_OWNER");
    assert.ok(after.linked.Teacher.find((row) => row.id === id).employeeId);
    assert.equal(after.linked.LicenseTerm.filter((row) => row.tenantId === id).length, 1);
    assert.equal(after.linked.LicenseUsage.filter((row) => row.tenantId === id).length, 1);
  }
  return { status: "PASS", inactiveTenantsPreserved: 13, systemTenantRowPreserved: true, systemCredentialsAndSessionsPreserved: true, dryRunUnchanged: true, activeTenantsConverted: 2, repeatApplyVerified: true, evidenceClass: "LOCAL_RUNTIME", externalDatabaseMutation: false };
}
