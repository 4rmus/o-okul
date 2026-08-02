import { createHash } from "node:crypto";
import { Socket } from "node:net";
import pg from "pg";

const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/o_okul";
const approval = process.env.IDENTITY_LINK_MIGRATION_APPROVED;
const disabledPasswordHash =
  "scrypt:identity-migration-disabled:7T4oz3jIhXy5VrR95L6jqX5ZuZnEL-13aVml8Ov5vbw";
const subjects = [
  { table: "Student", role: "STUDENT", prefix: "student" },
  { table: "Guardian", role: "GUARDIAN", prefix: "guardian" },
  { table: "Teacher", role: "TEACHER", prefix: "teacher" },
];

if (approval !== "true") {
  throw new Error("IDENTITY_LINK_MIGRATION_APPROVED=true olmadan kimlik bağı göçü çalışmaz.");
}

const postgresUrl = new URL(directDatabaseUrl);
await assertPort("Postgres", postgresUrl.hostname, Number(postgresUrl.port || 5432), "pnpm db:migrate");

const pool = new pg.Pool({ connectionString: directDatabaseUrl });
const client = await pool.connect();

try {
  await client.query("BEGIN");
  await client.query("SELECT set_config('app.bypass_rls', 'true', true)");

  const results = [];
  for (const subject of subjects) {
    results.push(await migrateSubject(subject));
  }

  await client.query("COMMIT");
  console.log(JSON.stringify({ status: "MIGRATED", subjects: results }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}

async function migrateSubject(subject) {
  const before = await countSubject(subject);
  const missing = await client.query(
    `SELECT "tenantId", "id", "firstName", "lastName"
     FROM "${subject.table}"
     WHERE "deletedAt" IS NULL
       AND "userId" IS NULL
     ORDER BY "tenantId", "id"`,
  );

  for (const row of missing.rows) {
    const userId = generatedUserId(subject.prefix, row.tenantId, row.id);
    const email = generatedEmail(subject.prefix, row.tenantId, row.id);
    const name = `${row.firstName} ${row.lastName}`.trim() || `${subject.role} ${row.id}`;

    await client.query(
      `INSERT INTO "User" (
         "id", "tenantId", "email", "emailNormalized", "loginName", "loginNameNormalized",
         "name", "passwordHash", "passwordHashVersion", "accountStatus", "updatedAt"
       )
       VALUES ($1, $2, $3, $3, $3, $3, $4, $5, 1, 'DISABLED', now())
       ON CONFLICT ("id") DO UPDATE
       SET "tenantId" = EXCLUDED."tenantId",
           "email" = EXCLUDED."email",
           "emailNormalized" = EXCLUDED."emailNormalized",
           "loginName" = EXCLUDED."loginName",
           "loginNameNormalized" = EXCLUDED."loginNameNormalized",
           "name" = EXCLUDED."name",
           "passwordHashVersion" = EXCLUDED."passwordHashVersion",
           "accountStatus" = EXCLUDED."accountStatus",
           "updatedAt" = now()`,
      [userId, row.tenantId, email, name, disabledPasswordHash],
    );

    await client.query(
      `UPDATE "${subject.table}"
       SET "userId" = $3,
           "updatedAt" = now()
       WHERE "tenantId" = $1
         AND "id" = $2
         AND "userId" IS NULL`,
      [row.tenantId, row.id, userId],
    );
  }

  await client.query(
    `INSERT INTO "TenantMembership" (
       "id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona",
       "status", "version", "scopeMode", "updatedAt"
     )
     SELECT
       'membership-' || subject."userId" || '-' || lower($1),
       subject."tenantId",
       subject."userId",
       $1::"TenantRole",
       NULL,
       $1 = 'TEACHER',
       $1 = 'STUDENT',
       'ACTIVE',
       account."membershipVersion",
       'TENANT',
       now()
     FROM "${subject.table}" subject
     JOIN "User" account
       ON account."tenantId" = subject."tenantId"
      AND account."id" = subject."userId"
     WHERE subject."deletedAt" IS NULL
       AND subject."userId" IS NOT NULL
     ON CONFLICT ("tenantId", "userId", "role") DO UPDATE
     SET "staffRole" = EXCLUDED."staffRole",
         "hasTeacherPersona" = EXCLUDED."hasTeacherPersona",
         "hasStudentPersona" = EXCLUDED."hasStudentPersona",
         "status" = EXCLUDED."status",
         "version" = EXCLUDED."version",
         "scopeMode" = EXCLUDED."scopeMode",
         "updatedAt" = now()`,
    [subject.role],
  );

  const after = await countSubject(subject);
  return {
    subject: subject.role,
    before,
    after,
    linkedByMigration: missing.rowCount,
  };
}

async function countSubject({ table, role }) {
  const result = await client.query(
    `SELECT
       count(*)::int AS "total",
       count(*) FILTER (WHERE subject."userId" IS NOT NULL)::int AS "linked",
       count(*) FILTER (
         WHERE subject."userId" IS NOT NULL
           AND membership."id" IS NOT NULL
       )::int AS "tenantMemberships"
     FROM "${table}" subject
     LEFT JOIN "TenantMembership" membership
       ON membership."tenantId" = subject."tenantId"
      AND membership."userId" = subject."userId"
      AND membership."role" = $1::"TenantRole"
     WHERE subject."deletedAt" IS NULL`,
    [role],
  );
  return result.rows[0] ?? { total: 0, linked: 0, tenantMemberships: 0 };
}

function generatedUserId(prefix, tenantId, subjectId) {
  return `identity-link-${prefix}-${hash(`${tenantId}:${subjectId}`)}`;
}

function generatedEmail(prefix, tenantId, subjectId) {
  return `identity+${prefix}-${hash(`${tenantId}:${subjectId}`)}@demo.local`;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
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
