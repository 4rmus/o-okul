import { createHash, randomUUID } from "node:crypto";
import { Socket } from "node:net";
import pg from "pg";
import { validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const databaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul";
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/o_okul";
const targetRps = readPositiveInt("RLS_LOAD_TARGET_RPS", 200);
const durationSeconds = readPositiveInt("RLS_LOAD_DURATION_SECONDS", 3);
const concurrency = readPositiveInt("RLS_LOAD_CONCURRENCY", 16);
const seedCount = readPositiveInt("RLS_LOAD_SEED_STUDENTS", 80);
const evidenceFile = process.env.RLS_LOAD_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const totalRequests = targetRps * durationSeconds;
const runId = randomUUID();
const tenantA = `tenant-rls-load-a-${runId}`;
const tenantB = `tenant-rls-load-b-${runId}`;

await validateSmokeEvidenceOutputTarget(evidenceFile);

const postgresUrl = new URL(directDatabaseUrl);
await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");

const appPool = new pg.Pool({ connectionString: databaseUrl, max: concurrency });
const directPool = new pg.Pool({ connectionString: directDatabaseUrl, max: 2 });

try {
  await seedFixtures();
  await assertTenantIsolation();

  const startedAt = performance.now();
  const result = await runLoad();
  const elapsedSeconds = (performance.now() - startedAt) / 1000;
  const rps = result.completed / elapsedSeconds;

  if (result.failures.length > 0) {
    throw new Error(`RLS_LOAD_QUERY_FAILED: ${result.failures[0]}`);
  }
  if (rps < targetRps) {
    throw new Error(`RLS_LOAD_TARGET_MISSED: target=${targetRps.toFixed(2)}rps actual=${rps.toFixed(2)}rps`);
  }

  await writeSmokeEvidence(evidenceFile, {
    result: "PASS",
    check: "rls_load_smoke",
    environment,
    checkedAt: new Date().toISOString(),
    loadSmoke: {
      targetRps,
      actualRps: Number(rps.toFixed(2)),
      durationSeconds,
      concurrency,
      seedStudentsPerTenant: seedCount,
      queriesCompleted: result.completed,
      failures: result.failures.length,
    },
    isolation: {
      tenantAHash: sha256(tenantA),
      tenantBHash: sha256(tenantB),
      crossTenantReadRows: 0,
    },
    commandsPassed: ["pnpm rls:load:smoke"],
    gaps: [],
  });

  console.log(
    `RLS load smoke gecti: ${result.completed} tenant-scope sorgu, ${rps.toFixed(2)} rps, hedef ${targetRps} rps, concurrency ${concurrency}.`,
  );
} finally {
  await cleanup();
  await appPool.end();
  await directPool.end();
}

async function runLoad() {
  let next = 0;
  let completed = 0;
  const failures = [];

  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const index = next;
        next += 1;
        if (index >= totalRequests || failures.length > 0) return;

        try {
          await runTenantCountQuery(tenantA, tenantA, seedCount);
          completed += 1;
        } catch (error) {
          failures.push(error instanceof Error ? error.message : String(error));
          return;
        }
      }
    }),
  );

  return { completed, failures };
}

async function assertTenantIsolation() {
  await runTenantCountQuery(tenantA, tenantA, seedCount);
  await runTenantCountQuery(tenantB, tenantB, seedCount);
  await runTenantCountQuery(tenantA, tenantB, 0);
}

async function runTenantCountQuery(contextTenantId, requestedTenantId, expectedCount) {
  const client = await appPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'false', true)");
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [contextTenantId]);
    const result = await client.query(
      `SELECT count(*)::int AS count
       FROM "Student"
       WHERE "tenantId" = $1 AND "deletedAt" IS NULL`,
      [requestedTenantId],
    );
    await client.query("COMMIT");

    const count = Number(result.rows[0]?.count ?? 0);
    if (count !== expectedCount) {
      throw new Error(`RLS_COUNT_MISMATCH: context=${contextTenantId} requested=${requestedTenantId} expected=${expectedCount} actual=${count}`);
    }
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function seedFixtures() {
  const client = await directPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    await client.query(
      `INSERT INTO "Tenant" ("id", "name", "slug", "status", "updatedAt")
       VALUES
         ($1, 'RLS Load A', $2, 'ACTIVE', now()),
         ($3, 'RLS Load B', $4, 'ACTIVE', now())`,
      [tenantA, `rls-load-a-${runId}`, tenantB, `rls-load-b-${runId}`],
    );

    await insertStudents(client, tenantA);
    await insertStudents(client, tenantB);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw new Error(`RLS_LOAD_SEED_FAILED: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

async function insertStudents(client, tenantId) {
  const values = [];
  const placeholders = [];
  for (let index = 0; index < seedCount; index += 1) {
    const offset = index * 6;
    placeholders.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6})`);
    values.push(
      `${tenantId}-student-${String(index).padStart(4, "0")}`,
      tenantId,
      `Load${index}`,
      "Student",
      `LOAD-${index}`,
      new Date(),
    );
  }

  await client.query(
    `INSERT INTO "Student" ("id", "tenantId", "firstName", "lastName", "studentNo", "updatedAt")
     VALUES ${placeholders.join(",")}`,
    values,
  );
}

async function cleanup() {
  const client = await directPool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    await client.query(`DELETE FROM "Tenant" WHERE "id" = ANY($1::text[])`, [[tenantA, tenantB]]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.warn(`RLS load smoke temizligi tamamlanamadi: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    client.release();
  }
}

function readPositiveInt(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} pozitif tam sayi olmali.`);
  }
  return parsed;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function assertPort(label, host, port, hint) {
  await new Promise((resolve, reject) => {
    const socket = new Socket();
    socket.setTimeout(1000);
    socket.once("connect", () => {
      socket.destroy();
      resolve();
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`${label} calismiyor: ${host}:${port}. Once ${hint} komutunu calistirin.`));
    });
    socket.once("error", () => {
      socket.destroy();
      reject(new Error(`${label} calismiyor: ${host}:${port}. Once ${hint} komutunu calistirin.`));
    });
    socket.connect(port, host);
  });
}
