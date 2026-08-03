import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const mode = (process.env.LICENSE_TERM_BACKFILL_MODE ?? "DRY_RUN").trim().toUpperCase();
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV;
const databaseUrl = process.env.DIRECT_DATABASE_URL;
const outputPath = process.env.LICENSE_TERM_BACKFILL_OUTPUT;
const confirmation = process.env.LICENSE_TERM_BACKFILL_CONFIRM;
const failures = [];

requireOneOf(mode, "LICENSE_TERM_BACKFILL_MODE", ["DRY_RUN", "APPLY"], failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireValue(databaseUrl, "DIRECT_DATABASE_URL", failures);
requireValue(outputPath, "LICENSE_TERM_BACKFILL_OUTPUT", failures);
if (mode === "APPLY" && confirmation !== "apply-pr5-license-term-backfill") {
  failures.push("LICENSE_TERM_BACKFILL_CONFIRM apply-pr5-license-term-backfill olmalı.");
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
let client;
let report;

try {
  client = await pool.connect();
  await client.query(mode === "APPLY" ? "BEGIN ISOLATION LEVEL SERIALIZABLE" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
  await client.query("SET LOCAL statement_timeout = '60s'");
  await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
  if (mode === "APPLY") {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('o-okul:account-management:pr5-license-term-backfill'))");
  }

  const before = await collectReadiness(client);
  const blockers = deriveBlockers(before);
  if (mode === "APPLY" && blockers.length === 0) await applyBackfill(client);
  const after = mode === "APPLY" && blockers.length === 0 ? await collectReadiness(client) : before;
  if (mode === "APPLY" && blockers.length === 0 && after.readyTenants !== after.eligibleTenants) {
    blockers.push("LICENSE_TERM_BACKFILL_INCOMPLETE");
  }

  const result = blockers.length > 0 ? "BLOCKED" : mode === "APPLY" ? "PASS" : "READY";
  report = {
    schemaVersion: 1,
    result,
    mode,
    environment,
    checkedAt: new Date().toISOString(),
    databaseMutationApplied: mode === "APPLY" && result === "PASS",
    checks: {
      eligibleTenants: after.eligibleTenants,
      existingTermsBefore: before.existingTerms,
      readyTenants: after.readyTenants,
      plannedWrites: before.plannedWrites,
      missingSnapshots: after.missingSnapshots,
      invalidSnapshots: after.invalidSnapshots,
      mirrorParityMismatches: after.mirrorParityMismatches,
      overlappingTerms: after.overlappingTerms,
    },
    blockers: [...new Set(blockers)],
    gaps: [...new Set(blockers)],
  };

  if (mode === "APPLY" && result === "PASS") await client.query("COMMIT");
  else await client.query("ROLLBACK");
} catch (error) {
  if (client) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client?.release();
  await pool.end();
}

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile);

const checked = spawnSync(process.execPath, ["scripts/check-license-term-backfill.mjs"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    LICENSE_TERM_BACKFILL_TARGET: pathToFileURL(outputFile).href,
    LICENSE_TERM_BACKFILL_ALLOW_READY: mode === "DRY_RUN" ? "1" : "0",
  },
  stdio: "inherit",
});
if (checked.status !== 0) process.exit(checked.status ?? 1);
console.log(`LicenseTerm backfill raporu yazıldı: ${outputFile}`);

async function collectReadiness(queryable) {
  const result = await queryable.query(`
    WITH eligible AS (
      SELECT t.*
      FROM "Tenant" t
      WHERE t."id" <> 'system' AND t."status" NOT IN ('DELETED', 'CLOSED')
    ), term_counts AS (
      SELECT lt."tenantId", count(*)::int AS terms
      FROM "LicenseTerm" lt
      JOIN eligible tenant ON tenant."id" = lt."tenantId"
      GROUP BY lt."tenantId"
    ), overlapping AS (
      SELECT DISTINCT left_term."tenantId"
      FROM "LicenseTerm" left_term
      JOIN "LicenseTerm" right_term
        ON right_term."tenantId" = left_term."tenantId" AND right_term."id" > left_term."id"
      WHERE left_term."cancelledAt" IS NULL AND right_term."cancelledAt" IS NULL
        AND tstzrange(left_term."startsAt", left_term."endsAt", '[)')
          && tstzrange(right_term."startsAt", right_term."endsAt", '[)')
    )
    SELECT
      count(*)::int AS "eligibleTenants",
      coalesce((SELECT sum(terms) FROM term_counts), 0)::int AS "existingTerms",
      count(*) FILTER (WHERE tenant."licenseStartsAt" IS NULL OR tenant."licenseEndsAt" IS NULL OR tenant."seatLimit" IS NULL)::int AS "missingSnapshots",
      count(*) FILTER (WHERE tenant."licenseStartsAt" IS NOT NULL AND tenant."licenseEndsAt" IS NOT NULL
        AND tenant."seatLimit" IS NOT NULL
        AND (tenant."licenseStartsAt" >= tenant."licenseEndsAt" OR tenant."seatLimit" <= 0 OR btrim(tenant."plan") = ''))::int AS "invalidSnapshots",
      count(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM "LicenseTerm" term
        WHERE term."tenantId" = tenant."id" AND term."cancelledAt" IS NULL
          AND term."planCode" = tenant."plan"
          AND term."startsAt" = tenant."licenseStartsAt"
          AND term."endsAt" = tenant."licenseEndsAt"
          AND term."activeStudentLimit" = tenant."seatLimit"
      ))::int AS "readyTenants",
      count(*) FILTER (WHERE coalesce(term_counts.terms, 0) = 0
        AND tenant."licenseStartsAt" IS NOT NULL AND tenant."licenseEndsAt" IS NOT NULL
        AND tenant."seatLimit" IS NOT NULL AND tenant."licenseStartsAt" < tenant."licenseEndsAt"
        AND tenant."seatLimit" > 0 AND btrim(tenant."plan") <> '')::int AS "plannedWrites",
      count(*) FILTER (WHERE coalesce(term_counts.terms, 0) > 0 AND NOT EXISTS (
        SELECT 1 FROM "LicenseTerm" term
        WHERE term."tenantId" = tenant."id" AND term."cancelledAt" IS NULL
          AND term."planCode" = tenant."plan"
          AND term."startsAt" = tenant."licenseStartsAt"
          AND term."endsAt" = tenant."licenseEndsAt"
          AND term."activeStudentLimit" = tenant."seatLimit"
      ))::int AS "mirrorParityMismatches",
      (SELECT count(*)::int FROM overlapping) AS "overlappingTerms"
    FROM eligible tenant
    LEFT JOIN term_counts ON term_counts."tenantId" = tenant."id"`);
  return numberRow(result.rows[0]);
}

async function applyBackfill(queryable) {
  await queryable.query(`
    INSERT INTO "LicenseTerm" (
      "tenantId", "planCode", "startsAt", "endsAt", "activeStudentLimit", "auditReference", "updatedAt"
    )
    SELECT tenant."id", tenant."plan", tenant."licenseStartsAt", tenant."licenseEndsAt", tenant."seatLimit",
           'account-management-pr5-license-backfill', now()
    FROM "Tenant" tenant
    WHERE tenant."id" <> 'system' AND tenant."status" NOT IN ('DELETED', 'CLOSED')
      AND tenant."licenseStartsAt" IS NOT NULL AND tenant."licenseEndsAt" IS NOT NULL AND tenant."seatLimit" IS NOT NULL
      AND tenant."licenseStartsAt" < tenant."licenseEndsAt" AND tenant."seatLimit" > 0 AND btrim(tenant."plan") <> ''
      AND NOT EXISTS (SELECT 1 FROM "LicenseTerm" term WHERE term."tenantId" = tenant."id")`);
  await queryable.query(`
    SELECT o_okul_refresh_license_usage(tenant."id")
    FROM "Tenant" tenant
    WHERE tenant."id" <> 'system' AND tenant."status" NOT IN ('DELETED', 'CLOSED')`);
}

function deriveBlockers(checks) {
  const blockers = [];
  if (checks.missingSnapshots > 0) blockers.push("LICENSE_SNAPSHOT_MISSING");
  if (checks.invalidSnapshots > 0) blockers.push("LICENSE_SNAPSHOT_INVALID");
  if (checks.mirrorParityMismatches > 0) blockers.push("LICENSE_MIRROR_PARITY_MISMATCH");
  if (checks.overlappingTerms > 0) blockers.push("LICENSE_TERM_OVERLAP");
  return blockers;
}

function numberRow(row = {}) {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, Number(value ?? 0)]));
}

function requireValue(value, name, output) {
  if (typeof value !== "string" || value.trim() === "") output.push(`${name} boş bırakılamaz.`);
}

function requireOneOf(value, name, allowed, output) {
  if (!allowed.includes(value)) output.push(`${name} ${allowed.join(" veya ")} olmalı.`);
}

function validateOutputTarget(path) {
  if (["/", "/tmp", "/var/tmp", "/private/tmp"].includes(path)) fail(["LICENSE_TERM_BACKFILL_OUTPUT güvenli bir artifact dosyası olmalı."]);
  if (existsSync(path) && (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())) {
    fail(["LICENSE_TERM_BACKFILL_OUTPUT symlink olmayan dosya olmalı."]);
  }
  let current = dirname(path);
  const root = parse(current).root;
  while (current !== root && existsSync(current)) {
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail(["LICENSE_TERM_BACKFILL_OUTPUT parent dizini güvenli olmalı."]);
    current = dirname(current);
  }
}

function fail(messages) {
  console.error("LicenseTerm backfill başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
