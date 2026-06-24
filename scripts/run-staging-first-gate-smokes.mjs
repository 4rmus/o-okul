import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { parse, relative, resolve } from "node:path";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";

const envFile = readArgValue("--env-file");
const outputDir = resolve(readArgValue("--output-dir") ?? "artifacts/staging/first-gates");
if (isLocalTempPath(outputDir)) {
  fail("staging:first-gates:smoke output-dir lokal temp path olmamalı.");
}
if (isLocalSmokePath(outputDir)) {
  fail("staging:first-gates:smoke output-dir artifacts/local altında olmamalı.");
}
assertOutputPathAllowed(outputDir);
const env = {
  ...process.env,
  ...(envFile ? readEnvFile(envFile) : {}),
};

env.STAGING_ENVIRONMENT ??= "staging";
env.NODE_ENV ??= "production";
const managedEvidenceFiles = new Map([
  ["TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE", "traefik-https.json"],
  ["ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE", "alert-webhook.json"],
]);
const expectedOutputFiles = new Set(["first-gates-manifest.json", ...managedEvidenceFiles.values()]);

for (const [key, fileName] of managedEvidenceFiles.entries()) {
  if (typeof env[key] === "string" && env[key].trim() !== "") {
    fail(`${key} staging:first-gates:smoke tarafından --output-dir altında yönetilir; env içinde verilmemeli.`);
  }
  env[key] = resolve(outputDir, fileName);
}

const smokeChecks = [
  {
    label: "Traefik HTTPS smoke",
    script: "scripts/smoke-traefik-https.mjs",
    evidenceFile: env.TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE,
    expectedCheck: "traefik_https_smoke",
  },
  {
    label: "Alert webhook smoke",
    script: "scripts/smoke-alert-webhook.mjs",
    evidenceFile: env.ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE,
    expectedCheck: "alert_webhook_smoke",
  },
];

mkdirSync(outputDir, { recursive: true });
assertOutputPathAllowed(outputDir);
validateOutputDirectory({ requireExpectedFiles: false });

const manifest = {
  result: "PASS",
  generatedAt: undefined,
  environment: env.STAGING_ENVIRONMENT,
  checks: [],
  commandsPassed: ["pnpm staging:first-gates:smoke"],
  gaps: [],
};

for (const check of smokeChecks) {
  const result = spawnSync(process.execPath, [check.script], {
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    fail(`${check.label} başarısız.`);
  }

  validateEvidenceFile(check);
  manifest.checks.push({
    label: check.label,
    script: check.script,
    evidenceFile: relative(outputDir, check.evidenceFile),
    status: "PASS",
  });
}

manifest.generatedAt = new Date().toISOString();
const manifestFile = resolve(outputDir, "first-gates-manifest.json");
writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
validateOutputDirectory({ requireExpectedFiles: true });

console.log(`Staging ilk gate smoke kanıtları yazıldı: ${relative(process.cwd(), outputDir)}`);

function validateOutputDirectory({ requireExpectedFiles }) {
  const outputDirStat = lstatSync(outputDir);
  if (outputDirStat.isSymbolicLink()) {
    fail("staging:first-gates:smoke output-dir symlink olmayan dizin olmalı.");
  }
  if (!outputDirStat.isDirectory()) {
    fail("staging:first-gates:smoke output-dir dizin olmalı.");
  }

  const seen = new Set();
  for (const entry of readdirSync(outputDir, { withFileTypes: true })) {
    if (!expectedOutputFiles.has(entry.name)) {
      fail(`staging:first-gates:smoke output-dir beklenmeyen dosya içeriyor: ${entry.name}`);
    }

    const entryStat = lstatSync(resolve(outputDir, entry.name));
    if (entryStat.isSymbolicLink()) {
      fail(`staging:first-gates:smoke output-dir symlink içermemeli: ${entry.name}`);
    }
    if (!entryStat.isFile()) {
      fail(`staging:first-gates:smoke output-dir sadece dosya içermeli: ${entry.name}`);
    }
    seen.add(entry.name);
  }

  if (requireExpectedFiles) {
    for (const expectedFile of expectedOutputFiles) {
      if (!seen.has(expectedFile)) {
        fail(`staging:first-gates:smoke output-dir eksik dosya içeriyor: ${expectedFile}`);
      }
    }
  }
}

function assertOutputPathAllowed(directory) {
  const root = parse(directory).root;
  const segments = directory.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail("staging:first-gates:smoke output-dir symlink olmayan dizin olmalı.");
    }
  }
}

function isLocalTempPath(path) {
  const normalized = path.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function isLocalSmokePath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function validateEvidenceFile({ label, evidenceFile, expectedCheck }) {
  if (!existsSync(evidenceFile)) {
    fail(`${label} evidence dosyası yazılmadı: ${evidenceFile}`);
  }

  let payload;
  try {
    payload = JSON.parse(readFileSync(evidenceFile, "utf8"));
  } catch (error) {
    fail(`${label} evidence JSON okunamadı: ${error.message}`);
  }

  const failures = validateSmokeEvidencePayload(payload, {
    expectedCheck,
    allowedEnvironments: ["staging", "production"],
    label,
  });

  if (failures.length > 0) {
    console.error(`${label} evidence sözleşmesi başarısız:`);
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }
}

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`${name} için değer gerekli.`);
  }
  return value;
}

function readEnvFile(file) {
  const resolved = resolve(file);
  const envFromFile = {};
  const contents = readFileSync(resolved, "utf8");

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;

    const key = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1).replace(/^["']|["']$/g, "");
    envFromFile[key] = value;
  }

  return envFromFile;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
