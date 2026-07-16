import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const templatePath = "docs/evidence-templates/staging-evidence.env.example";
const prodEnvScriptPath = "scripts/check-prod-env.mjs";
const prodEvidenceScriptPath = "scripts/check-prod-evidence.mjs";
const workflowPath = process.env.STAGING_DEPLOY_WORKFLOW_PATH ?? ".github/workflows/staging-deploy.yml";

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
  ["WAL_ARCHIVE_SMOKE_EVIDENCE_FILE", "wal-archive.json"],
  ["REPORT_GENERATION_SMOKE_EVIDENCE_FILE", "report-generation.json"],
]);
const workflowInjectedKeys = new Set([
  "ROLLBACK_IMAGE_TAG",
  "SENTRY_RELEASE",
  "GITHUB_CI_EVIDENCE_TARGET",
  "UI_UX_REDESIGN_EVIDENCE_TARGET",
  "PRODUCTION_EVIDENCE_SUMMARY_TARGET",
]);
const uiUxRedesignGeneratorKeys = [
  "UI_UX_REDESIGN_RELEASE_CANDIDATE",
  "UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES",
  "UI_UX_REDESIGN_PHASE_0_REFERENCES",
  "UI_UX_REDESIGN_PHASE_1_REFERENCES",
  "UI_UX_REDESIGN_PHASE_2_REFERENCES",
  "UI_UX_REDESIGN_PHASE_3_REFERENCES",
  "UI_UX_REDESIGN_PHASE_4_REFERENCES",
  "UI_UX_REDESIGN_PHASE_5_REFERENCES",
  "UI_UX_REDESIGN_KURUM_DASHBOARD_REFERENCES",
  "UI_UX_REDESIGN_OPTIK_WORKSPACE_REFERENCES",
  "UI_UX_REDESIGN_RAPOR_WORKSPACE_REFERENCES",
  "UI_UX_REDESIGN_PORTAL_SHELL_REFERENCES",
  "UI_UX_REDESIGN_PII_REVIEW",
  "UI_UX_REDESIGN_RAW_PII_IN_ARTIFACTS",
  "UI_UX_REDESIGN_SMS_RECIPIENT_PREVIEW_EXPORTED",
  "UI_UX_REDESIGN_GUARDIAN_FINANCE_LEAKAGE_CHECKED",
  "UI_UX_REDESIGN_APPROVAL_ROLE",
  "UI_UX_REDESIGN_APPROVED_AT",
];
const smsProviderRuntimeKeys = ["NETGSM_USERCODE", "NETGSM_PASSWORD", "NETGSM_MSG_HEADER"];
const smsSmokeKeys = ["SMS_SMOKE_TO", "SMS_SMOKE_BODY", "SMS_SMOKE_CONFIRM"];
const runtimeRequiredKeys = ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
const smsEnabled = target.values.get("SMS_ENABLED") === "true";
const prodEnvContractKeys = extractProdEnvContractKeys().filter((key) => smsEnabled || !smsSmokeKeys.includes(key));
const requiredKeys = unique([
  ...prodEnvContractKeys,
  ...runtimeRequiredKeys,
  ...(smsEnabled ? smsProviderRuntimeKeys : []),
  ...uiUxRedesignGeneratorKeys,
]);
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
checkTemplateRepositorySlugContract(failures);

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
    "full_evidence:",
    "Validate staging dispatch inputs and environment",
    "STAGING_NEXT_PUBLIC_API_URL must be an https:// URL.",
    "STAGING_DEPLOY_DIR must be /root/o-okul.",
    "docker-compose.observability.yml",
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
    "staging-github-ci-evidence-${{ github.event.workflow_run.head_sha || github.sha }}",
    "staging-github-ci-evidence-${{ needs.build-images.outputs.deploy-sha }}",
    "path: artifacts/staging/reports",
    "path: artifacts/staging/reports/github-ci.json",
    "Check pre-deploy GitHub CI evidence",
    "Generate UI/UX redesign evidence",
    "UI_UX_REDESIGN_EVIDENCE_OUTPUT=\"artifacts/staging/reports/ui-ux-redesign.json\"",
    "pnpm ui-ux-redesign:evidence-generate -- --env-file .staging-evidence.env",
    "Bind local UI/UX completion to verified source",
    "UI_UX_PROFESSIONALIZATION_SOURCE_SHA: ${{ needs.build-images.outputs.deploy-sha }}",
    "pnpm ui-ux-professionalization:completion:check -- --local-proof-only",
    "prune_old_release_images",
    "require_disk_space_mb 2048",
    "timeout 20m docker compose",
    "require_running_image web \"${IMAGE_PREFIX}/web:${IMAGE_TAG}\"",
    "require_running_image api \"${IMAGE_PREFIX}/api:${IMAGE_TAG}\"",
    "require_running_image worker \"${IMAGE_PREFIX}/worker:${IMAGE_TAG}\"",
    "require_running_image queue-board \"${IMAGE_PREFIX}/queue-board:${IMAGE_TAG}\"",
    "echo \"UI_UX_REDESIGN_EVIDENCE_TARGET=file://$PWD/artifacts/staging/reports/ui-ux-redesign.json\"",
    "echo \"SENTRY_RELEASE=$IMAGE_TAG\"",
    "echo \"ROLLBACK_IMAGE_TAG=$ROLLBACK_IMAGE_TAG\"",
    "echo \"GITHUB_CI_EVIDENCE_TARGET=file://$PWD/artifacts/staging/reports/github-ci.json\"",
    "echo \"PRODUCTION_EVIDENCE_SUMMARY_TARGET=file://$PWD/artifacts/staging/release-summary-${IMAGE_TAG}.json\"",
    ".ghcr_read_token",
    "GHCR read token file is missing.",
    "if: ${{ github.event_name == 'workflow_dispatch' && inputs.full_evidence == true }}",
    "pnpm prod:evidence:check --",
    "--env-file .staging-evidence.env",
    "--summary-file",
    "Check staging release artifact bundle",
    "STAGING_RELEASE_ARTIFACTS_TARGET=\"$PWD/artifacts/staging\"",
    "pnpm staging:release-artifacts:check",
    "Bind live UI/UX completion to full evidence",
    "UI_UX_PROFESSIONALIZATION_FULL_EVIDENCE: \"1\"",
    "run: pnpm ui-ux-professionalization:completion:check",
    "Cleanup staging evidence env",
    "run: rm -f .staging-evidence.env",
    "actions/upload-artifact@v4",
    "staging-production-evidence-${{ needs.build-images.outputs.image-tag }}",
    "path: artifacts/staging",
  ];

  for (const token of requiredTokens) {
    if (!workflow.includes(token)) {
      output.push(`${workflowPath} beklenen staging evidence token'ını içermiyor: ${token}`);
    }
  }

  if (workflow.includes("pnpm run ci")) {
    output.push(`${workflowPath} tam CI'yi tekrar çalıştırmamalı; başarılı CI evidence deploy kapısıdır.`);
  }

  if (workflow.includes("playwright install --with-deps chromium")) {
    output.push(`${workflowPath} Playwright bağımlılığı kurmamalı; bu sorumluluk CI workflow'unda kalmalı.`);
  }

  requireWorkflowOrder(output, workflow, "preflight staging env check order", [
    "Check staging evidence env before deploy",
    "trap 'rm -f .staging-evidence.env' EXIT",
    "base64 -d > .staging-evidence.env",
    "test -s .staging-evidence.env",
    "pnpm staging:evidence-env:check -- --env-file .staging-evidence.env",
  ]);
  requireWorkflowOrder(output, workflow, "GitHub CI evidence artifact order", [
    "Generate GitHub CI evidence before deploy",
    "GITHUB_CI_EVIDENCE_OUTPUT=\"artifacts/staging/reports/github-ci.json\" pnpm github-ci:generate",
    "GITHUB_CI_EVIDENCE_TARGET=\"file://$PWD/artifacts/staging/reports/github-ci.json\" pnpm github-ci:check",
    "actions/upload-artifact@v4",
    "staging-github-ci-evidence-${{ github.event.workflow_run.head_sha || github.sha }}",
    "path: artifacts/staging/reports/github-ci.json",
  ]);
  requireWorkflowOrder(output, workflow, "staging evidence bundle order", [
    "actions/download-artifact@v4",
    "path: artifacts/staging/reports",
    "Decode staging evidence env",
    "base64 -d > .staging-evidence.env",
    "Check staging evidence env",
    "pnpm staging:evidence-env:check -- --env-file .staging-evidence.env",
    "Check pre-deploy GitHub CI evidence",
    "Generate UI/UX redesign evidence",
    "UI_UX_REDESIGN_EVIDENCE_OUTPUT=\"artifacts/staging/reports/ui-ux-redesign.json\"",
    "pnpm ui-ux-redesign:evidence-generate -- --env-file .staging-evidence.env",
    "Bind local UI/UX completion to verified source",
    "pnpm ui-ux-professionalization:completion:check -- --local-proof-only",
    "Append release evidence metadata",
    "echo \"UI_UX_REDESIGN_EVIDENCE_TARGET=file://$PWD/artifacts/staging/reports/ui-ux-redesign.json\"",
    "Run first staging evidence gates",
    "Run production evidence chain",
    "Check staging release artifact bundle",
    "STAGING_RELEASE_ARTIFACTS_TARGET=\"$PWD/artifacts/staging\"",
    "pnpm staging:release-artifacts:check",
    "Bind live UI/UX completion to full evidence",
    "UI_UX_PROFESSIONALIZATION_FULL_EVIDENCE: \"1\"",
    "run: pnpm ui-ux-professionalization:completion:check",
    "Cleanup staging evidence env",
    "run: rm -f .staging-evidence.env",
    "staging-production-evidence-${{ needs.build-images.outputs.image-tag }}",
    "path: artifacts/staging",
  ]);
}

function checkProdEvidenceDefaults(output) {
  const source = readFileSync(prodEvidenceScriptPath, "utf8");
  if (!source.includes("applySmokeEvidenceDefaults")) {
    output.push(`${prodEvidenceScriptPath} --summary-file smoke evidence defaultlarını üretmeli.`);
  }

  for (const [key, fileName] of summaryDefaultedSmokeKeys) {
    if (!source.includes(key)) {
      output.push(`${prodEvidenceScriptPath} eksik smoke evidence default key'i: ${key}`);
    }
    if (!source.includes(fileName)) {
      output.push(`${prodEvidenceScriptPath} eksik smoke evidence default dosyası: ${fileName}`);
    }
  }
}

function checkTemplateRepositorySlugContract(output) {
  if (targetPath !== templatePath) return;

  const releaseCandidate = target.values.get("UI_UX_REDESIGN_RELEASE_CANDIDATE");
  const evidenceReferences = target.values.get("UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES");

  if (!String(releaseCandidate).startsWith("ghcr.io/__SET_GITHUB_REPOSITORY__/")) {
    output.push(`${templatePath} UI_UX_REDESIGN_RELEASE_CANDIDATE GITHUB_REPOSITORY slug'ını kullanmalı.`);
  }
  if (!String(evidenceReferences).includes("run:https://github.com/__SET_GITHUB_REPOSITORY__/actions/runs/")) {
    output.push(`${templatePath} UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES GITHUB_REPOSITORY run URL'si kullanmalı.`);
  }
}

function requireWorkflowOrder(output, workflow, label, tokens) {
  let cursor = -1;
  for (const token of tokens) {
    const index = workflow.indexOf(token, cursor + 1);
    if (index === -1) {
      output.push(`${workflowPath} ${label} sırası bozuk veya eksik: ${token}`);
      return;
    }
    cursor = index;
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
  env.GITHUB_CI_EVIDENCE_TARGET = "file:///var/lib/o-okul/staging-artifacts/github-ci.json";
  env.UI_UX_REDESIGN_EVIDENCE_TARGET = "file:///var/lib/o-okul/staging-artifacts/ui-ux-redesign.json";
  env.PRODUCTION_EVIDENCE_SUMMARY_TARGET = "file:///var/lib/o-okul/staging-artifacts/release-summary-preflight.json";
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
