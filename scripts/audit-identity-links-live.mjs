import { Socket } from "node:net";
import pg from "pg";

const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/uzman_hocam";
const subjects = [
  { table: "Student", role: "STUDENT" },
  { table: "Guardian", role: "GUARDIAN" },
  { table: "Teacher", role: "TEACHER" },
];

const postgresUrl = new URL(directDatabaseUrl);
await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");

const pool = new pg.Pool({ connectionString: directDatabaseUrl });

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
  const rows = [];
  for (const subject of subjects) {
    rows.push(await auditSubject(subject));
  }

  const totals = rows.reduce(
    (acc, row) => ({
      total: acc.total + row.total,
      linked: acc.linked + row.linked,
      missingUserLink: acc.missingUserLink + row.missingUserLink,
      missingMembership: acc.missingMembership + row.missingMembership,
      ready: acc.ready + row.ready,
    }),
    { total: 0, linked: 0, missingUserLink: 0, missingMembership: 0, ready: 0 },
  );

  const status = totals.total === 0
    ? "NO_SUBJECT_RECORDS"
    : totals.missingUserLink === 0 && totals.missingMembership === 0
      ? "READY"
      : "NEEDS_INVITE_MIGRATION";
  console.log(JSON.stringify({ status, totals, subjects: rows }, null, 2));
  await client.query("COMMIT");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

async function auditSubject({ table, role }) {
  const result = await client.query(
    `SELECT
       count(*)::int AS "total",
       count(*) FILTER (WHERE subject."userId" IS NOT NULL)::int AS "linked",
       count(*) FILTER (WHERE subject."userId" IS NULL)::int AS "missingUserLink",
       count(*) FILTER (
         WHERE subject."userId" IS NOT NULL
           AND membership."id" IS NULL
       )::int AS "missingMembership"
     FROM "${table}" subject
     LEFT JOIN "TenantMembership" membership
       ON membership."tenantId" = subject."tenantId"
      AND membership."userId" = subject."userId"
      AND membership."role" = $1::"TenantRole"
     WHERE subject."deletedAt" IS NULL`,
    [role],
  );
  const row = result.rows[0] ?? {};
  const total = Number(row.total ?? 0);
  const missingUserLink = Number(row.missingUserLink ?? 0);
  const missingMembership = Number(row.missingMembership ?? 0);
  return {
    subject: role,
    table,
    total,
    linked: Number(row.linked ?? 0),
    missingUserLink,
    missingMembership,
    ready: total - missingUserLink - missingMembership,
  };
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
