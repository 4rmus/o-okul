import { readFileSync } from "node:fs";

const planPath = "claudedocs/prod-plan-2026-06-12.md";
const readinessPath = "docs/phase-6-production-readiness.md";
const developmentPlanPath = "docs/development-plan-2026-06-02.md";
const packagePath = "package.json";

const plan = readFileSync(planPath, "utf8");
const readiness = readFileSync(readinessPath, "utf8");
const developmentPlan = readFileSync(developmentPlanPath, "utf8");
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

const requiredNotRunLines = [
  "Traefik HTTPS smoke: `NOT_RUN`",
  "TR datacenter/provider kan\u0131t\u0131: `NOT_RUN`",
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

checkNoRawPnpmCiReferences(
  [
    [planPath, plan],
    [readinessPath, readiness],
    [developmentPlanPath, developmentPlan],
  ],
  failures,
);

const scripts = packageJson.scripts ?? {};
if (scripts["prod:plan:check"] !== "node scripts/check-prod-plan-status.mjs") {
  failures.push(`${packagePath} prod:plan:check must run node scripts/check-prod-plan-status.mjs.`);
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
