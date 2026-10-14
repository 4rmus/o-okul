import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
    // UAT F-13: teacher-backed Employee rows as created by the account-management backfill.
    await admin.query(
      `INSERT INTO "User" ("id", "tenantId", "name", "passwordHash", "updatedAt")
       VALUES ('invitation-accept-other-user', $1, 'Baska Hesap', 'FIXTURE_HASH', now())`,
      [tenantId],
    );
    await admin.query(
      `INSERT INTO "Employee" ("id", "tenantId", "userId", "firstName", "lastName", "status", "updatedAt")
       VALUES ('invitation-accept-teacher-employee', $1, NULL, 'Tcsiz', 'Ogretmen', 'ACTIVE', now()),
              ('invitation-accept-conflict-employee', $1, 'invitation-accept-other-user', 'Cakisan', 'Ogretmen', 'ACTIVE', now()),
              ('invitation-accept-legacy-employee', $1, NULL, 'Eski', 'Ogretmen', 'ACTIVE', now())`,
      [tenantId],
    );
    await admin.query(
      `INSERT INTO "Teacher" ("id", "tenantId", "employeeId", "userId", "firstName", "lastName", "updatedAt")
       VALUES ('invitation-accept-teacher', $1, 'invitation-accept-teacher-employee', NULL, 'Tcsiz', 'Ogretmen', now()),
              ('invitation-accept-conflict-teacher', $1, 'invitation-accept-conflict-employee', NULL, 'Cakisan', 'Ogretmen', now()),
              ('invitation-accept-legacy-teacher', $1, 'invitation-accept-legacy-employee', 'invitation-accept-other-user', 'Eski', 'Ogretmen', now())`,
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
    await seedInvitation(admin, "TEACHER", "invitation-accept-conflict-teacher", "f13.cakisan@example.test", "TEACHER", "conflict-teacher");
    await seedInvitation(admin, "EMPLOYEE", "invitation-accept-legacy-employee", "f13.eski@example.test", "OPERATIONS_STAFF", "legacy-employee");
    await seedExistingAccounts(admin);
    await seedInvitation(admin, "TEACHER", "f16-teacher", "f16.veli@example.test", "TEACHER", "f16-guardian-teacher");
    await seedInvitation(admin, "TEACHER", "f16-teacher-2", "f16.ogrenci@example.test", "TEACHER", "f16-student-teacher");
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

  it("öğretmen daveti kabulü bağlı çalışan kaydını aynı hesaba bağlar (UAT F-13)", async () => {
    const teacher = await admin.query<{ userId: string | null }>(`SELECT "userId" FROM "Teacher" WHERE "id" = 'invitation-accept-teacher'`);
    const employee = await admin.query<{ userId: string | null }>(`SELECT "userId" FROM "Employee" WHERE "id" = 'invitation-accept-teacher-employee'`);
    expect(teacher.rows[0]?.userId).toEqual(expect.any(String));
    expect(employee.rows[0]?.userId).toBe(teacher.rows[0]?.userId);
  });

  it("başka hesaba bağlı çalışan kaydını öğretmen kabulünde ezmez (UAT F-13)", async () => {
    const accepted = await service.accept({ token: tokenFor("conflict-teacher"), password });

    expect(accepted).toMatchObject({ status: "ACCEPTED", subjectId: "invitation-accept-conflict-teacher" });
    const employee = await admin.query<{ userId: string | null }>(`SELECT "userId" FROM "Employee" WHERE "id" = 'invitation-accept-conflict-employee'`);
    expect(employee.rows[0]?.userId).toBe("invitation-accept-other-user");
    await expectNoActivity(admin);
  });

  it("öğretmeni hesaplı çalışan kaydına ikinci hesap daveti ve kabulü yok (UAT F-13)", async () => {
    const context = { tenantId, userId: "invitation-accept-admin", roles: ["TENANT_ADMIN" as const], bypassRls: false };
    await expect(service.createEmployeeInvitation(context, "invitation-accept-legacy-employee", { email: "f13.yeni@example.test", role: "OPERATIONS_STAFF" }))
      .rejects.toThrow("EMPLOYEE_ALREADY_LINKED_VIA_TEACHER");
    // An invitation issued before the guard existed is refused at accept and no second account is created.
    await expect(service.accept({ token: tokenFor("legacy-employee"), password })).rejects.toThrow("EMPLOYEE_ALREADY_LINKED");
    const users = await admin.query(`SELECT 1 FROM "User" WHERE "tenantId" = $1 AND "emailNormalized" = 'f13.eski@example.test'`, [tenantId]);
    expect(users.rows).toEqual([]);
    const employee = await admin.query<{ userId: string | null }>(`SELECT "userId" FROM "Employee" WHERE "id" = 'invitation-accept-legacy-employee'`);
    expect(employee.rows[0]?.userId).toBeNull();
  });

  it("veli hesabı öğretmen davetini kabul edince veli üyeliği ve bağları kalır (UAT F-16, KV-3b)", async () => {
    const accepted = await service.accept({ token: tokenFor("f16-guardian-teacher"), password });

    expect(accepted).toMatchObject({ status: "ACCEPTED", subjectId: "f16-teacher", acceptedUserId: "f16-guardian-user" });
    const memberships = await admin.query<{ role: string; status: string; hasTeacherPersona: boolean; version: number }>(
      `SELECT "role"::text AS role, "status", "hasTeacherPersona", "version"
       FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = 'f16-guardian-user' ORDER BY "role"`,
      [tenantId],
    );
    expect(memberships.rows).toEqual([
      { role: "GUARDIAN", status: "ACTIVE", hasTeacherPersona: false, version: 2 },
      { role: "TEACHER", status: "ACTIVE", hasTeacherPersona: true, version: 2 },
    ]);
    const guardian = await admin.query(`SELECT "userId" FROM "Guardian" WHERE "id" = 'f16-guardian'`);
    expect(guardian.rows).toEqual([{ userId: "f16-guardian-user" }]);
    const links = await admin.query(`SELECT "studentId" FROM "GuardianStudent" WHERE "guardianId" = 'f16-guardian'`);
    expect(links.rows).toEqual([{ studentId: "f16-child" }]);
    const teacher = await admin.query(`SELECT "userId" FROM "Teacher" WHERE "id" = 'f16-teacher'`);
    expect(teacher.rows).toEqual([{ userId: "f16-guardian-user" }]);
    const sessions = await admin.query(`SELECT "status" FROM "AuthSession" WHERE "userId" = 'f16-guardian-user'`);
    expect(sessions.rows).toEqual([{ status: "REVOKED" }]);
    await expectNoActivity(admin);
  });

  it("öğrenci hesabının e-postasıyla öğretmen davetini 4xx ile reddeder ve öğrenci üyeliğine dokunmaz (UAT F-16)", async () => {
    await expect(service.accept({ token: tokenFor("f16-student-teacher"), password }))
      .rejects.toThrow("IDENTITY_INVITATION_EMAIL_ACCOUNT_INCOMPATIBLE");
    const memberships = await admin.query(
      `SELECT "role"::text AS role, "status" FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = 'f16-student-user'`,
      [tenantId],
    );
    expect(memberships.rows).toEqual([{ role: "STUDENT", status: "ACTIVE" }]);
    await expectNoActivity(admin);
  });

  it("T.C. kimliği olmayan öğrenci davetini 4xx ile reddeder ve activity satırı bırakmaz", async () => {
    await expect(service.accept({ token: tokenFor("STUDENT"), password })).rejects.toThrow("SUBJECT_NATIONAL_ID_REQUIRED");
    await expectNoActivity(admin);
    // A retry must get the same 4xx, not TENANT_ACTIVITY_UNRESOLVED.
    await expect(service.accept({ token: tokenFor("STUDENT"), password })).rejects.toThrow("SUBJECT_NATIONAL_ID_REQUIRED");
  });

  it("davet iptali bekleyen outbox satırını EXPIRED ve payload'sız bırakır, talep edilmiş satır UNCERTAIN olur (UAT F-03)", async () => {
    await admin.query(
      `INSERT INTO "Teacher" ("id", "tenantId", "firstName", "lastName", "updatedAt")
       VALUES ('invitation-accept-revoke-teacher', $1, 'Iptal', 'Ogretmen', now())`,
      [tenantId],
    );
    await seedInvitation(admin, "TEACHER", "invitation-accept-revoke-teacher", "f03.iptal@example.test", "TEACHER", "revoke-teacher");
    await admin.query(
      `INSERT INTO "SecretDeliveryOutbox" (
         "id", "tenantId", "purpose", "sourceId", "payloadEncrypted", "status", "attempts", "claimedAt", "claimToken", "expiresAt", "updatedAt"
       ) VALUES
         ('outbox-revoke-unclaimed', $1, 'IDENTITY_INVITATION', 'invitation-accept-revoke-teacher', 'encrypted-test-payload', 'PENDING', 0, NULL, NULL, now() + interval '1 day', now()),
         ('outbox-revoke-claimed', $1, 'IDENTITY_INVITATION', 'invitation-accept-revoke-teacher', 'encrypted-test-payload', 'PENDING', 1, now(), 'claim-token', now() + interval '1 day', now())`,
      [tenantId],
    );

    const revoked = await service.revoke({ tenantId, userId: "admin-f03", roles: ["TENANT_ADMIN"], bypassRls: false }, "invitation-accept-revoke-teacher");
    expect(revoked).toMatchObject({ id: "invitation-accept-revoke-teacher", status: "REVOKED" });
    expect(revoked).not.toHaveProperty("tokenHash");

    const invitation = await admin.query(`SELECT "status" FROM "IdentityInvitation" WHERE "id" = 'invitation-accept-revoke-teacher'`);
    expect(invitation.rows).toEqual([{ status: "REVOKED" }]);
    const outbox = await admin.query(
      `SELECT "id", "status", "payloadEncrypted", "claimToken" FROM "SecretDeliveryOutbox" WHERE "sourceId" = 'invitation-accept-revoke-teacher' ORDER BY "id"`,
    );
    expect(outbox.rows).toEqual([
      { id: "outbox-revoke-claimed", status: "UNCERTAIN", payloadEncrypted: null, claimToken: "claim-token" },
      { id: "outbox-revoke-unclaimed", status: "EXPIRED", payloadEncrypted: null, claimToken: null },
    ]);
    await expect(service.accept({ token: tokenFor("revoke-teacher"), password })).rejects.toThrow("IDENTITY_INVITATION_NOT_PENDING");
    // A second revoke is refused; the row stays REVOKED and no activity row is opened.
    await expect(service.revoke({ tenantId, userId: "admin-f03", roles: ["TENANT_ADMIN"], bypassRls: false }, "invitation-accept-revoke-teacher"))
      .rejects.toThrow("IDENTITY_INVITATION_NOT_PENDING");
  });

  it("kabul sırasında iptal edilen davette öğretmen bağı PostgreSQL'de geri alınır (UAT F-03 inceleme)", async () => {
    await admin.query(
      `INSERT INTO "Teacher" ("id", "tenantId", "firstName", "lastName", "updatedAt")
       VALUES ('invitation-accept-race-teacher', $1, 'Yaris', 'Ogretmen', now())`,
      [tenantId],
    );
    await seedInvitation(admin, "TEACHER", "invitation-accept-race-teacher", "f03.yaris@example.test", "TEACHER", "race-teacher");
    const store = (service as unknown as { invitations: PostgresIdentityInvitationStore }).invitations;
    const markAccepted = store.markAccepted.bind(store);
    const spy = vi.spyOn(store, "markAccepted").mockImplementation(async (id, userId, acceptedAt) => {
      await service.revoke({ tenantId, userId: "admin-f03", roles: ["TENANT_ADMIN"], bypassRls: false }, "invitation-accept-race-teacher");
      return markAccepted(id, userId, acceptedAt);
    });
    try {
      await expect(service.accept({ token: tokenFor("race-teacher"), password })).rejects.toThrow("IDENTITY_INVITATION_NOT_PENDING");
    } finally {
      spy.mockRestore();
    }
    const teacher = await admin.query(`SELECT "userId" FROM "Teacher" WHERE "id" = 'invitation-accept-race-teacher'`);
    expect(teacher.rows).toEqual([{ userId: null }]);
    const invitation = await admin.query(`SELECT "status" FROM "IdentityInvitation" WHERE "id" = 'invitation-accept-race-teacher'`);
    expect(invitation.rows).toEqual([{ status: "REVOKED" }]);
    // The refusal is a known, compensated outcome: no UNCERTAIN activity row is left behind.
    await expectNoActivity(admin);
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

// UAT F-16: an existing guardian account (profile, student link, open session) and an existing student account.
async function seedExistingAccounts(pool: pg.Pool): Promise<void> {
  await pool.query(
    `INSERT INTO "User" ("id", "tenantId", "name", "email", "emailNormalized", "passwordHash", "updatedAt")
     VALUES ('f16-guardian-user', $1, 'F16 Veli', 'f16.veli@example.test', 'f16.veli@example.test', 'FIXTURE_HASH', now()),
            ('f16-student-user', $1, 'F16 Ogrenci', 'f16.ogrenci@example.test', 'f16.ogrenci@example.test', 'FIXTURE_HASH', now())`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "hasStudentPersona", "updatedAt")
     VALUES ('f16-guardian-membership', $1, 'f16-guardian-user', 'GUARDIAN', false, now()),
            ('f16-student-membership', $1, 'f16-student-user', 'STUDENT', true, now())`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO "AuthSession" ("id", "tenantId", "userId", "tokenFamilyId", "refreshTokenHash", "roles", "membershipVersion", "expiresAt", "updatedAt")
     VALUES ('f16-guardian-session', $1, 'f16-guardian-user', 'f16-family', 'f16-refresh-hash', ARRAY['GUARDIAN'], 1, now() + interval '1 day', now())`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO "Guardian" ("id", "tenantId", "userId", "firstName", "lastName", "updatedAt")
     VALUES ('f16-guardian', $1, 'f16-guardian-user', 'F16', 'Veli', now())`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "status", "updatedAt")
     VALUES ('f16-child', $1, 'F16-1', 'F16', 'Cocuk', 'ACTIVE', now())`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO "GuardianStudent" ("id", "tenantId", "guardianId", "studentId", "updatedAt") VALUES ('f16-link', $1, 'f16-guardian', 'f16-child', now())`,
    [tenantId],
  );
  await pool.query(
    `INSERT INTO "Teacher" ("id", "tenantId", "firstName", "lastName", "updatedAt")
     VALUES ('f16-teacher', $1, 'F16', 'Ogretmen', now()), ('f16-teacher-2', $1, 'F16', 'Ogretmen Iki', now())`,
    [tenantId],
  );
}

async function seedInvitation(
  pool: pg.Pool,
  subjectType: string,
  subjectId: string,
  email: string,
  role = subjectType,
  key = subjectType,
): Promise<void> {
  await pool.query(
    `INSERT INTO "IdentityInvitation" (
       "id", "tenantId", "subjectType", "subjectId", "email", "name", "role", "kind",
       "tokenHash", "status", "expiresAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, $5, 'F08 Davet', $6, 'EMAIL_LINK', $7, 'PENDING', now() + interval '1 day', now())`,
    [`invitation-accept-${key.toLowerCase()}`, tenantId, subjectType, subjectId, email, role, hashActivationToken(tokenFor(key))],
  );
}
