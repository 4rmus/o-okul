import { readFileSync } from "node:fs";

const planPath = "claudedocs/prod-plan-2026-06-12.md";
const readinessPath = "docs/phase-6-production-readiness.md";
const developmentPlanPath = "docs/development-plan-2026-06-02.md";
const architecturePlanPath = "docs/architecture-improvement-plan-2026-06-21.md";
const tenantRelationFkCheckerPath = "packages/db/scripts/check-tenant-relation-fks.mjs";
const rlsLiveEvidenceCheckerPath = "scripts/check-rls-live-evidence.mjs";
const prodEvidenceCheckerPath = "scripts/check-prod-evidence.mjs";
const liveStatusEvidenceCheckerPath = "scripts/check-live-status-evidence.mjs";
const liveStatusEvidenceGeneratorPath = "scripts/generate-live-status-evidence.mjs";
const goLiveEvidenceCheckerPath = "scripts/check-go-live-evidence.mjs";
const finalExternalEvidenceCheckerPath = "scripts/check-final-external-evidence.mjs";
const remoteFinalEvidenceCheckerPath = "scripts/check-remote-final-evidence-readiness.mjs";
const stagingReleaseGapSummaryPath = "scripts/print-staging-release-gap-summary.mjs";
const packagePath = "package.json";

const plan = readFileSync(planPath, "utf8");
const readiness = readFileSync(readinessPath, "utf8");
const developmentPlan = readFileSync(developmentPlanPath, "utf8");
const architecturePlan = readFileSync(architecturePlanPath, "utf8");
const tenantRelationFkChecker = readFileSync(tenantRelationFkCheckerPath, "utf8");
const rlsLiveEvidenceChecker = readFileSync(rlsLiveEvidenceCheckerPath, "utf8");
const prodEvidenceChecker = readFileSync(prodEvidenceCheckerPath, "utf8");
const liveStatusEvidenceChecker = readFileSync(liveStatusEvidenceCheckerPath, "utf8");
const liveStatusEvidenceGenerator = readFileSync(liveStatusEvidenceGeneratorPath, "utf8");
const goLiveEvidenceChecker = readFileSync(goLiveEvidenceCheckerPath, "utf8");
const finalExternalEvidenceChecker = readFileSync(finalExternalEvidenceCheckerPath, "utf8");
const remoteFinalEvidenceChecker = readFileSync(remoteFinalEvidenceCheckerPath, "utf8");
const stagingReleaseGapSummary = readFileSync(stagingReleaseGapSummaryPath, "utf8");
const packageJson = JSON.parse(readFileSync(packagePath, "utf8"));

const failures = [];
const rawPnpmCiCommand = "pnpm " + "ci";
const runPnpmCiCommand = "pnpm run ci";

requireTokens(
  planPath,
  plan,
  [
    "2026-06-13 Uygulama Durumu",
    "2026-06-13 Yerel Kan\u0131t Matrisi",
    "2026-06-13 \u0130lk 10 G\u00f6rev Kapan\u0131\u015f Denetimi",
    "2026-06-13 Prod \u00d6ncesi A\u00e7\u0131klar G\u00fcncel Haritas\u0131",
    "Bu tablo yaln\u0131z yerel/statik veya in-memory test kan\u0131t\u0131d\u0131r.",
    `\u00c7\u0131plak \`${rawPnpmCiCommand}\``,
    "3/3 Playwright axe/tablet smoke",
    "`pnpm web:backup-restore-panel:check`",
    "backup-restore-next.spec.ts",
    "WEB_PERFORMANCE_PROFILE_OUT",
    "OPENAPI_OUTPUT",
    "AUDIT_LOG_PARTITION_EVIDENCE_FILE",
    "BACKUP_RESTORE_SMOKE_EVIDENCE_FILE",
    "Live onboarding evidence preflight",
    "Live UI-worker evidence preflight",
    "LIVE_UI_WORKER_EVIDENCE_PATH",
    "Canlı durum transition guard",
    "Backup/WAL `file://` hedefleri root/lokal temp/symlink dizin/parent path reddi",
    "rate_limit_redis_smoke",
    "rls_load_smoke",
    "report_generation_smoke",
    "parent-symlink target reddi",
    "backup-restore/rate-limit/RLS-load/report-generation artifact exact top-level",
    "özel hash/threshold/gaps kuralları",
    "`pnpm prod:plan:check`",
    "EXTERNAL_NOT_RUN",
  ],
  failures,
);

const requiredMatrixCommands = [
  "pnpm run ci",
  "pnpm github-ci:check",
  "pnpm prod:evidence:templates:check",
  "pnpm smoke:evidence:check",
  "pnpm prod:evidence:summary:check",
  "pnpm web:token-storage:check",
  "pnpm web:performance:check",
  "pnpm db:rls:check",
  "pnpm rls:live:check",
  "pnpm audit-log-partition:check",
  "pnpm web:a11y:check",
  "pnpm web:backup-restore-panel:check",
  "pnpm live:onboarding:evidence-contract",
  "pnpm live:ui-worker:evidence-contract",
  "pnpm web:ux-baseline:check",
  "pnpm karne:visual-contract:check",
  "pnpm pii:contact-policy:check",
  "pnpm live:exam-cycle:check",
  "pnpm inline-upload-content:check",
  "pnpm rate-limit:check",
  "pnpm staging:evidence-env:check",
  "pnpm staging:release-artifacts:check",
  "pnpm live:status:check",
  "pnpm report-listing:k6:check",
];

for (const command of requiredMatrixCommands) {
  const row = findTableRow(plan, command);
  if (!row) {
    failures.push(`${planPath} local evidence matrix missing command: ${command}`);
    continue;
  }
  if (!row.includes("PASS")) {
    failures.push(`${planPath} local evidence matrix row is not PASS: ${command}`);
  }
}

const expectedTaskStatuses = new Map([
  [1, "LOCAL_PASS"],
  [2, "LOCAL_RLS_CONTRACT_PASS_WITH_LIVE_DB_PENDING"],
  [3, "LOCAL_RLS_CONTRACT_PASS_WITH_LIVE_DB_PENDING"],
  [4, "LOCAL_GITHUB_CI_CONTRACT_PASS_WITH_REMOTE_RUN_PENDING"],
  [5, "LOCAL_REDIS_CONTRACT_PASS_WITH_STAGING_SMOKE_PENDING"],
  [6, "LOCAL_PASS_WITH_PROVIDER_PENDING"],
  [7, "IP_STAGING_PASS_WITH_ACME_DOMAIN_PENDING"],
  [8, "LOCAL_PASS_WITH_LIVE_PERF_PENDING"],
  [9, "LOCAL_PASS"],
  [10, "EXTERNAL_NOT_RUN"],
]);

for (const [taskNumber, status] of expectedTaskStatuses) {
  const row = findTaskRow(plan, taskNumber);
  if (!row) {
    failures.push(`${planPath} first-10 task table missing row: ${taskNumber}`);
    continue;
  }
  if (!row.includes(status)) {
    failures.push(`${planPath} task ${taskNumber} does not have expected status: ${status}`);
  }
}

const expectedIssueStatuses = new Map([
  ["A1", "LOCAL_RLS_CONTRACT_PASS_WITH_LIVE_DB_PENDING"],
  ["A2", "LOCAL_RLS_CONTRACT_PASS_WITH_LIVE_DB_PENDING"],
  ["A3", "LOCAL_REDIS_CONTRACT_PASS_WITH_STAGING_SMOKE_PENDING"],
  ["A4", "LOCAL_PASS"],
  ["A5", "LOCAL_PASS_WITH_SCANNER_PENDING"],
  ["A6", "LOCAL_DECISION_PASS_WITH_REAL_INVENTORY_PENDING"],
  ["A7", "LOCAL_PASS"],
  ["A8", "LOCAL_PASS_WITH_PROVIDER_PENDING"],
  ["B1", "LOCAL_PASS"],
  ["B2", "LOCAL_GITHUB_CI_CONTRACT_PASS_WITH_REMOTE_RUN_PENDING"],
  ["B3", "LOCAL_CONTRACT_PASS_WITH_STAGING_UAT_PENDING"],
  ["B4", "LOCAL_PRODUCTION_SUMMARY_CONTRACT_PASS_WITH_REAL_REPORTS_PENDING"],
  ["C1", "IP_STAGING_PASS_WITH_ACME_DOMAIN_PENDING"],
  ["C2", "CONFIG_PASS"],
  ["C3", "EXTERNAL_NOT_RUN"],
  ["C4", "LOCAL_PASS_WITH_LIVE_PERF_PENDING"],
  ["C5", "LOCAL_MIGRATION_CONTRACT_PASS_WITH_REAL_RUN_PENDING"],
  ["C6", "LOCAL_PASS_WITH_ALERT_PENDING"],
  ["D1", "LOCAL_PASS_WITH_CONTENT_APPROVAL_PENDING"],
  ["D2", "LOCAL_PASS_WITH_STAGING_PENDING"],
  ["D3", "V1_OUT_DECIDED"],
  ["D4", "LOCAL_DECISION_PASS_WITH_BRAND_APPROVAL_PENDING"],
  ["D5", "LOCAL_BASELINE_PASS_WITH_FUTURE_UI_PENDING"],
  ["D6", "LOCAL_PASS"],
]);

for (const [issueId, status] of expectedIssueStatuses) {
  const row = findIssueRow(plan, issueId);
  if (!row) {
    failures.push(`${planPath} current issue map missing row: ${issueId}`);
    continue;
  }
  if (!row.includes(status)) {
    failures.push(`${planPath} issue ${issueId} does not have expected status: ${status}`);
  }
}

const expectedArchitecturePhaseStatuses = new Map([
  ["Faz 1 - Gate ve Plan Netligi", "LOCAL_PASS"],
  ["Faz 2 - OpenAPI ve Shared Contract Kalitesi", "LOCAL_PASS"],
  ["Faz 3 - Tenant FK ve DB Butunlugu", "STAGING_RLS_PASS_WITH_PROD_CHAIN_PENDING"],
  ["Faz 4 - Rapor/Optik UX ve Privacy Minimizasyonu", "PARTIAL_LOCAL_PASS"],
  ["Faz 4A - iSEM Fixture Kapanisi", "STAGING_ISEM_AND_LIVE_EXAM_PASS_WITH_PILOT_PENDING"],
  ["Faz 5 - Gercek Evidence ve Provider Kapanisi", "LOCAL_SMOKE_PASS_EXTERNAL_PENDING"],
  ["Faz 10 - Pilot ve Go-live Kapanisi", "EXTERNAL_NOT_RUN"],
]);

for (const [phase, status] of expectedArchitecturePhaseStatuses) {
  const row = findArchitecturePhaseRow(architecturePlan, phase);
  if (!row) {
    failures.push(`${architecturePlanPath} phase status table missing row: ${phase}`);
    continue;
  }
  if (!row.includes(`| ${phase} | \`${status}\``)) {
    failures.push(`${architecturePlanPath} ${phase} does not have expected status: ${status}`);
  }
}

const expectedArchitectureClosureRows = new Map([
  [
    "Faz 3 - Tenant FK ve DB Butunlugu",
    [
      "RLS_LIVE_EVIDENCE_TARGET",
      "corepack pnpm rls:live:check",
      "corepack pnpm db:rls:check",
      "corepack pnpm db:rls:check:live",
      "corepack pnpm rls:load:smoke",
      "RLS live kanıtı",
      "tenantFkPreflight",
      "0 legacy allowlist",
    ],
  ],
  [
    "Faz 4 - Rapor/Optik UX ve Privacy Minimizasyonu",
    [
      "KVKK_INVENTORY_TARGET",
      "corepack pnpm privacy:inventory:check",
      "ISEM_OPTICAL_PIPELINE_TARGET",
      "corepack pnpm isem-optical-pipeline:evidence-check",
      "KVKK inventory kanıtı",
      "Ham TXT",
    ],
  ],
  [
    "Faz 4A - iSEM Fixture Kapanisi",
    [
      "ISEM_OPTICAL_PIPELINE_TARGET",
      "LIVE_EXAM_CYCLE_TARGET",
      "PILOT_EVIDENCE_TARGET",
      "corepack pnpm live:exam-cycle:check",
      "Live exam cycle kanıtı",
      "254 `ExamResult`",
    ],
  ],
  [
    "Faz 5 - Gercek Evidence ve Provider Kapanisi",
    [
      "corepack pnpm prod:env:check",
      "corepack pnpm prod:evidence:check --summary-file artifacts/staging/production-summary.json",
      "corepack pnpm prod:evidence:summary:check",
      "STAGING_RELEASE_ARTIFACTS_TARGET",
      "LIVE_EXAM_CYCLE_TARGET",
      "ISEM_OPTICAL_PIPELINE_TARGET",
      "LIVE_UI_WORKER_RESULT_EVIDENCE_TARGET",
      "INLINE_UPLOAD_CONTENT_MIGRATION_TARGET",
      "AUDIT_NULL_TENANT_EVIDENCE_TARGET",
      "RATE_LIMIT_EVIDENCE_TARGET",
      "RLS_LIVE_EVIDENCE_TARGET",
      "SMS_PROVIDER_SMOKE_EVIDENCE_FILE",
      "NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE",
      "Live exam cycle kanıtı",
      "iSEM optical pipeline kanıtı",
      "Live UI-worker result kanıtı",
      "SMS provider kanıtı",
    ],
  ],
  [
    "Faz 10 - Pilot ve Go-live Kapanisi",
    [
      "PILOT_EVIDENCE_TARGET",
      "GO_LIVE_EVIDENCE_TARGET",
      "LIVE_STATUS_EVIDENCE_TARGET",
      "REPORT_GENERATION_SMOKE_EVIDENCE_FILE",
      "corepack pnpm go-live:check",
      "18/18 Canli Durum PASS",
      "goLiveDecision=APPROVED",
    ],
  ],
]);

for (const [phase, tokens] of expectedArchitectureClosureRows) {
  const row = findArchitectureClosureRow(architecturePlan, phase, tokens);
  if (!row) {
    failures.push(`${architecturePlanPath} phase closure evidence map missing row or tokens: ${phase}`);
  }
}

const expectedLiveStatusGateOwnershipRows = [
  ["Traefik HTTPS smoke", "Faz 5", "pnpm traefik:https:smoke", "productionEvidenceSummary.smokeEvidence.traefikHttps"],
  ["TR datacenter/provider kanıtı", "Faz 5", "pnpm deployment:region:check", "productionEvidenceSummary.reports.deploymentRegion"],
  ["Live exam cycle kanıtı", "Faz 5", "pnpm live:exam-cycle:check", "productionEvidenceSummary.reports.liveExamCycle"],
  ["iSEM optical pipeline kanıtı", "Faz 4A", "pnpm isem-optical-pipeline:evidence-check", "productionEvidenceSummary.reports.isemOpticalPipeline"],
  ["Live UI-worker result kanıtı", "Faz 5", "pnpm live:ui-worker:result-check", "productionEvidenceSummary.reports.liveUiWorkerResult"],
  ["KVKK inventory kanıtı", "Faz 4", "pnpm privacy:inventory:check", "productionEvidenceSummary.reports.kvkkInventory"],
  ["RLS live kanıtı", "Faz 3", "pnpm rls:live:check", "productionEvidenceSummary.reports.rlsLive"],
  ["Inline upload migration kanıtı", "Faz 5", "pnpm inline-upload-content:check", "productionEvidenceSummary.reports.inlineUploadMigration"],
  ["Audit null tenant kanıtı", "Faz 5", "pnpm audit-null-tenant:check", "productionEvidenceSummary.reports.auditNullTenant"],
  ["Rate limit Redis kanıtı", "Faz 5", "pnpm rate-limit:check", "productionEvidenceSummary.reports.rateLimit"],
  ["SMS provider kanıtı", "Faz 5", "pnpm sms:smoke", "productionEvidenceSummary.smokeEvidence.smsProvider"],
  ["Notification provider kanıtı", "Faz 5", "pnpm notification:smoke", "productionEvidenceSummary.smokeEvidence.notificationProvider"],
  ["Report generation perf kanıtı", "Faz 10", "pnpm report-generation:perf", "productionEvidenceSummary.smokeEvidence.reportGeneration"],
  ["Staging/prod UAT", "Faz 10", "pnpm uat:check", "productionEvidenceSummary.reports.uat"],
  ["Deployment rollback tatbikatı", "Faz 10", "pnpm deployment:rollback:check", "productionEvidenceSummary.reports.deploymentRollback"],
  ["Pilot kapanış kanıtı", "Faz 10", "pnpm pilot:check", "pilotEvidence"],
  ["Go-live karar paketi", "Faz 10", "pnpm go-live:check", "goLiveEvidence"],
  ["Alert bildirim kanalı", "Faz 10", "pnpm alert:webhook:smoke", "productionEvidenceSummary.smokeEvidence.alertWebhook"],
];

for (const [gate, phase, command, source] of expectedLiveStatusGateOwnershipRows) {
  const row = findArchitectureLiveStatusGateOwnerRow(architecturePlan, gate, [phase, command, source]);
  if (!row) {
    failures.push(`${architecturePlanPath} live status gate ownership row missing or mismatched: ${gate}`);
  }
}

const expectedRemainingReleaseArtifactRows = [
  [
    "first-gates/first-gates-manifest.json",
    [
      "ops_release_engineer",
      "Faz 5 infra-provider",
      "staging:first-gates:check",
      "external_tls_and_alert_secret",
      "Public TLS/HSTS domain",
    ],
  ],
  [
    "reports/deployment-region.json",
    [
      "ops_release_engineer",
      "Faz 5 deployment region",
      "deployment:region:check",
      "provider_contract_evidence",
      "public IP lookup tek basina kabul edilmiyor",
    ],
  ],
  [
    "reports/deployment-rollback.json",
    [
      "infra_dr_engineer",
      "Faz 10 rollback",
      "deployment:rollback:check",
      "rollback_drill",
      "Gercek bozuk image deploy",
    ],
  ],
  [
    "reports/identity-migration.json",
    [
      "auth_session_engineer",
      "Faz 5 identity",
      "identity-migration:check",
      "approval_and_subject_data",
      "Student=0",
      "IdentityInvitation=0",
    ],
  ],
  [
    "reports/financial-retention.json",
    [
      "privacy_governance_reviewer",
      "Faz 5 finans-KVKK",
      "financial-retention:check",
      "policy_approval_and_finance_data",
      "PaymentPlan=0",
      "PaymentInstallment=0",
    ],
  ],
  [
    "reports/observability-uat.json",
    [
      "observability_sre_engineer",
      "Faz 5 observability",
      "observability:uat:check",
      "monitoring_stack_and_alert_artifact",
      "Prometheus/Grafana/Loki HTTPS endpointleri",
    ],
  ],
  [
    "reports/external-monitoring.json",
    [
      "observability_sre_engineer",
      "Faz 5 dis monitoring",
      "external-monitoring:check",
      "external_monitoring_drill",
      "outage drill delivery kaniti yok",
    ],
  ],
  [
    "reports/admin-mfa.json",
    [
      "auth_session_engineer",
      "Faz 5 Admin MFA",
      "admin-mfa:check",
      "admin_enrollment_and_login_negatives",
      "Gercek admin enrollment",
    ],
  ],
  [
    "reports/security-audit.json",
    [
      "tenant_security_reviewer",
      "Faz 5 security audit",
      "security:audit:check",
      "public_https_and_auth_data_controls",
      "Public HTTPS/header target",
    ],
  ],
  [
    "reports/uat.json",
    [
      "qa_verification_engineer",
      "Faz 5 UAT",
      "uat:check",
      "role_based_uat_artifacts",
      "12 komut PASS evidence seti",
      "21 persona senaryo",
    ],
  ],
  [
    "release-summary-*.json",
    [
      "ops_release_engineer",
      "Faz 5-10 summary",
      "prod:evidence:summary:check",
      "generate_after_all_required_artifacts",
      "false evidence",
      "su an 0 summary var",
    ],
  ],
];

for (const [artifactPath, tokens] of expectedRemainingReleaseArtifactRows) {
  const row = findArchitectureRemainingArtifactRow(architecturePlan, artifactPath, tokens);
  if (!row) {
    failures.push(`${architecturePlanPath} remaining release artifact row missing or mismatched: ${artifactPath}`);
  }
}

const requiredArchitecturePendingTokens = [
  "Broad CI ve staging kaniti Faz 5/Faz 10 kapsaminda.",
  "gercek live/staging DB artifact'i",
  "KVKK staging artifact'inin production summary/live-status zincirine baglanmasi",
  "remote/staging `o-okul-server` uzerinde `artifacts/staging/isem-optical-pipeline.json`",
  "`artifacts/staging/live-ui-worker-result.json` PDF/XLSX indirme",
  "UI-worker result",
  "pilot/go-live kanitlari uretilmeli",
  "`reports.liveUiWorkerResult` olarak yazilir",
  "production summary ve go-live linked summary",
  "henuz production summary/live-status zincirine baglanmadi",
  "Faz 10 - Pilot ve Go-live Kapanisi",
  "Gercek pilot kapanis raporu",
  "18/18 Canli Durum PASS bundle'i",
  "report-generation perf artifact'i production summary/live-status zincirine baglanmali",
  "`PILOT_EVIDENCE_TARGET` gercek production pilot raporuna baglanir",
  "`GO_LIVE_EVIDENCE_TARGET` ayni artifact setindeki production summary",
  "`LIVE_STATUS_EVIDENCE_TARGET=file:///.../live-status.json corepack pnpm live:status:check`",
  "## Faz Kapanis Kanit Haritasi",
  "## Canli Durum Gate Sahiplik Haritasi",
  "## Tamamlanma Denetimi",
  "STAGING_RELEASE_ARTIFACTS_TARGET=/path/to/artifacts/staging corepack pnpm staging:release-artifacts:check",
  "REPORT_GENERATION_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/report-generation.json corepack pnpm report-generation:perf",
  "corepack pnpm db:rls:check:live",
  "corepack pnpm prod:evidence:check --summary-file artifacts/staging/production-summary.json",
  "## Kapanis Calistirma Sirasi",
  "Preflight bundle hijyeni",
  "Infra ve provider ilk kapilar",
  "Tenant, privacy ve veri kanitlari",
  "Sinav, rapor ve UAT kanitlari",
  "Production summary ve Canli Durum terfisi",
  "Pilot, rollback ve go-live karari",
  "Faz status degisimi",
  "`corepack pnpm staging:evidence-env:check`",
  "`corepack pnpm staging:release-gaps:summary -- --artifacts-dir artifacts/staging --gap-report-file artifacts/local/staging-release-gap-report.json`",
  "`corepack pnpm staging:first-gates:check`",
  "`corepack pnpm deployment:rollback:check`",
  "`corepack pnpm alert:webhook:smoke`",
  "`corepack pnpm karne:visual-contract:check`",
  "SMS_PROVIDER_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/sms-provider.json corepack pnpm sms:smoke",
  "NOTIFICATION_PROVIDER_SMOKE_EVIDENCE_FILE=artifacts/staging/smoke/notification-provider.json corepack pnpm notification:smoke",
  "`LIVE_STATUS_EVIDENCE_TARGET=file:///... corepack pnpm live:status:check`",
  "`PRODUCTION_EVIDENCE_SUMMARY_TARGET=file:///.../production-summary.json corepack pnpm prod:evidence:summary:check`",
  "corepack pnpm prod:external-evidence:check",
  "corepack pnpm prod:remote-evidence:check",
  "target'siz veya `ALLOW_EXAMPLE_EVIDENCE=1` ile calisan `prod:external-evidence:check`",
  "`ALLOW_EXAMPLE_EVIDENCE=1` ile calisan `prod:external-evidence:check`",
  "`corepack pnpm ops:check` (statik/toparlayici gate; target'li 18/18 Canli Durum yerine gecmez)",
  "Target'siz `corepack pnpm live:status:check` ile gelen `0/18` PASS",
  "Faz 5 ancak `EXTERNAL_EVIDENCE_PASS`, Faz 10 ancak `GO_LIVE_APPROVED`",
  "10k sonuc/ogrenci",
  "Bearer auth, 2xx webhook",
  "Fixture/local smoke tek basina final kapanis kaniti degildir.",
  "ALLOW_EXAMPLE_EVIDENCE",
  "source date/reference/result/environment",
  "`corepack pnpm prod:evidence:templates:check`, `corepack pnpm prod:readiness:check`, `corepack pnpm ops:check`, `corepack pnpm prod:plan:check`",
  "dar unit test veya yalniz statik dokuman guncellemesi final kabul kaniti sayilmaz.",
  "missingRequiredFiles=10",
  "13 acik kapanis kalemi",
  "openClosureItems",
  "unexpectedFiles=0",
  "invalidFiles",
  "mismatchFailures",
  "blockedChecks=1",
  "Kalan 10 Artifact Kapanis Matrisi",
];

requireTokens(architecturePlanPath, architecturePlan, requiredArchitecturePendingTokens, failures);

const requiredNotRunLines = [
  "Traefik HTTPS smoke: `NOT_RUN`",
  "TR datacenter/provider kan\u0131t\u0131: `NOT_RUN`",
  "Live exam cycle kan\u0131t\u0131: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`",
  "iSEM optical pipeline kan\u0131t\u0131: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`",
  "Live UI-worker result kan\u0131t\u0131: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`",
  "KVKK inventory kan\u0131t\u0131: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`",
  "RLS live kan\u0131t\u0131: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`",
  "Inline upload migration kan\u0131t\u0131: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`",
  "Audit null tenant kan\u0131t\u0131: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`",
  "Rate limit Redis kan\u0131t\u0131: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`",
  "SMS provider kan\u0131t\u0131: `NOT_RUN`",
  "Notification provider kan\u0131t\u0131: `NOT_RUN`",
  "Report generation perf kan\u0131t\u0131: `STAGING_PASS_WITH_FINAL_CHAIN_PENDING`",
  "Staging/prod UAT: `NOT_RUN`",
  "Deployment rollback tatbikat\u0131: `NOT_RUN`",
  "Pilot kapan\u0131\u015f kan\u0131t\u0131: `NOT_RUN`",
  "Go-live karar paketi: `NOT_RUN`",
  "Alert bildirim kanal\u0131: `NOT_RUN`",
];

for (const line of requiredNotRunLines) {
  if (!readiness.includes(line)) {
    failures.push(`${readinessPath} live status line missing or not NOT_RUN: ${line}`);
  }
}

checkNoStaleLiveStatusGateCount(readinessPath, readiness, failures);

checkNoRawPnpmCiReferences(
  [
    [planPath, plan],
    [readinessPath, readiness],
    [developmentPlanPath, developmentPlan],
  ],
  failures,
);

const tenantLegacyFkCount = countLegacyFkExceptions(tenantRelationFkChecker);
const tenantLegacyCountRows = [
  ["bulgular", "Tenant relation FK checker bu turdan sonra", `${tenantLegacyFkCount} legacy istisna`],
  ["oncelik", "Kalan tenant composite FK legacy borcunu azaltmak", `diger ${tenantLegacyFkCount} legacy iliski`],
  ["faz-durumu", "Faz 3 - Tenant FK ve DB Butunlugu", `Kalan ${tenantLegacyFkCount} legacy FK istisnasi`],
  ["bilinen-kalan", "legacy FK istisnasi hala allowlist", `${tenantLegacyFkCount} legacy FK istisnasi`],
  ["plan-kaydi", "izlenen legacy istisna", `${tenantLegacyFkCount} izlenen legacy istisna`],
];

for (const [label, rowToken, countToken] of tenantLegacyCountRows) {
  const rows = architecturePlan
    .split(/\r?\n/)
    .filter((line) => line.includes(rowToken));
  if (rows.length === 0) {
    failures.push(`${architecturePlanPath} tenant legacy FK count row missing: ${label}`);
    continue;
  }
  const hasCount = label === "plan-kaydi"
    ? rows.some((line) => line.includes(countToken))
    : rows[0].includes(countToken);
  if (!hasCount) {
    failures.push(`${architecturePlanPath} tenant legacy FK count mismatch in ${label}: expected ${countToken}`);
  }
}

const scripts = packageJson.scripts ?? {};
if (scripts["prod:plan:check"] !== "node scripts/check-prod-plan-status.mjs") {
  failures.push(`${packagePath} prod:plan:check must run node scripts/check-prod-plan-status.mjs.`);
}
if (scripts["idempotency:inventory:check"] !== "node scripts/check-idempotency-inventory.mjs") {
  failures.push(`${packagePath} idempotency:inventory:check must run node scripts/check-idempotency-inventory.mjs.`);
}
if (!scripts.ci?.includes("pnpm idempotency:inventory:check")) {
  failures.push(`${packagePath} ci script must run idempotency:inventory:check after OpenAPI generation.`);
}
if (!scripts["ops:check"]?.includes("pnpm prod:plan:check")) {
  failures.push(`${packagePath} ops:check must run prod:plan:check.`);
}
if (scripts["live:status:check"] !== "node scripts/check-live-status-evidence.mjs") {
  failures.push(`${packagePath} live:status:check must run node scripts/check-live-status-evidence.mjs.`);
}
if (!scripts["ops:check"]?.includes("pnpm live:status:check")) {
  failures.push(`${packagePath} ops:check must run live:status:check.`);
}
if (!scripts.ci?.includes("pnpm ops:check")) {
  failures.push(`${packagePath} ci script must run ops:check.`);
}

const requiredEvidenceScriptTokens = new Map([
  ["prod:env:check", ["scripts/check-prod-env.mjs"]],
  ["prod:evidence:check", ["scripts/check-prod-evidence.mjs"]],
  ["prod:external-evidence:check", ["scripts/check-final-external-evidence.mjs"]],
  ["prod:remote-evidence:check", ["scripts/check-remote-final-evidence-readiness.mjs"]],
  ["prod:evidence:summary:check", ["scripts/check-production-evidence-summary.mjs"]],
  ["prod:evidence:templates:check", ["scripts/check-prod-evidence-templates.mjs"]],
  ["staging:evidence-env:check", ["scripts/check-staging-evidence-env.mjs"]],
  ["staging:release-artifacts:check", ["scripts/check-staging-release-artifacts.mjs"]],
  ["staging:release-gaps:summary", ["scripts/print-staging-release-gap-summary.mjs"]],
  ["staging:first-gates:check", ["scripts/check-staging-first-gates-evidence.mjs"]],
  ["traefik:https:smoke", ["scripts/smoke-traefik-https.mjs"]],
  ["deployment:region:check", ["scripts/check-deployment-region-evidence.mjs"]],
  ["deployment:rollback:check", ["scripts/check-deployment-rollback-evidence.mjs"]],
  ["alert:webhook:smoke", ["scripts/smoke-alert-webhook.mjs"]],
  ["sms:smoke", ["scripts/smoke-sms-provider.mjs"]],
  ["notification:smoke", ["scripts/smoke-notification-provider.mjs"]],
  ["rate-limit:check", ["scripts/check-rate-limit-evidence.mjs"]],
  ["db:rls:check:live", ["@o-okul/db", "db:rls:check:live"]],
  ["rls:live:check", ["scripts/check-rls-live-evidence.mjs"]],
  ["privacy:inventory:check", ["scripts/check-kvkk-inventory-evidence.mjs"]],
  ["inline-upload-content:check", ["scripts/check-inline-upload-content-migration-evidence.mjs"]],
  ["audit-null-tenant:check", ["scripts/check-audit-null-tenant-evidence.mjs"]],
  ["isem-optical-pipeline:evidence-check", ["scripts/check-isem-optical-pipeline-evidence.mjs"]],
  ["live:exam-cycle:check", ["scripts/check-live-exam-cycle-evidence.mjs"]],
  ["live:ui-worker:result-check", ["scripts/check-live-ui-worker-result-evidence.mjs"]],
  ["report-generation:perf", ["REPORT_GENERATION_SMOKE_RESULT_COUNT=10000", "scripts/smoke-report-generation-live.mjs"]],
  ["uat:check", ["scripts/check-uat-evidence.mjs"]],
  ["pilot:check", ["scripts/check-pilot-evidence.mjs"]],
  ["go-live:check", ["scripts/check-go-live-evidence.mjs"]],
]);

for (const [scriptName, tokens] of requiredEvidenceScriptTokens) {
  requireScriptTokens(scriptName, tokens, failures);
}

requireTokens(
  architecturePlanPath,
  architecturePlan,
  [
    "scripts/check-idempotency-inventory.mjs",
    "30 idempotency operation",
    "OpenAPI response envelope",
    "corepack pnpm idempotency:inventory:check",
  ],
  failures,
);

requireTokens(
  rlsLiveEvidenceCheckerPath,
  rlsLiveEvidenceChecker,
  [
    "RLS_LIVE_EVIDENCE_TARGET production kaniti icin artifacts/local altinda olmamali.",
    "evidenceReferences.${index} local smoke artifact referansi tasimamali.",
    "artifact:, run:, log:, url:, https://, file://, s3:// veya artifacts/ ile baslayan kalici referans olmali.",
    "db-rls-check.log",
    "db-rls-check-live.log",
    "rls-load-smoke.json",
  ],
  failures,
);

requireTokens(
  prodEvidenceCheckerPath,
  prodEvidenceChecker,
  [
    "production için artifacts/local altında olmamalı.",
    "production evidence target URL userinfo, query veya fragment içeremez.",
    "isLocalSmokeArtifactPath",
  ],
  failures,
);

requireTokens(
  liveStatusEvidenceCheckerPath,
  liveStatusEvidenceChecker,
  [
    "LIVE_STATUS_EVIDENCE_TARGET artifacts/local altında olmamalı.",
    "isLocalSmokeEvidenceTargetUrl",
  ],
  failures,
);

requireTokens(
  liveStatusEvidenceGeneratorPath,
  liveStatusEvidenceGenerator,
  [
    "LIVE_STATUS_EVIDENCE_OUTPUT artifacts/local altında olmamalı.",
    "goLiveEvidence.liveStatusEvidence.evidenceTarget artifacts/local altında olmamalı.",
  ],
  failures,
);

requireTokens(
  goLiveEvidenceCheckerPath,
  goLiveEvidenceChecker,
  [
    "GO_LIVE_EVIDENCE_TARGET artifacts/local altinda olmamali.",
    "liveStatusEvidence.evidenceTarget artifacts/local altinda olmamali.",
    "hasSecretBearingUrlParts",
    "target URL userinfo, query veya fragment iceremez.",
  ],
  failures,
);

requireTokens(
  finalExternalEvidenceCheckerPath,
  finalExternalEvidenceChecker,
  [
    "PRODUCTION_EVIDENCE_SUMMARY_TARGET",
    "LIVE_STATUS_EVIDENCE_TARGET",
    "PILOT_EVIDENCE_TARGET",
    "GO_LIVE_EVIDENCE_TARGET",
    "Live status evidence kontrolü geçti: 18/18 dış kanıt PASS.",
    "target'sız veya kısmi Canlı Durum final kanıt sayılmaz.",
    "final target env ile aynı artifact hedefine bağlanmalı.",
    "final dış kanıt kapısında kullanılamaz.",
    "final dış kanıt için lokal temp path olmamalı.",
    "final dış kanıt için artifacts/local altında olmamalı.",
    "final dış kanıt için docs/evidence-templates fixture hedefi olmamalı.",
    "final dış kanıt için gerçek https host olmalı.",
    "final dış kanıt target URL userinfo, query veya fragment içeremez.",
    "symlink olmayan file artifact olmalı.",
    "LIVE_STATUS_READINESS_PATH final dış kanıt kapısında",
  ],
  failures,
);

requireTokens(
  remoteFinalEvidenceCheckerPath,
  remoteFinalEvidenceChecker,
  [
    "REMOTE_EVIDENCE_HOST",
    "REMOTE_EVIDENCE_ROOT",
    "scripts/check-final-external-evidence.mjs",
    "prod:external-evidence:check",
    "remoteEvidenceEnvPrefix",
    "${remoteEvidenceEnvPrefix} node scripts/check-live-status-evidence.mjs",
    "Live status evidence kontrolü geçti: 18/18 dış kanıt PASS.",
    "Remote live:status:check 18/18 dış kanıt PASS üretmeli",
    "remote final kanıt kapısı için zorunlu.",
    "remote final kanıt target URL userinfo, query veya fragment içeremez.",
    "remote final kanıt için gerçek https host olmalı.",
    "remote final kanıt file:// URL remote host taşımamalı.",
    "remote final kanıt için remote temp path olmamalı.",
    "remote final kanıt için artifacts/local altında olmamalı.",
    "remote final kanıt için docs/evidence-templates fixture hedefi olmamalı.",
  ],
  failures,
);

requireTokens(
  stagingReleaseGapSummaryPath,
  stagingReleaseGapSummary,
  [
    "STAGING_RELEASE_ARTIFACTS_TARGET",
    "STAGING_RELEASE_GAP_REPORT_FILE",
    "scripts/check-staging-release-artifacts.mjs",
    "Staging release artifact gap özeti",
    "missingRequiredFiles",
    "unexpectedFiles",
    "invalidFiles",
    "mismatchFailures",
    "blockedChecks",
    "Staging release gap raporu yazıldı:",
    "taze gap raporu yazım onayı",
    "validateFreshGapReport",
    "generatedAt geçerli tarih değil",
    "bu komut koşusundan eski",
    "ownerAgent",
    "evidenceGate",
    "nextActionKind",
    "release-summary-*.json",
  ],
  failures,
);

if (failures.length > 0) {
  console.error("Prod plan status check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Prod plan status check passed.");

function requireTokens(path, source, tokens, output) {
  for (const token of tokens) {
    if (!source.includes(token)) {
      output.push(`${path} missing expected token: ${token}`);
    }
  }
}

function requireScriptTokens(scriptName, tokens, output) {
  const script = scripts[scriptName];
  if (typeof script !== "string") {
    output.push(`${packagePath} missing required evidence script: ${scriptName}.`);
    return;
  }
  for (const token of tokens) {
    if (!script.includes(token)) {
      output.push(`${packagePath} ${scriptName} script missing token: ${token}`);
    }
  }
}

function findTableRow(markdown, token) {
  return markdown
    .split(/\r?\n/)
    .find((line) => line.startsWith("|") && line.includes(token));
}

function findTaskRow(markdown, taskNumber) {
  const prefix = `| ${taskNumber} |`;
  return markdown
    .split(/\r?\n/)
    .find((line) => line.startsWith(prefix));
}

function findIssueRow(markdown, issueId) {
  const prefix = `| ${issueId} `;
  return markdown
    .split(/\r?\n/)
    .find((line) => line.startsWith(prefix));
}

function findArchitecturePhaseRow(markdown, phase) {
  const prefix = `| ${phase} |`;
  return markdown
    .split(/\r?\n/)
    .find((line) => line.startsWith(prefix));
}

function findArchitectureClosureRow(markdown, phase, requiredTokens) {
  return markdown
    .split(/\r?\n/)
    .find((line) => line.startsWith(`| ${phase} |`) && requiredTokens.every((token) => line.includes(token)));
}

function findArchitectureLiveStatusGateOwnerRow(markdown, gate, requiredTokens) {
  return markdown
    .split(/\r?\n/)
    .find((line) => line.startsWith(`| ${gate} |`) && requiredTokens.every((token) => line.includes(token)));
}

function findArchitectureRemainingArtifactRow(markdown, artifactPath, requiredTokens) {
  return markdown
    .split(/\r?\n/)
    .find((line) => line.startsWith(`| \`${artifactPath}\` |`) && requiredTokens.every((token) => line.includes(token)));
}

function checkNoStaleLiveStatusGateCount(path, source, output) {
  const stalePatterns = [
    [/yedi\s+dış\s+Canlı\s+Durum\s+satır/iu, "yedi dış Canlı Durum satırı"],
    [/7\s+(dış\s+)?(Canlı\s+Durum\s+)?(gate|kapı)/iu, "7 gate/kapı"],
    [/tam\s+7\s+gate/iu, "tam 7 gate"],
  ];

  for (const [pattern, label] of stalePatterns) {
    if (pattern.test(source)) {
      output.push(`${path} stale live-status gate count token found: ${label}; use 18 gate.`);
    }
  }
}

function checkNoRawPnpmCiReferences(files, output) {
  const rawPnpmCiPattern = new RegExp(`\\b${escapeRegExp(rawPnpmCiCommand)}\\b`);
  for (const [path, source] of files) {
    for (const [index, line] of source.split(/\r?\n/).entries()) {
      if (!rawPnpmCiPattern.test(line)) continue;
      if (line.includes(runPnpmCiCommand)) continue;
      output.push(`${path}:${index + 1} contains raw ${rawPnpmCiCommand} reference; use ${runPnpmCiCommand}.`);
    }
  }
}

function countLegacyFkExceptions(source) {
  const allowlist = source.match(/allowedLegacyRelations\s*=\s*new Map\(\[([\s\S]*?)\]\);/);
  if (!allowlist) {
    failures.push(`${tenantRelationFkCheckerPath} allowedLegacyRelations map not found.`);
    return 0;
  }
  return [...allowlist[1].matchAll(/"[A-Z]\w+\.[a-z]\w+"/g)].length;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
