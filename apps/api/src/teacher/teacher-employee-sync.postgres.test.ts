import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { PostgresTeacherStore } from "../school/teacher-store.js";

// DEC-20261102-08: a teacher's Employee row is created or reused in the teacher's transaction, follows teacher updates,
// is ended (never deleted) with the teacher and is purged with the teacher's personal data. Runs as the restricted app
// role so RLS applies; the admin pool only seeds fixtures and reads the result.
const appUrl = process.env.TEACHER_EMPLOYEE_POSTGRES_TEST_URL, adminUrl = process.env.TEACHER_EMPLOYEE_POSTGRES_ADMIN_URL;
if (process.env.TEACHER_EMPLOYEE_POSTGRES_REQUIRED === "1" && (!appUrl || !adminUrl)) throw new Error("TEACHER_EMPLOYEE_POSTGRES_URLS_REQUIRED");
for (const value of [appUrl, adminUrl].filter(Boolean)) {
  const url = new URL(value!);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !(url.pathname === "/o_okul_teacher_employee_test" || (process.env.GITHUB_ACTIONS === "true" && url.pathname === "/o_okul"))) {
    throw new Error("DISPOSABLE_POSTGRES_REQUIRED");
  }
}

const run = appUrl && adminUrl ? describe : describe.skip;

interface EmployeeRow {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  nationalIdEncrypted: string | null;
  nationalIdHash: string | null;
  workEmail: string | null;
  userId: string | null;
  status: string;
  employmentEndsAt: string | null;
  endedReason: string | null;
  deletedAt: Date | null;
}

run("teacher -> Employee sync on PostgreSQL with the app role and RLS", () => {
  const app = new pg.Pool({ connectionString: appUrl }), admin = new pg.Pool({ connectionString: adminUrl });
  const store = new PostgresTeacherStore(app);
  const [tenantA, tenantB] = ["a", "b"].map((suffix) => `teacher-employee-${randomUUID()}-${suffix}`) as [string, string];
  const id = (tenant: string, name: string) => `${tenant}-${name}`;
  const asAdmin = <T>(tenantId: string, work: () => Promise<T>) => runWithRequestContext(
    { userId: "fixture-admin", tenantId, roles: ["TENANT_ADMIN"], bypassRls: false } satisfies RequestContext,
    work,
  );
  const employee = async (employeeId: string) =>
    (await admin.query<EmployeeRow>(
      `SELECT "id", "tenantId", "firstName", "lastName", "phone", "nationalIdEncrypted", "nationalIdHash", "workEmail", "userId",
              "status", to_char("employmentEndsAt", 'YYYY-MM-DD') AS "employmentEndsAt", "endedReason", "deletedAt"
       FROM "Employee" WHERE "id" = $1`,
      [employeeId],
    )).rows[0];
  const linkedEmployeeId = async (teacherId: string) =>
    (await admin.query<{ employeeId: string | null }>(`SELECT "employeeId" FROM "Teacher" WHERE "id" = $1`, [teacherId])).rows[0]?.employeeId ?? null;
  const backfillId = async (tenantId: string, teacherId: string) =>
    (await admin.query<{ id: string }>(`SELECT 'employee-' || md5($1::text || ':' || $2::text) AS id`, [tenantId, teacherId])).rows[0]!.id;
  const employeeCount = async (tenantId: string) =>
    (await admin.query<{ count: number }>(`SELECT count(*)::int AS count FROM "Employee" WHERE "tenantId" = $1`, [tenantId])).rows[0]!.count;

  beforeAll(async () => {
    for (const tenant of [tenantA, tenantB]) {
      const t = (name: string) => id(tenant, name);
      await admin.query(`INSERT INTO "Tenant" (id, slug, name, status, "updatedAt") VALUES ($1, $1, 'Teacher employee fixture', 'ACTIVE', now())`, [tenant]);
      await admin.query(
        `INSERT INTO "User" ("id", "tenantId", "name", "email", "passwordHash", "updatedAt")
         VALUES ($1, $3, 'Hesap Ogretmen', $1 || '@example.test', 'FIXTURE_HASH', now()),
                ($2, $3, 'Yonetici Ogretmen', $2 || '@example.test', 'FIXTURE_HASH', now())`,
        [t("user-account"), t("user-staff"), tenant],
      );
      // HR-created Employee rows the teacher create must reuse instead of duplicating.
      await admin.query(
        `INSERT INTO "Employee" ("id", "tenantId", "firstName", "lastName", "nationalIdEncrypted", "nationalIdHash", "workEmail", "userId", "status", "employmentStartsAt", "updatedAt")
         VALUES ($1, $5, 'Ik', 'Kaydi', 'enc-hr', $6, 'ik@example.test', NULL, 'ACTIVE', NULL, now()),
                ($2, $5, 'Hesapli', 'Calisan', NULL, NULL, NULL, $7, 'ACTIVE', NULL, now()),
                ($3, $5, 'Bagli', 'Calisan', 'enc-taken', $8, NULL, NULL, 'ACTIVE', NULL, now()),
                ($4, $5, 'Yonetici', 'Calisan', NULL, NULL, NULL, $9, 'ACTIVE', NULL, now())`,
        [t("employee-hr"), t("employee-account"), t("employee-taken"), t("employee-staff"), tenant, t("hash-hr"), t("user-account"), t("hash-taken"), t("user-staff")],
      );
      await admin.query(
        `INSERT INTO "Teacher" ("id", "tenantId", "employeeId", "firstName", "lastName", "updatedAt")
         VALUES ($1, $2, $3, 'Eski', 'Ogretmen', now())`,
        [t("teacher-taken"), tenant, t("employee-taken")],
      );
      await admin.query(
        `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "status", "scopeMode", "version", "updatedAt")
         VALUES ($1, $2, $3, 'TENANT_ADMIN', 'TENANT_ADMIN', true, 'ACTIVE', 'TENANT', 1, now())`,
        [t("membership-staff"), tenant, t("user-staff")],
      );
      await admin.query(
        `INSERT INTO "Teacher" ("id", "tenantId", "employeeId", "userId", "firstName", "lastName", "updatedAt")
         VALUES ($1, $2, $3, $4, 'Yonetici', 'Ogretmen', now())`,
        [t("teacher-staff"), tenant, t("employee-staff"), t("user-staff")],
      );
    }
  });

  afterAll(async () => {
    await Promise.all([app.end(), admin.end()]);
  });

  it("creates the linked Employee with the backfill id scheme when nothing matches", async () => {
    const teacher = await asAdmin(tenantA, () => store.create({
      tenantId: tenantA, firstName: "Yeni", lastName: "Ogretmen", phone: "5550000001", nationalIdEncrypted: "enc-new", nationalIdHash: id(tenantA, "hash-new"),
    }));

    const employeeId = await linkedEmployeeId(teacher.id);
    expect(employeeId).toBe(await backfillId(tenantA, teacher.id));
    expect(await employee(employeeId!)).toMatchObject({
      tenantId: tenantA, firstName: "Yeni", lastName: "Ogretmen", phone: "5550000001",
      nationalIdEncrypted: "enc-new", nationalIdHash: id(tenantA, "hash-new"), status: "ACTIVE", userId: null,
    });
  });

  it("reuses an Employee by account first, then by national ID, and never duplicates", async () => {
    const before = await employeeCount(tenantA);
    const byHash = await asAdmin(tenantA, () => store.create({
      tenantId: tenantA, firstName: "Ik", lastName: "Kaydi", nationalIdEncrypted: "enc-hr", nationalIdHash: id(tenantA, "hash-hr"),
    }));
    expect(await linkedEmployeeId(byHash.id)).toBe(id(tenantA, "employee-hr"));

    // The account match wins over a national ID match.
    const byAccount = await asAdmin(tenantB, () => store.create({
      tenantId: tenantB, firstName: "Hesapli", lastName: "Ogretmen", userId: id(tenantB, "user-account"),
      nationalIdEncrypted: "enc-hr", nationalIdHash: id(tenantB, "hash-hr"),
    }));
    expect(await linkedEmployeeId(byAccount.id)).toBe(id(tenantB, "employee-account"));
    expect(await employeeCount(tenantA)).toBe(before);
  });

  it("does not take over an Employee linked to another teacher and adds no conflicting row", async () => {
    const before = await employeeCount(tenantA);
    const teacher = await asAdmin(tenantA, () => store.create({
      tenantId: tenantA, firstName: "Ayni", lastName: "Kimlik", nationalIdEncrypted: "enc-taken", nationalIdHash: id(tenantA, "hash-taken"),
    }));

    expect(await linkedEmployeeId(teacher.id)).toBeNull();
    expect(await linkedEmployeeId(id(tenantA, "teacher-taken"))).toBe(id(tenantA, "employee-taken"));
    expect(await employeeCount(tenantA)).toBe(before);
  });

  it("mirrors name, phone and national ID onto the linked Employee and rejects a national ID another Employee holds", async () => {
    const teacher = await asAdmin(tenantA, () => store.create({ tenantId: tenantA, firstName: "Guncel", lastName: "Degil" }));
    const employeeId = (await linkedEmployeeId(teacher.id))!;
    await admin.query(`UPDATE "Employee" SET "workEmail" = 'is@example.test' WHERE "id" = $1`, [employeeId]);

    await asAdmin(tenantA, () => store.update(teacher.id, {
      lastName: "Guncel", phone: "5550000002", nationalIdEncrypted: "enc-mirror", nationalIdHash: id(tenantA, "hash-mirror"),
    }));
    expect(await employee(employeeId)).toMatchObject({
      firstName: "Guncel", lastName: "Guncel", phone: "5550000002", nationalIdEncrypted: "enc-mirror",
      nationalIdHash: id(tenantA, "hash-mirror"), workEmail: "is@example.test",
    });

    await asAdmin(tenantA, () => store.update(teacher.id, { branch: "Fizik" }));
    expect(await employee(employeeId)).toMatchObject({ phone: "5550000002", nationalIdHash: id(tenantA, "hash-mirror") });

    await expect(asAdmin(tenantA, () => store.update(teacher.id, {
      firstName: "Cakisma", nationalIdEncrypted: "enc-hr", nationalIdHash: id(tenantA, "hash-taken"),
    }))).rejects.toThrow("TEACHER_NATIONAL_ID_CONFLICT");
    const rolledBack = await admin.query<{ firstName: string; nationalIdHash: string | null }>(
      `SELECT "firstName", "nationalIdHash" FROM "Teacher" WHERE "id" = $1`,
      [teacher.id],
    );
    expect(rolledBack.rows[0]).toEqual({ firstName: "Guncel", nationalIdHash: id(tenantA, "hash-mirror") });
  });

  it("ends the linked Employee when the teacher is deleted, keeps staff access, and is idempotent", async () => {
    const teacher = await asAdmin(tenantA, () => store.create({ tenantId: tenantA, firstName: "Silinen", lastName: "Ogretmen" }));
    const employeeId = (await linkedEmployeeId(teacher.id))!;
    // A start dated on the deletion day must still satisfy Employee_dates_check.
    await admin.query(`UPDATE "Employee" SET "employmentStartsAt" = '2026-11-02' WHERE "id" = $1`, [employeeId]);
    await admin.query(`UPDATE "Teacher" SET "deletedAt" = now() WHERE "id" = $1`, [teacher.id]);

    await expect(store.endLinkedEmployee(tenantA, teacher.id, "2026-11-02T10:00:00.000Z")).resolves.toBe("ENDED");
    expect(await employee(employeeId)).toMatchObject({ status: "ENDED", endedReason: "TEACHER_DELETED", employmentEndsAt: "2026-11-03", deletedAt: null });
    await expect(store.endLinkedEmployee(tenantA, teacher.id, "2026-11-02T10:00:00.000Z")).resolves.toBe("ALREADY_ENDED");

    await expect(store.endLinkedEmployee(tenantA, id(tenantA, "teacher-staff"), "2026-11-02T10:00:00.000Z")).resolves.toBe("STAFF_ACCESS_KEPT");
    expect(await employee(id(tenantA, "employee-staff"))).toMatchObject({ status: "ACTIVE", endedReason: null });
  });

  it("purges the teacher and the linked Employee's personal fields together", async () => {
    const teacher = await asAdmin(tenantA, () => store.create({
      tenantId: tenantA, firstName: "Imha", lastName: "Edilen", phone: "5550000003", nationalIdEncrypted: "enc-purge", nationalIdHash: id(tenantA, "hash-purge"),
    }));
    const employeeId = (await linkedEmployeeId(teacher.id))!;
    await admin.query(`UPDATE "Employee" SET "workEmail" = 'imha@example.test' WHERE "id" = $1`, [employeeId]);

    const purged = await asAdmin(tenantA, () => store.purgePii(teacher.id));

    expect(purged).toMatchObject({ teacher: { firstName: "Anonim", lastName: "Ogretmen" }, employeeId });
    expect(purged?.teacher.nationalIdHash).toBeUndefined();
    expect(await employee(employeeId)).toMatchObject({
      firstName: "Anonim", lastName: "Ogretmen", phone: null, nationalIdEncrypted: null, nationalIdHash: null, workEmail: null,
    });
  });

  it("purges a deleted teacher and its ended Employee copy; only the purge path finds the deleted teacher", async () => {
    const teacher = await asAdmin(tenantA, () => store.create({
      tenantId: tenantA, firstName: "Silinmis", lastName: "Imha", phone: "5550000004", nationalIdEncrypted: "enc-deleted", nationalIdHash: id(tenantA, "hash-deleted"),
    }));
    const employeeId = (await linkedEmployeeId(teacher.id))!;
    await admin.query(`UPDATE "Employee" SET "workEmail" = 'silinmis@example.test' WHERE "id" = $1`, [employeeId]);
    await asAdmin(tenantA, () => store.softDelete(teacher.id, "2026-11-02T10:00:00.000Z"));
    await expect(store.endLinkedEmployee(tenantA, teacher.id, "2026-11-02T10:00:00.000Z")).resolves.toBe("ENDED");

    // Ordinary reads keep hiding the deleted teacher; the KVKK purge lookups see it, inside the request tenant only.
    await expect(asAdmin(tenantA, () => store.findById(teacher.id))).resolves.toBeUndefined();
    expect((await asAdmin(tenantA, () => store.list())).map((record) => record.id)).not.toContain(teacher.id);
    await expect(asAdmin(tenantA, () => store.update(teacher.id, { firstName: "Geri" }))).resolves.toBeUndefined();
    await expect(asAdmin(tenantA, () => store.findByIdForPiiPurge(teacher.id))).resolves.toMatchObject({ id: teacher.id, deletedAt: expect.any(String) });
    expect((await asAdmin(tenantA, () => store.listForPiiPurge())).map((record) => record.id)).toContain(teacher.id);
    await expect(asAdmin(tenantB, () => store.findByIdForPiiPurge(teacher.id))).resolves.toBeUndefined();
    expect((await asAdmin(tenantB, () => store.listForPiiPurge())).every((record) => record.tenantId === tenantB)).toBe(true);
    await expect(asAdmin(tenantB, () => store.purgePii(teacher.id))).resolves.toBeUndefined();

    const purged = await asAdmin(tenantA, () => store.purgePii(teacher.id));

    expect(purged).toMatchObject({ teacher: { id: teacher.id, firstName: "Anonim", lastName: "Ogretmen", deletedAt: expect.any(String) }, employeeId });
    expect(purged?.teacher.phone).toBeUndefined();
    expect(purged?.teacher.nationalIdHash).toBeUndefined();
    const teacherRow = await admin.query<{ firstName: string; lastName: string; phone: string | null; nationalIdEncrypted: string | null; nationalIdHash: string | null }>(
      `SELECT "firstName", "lastName", "phone", "nationalIdEncrypted", "nationalIdHash" FROM "Teacher" WHERE "id" = $1`,
      [teacher.id],
    );
    expect(teacherRow.rows[0]).toEqual({ firstName: "Anonim", lastName: "Ogretmen", phone: null, nationalIdEncrypted: null, nationalIdHash: null });
    expect(await employee(employeeId)).toMatchObject({
      firstName: "Anonim", lastName: "Ogretmen", phone: null, nationalIdEncrypted: null, nationalIdHash: null, workEmail: null,
      status: "ENDED", endedReason: "TEACHER_DELETED", deletedAt: null,
    });
  });

  it("keeps every step inside the request tenant", async () => {
    const tenantAEmployee = await employee(id(tenantA, "employee-staff"));

    // Tenant B's national ID equals no tenant A row: a tenant B Employee is created, tenant A's is untouched.
    const teacher = await asAdmin(tenantB, () => store.create({
      tenantId: tenantB, firstName: "Kiraci", lastName: "B", nationalIdEncrypted: "enc-hr", nationalIdHash: id(tenantA, "hash-hr"),
    }));
    const employeeId = await linkedEmployeeId(teacher.id);
    expect((await employee(employeeId!))?.tenantId).toBe(tenantB);
    expect(employeeId).toBe(await backfillId(tenantB, teacher.id));

    await expect(store.endLinkedEmployee(tenantB, id(tenantA, "teacher-staff"), "2026-11-02T10:00:00.000Z")).resolves.toBe("NO_EMPLOYEE");
    await expect(asAdmin(tenantB, () => store.purgePii(id(tenantA, "teacher-staff")))).resolves.toBeUndefined();
    await expect(asAdmin(tenantB, () => store.update(id(tenantA, "teacher-staff"), { firstName: "Sizinti" }))).resolves.toBeUndefined();
    expect(await employee(id(tenantA, "employee-staff"))).toEqual(tenantAEmployee);
  });
});
