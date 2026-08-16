import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const outputPath = process.env.AUDIT_NULL_TENANT_OUTPUT;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const directDatabaseUrl = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
const evidenceReference = process.env.AUDIT_NULL_TENANT_EVIDENCE_REFERENCE?.trim();
const failures = [];

if (typeof outputPath !== "string" || outputPath.trim() === "") failures.push("AUDIT_NULL_TENANT_OUTPUT boş bırakılamaz.");
if (!["staging", "production"].includes(environment)) failures.push("STAGING_ENVIRONMENT staging veya production olmalı.");
if (typeof directDatabaseUrl !== "string" || directDatabaseUrl.trim() === "") failures.push("DIRECT_DATABASE_URL veya DATABASE_URL boş bırakılamaz.");
if (!isGitHubRunUrl(evidenceReference)) failures.push("AUDIT_NULL_TENANT_EVIDENCE_REFERENCE secret taşımayan GitHub Actions run URL olmalı.");
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);
const pool = new pg.Pool({ connectionString: directDatabaseUrl });

try {
  const client = await pool.connect();
  let counts;
  try {
    await client.query("BEGIN READ ONLY");
    await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
    const result = await client.query(
      `SELECT
         count(*)::int AS "totalRows",
         count(*) FILTER (WHERE "tenantId" IS NOT NULL)::int AS "tenantRows",
         count(*) FILTER (WHERE "tenantId" IS NULL)::int AS "nullTenantRows",
         count(*) FILTER (
           WHERE "tenantId" IS NULL
             AND ("action" LIKE 'system.%' OR "action" LIKE 'auth.system_%')
         )::int AS "systemRows",
         count(*) FILTER (
           WHERE "tenantId" IS NULL
             AND NOT ("action" LIKE 'system.%' OR "action" LIKE 'auth.system_%')
             AND COALESCE("diff" ? 'deletedTenantIdHash', false)
         )::int AS "deletedTenantRows",
         count(*) FILTER (
           WHERE "tenantId" IS NULL
             AND NOT ("action" LIKE 'system.%' OR "action" LIKE 'auth.system_%')
             AND NOT COALESCE("diff" ? 'deletedTenantIdHash', false)
         )::int AS "unknownRows"
       FROM "AuditLog"`,
    );
    counts = result.rows[0];
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  const report = {
    result: "PASS",
    environment,
    checkedAt: new Date().toISOString(),
    auditNullTenant: {
      totalRows: number(counts?.totalRows, "totalRows"),
      tenantRows: number(counts?.tenantRows, "tenantRows"),
      nullTenantRows: number(counts?.nullTenantRows, "nullTenantRows"),
      nullTenantBreakdown: {
        system: {
          count: number(counts?.systemRows, "systemRows"),
          classificationRule: "tenantId IS NULL AND (action LIKE 'system.%' OR action LIKE 'auth.system_%')",
        },
        deletedTenant: {
          count: number(counts?.deletedTenantRows, "deletedTenantRows"),
          classificationRule: "tenantId IS NULL AND not system AND diff.deletedTenantIdHash IS NOT NULL",
        },
        unknown: {
          count: number(counts?.unknownRows, "unknownRows"),
          classificationRule: "tenantId IS NULL AND no system/deletedTenant rule matched",
        },
      },
    },
    commandsPassed: ["pnpm audit-null-tenant:check"],
    evidenceReferences: [evidenceReference],
    gaps: [],
  };

  if (report.auditNullTenant.nullTenantBreakdown.unknown.count !== 0) {
    fail([`Sınıflandırılamayan null-tenant audit satırı var: ${report.auditNullTenant.nullTenantBreakdown.unknown.count}.`]);
  }

  mkdirSync(dirname(outputFile), { recursive: true });
  validateOutputTarget(outputFile);
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  const check = spawnSync("pnpm", ["audit-null-tenant:check"], {
    env: { ...process.env, AUDIT_NULL_TENANT_EVIDENCE_TARGET: pathToFileURL(outputFile).href },
    stdio: "inherit",
  });
  if (check.status !== 0) fail(["pnpm audit-null-tenant:check başarısız oldu."]);
  console.log(`Audit null-tenant kanıtı yazıldı: ${outputFile}`);
} finally {
  await pool.end();
}

function number(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) fail([`${label} negatif olmayan tam sayı olmalı.`]);
  return parsed;
}

function isGitHubRunUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password && !url.search && !url.hash
      && /^\/[^/]+\/[^/]+\/actions\/runs\/\d+\/?$/u.test(url.pathname);
  } catch {
    return false;
  }
}

function validateOutputTarget(filePath) {
  const normalized = filePath.replaceAll("\\", "/");
  if (normalized === "/tmp" || normalized.startsWith("/tmp/") || normalized === "/var/tmp" || normalized.startsWith("/var/tmp/") || normalized === "/private/tmp" || normalized.startsWith("/private/tmp/")) {
    fail(["AUDIT_NULL_TENANT_OUTPUT lokal temp path olmamalı."]);
  }
  const root = parse(dirname(filePath)).root;
  let current = root;
  for (const segment of dirname(filePath).slice(root.length).split(/[\\/]+/).filter(Boolean)) {
    current = resolve(current, segment);
    if (!existsSync(current)) break;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail(["AUDIT_NULL_TENANT_OUTPUT parent dizini plain dizin olmalı."]);
  }
  if (existsSync(filePath)) {
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) fail(["AUDIT_NULL_TENANT_OUTPUT plain file olmalı."]);
  }
}

function fail(messages) {
  console.error("Audit null-tenant kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
