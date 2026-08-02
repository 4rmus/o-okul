import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PostgresEmployeeAccountActivationStore } from "./employee-account-activation-store.js";

const appDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_TEST_URL;
const adminDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_ADMIN_URL;
const describePostgres = appDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;

describePostgres("PostgresEmployeeAccountActivationStore integration", () => {
  const admin = new pg.Pool({ connectionString: adminDatabaseUrl });
  const app = new pg.Pool({ connectionString: appDatabaseUrl });
  const store = new PostgresEmployeeAccountActivationStore(app, 1);

  beforeAll(async () => {
    await cleanupFixtures(admin);
    await seedTenant(admin, "employee-activation-tenant-a", "employee-activation-a", 1);
    await seedTenant(admin, "employee-activation-tenant-b", "employee-activation-b", 10);
    await seedInvitation(admin, {
      tenantId: "employee-activation-tenant-a",
      employeeId: "employee-activation-a-1",
      invitationId: "employee-activation-invitation-a-1",
      email: "employee.activation.a1@example.test",
      tokenHash: "employee-activation-token-a-1",
    });
    await seedInvitation(admin, {
      tenantId: "employee-activation-tenant-a",
      employeeId: "employee-activation-a-2",
      invitationId: "employee-activation-invitation-a-2",
      email: "employee.activation.a2@example.test",
      tokenHash: "employee-activation-token-a-2",
    });
    await seedInvitation(admin, {
      tenantId: "employee-activation-tenant-b",
      employeeId: "employee-activation-b-1",
      invitationId: "employee-activation-invitation-b-1",
      email: "employee.activation.b1@example.test",
      tokenHash: "employee-activation-token-b-1",
    });
  });

  afterAll(async () => {
    await cleanupFixtures(admin);
    await Promise.all([admin.end(), app.end()]);
  });

  it("son çalışan hesap hakkı için paralel kabullerde yalnız bir hesabı atomik olarak etkinleştirir", async () => {
    const acceptedAt = new Date().toISOString();
    const outcomes = await Promise.all([
      store.accept({
        tokenHash: "employee-activation-token-a-1",
        passwordHash: "scrypt:v2:test-password-hash-a-1",
        acceptedAt,
      }),
      store.accept({
        tokenHash: "employee-activation-token-a-2",
        passwordHash: "scrypt:v2:test-password-hash-a-2",
        acceptedAt,
      }),
    ]);

    expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["ACCEPTED", "ACCOUNT_LIMIT_EXCEEDED"]);
    const state = await admin.query<{
      acceptedInvitations: number;
      boundEmployees: number;
      memberships: number;
      pendingInvitations: number;
      users: number;
    }>(
      `SELECT
         (SELECT count(*)::int FROM "User" WHERE "tenantId" = $1) AS users,
         (SELECT count(*)::int FROM "TenantMembership" WHERE "tenantId" = $1) AS memberships,
         (SELECT count(*)::int FROM "Employee" WHERE "tenantId" = $1 AND "userId" IS NOT NULL) AS "boundEmployees",
         (SELECT count(*)::int FROM "IdentityInvitation" WHERE "tenantId" = $1 AND "status" = 'ACCEPTED') AS "acceptedInvitations",
         (SELECT count(*)::int FROM "IdentityInvitation" WHERE "tenantId" = $1 AND "status" = 'PENDING') AS "pendingInvitations"`,
      ["employee-activation-tenant-a"],
    );
    expect(state.rows[0]).toEqual({
      users: 1,
      memberships: 1,
      boundEmployees: 1,
      acceptedInvitations: 1,
      pendingInvitations: 1,
    });

    const otherTenant = await admin.query<{ boundEmployees: number; pendingInvitations: number; users: number }>(
      `SELECT
         (SELECT count(*)::int FROM "User" WHERE "tenantId" = $1) AS users,
         (SELECT count(*)::int FROM "Employee" WHERE "tenantId" = $1 AND "userId" IS NOT NULL) AS "boundEmployees",
         (SELECT count(*)::int FROM "IdentityInvitation" WHERE "tenantId" = $1 AND "status" = 'PENDING') AS "pendingInvitations"`,
      ["employee-activation-tenant-b"],
    );
    expect(otherTenant.rows[0]).toEqual({ users: 0, boundEmployees: 0, pendingInvitations: 1 });
  });
});

async function cleanupFixtures(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM "SecretDeliveryOutbox" WHERE "sourceId" LIKE 'employee-activation-invitation-%'`,
  );
  await pool.query(
    `DELETE FROM "Tenant" WHERE "id" IN ('employee-activation-tenant-a', 'employee-activation-tenant-b')`,
  );
}

async function seedTenant(pool: pg.Pool, tenantId: string, slug: string, seatLimit: number): Promise<void> {
  const startsAt = "2026-01-01T00:00:00.000Z";
  const endsAt = "2027-01-01T00:00:00.000Z";
  await pool.query(
    `INSERT INTO "Tenant" (
       "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status", "updatedAt"
     ) VALUES ($1, $2, $3, 'TEST', $4, $5, $6, 'ACTIVE', now())`,
    [tenantId, tenantId, slug, startsAt, endsAt, seatLimit],
  );
  await pool.query(
    `INSERT INTO "LicenseTerm" (
       "id", "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit", "updatedAt"
     ) VALUES ($1, $2, 'TEST', $3, $4, $5, now())`,
    [`license-${tenantId}`, tenantId, startsAt, endsAt, seatLimit],
  );
}

async function seedInvitation(
  pool: pg.Pool,
  input: { tenantId: string; employeeId: string; invitationId: string; email: string; tokenHash: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO "Employee" (
       "id", "tenantId", "firstName", "lastName", "workEmail", "status", "updatedAt"
     ) VALUES ($1, $2, 'Ada', 'Operasyon', $3, 'ACTIVE', now())`,
    [input.employeeId, input.tenantId, input.email],
  );
  await pool.query(
    `INSERT INTO "IdentityInvitation" (
       "id", "tenantId", "subjectType", "subjectId", "email", "name", "role", "kind",
       "tokenHash", "status", "expiresAt", "updatedAt"
     ) VALUES ($1, $2, 'EMPLOYEE', $3, $4, 'Ada Operasyon', 'OPERATIONS_STAFF', 'EMAIL_LINK', $5, 'PENDING', now() + interval '1 day', now())`,
    [input.invitationId, input.tenantId, input.employeeId, input.email, input.tokenHash],
  );
  await pool.query(
    `INSERT INTO "SecretDeliveryOutbox" (
       "id", "tenantId", "purpose", "sourceId", "payloadEncrypted", "status", "expiresAt", "updatedAt"
     ) VALUES ($1, $2, 'IDENTITY_INVITATION', $3, 'encrypted-test-payload', 'PENDING', now() + interval '1 day', now())`,
    [`outbox-${input.invitationId}`, input.tenantId, input.invitationId],
  );
}
