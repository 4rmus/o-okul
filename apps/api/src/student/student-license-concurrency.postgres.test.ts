import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresStudentStore } from "./student-store.js";

const appDatabaseUrl = process.env.STUDENT_LICENSE_POSTGRES_TEST_URL;
const adminDatabaseUrl = process.env.STUDENT_LICENSE_POSTGRES_ADMIN_URL;
const postgresRequired = process.env.ACCOUNT_MANAGEMENT_POSTGRES_REQUIRED === "1";

if (postgresRequired && (!appDatabaseUrl || !adminDatabaseUrl)) {
  throw new Error("STUDENT_LICENSE_POSTGRES_URLS_REQUIRED");
}

const describePostgres = appDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;
const tenantAId = "student-license-tenant-a";
const tenantBId = "student-license-tenant-b";
const tenantIds = [tenantAId, tenantBId];

describePostgres("PostgresStudentStore license concurrency integration", () => {
  const admin = new pg.Pool({ connectionString: adminDatabaseUrl });
  const app = new pg.Pool({ connectionString: appDatabaseUrl, max: 3 });
  const store = new PostgresStudentStore(app);
  const startsAt = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    await cleanupFixtures(admin);
    await seedTenant(admin, tenantAId, "student-license-a", 2);
    await seedTenant(admin, tenantBId, "student-license-b", 2);
    await createActiveStudent(store, tenantAId, "100", "Ada");
    await createActiveStudent(store, tenantBId, "200", "Bora");
  });

  afterAll(async () => {
    await cleanupFixtures(admin);
    await Promise.all([admin.end(), app.end()]);
  });

  it("son aktif öğrenci hakkı için iki paralel kayıttan yalnız birini kabul eder ve peak değerini tenant bazında korur", async () => {
    const outcomes = await Promise.allSettled([
      createActiveStudent(store, tenantAId, "101", "Cem"),
      createActiveStudent(store, tenantAId, "102", "Deniz"),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0]?.reason?.message ?? rejected[0]?.reason)).toContain("ACTIVE_STUDENT_LIMIT_REACHED");

    const usage = await admin.query<{
      activeStudentCount: number;
      peakActiveStudentCount: number;
      tenantId: string;
    }>(
      `SELECT "tenantId", "activeStudentCount", "peakActiveStudentCount"
       FROM "LicenseUsage"
       WHERE "tenantId" = ANY($1::text[])
         AND "usageDate" = timezone('UTC', now())::date
       ORDER BY "tenantId"`,
      [tenantIds],
    );
    expect(usage.rows).toEqual([
      { tenantId: tenantAId, activeStudentCount: 2, peakActiveStudentCount: 2 },
      { tenantId: tenantBId, activeStudentCount: 1, peakActiveStudentCount: 1 },
    ]);

    const tenantAStudents = await listStudents(store, tenantAId);
    const tenantBStudents = await listStudents(store, tenantBId);
    expect(tenantAStudents).toHaveLength(2);
    expect(tenantAStudents.every((student) => student.tenantId === tenantAId)).toBe(true);
    expect(tenantBStudents).toHaveLength(1);
    expect(tenantBStudents[0]?.tenantId).toBe(tenantBId);
  });

  function createActiveStudent(storeInstance: PostgresStudentStore, tenantId: string, studentNo: string, firstName: string) {
    return runWithRequestContext(requestContext(tenantId), () => storeInstance.createWithEnrollment(
      { tenantId, studentNo, firstName, lastName: "Test" },
      { status: "ACTIVE", startsAt, reason: "POSTGRES_CONCURRENCY_TEST" },
    ));
  }
});

function listStudents(store: PostgresStudentStore, tenantId: string) {
  return runWithRequestContext(requestContext(tenantId), () => store.list());
}

function requestContext(tenantId: string) {
  return {
    userId: "student-license-test-user",
    tenantId,
    roles: ["TENANT_ADMIN"],
    bypassRls: false,
  };
}

async function cleanupFixtures(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM "Tenant" WHERE "id" = ANY($1::text[])`, [tenantIds]);
}

async function seedTenant(pool: pg.Pool, tenantId: string, slug: string, activeStudentLimit: number): Promise<void> {
  await pool.query(
    `INSERT INTO "Tenant" (
       "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status", "updatedAt"
     ) VALUES ($1, $2, $3, 'TEST', now() - interval '1 day', now() + interval '1 day', $4, 'ACTIVE', now())`,
    [tenantId, tenantId, slug, activeStudentLimit],
  );
  await pool.query(
    `INSERT INTO "LicenseTerm" (
       "id", "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit", "updatedAt"
     ) VALUES ($1, $2, 'TEST', now() - interval '1 day', now() + interval '1 day', $3, now())`,
    [`license-${tenantId}`, tenantId, activeStudentLimit],
  );
}
