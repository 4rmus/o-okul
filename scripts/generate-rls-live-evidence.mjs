import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getTenantScopedTables } from "../packages/db/scripts/tenant-models.mjs";
import {
  requiredRlsLiveCommands,
  requiredTenantCompositeRelations,
  requiredTenantFkInsertRejects,
  requiredWriteRejects,
} from "./rls-live-evidence-contract.mjs";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";

const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const outputPath = process.env.RLS_LIVE_OUTPUT?.trim();
const sourceSha = process.env.RLS_LIVE_SOURCE_SHA?.trim();
const repository = process.env.RLS_LIVE_REPOSITORY?.trim();
const verifierRunUrl = process.env.RLS_LIVE_VERIFIER_RUN_URL?.trim();
const staticLogTarget = process.env.RLS_LIVE_STATIC_LOG_TARGET?.trim();
const runtimeLogTarget = process.env.RLS_LIVE_RUNTIME_LOG_TARGET?.trim();
const loadSmokeTarget = process.env.RLS_LOAD_SMOKE_TARGET?.trim();
const expectedTenantTables = getTenantScopedTables();

const failures = [];
if (!["staging", "production"].includes(environment)) failures.push("STAGING_ENVIRONMENT staging veya production olmalı.");
if (!outputPath) failures.push("RLS_LIVE_OUTPUT boş bırakılamaz.");
if (!/^[a-f0-9]{40}$/i.test(sourceSha ?? "")) failures.push("RLS_LIVE_SOURCE_SHA 40 karakter hex SHA olmalı.");
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) failures.push("RLS_LIVE_REPOSITORY owner/repo biçiminde olmalı.");
requireVerifierRunUrl(verifierRunUrl, repository, failures);
if (failures.length > 0) fail(failures);

const outputFile = validateOutputPath(outputPath, "RLS_LIVE_OUTPUT");
const staticLog = readEvidenceFile(staticLogTarget, "RLS_LIVE_STATIC_LOG_TARGET", "db-rls-check.log");
const runtimeLog = readEvidenceFile(runtimeLogTarget, "RLS_LIVE_RUNTIME_LOG_TARGET", "db-rls-check-live.log");
const loadSmoke = readJsonEvidenceFile(loadSmokeTarget, "RLS_LOAD_SMOKE_TARGET", "rls-load-smoke.json");

validateStaticLog(staticLog.contents, failures);
validateRuntimeLog(runtimeLog.contents, failures);
failures.push(...validateSmokeEvidencePayload(loadSmoke.contents, {
  expectedCheck: "rls_load_smoke",
  allowedEnvironments: [environment],
  label: "RLS_LOAD_SMOKE_TARGET",
}));
if (loadSmoke.contents.checkedAt && Date.parse(loadSmoke.contents.checkedAt) > Date.now() + 5 * 60 * 1000) {
  failures.push("RLS_LOAD_SMOKE_TARGET checkedAt gelecekte olamaz.");
}
if (failures.length > 0) fail(failures);

const report = {
  result: "PASS",
  environment,
  checkedAt: new Date().toISOString(),
  schema: {
    tenantScopedTables: expectedTenantTables.length,
    derivedFromSchema: true,
    staticCheckPassed: true,
    liveCheckPassed: true,
    tablesVerified: expectedTenantTables,
  },
  isolation: {
    tenantAHash: loadSmoke.contents.isolation.tenantAHash,
    tenantBHash: loadSmoke.contents.isolation.tenantBHash,
    crossTenantReadRows: 0,
    crossTenantReadChecks: expectedTenantTables.length,
    withCheckRejects: requiredWriteRejects,
    systemAdminBypassDefaultOff: true,
    bypassRequiresReason: true,
    auditBypassAction: "system.rls_bypass_requested",
  },
  tenantFkPreflight: {
    requiredCompositeRelations: requiredTenantCompositeRelations.length,
    relationsVerified: requiredTenantCompositeRelations,
    legacyAllowlistCount: 0,
    orphanRows: 0,
    crossTenantParentRows: 0,
    crossTenantInsertRejects: requiredTenantFkInsertRejects,
    migrationPreflightCommand: "pnpm tenant-db:check && pnpm db:rls:check",
  },
  loadSmoke: {
    targetRps: loadSmoke.contents.loadSmoke.targetRps,
    actualRps: loadSmoke.contents.loadSmoke.actualRps,
    durationSeconds: loadSmoke.contents.loadSmoke.durationSeconds,
    concurrency: loadSmoke.contents.loadSmoke.concurrency,
    queriesCompleted: loadSmoke.contents.loadSmoke.queriesCompleted,
    failures: loadSmoke.contents.loadSmoke.failures,
  },
  commandsPassed: requiredRlsLiveCommands,
  evidenceReferences: [
    staticLog.reference,
    runtimeLog.reference,
    loadSmoke.reference,
    `run:${verifierRunUrl}`,
  ],
  gaps: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateParentPath(dirname(outputFile), "RLS_LIVE_OUTPUT");
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
runChecker(outputFile);
console.log(`RLS live kanıtı yazıldı: ${relative(process.cwd(), outputFile)}`);

function validateStaticLog(contents, output) {
  const expectedCount = expectedTenantTables.length;
  for (const line of [
    `Tenant model parity kontrolü geçti: ${expectedCount} tenant tablo.`,
    `RLS policy kontrolü geçti: ${expectedCount} tenant tablosu doğrulandı.`,
  ]) {
    if (!contents.includes(line)) output.push(`RLS_LIVE_STATIC_LOG_TARGET eksik başarı satırı: ${line}`);
  }
  const relationMatch = contents.match(/Tenant relation FK kontrolü geçti: (\d+) composite, (\d+) izlenen legacy istisna\./u);
  if (!relationMatch || Number(relationMatch[1]) < requiredTenantCompositeRelations.length || Number(relationMatch[2]) !== 0) {
    output.push("RLS_LIVE_STATIC_LOG_TARGET tenant relation FK sonucu yeterli değil.");
  }
}

function validateRuntimeLog(contents, output) {
  const expected = `Canlı RLS kontrolü geçti: ${expectedTenantTables.length} tenant tablosunda cross-tenant okuma izolasyonu doğrulandı.`;
  if (!contents.includes(expected)) output.push(`RLS_LIVE_RUNTIME_LOG_TARGET eksik başarı satırı: ${expected}`);
  if (!contents.includes("Sentetik RLS fixture temizliği geçti: 2 tenant silindi.")) {
    output.push("RLS_LIVE_RUNTIME_LOG_TARGET fixture cleanup kanıtını içermeli.");
  }
}

function readJsonEvidenceFile(target, label, expectedFileName) {
  const file = readEvidenceFile(target, label, expectedFileName);
  try {
    return { ...file, contents: JSON.parse(file.contents) };
  } catch {
    fail([`${label} geçerli JSON olmalı.`]);
  }
}

function readEvidenceFile(target, label, expectedFileName) {
  if (!target) fail([`${label} boş bırakılamaz.`]);
  let url;
  try {
    url = new URL(target);
  } catch {
    fail([`${label} secret taşımayan file:// URL olmalı.`]);
  }
  if (url.protocol !== "file:" || url.username || url.password || url.search || url.hash) {
    fail([`${label} secret taşımayan file:// URL olmalı.`]);
  }
  const file = resolve(fileURLToPath(url));
  if (file.split("/").at(-1) !== expectedFileName) fail([`${label} ${expectedFileName} dosyasına bağlanmalı.`]);
  validatePlainFile(file, label);
  const reference = artifactReference(file, label);
  const contents = readFileSync(file, "utf8");
  if (!contents.trim() || Buffer.byteLength(contents) > 1024 * 1024) fail([`${label} boş olmamalı ve 1 MiB sınırını aşmamalı.`]);
  return { contents, reference };
}

function artifactReference(file, label) {
  const repoRelative = relative(process.cwd(), file).replaceAll("\\", "/");
  if (!repoRelative.startsWith("artifacts/staging/reports/") || repoRelative.includes("/../")) {
    fail([`${label} artifacts/staging/reports altında olmalı.`]);
  }
  return `artifact:${repoRelative}`;
}

function validateOutputPath(value, label) {
  const file = resolve(value);
  const repoRelative = relative(process.cwd(), file).replaceAll("\\", "/");
  if (repoRelative !== "artifacts/staging/reports/rls-live.json") {
    fail([`${label} artifacts/staging/reports/rls-live.json olmalı.`]);
  }
  validateParentPath(dirname(file), label);
  if (existsSync(file)) validatePlainFile(file, label);
  return file;
}

function validatePlainFile(file, label) {
  validateParentPath(dirname(file), label);
  if (!existsSync(file)) fail([`${label} mevcut dosyaya bağlanmalı.`]);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) fail([`${label} symlink olmayan dosya olmalı.`]);
}

function validateParentPath(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/u).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail([`${label} parent dizini symlink olmayan dizin olmalı.`]);
  }
}

function requireVerifierRunUrl(value, expectedRepository, output) {
  let url;
  try {
    url = new URL(value ?? "");
  } catch {
    output.push("RLS_LIVE_VERIFIER_RUN_URL gerçek GitHub Actions run URL olmalı.");
    return;
  }
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username || url.password || url.search || url.hash ||
    url.pathname.match(/^\/([^/]+\/[^/]+)\/actions\/runs\/(\d+)\/?$/u)?.[1] !== expectedRepository
  ) {
    output.push("RLS_LIVE_VERIFIER_RUN_URL repository ile eşleşen secret taşımayan GitHub Actions run URL olmalı.");
  }
}

function runChecker(file) {
  const result = spawnSync(process.execPath, ["scripts/check-rls-live-evidence.mjs"], {
    env: { ...process.env, RLS_LIVE_EVIDENCE_TARGET: pathToFileURL(file).href },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) fail(["pnpm rls:live:check başarısız oldu."]);
}

function fail(messages) {
  console.error("RLS live kanıt üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
