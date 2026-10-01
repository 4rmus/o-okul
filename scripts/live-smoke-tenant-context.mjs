import { createHash, randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { runWithRequestContext } from "../apps/api/dist/context/request-context.js";
import { closeTenantMutationPool } from "../apps/api/dist/context/tenant-mutation-activity.js";

// Canlı smoke'lar API producer'ını doğrudan çağırır. Kalıcı tenant store'da (production/staging) kuyruk kabulü
// istek bağlamı ve DB'de aktif oturum ister; worker ise her modda işi ACTIVE tenant'a karşı kabul eder
// (tenant-mutation-activity). Bu yardımcı koruma kontrollerini atlamaz: smoke'a özel aktörü tohumlar, işi o
// bağlamda çalıştırır, sonunda oturumu iptal eder.
export async function runInLiveSmokeTenantContext({ directDatabaseUrl, tenantId, userId, label }, run) {
  const pool = new pg.Pool({ connectionString: directDatabaseUrl });
  const actor = await seedSmokeActor(pool, { tenantId, userId, label });
  try {
    return await runWithRequestContext({
      userId,
      sessionId: actor.sessionId,
      tenantId,
      tenantLifecycleVersion: actor.lifecycleVersion,
      membershipId: actor.membershipId,
      membershipVersion: 1,
      activePersona: "STAFF",
      roles: ["TENANT_OWNER"],
      bypassRls: false,
    }, run);
  } finally {
    try {
      await revokeSmokeSession(pool, actor.sessionId);
    } finally {
      await closeTenantMutationPool();
      await pool.end();
    }
  }
}

// Tohumlama gibi iptal de RLS bypass'lı işlem içinde yapılır; aksi halde UPDATE sessizce 0 satır günceller.
async function revokeSmokeSession(pool, sessionId) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const revoked = await client.query(
      `UPDATE "AuthSession" SET "status" = 'REVOKED', "updatedAt" = now() WHERE "id" = $1 AND "status" = 'ACTIVE'`,
      [sessionId],
    );
    await client.query("COMMIT");
    if (revoked.rowCount !== 1) throw new Error("LIVE_SMOKE_SESSION_REVOKE_FAILED");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function seedSmokeActor(pool, { tenantId, userId, label }) {
  const client = await pool.connect();
  const sessionId = randomUUID();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    await client.query(
      `INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt")
       VALUES ($1, $2, $3, 'ACTIVE', now())
       ON CONFLICT ("id") DO UPDATE SET "status" = 'ACTIVE', "updatedAt" = now()`,
      [tenantId, `${label} Smoke Tenant`, tenantId],
    );
    // Parola hiçbir yerde tutulmaz: hash rastgele ve kullanılamaz; aktör yalnız kuyruk kabulü için vardır.
    const unusableHash = createHash("sha256").update(randomBytes(32)).digest("hex");
    await client.query(
      `INSERT INTO "User" (
         "id", "tenantId", "email", "emailNormalized", "loginName", "loginNameNormalized", "name",
         "passwordHash", "passwordHashVersion", "accountStatus", "membershipVersion", "mustChangePassword", "updatedAt"
       )
       VALUES ($1, $2, $3, $3, $3, $3, $4, $5, 1, 'ACTIVE', 1, false, now())
       ON CONFLICT ("id") DO UPDATE
       SET "accountStatus" = 'ACTIVE', "membershipVersion" = 1, "passwordHash" = EXCLUDED."passwordHash", "updatedAt" = now()`,
      [userId, tenantId, `${userId}@smoke.o-okul.internal`, `${label} Smoke Actor`, unusableHash],
    );
    const membership = await client.query(
      `INSERT INTO "TenantMembership" (
         "id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona",
         "status", "version", "endsAt", "endedReason", "scopeMode", "updatedAt"
       )
       VALUES ($1, $2, $3, 'TENANT_OWNER', 'TENANT_OWNER', false, false, 'ACTIVE', 1, NULL, NULL, 'TENANT', now())
       ON CONFLICT ("tenantId", "userId", "role") DO UPDATE
       SET "status" = 'ACTIVE', "version" = 1, "endsAt" = NULL, "endedReason" = NULL, "updatedAt" = now()
       RETURNING "id"`,
      [`membership-${userId}`, tenantId, userId],
    );
    const membershipId = membership.rows[0].id;
    await client.query(
      `INSERT INTO "AuthSession" (
         "id", "userId", "tenantId", "membershipId", "activePersona", "roles", "tokenFamilyId", "refreshTokenHash",
         "status", "membershipVersion", "expiresAt", "updatedAt"
       )
       VALUES ($1, $2, $3, $4, 'STAFF', ARRAY['TENANT_OWNER'], $5, $6, 'ACTIVE', 1, now() + interval '10 minutes', now())`,
      [sessionId, userId, tenantId, membershipId, randomUUID(), createHash("sha256").update(randomBytes(32)).digest("hex")],
    );
    const tenant = await client.query(`SELECT "lifecycleVersion" FROM "Tenant" WHERE "id" = $1`, [tenantId]);
    await client.query("COMMIT");
    return { sessionId, membershipId, lifecycleVersion: tenant.rows[0].lifecycleVersion };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
