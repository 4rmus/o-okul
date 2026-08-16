import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, parse, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ISEM_OPTICAL_PIPELINE_FIXTURE } from "./isem-optical-pipeline-contract.mjs";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";

const positionalArtifactsTarget = process.argv[2]?.startsWith("--") ? undefined : process.argv[2];
const artifactsTarget =
  process.env.STAGING_RELEASE_ARTIFACTS_TARGET ?? readArgValue("--artifacts-dir") ?? positionalArtifactsTarget;
const gapReportTarget = process.env.STAGING_RELEASE_GAP_REPORT_FILE ?? readArgValue("--gap-report-file");
const allowExampleEvidence = process.env.STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE === "1";
const artifactsDirParentSymlinkError = "artifactsDir parent dizini symlink olmayan dizin olmalı.";
const artifactsDirTempPathError = "STAGING_RELEASE_ARTIFACTS_TARGET lokal temp path altında olmamalı.";

const smokeArtifacts = new Map([
  ["traefikHttps", { file: "traefik-https.json", check: "traefik_https_smoke" }],
  ["smsProvider", { file: "sms-provider.json", check: "sms_provider_smoke" }],
  ["notificationProvider", { file: "notification-provider.json", check: "notification_provider_smoke" }],
  ["sentryEvent", { file: "sentry-event.json", check: "sentry_smoke" }],
  ["alertWebhook", { file: "alert-webhook.json", check: "alert_webhook_smoke" }],
  ["walArchive", { file: "wal-archive.json", check: "wal_archive_smoke" }],
  ["reportGeneration", { file: "report-generation.json", check: "report_generation_smoke" }],
  ["secretDeliveryOutbox", { file: "secret-delivery-outbox.json", check: "secret_delivery_outbox_staging_smoke" }],
]);
const firstGateSummaryKeys = new Map([
  ["Traefik HTTPS smoke", "traefikHttps"],
  ["Alert webhook smoke", "alertWebhook"],
]);
const firstGateSummaryMatchFields = new Map([
  ["traefikHttps", ["url", "expectedStatus", "statusCode", "strictTransportSecurity"]],
  ["alertWebhook", ["webhookUrl", "statusCode", "authorizationScheme"]],
]);
const uiUxArtifactFiles = [
  "summary.json",
  "uat.json",
  "privacy-review.json",
  ...Array.from({ length: 6 }, (_, index) => `phase-${index}.json`),
  ...["dashboard", "system", "system-tenants", "optik", "rapor", "portal"].flatMap((surface) =>
    [320, 375, 414, 768, 1024, 1440].map((width) => `${surface}-${width}.png`),
  ),
];
const supportingReportArtifacts = ["db-rls-check.log", "db-rls-check-live.log", "rls-load-smoke.json"];
const reportArtifacts = new Map([
  [
    "restoreDrill",
    {
      file: "restore-drill.json",
      script: "scripts/check-restore-drill-evidence.mjs",
      targetEnv: "RESTORE_DRILL_TARGET",
      allowEnv: "RESTORE_DRILL_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "deploymentRollback",
    {
      file: "deployment-rollback.json",
      script: "scripts/check-deployment-rollback-evidence.mjs",
      targetEnv: "DEPLOYMENT_ROLLBACK_TARGET",
      allowEnv: "DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "githubCi",
    {
      file: "github-ci.json",
      script: "scripts/check-github-ci-evidence.mjs",
      targetEnv: "GITHUB_CI_EVIDENCE_TARGET",
      allowEnv: "GITHUB_CI_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "kvkkInventory",
    {
      file: "kvkk-inventory.json",
      script: "scripts/check-kvkk-inventory-evidence.mjs",
      targetEnv: "KVKK_INVENTORY_TARGET",
      allowEnv: "KVKK_INVENTORY_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "identityMigration",
    {
      file: "identity-migration.json",
      script: "scripts/check-identity-migration-evidence.mjs",
      targetEnv: "IDENTITY_MIGRATION_TARGET",
      allowEnv: "IDENTITY_MIGRATION_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "financialRetention",
    {
      file: "financial-retention.json",
      script: "scripts/check-financial-retention-evidence.mjs",
      targetEnv: "FINANCIAL_RETENTION_TARGET",
      allowEnv: "FINANCIAL_RETENTION_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "uploadAv",
    {
      file: "upload-av.json",
      script: "scripts/check-upload-av-evidence.mjs",
      targetEnv: "UPLOAD_AV_TARGET",
      allowEnv: "UPLOAD_AV_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "observabilityUat",
    {
      file: "observability-uat.json",
      script: "scripts/check-observability-uat-evidence.mjs",
      targetEnv: "OBSERVABILITY_UAT_TARGET",
      allowEnv: "OBSERVABILITY_UAT_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "adminMfa",
    {
      file: "admin-mfa.json",
      script: "scripts/check-admin-mfa-evidence.mjs",
      targetEnv: "ADMIN_MFA_EVIDENCE_TARGET",
      allowEnv: "ADMIN_MFA_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "securityAudit",
    {
      file: "security-audit.json",
      script: "scripts/check-security-audit-evidence.mjs",
      targetEnv: "SECURITY_AUDIT_TARGET",
      allowEnv: "SECURITY_AUDIT_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "liveExamCycle",
    {
      file: "live-exam-cycle.json",
      script: "scripts/check-live-exam-cycle-evidence.mjs",
      targetEnv: "LIVE_EXAM_CYCLE_TARGET",
      allowEnv: "LIVE_EXAM_CYCLE_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "isemOpticalPipeline",
    {
      file: "isem-optical-pipeline.json",
      script: "scripts/check-isem-optical-pipeline-evidence.mjs",
      targetEnv: "ISEM_OPTICAL_PIPELINE_TARGET",
      allowEnv: "ISEM_OPTICAL_PIPELINE_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "liveUiWorkerResult",
    {
      file: "live-ui-worker-result.json",
      script: "scripts/check-live-ui-worker-result-evidence.mjs",
      targetEnv: "LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET",
      allowEnv: "LIVE_UI_WORKER_RESULT_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "uiUxRedesign",
    {
      file: "ui-ux-redesign.json",
      script: "scripts/check-ui-ux-redesign-evidence.mjs",
      targetEnv: "UI_UX_REDESIGN_EVIDENCE_TARGET",
      allowEnv: "UI_UX_REDESIGN_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "inlineUploadMigration",
    {
      file: "inline-upload-content-migration.json",
      script: "scripts/check-inline-upload-content-migration-evidence.mjs",
      targetEnv: "INLINE_UPLOAD_CONTENT_MIGRATION_TARGET",
      allowEnv: "INLINE_UPLOAD_CONTENT_MIGRATION_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "auditNullTenant",
    {
      file: "audit-null-tenant.json",
      script: "scripts/check-audit-null-tenant-evidence.mjs",
      targetEnv: "AUDIT_NULL_TENANT_EVIDENCE_TARGET",
      allowEnv: "AUDIT_NULL_TENANT_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "rateLimit",
    {
      file: "rate-limit.json",
      script: "scripts/check-rate-limit-evidence.mjs",
      targetEnv: "RATE_LIMIT_EVIDENCE_TARGET",
      allowEnv: "RATE_LIMIT_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "rlsLive",
    {
      file: "rls-live.json",
      script: "scripts/check-rls-live-evidence.mjs",
      targetEnv: "RLS_LIVE_EVIDENCE_TARGET",
      allowEnv: "RLS_LIVE_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "uat",
    {
      file: "uat.json",
      script: "scripts/check-uat-evidence.mjs",
      targetEnv: "UAT_EVIDENCE_TARGET",
      allowEnv: "UAT_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
  [
    "runtimeParity",
    {
      file: "runtime-parity.json",
      script: "scripts/check-runtime-parity-evidence.mjs",
      targetEnv: "RUNTIME_PARITY_EVIDENCE_TARGET",
    },
  ],
  [
    "liveOnboarding",
    {
      file: "live-onboarding.json",
      script: "scripts/check-live-onboarding-result.mjs",
      targetEnv: "LIVE_ONBOARDING_RESULT_TARGET",
      allowEnv: "LIVE_ONBOARDING_RESULT_ALLOW_EXAMPLE_EVIDENCE",
    },
  ],
]);
const deploymentCutoverArtifact = {
  file: "deployment-cutover.json",
  script: "scripts/check-deployment-cutover-evidence.mjs",
  targetEnv: "DEPLOYMENT_CUTOVER_EVIDENCE_TARGET",
  allowEnv: "DEPLOYMENT_CUTOVER_ALLOW_EXAMPLE_EVIDENCE",
};
const githubCiSummaryKeys = [
  "environment",
  "checkedAt",
  "repository",
  "commitSha",
  "branch",
  "workflow",
  "command",
  "jobs",
  "commandsPassed",
  "evidenceReferences",
];
const forbiddenArtifactFileNames = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".staging-evidence.env",
  "staging-evidence.env",
  ".ghcr_read_token",
  "ghcr_read_token",
]);
const missingArtifactRemediation = new Map([
  [
    "first-gates/first-gates-manifest.json",
    {
      command:
        "corepack pnpm staging:first-gates:smoke -- --env-file .staging-evidence.env --output-dir artifacts/staging/first-gates",
      prerequisite: "Public TLS/HSTS Traefik URL and real alert webhook credentials must pass first-gates smoke.",
      blocker: "Self-signed/IP TLS or missing alert webhook secrets are not release evidence.",
    },
  ],
  [
    "reports/restore-drill.json",
    {
      command: "RESTORE_DRILL_OUTPUT=artifacts/staging/reports/restore-drill.json corepack pnpm restore:drill:generate",
      prerequisite: "Off-host backup restore drill, critical table counts, RLS check, and restored app health evidence.",
      blocker: "A restore drill report must come from a real restored staging database, not a template.",
    },
  ],
  [
    "reports/deployment-rollback.json",
    {
      command:
        "DEPLOYMENT_ROLLBACK_OUTPUT=artifacts/staging/reports/deployment-rollback.json corepack pnpm deployment:rollback:generate",
      prerequisite: "Failure-injection or exact-SHA cold rollback/restore drill, current rollback image, approval, and service health references.",
      blocker: "No real rollback drill or linked source/rollback/restore evidence references are present.",
    },
  ],
  [
    "reports/github-ci.json",
    {
      command: "GITHUB_CI_EVIDENCE_OUTPUT=artifacts/staging/reports/github-ci.json corepack pnpm github-ci:generate",
      prerequisite: "GitHub Actions workflow run for the release commit with required jobs passing.",
      blocker: "A local/static CI fixture is not a release CI artifact.",
    },
  ],
  [
    "reports/deployment-cutover.json",
    {
      command: "Staging Outbox Verify selected deploy_run_id artifact'ini indirir ve scripts/check-deployment-cutover-evidence.mjs ile doğrular.",
      prerequisite: "Başarılı Staging Deploy run'ı ve cutover artifact'i aynı source SHA/tag ile mevcut olmalı.",
      blocker: "Cutover artifact olmadan outbox smoke yeni release'e bağlanamaz.",
    },
  ],
  [
    "reports/kvkk-inventory.json",
    {
      command: "KVKK_INVENTORY_TARGET=file:///.../kvkk-inventory.json corepack pnpm privacy:inventory:check",
      prerequisite: "Staging PII inventory and redaction/audit negative checks from the live database.",
      blocker: "KVKK inventory must be linked from the same staging artifact bundle.",
    },
  ],
  [
    "reports/identity-migration.json",
    {
      command: "IDENTITY_MIGRATION_OUTPUT=artifacts/staging/reports/identity-migration.json corepack pnpm identity-migration:generate",
      prerequisite: "Approved activation mode, subject counts, invitation flow, and wrong-role/cross-tenant negative evidence.",
      blocker: "Migration approval/reference and real staging subject counts are required.",
    },
  ],
  [
    "reports/financial-retention.json",
    {
      command: "FINANCIAL_RETENTION_OUTPUT=artifacts/staging/reports/financial-retention.json corepack pnpm financial-retention:generate",
      prerequisite: "Finance/KVKK retention approval, legal basis, retention period, and payment purge behavior evidence.",
      blocker: "Policy approval fields and live financial record evidence are not linked into the bundle.",
    },
  ],
  [
    "reports/upload-av.json",
    {
      command:
        "docker compose --profile av up -d clamav && CLAMAV_HOST=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' o-okul-clamav-1) env -u DATABASE_URL -u DIRECT_DATABASE_URL -u NODE_ENV -u ADMIN_MFA_MODE STAGING_ENVIRONMENT=staging UPLOAD_AV_OUTPUT=artifacts/staging/reports/upload-av.json UPLOAD_AV_SCANNER=clamav UPLOAD_AV_SCANNER_DECISION_MODE=local UPLOAD_AV_APPROVED_BY=... UPLOAD_AV_APPROVAL_REFERENCE=... UPLOAD_AV_SCANNER_NAME=ClamAV UPLOAD_AV_FAIL_CLOSED=true UPLOAD_AV_CLEAN_FILE_ACCEPTED=true UPLOAD_AV_EICAR_REJECTED=true UPLOAD_AV_SCANNER_UNAVAILABLE_REJECTED=true CLAMAV_HOST=$CLAMAV_HOST CLAMAV_PORT=3310 CLAMAV_TIMEOUT_MS=10000 UPLOAD_AV_UNAVAILABLE_TEST_HOST=127.0.0.1 UPLOAD_AV_UNAVAILABLE_TEST_PORT=9 corepack pnpm upload-av:generate",
      prerequisite: "Running ClamAV/provider scanner plus clean, EICAR, and scanner-unavailable fail-closed smoke.",
      blocker: "Scanner service evidence is missing.",
    },
  ],
  [
    "reports/observability-uat.json",
    {
      command: "OBSERVABILITY_UAT_OUTPUT=artifacts/staging/reports/observability-uat.json corepack pnpm observability:uat:generate",
      prerequisite: "Prometheus, Grafana, Loki readiness plus alert webhook delivery evidence.",
      blocker: "Real observability endpoints and dashboard/alert references are not linked.",
    },
  ],
  [
    "reports/admin-mfa.json",
    {
      command: "ADMIN_MFA_OUTPUT=artifacts/staging/reports/admin-mfa.json corepack pnpm admin-mfa:generate",
      prerequisite: "Admin MFA enrollment, TOTP/recovery reuse negatives, and session revoke verification.",
      blocker: "Real admin enrollment and login verification evidence references are required.",
    },
  ],
  [
    "reports/security-audit.json",
    {
      command: "SECURITY_AUDIT_OUTPUT=artifacts/staging/reports/security-audit.json corepack pnpm security:audit:generate",
      prerequisite: "Production env, token storage, RLS live, health/readiness, and HTTPS security header checks.",
      blocker: "Public HTTPS/header targets and auth/data control evidence references are missing.",
    },
  ],
  [
    "reports/live-exam-cycle.json",
    {
      command: "LIVE_EXAM_CYCLE_TARGET=file:///.../live-exam-cycle.json corepack pnpm live:exam-cycle:check",
      prerequisite: "Real iSEM exam cycle artifact with import, scoring, snapshot, PDF/Excel, and portal checks.",
      blocker: "The artifact must be present under reports/ and linked into the same release bundle.",
    },
  ],
  [
    "reports/isem-optical-pipeline.json",
    {
      command: "ISEM_OPTICAL_PIPELINE_TARGET=file:///.../isem-optical-pipeline.json corepack pnpm isem-optical-pipeline:evidence-check",
      prerequisite: `iSEM optical pipeline artifact with ${ISEM_OPTICAL_PIPELINE_FIXTURE.examResultCount} expected results and no raw PII leakage.`,
      blocker: "The artifact must be present under reports/ and match the release summary.",
    },
  ],
  [
    "reports/live-ui-worker-result.json",
    {
      command: "LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET=file:///.../live-ui-worker-result.json corepack pnpm live:ui-worker:result-check",
      prerequisite: "UI worker result artifact with READY report, PDF/XLSX downloads, and portal visibility.",
      blocker: "The result artifact must be present under reports/ and remain PII-safe.",
    },
  ],
  [
    "reports/ui-ux-redesign.json",
    {
      command:
        "UI_UX_REDESIGN_EVIDENCE_OUTPUT=artifacts/staging/reports/ui-ux-redesign.json corepack pnpm ui-ux-redesign:evidence-generate -- --env-file .staging-evidence.env",
      prerequisite: "Staging/prod UI/UX redesign viewport coverage, PII review, UAT, live onboarding, and live UI-worker references.",
      blocker: "Generator input references must point to real staging/prod artifacts; local/mock screenshots alone are not release evidence.",
    },
  ],
  [
    "reports/inline-upload-content-migration.json",
    {
      command:
        "INLINE_UPLOAD_CONTENT_HASH_AUDIT_OUTPUT=artifacts/staging/reports/inline-upload-work/hash-audit.json corepack pnpm inline-upload-content:hash-audit && INLINE_UPLOAD_CONTENT_SHA_REPAIR_OUTPUT=artifacts/staging/reports/inline-upload-work/sha-repair-dry-run.json corepack pnpm inline-upload-content:repair-sha && INLINE_UPLOAD_CONTENT_SHA_REPAIR_APPROVED=true INLINE_UPLOAD_CONTENT_SHA_REPAIR_OUTPUT=artifacts/staging/reports/inline-upload-work/sha-repair-approved.json corepack pnpm inline-upload-content:repair-sha && INLINE_UPLOAD_CONTENT_HASH_AUDIT_OUTPUT=artifacts/staging/reports/inline-upload-work/hash-audit-after-repair.json corepack pnpm inline-upload-content:hash-audit && INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE=artifacts/staging/reports/inline-upload-work/dry-run.json corepack pnpm inline-upload-content:audit && INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true INLINE_UPLOAD_CONTENT_MIGRATION_REPORT_FILE=artifacts/staging/reports/inline-upload-work/migrated.json corepack pnpm inline-upload-content:migrate && INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_OUTPUT=artifacts/staging/reports/inline-upload-work/orphan-audit-after-migration.json corepack pnpm inline-upload-content:orphan-audit && INLINE_UPLOAD_CONTENT_DRY_RUN_TARGET=file://$PWD/artifacts/staging/reports/inline-upload-work/dry-run.json INLINE_UPLOAD_CONTENT_APPROVED_MIGRATION_TARGET=file://$PWD/artifacts/staging/reports/inline-upload-work/migrated.json INLINE_UPLOAD_CONTENT_ORPHAN_AUDIT_TARGET=file://$PWD/artifacts/staging/reports/inline-upload-work/orphan-audit-after-migration.json INLINE_UPLOAD_CONTENT_MIGRATION_OUTPUT=artifacts/staging/reports/inline-upload-content-migration.json INLINE_UPLOAD_CONTENT_APPROVED_BY=... INLINE_UPLOAD_CONTENT_APPROVAL_REFERENCE=artifact:artifacts/staging/reports/inline-upload-work/sha-repair-approved.json SUPPORT_ATTACHMENT_STORAGE=s3 HOMEWORK_MATERIAL_FILE_STORAGE=s3 INLINE_UPLOAD_CONTENT_DOWNLOAD_MODE=signed-url INLINE_UPLOAD_CONTENT_DOWNLOAD_URL_EXPIRES_IN_SECONDS=300 INLINE_UPLOAD_CONTENT_CONTENT_BASE64_WRITE_DISABLED=true INLINE_UPLOAD_CONTENT_INLINE_READ_COMPATIBILITY=true corepack pnpm inline-upload-content:generate",
      prerequisite:
        "PII-safe hash audit, orphan S3 audit, dry-run, and approved migration artifacts with zero pending rows/bytes and S3 signed-url mode.",
      blocker: "Pending inline rows, invalid base64, missing sha256, or sha256 mismatch must be repaired before migration evidence can pass.",
    },
  ],
  [
    "reports/rate-limit.json",
    {
      command:
        "RATE_LIMIT_SMOKE_EVIDENCE_TARGET=file:///.../smoke/rate-limit.json RATE_LIMIT_EVIDENCE_OUTPUT=artifacts/staging/reports/rate-limit.json corepack pnpm rate-limit:generate",
      prerequisite: "Two distinct API instances or LB shards must prove Redis shared API and login limiter behavior.",
      blocker: "A single API instance cannot prove the required shared Redis window.",
    },
  ],
  [
    "reports/audit-null-tenant.json",
    {
      command: "AUDIT_NULL_TENANT_EVIDENCE_TARGET=file:///.../audit-null-tenant.json corepack pnpm audit-null-tenant:check",
      prerequisite: "Null-tenant audit rows classified with unknown=0 and PII-safe breakdown evidence.",
      blocker: "The audit classification artifact must be present under reports/.",
    },
  ],
  [
    "reports/rls-live.json",
    {
      command: "RLS_LIVE_EVIDENCE_TARGET=file:///.../rls-live.json corepack pnpm rls:live:check",
      prerequisite: "Live RLS, tenant FK preflight, and cross-tenant negative insert evidence from staging.",
      blocker: "The RLS artifact must be present under reports/ and match the same release candidate.",
    },
  ],
  [
    "reports/uat.json",
    {
      command: "UAT_OUTPUT=artifacts/staging/reports/uat.json corepack pnpm uat:generate",
      prerequisite: "Ten executed command evidence entries and all 21 UAT persona scenarios must be PASS.",
      blocker: "Real role-based UAT command and scenario evidence JSON files are missing.",
    },
  ],
  [
    "reports/runtime-parity.json",
    {
      command: "RUNTIME_PARITY_EVIDENCE_TARGET=file:///.../runtime-parity.json corepack pnpm runtime-parity:check",
      prerequisite: "Final verifier run must recheck all four exact-SHA service images and both public health endpoints.",
      blocker: "Runtime parity is not release evidence when it exists only in logs or predates final summary publication.",
    },
  ],
  [
    "release-summary-*.json",
    {
      command: "corepack pnpm prod:evidence:check --summary-file artifacts/staging/release-summary-<tag>.json",
      prerequisite: "All required reports, smoke artifacts, and first-gates artifacts must already pass from the same bundle.",
      blocker: "A release summary would be false evidence while required artifacts are missing.",
    },
  ],
]);
const missingArtifactHandoff = new Map([
  [
    "first-gates/first-gates-manifest.json",
    {
      phase: "Faz 5 - Infra ve provider ilk kapılar",
      ownerAgent: "ops_release_engineer",
      evidenceGate: "staging:first-gates:check",
      nextActionKind: "external_tls_and_alert_secret",
    },
  ],
  [
    "reports/restore-drill.json",
    {
      phase: "Faz 5 - Backup/DR kanıtı",
      ownerAgent: "infra_dr_engineer",
      evidenceGate: "restore:drill:check",
      nextActionKind: "staging_dr_drill",
    },
  ],
  [
    "reports/deployment-rollback.json",
    {
      phase: "Faz 10 - Rollback/go-live kanıtı",
      ownerAgent: "infra_dr_engineer",
      evidenceGate: "deployment:rollback:check",
      nextActionKind: "rollback_drill",
    },
  ],
  [
    "reports/github-ci.json",
    {
      phase: "Faz 5 - Release CI kanıtı",
      ownerAgent: "ops_release_engineer",
      evidenceGate: "github-ci:check",
      nextActionKind: "github_actions_artifact",
    },
  ],
  [
    "reports/deployment-cutover.json",
    {
      phase: "Faz 5 - Staging cutover bağı",
      ownerAgent: "ops_release_engineer",
      evidenceGate: "deployment-cutover:evidence-check",
      nextActionKind: "selected_staging_deploy_artifact",
    },
  ],
  [
    "reports/kvkk-inventory.json",
    {
      phase: "Faz 4 - KVKK/PII kanıtı",
      ownerAgent: "privacy_governance_reviewer",
      evidenceGate: "privacy:inventory:check",
      nextActionKind: "staging_privacy_inventory",
    },
  ],
  [
    "reports/identity-migration.json",
    {
      phase: "Faz 5 - Identity migration kanıtı",
      ownerAgent: "auth_session_engineer",
      evidenceGate: "identity-migration:check",
      nextActionKind: "approval_and_subject_data",
    },
  ],
  [
    "reports/financial-retention.json",
    {
      phase: "Faz 5 - Finans/KVKK saklama kanıtı",
      ownerAgent: "privacy_governance_reviewer",
      evidenceGate: "financial-retention:check",
      nextActionKind: "policy_approval_and_finance_data",
    },
  ],
  [
    "reports/upload-av.json",
    {
      phase: "Faz 5 - Upload AV kanıtı",
      ownerAgent: "privacy_governance_reviewer",
      evidenceGate: "upload-av:check",
      nextActionKind: "scanner_smoke",
    },
  ],
  [
    "reports/observability-uat.json",
    {
      phase: "Faz 5 - Observability UAT kanıtı",
      ownerAgent: "observability_sre_engineer",
      evidenceGate: "observability:uat:check",
      nextActionKind: "monitoring_stack_and_alert_artifact",
    },
  ],
  [
    "reports/admin-mfa.json",
    {
      phase: "Faz 5 - Admin MFA kanıtı",
      ownerAgent: "auth_session_engineer",
      evidenceGate: "admin-mfa:check",
      nextActionKind: "admin_enrollment_and_login_negatives",
    },
  ],
  [
    "reports/security-audit.json",
    {
      phase: "Faz 5 - Security audit kanıtı",
      ownerAgent: "tenant_security_reviewer",
      evidenceGate: "security:audit:check",
      nextActionKind: "public_https_and_auth_data_controls",
    },
  ],
  [
    "reports/live-exam-cycle.json",
    {
      phase: "Faz 4A - iSEM canlı sınav döngüsü",
      ownerAgent: "exam_reporting_engineer",
      evidenceGate: "live:exam-cycle:check",
      nextActionKind: "staging_exam_cycle",
    },
  ],
  [
    "reports/isem-optical-pipeline.json",
    {
      phase: "Faz 4A - iSEM optik pipeline",
      ownerAgent: "exam_reporting_engineer",
      evidenceGate: "isem-optical-pipeline:evidence-check",
      nextActionKind: "staging_optical_pipeline",
    },
  ],
  [
    "reports/live-ui-worker-result.json",
    {
      phase: "Faz 4A - UI-worker rapor sonucu",
      ownerAgent: "exam_reporting_engineer",
      evidenceGate: "live:ui-worker:result-check",
      nextActionKind: "worker_result_artifact",
    },
  ],
  [
    "reports/ui-ux-redesign.json",
    {
      phase: "Faz 5 - UI/UX redesign release kanıtı",
      ownerAgent: "qa_verification_engineer",
      evidenceGate: "ui-ux-redesign:evidence-check",
      nextActionKind: "staging_ui_ux_artifact",
    },
  ],
  [
    "reports/inline-upload-content-migration.json",
    {
      phase: "Faz 5 - Inline upload migration kanıtı",
      ownerAgent: "privacy_governance_reviewer",
      evidenceGate: "inline-upload-content:check",
      nextActionKind: "approved_s3_migration_artifacts",
    },
  ],
  [
    "reports/rate-limit.json",
    {
      phase: "Faz 5 - Rate-limit Redis kanıtı",
      ownerAgent: "auth_session_engineer",
      evidenceGate: "rate-limit:check",
      nextActionKind: "second_api_instance_or_lb_shard",
    },
  ],
  [
    "reports/audit-null-tenant.json",
    {
      phase: "Faz 4 - Audit/KVKK kanıtı",
      ownerAgent: "privacy_governance_reviewer",
      evidenceGate: "audit-null-tenant:check",
      nextActionKind: "staging_audit_classification",
    },
  ],
  [
    "reports/rls-live.json",
    {
      phase: "Faz 3 - RLS live kanıtı",
      ownerAgent: "tenant_security_reviewer",
      evidenceGate: "rls:live:check",
      nextActionKind: "staging_rls_evidence",
    },
  ],
  [
    "reports/uat.json",
    {
      phase: "Faz 5 - UAT/persona kanıtı",
      ownerAgent: "qa_verification_engineer",
      evidenceGate: "uat:check",
      nextActionKind: "role_based_uat_artifacts",
    },
  ],
  [
    "reports/runtime-parity.json",
    {
      phase: "Gate E - Final runtime parity",
      ownerAgent: "ops_release_engineer",
      evidenceGate: "runtime-parity:check",
      nextActionKind: "exact_image_and_public_health_artifact",
    },
  ],
  [
    "release-summary-*.json",
    {
      phase: "Faz 5/Faz 10 - Production summary terfisi",
      ownerAgent: "ops_release_engineer",
      evidenceGate: "prod:evidence:summary:check",
      nextActionKind: "generate_after_all_required_artifacts",
    },
  ],
]);

const artifactsDir = artifactsTarget ? resolveArtifactsDir(artifactsTarget) : undefined;
if (!artifactsTarget) {
  fail(["STAGING_RELEASE_ARTIFACTS_TARGET veya --artifacts-dir zorunlu."]);
}
const failures = [];
requireExampleEvidenceOnlyForTemplateCheck(artifactsDir, failures);
requireNotLocalTempPath(artifactsDir, failures);
requireParentPathAllowed(dirname(artifactsDir), failures, "artifactsDir parent");
requireDirectory(artifactsDir, failures, "artifactsDir");
requireNoSymlinks(artifactsDir, failures);
requireNoForbiddenArtifactFiles(artifactsDir, failures);

const githubCiFile = resolve(artifactsDir, "reports", "github-ci.json");
const deploymentCutoverFile = resolve(artifactsDir, "reports", deploymentCutoverArtifact.file);
const firstGatesManifestFile = resolve(artifactsDir, "first-gates", "first-gates-manifest.json");
const releaseEvidenceManifestFile = resolve(artifactsDir, "release-evidence-manifest.json");
const releaseSummaryFiles = existsSync(artifactsDir)
  ? readdirSync(artifactsDir)
      .filter((file) => /^release-summary-.+\.json$/.test(file))
      .sort()
      .map((file) => resolve(artifactsDir, file))
  : [];

requireFile(firstGatesManifestFile, failures, "first-gates/first-gates-manifest.json");
requireFile(releaseEvidenceManifestFile, failures, "release-evidence-manifest.json");
for (const { file } of reportArtifacts.values()) {
  requireFile(resolve(artifactsDir, "reports", file), failures, `reports/${file}`);
}
for (const file of supportingReportArtifacts) {
  requireFile(resolve(artifactsDir, "reports", file), failures, `reports/${file}`);
}
requireFile(deploymentCutoverFile, failures, `reports/${deploymentCutoverArtifact.file}`);
if (releaseSummaryFiles.length !== 1) {
  failures.push(`artifactsDir tam 1 release-summary-*.json içermeli; bulundu: ${releaseSummaryFiles.length}.`);
}
if (releaseSummaryFiles.length === 1) {
  requireExpectedArtifactEntries(artifactsDir, releaseSummaryFiles[0], failures);
} else {
  requireExpectedArtifactEntriesWithoutSummary(artifactsDir, failures);
}

if (failures.length === 0) {
  for (const { file, script, targetEnv, allowEnv } of reportArtifacts.values()) {
    runChecker(script, {
      [targetEnv]: pathToFileURL(resolve(artifactsDir, "reports", file)).href,
      ...(allowExampleEvidence ? { [allowEnv]: "1" } : {}),
    });
  }
  runChecker(deploymentCutoverArtifact.script, {
    [deploymentCutoverArtifact.targetEnv]: pathToFileURL(deploymentCutoverFile).href,
    ...(allowExampleEvidence ? { [deploymentCutoverArtifact.allowEnv]: "1" } : {}),
  });
  runChecker("scripts/check-staging-first-gates-evidence.mjs", {
    STAGING_FIRST_GATES_TARGET: pathToFileURL(firstGatesManifestFile).href,
  });
  runChecker("scripts/check-production-evidence-summary.mjs", {
    PRODUCTION_EVIDENCE_SUMMARY_TARGET: pathToFileURL(releaseSummaryFiles[0]).href,
    PRODUCTION_EVIDENCE_ALLOW_STAGING: "1",
    ...(allowExampleEvidence ? { PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE: "1" } : {}),
  });
}

const reportFailures = failures.length === 0
  ? validateArtifactBundle(releaseSummaryFiles[0], githubCiFile, deploymentCutoverFile, firstGatesManifestFile, releaseEvidenceManifestFile)
  : failures;
if (reportFailures.length > 0) {
  fail(reportFailures);
}
runChecker("scripts/check-release-evidence-manifest.mjs", {
  RELEASE_EVIDENCE_ARTIFACTS_DIR: artifactsDir,
  RELEASE_EVIDENCE_MANIFEST_TARGET: releaseEvidenceManifestFile,
  ...(allowExampleEvidence ? { RELEASE_EVIDENCE_MANIFEST_ALLOW_EXAMPLE_EVIDENCE: "1" } : {}),
});

console.log(
  `Staging release artifact bundle kontrolü geçti: ${releaseSummaryFiles[0].replace(`${process.cwd()}/`, "")}`,
);

function validateArtifactBundle(summaryFile, githubCiFilePath, deploymentCutoverFilePath, firstGatesManifestPath, releaseManifestPath) {
  const output = [];
  const summary = readJsonFile(summaryFile, "release summary", output);
  const githubCi = readJsonFile(githubCiFilePath, "github-ci", output);
  const deploymentCutover = readJsonFile(deploymentCutoverFilePath, "deployment cutover", output);
  const firstGatesManifest = readJsonFile(firstGatesManifestPath, "first-gates manifest", output);
  const releaseManifest = readJsonFile(releaseManifestPath, "release evidence manifest", output);
  if (!summary || !githubCi || !deploymentCutover || !firstGatesManifest || !releaseManifest) return output;

  requireDateNotAfter(firstGatesManifest, output, "first-gates.generatedAt", "generatedAt", summary, "summary.generatedAt", "generatedAt");
  requireReleaseSummaryFileNameMatchesSummary(summaryFile, summary, output);
  requireGithubCiMatchesSummary(summary, githubCi, output);
  requireReleaseSourceBinding(summary, output);
  requireDeploymentCutoverMatchesSummary(summary, deploymentCutover, output);
  requireReleaseManifestMatchesBundle(summary, githubCi, deploymentCutover, releaseManifest, output);
  requireRlsSupportingEvidence(artifactsDir, output);
  requireReportFilesMatchSummary(summary, artifactsDir, output);
  requireRuntimeParityMatchesRelease(summary, deploymentCutover, artifactsDir, output);
  requireSmokeFilesMatchSummary(summary, dirname(summaryFile), output);
  requireFirstGatesMatchSummary(summary, firstGatesManifest, firstGatesManifestPath, output);

  return output;
}

function requireReleaseManifestMatchesBundle(summary, githubCi, cutover, manifest, output) {
  const summarySha = summary?.reports?.githubCi?.commitSha;
  const summaryTag = extractImageTag(summary?.reports?.deploymentRollback?.releaseCandidate);
  if (
    manifest?.repository !== githubCi?.repository ||
    manifest?.repository !== cutover?.repository ||
    manifest?.sourceSha !== summarySha ||
    manifest?.sourceSha !== githubCi?.commitSha ||
    manifest?.sourceSha !== cutover?.sourceSha ||
    manifest?.releaseImageTag !== summaryTag ||
    manifest?.releaseImageTag !== cutover?.releaseImageTag ||
    String(manifest?.deployRunId) !== String(cutover?.deployRunId) ||
    manifest?.cutoverAt !== cutover?.cutoverAt
  ) {
    output.push("release-evidence-manifest.json summary/github-ci/deployment-cutover exact release bağıyla eşleşmeli.");
  }
  if (Date.parse(summary?.generatedAt) > Date.parse(manifest?.generatedAt)) {
    output.push("release-evidence-manifest.json final summary üretildikten sonra yazılmalı.");
  }
}

function requireDeploymentCutoverMatchesSummary(summary, cutover, output) {
  const outbox = summary?.smokeEvidence?.secretDeliveryOutbox;
  const uiUxSourceSha = summary?.reports?.uiUxRedesign?.sourceCommitSha;
  const githubCiSourceSha = summary?.reports?.githubCi?.commitSha;
  const observabilitySourceSha = summary?.reports?.observabilityUat?.alertDelivery?.releaseCandidate;
  const githubCiRepository = summary?.reports?.githubCi?.repository;

  if (
    typeof cutover?.sourceSha !== "string" ||
    typeof uiUxSourceSha !== "string" ||
    typeof githubCiSourceSha !== "string" ||
    typeof observabilitySourceSha !== "string" ||
    cutover.sourceSha.toLowerCase() !== uiUxSourceSha.toLowerCase() ||
    cutover.sourceSha.toLowerCase() !== githubCiSourceSha.toLowerCase() ||
    cutover.sourceSha.toLowerCase() !== observabilitySourceSha.toLowerCase()
  ) {
    output.push("reports/deployment-cutover.json.sourceSha, summary.reports.uiUxRedesign.sourceCommitSha, summary.reports.githubCi.commitSha ve observability alertDelivery.releaseCandidate aynı SHA olmalı.");
  }
  if (cutover?.repository !== githubCiRepository) {
    output.push("reports/deployment-cutover.json.repository summary.reports.githubCi.repository ile eşleşmeli.");
  }
  if (cutover?.releaseImageTag !== outbox?.releaseImageTag) {
    output.push("reports/deployment-cutover.json.releaseImageTag summary.smokeEvidence.secretDeliveryOutbox.releaseImageTag ile eşleşmeli.");
  }
  if (cutover?.cutoverAt !== outbox?.notBefore) {
    output.push("reports/deployment-cutover.json.cutoverAt summary.smokeEvidence.secretDeliveryOutbox.notBefore ile eşleşmeli.");
  }
  if (Date.parse(cutover?.generatedAt) > Date.parse(outbox?.generatedAt)) {
    output.push("reports/deployment-cutover.json.generatedAt summary.smokeEvidence.secretDeliveryOutbox.generatedAt tarihinden sonra olamaz.");
  }
}

function requireReleaseSummaryFileNameMatchesSummary(summaryFile, summary, output) {
  const summaryFileName = basename(summaryFile);
  const match = summaryFileName.match(/^release-summary-(.+)\.json$/);
  if (!match) {
    output.push("release summary dosya adı release-summary-<tag>.json biçiminde olmalı.");
    return;
  }

  const fileTag = match[1];
  const releaseCandidate = summary?.reports?.deploymentRollback?.releaseCandidate;
  const releaseCandidateTag = extractImageTag(releaseCandidate);
  if (!releaseCandidateTag) {
    output.push("summary.reports.deploymentRollback.releaseCandidate tag içermeli.");
    return;
  }

  if (fileTag !== releaseCandidateTag) {
    output.push("release summary dosya tag'i summary.reports.deploymentRollback.releaseCandidate ile eşleşmeli.");
  }
}

function requireRlsSupportingEvidence(rootDir, output) {
  const reportsDir = resolve(rootDir, "reports");
  const staticLogPath = resolve(reportsDir, "db-rls-check.log");
  const liveLogPath = resolve(reportsDir, "db-rls-check-live.log");
  const loadSmokePath = resolve(reportsDir, "rls-load-smoke.json");
  const rlsReportPath = resolve(reportsDir, "rls-live.json");
  if (![staticLogPath, liveLogPath, loadSmokePath, rlsReportPath].every(existsSync)) return;

  const staticLog = readFileSync(staticLogPath, "utf8");
  const liveLog = readFileSync(liveLogPath, "utf8");
  for (const token of [
    "Tenant model parity kontrolü geçti:",
    "RLS policy kontrolü geçti:",
    "Tenant relation FK kontrolü geçti:",
  ]) {
    if (!staticLog.includes(token)) output.push(`reports/db-rls-check.log başarı kanıtı eksik: ${token}`);
  }
  for (const token of ["Canlı RLS kontrolü geçti:", "Sentetik RLS fixture temizliği geçti: 2 tenant silindi."]) {
    if (!liveLog.includes(token)) output.push(`reports/db-rls-check-live.log başarı/cleanup kanıtı eksik: ${token}`);
  }

  const loadSmoke = readJsonFile(loadSmokePath, "reports/rls-load-smoke.json", output);
  const rlsReport = readJsonFile(rlsReportPath, "reports/rls-live.json", output);
  if (!loadSmoke || !rlsReport) return;
  output.push(...validateSmokeEvidencePayload(loadSmoke, {
    expectedCheck: "rls_load_smoke",
    allowedEnvironments: ["staging", "production"],
    label: "reports/rls-load-smoke.json",
    allowExampleEvidence,
  }));
  const expectedReferences = [
    "artifact:artifacts/staging/reports/db-rls-check.log",
    "artifact:artifacts/staging/reports/db-rls-check-live.log",
    "artifact:artifacts/staging/reports/rls-load-smoke.json",
  ];
  for (const reference of expectedReferences) {
    if (!rlsReport.evidenceReferences?.includes(reference)) output.push(`reports/rls-live.json evidenceReferences eksik: ${reference}`);
  }
  for (const key of ["targetRps", "actualRps", "durationSeconds", "concurrency", "queriesCompleted", "failures"]) {
    if (stableStringify(rlsReport.loadSmoke?.[key]) !== stableStringify(loadSmoke.loadSmoke?.[key])) {
      output.push(`reports/rls-live.json loadSmoke.${key} reports/rls-load-smoke.json ile eşleşmeli.`);
    }
  }
  for (const key of ["tenantAHash", "tenantBHash"]) {
    if (rlsReport.isolation?.[key] !== loadSmoke.isolation?.[key]) {
      output.push(`reports/rls-live.json isolation.${key} reports/rls-load-smoke.json ile eşleşmeli.`);
    }
  }
}

function extractImageTag(value) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const slashIndex = value.lastIndexOf("/");
  const colonIndex = value.lastIndexOf(":");
  if (colonIndex > slashIndex) {
    return value.slice(colonIndex + 1);
  }
  return value;
}

function requireGithubCiMatchesSummary(summary, githubCi, output) {
  const embedded = summary?.reports?.githubCi;
  if (!embedded || typeof embedded !== "object" || Array.isArray(embedded)) {
    output.push("summary.reports.githubCi nesnesi zorunlu.");
    return;
  }

  for (const key of githubCiSummaryKeys) {
    if (stableStringify(embedded[key]) !== stableStringify(githubCi[key])) {
      output.push(`summary.reports.githubCi.${key} reports/github-ci.json ile eşleşmeli.`);
    }
  }
}

function requireReleaseSourceBinding(summary, output) {
  const releaseCandidateTag = summary?.reports?.uiUxRedesign?.releaseCandidate?.match(/:([a-f0-9]{40})$/i)?.[1];
  const sourceCommitSha = summary?.reports?.uiUxRedesign?.sourceCommitSha;
  const githubCommitSha = summary?.reports?.githubCi?.commitSha;
  if (
    !releaseCandidateTag ||
    typeof sourceCommitSha !== "string" ||
    !/^[a-f0-9]{40}$/i.test(sourceCommitSha) ||
    typeof githubCommitSha !== "string" ||
    !/^[a-f0-9]{40}$/i.test(githubCommitSha) ||
    releaseCandidateTag.toLowerCase() !== sourceCommitSha.toLowerCase() ||
    sourceCommitSha.toLowerCase() !== githubCommitSha.toLowerCase()
  ) {
    output.push("summary UI/UX releaseCandidate tag'i, sourceCommitSha ve GitHub CI commitSha aynı 40 karakter SHA olmalı.");
  }
}

function requireReportFilesMatchSummary(summary, artifactsDirPath, output) {
  const embeddedReports = summary?.reports;
  if (!embeddedReports || typeof embeddedReports !== "object" || Array.isArray(embeddedReports)) {
    output.push("summary.reports nesnesi zorunlu.");
    return;
  }

  for (const [key, { file }] of reportArtifacts) {
    const reportFile = resolve(artifactsDirPath, "reports", file);
    const payload = readJsonFile(reportFile, `reports/${file}`, output);
    if (!payload) continue;
    if (key === "runtimeParity" || key === "liveOnboarding") continue;

    const embedded = embeddedReports[key];
    if (!embedded || typeof embedded !== "object" || Array.isArray(embedded)) {
      output.push(`summary.reports.${key} nesnesi zorunlu.`);
      continue;
    }

    for (const embeddedKey of Object.keys(embedded)) {
      const expectedValue =
        key === "uat" && embeddedKey === "liveExamCyclePassed"
          ? Array.isArray(payload.commandsPassed) && payload.commandsPassed.includes("pnpm live:exam-cycle:check")
          : payload[embeddedKey];
      if (stableStringify(embedded[embeddedKey]) !== stableStringify(expectedValue)) {
        output.push(`summary.reports.${key}.${embeddedKey} reports/${file} ile eşleşmeli.`);
      }
    }
  }
}

function requireRuntimeParityMatchesRelease(summary, cutover, artifactsDirPath, output) {
  const runtimeParity = readJsonFile(resolve(artifactsDirPath, "reports/runtime-parity.json"), "reports/runtime-parity.json", output);
  if (!runtimeParity) return;
  const sourceSha = summary?.reports?.githubCi?.commitSha;
  const repository = summary?.reports?.githubCi?.repository;
  if (
    runtimeParity.sourceSha !== sourceSha ||
    runtimeParity.releaseImageTag !== sourceSha ||
    runtimeParity.repository !== repository ||
    runtimeParity.sourceSha !== cutover?.sourceSha ||
    runtimeParity.repository !== cutover?.repository
  ) output.push("reports/runtime-parity.json summary/github-ci/deployment-cutover exact release bağıyla eşleşmeli.");
  if (Date.parse(runtimeParity.checkedAt) > Date.parse(summary?.generatedAt)) {
    output.push("reports/runtime-parity.json final summary üretiminden sonra olamaz.");
  }
}

function requireSmokeFilesMatchSummary(summary, summaryDir, output) {
  const smokeEvidence = summary?.smokeEvidence;
  if (!smokeEvidence || typeof smokeEvidence !== "object" || Array.isArray(smokeEvidence)) {
    output.push("summary.smokeEvidence nesnesi zorunlu.");
    return;
  }

  for (const [key, { file, check }] of smokeArtifacts) {
    const smokeFile = resolve(summaryDir, "smoke", file);
    requireFile(smokeFile, output, `smoke/${file}`);
    if (!existsSync(smokeFile)) continue;

    const payload = readJsonFile(smokeFile, `smoke/${file}`, output);
    if (!payload) continue;

    const smokeFailures = validateSmokeEvidencePayload(payload, {
      expectedCheck: check,
      allowedEnvironments: ["staging", "production"],
      label: `smoke/${file}`,
      allowExampleEvidence,
    });
    output.push(...smokeFailures);

    if (stableStringify(payload) !== stableStringify(smokeEvidence[key])) {
      output.push(`summary.smokeEvidence.${key} smoke/${file} ile birebir eşleşmeli.`);
    }
  }
}

function requireFirstGatesMatchSummary(summary, manifest, manifestPath, output) {
  if (!Array.isArray(manifest.checks)) {
    output.push("first-gates checks listesi zorunlu.");
    return;
  }

  const summaryGeneratedAt = summary?.generatedAt;
  for (const item of manifest.checks) {
    const summaryKey = firstGateSummaryKeys.get(item?.label);
    if (!summaryKey) continue;

    const evidencePath = resolve(dirname(manifestPath), item.evidenceFile);
    const payload = readJsonFile(evidencePath, `first-gates/${item.evidenceFile}`, output);
    if (!payload) continue;

    const summaryPayload = summary?.smokeEvidence?.[summaryKey];
    if (!summaryPayload || typeof summaryPayload !== "object" || Array.isArray(summaryPayload)) {
      output.push(`summary.smokeEvidence.${summaryKey} zorunlu.`);
      continue;
    }

    if (payload.check !== summaryPayload.check) {
      output.push(`first-gates/${item.evidenceFile}.check summary.smokeEvidence.${summaryKey}.check ile eşleşmeli.`);
    }
    if (payload.environment !== summaryPayload.environment) {
      output.push(`first-gates/${item.evidenceFile}.environment summary.smokeEvidence.${summaryKey}.environment ile eşleşmeli.`);
    }
    if (stableStringify(payload.commandsPassed) !== stableStringify(summaryPayload.commandsPassed)) {
      output.push(`first-gates/${item.evidenceFile}.commandsPassed summary.smokeEvidence.${summaryKey}.commandsPassed ile eşleşmeli.`);
    }
    for (const field of firstGateSummaryMatchFields.get(summaryKey) ?? []) {
      if (stableStringify(payload[field]) !== stableStringify(summaryPayload[field])) {
        output.push(`first-gates/${item.evidenceFile}.${field} summary.smokeEvidence.${summaryKey}.${field} ile eşleşmeli.`);
      }
    }
    requireDateNotAfter(payload, output, `first-gates/${item.evidenceFile}.generatedAt`, "generatedAt", summary, "summary.generatedAt", "generatedAt");
    requireDateNotAfter(payload, output, `first-gates/${item.evidenceFile}.checkedAt`, "checkedAt", summary, "summary.generatedAt", "generatedAt");
    requireDateNotAfter(
      payload,
      output,
      `first-gates/${item.evidenceFile}.generatedAt`,
      "generatedAt",
      summaryPayload,
      `summary.smokeEvidence.${summaryKey}.generatedAt`,
      "generatedAt",
    );
    requireDateNotAfter(
      payload,
      output,
      `first-gates/${item.evidenceFile}.checkedAt`,
      "checkedAt",
      summaryPayload,
      `summary.smokeEvidence.${summaryKey}.checkedAt`,
      "checkedAt",
    );

    if (typeof summaryGeneratedAt === "string" && Number.isNaN(Date.parse(summaryGeneratedAt))) {
      output.push("summary.generatedAt geçerli tarih olmalı.");
    }
  }
}

function runChecker(script, envPatch) {
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, ...envPatch },
    stdio: "inherit",
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveArtifactsDir(target) {
  if (target.startsWith("file://")) {
    return fileURLToPath(new URL(target));
  }
  return resolve(target);
}

function requireDirectory(path, output, label) {
  if (!existsSync(path)) {
    output.push(`${label} bulunamadı: ${path}`);
    return;
  }
  if (lstatSync(path).isSymbolicLink()) {
    output.push(`${label} symlink olmayan dizin olmalı: ${path}`);
    return;
  }
  if (!statSync(path).isDirectory()) {
    output.push(`${label} dizin olmalı: ${path}`);
  }
}

function requireParentPathAllowed(parentPath, output, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      output.push(label === "artifactsDir parent" ? artifactsDirParentSymlinkError : `${label} dizini symlink olmayan dizin olmalı.`);
      return;
    }
  }
}

function requireNotLocalTempPath(path, output) {
  const normalized = resolve(path).replace(/\/+$/g, "") || "/";
  if (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  ) {
    output.push(artifactsDirTempPathError);
  }
}

function requireExampleEvidenceOnlyForTemplateCheck(path, output) {
  if (!allowExampleEvidence) return;

  const normalized = resolve(path).replaceAll("\\", "/");
  const allowedRoot = resolve("artifacts/prod-evidence-template-check").replaceAll("\\", "/");
  if (normalized === allowedRoot || normalized.startsWith(`${allowedRoot}/`)) return;

  output.push("STAGING_RELEASE_ARTIFACTS_ALLOW_EXAMPLE_EVIDENCE=1 yalnız prod evidence template fixture bundle'ında kullanılabilir.");
}

function requireFile(path, output, label) {
  if (!existsSync(path)) {
    output.push(`${label} bulunamadı: ${path}`);
    return;
  }
  if (lstatSync(path).isSymbolicLink()) {
    output.push(`${label} symlink olmayan dosya olmalı: ${path}`);
    return;
  }
  if (!statSync(path).isFile()) {
    output.push(`${label} dosya olmalı: ${path}`);
  }
}

function requireExpectedArtifactEntries(rootDir, summaryFile, output) {
  const expectedRootEntries = new Set(["first-gates", "reports", "smoke", "ui-ux-redesign", "release-evidence-manifest.json", basename(summaryFile)]);
  requireExactDirectoryEntries(rootDir, expectedRootEntries, output);

  requireExactDirectoryEntries(
    resolve(rootDir, "reports"),
    new Set([...reportArtifacts.values()].map(({ file }) => file).concat(deploymentCutoverArtifact.file, supportingReportArtifacts)),
    output,
  );
  requireExactDirectoryEntries(
    resolve(rootDir, "smoke"),
    new Set([...smokeArtifacts.values()].map(({ file }) => file)),
    output,
  );
  requireExactDirectoryEntries(
    resolve(rootDir, "first-gates"),
    new Set([
      "first-gates-manifest.json",
      ...[...firstGateSummaryKeys.values()].map((summaryKey) => smokeArtifacts.get(summaryKey)?.file).filter(Boolean),
    ]),
    output,
  );
  requireUiUxArtifactEntries(rootDir, output);
}

function requireExpectedArtifactEntriesWithoutSummary(rootDir, output) {
  requireExactDirectoryEntries(rootDir, new Set(["first-gates", "reports", "smoke", "ui-ux-redesign", "release-evidence-manifest.json"]), output);
  requireExactDirectoryEntries(
    resolve(rootDir, "reports"),
    new Set([...reportArtifacts.values()].map(({ file }) => file).concat(deploymentCutoverArtifact.file, supportingReportArtifacts)),
    output,
  );
  requireExactDirectoryEntries(
    resolve(rootDir, "smoke"),
    new Set([...smokeArtifacts.values()].map(({ file }) => file)),
    output,
  );
  requireExactDirectoryEntries(
    resolve(rootDir, "first-gates"),
    new Set([
      "first-gates-manifest.json",
      ...[...firstGateSummaryKeys.values()].map((summaryKey) => smokeArtifacts.get(summaryKey)?.file).filter(Boolean),
    ]),
    output,
  );
  requireUiUxArtifactEntries(rootDir, output);
}

function requireUiUxArtifactEntries(rootDir, output) {
  const directory = resolve(rootDir, "ui-ux-redesign");
  requireExactDirectoryEntries(directory, new Set(uiUxArtifactFiles), output);
}

function requireExactDirectoryEntries(dir, expectedEntries, output) {
  if (!existsSync(dir)) return;
  if (lstatSync(dir).isSymbolicLink()) {
    output.push(`${relative(artifactsDir, dir) || "artifactsDir"} symlink olmayan dizin olmalı.`);
    return;
  }
  if (!statSync(dir).isDirectory()) return;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!expectedEntries.has(entry.name)) {
      output.push(`${relative(artifactsDir, resolve(dir, entry.name))} beklenmeyen artifact dosyası.`);
    }
  }
}

function requireNoSymlinks(rootDir, output) {
  if (!existsSync(rootDir)) return;

  const stat = lstatSync(rootDir);
  if (stat.isSymbolicLink()) {
    output.push(`artifact bundle symlink içermemeli: ${relative(artifactsDir, rootDir) || "."}`);
    return;
  }
  if (!stat.isDirectory()) return;

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const filePath = resolve(rootDir, entry.name);
    const artifactPath = relative(artifactsDir, filePath);
    if (entry.isSymbolicLink()) {
      output.push(`artifact bundle symlink içermemeli: ${artifactPath}`);
      continue;
    }
    if (entry.isDirectory()) {
      requireNoSymlinks(filePath, output);
    }
  }
}

function requireNoForbiddenArtifactFiles(rootDir, output) {
  if (!existsSync(rootDir) || !statSync(rootDir).isDirectory()) return;

  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const filePath = resolve(rootDir, entry.name);
    const artifactPath = relative(artifactsDir, filePath);
    if (isForbiddenArtifactFileName(entry.name)) {
      output.push(`artifact bundle secret/env dosyası içermemeli: ${artifactPath}`);
      continue;
    }
    if (entry.isDirectory()) {
      requireNoForbiddenArtifactFiles(filePath, output);
    }
  }
}

function isForbiddenArtifactFileName(fileName) {
  return forbiddenArtifactFileNames.has(fileName) || /^\.env(?:\..+)?$/.test(fileName) || /\.env(?:\..+)?$/.test(fileName);
}

function readJsonFile(path, label, output) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    output.push(`${label} geçerli JSON olmalı: ${path}`);
    return undefined;
  }
}

function requireDateNotAfter(source, output, sourceLabel, sourceKey, target, targetLabel, targetKey) {
  const sourceTimestamp = Date.parse(source?.[sourceKey]);
  const targetTimestamp = Date.parse(target?.[targetKey]);
  if (Number.isNaN(sourceTimestamp) || Number.isNaN(targetTimestamp)) return;
  if (sourceTimestamp > targetTimestamp) {
    output.push(`${sourceLabel} ${targetLabel} tarihinden sonra olamaz.`);
  }
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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

function fail(messages) {
  writeGapReportIfRequested(messages);
  console.error("Staging release artifact bundle kontrolü başarısız:");
  for (const message of messages) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

function writeGapReportIfRequested(messages) {
  if (!gapReportTarget) return;

  const outputPath = resolve(gapReportTarget);
  const targetFailures = validateGapReportTarget(outputPath);
  if (targetFailures.length > 0) {
    console.error("Staging release gap raporu yazılamadı:");
    for (const message of targetFailures) {
      console.error(`- ${message}`);
    }
    return;
  }

  try {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(buildGapReport(messages), null, 2)}\n`);
    console.error(`Staging release gap raporu yazıldı: ${outputPath}`);
  } catch (error) {
    console.error(`Staging release gap raporu yazılamadı: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateGapReportTarget(outputPath) {
  const output = [];
  if (artifactsDir && isSameOrInsidePath(outputPath, artifactsDir)) {
    output.push("STAGING_RELEASE_GAP_REPORT_FILE staging release artifact bundle içine yazılamaz.");
  }
  if (isForbiddenArtifactFileName(basename(outputPath))) {
    output.push("STAGING_RELEASE_GAP_REPORT_FILE secret/env dosyası adıyla yazılamaz.");
  }
  requireParentPathAllowed(dirname(outputPath), output, "STAGING_RELEASE_GAP_REPORT_FILE parent");
  if (existsSync(outputPath) && lstatSync(outputPath).isSymbolicLink()) {
    output.push("STAGING_RELEASE_GAP_REPORT_FILE symlink olmayan dosya hedefi olmalı.");
  }
  return output;
}

function buildGapReport(messages) {
  const failures = messages.map(classifyFailure);
  const openClosureItems = buildOpenClosureItems(failures);
  return {
    schemaVersion: 1,
    reportType: "staging_release_artifacts_gap_report",
    generatedAt: new Date().toISOString(),
    script: "scripts/check-staging-release-artifacts.mjs",
    targetKind: getTargetKind(artifactsTarget),
    targetRejected: failures.some((item) => item.category === "path_policy" || item.category === "target"),
    releaseEvidence: false,
    canPromote: false,
    result: "NOT_RELEASE_EVIDENCE",
    overallStatus: "BLOCKED",
    artifactsTarget: sanitizeTargetForReport(artifactsTarget),
    artifactsDir: artifactsDir ? formatPathForReport(artifactsDir) : undefined,
    requiredSummaryFilePattern: "release-summary-*.json",
    foundReleaseSummaryCount: countReleaseSummaryFiles(),
    requiredReports: [...reportArtifacts.values(), deploymentCutoverArtifact].map(({ file, script, targetEnv }) => ({
      path: `reports/${file}`,
      script,
      targetEnv,
    })),
    requiredSmoke: [...smokeArtifacts.values()].map(({ file, check }) => ({
      path: `smoke/${file}`,
      check,
    })),
    requiredFirstGates: getRequiredFirstGateArtifacts(),
    openClosureItemCount: openClosureItems.length,
    openClosureItems,
    checkedPathPolicy: {
      rejectsLocalTempTarget: messages.includes(artifactsDirTempPathError),
      rejectsParentSymlinkTarget: messages.includes(artifactsDirParentSymlinkError),
      rejectsSecretEnvFiles: messages.some((message) => message.includes("secret/env dosyası içermemeli")),
      rejectsBundleSymlinks: messages.some((message) => message.includes("symlink")),
    },
    missingRequiredFiles: failures.filter((item) => item.category === "missing_required_file"),
    unexpectedFiles: failures.filter((item) => item.category === "unexpected_file"),
    invalidFiles: failures.filter((item) => item.category === "invalid_file"),
    mismatchFailures: failures.filter((item) => item.category === "mismatch"),
    blockedChecks: failures.filter((item) => item.category === "blocked_check" || item.category === "target" || item.category === "path_policy"),
    failures,
  };
}

function buildOpenClosureItems(failures) {
  const output = [];
  const seen = new Set();
  const firstGateMissing = failures.some(
    (item) => item.category === "missing_required_file" && item.path === "first-gates/first-gates-manifest.json",
  );

  for (const item of failures) {
    if (item.category === "missing_required_file") {
      if (item.path === "first-gates/first-gates-manifest.json" && firstGateMissing) {
        for (const firstGate of getRequiredFirstGateArtifacts()) {
          pushOpenClosureItem(output, seen, {
            ...item,
            path: firstGate.path,
            kind: "first_gate",
            requiredArtifact: firstGate,
            reason: firstGate.path === item.path ? item.reason : "first-gates smoke artifact is unavailable while manifest is missing",
          });
        }
        continue;
      }
      pushOpenClosureItem(output, seen, item);
    }

    if (item.category === "blocked_check" && item.path === "release-summary-*.json") {
      pushOpenClosureItem(output, seen, item);
    }
  }

  return output;
}

function pushOpenClosureItem(output, seen, item) {
  if (!item?.path || seen.has(item.path)) return;
  seen.add(item.path);
  output.push({
    path: item.path,
    kind: item.kind,
    category: item.category,
    reason: item.reason,
    requiredArtifact: item.requiredArtifact,
    remediation: item.remediation,
  });
}

function getRequiredFirstGateArtifacts() {
  return [
    { path: "first-gates/first-gates-manifest.json", script: "scripts/check-staging-first-gates-evidence.mjs" },
    ...[...firstGateSummaryKeys.values()]
      .map((summaryKey) => smokeArtifacts.get(summaryKey))
      .filter(Boolean)
      .map(({ file, check }) => ({ path: `first-gates/${file}`, check })),
  ];
}

function classifyFailure(message) {
  const base = {
    message,
    severity: "blocking",
    requiredBy: "staging:release-artifacts:check",
    validationCommand: "STAGING_RELEASE_ARTIFACTS_TARGET=/path/to/artifacts/staging corepack pnpm staging:release-artifacts:check",
  };

  const missingMatch = message.match(/^(.+?) bulunamadı: (.+)$/);
  if (missingMatch) {
    const missingPath = missingMatch[1];
    return {
      ...base,
      category: "missing_required_file",
      kind: getArtifactKind(missingPath),
      path: missingPath,
      absolutePath: formatPathForReport(missingMatch[2]),
      reason: "required artifact is missing",
      remediation: getMissingArtifactRemediation(missingPath),
    };
  }

  if (message.startsWith("artifactsDir tam 1 release-summary-*.json içermeli")) {
    return {
      ...base,
      category: "blocked_check",
      kind: "release_summary",
      path: "release-summary-*.json",
      reason: "exactly one release summary is required",
      remediation: getMissingArtifactRemediation("release-summary-*.json"),
    };
  }

  if (message.includes("beklenmeyen artifact dosyası")) {
    return {
      ...base,
      category: "unexpected_file",
      kind: "artifact",
      path: message.replace(" beklenmeyen artifact dosyası.", ""),
      reason: "bundle contains an unexpected artifact",
    };
  }

  if (message.includes("geçerli JSON olmalı") || message.includes("dosya olmalı") || message.includes("dizin olmalı")) {
    return { ...base, category: "invalid_file", kind: "artifact", reason: "artifact is unreadable or has an invalid shape" };
  }

  if (
    message.includes("symlink") ||
    message.includes("temp path") ||
    message.includes("secret/env") ||
    message === artifactsDirTempPathError ||
    message === artifactsDirParentSymlinkError
  ) {
    return { ...base, category: "path_policy", kind: "artifact_path", reason: "artifact path hygiene policy failed" };
  }

  if (message.includes("eşleşmeli") || message.includes("tarihinden sonra olamaz") || message.includes("tag")) {
    return { ...base, category: "mismatch", kind: "artifact_summary", reason: "source artifact and release summary do not match" };
  }

  if (message.includes("STAGING_RELEASE_ARTIFACTS_TARGET") || message.includes("artifactsDir")) {
    return { ...base, category: "target", kind: "artifact_target", reason: "artifact target is not usable" };
  }

  return { ...base, category: "blocked_check", kind: "release_bundle", reason: "release bundle check is blocked" };
}

function getArtifactKind(path) {
  if (path === "artifactsDir") return "artifact_bundle";
  if (path.startsWith("reports/")) return "report";
  if (path.startsWith("smoke/")) return "smoke";
  if (path.startsWith("first-gates/")) return "first_gate";
  if (path.startsWith("release-summary-") || path.includes("release-summary")) return "release_summary";
  return "artifact";
}

function getMissingArtifactRemediation(path) {
  const remediation = missingArtifactRemediation.get(path);
  const handoff = missingArtifactHandoff.get(path);
  if (!remediation && !handoff) return undefined;
  return {
    ...remediation,
    ...handoff,
  };
}

function getTargetKind(target) {
  if (!target) return "missing";
  if (target.startsWith("file://")) return "file_url";
  return "local_path";
}

function sanitizeTargetForReport(target) {
  if (!target) return undefined;
  try {
    const parsed = new URL(target);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return target;
  }
}

function formatPathForReport(path) {
  if (!path) return path;
  const relativePath = relative(process.cwd(), path);
  if (relativePath && !relativePath.startsWith("..") && !relativePath.startsWith("/")) {
    return relativePath;
  }
  return path;
}

function countReleaseSummaryFiles() {
  if (!artifactsDir || !existsSync(artifactsDir) || !statSync(artifactsDir).isDirectory()) return 0;
  return readdirSync(artifactsDir).filter((file) => /^release-summary-.+\.json$/.test(file)).length;
}

function isSameOrInsidePath(childPath, parentPath) {
  const pathFromParent = relative(parentPath, childPath);
  return pathFromParent === "" || (!pathFromParent.startsWith("..") && !pathFromParent.startsWith("/") && !pathFromParent.startsWith("\\"));
}
