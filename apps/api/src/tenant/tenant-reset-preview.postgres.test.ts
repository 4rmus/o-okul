import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { withResetPreviewSnapshot, withResetSnapshot } from "@o-okul/db";
import { runWithRequestContext } from "../context/request-context.js";
import { TenantResetPreviewService } from "./tenant-reset-preview.service.js";

const appUrl = process.env.DEVICE_BACKUP_POSTGRES_TEST_URL, adminUrl = process.env.DEVICE_BACKUP_POSTGRES_ADMIN_URL;
if (process.env.DEVICE_BACKUP_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("DEVICE_BACKUP_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(["/o_okul_reset_drill", "/o_okul_device_backup_test"].includes(url.pathname) || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
}
const run = appUrl && adminUrl ? describe : describe.skip;
run("clean-reset preview with restricted production app role", () => {
  const app = new pg.Pool({ connectionString: appUrl }), admin = new pg.Pool({ connectionString: adminUrl });
  const tenants = ["a", "b"].map(s => `reset-preview-${randomUUID()}-${s}`);
  beforeAll(async () => {
    vi.stubEnv("TENANT_STORE", "postgres"); vi.stubEnv("DATABASE_URL", appUrl!);
    // These independent checks remain explicitly blocked in this DB regression test.
    vi.stubEnv("REDIS_URL", ""); vi.stubEnv("S3_ENDPOINT", "");
    const db = await admin.connect();
    try {
      await db.query("BEGIN");
      for (const id of tenants) {
        await db.query('INSERT INTO "PlatformAccount" (id,"loginName","loginNameNormalized",name,"passwordHash",status,"updatedAt") VALUES ($1,$1,$1,\'Platform fixture\',\'DO_NOT_READ_PLATFORM_SECRET\',\'SUSPENDED\',now())', [id + "-platform"]);
        await db.query('INSERT INTO "Tenant" (id,slug,name,status,"updatedAt") VALUES ($1,$1,\'Reset preview fixture\',\'ACTIVE\',now())', [id]);
        await db.query('INSERT INTO "LicenseTerm" (id,"tenantId","planCode","startsAt","endsAt","activeStudentLimit","createdByPlatformAccountId") VALUES ($1,$2,\'TRIAL\',now()-interval \'1 day\',now()+interval \'1 day\',100,$3)', [id + "-license", id, id + "-platform"]);
        await db.query('INSERT INTO "User" (id,"tenantId",name,"passwordHash","updatedAt") VALUES ($1,$2,\'Owner\',\'FIXTURE_OWNER_HASH\',now())', [id + "-owner", id]);
        await db.query('INSERT INTO "Employee" (id,"tenantId","userId","firstName","lastName",status,"updatedAt") VALUES ($1,$2,$3,\'Fixture\',\'Owner\',\'ACTIVE\',now())', [id + "-employee", id, id + "-owner"]);
        await db.query('INSERT INTO "TenantMembership" (id,"tenantId","userId",role,"staffRole","scopeMode","updatedAt") VALUES ($1,$2,$3,\'TENANT_OWNER\',\'TENANT_OWNER\',\'TENANT\',now())', [id + "-membership", id, id + "-owner"]);
      }
      await db.query("COMMIT");
    } catch (error) { await db.query("ROLLBACK"); throw error; } finally { db.release(); }
  });
  afterAll(async () => {
    try {
      for (const table of ["LicenseUsage", "TenantMembership", "Employee", "User", "LicenseTerm"]) await admin.query(`DELETE FROM "${table}" WHERE "tenantId"=ANY($1::text[])`, [tenants]);
      await admin.query('DELETE FROM "Tenant" WHERE id=ANY($1::text[])', [tenants]);
      await admin.query('DELETE FROM "PlatformAccount" WHERE id=ANY($1::text[])', [tenants.map(id => id + "-platform")]);
    } finally { await Promise.all([app.end(), admin.end()]); vi.unstubAllEnvs(); }
  });
  it("returns the selected tenant's counts without privileged reads or enabling cleanup", async () => {
    const denied = (await app.query("SELECT current_user AS role,has_table_privilege(current_user,'\"_prisma_migrations\"','SELECT') AS migrations,has_table_privilege(current_user,'\"PlatformAccount\"','SELECT') AS accounts,has_table_privilege(current_user,'\"PlatformSession\"','SELECT') AS sessions")).rows[0];
    expect(denied).toEqual({ role: "app", migrations: false, accounts: false, sessions: false });
    await expect(withResetSnapshot(app, tenants[0]!, async s => s)).rejects.toMatchObject({ code: "42501" });
    const snapshot = await withResetPreviewSnapshot(app, tenants[0]!, async (s, db) => {
      expect((await db.query<{ transaction_read_only: string }>("SHOW transaction_read_only")).rows[0]?.transaction_read_only).toBe("on");
      return s;
    });
    expect(snapshot.migrationRows).toEqual([]);
    expect(snapshot.tables.PlatformSession).toEqual([]);
    expect(snapshot.tables.PlatformAccount.map(row => row.id)).toEqual([tenants[0] + "-platform"]);
    expect(JSON.stringify(snapshot.tables)).not.toContain(tenants[1]);
    expect(JSON.stringify(snapshot)).not.toContain("DO_NOT_READ_PLATFORM_SECRET");
    await expect(withResetPreviewSnapshot(app, tenants[0]!, (_s, db) => db.query('UPDATE "Tenant" SET name=\'invalid\' WHERE id=$1', [tenants[0]]))).rejects.toMatchObject({ code: "25006" });
    const result = await runWithRequestContext({ userId: "system-fixture", roles: ["SYSTEM_ADMIN"], tenantId: "system", bypassRls: false }, () => new TenantResetPreviewService({ findOne: async () => ({ lifecycleVersion: 0 }) } as never).preview(tenants[0]!));
    expect(result).toMatchObject({ allowed: false, preservedOwnerCount: 1, lifecycleVersion: 0 });
    expect(result.categories.find(row => row.category === "PlatformAccount")).toMatchObject({ preserved: 1, deleted: 0 });
    expect(result.blockers).toEqual(expect.arrayContaining(["INSTITUTION_REQUEST_REQUIRED", "WRITE_QUIESCENCE_UNVERIFIED", "QUEUE_STATE_UNVERIFIED", "OBJECT_INVENTORY_UNVERIFIED"]));
    expect(JSON.stringify(result)).not.toMatch(/FIXTURE_OWNER_HASH|DO_NOT_READ_PLATFORM_SECRET/);
    // The privileged backup path still requires the real migration ledger.
    const backup = await withResetSnapshot(admin, tenants[0]!, async s => s);
    expect(backup.migrationRows.length).toBeGreaterThan(0);
    expect(backup.schemaDigest).not.toBe(snapshot.schemaDigest);
  });
});
