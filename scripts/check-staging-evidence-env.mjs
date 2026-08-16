import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const templatePath = "docs/evidence-templates/staging-evidence.env.example";
const prodEnvScriptPath = "scripts/check-prod-env.mjs";
const prodEvidenceScriptPath = "scripts/check-prod-evidence.mjs";
const workflowPath = process.env.STAGING_DEPLOY_WORKFLOW_PATH ?? ".github/workflows/staging-deploy.yml";
const outboxVerifyWorkflowPath = ".github/workflows/staging-outbox-verify.yml";
const identityMigrationGeneratorPath = "scripts/generate-identity-migration-evidence.mjs";
const financialRetentionGeneratorPath = "scripts/generate-financial-retention-evidence.mjs";

const args = process.argv.slice(2);
const envFile = readArgValue("--env-file");
const validationMode = readArgValue("--mode") ?? "full";
const targetPath = envFile ?? templatePath;
const target = parseEnvFile(targetPath);
const failures = [];

if (!new Set(["activation", "full"]).has(validationMode)) {
  fail(["--mode yalnız activation veya full olabilir."]);
}

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
  "UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS",
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
  "UI_UX_REDESIGN_PRIVACY_REVIEW_REFERENCE",
  "UI_UX_REDESIGN_RAW_PII_IN_ARTIFACTS",
  "UI_UX_REDESIGN_SMS_RECIPIENT_PREVIEW_EXPORTED",
  "UI_UX_REDESIGN_GUARDIAN_FINANCE_LEAKAGE_CHECKED",
  "UI_UX_REDESIGN_APPROVAL_ROLE",
  "UI_UX_REDESIGN_APPROVED_BY",
  "UI_UX_REDESIGN_APPROVED_AT",
];
const smsProviderRuntimeKeys = ["NETGSM_USERCODE", "NETGSM_PASSWORD", "NETGSM_MSG_HEADER"];
const smsSmokeKeys = ["SMS_SMOKE_TO", "SMS_SMOKE_BODY", "SMS_SMOKE_CONFIRM"];
const runtimeRequiredKeys = ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"];
const forbiddenSecretKeys = new Map([
  ["SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_ID", "verify-only workflow host-side private source-id dosyasını kullanır."],
]);
const optionalRuntimeKeys = new Set(["TRAEFIK_TRUSTED_FORWARDER_CIDRS", "NOTIFICATION_SMOKE_PUSH_TO"]);
const proxyNetworkKeys = [
  "DOCKER_PROXY_SUBNET",
  "DOCKER_PROXY_NETWORK",
  "TRAEFIK_PROXY_IP",
  "API_PROXY_IP",
  "RATE_LIMIT_SMOKE_EGRESS_IP",
];
const smsEnabled = target.values.get("SMS_ENABLED") === "true";
const prodEnvContractKeys = extractProdEnvContractKeys().filter((key) => smsEnabled || !smsSmokeKeys.includes(key));
const fullRequiredKeys = unique([
  ...prodEnvContractKeys,
  ...runtimeRequiredKeys,
  ...proxyNetworkKeys,
  ...(smsEnabled ? smsProviderRuntimeKeys : []),
  ...uiUxRedesignGeneratorKeys,
]);
const activationRequiredKeys = [
  "NODE_ENV",
  "SENTRY_ENVIRONMENT",
  "WHATSAPP_ENABLED",
  "WEB_URL",
  "TRAEFIK_HTTPS_SMOKE_URL",
  "ALERT_WEBHOOK_URL",
  "ALERT_WEBHOOK_TOKEN",
  "WAL_ARCHIVE_TARGET",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
];
const requiredKeys = validationMode === "activation" ? activationRequiredKeys : fullRequiredKeys;
const keysRequiredInSecret = requiredKeys.filter(
  (key) => !summaryDefaultedSmokeKeys.has(key) && !workflowInjectedKeys.has(key) && !optionalRuntimeKeys.has(key),
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

for (const [key, reason] of forbiddenSecretKeys) {
  if (target.values.has(key)) {
    failures.push(`${targetPath} ${key} içermemeli; ${reason}`);
  }
}

if (args.includes("--require-secret-delivery-outbox-smoke")) {
  failures.push("--require-secret-delivery-outbox-smoke kaldırıldı; source ID yalnız host-side private dosyadan okunur.");
}

for (const key of target.duplicateKeys) {
  failures.push(`${targetPath} tekrar eden env anahtarı içeriyor: ${key}`);
}

checkWorkflowContract(failures);
checkOutboxVerifyWorkflowContract(failures);
checkProdEvidenceDefaults(failures);
checkTemplateRepositorySlugContract(failures);

if (envFile) {
  checkNoPlaceholders(target, failures);
  if (validationMode === "activation") {
    checkActivationEnv(target.values, failures);
  }
}

if (failures.length > 0) {
  fail(failures);
}

if (envFile && validationMode === "full") {
  checkResolvedProductionEnv(target);
}

console.log(
  envFile
    ? validationMode === "activation"
      ? "Staging activation env değer kontrolü geçti."
      : "Staging evidence env değer kontrolü geçti."
    : "Staging evidence env sözleşme kontrolü geçti.",
);

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
    "Select current runtime-affecting deploy",
    "newer CI-verified main SHA exists",
    "associated PR range unavailable; fail-open",
    "ASSOCIATED_PR_BASE_SHA",
    "/actions/workflows/ci.yml/runs?branch=main&status=success",
    "git merge-base --is-ancestor",
    "no runtime-affecting files changed",
    "if: needs.preflight.outputs.deploy-required == 'true'",
    "STAGING_NEXT_PUBLIC_API_URL must be an https:// URL.",
    "STAGING_DEPLOY_DIR must be /root/o-okul.",
    "docker-compose.observability.yml",
    "docker/alertmanager",
    "docker/prometheus",
    "docs/evidence-manifests",
    "docker-compose.rate-limit-shard.yml",
    "validate_tag \"rollback_image_tag\"",
    "github-ci-evidence:",
    "needs: preflight",
    "Generate GitHub CI evidence before deploy",
    "Check staging evidence env before deploy",
    "STAGING_EVIDENCE_ENV_B64",
    "pnpm install --frozen-lockfile",
    "trap 'rm -f .staging-evidence.env' EXIT",
    "pnpm staging:evidence-env:check -- --mode activation --env-file .staging-evidence.env",
    "base64 -d > .staging-evidence.env",
    "test -s .staging-evidence.env",
    "Rebind staging activation origin",
    "STAGING_NEXT_PUBLIC_API_URL: ${{ vars.STAGING_NEXT_PUBLIC_API_URL }}",
    "public_origin=$(node -p 'new URL(process.argv[1]).origin' \"$STAGING_NEXT_PUBLIC_API_URL\")",
    String.raw`s#^(APP_URL|API_URL|WEB_URL)=.*#\\1=$public_origin#`,
    "s#^TRAEFIK_HTTPS_SMOKE_URL=.*#TRAEFIK_HTTPS_SMOKE_URL=$public_origin/health#",
    "pnpm staging:evidence-env:check",
    "GITHUB_CI_EVIDENCE_OUTPUT=\"artifacts/staging/reports/github-ci.json\" pnpm github-ci:generate",
    "GITHUB_CI_EVIDENCE_TARGET=\"file://$PWD/artifacts/staging/reports/github-ci.json\" pnpm github-ci:check",
    "actions/download-artifact@v4",
    "staging-github-ci-evidence-${{ github.event.workflow_run.head_sha || github.sha }}",
    "staging-github-ci-evidence-${{ needs.build-images.outputs.deploy-sha }}",
    "path: artifacts/staging/reports",
    "path: artifacts/staging/reports/github-ci.json",
    "Check pre-deploy GitHub CI evidence",
    "Configure SSH for WAL evidence",
    "Run WAL archive staging smoke",
    "WAL_ARCHIVE_SMOKE_EVIDENCE_FILE: artifacts/staging/smoke/wal-archive.json",
    "export DOCKER_HOST=\"ssh://$STAGING_SSH_USER@$STAGING_SSH_HOST\"",
    "export COMPOSE_PROJECT_NAME=o-okul",
    "export COMPOSE_ENV_FILES=\"$PWD/.staging-evidence.env\"",
    "pnpm wal:archive:smoke -- --env-file .staging-evidence.env",
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
    "ALERTMANAGER_SECRETS_DIR=${alertmanager_secrets_dir}",
    "Alertmanager secret file is missing or unsafe",
    "umask 077 && cat > '$STAGING_DEPLOY_DIR/.alertmanager-secrets.tgz'",
    "Alertmanager secret directories must not be symlinks.",
    "chmod 600 \"$secret_path\"",
    "stat -c '%a:%u:%g' \"$secret_path\"",
    "-f docker-compose.observability.yml",
    "config --quiet",
    "pull web api worker queue-board alertmanager-secrets-init alertmanager prometheus loki alloy grafana",
    "kill -s HUP prometheus",
    "require_running_image alertmanager \"prom/alertmanager:v0.28.1\"",
    "prune_old_alertmanager_secret_dirs()",
    "find \"$private_root\" -mindepth 1 -maxdepth 1 -type d -print0",
    "find \"$candidate\" -xdev -depth -delete",
    "Cleanup runs only after Alertmanager is healthy and every runtime image check passes.",
    "Account management preflight before legacy access cutover",
    "ACCOUNT_MANAGEMENT_PREFLIGHT_OUTPUT=artifacts/staging/reports/account-management-preflight.json",
    "Account management backfill and parity gate before app start",
    "ACCOUNT_MANAGEMENT_BACKFILL_MODE=APPLY",
    "ACCOUNT_MANAGEMENT_BACKFILL_CONFIRM=apply-pr4-backfill",
    "ACCOUNT_MANAGEMENT_BACKFILL_OUTPUT=artifacts/staging/reports/account-management-backfill.json",
    'owner_decisions_file="$(dirname "$STAGING_DEPLOY_DIR")/o-okul-private/account-management/$IMAGE_TAG/owner-decisions.json"',
    '[ -L "$owner_decisions_file" ]',
    'realpath -e "$owner_decisions_file"',
    "stat -c '%a' \"$owner_decisions_file\"",
    "stat -c '%u' \"$owner_decisions_file\"",
    "Release-scoped account owner decisions must be a non-symlink 0600 file owned by the deploy user.",
    "ACCOUNT_MANAGEMENT_OWNER_DECISIONS_TARGET=file:///run/private/account-management-owner-decisions.json",
    "echo \"SENTRY_RELEASE=$IMAGE_TAG\"",
    "echo \"ROLLBACK_IMAGE_TAG=$ROLLBACK_IMAGE_TAG\"",
    "echo \"GITHUB_CI_EVIDENCE_TARGET=file://$PWD/artifacts/staging/reports/github-ci.json\"",
    "echo \"PRODUCTION_EVIDENCE_SUMMARY_TARGET=file://$PWD/artifacts/staging/release-summary-${IMAGE_TAG}.json\"",
    "Generate deployment cutover artifact",
    "DEPLOYMENT_CUTOVER_EVIDENCE_FILE: artifacts/staging/reports/deployment-cutover.json",
    "node scripts/generate-deployment-cutover-evidence.mjs",
    "staging-deployment-cutover-${{ github.run_id }}",
    ".ghcr_read_token",
    "GHCR read token file is missing.",
    "Cleanup staging evidence env",
    "run: rm -f .staging-evidence.env",
    "actions/upload-artifact@v4",
    "staging-activation-evidence-${{ needs.build-images.outputs.image-tag }}",
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

  const evidenceJob = workflow.slice(workflow.indexOf("\n  evidence:"));
  for (const token of ["Configure SSH for evidence tunnels", "Open staging data tunnels", "append-staging-evidence-tunnel-env.mjs"]) {
    if (evidenceJob.includes(token)) {
      output.push(`${workflowPath} normal activation evidence job'ında DB tunnel açmamalı: ${token}`);
    }
  }

  requireWorkflowOrder(output, workflow, "preflight staging env check order", [
    "Check staging evidence env before deploy",
    "trap 'rm -f .staging-evidence.env' EXIT",
    "base64 -d > .staging-evidence.env",
    "test -s .staging-evidence.env",
    "pnpm staging:evidence-env:check -- --mode activation --env-file .staging-evidence.env",
  ]);
  requireWorkflowOrder(output, workflow, "Alertmanager secret injection order", [
    "alertmanager_secret_stage=\"$RUNNER_TEMP/alertmanager-secrets\"",
    "Buffer.from(process.env.STAGING_EVIDENCE_ENV_B64 ?? \"\", \"base64\")",
    "writeFileSync(`${outputDir}/webhook-url`",
    "writeFileSync(`${outputDir}/webhook-token`",
    "tar -C \"$alertmanager_secret_stage\"",
    "docker/alertmanager",
    "Alertmanager secret archive is missing or unsafe.",
    "umask 077 && cat > '$STAGING_DEPLOY_DIR/.alertmanager-secrets.tgz'",
    "remote_secret_archive_uploaded=1",
    "install -d -m 700 -o 0 -g 0 \"$alertmanager_secrets_dir\"",
    "chown 0:0 \"$secret_path\"",
    "chmod 600 \"$secret_path\"",
    "ALERTMANAGER_SECRETS_DIR=${alertmanager_secrets_dir}",
    "config --quiet",
    "pull web api worker queue-board alertmanager-secrets-init alertmanager prometheus loki alloy grafana",
    "up -d --remove-orphans",
    "require_running_image alertmanager \"prom/alertmanager:v0.28.1\"",
    "require_running_image grafana \"grafana/grafana:11.5.2\"",
    "Cleanup runs only after Alertmanager is healthy and every runtime image check passes.",
    "prune_old_alertmanager_secret_dirs \"$alertmanager_private_root\" \"$alertmanager_secrets_dir\"",
  ]);

  for (const token of [
    "catch {",
    "ALERT_WEBHOOK_URL must be a valid credential-free HTTPS URL.",
    "cleanup_deploy()",
    "rm -f '$STAGING_DEPLOY_DIR/.alertmanager-secrets.tgz' '$STAGING_DEPLOY_DIR/.ghcr_read_token'",
  ]) {
    if (!workflow.includes(token)) {
      output.push(`${workflowPath} Alertmanager secret hata yolu koruması eksik: ${token}`);
    }
  }
  checkAlertmanagerUrlParserDoesNotLeak(output, workflow);

  for (const unsafeToken of ["echo \"$ALERT_WEBHOOK_TOKEN\"", "ALERT_WEBHOOK_TOKEN=${ALERT_WEBHOOK_TOKEN}"]) {
    if (workflow.includes(unsafeToken)) {
      output.push(`${workflowPath} Alertmanager bearer secret'ını komut veya env çıktısına gömmemeli: ${unsafeToken}`);
    }
  }
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
    "Rebind staging activation origin",
    "public_origin=$(node -p 'new URL(process.argv[1]).origin' \"$STAGING_NEXT_PUBLIC_API_URL\")",
    "Check staging evidence env",
    "pnpm staging:evidence-env:check -- --mode activation --env-file .staging-evidence.env",
    "Check pre-deploy GitHub CI evidence",
    "Configure SSH for WAL evidence",
    "Run WAL archive staging smoke",
    "pnpm wal:archive:smoke -- --env-file .staging-evidence.env",
    "Bind local UI/UX completion to verified source",
    "pnpm ui-ux-professionalization:completion:check -- --local-proof-only",
    "Append release evidence metadata",
    "Run first staging evidence gates",
    "Generate deployment cutover artifact",
    "node scripts/generate-deployment-cutover-evidence.mjs",
    "Cleanup staging evidence env",
    "run: rm -f .staging-evidence.env",
    "staging-deployment-cutover-${{ github.run_id }}",
    "staging-activation-evidence-${{ needs.build-images.outputs.image-tag }}",
    "path: artifacts/staging",
  ]);
}

function checkAlertmanagerUrlParserDoesNotLeak(output, workflow) {
  const match = workflow.match(/node - \"\$alertmanager_secret_stage\" <<'NODE'\n([\s\S]*?)\n\s+NODE/);
  if (!match) {
    output.push(`${workflowPath} Alertmanager secret parser heredoc'u bulunamadı.`);
    return;
  }

  const sentinel = "alert-secret-sentinel-should-not-leak";
  const workDir = mkdtempSync(join(tmpdir(), "o-okul-alert-parser-"));
  try {
    const envText = `ALERT_WEBHOOK_URL=https://[${sentinel}\nALERT_WEBHOOK_TOKEN=${"x".repeat(32)}\n`;
    const result = spawnSync(process.execPath, ["-", workDir], {
      input: match[1],
      env: {
        ...process.env,
        STAGING_EVIDENCE_ENV_B64: Buffer.from(envText).toString("base64"),
      },
      encoding: "utf8",
    });
    const logs = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    if (result.status === 0) {
      output.push(`${workflowPath} geçersiz Alertmanager URL girdisini reddetmeli.`);
    }
    if (logs.includes(sentinel)) {
      output.push(`${workflowPath} geçersiz Alertmanager URL değerini loga sızdırmamalı.`);
    }
    if (!logs.includes("ALERT_WEBHOOK_URL must be a valid credential-free HTTPS URL.")) {
      output.push(`${workflowPath} geçersiz Alertmanager URL için generic hata döndürmeli.`);
    }
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

function checkOutboxVerifyWorkflowContract(output) {
  const workflow = readFileSync(outboxVerifyWorkflowPath, "utf8");
  for (const generatorPath of [identityMigrationGeneratorPath, financialRetentionGeneratorPath]) {
    const generator = readFileSync(generatorPath, "utf8");
    for (const token of [
      'client.query("BEGIN READ ONLY")',
      'client.query("SELECT set_config(\'app.bypass_rls\', \'true\', true)")',
      'client.query("ROLLBACK")',
      '"QUEUE_PREFIX"',
      'NODE_ENV: "test"',
      'PERSISTENCE_DRIVER: "memory"',
      'API_RATE_LIMIT_ENABLED: "false"',
      'API_RATE_LIMIT_STORE: "memory"',
      'LOGIN_ATTEMPT_LIMITER_STORE: "memory"',
      'QUEUE_METRICS_ENABLED: "false"',
      'REDIS_URL: "redis://127.0.0.1:1"',
      'REPORT_PDF_RENDERER: "memory"',
    ]) {
      if (!generator.includes(token)) {
        output.push(`${generatorPath} staging-safe generator token eksik: ${token}`);
      }
    }
  }
  for (const token of [
    "name: Staging Outbox Verify",
    "deploy_run_id:",
    "full_evidence:",
    "reuse_outbox_smoke_run_id:",
    "reuse_provider_smoke_run_id:",
    "ui_ux_approved_at:",
    "description: \"Also run the separate full production evidence aggregation.\"",
    "if: ${{ inputs.full_evidence }}",
    "if: ${{ success() && inputs.full_evidence }}",
    "if: ${{ failure() && inputs.full_evidence }}",
    "types: [labeled]",
    "github.event.label.name == 'staging-outbox-verify'",
    "vars.STAGING_OUTBOX_DEPLOY_RUN_ID",
    "name: staging-deployment-cutover-${{ inputs.deploy_run_id || vars.STAGING_OUTBOX_DEPLOY_RUN_ID }}",
    "run-id: ${{ inputs.deploy_run_id || vars.STAGING_OUTBOX_DEPLOY_RUN_ID }}",
    "scripts/check-deployment-cutover-evidence.mjs",
    "Validate selected deployment run metadata",
    ".github/workflows/staging-deploy.yml",
    "Bind selected deployment run to cutover source",
    "github.event.pull_request.head.sha",
    "eventName === \"pull_request\"",
    "Stage verifier-only evidence helpers",
    'verifier_root="$RUNNER_TEMP/gate-e-verifier"',
    "scripts/generate-identity-migration-evidence.mjs",
    "scripts/generate-financial-retention-evidence.mjs",
    "scripts/check-prod-evidence.mjs",
    "scripts/check-staging-release-artifacts.mjs",
    "scripts/smoke-isem-answer-key-live.mjs",
    "scripts/smoke-raw-import-upload-live.mjs",
    "clean: false",
    "Overlay verifier-only evidence helpers",
    "Validate staging verify environment",
    "Preflight current images and private outbox source",
    "Phase B private source missing for release",
    "OUTBOX_SOURCE_CLAIM_DIR=/root/o-okul-private/secret-delivery-outbox/.claims/",
    "mv -- \"$source_dir\" \"$SOURCE_CLAIM_DIR\"",
    "[ \"$STAGING_DEPLOY_DIR\" = \"/root/o-okul\" ]",
    "require_running_image web",
    "require_running_image api",
    "require_running_image worker",
    "require_running_image queue-board",
    "grep -Fxq 'ADMIN_MFA_MODE=required' .env",
    "o-okul-private/secret-delivery-outbox",
    "SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_FILE=/run/outbox-source/source-id",
    "Upload sanitized Phase B outbox evidence",
    "Reuse exact cutover-bound sanitized outbox smoke",
    "staging-outbox-smoke-${{ inputs.deploy_run_id || vars.STAGING_OUTBOX_DEPLOY_RUN_ID }}-${{ inputs.reuse_outbox_smoke_run_id }}",
    "staging-outbox-smoke-${{ inputs.deploy_run_id || vars.STAGING_OUTBOX_DEPLOY_RUN_ID }}-${{ github.run_id }}",
    "staging-activation-evidence-${{ env.CUTOVER_SOURCE_SHA }}",
    "staging-outbox-verify-${{ inputs.deploy_run_id || vars.STAGING_OUTBOX_DEPLOY_RUN_ID }}-${{ inputs.reuse_provider_smoke_run_id }}",
    "PRODUCTION_EVIDENCE_ALLOW_STAGING=1",
    "pnpm staging:evidence-env:check -- --mode full --env-file .staging-evidence.env",
    "Bind verified UI/UX completion to full evidence",
    "UI_UX_PROFESSIONALIZATION_FULL_EVIDENCE: \"1\"",
    "run: pnpm ui-ux-professionalization:completion:check",
    "-v \"$source_dir:/run/outbox-source:ro\"",
    "WORKER_IMAGE=\"$expected_worker_image\" docker compose",
    "require_running_worker_image",
    "require_running_worker_image # post-smoke exact-image gate",
    "rm -f -- \"$SOURCE_CLAIM_DIR/source-id\"",
    "rmdir -- \"$SOURCE_CLAIM_DIR\" 2>/dev/null || true",
    "Remove private outbox verification material",
    "if: ${{ always() }}",
    "Clean local verification secrets",
    "STAGING_SSH_KEY_PATH=$RUNNER_TEMP/staging_deploy_key",
    "scripts/isem-optical-pipeline-contract.mjs",
    "docs/evidence-manifests/isem-optical-pipeline-inputs.json",
    "-v \"$OUTBOX_VERIFY_HELPERS_DIR:/app/docs/evidence-manifests:ro\"",
    "trap 'rm -f -- .staging-evidence.env \"$runtime_env\"' EXIT",
    "sed -i 's/^ADMIN_MFA_MODE=.*/ADMIN_MFA_MODE=required/' .staging-evidence.env",
    "sed -i 's/^NOTIFICATION_SMOKE_PUSH_TO=.*/NOTIFICATION_SMOKE_PUSH_TO=/' .staging-evidence.env",
    "grep -Fxq 'NOTIFICATION_SMOKE_PUSH_TO=' .staging-evidence.env",
    "umask 077",
    "staging-runtime-required.env",
    "APP_URL API_URL WEB_URL DOMAIN CF_DNS_API_TOKEN_FILE LEGACY_TENANT_LOGIN_CUTOFF_AT NOTIFICATION_FROM_EMAIL NOTIFICATION_REPLY_TO_EMAIL NOTIFICATION_SMOKE_EMAIL_TO TRAEFIK_HTTPS_SMOKE_URL DATABASE_URL DIRECT_DATABASE_URL DOCKER_DATABASE_URL DOCKER_DIRECT_DATABASE_URL SECRET_DELIVERY_WORKER_DB_PASSWORD SECRET_DELIVERY_OUTBOX_DATABASE_URL DOCKER_SECRET_DELIVERY_OUTBOX_DATABASE_URL REDIS_URL",
    "chmod 600 .staging-evidence.env",
    "UI_UX_REDESIGN_APPROVED_AT=$UI_UX_APPROVED_AT_INPUT",
    "const expectedRunUrl = `https://github.com/${repository}/actions/runs/${runId}`;",
    "references[1] = `run:${githubCi.workflow.runUrl}`;",
    "deployment-rollback-source.json",
    "pnpm deployment:rollback:check",
    "scripts/generate-deployment-rollback-evidence.mjs",
    "Historical rollback report current fallback image ile zincirlenemedi.",
    "DEPLOYMENT_ROLLBACK_SOURCE_RUN_URL",
    "DEPLOYMENT_ROLLBACK_TARGET=file://$PWD/artifacts/staging/reports/deployment-rollback.json",
    "echo \"ROLLBACK_IMAGE_TAG=$rollback_image_tag\"",
    "run_gate_e_live_uat_rls",
    "run_gate_e_data_safety_reconciliation",
    "run_gate_e_observability_alert_drill",
    "full_evidence requires run_gate_e_mutating_smokes=true; stale iSEM/UI/rate-limit artifacts cannot be promoted.",
    "full_evidence requires run_gate_e_live_uat_rls=true; stale onboarding/RLS artifacts cannot be promoted.",
    "full_evidence requires run_gate_e_data_safety_reconciliation=true; stale restore/inline-upload artifacts cannot be promoted.",
    "full_evidence requires run_gate_e_observability_alert_drill=true; stale alert delivery artifacts cannot be promoted.",
    "corepack pnpm live:onboarding:smoke",
    "Live onboarding sentetik tenant/session temizliği geçti",
    "RLS_LIVE_OUTPUT=artifacts/staging/reports/rls-live.json",
    "scripts/generate-rls-live-evidence.mjs",
    "scripts/generate-audit-null-tenant-evidence.mjs",
    "scripts/generate-restore-drill-evidence.mjs",
    "scripts/run-observability-alert-drill.mjs",
    "OBSERVABILITY_UAT_NOT_BEFORE=\"$CUTOVER_AT\"",
    "SMS_ENABLED=false",
    "packages/db/scripts/check-rls-live.mjs",
    "RLS_LIVE_EVIDENCE_TARGET=file://$PWD/artifacts/staging/reports/rls-live.json",
    "LIVE_ONBOARDING_RESULT_TARGET=\"file://$PWD/artifacts/staging/reports/live-onboarding.json\"",
    "pnpm live:onboarding:result-check",
    "Gate E sentetik tenant/session temizliği geçti",
    "UAT_SOURCE_SHA=\"$CUTOVER_SOURCE_SHA\"",
    "UAT_VERIFIER_RUN_URL=\"$verifier_run_url\"",
    "UAT_GITHUB_CI_RUN_URL=\"$github_ci_run_url\"",
    "SECURITY_AUDIT_RLS_LIVE_REFERENCE=artifact:artifacts/staging/reports/rls-live.json",
    "SENTRY_SMOKE_NOT_BEFORE=$CUTOVER_AT",
    "ALERT_WEBHOOK_SMOKE_NOT_BEFORE=$CUTOVER_AT",
    "cmp -s artifacts/provider-smoke-reuse/reports/deployment-cutover.json artifacts/cutover/deployment-cutover.json",
    "artifacts/activation/smoke/wal-archive.json",
    "IDENTITY_MIGRATION_OUTPUT=artifacts/staging/reports/identity-migration.json",
    "node --env-file=.staging-evidence.env scripts/generate-identity-migration-evidence.mjs",
    "FINANCIAL_RETENTION_OUTPUT=artifacts/staging/reports/financial-retention.json",
    "node --env-file=.staging-evidence.env scripts/generate-financial-retention-evidence.mjs",
    "SECURITY_AUDIT_OUTPUT=artifacts/staging/reports/security-audit.json",
    "node --env-file=.staging-evidence.env scripts/generate-security-audit-evidence.mjs",
    "Install Chromium for public staging UI evidence",
    "pnpm --filter @o-okul/web exec playwright install --with-deps chromium",
    "NEXT_E2E_BASE_URL=https://o-okul.com",
    "UI_VISUAL_IGNORE_CLOUDFLARE_BEACON_CSP=1",
    "UI_VISUAL_ARTIFACT_DIR=\"$RUNNER_TEMP/gate-e-ui-captures\"",
    "e2e-next/ui-visual-qa-next.spec.ts --grep \"kurum dashboard|sistem dashboard|sistem kurum yönetimi|rol portal aksiyon şeritleri|rapor çalışma alanı|optik workflow\"",
    "scripts/prepare-ui-ux-redesign-staging-artifacts.mjs",
    "--output-dir artifacts/staging/ui-ux-redesign",
    "IDENTITY_MIGRATION_TARGET=file://$PWD/artifacts/staging/reports/identity-migration.json",
    "FINANCIAL_RETENTION_TARGET=file://$PWD/artifacts/staging/reports/financial-retention.json",
    "SECURITY_AUDIT_TARGET=file://$PWD/artifacts/staging/reports/security-audit.json",
    "Recheck exact images before publishing verification",
    "artifacts/staging/reports/runtime-parity.json",
    "Finalize verified release summary",
    "summary.canPromote = true",
    "Generate exact release evidence manifest",
    "scripts/generate-release-evidence-manifest.mjs",
    "scripts/check-release-evidence-manifest.mjs",
    "release-evidence-manifest.json",
    "Check verified staging release artifact bundle",
    "Invalidate unverified release summary",
    "summary.canPromote = false",
    "--reuse-sentry-smoke",
    "--reuse-alert-webhook-smoke",
    "--reuse-wal-smoke",
    "staging-outbox-verify-${{ inputs.deploy_run_id || vars.STAGING_OUTBOX_DEPLOY_RUN_ID }}-${{ github.run_id }}",
    "path: |",
    "!artifacts/staging/private/**",
    "scripts/smoke-secret-delivery-outbox-staging.mjs",
    "scripts/check-secret-delivery-outbox-evidence.mjs",
  ]) {
    if (!workflow.includes(token)) output.push(`${outboxVerifyWorkflowPath} token eksik: ${token}`);
  }
  if (workflow.match(/SECRET_DELIVERY_OUTBOX_SMOKE_SOURCE_ID|inputs\.source|secrets\..*SOURCE/i)) {
    output.push(`${outboxVerifyWorkflowPath} source ID GitHub input/secret olarak taşımamalı.`);
  }
  if (workflow.split("if: ${{ inputs.full_evidence }}").length - 1 !== 8) {
    output.push(`${outboxVerifyWorkflowPath} full evidence adımları tam olarak sekiz explicit koşulla ayrılmalı.`);
  }
  for (const outputToken of [
    "IDENTITY_MIGRATION_OUTPUT=artifacts/staging/reports/identity-migration.json",
    "FINANCIAL_RETENTION_OUTPUT=artifacts/staging/reports/financial-retention.json",
    "SECURITY_AUDIT_OUTPUT=artifacts/staging/reports/security-audit.json",
  ]) {
    const index = workflow.indexOf(outputToken);
    if (index === -1 || !workflow.slice(Math.max(0, index - 80), index).includes("STAGING_ENVIRONMENT=staging")) {
      output.push(`${outboxVerifyWorkflowPath} ${outputToken} staging environment bağıyla çalışmalı.`);
    }
  }
  if (workflow.split("scripts/prepare-ui-ux-redesign-staging-artifacts.mjs").length - 1 !== 3) {
    output.push(`${outboxVerifyWorkflowPath} UI/UX hazırlayıcıyı iki helper overlay ve bir execution bağıyla taşımalı.`);
  }
  for (const helper of ["scripts/smoke-isem-answer-key-live.mjs", "scripts/smoke-raw-import-upload-live.mjs"]) {
    if (workflow.split(helper).length - 1 !== 2) {
      output.push(`${outboxVerifyWorkflowPath} ${helper} iki verifier helper listesinde de taşınmalı.`);
    }
    const source = readFileSync(helper, "utf8");
    for (const token of [
      "process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? \"unknown\"",
      "resolveSmokePassword(process.env.ISEM_OPTICAL_PIPELINE_SMOKE_PASSWORD)",
      '["staging", "production"].includes(environment.toLowerCase())',
      "configuredPassword.length < 16",
      "/password|qwerty|12345678|admin123/i",
      'INSERT INTO "LicenseTerm"',
      '"licenseStartsAt"',
      '"licenseEndsAt"',
    ]) {
      if (!source.includes(token)) output.push(`${helper} release smoke sözleşmesi eksik: ${token}`);
    }
    if (source.includes('const smokePassword = "password"')) {
      output.push(`${helper} release smoke için sabit varsayılan parola kullanmamalı.`);
    }
  }
  requireWorkflowOrder(output, workflow, "outbox source claim ve cleanup sırası", [
    "Bind selected deployment run to cutover source",
    "clean: false",
    "Validate staging verify environment",
    "Configure SSH",
    "Preflight current images and private outbox source",
    "mv -- \"$source_dir\" \"$SOURCE_CLAIM_DIR\"",
    "pnpm/action-setup@v4",
    "pnpm install --frozen-lockfile",
    "Open staging data tunnels for aggregate checks",
    "Upload cutover-bound smoke helpers",
    "Run private outbox smoke",
    "WORKER_IMAGE=\"$expected_worker_image\" docker compose",
    "require_running_worker_image # post-smoke exact-image gate",
    "Upload sanitized Phase B outbox evidence",
    "Remove private outbox verification material",
    "rm -f -- \"$SOURCE_CLAIM_DIR/source-id\"",
    "Clean local verification secrets",
  ]);
  requireWorkflowOrder(output, workflow, "verifier helper ve exact target checkout sırası", [
    "Bind selected deployment run to cutover source",
    "Stage verifier-only evidence helpers",
    "ref: ${{ env.CUTOVER_SOURCE_SHA }}",
    "clean: false",
    "Overlay verifier-only evidence helpers",
    "[ \"$(git rev-parse HEAD)\" = \"$CUTOVER_SOURCE_SHA\" ]",
    "Validate staging verify environment",
  ]);
  if ((workflow.match(/\[ "\$\(git rev-parse HEAD\)" = "\$CUTOVER_SOURCE_SHA" \]/g) ?? []).length !== 1) {
    output.push(`${outboxVerifyWorkflowPath} git checkout exact-SHA kontrolünü yalnız GitHub runner checkout'unda kullanmalı.`);
  }
  for (const releaseBinding of [
    '"WEB_IMAGE=ghcr.io/$GITHUB_REPOSITORY/web:$CUTOVER_SOURCE_SHA"',
    '"API_IMAGE=ghcr.io/$GITHUB_REPOSITORY/api:$CUTOVER_SOURCE_SHA"',
    '"WORKER_IMAGE=ghcr.io/$GITHUB_REPOSITORY/worker:$CUTOVER_SOURCE_SHA"',
    '"QUEUE_BOARD_IMAGE=ghcr.io/$GITHUB_REPOSITORY/queue-board:$CUTOVER_SOURCE_SHA"',
    '"SENTRY_RELEASE=$CUTOVER_SOURCE_SHA"',
  ]) {
    if (workflow.split(releaseBinding).length - 1 !== 3) {
      output.push(`${outboxVerifyWorkflowPath} üç uzak Gate E mutasyon bloğunda exact release bağı eksik: ${releaseBinding}`);
    }
  }
  if ((workflow.match(/scripts\/check-staging-release-artifacts\.mjs/g) ?? []).length !== 2) {
    output.push("Staging release artifact checker verifier helper stage ve overlay listelerinde tam iki kez bulunmalı.");
  }
  if ((workflow.match(/^\s+package\.json \\$/gmu) ?? []).length !== 2) {
    output.push("Verifier-only package script yüzeyi stage ve overlay listelerinde tam iki kez bulunmalı.");
  }
  for (const helper of ["scripts/check-release-evidence-manifest.mjs", "scripts/generate-release-evidence-manifest.mjs"]) {
    if (workflow.split(helper).length - 1 !== 3) {
      output.push(`${helper} verifier stage, overlay ve execution için tam üç kez bulunmalı.`);
    }
  }
  requireWorkflowOrder(output, workflow, "final promotion ve başarısız summary sırası", [
    "summary.canPromote = false",
    "Recheck exact images before publishing verification",
    "artifacts/staging/reports/runtime-parity.json",
    "Finalize verified release summary",
    "summary.canPromote = true",
    "Generate exact release evidence manifest",
    "Check verified staging release artifact bundle",
    "Invalidate unverified release summary",
    "if: ${{ success() && inputs.full_evidence }}",
    "actions/upload-artifact@v4",
  ]);
  requireWorkflowOrder(output, workflow, "full evidence runtime env birleştirme sırası", [
    "Run configured production evidence aggregation",
    'runtime_env="$RUNNER_TEMP/staging-runtime-required.env"',
    "trap 'rm -f -- .staging-evidence.env \"$runtime_env\"' EXIT",
    'ssh -i "$STAGING_SSH_KEY_PATH"',
    'chmod 600 "$runtime_env"',
    "node --input-type=module - .staging-evidence.env \"$runtime_env\"",
    "pnpm staging:evidence-env:check -- --mode full --env-file .staging-evidence.env",
  ]);
  requireWorkflowOrder(output, workflow, "historical rollback yeniden bağlama sırası", [
    'rollback_source="$RUNNER_TEMP/deployment-rollback-source.json"',
    "pnpm deployment:rollback:check",
    'rollback_image_tag="$(ssh -i "$STAGING_SSH_KEY_PATH"',
    "Historical rollback report current fallback image ile zincirlenemedi.",
    "scripts/generate-deployment-rollback-evidence.mjs",
    "DEPLOYMENT_ROLLBACK_TARGET=file://$PWD/artifacts/staging/reports/deployment-rollback.json",
    "echo \"ROLLBACK_IMAGE_TAG=$rollback_image_tag\"",
  ]);
  requireWorkflowOrder(output, workflow, "public cutover UI artifact sırası", [
    "node --env-file=.staging-evidence.env scripts/generate-security-audit-evidence.mjs",
    "NEXT_E2E_BASE_URL=https://o-okul.com",
    "UI_VISUAL_IGNORE_CLOUDFLARE_BEACON_CSP=1",
    "e2e-next/ui-visual-qa-next.spec.ts --grep",
    "node scripts/prepare-ui-ux-redesign-staging-artifacts.mjs",
    "--output-dir artifacts/staging/ui-ux-redesign",
    "UI_UX_REDESIGN_EVIDENCE_OUTPUT=\"artifacts/staging/reports/ui-ux-redesign.json\"",
    "pnpm ui-ux-redesign:evidence-generate",
    "pnpm prod:evidence:check",
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

function checkActivationEnv(env, output) {
  if (env.get("NODE_ENV") !== "production") {
    output.push("NODE_ENV activation için production olmalı.");
  }
  if (env.get("SENTRY_ENVIRONMENT") !== "staging") {
    output.push("SENTRY_ENVIRONMENT activation için staging olmalı.");
  }
  if (env.get("WHATSAPP_ENABLED") !== "false") {
    output.push("WHATSAPP_ENABLED activation için false olmalı.");
  }

  const webUrl = checkActivationUrl(env.get("WEB_URL"), output, "WEB_URL");
  const traefikUrl = checkActivationUrl(env.get("TRAEFIK_HTTPS_SMOKE_URL"), output, "TRAEFIK_HTTPS_SMOKE_URL");
  checkActivationUrl(env.get("ALERT_WEBHOOK_URL"), output, "ALERT_WEBHOOK_URL");

  if (webUrl && traefikUrl && webUrl.origin !== traefikUrl.origin) {
    output.push("TRAEFIK_HTTPS_SMOKE_URL activation için WEB_URL origin'iyle eşleşmeli.");
  }

  const alertToken = String(env.get("ALERT_WEBHOOK_TOKEN") ?? "");
  if (alertToken.length < 32) {
    output.push("ALERT_WEBHOOK_TOKEN activation için en az 32 karakterlik gerçek bearer secret olmalı.");
  }
}

function checkActivationUrl(value, output, key) {
  let url;
  try {
    url = new URL(String(value ?? ""));
  } catch {
    output.push(`${key} activation için geçerli URL olmalı.`);
    return undefined;
  }

  let valid = true;
  if (url.protocol !== "https:") {
    output.push(`${key} activation için https olmalı.`);
    valid = false;
  }
  if (url.username || url.password || url.search || url.hash) {
    output.push(`${key} activation için userinfo, query veya fragment içeremez.`);
    valid = false;
  }
  if (isPlaceholderOrLocalHost(url.hostname)) {
    output.push(`${key} activation için gerçek bir host kullanmalı.`);
    valid = false;
  }
  return valid ? url : undefined;
}

function isPlaceholderOrLocalHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.") ||
    normalized === "::1" ||
    normalized === "0.0.0.0" ||
    normalized.endsWith(".test") ||
    normalized.endsWith(".example") ||
    normalized.endsWith(".invalid") ||
    normalized.includes("example") ||
    normalized.includes("__set")
  );
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
