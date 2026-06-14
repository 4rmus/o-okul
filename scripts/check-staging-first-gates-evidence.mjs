import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";

const manifestTarget = process.env.STAGING_FIRST_GATES_TARGET ?? readArgValue("--manifest") ?? process.argv[2];
const manifestTopLevelKeys = ["result", "generatedAt", "environment", "checks", "commandsPassed", "gaps"];
const manifestCheckKeys = ["label", "script", "evidenceFile", "status"];
const expectedChecks = new Map([
  [
    "Traefik HTTPS smoke",
    {
      script: "scripts/smoke-traefik-https.mjs",
      expectedCheck: "traefik_https_smoke",
      evidenceFile: "traefik-https.json",
    },
  ],
  [
    "Alert webhook smoke",
    {
      script: "scripts/smoke-alert-webhook.mjs",
      expectedCheck: "alert_webhook_smoke",
      evidenceFile: "alert-webhook.json",
    },
  ],
  [
    "Off-site backup smoke",
    {
      script: "scripts/smoke-backup-offsite.mjs",
      expectedCheck: "backup_offsite_smoke",
      evidenceFile: "backup-offsite.json",
    },
  ],
]);

if (!manifestTarget) {
  fail(["STAGING_FIRST_GATES_TARGET veya --manifest zorunlu."]);
}

const manifestFile = resolveTargetPath(manifestTarget);
let manifest;
try {
  manifest = parseJson(readFileSync(manifestFile, "utf8"), "first-gates-manifest");
} catch (error) {
  fail([error.message]);
}
const failures = validateManifest(manifest, manifestFile);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Staging first gates kanıt kontrolü geçti: ${manifest.checks.length}/3 smoke artifact.`);

function validateManifest(report, manifestPath) {
  const failures = [];

  if (!requireObjectKeySet(report, manifestTopLevelKeys, failures, "firstGates")) {
    return failures;
  }

  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "generatedAt");
  requireDateNotInFuture(report, failures, "generatedAt");
  requireExactStringList(report.commandsPassed, failures, "commandsPassed", ["pnpm staging:first-gates:smoke"]);
  requireEmptyArray(report, failures, "gaps");
  requireChecks(report.checks, report, manifestPath, failures);

  return failures;
}

function requireChecks(checks, manifest, manifestPath, failures) {
  if (!Array.isArray(checks)) {
    failures.push("checks listesi zorunlu.");
    return;
  }

  if (checks.length !== expectedChecks.size) {
    failures.push(`checks tam ${expectedChecks.size} madde içermeli.`);
  }

  const seen = new Set();
  for (const [index, item] of checks.entries()) {
    if (!requireObjectKeySet(item, manifestCheckKeys, failures, `checks.${index}`)) {
      continue;
    }

    const expected = expectedChecks.get(item.label);
    if (!expected) {
      failures.push(`checks beklenmeyen madde içeriyor: ${item.label}`);
      continue;
    }

    if (seen.has(item.label)) {
      failures.push(`checks tekrarlı madde içeriyor: ${item.label}`);
    }
    seen.add(item.label);

    requireObjectEqual(item, failures, `checks.${item.label}.script`, "script", expected.script);
    requireObjectEqual(item, failures, `checks.${item.label}.status`, "status", "PASS");
    requireObjectEqual(item, failures, `checks.${item.label}.evidenceFile`, "evidenceFile", expected.evidenceFile);
    requireEvidenceFile(item, expected, manifest, manifestPath, failures);
  }

  for (const label of expectedChecks.keys()) {
    if (!seen.has(label)) {
      failures.push(`checks eksik madde içeriyor: ${label}`);
    }
  }
}

function requireEvidenceFile(item, expected, manifest, manifestPath, failures) {
  if (typeof item.evidenceFile !== "string" || item.evidenceFile.trim() === "") {
    failures.push(`checks.${item.label}.evidenceFile boş olmayan string olmalı.`);
    return;
  }

  if (hasPlaceholderToken(item.evidenceFile)) {
    failures.push(`checks.${item.label}.evidenceFile production için placeholder/test/example değer içermemeli.`);
    return;
  }

  const evidencePath = resolveEvidencePath(item.evidenceFile, manifestPath);
  if (!evidencePath) {
    failures.push(`checks.${item.label}.evidenceFile okunabilir artifact'e bağlanmalı.`);
    return;
  }

  let payload;
  try {
    payload = parseJson(readFileSync(evidencePath, "utf8"), `checks.${item.label}.evidenceFile`);
  } catch (error) {
    failures.push(`checks.${item.label}.evidenceFile okunamadı: ${error.message}`);
    return;
  }

  const smokeFailures = validateSmokeEvidencePayload(payload, {
    expectedCheck: expected.expectedCheck,
    allowedEnvironments: ["staging", "production"],
    label: `checks.${item.label}.smokeEvidence`,
  });
  failures.push(...smokeFailures);
  if (payload.environment !== manifest.environment) {
    failures.push(`checks.${item.label}.smokeEvidence.environment firstGates.environment ile eşleşmeli.`);
  }
  requireDateNotAfter(
    payload,
    failures,
    `checks.${item.label}.smokeEvidence.generatedAt`,
    "generatedAt",
    manifest,
    "firstGates.generatedAt",
    "generatedAt",
  );
  requireDateNotAfter(
    payload,
    failures,
    `checks.${item.label}.smokeEvidence.checkedAt`,
    "checkedAt",
    manifest,
    "firstGates.generatedAt",
    "generatedAt",
  );
}

function resolveTargetPath(target) {
  if (target.startsWith("file://")) {
    return fileURLToPath(new URL(target));
  }
  return resolve(target);
}

function resolveEvidencePath(value, manifestPath) {
  const candidates = [];
  if (value.startsWith("file://")) {
    candidates.push(fileURLToPath(new URL(value)));
  } else {
    candidates.push(resolve(dirname(manifestPath), value));
    candidates.push(resolve(value));
  }

  return candidates.find((candidate) => existsSync(candidate));
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} geçerli JSON olmalı.`);
  }
}

function requireObjectKeySet(value, expectedKeys, failures, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }

  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (actualKeys.length !== sortedExpectedKeys.length) {
    failures.push(`${label} tam ${sortedExpectedKeys.length} alan içermeli.`);
  }

  for (const key of actualKeys) {
    if (!sortedExpectedKeys.includes(key)) {
      failures.push(`${label} beklenmeyen alan içeriyor: ${key}`);
    }
  }

  for (const key of sortedExpectedKeys) {
    if (!actualKeys.includes(key)) {
      failures.push(`${label} eksik alan içeriyor: ${key}`);
    }
  }

  return true;
}

function requireEqual(scope, failures, key, expected) {
  if (scope[key] !== expected) {
    failures.push(`${key} ${expected} olmalı.`);
  }
}

function requireObjectEqual(scope, failures, label, key, expected) {
  if (scope[key] !== expected) {
    failures.push(`${label} ${expected} olmalı.`);
  }
}

function requireOneOf(scope, failures, key, expectedValues) {
  if (!expectedValues.includes(scope[key])) {
    failures.push(`${key} ${expectedValues.join("/")} olmalı.`);
  }
}

function requireDate(scope, failures, key) {
  if (typeof scope[key] !== "string" || Number.isNaN(Date.parse(scope[key]))) {
    failures.push(`${key} geçerli tarih olmalı.`);
  }
}

function requireDateNotInFuture(scope, failures, key) {
  if (typeof scope[key] !== "string") return;
  const timestamp = Date.parse(scope[key]);
  if (Number.isNaN(timestamp)) return;

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${key} gelecekte olamaz.`);
  }
}

function requireDateNotAfter(source, failures, sourceLabel, sourceKey, target, targetLabel, targetKey) {
  const sourceTimestamp = Date.parse(source?.[sourceKey]);
  const targetTimestamp = Date.parse(target?.[targetKey]);
  if (Number.isNaN(sourceTimestamp) || Number.isNaN(targetTimestamp)) return;
  if (sourceTimestamp > targetTimestamp) {
    failures.push(`${sourceLabel} ${targetLabel} tarihinden sonra olamaz.`);
  }
}

function requireExactStringList(value, failures, label, expected) {
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }

  const actual = [...value].sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length) {
    failures.push(`${label} tam ${sortedExpected.length} madde içermeli.`);
  }

  for (const item of actual) {
    if (!sortedExpected.includes(item)) {
      failures.push(`${label} beklenmeyen madde içeriyor: ${item}`);
    }
  }

  for (const item of sortedExpected) {
    if (!actual.includes(item)) {
      failures.push(`${label} eksik madde içeriyor: ${item}`);
    }
  }
}

function requireEmptyArray(scope, failures, key) {
  if (!Array.isArray(scope[key])) {
    failures.push(`${key} listesi zorunlu.`);
    return;
  }

  if (scope[key].length !== 0) {
    failures.push(`${key} boş olmalı.`);
  }
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("example") ||
    normalized.includes("redacted") ||
    normalized.includes("__set") ||
    normalized.includes("localhost") ||
    normalized.includes(".test")
  );
}

function readArgValue(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function fail(failures) {
  console.error("Staging first gates kanıt kontrolü başarısız:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}
