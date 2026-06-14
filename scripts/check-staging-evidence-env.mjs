import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const templatePath = "docs/evidence-templates/staging-evidence.env.example";
const prodEnvScriptPath = "scripts/check-prod-env.mjs";
const prodEvidenceScriptPath = "scripts/check-prod-evidence.mjs";
const workflowPath = ".github/workflows/staging-deploy.yml";

const args = process.argv.slice(2);
const envFile = readArgValue("--env-file");
const targetPath = envFile ?? templatePath;
const target = parseEnvFile(targetPath);
const failures = [];

const summaryDefaultedSmokeKeys = new Map([
  ["TRAEFIK_HTTPS_SMOKE_EVIDENCE_FILE", "traefik-https.json"],
  ["SMS_PROVIDER_SMOKE_EVIDENCE_FILE", "sms-provider.json"],
  ["NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE", "notification-provider.json"],
  ["SENTRY_SMOKE_EVIDENCE_FILE", "sentry-event.json"],
  ["ALERT_WEBHOOK_SMOKE_EVIDENCE_FILE", "alert-webhook.json"],
  ["BACKUP_OFFSITE_SMOKE_EVIDENCE_FILE", "backup-offsite.json"],
  ["WAL_ARCHIVE_SMOKE_EVIDENCE_FILE", "wal-archive.json"],
]);
const workflowInjectedKeys = new Set(["ROLLBACK_IMAGE_TAG", "SENTRY_RELEASE", "GITHUB_CI_EVIDENCE_TARGET"]);
const runtimeRequiredKeys = [
  "NETGSM_USERCODE",
  "NETGSM_PASSWORD",
  "NETGSM_MSG_HEADER",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
];
const requiredKeys = unique([...extractProdEnvContractKeys(), ...runtimeRequiredKeys]);
const keysRequiredInSecret = requiredKeys.filter(
  (key) => !summaryDefaultedSmokeKeys.has(key) && !workflowInjectedKeys.has(key),
);

for (const key of keysRequiredInSecret) {
  if (!target.values.has(key)) {
    failures.push(`${targetPath} eksik env anahtarı: ${key}`);
    continue;
  }

  if (String(target.values.get(key)).trim() === "") {
    failures.push(`${targetPath} boş env değeri içeriyor: ${key}`);
  }
}

for (const key of [...summaryDefaultedSmokeKeys.keys(), ...workflowInjectedKeys]) {
  if (target.values.has(key)) {
    failures.push(`${targetPath} ${key} içermemeli; workflow veya --summary-file bu değeri üretir.`);
  }
}

for (const key of target.duplicateKeys) {
  failures.push(`${targetPath} tekrar eden env anahtarı içeriyor: ${key}`);
}

checkWorkflowContract(failures);
checkProdEvidenceDefaults(failures);

if (envFile) {
  checkNoPlaceholders(target, failures);
}

if (failures.length > 0) {
  fail(failures);
}

if (envFile) {
  checkResolvedProductionEnv(target);
}

console.log(envFile ? "Staging evidence env değer kontrolü geçti." : "Staging evidence env sözleşme kontrolü geçti.");

function readArgValue(name) {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value) {
    fail([`${name} için dosya yolu gerekli.`]);
  }
  return value;
}

function parseEnvFile(file) {
  const contents = readFileSync(file, "utf8");
  const values = new Map();
  const duplicateKeys = [];

  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      fail([`${file}:${index + 1} KEY=VALUE biçiminde olmalı.`]);
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).replace(/^["']|["']$/g, "");
    if (!/^[A-Z0-9_]+$/.test(key)) {
      fail([`${file}:${index + 1} geçersiz env anahtarı: ${key}`]);
    }
    if (values.has(key)) {
      duplicateKeys.push(key);
    }
    values.set(key, value);
  }

  return { file, values, duplicateKeys };
}

function extractProdEnvContractKeys() {
  const source = readFileSync(prodEnvScriptPath, "utf8");
  const match = source.match(/const requiredKeys = \[([\s\S]*?)\];/);
  if (!match) {
    fail([`${prodEnvScriptPath} içinde requiredKeys dizisi bulunamadı.`]);
  }
  return [...match[1].matchAll(/"([A-Z0-9_]+)"/g)].map(([, key]) => key);
}

function checkWorkflowContract(output) {
  const workflow = readFileSync(workflowPath, "utf8");
  const requiredTokens = [
    "Validate staging dispatch inputs and environment",
    "STAGING_NEXT_PUBLIC_API_URL must be an https:// URL.",
    "validate_tag \"rollback_image_tag\"",
    "github-ci-evidence:",
    "needs: preflight",
    "Generate GitHub CI evidence before deploy",
    "Check staging evidence env before deploy",
    "STAGING_EVIDENCE_ENV_B64",
    "pnpm install --frozen-lockfile",
    "trap 'rm -f .staging-evidence.env' EXIT",
    "pnpm staging:evidence-env:check -- --env-file .staging-evidence.env",
    "base64 -d > .staging-evidence.env",
    "test -s .staging-evidence.env",
    "pnpm staging:evidence-env:check",
    "GITHUB_CI_EVIDENCE_OUTPUT=\"artifacts/staging/reports/github-ci.json\" pnpm github-ci:generate",
    "GITHUB_CI_EVIDENCE_TARGET=\"file://$PWD/artifacts/staging/reports/github-ci.json\" pnpm github-ci:check",
    "actions/download-artifact@v4",
    "staging-github-ci-evidence-${{ github.sha }}",
    "Check pre-deploy GitHub CI evidence",
    "echo \"SENTRY_RELEASE=$IMAGE_TAG\"",
    "echo \"ROLLBACK_IMAGE_TAG=$ROLLBACK_IMAGE_TAG\"",
    "echo \"GITHUB_CI_EVIDENCE_TARGET=file://$PWD/artifacts/staging/reports/github-ci.json\"",
    ".ghcr_read_token",
    "GHCR read token file is missing.",
    "pnpm prod:evidence:check --",
    "--env-file .staging-evidence.env",
    "--summary-file",
    "Check staging release artifact bundle",
    "STAGING_RELEASE_ARTIFACTS_TARGET=\"$PWD/artifacts/staging\"",
    "pnpm staging:release-artifacts:check",
    "Cleanup staging evidence env",
    "run: rm -f .staging-evidence.env",
    "actions/upload-artifact@v4",
    "staging-production-evidence-${{ needs.build-images.outputs.image-tag }}",
  ];

  for (const token of requiredTokens) {
    if (!workflow.includes(token)) {
      output.push(`${workflowPath} beklenen staging evidence token'ını içermiyor: ${token}`);
    }
  }
}

function checkProdEvidenceDefaults(output) {
  const source = readFileSync(prodEvidenceScriptPath, "utf8");
  if (!source.includes("applySmokeEvidenceDefaults")) {
    output.push(`${prodEvidenceScriptPath} --summary-file smoke evidence defaultlarını üretmeli.`);
  }

  for (const key of summaryDefaultedSmokeKeys.keys()) {
    if (!source.includes(key)) {
      output.push(`${prodEvidenceScriptPath} eksik smoke evidence default key'i: ${key}`);
    }
  }
}

function checkNoPlaceholders(target, output) {
  const placeholderPattern = /__SET_|replace-me|\.example(?:[/:]|$)|example\.invalid/i;
  for (const [key, value] of target.values.entries()) {
    if (placeholderPattern.test(value)) {
      output.push(`${target.file} gerçek değer içermeli; placeholder kaldı: ${key}`);
    }
  }
}

function checkResolvedProductionEnv(target) {
  const env = { ...process.env };
  for (const [key, value] of target.values.entries()) {
    env[key] = value;
  }
  env.ROLLBACK_IMAGE_TAG = "staging-evidence-preflight";
  env.GITHUB_CI_EVIDENCE_TARGET = "file:///var/lib/uzman-hocam/staging-artifacts/github-ci.json";
  for (const [key, fileName] of summaryDefaultedSmokeKeys.entries()) {
    env[key] = `artifacts/staging/smoke/${fileName}`;
  }

  const result = spawnSync(process.execPath, [prodEnvScriptPath], {
    env,
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function unique(values) {
  return [...new Set(values)];
}

function fail(messages) {
  console.error("Staging evidence env kontrolü başarısız:");
  for (const message of messages) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}
