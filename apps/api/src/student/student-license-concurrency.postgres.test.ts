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

// DEC-20261021-02 (20261022190000): INSERT refreshes license usage once per tenant per statement.
const statementTenantAId = "student-license-statement-a";
const statementTenantBId = "student-license-statement-b";
const statementNoTermTenantId = "student-license-statement-no-term";
const statementTenantIds = [statementTenantAId, statementTenantBId, statementNoTermTenantId];

describePostgres("license usage statement-level INSERT triggers", () => {
  const admin = new pg.Pool({ connectionString: adminDatabaseUrl });
  const app = new pg.Pool({ connectionString: appDatabaseUrl, max: 2 });
  const startsAt = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    await admin.query(`DELETE FROM "Tenant" WHERE "id" = ANY($1::text[])`, [statementTenantIds]);
    await seedTenant(admin, statementTenantAId, "student-license-statement-a", 3);
    await seedTenant(admin, statementTenantBId, "student-license-statement-b", 10);
    await admin.query(
      `INSERT INTO "Tenant" ("id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status", "updatedAt")
       VALUES ($1, $1, $1, 'TEST', now() - interval '1 day', now() + interval '1 day', 10, 'ACTIVE', now())`,
      [statementNoTermTenantId],
    );
  });

  afterAll(async () => {
    await admin.query(`DELETE FROM "Tenant" WHERE "id" = ANY($1::text[])`, [statementTenantIds]);
    await Promise.all([admin.end(), app.end()]);
  });

  it("limiti tek başına aşan çok satırlı unnest INSERT'ü P0001 ACTIVE_STUDENT_LIMIT_REACHED ile reddeder ve hiçbir satır bırakmaz", async () => {
    const ids = ["over-1", "over-2", "over-3", "over-4"].map((id) => `${statementTenantAId}-${id}`);
    const client = await app.connect();
    let failure: { code?: string; message?: string } | undefined;
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass_rls', 'false', true)");
      await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [statementTenantAId]);
      await insertStudents(client, statementTenantAId, ids);
      await insertEnrollments(client, statementTenantAId, ids, startsAt);
      await client.query("COMMIT");
    } catch (error) {
      failure = error as { code?: string; message?: string };
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }

    expect(failure).toMatchObject({ code: "P0001", message: "ACTIVE_STUDENT_LIMIT_REACHED" });
    const rows = await admin.query<{ students: number; enrollments: number; usage: number }>(
      `SELECT (SELECT count(*)::int FROM "Student" WHERE "tenantId" = $1) AS students,
              (SELECT count(*)::int FROM "StudentEnrollment" WHERE "tenantId" = $1) AS enrollments,
              (SELECT count(*)::int FROM "LicenseUsage" WHERE "tenantId" = $1) AS usage`,
      [statementTenantAId],
    );
    expect(rows.rows[0]).toEqual({ students: 0, enrollments: 0, usage: 0 });
  });

  it("iki tenant'a satır ekleyen tek statement LicenseUsage'ı her tenant için ayrı yeniler; LicenseTerm'süz tenant'ta no-op olur", async () => {
    const aIds = [`${statementTenantAId}-mixed-1`, `${statementTenantAId}-mixed-2`];
    const bIds = [`${statementTenantBId}-mixed-1`, `${statementTenantBId}-mixed-2`, `${statementTenantBId}-mixed-3`];
    const noTermIds = [`${statementNoTermTenantId}-mixed-1`];
    const all = [...aIds.map((id) => [statementTenantAId, id]), ...bIds.map((id) => [statementTenantBId, id]), ...noTermIds.map((id) => [statementNoTermTenantId, id])];
    // A cross-tenant writer runs with app.bypass_rls (as backfill/restore paths do); the SECURITY DEFINER refresh
    // reads LicenseTerm and Student under the same RLS settings, so without them it sees no term and does nothing.
    const client = await admin.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
      await client.query(
        `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "status", "updatedAt")
         SELECT input."id", input."tenantId", input."id", 'ÇOK', 'TENANT', 'ACTIVE', now()
         FROM unnest($1::text[], $2::text[]) AS input("tenantId", "id")`,
        [all.map(([tenantId]) => tenantId), all.map(([, id]) => id)],
      );
      await client.query(
        `INSERT INTO "StudentEnrollment" ("id", "tenantId", "studentId", "status", "startsAt", "reason", "updatedAt")
         SELECT input."id" || '-enrollment', input."tenantId", input."id", 'ACTIVE', $3::date, 'STATEMENT_TRIGGER_TEST', now()
         FROM unnest($1::text[], $2::text[]) AS input("tenantId", "id")`,
        [all.map(([tenantId]) => tenantId), all.map(([, id]) => id), startsAt],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    const usage = await admin.query<{ tenantId: string; activeStudentCount: number; peakActiveStudentCount: number }>(
      `SELECT "tenantId", "activeStudentCount", "peakActiveStudentCount"
       FROM "LicenseUsage"
       WHERE "tenantId" = ANY($1::text[]) AND "usageDate" = timezone('UTC', now())::date
       ORDER BY "tenantId"`,
      [statementTenantIds],
    );
    expect(usage.rows).toEqual([
      { tenantId: statementTenantAId, activeStudentCount: 2, peakActiveStudentCount: 2 },
      { tenantId: statementTenantBId, activeStudentCount: 3, peakActiveStudentCount: 3 },
    ]);
    const noTermStudents = await admin.query(`SELECT 1 FROM "StudentEnrollment" WHERE "tenantId" = $1`, [statementNoTermTenantId]);
    expect(noTermStudents.rows).toHaveLength(1);
  });
});

async function insertStudents(client: pg.PoolClient, tenantId: string, ids: string[]): Promise<void> {
  await client.query(
    `INSERT INTO "Student" ("id", "tenantId", "studentNo", "firstName", "lastName", "status", "updatedAt")
     SELECT input."id", $1, input."id", 'LİMİT', 'AŞIMI', 'ACTIVE', now()
     FROM unnest($2::text[]) AS input("id")`,
    [tenantId, ids],
  );
}

async function insertEnrollments(client: pg.PoolClient, tenantId: string, ids: string[], startsAt: string): Promise<void> {
  await client.query(
    `INSERT INTO "StudentEnrollment" ("id", "tenantId", "studentId", "status", "startsAt", "reason", "updatedAt")
     SELECT input."id" || '-enrollment', $1, input."id", 'ACTIVE', $3::date, 'STATEMENT_TRIGGER_TEST', now()
     FROM unnest($2::text[]) AS input("id")`,
    [tenantId, ids, startsAt],
  );
}
