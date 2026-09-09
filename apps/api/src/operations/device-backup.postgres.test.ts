import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import pg from "pg";
import { resetBytesHash, withTenantDb, readTenantBackupSchema } from "@o-okul/db";
import { DeviceBackupService, projectDeviceBackup, validateDeviceBackupPayload } from "./device-backup.service.js";
import { sealDeviceBackup } from "./device-backup-archive.js";
import type { RequestContext } from "../context/request-context.js";
import { encryptTcIdentity } from "../student/tc-identity.js";

const appUrl = process.env.DEVICE_BACKUP_POSTGRES_TEST_URL;
const adminUrl = process.env.DEVICE_BACKUP_POSTGRES_ADMIN_URL;
if (process.env.DEVICE_BACKUP_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("DEVICE_BACKUP_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl,adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1","localhost"].includes(url.hostname) || !(["/o_okul_reset_drill","/o_okul_device_backup_test"].includes(url.pathname) || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
}
const run = appUrl && adminUrl ? describe : describe.skip;
run("device backup PostgreSQL projection", () => {
  const admin = new pg.Pool({ connectionString: adminUrl }), app = new pg.Pool({ connectionString: appUrl });
  const tenants = ["a","b"].map(suffix => `device-backup-${randomUUID()}-${suffix}`);
  const bytes = Buffer.from("device backup PG fixture"), sha = resetBytesHash(bytes);
  const key = (tenant: string) => `raw-imports/${tenant}/${tenant}-exam/v1/${sha}/source`;
  const signing = generateKeyPairSync("ed25519");
  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", appUrl!); vi.stubEnv("PERSISTENCE_DRIVER", "postgres"); vi.stubEnv("TENANT_STORE", "postgres");
    vi.stubEnv("TENANT_DEVICE_BACKUP_SIGNING_PRIVATE_KEY", signing.privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      for (const tenant of tenants) {
        await client.query('INSERT INTO "Tenant" ("id","name","slug","status","updatedAt") VALUES ($1,\'Device fixture\',$1,\'ACTIVE\',now())',[tenant]);
        await client.query('INSERT INTO "User" ("id","tenantId","name","passwordHash","totpSecretEncrypted","nationalIdEncrypted","updatedAt") VALUES ($1,$2,\'Fixture owner\',\'DO_NOT_EXPORT_HASH\',\'DO_NOT_EXPORT_MFA\',$3,now())',[tenant+"-user",tenant,encryptTcIdentity("10000000146")]);
        await client.query('INSERT INTO "TenantMembership" ("id","tenantId","userId","role","staffRole","scopeMode","updatedAt") VALUES ($1,$2,$3,\'TENANT_ADMIN\',\'TENANT_ADMIN\',\'TENANT\',now())',[tenant+"-member",tenant,tenant+"-user"]);
        await client.query('INSERT INTO "AuthSession" ("id","tenantId","userId","membershipId","activePersona","roles","tokenFamilyId","refreshTokenHash","expiresAt","updatedAt") VALUES ($1,$2,$3,$4,\'STAFF\',ARRAY[\'TENANT_ADMIN\'],$1,$1,now()+interval \'1 day\',now())',[tenant+"-session",tenant,tenant+"-user",tenant+"-member"]);
        await client.query('INSERT INTO "Exam" ("id","tenantId","title","updatedAt") VALUES ($1,$2,\'Fixture\',now())',[tenant+"-exam",tenant]);
        await client.query('INSERT INTO "RawImport" ("id","tenantId","examId","sourceType","fileName","s3Key","sha256","parserConfigVersion","metadata","updatedAt") VALUES ($1,$2,$3,\'TXT\',\'fixture.txt\',$4,$5,\'v1\',$6::jsonb,now())',[tenant+"-raw",tenant,tenant+"-exam",key(tenant),sha,'{"exactNumber":123456789012345678.123456789}']);
      }
      await client.query("COMMIT");
    } catch(error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });
  afterAll(async () => {
    try {
      await admin.query('DELETE FROM "RawImport" WHERE "tenantId" = ANY($1::text[])',[tenants]);
      await admin.query('DELETE FROM "Exam" WHERE "tenantId" = ANY($1::text[])',[tenants]);
      await admin.query('DELETE FROM "AuthSession" WHERE "tenantId" = ANY($1::text[])',[tenants]);
      await admin.query('DELETE FROM "TenantMembership" WHERE "tenantId" = ANY($1::text[])',[tenants]);
      for (const table of ["LicenseTerm"]) await admin.query(`DELETE FROM "${table}" WHERE "tenantId"=ANY($1::text[])`,[tenants]);
      await admin.query('DELETE FROM "User" WHERE "tenantId" = ANY($1::text[])',[tenants]);
      await admin.query('DELETE FROM "Tenant" WHERE "id" = ANY($1::text[])',[tenants]);
    } finally { await Promise.all([admin.end(),app.end()]); vi.unstubAllEnvs(); }
  });
  it("exports one institution with exact PostgreSQL JSON and decryptable identities, without authentication secrets", async () => {
    const payload = await withTenantDb(app,{ tenantId: tenants[0]!, readOnly: true, repeatableRead: true },async db => {
      const scope = await db.query<{ tenant: string; bypass: string }>("SELECT current_setting('app.current_tenant_id') AS tenant,current_setting('app.bypass_rls') AS bypass");
      expect(scope.rows[0]).toEqual({ tenant: tenants[0], bypass: "false" });
      return projectDeviceBackup(tenants[0]!,await readTenantBackupSchema(db),db);
    });
    expect(payload.tables.User).toHaveLength(1);
    expect(payload.tables.RawImport![0]!.row).toContain("123456789012345678.123456789");
    expect(JSON.stringify(payload)).not.toContain(tenants[1]);
    expect(JSON.stringify(payload)).not.toMatch(/DO_NOT_EXPORT|nationalIdEncrypted|passwordHash|totpSecretEncrypted/);
    expect(payload.tables.User![0]!.nationalId).toBe("10000000146");
    payload.files.push({ key: key(tenants[0]!),sha256:sha,contentBase64:bytes.toString("base64") });
    expect(validateDeviceBackupPayload(payload,tenants[0]!)).toEqual(payload);
  });
  it("rejects an oversized snapshot before returning records and keeps transactions read-only", async () => {
    let called = false;
    await expect(withTenantDb(app,{ tenantId: tenants[0]!, readOnly: true, repeatableRead: true },async db => { await projectDeviceBackup(tenants[0]!,await readTenantBackupSchema(db),db,1); called=true; })).rejects.toThrow("RESET_SNAPSHOT_SIZE_LIMIT");
    expect(called).toBe(false);
    await expect(withTenantDb(app,{ tenantId: tenants[0]!, readOnly: true, repeatableRead: true },async db => db.query('UPDATE "Tenant" SET "name"=\'invalid\' WHERE "id"=$1',[tenants[0]]))).rejects.toThrow(/read.only transaction/i);
  });
  it("validates an uploaded signed archive with the real app role and refuses a revoked session", async () => {
    const tenantId = tenants[0]!;
    const payload = await withTenantDb(app,{ tenantId, readOnly: true, repeatableRead: true },async db => projectDeviceBackup(tenantId,await readTenantBackupSchema(db),db));
    payload.files.push({ key: key(tenantId), sha256: sha, contentBase64: bytes.toString("base64") });
    const password = "local synthetic backup password";
    const file = await sealDeviceBackup(Buffer.from(JSON.stringify(payload)),tenantId,password,signing.privateKey);
    const context: RequestContext = { tenantId, userId: tenantId+"-user", sessionId: tenantId+"-session", membershipId: tenantId+"-member", membershipVersion: 1, activePersona: "STAFF", roles: ["TENANT_ADMIN"], bypassRls: false };
    const starts = new Date(Date.now()-86400000), ends = new Date(Date.now()+86400000);
    await admin.query('INSERT INTO "LicenseTerm" (id,"tenantId","planCode","startsAt","endsAt","activeStudentLimit") VALUES ($1,$2,$3,$4,$5,100)',[tenantId+"-preview-term",tenantId,"FIXTURE",starts,ends]);
    await admin.query('UPDATE "Tenant" SET plan=$2,"licenseStartsAt"=$3,"licenseEndsAt"=$4,"seatLimit"=100 WHERE id=$1',[tenantId,"FIXTURE",starts,ends]);
    const beforePreview = await withTenantDb(app,{tenantId,readOnly:true},async db => projectDeviceBackup(tenantId,await readTenantBackupSchema(db),db));
    const service = new DeviceBackupService();
    try {
      const initialPreview = await service.preview(context,file,password), impact = initialPreview.impact;
      expect(initialPreview.plan).toMatchObject({scope:"DATABASE_PREVIEW_ONLY",canApply:false});
      expect((await service.preview(context,file,password,initialPreview.plan!.token)).plan).toEqual(initialPreview.plan);
      await admin.query('UPDATE "Exam" SET title=$2 WHERE id=$1',[tenantId+"-exam","changed after plan"]);
      await expect(service.preview(context,file,password,initialPreview.plan!.token)).rejects.toMatchObject({status:409,message:"DEVICE_RESTORE_PLAN_STALE"});
      await admin.query('UPDATE "Exam" SET title=$2 WHERE id=$1',[tenantId+"-exam","Fixture"]);
      await admin.query('INSERT INTO "LicenseTerm" (id,"tenantId","planCode","startsAt","endsAt","activeStudentLimit") VALUES ($1,$2,$3,$4,$5,100)',[tenantId+"-future-term",tenantId,"FUTURE",new Date(Date.now()+2*86400000),new Date(Date.now()+3*86400000)]);
      await expect(service.preview(context,file,password,initialPreview.plan!.token)).rejects.toMatchObject({status:409,message:"DEVICE_RESTORE_PLAN_STALE"});
      await admin.query('DELETE FROM "LicenseTerm" WHERE id=$1',[tenantId+"-future-term"]);
      expect(impact).toMatchObject({additions:0,changes:0,removals:0,activeStudentLimit:100,canApply:false});
      expect(await withTenantDb(app,{tenantId,readOnly:true},async db=>projectDeviceBackup(tenantId,await readTenantBackupSchema(db),db))).toEqual(beforePreview);
      await admin.query('UPDATE "Tenant" SET "seatLimit"=101 WHERE id=$1',[tenantId]);
      expect((await service.preview(context,file,password)).impact?.blockers).toContain("DEVICE_RESTORE_CURRENT_LICENSE_UNVERIFIED");
      await admin.query('UPDATE "Tenant" SET "seatLimit"=100 WHERE id=$1',[tenantId]);
      expect(await service.preview(context,file,password)).toMatchObject({ tenantId, integrityVerified: true, schemaCompatible: true, fileCount: 1, canRestore: false });
      await admin.query('UPDATE "AuthSession" SET "status"=\'REVOKED\' WHERE "id"=$1',[context.sessionId]);
      await expect(service.preview(context,file,password,initialPreview.plan!.token)).rejects.toMatchObject({ status: 403, message: "DEVICE_BACKUP_ACTOR_CHANGED" });
    } finally {
      await service.onApplicationShutdown();
      await admin.query('DELETE FROM "LicenseTerm" WHERE id=$1',[tenantId+"-preview-term"]);
      await admin.query('UPDATE "Tenant" SET plan=$2,"licenseStartsAt"=NULL,"licenseEndsAt"=NULL,"seatLimit"=NULL WHERE id=$1',[tenantId,"TRIAL"]);
    }
  });

});
