import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { closeTenantMutationPool } from "../context/tenant-mutation-activity.js";
import { PostgresGuardianStore } from "../school/guardian-store.js";
import { PostgresTeacherStore } from "../school/teacher-store.js";
import { PostgresStudentStore } from "../student/student-store.js";
import { InMemoryTenantStore } from "../tenant/tenant-store.js";
import { PostgresUserManagementStore } from "../user-management/user-management-store.js";
import { PostgresEmployeeAccountActivationStore } from "./employee-account-activation-store.js";
import { PostgresIdentityInvitationStore } from "./identity-invitation-store.js";
import { IdentityInvitationService, hashActivationToken } from "./identity-invitation.service.js";

// UAT F-08: the accept endpoint is unauthenticated, so there is no request context or tenant.
// Subject lookups must use the invitation's tenant explicitly instead of the request context.
const appDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_TEST_URL;
const adminDatabaseUrl = process.env.EMPLOYEE_ACTIVATION_POSTGRES_ADMIN_URL;
const postgresRequired = process.env.ACCOUNT_MANAGEMENT_POSTGRES_REQUIRED === "1";

if (postgresRequired && (!appDatabaseUrl || !adminDatabaseUrl)) {
  throw new Error("EMPLOYEE_ACTIVATION_POSTGRES_URLS_REQUIRED");
}

const describePostgres = appDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;
const tenantId = "invitation-accept-tenant-a";
const password = "Secure-password-123";

describePostgres("IdentityInvitationService.accept on PostgreSQL without request context", () => {
  const admin = new pg.Pool({ connectionString: adminDatabaseUrl });
  const app = new pg.Pool({ connectionString: appDatabaseUrl });
  const previousEnv = { TENANT_STORE: process.env.TENANT_STORE, DATABASE_URL: process.env.DATABASE_URL };
  const teachers = new PostgresTeacherStore(app);
  const guardians = new PostgresGuardianStore(app);
  const students = new PostgresStudentStore(app);
  const service = new IdentityInvitationService(
    new PostgresIdentityInvitationStore(app),
    new PostgresUserManagementStore(app),
    students,
    guardians,
    teachers,
    new InMemoryTenantStore(),
    undefined,
    new PostgresEmployeeAccountActivationStore(app, 10),
  );

  beforeAll(async () => {
    // Exercise the real TenantMutationActivity admission, as production does.
    process.env.TENANT_STORE = "postgres";
    process.env.DATABASE_URL = appDatabaseUrl;
    await cleanupFixtures(admin);
    await seedTenant(admin);
    await admin.query(
      `INSERT INTO "Teacher" ("id", "tenantId", "firstName", "lastName", "updatedAt")
       VALUES ('invitation-accept-teacher', $1, 'Tcsiz', 'Ogretmen', now())`,
      [tenantId],
    );
    await admin.query(
      `INSERT INTO "Guardian" ("id", "tenantId", "firstName", "lastName", "updatedAt")
       VALUES ('invitation-accept-guardian', $1, 'Tcsiz', 'Veli', now())`,
      [tenantId],
    );
    await admin.query(
      `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "status", "updatedAt")
       VALUES ('invitation-accept-student', $1, 'F08-1', 'Tcsiz', 'Ogrenci', 'ACTIVE', now())`,
      [tenantId],
    );
    await admin.query(
      `INSERT INTO "Employee" ("id", "tenantId", "firstName", "lastName", "status", "updatedAt")
       VALUES ('invitation-accept-employee', $1, 'Planli', 'Calisan', 'PLANNED', now())`,
      [tenantId],
    );
    await seedInvitation(admin, "EMPLOYEE", "invitation-accept-employee", "f08.calisan@example.test", "OPERATIONS_STAFF");
    await seedInvitation(admin, "TEACHER", "invitation-accept-teacher", "f08.ogretmen@example.test");
    await seedInvitation(admin, "GUARDIAN", "invitation-accept-guardian", "f08.veli@example.test");
    await seedInvitation(admin, "STUDENT", "invitation-accept-student", "f08.ogrenci@example.test");
  });

  afterAll(async () => {
    await cleanupFixtures(admin);
    await closeTenantMutationPool();
    await Promise.all([admin.end(), app.end()]);
    restoreEnv("TENANT_STORE", previousEnv.TENANT_STORE);
    restoreEnv("DATABASE_URL", previousEnv.DATABASE_URL);
  });

  it.each([
    ["TEACHER", "Teacher", "invitation-accept-teacher"],
    ["GUARDIAN", "Guardian", "invitation-accept-guardian"],
  ] as const)("%s davetini T.C. kimlik olmadan kabul eder ve profile bağlar", async (subjectType, table, subjectId) => {
    const accepted = await service.accept({ token: tokenFor(subjectType), password });

    expect(accepted).toMatchObject({ status: "ACCEPTED", subjectType, subjectId, acceptedUserId: expect.any(String) });
    const bound = await admin.query<{ userId: string | null }>(`SELECT "userId" FROM "${table}" WHERE "id" = $1`, [subjectId]);
    expect(bound.rows[0]?.userId).toBe(accepted.acceptedUserId);
    await expectNoActivity(admin);
  });

  it("T.C. kimliği olmayan öğrenci davetini 4xx ile reddeder ve activity satırı bırakmaz", async () => {
    await expect(service.accept({ token: tokenFor("STUDENT"), password })).rejects.toThrow("SUBJECT_NATIONAL_ID_REQUIRED");
    await expectNoActivity(admin);
    // A retry must get the same 4xx, not TENANT_ACTIVITY_UNRESOLVED.
    await expect(service.accept({ token: tokenFor("STUDENT"), password })).rejects.toThrow("SUBJECT_NATIONAL_ID_REQUIRED");
  });

  it("çalışan aktivasyonunun reddedilen sonucu activity satırı bırakmaz", async () => {
    await expect(service.accept({ token: tokenFor("EMPLOYEE"), password })).rejects.toThrow("EMPLOYEE_INVITATION_REQUIRES_ACTIVE_PROFILE");
    await expectNoActivity(admin);
    // The store revoked the invitation in a committed transaction; a retry sees that, not TENANT_ACTIVITY_UNRESOLVED.
    await expect(service.accept({ token: tokenFor("EMPLOYEE"), password })).rejects.toThrow("IDENTITY_INVITATION_NOT_PENDING");
  });
});

function tokenFor(subjectType: string): string {
  return `invitation-accept-token-${subjectType.toLowerCase()}`;
}

function restoreEnv(key: "TENANT_STORE" | "DATABASE_URL", value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

async function expectNoActivity(pool: pg.Pool): Promise<void> {
  const activity = await pool.query(`SELECT "status" FROM "TenantMutationActivity" WHERE "tenantId" = $1`, [tenantId]);
  expect(activity.rows).toEqual([]);
}

async function cleanupFixtures(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM "SecretDeliveryOutbox" WHERE "tenantId" = $1`, [tenantId]);
  // A failing run may leave UNCERTAIN rows, which block the tenant delete.
  await pool.query(`DELETE FROM "TenantMutationActivity" WHERE "tenantId" = $1`, [tenantId]);
  await pool.query(`DELETE FROM "Tenant" WHERE "id" = $1`, [tenantId]);
}

async function seedTenant(pool: pg.Pool): Promise<void> {
  const startsAt = new Date(Date.now() - 86_400_000).toISOString();
  const endsAt = new Date(Date.now() + 86_400_000).toISOString();
  await pool.query(
    `INSERT INTO "Tenant" (
       "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status", "updatedAt"
     ) VALUES ($1, $1, 'invitation-accept-a', 'TEST', $2, $3, 10, 'ACTIVE', now())`,
    [tenantId, startsAt, endsAt],
  );
  await pool.query(
    `INSERT INTO "LicenseTerm" (
       "id", "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit", "updatedAt"
     ) VALUES ($1, $2, 'TEST', $3, $4, 10, now())`,
    [`license-${tenantId}`, tenantId, startsAt, endsAt],
  );
}

async function seedInvitation(pool: pg.Pool, subjectType: string, subjectId: string, email: string, role = subjectType): Promise<void> {
  await pool.query(
    `INSERT INTO "IdentityInvitation" (
       "id", "tenantId", "subjectType", "subjectId", "email", "name", "role", "kind",
       "tokenHash", "status", "expiresAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, $5, 'F08 Davet', $6, 'EMAIL_LINK', $7, 'PENDING', now() + interval '1 day', now())`,
    [`invitation-accept-${subjectType.toLowerCase()}`, tenantId, subjectType, subjectId, email, role, hashActivationToken(tokenFor(subjectType))],
  );
}
