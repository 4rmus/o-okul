import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { PostgresEmployeeAccountActivationStore } from "./employee-account-activation-store.js";

const appDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_TEST_URL;
const adminDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_ADMIN_URL;
const postgresRequired = process.env.ACCOUNT_MANAGEMENT_POSTGRES_REQUIRED === "1";

if (postgresRequired && (!appDatabaseUrl || !adminDatabaseUrl)) {
  throw new Error("EMPLOYEE_ACTIVATION_POSTGRES_URLS_REQUIRED");
}

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

  // UAT F-20: invitation creation runs the activation's e-mail rules (tenant RLS on, app role) before any write.
  it("davet öncesi e-posta kontrolü bağlı, öğretmen bağlı ve uyumsuz hesapları ayırır; bağsız öğretmene izin verir", async () => {
    const tenantId = "employee-activation-tenant-b";
    await seedF20Accounts(admin, tenantId);
    const check = (email: string) => store.findInvitationEmailConflict({ tenantId, employeeId: "employee-activation-b-1", email });

    await expect(check("F20.Bound@example.test")).resolves.toBe("EMAIL_ACCOUNT_ALREADY_BOUND");
    await expect(check("f20.teacher-linked@example.test")).resolves.toBe("EMAIL_ACCOUNT_ALREADY_BOUND");
    await expect(check("f20.student@example.test")).resolves.toBe("EMAIL_ACCOUNT_INCOMPATIBLE");
    await expect(check("f20.free-teacher@example.test")).resolves.toBeUndefined();
    await expect(check("f20.nobody@example.test")).resolves.toBeUndefined();
    // The teacher-linked Employee is the target itself: not "another" employee.
    await expect(store.findInvitationEmailConflict({ tenantId, employeeId: "f20-teacher-employee", email: "f20.teacher-linked@example.test" }))
      .resolves.toBeUndefined();
    // Another tenant's RLS context never sees these accounts.
    await expect(store.findInvitationEmailConflict({
      tenantId: "employee-activation-tenant-a",
      employeeId: "employee-activation-a-1",
      email: "f20.bound@example.test",
    })).resolves.toBeUndefined();
  });

  it("aktivasyon öğretmen bağlı çalışan hesabını reddeder, iptal edilen daveti REVOKED olarak bildirir", async () => {
    const tenantId = "employee-activation-tenant-b";
    await admin.query(
      `UPDATE "IdentityInvitation" SET "email" = 'f20.teacher-linked@example.test' WHERE "id" = 'employee-activation-invitation-b-1'`,
    );
    await expect(store.accept({
      tokenHash: "employee-activation-token-b-1",
      passwordHash: "scrypt:v2:test-password-hash-b-1",
      acceptedAt: new Date().toISOString(),
    })).resolves.toEqual({ status: "EMAIL_ACCOUNT_ALREADY_BOUND" });
    const bound = await admin.query(`SELECT "userId" FROM "Employee" WHERE "id" = 'employee-activation-b-1'`);
    expect(bound.rows).toEqual([{ userId: null }]);

    await admin.query(`UPDATE "IdentityInvitation" SET "status" = 'REVOKED' WHERE "id" = 'employee-activation-invitation-b-1'`);
    await expect(store.accept({
      tokenHash: "employee-activation-token-b-1",
      passwordHash: "scrypt:v2:test-password-hash-b-1",
      acceptedAt: new Date().toISOString(),
    })).resolves.toEqual({ status: "REVOKED" });
    const users = await admin.query(`SELECT count(*)::int AS count FROM "User" WHERE "tenantId" = $1`, [tenantId]);
    expect(users.rows).toEqual([{ count: 4 }]);
  });
});

async function seedF20Accounts(pool: pg.Pool, tenantId: string): Promise<void> {
  const accounts = [
    { id: "f20-bound-user", email: "f20.bound@example.test", role: "OPERATIONS_STAFF", staffRole: "OPERATIONS_STAFF", teacher: false, student: false },
    { id: "f20-teacher-linked-user", email: "f20.teacher-linked@example.test", role: "TEACHER", staffRole: null, teacher: true, student: false },
    { id: "f20-student-user", email: "f20.student@example.test", role: "STUDENT", staffRole: null, teacher: false, student: true },
    { id: "f20-free-teacher-user", email: "f20.free-teacher@example.test", role: "TEACHER", staffRole: null, teacher: true, student: false },
  ];
  for (const account of accounts) {
    await pool.query(
      `INSERT INTO "User" ("id", "tenantId", "name", "email", "emailNormalized", "passwordHash", "updatedAt")
       VALUES ($1, $2, 'F20 Hesap', $3, $3, 'FIXTURE_HASH', now())`,
      [account.id, tenantId, account.email],
    );
    await pool.query(
      `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
      [`membership-${account.id}`, tenantId, account.id, account.role, account.staffRole, account.teacher, account.student],
    );
  }
  await pool.query(
    `INSERT INTO "Employee" ("id", "tenantId", "firstName", "lastName", "status", "userId", "updatedAt")
     VALUES ('f20-bound-employee', $1, 'Bagli', 'Calisan', 'ACTIVE', 'f20-bound-user', now()),
            ('f20-teacher-employee', $1, 'Ogretmen', 'Calisan', 'ACTIVE', NULL, now())`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO "Teacher" ("id", "tenantId", "firstName", "lastName", "userId", "employeeId", "updatedAt")
     VALUES ('f20-teacher-linked', $1, 'Bagli', 'Ogretmen', 'f20-teacher-linked-user', 'f20-teacher-employee', now()),
            ('f20-free-teacher', $1, 'Serbest', 'Ogretmen', 'f20-free-teacher-user', NULL, now())`,
    [tenantId],
  );
}

async function cleanupFixtures(pool: pg.Pool): Promise<void> {
  await pool.query(
    `DELETE FROM "SecretDeliveryOutbox"
     WHERE "sourceId" = ANY($1::text[])`,
    [[
      "employee-activation-invitation-a-1",
      "employee-activation-invitation-a-2",
      "employee-activation-invitation-b-1",
    ]],
  );
  await pool.query(
    `DELETE FROM "Tenant" WHERE "id" IN ('employee-activation-tenant-a', 'employee-activation-tenant-b')`,
  );
}

async function seedTenant(pool: pg.Pool, tenantId: string, slug: string, seatLimit: number): Promise<void> {
  const startsAt = new Date(Date.now() - 86_400_000).toISOString();
  const endsAt = new Date(Date.now() + 86_400_000).toISOString();
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
