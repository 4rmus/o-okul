import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { lastValueFrom, throwError, defer } from "rxjs";
import { BadRequestException, InternalServerErrorException, type ExecutionContext } from "@nestjs/common";
import { requireNoTenantMutationActivity } from "@o-okul/db";
import { TenantMutationInterceptor } from "./tenant-mutation.interceptor.js";
import { closeTenantMutationPool, runVerifiedTenantMutation } from "../context/tenant-mutation-activity.js";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";

// UAT F-12: ordinary 400s left UNCERTAIN TenantMutationActivity rows that blocked tenant reset forever.
const appDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_TEST_URL;
const adminDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_ADMIN_URL;
if (process.env.ACCOUNT_MANAGEMENT_POSTGRES_REQUIRED === "1" && (!appDatabaseUrl || !adminDatabaseUrl)) throw new Error("EMPLOYEE_ACTIVATION_POSTGRES_URLS_REQUIRED");
const describePostgres = appDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;
const tenantId = "mutation-settle-tenant-a";
const execution = { switchToHttp: () => ({ getRequest: () => ({ method: "POST" }) }) } as ExecutionContext;

describePostgres("TenantMutationActivity settlement on PostgreSQL (UAT F-12)", () => {
  const admin = new pg.Pool({ connectionString: adminDatabaseUrl });
  let context: RequestContext;
  const intercept = (error: Error) => runWithRequestContext(context, () => lastValueFrom(new TenantMutationInterceptor().intercept(execution, { handle: () => throwError(() => error) })));
  const rows = async () => (await admin.query<{ kind: string; status: string }>('SELECT "kind", "status" FROM "TenantMutationActivity" WHERE "tenantId" = $1 ORDER BY "kind"', [tenantId])).rows;
  const clear = () => admin.query('DELETE FROM "TenantMutationActivity" WHERE "tenantId" = $1', [tenantId]);

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", appDatabaseUrl!); vi.stubEnv("PERSISTENCE_DRIVER", "postgres"); vi.stubEnv("TENANT_STORE", "postgres");
    await cleanup(admin);
    await admin.query(`INSERT INTO "Tenant" ("id","name","slug","status","updatedAt") VALUES ($1,$1,$1,'ACTIVE',now())`, [tenantId]);
    await admin.query(`INSERT INTO "User" ("id","tenantId","name","passwordHash","updatedAt") VALUES ($1,$2,'Settle admin','x',now())`, [`${tenantId}-user`, tenantId]);
    await admin.query(`INSERT INTO "TenantMembership" ("id","tenantId","userId","role","staffRole","scopeMode","updatedAt") VALUES ($1,$2,$3,'TENANT_ADMIN','TENANT_ADMIN','TENANT',now())`, [`${tenantId}-member`, tenantId, `${tenantId}-user`]);
    await admin.query(`INSERT INTO "AuthSession" ("id","tenantId","userId","membershipId","activePersona","roles","tokenFamilyId","refreshTokenHash","expiresAt","updatedAt") VALUES ($1,$2,$3,$4,'STAFF',ARRAY['TENANT_ADMIN'],$1,$1,now()+interval '1 day',now())`, [`${tenantId}-session`, tenantId, `${tenantId}-user`, `${tenantId}-member`]);
    const seeded = (await admin.query<{ lifecycleVersion: number; membershipVersion: number }>('SELECT t."lifecycleVersion", s."membershipVersion" FROM "Tenant" t JOIN "AuthSession" s ON s."tenantId" = t."id" WHERE t."id" = $1', [tenantId])).rows[0]!;
    context = { tenantId, tenantLifecycleVersion: seeded.lifecycleVersion, userId: `${tenantId}-user`, sessionId: `${tenantId}-session`, membershipVersion: seeded.membershipVersion, roles: ["TENANT_ADMIN"], bypassRls: false } as RequestContext;
  });
  afterAll(async () => {
    await cleanup(admin);
    await closeTenantMutationPool();
    await admin.end();
    vi.unstubAllEnvs();
  });

  it.each(["EMPLOYEE_INVITATION_ALREADY_PENDING", "TEACHER_ASSIGNMENT_COURSE_GRADE_LEVEL_MISMATCH"])("a handler 400 (%s) leaves no activity row and does not block reset", async (code) => {
    await clear();
    await expect(intercept(new BadRequestException(code))).rejects.toThrow(code);
    expect(await rows()).toEqual([]);
    await expect(requireNoTenantMutationActivity(admin, tenantId)).resolves.toBeUndefined();
  });

  it.each([["5xx", new InternalServerErrorException("BOOM")], ["unknown", new Error("REMOTE_UNKNOWN")]])("a %s error still leaves UNCERTAIN and blocks reset", async (_label, error) => {
    await clear();
    await expect(intercept(error)).rejects.toThrow();
    expect(await rows()).toEqual([{ kind: "HTTP_MUTATION", status: "UNCERTAIN" }]);
    await expect(requireNoTenantMutationActivity(admin, tenantId)).rejects.toThrow("RESET_MUTATION_ACTIVITY_PRESENT");
  });

  it("provider send followed by a 400 keeps the nested PROVIDER_MUTATION row UNCERTAIN", async () => {
    await clear();
    const send = vi.fn(async () => {});
    const handle = () => defer(() => runVerifiedTenantMutation({ tenantId, lifecycleVersion: context.tenantLifecycleVersion!, kind: "PROVIDER_MUTATION", referenceId: "notification:settle-test", actor: { userId: context.userId, sessionId: context.sessionId!, membershipVersion: context.membershipVersion! } }, async () => { await send(); throw new BadRequestException("ANNOUNCEMENT_DELIVERY_RESULT_COUNT_INVALID"); }));
    await expect(runWithRequestContext(context, () => lastValueFrom(new TenantMutationInterceptor().intercept(execution, { handle })))).rejects.toThrow("ANNOUNCEMENT_DELIVERY_RESULT_COUNT_INVALID");
    expect(send).toHaveBeenCalledTimes(1);
    expect(await rows()).toEqual([{ kind: "PROVIDER_MUTATION", status: "UNCERTAIN" }]);
    await expect(requireNoTenantMutationActivity(admin, tenantId)).rejects.toThrow("RESET_MUTATION_ACTIVITY_PRESENT");
  });
});

async function cleanup(pool: pg.Pool): Promise<void> {
  await pool.query('DELETE FROM "TenantMutationActivity" WHERE "tenantId" = $1', [tenantId]);
  await pool.query('DELETE FROM "AuthSession" WHERE "tenantId" = $1', [tenantId]);
  await pool.query('DELETE FROM "TenantMembership" WHERE "tenantId" = $1', [tenantId]);
  await pool.query('DELETE FROM "User" WHERE "tenantId" = $1', [tenantId]);
  await pool.query('DELETE FROM "Tenant" WHERE "id" = $1', [tenantId]);
}
