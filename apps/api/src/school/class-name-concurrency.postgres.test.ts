import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { runWithRequestContext } from "../context/request-context.js";
import {
  activeClassNameUniqueConstraint,
  PostgresClassStore,
} from "./class-store.js";

const appDatabaseUrl = process.env.CLASS_NAME_POSTGRES_TEST_URL;
const adminDatabaseUrl = process.env.CLASS_NAME_POSTGRES_ADMIN_URL;
const postgresRequired = process.env.CLASS_NAME_POSTGRES_REQUIRED === "1";

if (postgresRequired && (!appDatabaseUrl || !adminDatabaseUrl)) {
  throw new Error("CLASS_NAME_POSTGRES_URLS_REQUIRED");
}

const describePostgres = appDatabaseUrl && adminDatabaseUrl ? describe : describe.skip;
const tenantAId = "class-name-tenant-a";
const tenantBId = "class-name-tenant-b";
const tenantIds = [tenantAId, tenantBId];

describePostgres("PostgresClassStore active-name concurrency integration", () => {
  const admin = new pg.Pool({ connectionString: adminDatabaseUrl });
  const app = new pg.Pool({ connectionString: appDatabaseUrl, max: 4 });
  const store = new PostgresClassStore(app);

  beforeAll(async () => {
    await cleanupFixtures(admin);
  });

  afterAll(async () => {
    await cleanupFixtures(admin);
    await Promise.all([admin.end(), app.end()]);
  });

  it("paralel create isteğinde yalnız bir adı kabul eder, tenant ayrımını ve silinen adın yeniden kullanımını korur", async () => {
    const outcomes = await Promise.allSettled([
      createClass(tenantAId, " Eş Zamanlı Etüt "),
      createClass(tenantAId, "eşzamanlıetüt"),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: "23505",
      constraint: activeClassNameUniqueConstraint,
    });

    await expect(createClass(tenantBId, "EŞZAMANLI ETÜT")).resolves.toMatchObject({ tenantId: tenantBId });
    const tenantAClasses = await runWithRequestContext(requestContext(tenantAId), () => store.list());
    expect(tenantAClasses.every((record) => record.tenantId === tenantAId)).toBe(true);

    const created = outcomes.find((outcome): outcome is PromiseFulfilledResult<Awaited<ReturnType<typeof createClass>>> =>
      outcome.status === "fulfilled")!.value;
    await runWithRequestContext(requestContext(tenantAId), () => store.softDelete(created.id, new Date().toISOString()));
    await expect(createClass(tenantAId, "EŞZAMANLI ETÜT")).resolves.toMatchObject({ tenantId: tenantAId });
  });

  it("iki paralel rename isteğinden yalnız birini aynı aktif ada taşır", async () => {
    const [first, second] = await Promise.all([
      createClass(tenantAId, "Rename A"),
      createClass(tenantAId, "Rename B"),
    ]);
    const outcomes = await Promise.allSettled([
      updateClass(tenantAId, first.id, "Ortak Ad"),
      updateClass(tenantAId, second.id, "ortakad"),
    ]);

    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: "23505",
      constraint: activeClassNameUniqueConstraint,
    });

    const matching = await admin.query<{ count: number }>(
      `SELECT count(*)::int AS "count"
       FROM "Class"
       WHERE "tenantId" = $1
         AND "deletedAt" IS NULL
         AND public.class_name_key("name") = public.class_name_key($2)`,
      [tenantAId, "Ortak Ad"],
    );
    expect(matching.rows[0]?.count).toBe(1);
  });

  function createClass(tenantId: string, name: string) {
    return runWithRequestContext(requestContext(tenantId), () => store.create({ tenantId, name }));
  }

  function updateClass(tenantId: string, id: string, name: string) {
    return runWithRequestContext(requestContext(tenantId), () => store.update(id, { name }));
  }
});

function requestContext(tenantId: string) {
  return {
    userId: "class-name-postgres-test-user",
    tenantId,
    roles: ["TENANT_ADMIN"],
    bypassRls: false,
  };
}

async function cleanupFixtures(pool: pg.Pool): Promise<void> {
  await pool.query(`DELETE FROM "Class" WHERE "tenantId" = ANY($1::text[])`, [tenantIds]);
}
