import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { runTenantMutationActivity } from "@o-okul/db";
import { hashPassword, PostgresAuthUserStore } from "./auth-user-store.js";
import { AuthService } from "./auth.service.js";
import type { IdentityResolver } from "./identity-resolver.js";
import { LoginAttemptLimiter } from "./login-attempt-limiter.js";
import { InMemoryPasswordResetStore } from "./password-reset-store.js";
import { PostgresSessionStore } from "./session-store.js";
import type { TenantStore } from "../tenant/tenant-store.js";

// UAT F-25 on real PostgreSQL: a guardian-only account (bulk guardian invitation, no staff/teacher/student membership)
// logged in with a session that had no membershipId, so the session store's membership check threw and login
// returned 500. The session must carry the account's GUARDIAN membership row and pass the tenant mutation admission.
const appDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_TEST_URL;
const adminDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_ADMIN_URL;
if (process.env.ACCOUNT_MANAGEMENT_POSTGRES_REQUIRED === "1" && (!appDatabaseUrl || !adminDatabaseUrl)) {
  throw new Error("EMPLOYEE_ACTIVATION_POSTGRES_URLS_REQUIRED");
}
const describePostgres = appDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;

const tenantId = "guardian-login-tenant";
const tenantSlug = "guardian-login";
const guardianUserId = "guardian-login-user";
const guardianMembershipId = "guardian-login-user-guardian";
const guardianId = "guardian-login-guardian";
const email = "veli+grd1@guardian-login.example.test";
const password = "Guardian-Login-2026!";

describePostgres("guardian-only login on PostgreSQL", () => {
  const admin = new pg.Pool({ connectionString: adminDatabaseUrl });
  const app = new pg.Pool({ connectionString: appDatabaseUrl, max: 4 });

  beforeAll(async () => {
    await cleanup();
    await admin.query(`INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt") VALUES ($1, $1, $2, 'ACTIVE', now())`, [tenantId, tenantSlug]);
    await admin.query(
      `INSERT INTO "User" ("id", "tenantId", "name", "email", "emailNormalized", "passwordHash", "updatedAt")
       VALUES ($1, $2, 'Veli Login', $3, $3, $4, now())`,
      [guardianUserId, tenantId, email, hashPassword(password)],
    );
    await admin.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt") VALUES ($1, $2, $3, 'GUARDIAN', now())`,
      [guardianMembershipId, tenantId, guardianUserId],
    );
    await admin.query(
      `INSERT INTO "Guardian" ("id", "tenantId", "userId", "firstName", "lastName", "updatedAt") VALUES ($1, $2, $3, 'VELİ', 'LOGIN', now())`,
      [guardianId, tenantId, guardianUserId],
    );
  });

  afterAll(async () => {
    await cleanup();
    await Promise.all([admin.end(), app.end()]);
  });

  async function cleanup() {
    await admin.query(`DELETE FROM "TenantMutationActivity" WHERE "tenantId" = $1`, [tenantId]);
    await admin.query(`DELETE FROM "AuthSession" WHERE "tenantId" = $1`, [tenantId]);
    await admin.query(`DELETE FROM "Guardian" WHERE "tenantId" = $1`, [tenantId]);
    await admin.query(`DELETE FROM "TenantMembership" WHERE "tenantId" = $1`, [tenantId]);
    await admin.query(`DELETE FROM "User" WHERE "tenantId" = $1`, [tenantId]);
    await admin.query(`DELETE FROM "Tenant" WHERE "id" = $1`, [tenantId]);
  }

  it("issues a GUARDIAN persona session bound to the guardian membership and passes the mutation admission", async () => {
    const tenants = {
      findBySlug: vi.fn(async (slug: string) => (slug === tenantSlug ? { id: tenantId } : undefined)),
    } as unknown as TenantStore;
    const identities = {
      resolve: vi.fn(async () => ({ subjectType: "GUARDIAN", subjectId: guardianId })),
    } as unknown as IdentityResolver;
    const auth = new AuthService(new PostgresAuthUserStore(app), new PostgresSessionStore(app), new InMemoryPasswordResetStore(),
      identities, undefined, new LoginAttemptLimiter(), tenants);

    const result = await auth.login({ tenantSlug, loginName: "VELI+GRD1@guardian-login.example.test", password });
    expect(result).toMatchObject({ session: { userId: guardianUserId, tenantId } });
    const session = (result as { session: { id: string; membershipVersion: number } }).session;

    const stored = await admin.query<{ membershipId: string | null; activePersona: string | null; roles: string[]; subjectType: string | null }>(
      `SELECT "membershipId", "activePersona", "roles", "subjectType" FROM "AuthSession" WHERE "id" = $1`,
      [session.id],
    );
    expect(stored.rows[0]).toEqual({ membershipId: guardianMembershipId, activePersona: "GUARDIAN", roles: ["GUARDIAN"], subjectType: "GUARDIAN" });

    const tenant = await admin.query<{ lifecycleVersion: number }>(`SELECT "lifecycleVersion" FROM "Tenant" WHERE "id" = $1`, [tenantId]);
    await expect(runTenantMutationActivity(app, {
      tenantId,
      lifecycleVersion: tenant.rows[0]!.lifecycleVersion,
      kind: "HTTP_MUTATION",
      actor: { userId: guardianUserId, sessionId: session.id, membershipVersion: session.membershipVersion },
    }, async () => "admitted")).resolves.toBe("admitted");

    const refreshed = await auth.refresh((result as { refreshToken: string }).refreshToken);
    expect(refreshed.session).toMatchObject({ userId: guardianUserId, membershipId: guardianMembershipId, activePersona: "GUARDIAN" });
  });
});
