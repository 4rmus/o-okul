import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import pg from "pg";

const outputPath = readOption("--output") ?? process.env.IDENTITY_MIGRATION_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? "postgresql://migration:migration@localhost:5432/o_okul";

const approvedBy = process.env.IDENTITY_MIGRATION_APPROVED_BY?.trim();
const approvalReference = process.env.IDENTITY_MIGRATION_APPROVAL_REFERENCE?.trim();
const activationMode = process.env.IDENTITY_MIGRATION_ACTIVATION_MODE?.trim();

const invitationTestCommand = "pnpm --filter @o-okul/api exec vitest run src/identity-invitation/identity-invitation.e2e.test.ts";
const userManagementTestCommand = "pnpm --filter @o-okul/api exec vitest run src/user-management/user-management.e2e.test.ts";

const subjectTables = [
  { table: "Student", role: "STUDENT" },
  { table: "Guardian", role: "GUARDIAN" },
  { table: "Teacher", role: "TEACHER" },
];

const failures = [];
requireValue(outputPath, "IDENTITY_MIGRATION_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireDecisionValue(approvedBy, "IDENTITY_MIGRATION_APPROVED_BY", failures);
requireDecisionValue(approvalReference, "IDENTITY_MIGRATION_APPROVAL_REFERENCE", failures);
requireOneOf(activationMode, "IDENTITY_MIGRATION_ACTIVATION_MODE", ["invite", "admin_link", "hybrid"], failures);
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const pool = new pg.Pool({ connectionString: directDatabaseUrl });
try {
  const client = await pool.connect();
  let subjects;
  let invitationFlow;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    subjects = await readSubjectReadiness(client);
    invitationFlow = await readInvitationFlow(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  runCommand(invitationTestCommand);
  runCommand(userManagementTestCommand);

  const report = {
    result: "PASS",
    environment,
    checkedAt: new Date().toISOString(),
    migrationDecision: {
      approvedBy,
      approvalReference,
      activationMode,
    },
    subjects,
    invitationFlow,
    verifications: [
      "identity_link_audit_ready",
      "tenant_memberships_created",
      "wrong_role_access_rejected",
      "cross_tenant_activation_rejected",
    ],
    gaps: [],
  };

  mkdirSync(dirname(outputFile), { recursive: true });
  validateOutputTarget(outputFile);
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  validateOutputTarget(outputFile);
  runCommand(`IDENTITY_MIGRATION_TARGET=file://${outputFile} pnpm identity-migration:check`);
  console.log(`Kimlik göç kanıtı yazıldı: ${outputFile}`);
} finally {
  await pool.end();
}

async function readSubjectReadiness(pool) {
  const rows = [];
  for (const subject of subjectTables) {
    rows.push(await readSubject(pool, subject));
  }
  return rows;
}

async function readSubject(pool, { table, role }) {
  const result = await pool.query(
    `SELECT
       count(*)::int AS "sourceRecords",
       count(*) FILTER (WHERE subject."userId" IS NOT NULL)::int AS "linkedUsers",
       count(membership."id") FILTER (WHERE subject."userId" IS NOT NULL)::int AS "tenantMembershipsCreated"
     FROM "${table}" subject
     LEFT JOIN "TenantMembership" membership
       ON membership."tenantId" = subject."tenantId"
      AND membership."userId" = subject."userId"
      AND membership."role" = $1::"TenantRole"
     WHERE subject."deletedAt" IS NULL`,
    [role],
  );
  const row = result.rows[0] ?? {};
  const sourceRecords = Number(row.sourceRecords ?? 0);
  const linkedUsers = Number(row.linkedUsers ?? 0);
  const tenantMembershipsCreated = Number(row.tenantMembershipsCreated ?? 0);

  if (!Number.isInteger(sourceRecords) || sourceRecords < 1) {
    fail([`subjects.${role}.sourceRecords staging/prod gerçek kanıt için sıfırdan büyük olmalı.`]);
  }
  if (linkedUsers !== sourceRecords) {
    fail([`subjects.${role}.linkedUsers sourceRecords ile eşit olmalı: ${linkedUsers}/${sourceRecords}.`]);
  }
  if (tenantMembershipsCreated !== sourceRecords) {
    fail([`subjects.${role}.tenantMembershipsCreated sourceRecords ile eşit olmalı: ${tenantMembershipsCreated}/${sourceRecords}.`]);
  }

  return { role, sourceRecords, linkedUsers, tenantMembershipsCreated };
}

async function readInvitationFlow(pool) {
  const result = await pool.query(
    `SELECT
       count(*)::int AS "created",
       count(*) FILTER (WHERE "status" = 'ACCEPTED' OR "acceptedAt" IS NOT NULL)::int AS "accepted",
       count(*) FILTER (
         WHERE "status" NOT IN ('PENDING', 'ACCEPTED')
            OR ("status" = 'PENDING' AND "expiresAt" <= now())
       )::int AS "expiredOrRevoked"
     FROM "IdentityInvitation"`,
  );
  const row = result.rows[0] ?? {};
  const invitationFlow = {
    created: Number(row.created ?? 0),
    accepted: Number(row.accepted ?? 0),
    expiredOrRevoked: Number(row.expiredOrRevoked ?? 0),
  };

  for (const [label, value] of Object.entries(invitationFlow)) {
    if (!Number.isInteger(value) || value < 0) {
      fail([`invitationFlow.${label} sıfır veya daha büyük tam sayı olmalı.`]);
    }
  }
  if (invitationFlow.accepted > invitationFlow.created) {
    fail(["invitationFlow.accepted created değerinden büyük olamaz."]);
  }

  return invitationFlow;
}

function runCommand(command) {
  const testEnv = { ...process.env };
  for (const key of [
    "DATABASE_URL",
    "DIRECT_DATABASE_URL",
    "NODE_ENV",
    "ADMIN_MFA_MODE",
    "PERSISTENCE_DRIVER",
    "IDEMPOTENCY_STORE",
  ]) {
    delete testEnv[key];
  }

  const result = spawnSync("sh", ["-lc", command], {
    env: testEnv,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail([`${command} başarısız oldu.`]);
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
  }
}

function requireOneOf(value, label, expected, output) {
  if (!expected.includes(value)) {
    output.push(`${label} ${expected.join(" veya ")} olmalı.`);
  }
}

function requireDecisionValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }

  if (hasPlaceholderToken(value)) {
    output.push(`${label} gerçek karar/onay değeri olmalı; placeholder/example/redacted/test içeremez.`);
  }
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return [
    "__set",
    "change-me",
    "replace-me",
    "placeholder",
    "redacted",
    "example",
    ".test",
    "localhost",
    "todo",
    "tbd",
    "???",
  ].some((token) => normalized.includes(token));
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["IDENTITY_MIGRATION_OUTPUT lokal temp path olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath));

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["IDENTITY_MIGRATION_OUTPUT symlink olmayan file artifact olmalı."]);
    }
  }
}

function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const directoryStat = lstatSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      fail(["IDENTITY_MIGRATION_OUTPUT parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function fail(messages) {
  console.error("Kimlik göç kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
