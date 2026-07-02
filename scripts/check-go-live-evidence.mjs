import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getTenantScopedTables } from "../packages/db/scripts/tenant-models.mjs";

const target = process.env.GO_LIVE_EVIDENCE_TARGET;
const allowExampleEvidence = process.env.GO_LIVE_ALLOW_EXAMPLE_EVIDENCE === "1";
const inlineUploadSubjects = ["homework_material_files", "support_ticket_attachments"];

const requiredEvidenceCheckScripts = new Map([
  ["Production env", "scripts/check-prod-env.mjs"],
  ["Traefik HTTPS", "scripts/smoke-traefik-https.mjs"],
  ["SMS disabled path", "scripts/smoke-sms-provider.mjs"],
  ["Notification provider", "scripts/smoke-notification-provider.mjs"],
  ["Sentry test event", "scripts/smoke-sentry-event.mjs"],
  ["Alert webhook", "scripts/smoke-alert-webhook.mjs"],
  ["WAL archive target", "scripts/smoke-wal-archive-target.mjs"],
  ["Report generation smoke", "scripts/smoke-report-generation-live.mjs"],
  ["Deployment rollback evidence", "scripts/check-deployment-rollback-evidence.mjs"],
  ["GitHub CI evidence", "scripts/check-github-ci-evidence.mjs"],
  ["Restore drill evidence", "scripts/check-restore-drill-evidence.mjs"],
  ["KVKK inventory evidence", "scripts/check-kvkk-inventory-evidence.mjs"],
  ["Identity migration evidence", "scripts/check-identity-migration-evidence.mjs"],
  ["Financial retention evidence", "scripts/check-financial-retention-evidence.mjs"],
  ["Upload AV evidence", "scripts/check-upload-av-evidence.mjs"],
  ["Observability UAT evidence", "scripts/check-observability-uat-evidence.mjs"],
  ["External monitoring evidence", "scripts/check-external-monitoring-evidence.mjs"],
  ["Admin MFA evidence", "scripts/check-admin-mfa-evidence.mjs"],
  ["AI report summary evidence", "scripts/check-ai-report-summary-evidence.mjs"],
  ["Security audit evidence", "scripts/check-security-audit-evidence.mjs"],
  ["Live exam cycle evidence", "scripts/check-live-exam-cycle-evidence.mjs"],
  ["iSEM optical pipeline evidence", "scripts/check-isem-optical-pipeline-evidence.mjs"],
  ["Live UI-worker result evidence", "scripts/check-live-ui-worker-result-evidence.mjs"],
  ["UI/UX redesign evidence", "scripts/check-ui-ux-redesign-evidence.mjs"],
  ["Inline upload migration evidence", "scripts/check-inline-upload-content-migration-evidence.mjs"],
  ["Audit null tenant evidence", "scripts/check-audit-null-tenant-evidence.mjs"],
  ["Rate limit Redis evidence", "scripts/check-rate-limit-evidence.mjs"],
  ["RLS live evidence", "scripts/check-rls-live-evidence.mjs"],
  ["UAT evidence", "scripts/check-uat-evidence.mjs"],
]);
const requiredEvidenceChecks = [...requiredEvidenceCheckScripts.keys()];
const goLiveTopLevelKeys = [
  "result",
  "environment",
  "checkedAt",
  "releaseCandidate",
  "rollbackImageTag",
  "productionEvidenceSummary",
  "liveStatusEvidence",
  "deployment",
  "uat",
  "pilot",
  "legal",
  "operations",
  "cutover",
  "approvals",
  "openRisks",
  "goLiveDecision",
  "evidenceReferences",
];
const goLiveProductionEvidenceSummaryKeys = ["result", "summaryTarget", "summaryReference", "generatedAt", "checksPassed"];
const goLiveLiveStatusEvidenceKeys = ["result", "evidenceTarget", "generatedAt", "gatesPassed"];
const goLiveDeploymentKeys = [
  "githubCiPassed",
  "traefikHttpsPassed",
  "restoreDrillPassed",
  "walArchivePassed",
  "reportGenerationPassed",
  "rollbackDrillPassed",
  "observabilityUatPassed",
  "externalMonitoringPassed",
  "adminMfaPassed",
  "aiReportSummaryPassed",
  "rateLimitRedisPassed",
  "rlsLivePassed",
  "securityAuditPassed",
];
const goLiveUatKeys = [
  "stagingUatPassed",
  "productionSmokePassed",
  "journeyScenarioCount",
  "liveOnboardingPassed",
  "liveExamCyclePassed",
  "liveUiWorkerReportPassed",
  "roleReportsSigned",
];
const goLivePilotKeys = ["pilotEvidencePassed", "pilotDurationDays", "criticalDefectsOpen", "goLiveDecision", "pilotEvidenceReference"];
const goLiveLegalKeys = [
  "dataProcessingAgreementSigned",
  "kvkkNoticeApproved",
  "privacyInventoryPassed",
  "financialRetentionPassed",
  "inlineUploadMigrationPassed",
  "auditNullTenantPassed",
];
const goLiveOperationsKeys = [
  "incidentRunbookAcknowledged",
  "supportChannelReady",
  "alertChannelReady",
  "backupRestoreOwnerAssigned",
  "rollbackOwnerAssigned",
  "monitoringOwnerAssigned",
  "onCallPrimary",
  "supportChannelReference",
];
const goLiveCutoverKeys = [
  "scheduledAt",
  "rollbackWindowMinutes",
  "monitoringWindowHours",
  "statusPageReady",
  "customerCommunicationReady",
];
const goLiveApprovalKeys = ["role", "decision", "approver", "approvedAt"];
const goLiveOpenRiskKeys = ["id", "severity", "accepted", "owner", "mitigation"];
const summaryTopLevelKeys = ["result", "generatedAt", "nodeEnv", "appUrl", "apiUrl", "webUrl", "checks", "smokeEvidence", "reports"];
const summaryCheckItemKeys = ["label", "script", "status"];
const summarySmokeEvidenceKeys = [
  "traefikHttps",
  "smsProvider",
  "notificationProvider",
  "sentryEvent",
  "alertWebhook",
  "walArchive",
  "reportGeneration",
];
const summaryReportKeys = [
  "restoreDrill",
  "deploymentRollback",
  "githubCi",
  "kvkkInventory",
  "identityMigration",
  "financialRetention",
  "uploadAv",
  "observabilityUat",
  "externalMonitoring",
  "adminMfa",
  "aiReportSummary",
  "securityAudit",
  "liveExamCycle",
  "isemOpticalPipeline",
  "liveUiWorkerResult",
  "uiUxRedesign",
  "inlineUploadMigration",
  "auditNullTenant",
  "rateLimit",
  "rlsLive",
  "uat",
];
const expectedKvkkAuditDiffNegativeControls = [
  "body",
  "contentBase64",
  "email",
  "fileBase64",
  "fileName",
  "firstName",
  "lastName",
  "message",
  "name",
  "nationalId",
  "objectKey",
  "phone",
  "rawLine",
  "rawRow",
  "rawText",
  "s3Key",
  "sourceFileName",
  "sourceFilePath",
  "subject",
  "title",
  "token",
];
const expectedKvkkAuditDiffActions = [
  "announcement.created",
  "message_template.created",
  "support_ticket.created",
  "support_ticket_comment.created",
  "kvkk.student_pii_purged",
  "kvkk.guardian_pii_purged",
  "kvkk.user_pii_purged",
];
const summaryRequiredReportKeys = {
  restoreDrill: ["environment", "drillDate", "sourceBackup", "targetDatabase", "tableCounts"],
  deploymentRollback: [
    "environment",
    "checkedAt",
    "releaseCandidate",
    "failedImageTag",
    "rollbackImageTag",
    "failureInjected",
    "failureMode",
    "migrationRollbackSafe",
    "commandsPassed",
    "servicesVerified",
    "evidenceReferences",
  ],
  githubCi: [
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
  ],
  kvkkInventory: [
    "environment",
    "checkedAt",
    "inventorySource",
    "dataSubjectCounts",
    "purgeCoverage",
    "auditActionsVerified",
    "auditDiffRedactionVerified",
  ],
  identityMigration: ["environment", "checkedAt", "migrationDecision", "subjects", "invitationFlow", "verifications"],
  financialRetention: ["environment", "checkedAt", "policyDecision", "financialRecords", "purgeBehaviorVerified"],
  uploadAv: ["environment", "checkedAt", "scannerDecision", "uploadSurfaces", "scanResults"],
  observabilityUat: [
    "environment",
    "checkedAt",
    "prometheusScrapeOk",
    "grafanaDashboardOk",
    "lokiLogPanelOk",
    "alertWebhookStatus",
    "alertsVerified",
    "evidenceReferences",
  ],
  externalMonitoring: ["environment", "checkedAt", "provider", "monitoringNode", "monitorsVerified", "outageDrill", "evidenceReferences"],
  adminMfa: ["environment", "checkedAt", "policy", "enrollment", "loginVerification", "commandsPassed", "evidenceReferences"],
  aiReportSummary: [
    "environment",
    "checkedAt",
    "provider",
    "kvkk",
    "externalAiStopRule",
    "generation",
    "validation",
    "commandsPassed",
    "evidenceReferences",
  ],
  securityAudit: ["environment", "checkedAt", "prodEnvCheckOk", "httpsOk", "rlsLiveCheckOk", "noCriticalFindings", "evidenceReferences"],
  liveExamCycle: [
    "environment",
    "checkedAt",
    "tester",
    "releaseCandidate",
    "appUrl",
    "apiUrl",
    "commandsPassed",
    "examCycle",
    "evidenceReferences",
  ],
  isemOpticalPipeline: [
    "generatedAt",
    "environment",
    "checkedAt",
    "parserConfigVersion",
    "answerKeyVersion",
    "answerKeyQuestionCount",
    "bookletVariantCount",
    "counts",
    "pipeline",
    "sampleScores",
    "hashes",
    "thresholds",
    "pipelineDurationMs",
    "commandsPassed",
  ],
  liveUiWorkerResult: [
    "generatedAt",
    "result",
    "check",
    "environment",
    "checkedAt",
    "examHash",
    "firstStudentHash",
    "reportStatus",
    "downloadedArtifacts",
    "karnePdfDownloaded",
    "excelDownloaded",
    "studentPortalViewed",
    "guardianPortalViewed",
    "commandsPassed",
    "gaps",
  ],
  uiUxRedesign: [
    "result",
    "environment",
    "checkedAt",
    "releaseCandidate",
    "redesignPlanPath",
    "localStaticEvidence",
    "stagingProductionEvidence",
    "phaseEvidence",
    "viewportCoverage",
    "privacy",
    "approvals",
    "openRisks",
  ],
  inlineUploadMigration: [
    "environment",
    "checkedAt",
    "storageMode",
    "dryRun",
    "migration",
    "orphanAudit",
    "commandsPassed",
    "evidenceReferences",
  ],
  auditNullTenant: ["environment", "checkedAt", "auditNullTenant", "commandsPassed", "evidenceReferences"],
  rateLimit: ["environment", "checkedAt", "config", "instances", "apiRateLimit", "loginAttemptLimiter", "commandsPassed", "evidenceReferences"],
  rlsLive: [
    "environment",
    "checkedAt",
    "schema",
    "isolation",
    "tenantFkPreflight",
    "loadSmoke",
    "commandsPassed",
    "evidenceReferences",
  ],
  uat: [
    "environment",
    "checkedAt",
    "tester",
    "releaseCandidate",
    "rollbackImageTag",
    "restoreBackupReference",
    "liveExamCyclePassed",
    "flowsVerified",
    "journeyScenariosVerified",
    "commandsPassed",
  ],
};

const requiredApprovals = ["product", "technical", "operations", "dataProtection"];
const expectedTenantTables = getTenantScopedTables();
const requiredRlsWriteRejects = [
  "Student wrong tenant insert",
  "Homework wrong tenant insert",
  "Announcement wrong tenant insert",
  "MessageTemplate wrong tenant insert",
  "ExamResult foreign tenant RawImport",
  "ParsedAnswer foreign tenant RawImport",
  "ParsedAnswer cross exam mismatch",
  "ParsedAnswer duplicate raw import participant parser",
];
const expectedRlsEvidenceReferenceFileNames = [
  "db-rls-check.log",
  "db-rls-check-live.log",
  "rls-load-smoke.json",
];
const expectedTenantCompositeRelations = [
  "AnnouncementReceipt.announcement",
  "AnnouncementDeliveryReport.announcement",
  "Homework.class",
  "ScheduleLesson.class",
  "StudySession.class",
  "StudySessionStudent.studySession",
  "StudySessionStudent.student",
  "TeacherAssignment.class",
  "TeacherAssignment.student",
  "GuardianStudent.guardian",
  "GuardianStudent.student",
  "DevelopmentAssessment.teacher",
  "TeacherAssignment.teacher",
  "TeacherNote.teacher",
  "ScheduleLesson.teacher",
  "StudySession.teacher",
  "Homework.sourceMaterial",
  "SupportTicket.class",
  "PaymentPlan.class",
  "ReportSnapshot.class",
  "StudentEnrollment.class",
  "Student.class",
  "Student.responsibleTeacher",
];
const expectedTenantFkInsertRejects = expectedTenantCompositeRelations.map((relation) => `${relation} cross tenant insert`);
const liveStatusGates = [
  {
    label: "Traefik HTTPS smoke",
    command: "pnpm traefik:https:smoke",
    source: "productionEvidenceSummary.smokeEvidence.traefikHttps",
    target: "summary",
    path: ["smokeEvidence", "traefikHttps"],
    dateKey: "generatedAt",
  },
  {
    label: "Live exam cycle kanıtı",
    command: "pnpm live:exam-cycle:check",
    source: "productionEvidenceSummary.reports.liveExamCycle",
    target: "summary",
    path: ["reports", "liveExamCycle"],
    dateKey: "checkedAt",
  },
  {
    label: "iSEM optical pipeline kanıtı",
    command: "pnpm isem-optical-pipeline:evidence-check",
    source: "productionEvidenceSummary.reports.isemOpticalPipeline",
    target: "summary",
    path: ["reports", "isemOpticalPipeline"],
    dateKey: "checkedAt",
  },
  {
    label: "Live UI-worker result kanıtı",
    command: "pnpm live:ui-worker:result-check",
    source: "productionEvidenceSummary.reports.liveUiWorkerResult",
    target: "summary",
    path: ["reports", "liveUiWorkerResult"],
    dateKey: "checkedAt",
  },
  {
    label: "KVKK inventory kanıtı",
    command: "pnpm privacy:inventory:check",
    source: "productionEvidenceSummary.reports.kvkkInventory",
    target: "summary",
    path: ["reports", "kvkkInventory"],
    dateKey: "checkedAt",
  },
  {
    label: "RLS live kanıtı",
    command: "pnpm rls:live:check",
    source: "productionEvidenceSummary.reports.rlsLive",
    target: "summary",
    path: ["reports", "rlsLive"],
    dateKey: "checkedAt",
  },
  {
    label: "Inline upload migration kanıtı",
    command: "pnpm inline-upload-content:check",
    source: "productionEvidenceSummary.reports.inlineUploadMigration",
    target: "summary",
    path: ["reports", "inlineUploadMigration"],
    dateKey: "checkedAt",
  },
  {
    label: "Audit null tenant kanıtı",
    command: "pnpm audit-null-tenant:check",
    source: "productionEvidenceSummary.reports.auditNullTenant",
    target: "summary",
    path: ["reports", "auditNullTenant"],
    dateKey: "checkedAt",
  },
  {
    label: "Rate limit Redis kanıtı",
    command: "pnpm rate-limit:check",
    source: "productionEvidenceSummary.reports.rateLimit",
    target: "summary",
    path: ["reports", "rateLimit"],
    dateKey: "checkedAt",
  },
  {
    label: "SMS disabled path kanıtı",
    command: "pnpm sms:smoke",
    source: "productionEvidenceSummary.smokeEvidence.smsProvider",
    target: "summary",
    path: ["smokeEvidence", "smsProvider"],
    dateKey: "checkedAt",
  },
  {
    label: "Notification provider kanıtı",
    command: "pnpm notification:smoke",
    source: "productionEvidenceSummary.smokeEvidence.notificationProvider",
    target: "summary",
    path: ["smokeEvidence", "notificationProvider"],
    dateKey: "checkedAt",
  },
  {
    label: "Report generation perf kanıtı",
    command: "pnpm report-generation:perf",
    source: "productionEvidenceSummary.smokeEvidence.reportGeneration",
    target: "summary",
    path: ["smokeEvidence", "reportGeneration"],
    dateKey: "checkedAt",
  },
  {
    label: "Staging/prod UAT",
    command: "pnpm uat:check",
    source: "productionEvidenceSummary.reports.uat",
    target: "summary",
    path: ["reports", "uat"],
    dateKey: "checkedAt",
  },
  {
    label: "Deployment rollback tatbikatı",
    command: "pnpm deployment:rollback:check",
    source: "productionEvidenceSummary.reports.deploymentRollback",
    target: "summary",
    path: ["reports", "deploymentRollback"],
    dateKey: "checkedAt",
  },
  {
    label: "Pilot kapanış kanıtı",
    command: "pnpm pilot:check",
    source: "pilotEvidence",
    target: "pilot",
    path: [],
    dateKey: "checkedAt",
  },
  {
    label: "Go-live karar paketi",
    command: "pnpm go-live:check",
    source: "goLiveEvidence",
    target: "goLive",
    path: [],
    dateKey: "checkedAt",
  },
  {
    label: "Alert bildirim kanalı",
    command: "pnpm alert:webhook:smoke",
    source: "productionEvidenceSummary.smokeEvidence.alertWebhook",
    target: "summary",
    path: ["smokeEvidence", "alertWebhook"],
    dateKey: "generatedAt",
  },
];
const linkedLiveStatusTopLevelKeys = [
  "result",
  "environment",
  "generatedAt",
  "productionEvidenceSummaryTarget",
  "goLiveEvidenceTarget",
  "pilotEvidenceTarget",
  "gates",
];
const linkedLiveStatusGateKeys = ["label", "status", "command", "source", "checkedAt", "evidenceReference"];
const externalMonitoringPublicEdgeMonitors = ["API /health", "API /health/ready", "Web login", "Traefik TLS certificate"];

if (!target) {
  fail(["GO_LIVE_EVIDENCE_TARGET bos birakilamaz."]);
}

let targetUrl;
try {
  targetUrl = new URL(target);
} catch {
  fail(["GO_LIVE_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
}
if (!isAllowedEvidenceTargetUrl(targetUrl)) {
  fail(["GO_LIVE_EVIDENCE_TARGET file:// veya https:// URL olmali."]);
}
if (hasSecretBearingUrlParts(targetUrl)) {
  fail(["GO_LIVE_EVIDENCE_TARGET target URL userinfo, query veya fragment iceremez."]);
}
if (targetUrl.protocol === "file:" && isLocalSmokeEvidenceTargetUrl(targetUrl)) {
  fail(["GO_LIVE_EVIDENCE_TARGET artifacts/local altinda olmamali."]);
}

const report = await readJsonTarget(targetUrl, "Go-live raporu");
const productionEvidenceSummary = await readLinkedProductionEvidenceSummary(report, targetUrl);
const pilotEvidence = await readLinkedPilotEvidence(report, targetUrl);
const liveStatusEvidence = await readLinkedLiveStatusEvidence(report, targetUrl);
const failures = validateReport(report, productionEvidenceSummary, pilotEvidence, liveStatusEvidence);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Go-live kanit kontrolu gecti: ${report.environment} ${report.releaseCandidate}`);

async function readJsonTarget(url, label) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url, label), label);
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`${label} okunamadi: HTTP ${response.status}`]);
    }
    return parseJson(await response.text(), label);
  }

  fail(["GO_LIVE_EVIDENCE_TARGET yalniz file:// veya https:// destekler."]);
}

async function readEvidenceFile(url, label) {
  const filePath = fileURLToPath(url);
  await assertParentPathAllowed(dirname(filePath), label);

  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail([`${label} okunabilir file:// artifact olmali.`]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail([`${label} symlink olmayan file:// artifact olmali.`]);
  }

  return readFile(filePath, "utf8");
}

async function assertParentPathAllowed(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);

    let stat;
    try {
      stat = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail([parentPathFailure(label)]);
    }
  }
}

function parentPathFailure(label) {
  if (label === "Go-live raporu") {
    return "GO_LIVE_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmali.";
  }
  if (label === "Production evidence summary") {
    return "Production evidence summary parent dizini symlink olmayan dizin olmali.";
  }
  if (label === "Pilot evidence") {
    return "Pilot evidence parent dizini symlink olmayan dizin olmali.";
  }
  if (label === "Live status evidence") {
    return "Live status evidence parent dizini symlink olmayan dizin olmali.";
  }
  return `${label} parent dizini symlink olmayan dizin olmali.`;
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    fail([`${label} gecerli JSON olmali.`]);
  }
}

async function readLinkedProductionEvidenceSummary(report, baseUrl) {
  const value = report?.productionEvidenceSummary;
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.summaryTarget !== "string") {
    return undefined;
  }

  let summaryUrl;
  try {
    summaryUrl = new URL(value.summaryTarget, baseUrl);
  } catch {
    fail(["productionEvidenceSummary.summaryTarget file:// veya https:// URL olmali."]);
  }
  if (!isAllowedEvidenceTargetUrl(summaryUrl)) {
    fail(["productionEvidenceSummary.summaryTarget file:// veya https:// URL olmali."]);
  }
  if (hasSecretBearingUrlParts(summaryUrl)) {
    fail(["productionEvidenceSummary.summaryTarget target URL userinfo, query veya fragment iceremez."]);
  }

  return readJsonTarget(summaryUrl, "Production evidence summary");
}

async function readLinkedPilotEvidence(report, baseUrl) {
  const value = report?.pilot;
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.pilotEvidenceReference !== "string") {
    return undefined;
  }

  let pilotUrl;
  try {
    pilotUrl = new URL(value.pilotEvidenceReference, baseUrl);
  } catch {
    fail(["pilot.pilotEvidenceReference file:// veya https:// URL olmali."]);
  }
  if (!isAllowedEvidenceTargetUrl(pilotUrl)) {
    fail(["pilot.pilotEvidenceReference file:// veya https:// URL olmali."]);
  }
  if (hasSecretBearingUrlParts(pilotUrl)) {
    fail(["pilot.pilotEvidenceReference target URL userinfo, query veya fragment iceremez."]);
  }

  return readJsonTarget(pilotUrl, "Pilot evidence");
}

async function readLinkedLiveStatusEvidence(report, baseUrl) {
  const value = report?.liveStatusEvidence;
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof value.evidenceTarget !== "string") {
    return undefined;
  }

  let liveStatusUrl;
  try {
    liveStatusUrl = new URL(value.evidenceTarget, baseUrl);
  } catch {
    fail(["liveStatusEvidence.evidenceTarget file:// veya https:// URL olmali."]);
  }
  if (!isAllowedEvidenceTargetUrl(liveStatusUrl)) {
    fail(["liveStatusEvidence.evidenceTarget file:// veya https:// URL olmali."]);
  }
  if (hasSecretBearingUrlParts(liveStatusUrl)) {
    fail(["liveStatusEvidence.evidenceTarget target URL userinfo, query veya fragment iceremez."]);
  }
  if (liveStatusUrl.protocol === "file:" && isLocalSmokeEvidenceTargetUrl(liveStatusUrl)) {
    fail(["liveStatusEvidence.evidenceTarget artifacts/local altinda olmamali."]);
  }

  return {
    report: await readJsonTarget(liveStatusUrl, "Live status evidence"),
    url: liveStatusUrl,
  };
}

function validateReport(report, productionEvidenceSummary, pilotEvidence, liveStatusEvidence) {
  const failures = [];

  if (!report || typeof report !== "object" || Array.isArray(report)) {
    failures.push("goLive nesnesi zorunlu.");
    return failures;
  }

  requireSummaryObjectKeySet(report, goLiveTopLevelKeys, failures, "goLive");
  requireEqual(report, failures, "result", "PASS");
  requireEqual(report, failures, "environment", "production");
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt", "checkedAt");
  requireString(report, failures, "releaseCandidate");
  requireString(report, failures, "rollbackImageTag");
  requireNonPlaceholderString(report, failures, "releaseCandidate", "releaseCandidate");
  requireNonPlaceholderString(report, failures, "rollbackImageTag", "rollbackImageTag");
  requireProductionEvidenceSummary(report, failures, productionEvidenceSummary);
  requireDeployment(report, failures);
  requireUat(report, failures);
  requirePilot(report, failures, pilotEvidence);
  requireLiveStatusEvidence(report, failures, liveStatusEvidence, productionEvidenceSummary, pilotEvidence);
  requireLegal(report, failures);
  requireOperations(report, failures);
  requireCutover(report, failures);
  requireApprovals(report, failures);
  requireOpenRisks(report, failures);
  requireEqual(report, failures, "goLiveDecision", "APPROVED");
  requireEvidenceReferences(report, failures, "evidenceReferences");

  return failures;
}

function requireProductionEvidenceSummary(report, failures, linkedSummary) {
  const value = requireObject(report, failures, "productionEvidenceSummary");
  if (!value) return;

  requireSummaryObjectKeySet(value, goLiveProductionEvidenceSummaryKeys, failures, "productionEvidenceSummary");
  requireObjectEqual(value, failures, "productionEvidenceSummary.result", "result", "PASS");
  requireObjectString(value, failures, "productionEvidenceSummary.summaryTarget", "summaryTarget");
  requireNonPlaceholderString(value, failures, "productionEvidenceSummary.summaryTarget", "summaryTarget");
  requireObjectString(value, failures, "productionEvidenceSummary.summaryReference", "summaryReference");
  requireNonPlaceholderString(value, failures, "productionEvidenceSummary.summaryReference", "summaryReference");
  requireObjectDate(value, failures, "productionEvidenceSummary.generatedAt", "generatedAt");
  requireDateNotAfter(
    value,
    failures,
    "productionEvidenceSummary.generatedAt",
    "generatedAt",
    report,
    "checkedAt",
    "checkedAt",
  );

  if (!Array.isArray(value.checksPassed)) {
    failures.push("productionEvidenceSummary.checksPassed listesi zorunlu.");
    return;
  }

  requireEvidenceCheckLabelSet(value.checksPassed, failures, "productionEvidenceSummary.checksPassed");

  for (const check of requiredEvidenceChecks) {
    if (!value.checksPassed.includes(check)) {
      failures.push(`productionEvidenceSummary.checksPassed eksik: ${check}`);
    }
  }

  if (!linkedSummary) {
    failures.push("productionEvidenceSummary.summaryTarget okunabilir release summary JSON'una baglanmali.");
    return;
  }

  validateLinkedProductionEvidenceSummary(linkedSummary, failures, report, value);
}

function validateLinkedProductionEvidenceSummary(summary, failures, goLiveReport, declaredSummary) {
  requireSummaryObjectKeySet(summary, summaryTopLevelKeys, failures, "productionEvidenceSummary.summary");
  requireObjectEqual(summary, failures, "productionEvidenceSummary.summary.result", "result", "PASS");
  requireObjectEqual(summary, failures, "productionEvidenceSummary.summary.nodeEnv", "nodeEnv", "production");
  requireObjectDate(summary, failures, "productionEvidenceSummary.summary.generatedAt", "generatedAt");
  requireMatchingDate(
    declaredSummary,
    failures,
    "productionEvidenceSummary.generatedAt",
    "generatedAt",
    summary,
    "productionEvidenceSummary.summary.generatedAt",
    "generatedAt",
  );
  requireDateNotAfter(
    summary,
    failures,
    "productionEvidenceSummary.summary.generatedAt",
    "generatedAt",
    goLiveReport,
    "checkedAt",
    "checkedAt",
  );
  requireHttpsUrl(summary, failures, "productionEvidenceSummary.summary.appUrl", "appUrl");
  requireHttpsUrl(summary, failures, "productionEvidenceSummary.summary.apiUrl", "apiUrl");
  requireHttpsUrl(summary, failures, "productionEvidenceSummary.summary.webUrl", "webUrl");
  requireSummaryChecks(summary, failures);
  requireSummarySmokeEvidence(summary, failures, goLiveReport);
  requireSummaryReports(summary, failures, goLiveReport);
}

function requireSummaryChecks(summary, failures) {
  const value = summary.checks;
  if (!Array.isArray(value)) {
    failures.push("productionEvidenceSummary.summary.checks listesi zorunlu.");
    return;
  }

  requireEvidenceCheckObjectSet(value, failures, "productionEvidenceSummary.summary.checks");

  for (const check of requiredEvidenceChecks) {
    const item = value.find((candidate) => candidate?.label === check);
    if (!item) {
      failures.push(`productionEvidenceSummary.summary.checks eksik: ${check}`);
      continue;
    }
    if (item.status !== "PASS") {
      failures.push(`productionEvidenceSummary.summary.checks ${check} PASS olmali.`);
    }
    if (typeof item.script !== "string" || item.script.trim() === "") {
      failures.push(`productionEvidenceSummary.summary.checks ${check} script icermeli.`);
      continue;
    }
    const expectedScript = requiredEvidenceCheckScripts.get(check);
    if (item.script !== expectedScript) {
      failures.push(`productionEvidenceSummary.summary.checks ${check} script ${expectedScript} olmali.`);
    }
  }
}

function requireEvidenceCheckLabelSet(labels, failures, label) {
  const expectedLabels = new Set(requiredEvidenceChecks);
  const seenLabels = new Set();

  if (labels.length !== requiredEvidenceChecks.length) {
    failures.push(`${label} tam ${requiredEvidenceChecks.length} madde icermeli.`);
  }

  for (const item of labels) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} bos olmayan metinlerden olusmali.`);
      continue;
    }
    if (!expectedLabels.has(item)) {
      failures.push(`${label} beklenmeyen madde iceriyor: ${item}`);
    }
    if (seenLabels.has(item)) {
      failures.push(`${label} tekrarlı madde iceriyor: ${item}`);
    }
    seenLabels.add(item);
  }
}

function requireEvidenceCheckObjectSet(checks, failures, label) {
  const labels = checks.map((check) => check?.label);
  requireEvidenceCheckLabelSet(labels, failures, label);

  for (const check of checks) {
    const checkLabel = typeof check?.label === "string" ? check.label : "unknown";
    if (!check || typeof check !== "object" || Array.isArray(check)) {
      failures.push(`${label} madde nesnesi olmali.`);
      continue;
    }
    requireSummaryObjectKeySet(check, summaryCheckItemKeys, failures, `${label}.${checkLabel}`);
  }
}

function requireSummaryObjectKeySet(value, expectedKeys, failures, label) {
  const expectedSet = new Set(expectedKeys);
  const actual = Object.keys(value);

  if (actual.length !== expectedKeys.length) {
    failures.push(`${label} tam ${expectedKeys.length} alan icermeli.`);
  }

  for (const key of expectedKeys) {
    if (!(key in value)) {
      failures.push(`${label} eksik alan iceriyor: ${key}`);
    }
  }

  for (const key of actual) {
    if (!expectedSet.has(key)) {
      failures.push(`${label} beklenmeyen alan iceriyor: ${key}`);
    }
  }
}

function requireSummarySmokeEvidence(summary, failures, goLiveReport) {
  const value = requireNestedObject(summary, failures, "productionEvidenceSummary.summary.smokeEvidence", "smokeEvidence");
  if (!value) return;

  requireSummaryObjectKeySet(value, summarySmokeEvidenceKeys, failures, "productionEvidenceSummary.summary.smokeEvidence");

  const traefikHttps = requireSmokeCheck(value, failures, "traefikHttps", "traefik_https_smoke", summary, goLiveReport);
  if (traefikHttps) {
    requireHttpsUrl(traefikHttps, failures, "productionEvidenceSummary.summary.smokeEvidence.traefikHttps.url", "url");
    requireMatchingUrlOrigin(
      traefikHttps,
      failures,
      "productionEvidenceSummary.summary.smokeEvidence.traefikHttps.url",
      "url",
      summary,
      "productionEvidenceSummary.summary.webUrl",
      "webUrl",
    );
    requireObjectStatus2xx(traefikHttps, failures, "productionEvidenceSummary.summary.smokeEvidence.traefikHttps.statusCode", "statusCode");
    requireObjectString(traefikHttps, failures, "productionEvidenceSummary.summary.smokeEvidence.traefikHttps.strictTransportSecurity", "strictTransportSecurity");
  }

  const smsProvider = requireSmokeCheck(value, failures, "smsProvider", "sms_provider_smoke", summary, goLiveReport);
  if (smsProvider) {
    requireObjectString(smsProvider, failures, "productionEvidenceSummary.summary.smokeEvidence.smsProvider.provider", "provider");
    requireNonPlaceholderString(smsProvider, failures, "productionEvidenceSummary.summary.smokeEvidence.smsProvider.provider", "provider");
    if (smsProvider.provider === "noop") {
      failures.push("productionEvidenceSummary.summary.smokeEvidence.smsProvider.provider noop olmamali.");
    }
    requireObjectString(smsProvider, failures, "productionEvidenceSummary.summary.smokeEvidence.smsProvider.recipient", "recipient");
    requireNonPlaceholderString(smsProvider, failures, "productionEvidenceSummary.summary.smokeEvidence.smsProvider.recipient", "recipient");
    requireMaskedRecipientString(smsProvider.recipient, failures, "productionEvidenceSummary.summary.smokeEvidence.smsProvider.recipient");
    requireObjectString(smsProvider, failures, "productionEvidenceSummary.summary.smokeEvidence.smsProvider.providerMessageId", "providerMessageId");
    requireNonPlaceholderString(smsProvider, failures, "productionEvidenceSummary.summary.smokeEvidence.smsProvider.providerMessageId", "providerMessageId");
  }

  const notificationProvider = requireSmokeCheck(value, failures, "notificationProvider", "notification_provider_smoke", summary, goLiveReport);
  if (notificationProvider) {
    requireObjectString(notificationProvider, failures, "productionEvidenceSummary.summary.smokeEvidence.notificationProvider.provider", "provider");
    requireNonPlaceholderString(
      notificationProvider,
      failures,
      "productionEvidenceSummary.summary.smokeEvidence.notificationProvider.provider",
      "provider",
    );
    if (notificationProvider.provider === "noop") {
      failures.push("productionEvidenceSummary.summary.smokeEvidence.notificationProvider.provider noop olmamali.");
    }
    requireObjectStringList(notificationProvider, failures, "productionEvidenceSummary.summary.smokeEvidence.notificationProvider.channels", "channels", 1, false);
    requireObjectStringList(
      notificationProvider,
      failures,
      "productionEvidenceSummary.summary.smokeEvidence.notificationProvider.recipients",
      "recipients",
      1,
      true,
    );
    if (Array.isArray(notificationProvider.recipients)) {
      for (const [index, recipient] of notificationProvider.recipients.entries()) {
        requireMaskedRecipientString(
          recipient,
          failures,
          `productionEvidenceSummary.summary.smokeEvidence.notificationProvider.recipients.${index}`,
        );
      }
    }
  }

  const sentryEvent = requireSmokeCheck(value, failures, "sentryEvent", "sentry_smoke", summary, goLiveReport);
  if (sentryEvent) {
    requireHttpsUrl(sentryEvent, failures, "productionEvidenceSummary.summary.smokeEvidence.sentryEvent.dsn", "dsn");
    requireObjectString(sentryEvent, failures, "productionEvidenceSummary.summary.smokeEvidence.sentryEvent.eventId", "eventId");
    requireNonPlaceholderString(sentryEvent, failures, "productionEvidenceSummary.summary.smokeEvidence.sentryEvent.eventId", "eventId");
  }

  const alertWebhook = requireSmokeCheck(value, failures, "alertWebhook", "alert_webhook_smoke", summary, goLiveReport);
  if (alertWebhook) {
    requireHttpsUrl(alertWebhook, failures, "productionEvidenceSummary.summary.smokeEvidence.alertWebhook.webhookUrl", "webhookUrl");
    requireObjectStatus2xx(alertWebhook, failures, "productionEvidenceSummary.summary.smokeEvidence.alertWebhook.statusCode", "statusCode");
    requireObjectEqual(alertWebhook, failures, "productionEvidenceSummary.summary.smokeEvidence.alertWebhook.authorizationScheme", "authorizationScheme", "bearer");
  }

  const walArchive = requireSmokeCheck(value, failures, "walArchive", "wal_archive_smoke", summary, goLiveReport);
  if (walArchive) {
    requireSmokeTargetSummary(walArchive, failures, "productionEvidenceSummary.summary.smokeEvidence.walArchive.target");
    requireObjectSha256(walArchive, failures, "productionEvidenceSummary.summary.smokeEvidence.walArchive.markerSha256", "markerSha256");
  }

  const reportGeneration = requireSmokeCheck(value, failures, "reportGeneration", "report_generation_smoke", summary, goLiveReport);
  if (reportGeneration) {
    requireObjectEqual(
      reportGeneration,
      failures,
      "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.reportType",
      "reportType",
      "EXAM_RESULT_SUMMARY",
    );
    requireObjectEqual(reportGeneration, failures, "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.status", "status", "READY");
    requireObjectIntegerAtLeast(reportGeneration, failures, "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.resultCount", "resultCount", 10_000);
    requireObjectIntegerAtLeast(reportGeneration, failures, "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.studentCount", "studentCount", 10_000);
    requireObjectIntegerAtLeast(reportGeneration, failures, "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.classCount", "classCount", 1);
    requireObjectIntegerAtLeast(reportGeneration, failures, "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.branchCount", "branchCount", 1);
    requireObjectIntegerAtLeast(
      reportGeneration,
      failures,
      "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.expectedClassCount",
      "expectedClassCount",
      1,
    );
    requireObjectIntegerAtLeast(reportGeneration, failures, "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.seedDurationMs", "seedDurationMs", 0);
    requireObjectIntegerAtLeast(
      reportGeneration,
      failures,
      "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.generationDurationMs",
      "generationDurationMs",
      0,
    );
    if (Number.isInteger(reportGeneration.resultCount) && reportGeneration.studentCount !== reportGeneration.resultCount) {
      failures.push("productionEvidenceSummary.summary.smokeEvidence.reportGeneration.studentCount resultCount ile eslesmeli.");
    }
    if (Number.isInteger(reportGeneration.expectedClassCount) && reportGeneration.classCount !== reportGeneration.expectedClassCount) {
      failures.push("productionEvidenceSummary.summary.smokeEvidence.reportGeneration.classCount expectedClassCount ile eslesmeli.");
    }

    const hashes = requireNestedObject(reportGeneration, failures, "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.hashes", "hashes");
    if (hashes) {
      for (const key of [
        "tenantHash",
        "userHash",
        "emailHash",
        "examHash",
        "snapshotHash",
        "firstStudentHash",
        "contentHash",
        "queuedJobIdHash",
      ]) {
        requireObjectSha256(hashes, failures, `productionEvidenceSummary.summary.smokeEvidence.reportGeneration.hashes.${key}`, key);
      }
    }

    const thresholds = requireNestedObject(
      reportGeneration,
      failures,
      "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.thresholds",
      "thresholds",
    );
    if (thresholds) {
      requireObjectTrue(
        thresholds,
        failures,
        "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.thresholds.resultCountMatches",
        "resultCountMatches",
      );
      requireObjectIntegerAtLeast(
        thresholds,
        failures,
        "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.thresholds.generationDurationMsMax",
        "generationDurationMsMax",
        1,
      );
      requireObjectEqual(
        thresholds,
        failures,
        "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.thresholds.generationDurationMsMax",
        "generationDurationMsMax",
        60_000,
      );
      requireObjectTrue(
        thresholds,
        failures,
        "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.thresholds.generationDurationPassed",
        "generationDurationPassed",
      );
      if (
        Number.isInteger(reportGeneration.generationDurationMs) &&
        Number.isInteger(thresholds.generationDurationMsMax) &&
        reportGeneration.generationDurationMs > thresholds.generationDurationMsMax
      ) {
        failures.push("productionEvidenceSummary.summary.smokeEvidence.reportGeneration.generationDurationMs esik degerini asmamali.");
      }
    }

    requireObjectStringList(
      reportGeneration,
      failures,
      "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.commandsPassed",
      "commandsPassed",
      1,
      false,
    );
    if (
      Array.isArray(reportGeneration.commandsPassed) &&
      (reportGeneration.commandsPassed.length !== 1 || reportGeneration.commandsPassed[0] !== "pnpm report-generation:perf")
    ) {
      failures.push("productionEvidenceSummary.summary.smokeEvidence.reportGeneration.commandsPassed tek pnpm report-generation:perf komutu icermeli.");
    }
    requireEmptyArray(reportGeneration, failures, "gaps", "productionEvidenceSummary.summary.smokeEvidence.reportGeneration.gaps");
  }
}

function requireSummaryReports(summary, failures, goLiveReport) {
  const reports = requireNestedObject(summary, failures, "productionEvidenceSummary.summary.reports", "reports");
  if (!reports) return;

  requireSummaryObjectKeySet(reports, summaryReportKeys, failures, "productionEvidenceSummary.summary.reports");
  for (const [key, requiredKeys] of Object.entries(summaryRequiredReportKeys)) {
    const report = requireNestedObject(reports, failures, `productionEvidenceSummary.summary.reports.${key}`, key);
    if (report) {
      requireSummaryObjectKeySet(report, requiredKeys, failures, `productionEvidenceSummary.summary.reports.${key}`);
    }
  }

  const deploymentRollback = requireNestedObject(
    reports,
    failures,
    "productionEvidenceSummary.summary.reports.deploymentRollback",
    "deploymentRollback",
  );
  if (deploymentRollback) {
    requireObjectEqual(deploymentRollback, failures, "productionEvidenceSummary.summary.reports.deploymentRollback.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      deploymentRollback,
      failures,
      "productionEvidenceSummary.summary.reports.deploymentRollback.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectString(deploymentRollback, failures, "productionEvidenceSummary.summary.reports.deploymentRollback.rollbackImageTag", "rollbackImageTag");
    requireNonPlaceholderString(deploymentRollback, failures, "productionEvidenceSummary.summary.reports.deploymentRollback.releaseCandidate", "releaseCandidate");
    requireNonPlaceholderString(deploymentRollback, failures, "productionEvidenceSummary.summary.reports.deploymentRollback.failedImageTag", "failedImageTag");
    requireNonPlaceholderString(deploymentRollback, failures, "productionEvidenceSummary.summary.reports.deploymentRollback.rollbackImageTag", "rollbackImageTag");
    requireMatchingString(
      goLiveReport,
      failures,
      "releaseCandidate",
      "releaseCandidate",
      deploymentRollback,
      "productionEvidenceSummary.summary.reports.deploymentRollback.releaseCandidate",
      "releaseCandidate",
    );
    requireMatchingString(
      goLiveReport,
      failures,
      "rollbackImageTag",
      "rollbackImageTag",
      deploymentRollback,
      "productionEvidenceSummary.summary.reports.deploymentRollback.rollbackImageTag",
      "rollbackImageTag",
    );
    requireObjectTrue(deploymentRollback, failures, "productionEvidenceSummary.summary.reports.deploymentRollback.failureInjected", "failureInjected");
    requireObjectString(deploymentRollback, failures, "productionEvidenceSummary.summary.reports.deploymentRollback.failureMode", "failureMode");
    requireNonPlaceholderString(
      deploymentRollback,
      failures,
      "productionEvidenceSummary.summary.reports.deploymentRollback.failureMode",
      "failureMode",
    );
    requireObjectTrue(deploymentRollback, failures, "productionEvidenceSummary.summary.reports.deploymentRollback.migrationRollbackSafe", "migrationRollbackSafe");
    requireObjectStringList(
      deploymentRollback,
      failures,
      "productionEvidenceSummary.summary.reports.deploymentRollback.commandsPassed",
      "commandsPassed",
      4,
      false,
    );
    requireSummaryRollbackServices(deploymentRollback, failures);
    requireObjectEvidenceReferences(
      deploymentRollback,
      failures,
      "productionEvidenceSummary.summary.reports.deploymentRollback.evidenceReferences",
      "evidenceReferences",
    );
  }

  const githubCi = requireNestedObject(reports, failures, "productionEvidenceSummary.summary.reports.githubCi", "githubCi");
  if (githubCi) {
    requireObjectEqual(githubCi, failures, "productionEvidenceSummary.summary.reports.githubCi.environment", "environment", "github-actions");
    requireSummaryReportDateNotAfter(
      githubCi,
      failures,
      "productionEvidenceSummary.summary.reports.githubCi.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireSummaryGithubCi(githubCi, failures);
  }

  const restoreDrill = requireNestedObject(reports, failures, "productionEvidenceSummary.summary.reports.restoreDrill", "restoreDrill");
  if (restoreDrill) {
    requireObjectEqual(restoreDrill, failures, "productionEvidenceSummary.summary.reports.restoreDrill.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      restoreDrill,
      failures,
      "productionEvidenceSummary.summary.reports.restoreDrill.drillDate",
      "drillDate",
      summary,
      goLiveReport,
    );
    requireObjectString(restoreDrill, failures, "productionEvidenceSummary.summary.reports.restoreDrill.sourceBackup", "sourceBackup");
    requireNonPlaceholderString(restoreDrill, failures, "productionEvidenceSummary.summary.reports.restoreDrill.sourceBackup", "sourceBackup");
    requireObjectString(restoreDrill, failures, "productionEvidenceSummary.summary.reports.restoreDrill.targetDatabase", "targetDatabase");
    requireNonPlaceholderString(restoreDrill, failures, "productionEvidenceSummary.summary.reports.restoreDrill.targetDatabase", "targetDatabase");
    const tableCounts = requireNestedObject(restoreDrill, failures, "productionEvidenceSummary.summary.reports.restoreDrill.tableCounts", "tableCounts");
    if (tableCounts) {
      for (const table of ["Tenant", "AuditLog", "ReportSnapshot", "_prisma_migrations"]) {
        requireObjectNumberAtLeast(tableCounts, failures, `productionEvidenceSummary.summary.reports.restoreDrill.tableCounts.${table}`, table, 1);
      }
    }
  }

  const kvkkInventory = requireNestedObject(reports, failures, "productionEvidenceSummary.summary.reports.kvkkInventory", "kvkkInventory");
  if (kvkkInventory) {
    requireObjectEqual(kvkkInventory, failures, "productionEvidenceSummary.summary.reports.kvkkInventory.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      kvkkInventory,
      failures,
      "productionEvidenceSummary.summary.reports.kvkkInventory.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireSummaryKvkkInventory(kvkkInventory, failures);
  }

  const identityMigration = requireNestedObject(
    reports,
    failures,
    "productionEvidenceSummary.summary.reports.identityMigration",
    "identityMigration",
  );
  if (identityMigration) {
    requireObjectEqual(identityMigration, failures, "productionEvidenceSummary.summary.reports.identityMigration.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      identityMigration,
      failures,
      "productionEvidenceSummary.summary.reports.identityMigration.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireSummaryIdentityMigration(identityMigration, failures);
  }

  const financialRetention = requireNestedObject(
    reports,
    failures,
    "productionEvidenceSummary.summary.reports.financialRetention",
    "financialRetention",
  );
  if (financialRetention) {
    requireObjectEqual(financialRetention, failures, "productionEvidenceSummary.summary.reports.financialRetention.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      financialRetention,
      failures,
      "productionEvidenceSummary.summary.reports.financialRetention.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireSummaryFinancialRetention(financialRetention, failures);
  }

  const uploadAv = requireNestedObject(reports, failures, "productionEvidenceSummary.summary.reports.uploadAv", "uploadAv");
  if (uploadAv) {
    requireObjectEqual(uploadAv, failures, "productionEvidenceSummary.summary.reports.uploadAv.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      uploadAv,
      failures,
      "productionEvidenceSummary.summary.reports.uploadAv.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireSummaryUploadAv(uploadAv, failures);
  }

  const observabilityUat = requireNestedObject(
    reports,
    failures,
    "productionEvidenceSummary.summary.reports.observabilityUat",
    "observabilityUat",
  );
  if (observabilityUat) {
    requireObjectEqual(observabilityUat, failures, "productionEvidenceSummary.summary.reports.observabilityUat.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      observabilityUat,
      failures,
      "productionEvidenceSummary.summary.reports.observabilityUat.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectTrue(observabilityUat, failures, "productionEvidenceSummary.summary.reports.observabilityUat.prometheusScrapeOk", "prometheusScrapeOk");
    requireObjectTrue(observabilityUat, failures, "productionEvidenceSummary.summary.reports.observabilityUat.grafanaDashboardOk", "grafanaDashboardOk");
    requireObjectTrue(observabilityUat, failures, "productionEvidenceSummary.summary.reports.observabilityUat.lokiLogPanelOk", "lokiLogPanelOk");
    requireObjectEvidenceReferences(
      observabilityUat,
      failures,
      "productionEvidenceSummary.summary.reports.observabilityUat.evidenceReferences",
      "evidenceReferences",
    );
  }

  const externalMonitoring = requireNestedObject(
    reports,
    failures,
    "productionEvidenceSummary.summary.reports.externalMonitoring",
    "externalMonitoring",
  );
  if (externalMonitoring) {
    requireObjectEqual(externalMonitoring, failures, "productionEvidenceSummary.summary.reports.externalMonitoring.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      externalMonitoring,
      failures,
      "productionEvidenceSummary.summary.reports.externalMonitoring.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectEqual(
      externalMonitoring,
      failures,
      "productionEvidenceSummary.summary.reports.externalMonitoring.provider",
      "provider",
      "self-hosted-uptime-kuma",
    );
    requireSummaryExternalMonitoring(externalMonitoring, summary, failures);
    requireObjectEvidenceReferences(
      externalMonitoring,
      failures,
      "productionEvidenceSummary.summary.reports.externalMonitoring.evidenceReferences",
      "evidenceReferences",
    );
  }

  const adminMfa = requireNestedObject(reports, failures, "productionEvidenceSummary.summary.reports.adminMfa", "adminMfa");
  if (adminMfa) {
    requireObjectEqual(adminMfa, failures, "productionEvidenceSummary.summary.reports.adminMfa.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      adminMfa,
      failures,
      "productionEvidenceSummary.summary.reports.adminMfa.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireSummaryAdminMfa(adminMfa, failures);
    requireObjectEvidenceReferences(
      adminMfa,
      failures,
      "productionEvidenceSummary.summary.reports.adminMfa.evidenceReferences",
      "evidenceReferences",
    );
  }

  const aiReportSummary = requireNestedObject(
    reports,
    failures,
    "productionEvidenceSummary.summary.reports.aiReportSummary",
    "aiReportSummary",
  );
  if (aiReportSummary) {
    requireObjectEqual(
      aiReportSummary,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.environment",
      "environment",
      "production",
    );
    requireSummaryReportDateNotAfter(
      aiReportSummary,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireSummaryAiReportSummary(aiReportSummary, failures);
    requireObjectEvidenceReferences(
      aiReportSummary,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.evidenceReferences",
      "evidenceReferences",
    );
  }

  const securityAudit = requireNestedObject(reports, failures, "productionEvidenceSummary.summary.reports.securityAudit", "securityAudit");
  if (securityAudit) {
    requireObjectEqual(securityAudit, failures, "productionEvidenceSummary.summary.reports.securityAudit.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      securityAudit,
      failures,
      "productionEvidenceSummary.summary.reports.securityAudit.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectTrue(securityAudit, failures, "productionEvidenceSummary.summary.reports.securityAudit.prodEnvCheckOk", "prodEnvCheckOk");
    requireObjectTrue(securityAudit, failures, "productionEvidenceSummary.summary.reports.securityAudit.httpsOk", "httpsOk");
    requireObjectTrue(securityAudit, failures, "productionEvidenceSummary.summary.reports.securityAudit.rlsLiveCheckOk", "rlsLiveCheckOk");
    requireObjectTrue(securityAudit, failures, "productionEvidenceSummary.summary.reports.securityAudit.noCriticalFindings", "noCriticalFindings");
    requireObjectEvidenceReferences(
      securityAudit,
      failures,
      "productionEvidenceSummary.summary.reports.securityAudit.evidenceReferences",
      "evidenceReferences",
    );
  }

  const liveExamCycle = requireNestedObject(reports, failures, "productionEvidenceSummary.summary.reports.liveExamCycle", "liveExamCycle");
  if (liveExamCycle) {
    requireObjectEqual(liveExamCycle, failures, "productionEvidenceSummary.summary.reports.liveExamCycle.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      liveExamCycle,
      failures,
      "productionEvidenceSummary.summary.reports.liveExamCycle.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectString(liveExamCycle, failures, "productionEvidenceSummary.summary.reports.liveExamCycle.tester", "tester");
    requireNonPlaceholderString(liveExamCycle, failures, "productionEvidenceSummary.summary.reports.liveExamCycle.tester", "tester");
    requireObjectString(liveExamCycle, failures, "productionEvidenceSummary.summary.reports.liveExamCycle.releaseCandidate", "releaseCandidate");
    requireNonPlaceholderString(
      liveExamCycle,
      failures,
      "productionEvidenceSummary.summary.reports.liveExamCycle.releaseCandidate",
      "releaseCandidate",
    );
    requireMatchingString(
      goLiveReport,
      failures,
      "releaseCandidate",
      "releaseCandidate",
      liveExamCycle,
      "productionEvidenceSummary.summary.reports.liveExamCycle.releaseCandidate",
      "releaseCandidate",
    );
    requireObjectString(liveExamCycle, failures, "productionEvidenceSummary.summary.reports.liveExamCycle.appUrl", "appUrl");
    requireObjectString(liveExamCycle, failures, "productionEvidenceSummary.summary.reports.liveExamCycle.apiUrl", "apiUrl");
    requireMatchingString(
      liveExamCycle,
      failures,
      "productionEvidenceSummary.summary.reports.liveExamCycle.appUrl",
      "appUrl",
      summary,
      "productionEvidenceSummary.summary.appUrl",
      "appUrl",
    );
    requireMatchingString(
      liveExamCycle,
      failures,
      "productionEvidenceSummary.summary.reports.liveExamCycle.apiUrl",
      "apiUrl",
      summary,
      "productionEvidenceSummary.summary.apiUrl",
      "apiUrl",
    );
    requireObjectStringList(
      liveExamCycle,
      failures,
      "productionEvidenceSummary.summary.reports.liveExamCycle.commandsPassed",
      "commandsPassed",
      5,
      false,
    );
    for (const command of [
      "pnpm isem-answer-key:smoke",
      "pnpm isem-optical-pipeline:smoke",
      "pnpm raw-import:smoke",
      "pnpm report-generation:smoke",
      "pnpm live:ui-worker:smoke",
    ]) {
      if (!Array.isArray(liveExamCycle.commandsPassed) || !liveExamCycle.commandsPassed.includes(command)) {
        failures.push(`productionEvidenceSummary.summary.reports.liveExamCycle.commandsPassed eksik: ${command}`);
      }
    }
    requireSummaryLiveExamCycle(liveExamCycle, failures);
  }

  const isemOpticalPipeline = requireNestedObject(
    reports,
    failures,
    "productionEvidenceSummary.summary.reports.isemOpticalPipeline",
    "isemOpticalPipeline",
  );
  if (isemOpticalPipeline) {
    requireObjectEqual(
      isemOpticalPipeline,
      failures,
      "productionEvidenceSummary.summary.reports.isemOpticalPipeline.environment",
      "environment",
      "production",
    );
    requireSummaryReportDateNotAfter(
      isemOpticalPipeline,
      failures,
      "productionEvidenceSummary.summary.reports.isemOpticalPipeline.generatedAt",
      "generatedAt",
      summary,
      goLiveReport,
    );
    requireSummaryReportDateNotAfter(
      isemOpticalPipeline,
      failures,
      "productionEvidenceSummary.summary.reports.isemOpticalPipeline.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectStringList(
      isemOpticalPipeline,
      failures,
      "productionEvidenceSummary.summary.reports.isemOpticalPipeline.commandsPassed",
      "commandsPassed",
      1,
      false,
    );
    if (
      !Array.isArray(isemOpticalPipeline.commandsPassed) ||
      !isemOpticalPipeline.commandsPassed.includes("pnpm isem-optical-pipeline:smoke")
    ) {
      failures.push(
        "productionEvidenceSummary.summary.reports.isemOpticalPipeline.commandsPassed eksik: pnpm isem-optical-pipeline:smoke",
      );
    }
  }

  const liveUiWorkerResult = requireNestedObject(
    reports,
    failures,
    "productionEvidenceSummary.summary.reports.liveUiWorkerResult",
    "liveUiWorkerResult",
  );
  if (liveUiWorkerResult) {
    requireObjectEqual(
      liveUiWorkerResult,
      failures,
      "productionEvidenceSummary.summary.reports.liveUiWorkerResult.result",
      "result",
      "PASS",
    );
    requireObjectEqual(
      liveUiWorkerResult,
      failures,
      "productionEvidenceSummary.summary.reports.liveUiWorkerResult.check",
      "check",
      "live_ui_worker_report_smoke",
    );
    requireObjectEqual(
      liveUiWorkerResult,
      failures,
      "productionEvidenceSummary.summary.reports.liveUiWorkerResult.environment",
      "environment",
      "production",
    );
    requireSummaryReportDateNotAfter(
      liveUiWorkerResult,
      failures,
      "productionEvidenceSummary.summary.reports.liveUiWorkerResult.generatedAt",
      "generatedAt",
      summary,
      goLiveReport,
    );
    requireSummaryReportDateNotAfter(
      liveUiWorkerResult,
      failures,
      "productionEvidenceSummary.summary.reports.liveUiWorkerResult.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectSha256(
      liveUiWorkerResult,
      failures,
      "productionEvidenceSummary.summary.reports.liveUiWorkerResult.examHash",
      "examHash",
    );
    requireObjectSha256(
      liveUiWorkerResult,
      failures,
      "productionEvidenceSummary.summary.reports.liveUiWorkerResult.firstStudentHash",
      "firstStudentHash",
    );
    requireObjectEqual(
      liveUiWorkerResult,
      failures,
      "productionEvidenceSummary.summary.reports.liveUiWorkerResult.reportStatus",
      "reportStatus",
      "READY",
    );
    requireExactStringSet(
      liveUiWorkerResult.downloadedArtifacts,
      failures,
      "productionEvidenceSummary.summary.reports.liveUiWorkerResult.downloadedArtifacts",
      ["xlsx", "pdf"],
    );
    for (const key of ["karnePdfDownloaded", "excelDownloaded", "studentPortalViewed", "guardianPortalViewed"]) {
      requireObjectTrue(liveUiWorkerResult, failures, `productionEvidenceSummary.summary.reports.liveUiWorkerResult.${key}`, key);
    }
    requireExactStringSet(
      liveUiWorkerResult.commandsPassed,
      failures,
      "productionEvidenceSummary.summary.reports.liveUiWorkerResult.commandsPassed",
      ["pnpm live:ui-worker:smoke"],
    );
    requireEmptyArray(
      liveUiWorkerResult,
      failures,
      "gaps",
      "productionEvidenceSummary.summary.reports.liveUiWorkerResult.gaps",
    );
  }

  const uiUxRedesign = requireNestedObject(
    reports,
    failures,
    "productionEvidenceSummary.summary.reports.uiUxRedesign",
    "uiUxRedesign",
  );
  if (uiUxRedesign) {
    requireObjectEqual(uiUxRedesign, failures, "productionEvidenceSummary.summary.reports.uiUxRedesign.result", "result", "PASS");
    requireObjectEqual(
      uiUxRedesign,
      failures,
      "productionEvidenceSummary.summary.reports.uiUxRedesign.environment",
      "environment",
      "production",
    );
    requireSummaryReportDateNotAfter(
      uiUxRedesign,
      failures,
      "productionEvidenceSummary.summary.reports.uiUxRedesign.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectEqual(
      uiUxRedesign,
      failures,
      "productionEvidenceSummary.summary.reports.uiUxRedesign.redesignPlanPath",
      "redesignPlanPath",
      "docs/ui-ux-redesign-plan.md",
    );
    requireMatchingString(
      uiUxRedesign,
      failures,
      "productionEvidenceSummary.summary.reports.uiUxRedesign.releaseCandidate",
      "releaseCandidate",
      goLiveReport,
      "releaseCandidate",
      "releaseCandidate",
    );

    const localStaticEvidence = requireNestedObject(
      uiUxRedesign,
      failures,
      "productionEvidenceSummary.summary.reports.uiUxRedesign.localStaticEvidence",
      "localStaticEvidence",
    );
    if (localStaticEvidence) {
      requireObjectEqual(
        localStaticEvidence,
        failures,
        "productionEvidenceSummary.summary.reports.uiUxRedesign.localStaticEvidence.result",
        "result",
        "PASS",
      );
      requireObjectEqual(
        localStaticEvidence,
        failures,
        "productionEvidenceSummary.summary.reports.uiUxRedesign.localStaticEvidence.releaseBlocking",
        "releaseBlocking",
        false,
      );
    }

    const stagingProductionEvidence = requireNestedObject(
      uiUxRedesign,
      failures,
      "productionEvidenceSummary.summary.reports.uiUxRedesign.stagingProductionEvidence",
      "stagingProductionEvidence",
    );
    if (stagingProductionEvidence) {
      requireObjectEqual(
        stagingProductionEvidence,
        failures,
        "productionEvidenceSummary.summary.reports.uiUxRedesign.stagingProductionEvidence.result",
        "result",
        "PASS",
      );
      requireObjectTrue(
        stagingProductionEvidence,
        failures,
        "productionEvidenceSummary.summary.reports.uiUxRedesign.stagingProductionEvidence.requiredForRelease",
        "requiredForRelease",
      );
    }

    const privacy = requireNestedObject(
      uiUxRedesign,
      failures,
      "productionEvidenceSummary.summary.reports.uiUxRedesign.privacy",
      "privacy",
    );
    if (privacy) {
      requireObjectEqual(
        privacy,
        failures,
        "productionEvidenceSummary.summary.reports.uiUxRedesign.privacy.piiReview",
        "piiReview",
        "PASS",
      );
      requireObjectEqual(
        privacy,
        failures,
        "productionEvidenceSummary.summary.reports.uiUxRedesign.privacy.rawPiiInArtifacts",
        "rawPiiInArtifacts",
        false,
      );
      requireObjectEqual(
        privacy,
        failures,
        "productionEvidenceSummary.summary.reports.uiUxRedesign.privacy.smsRecipientPreviewExported",
        "smsRecipientPreviewExported",
        false,
      );
      requireObjectTrue(
        privacy,
        failures,
        "productionEvidenceSummary.summary.reports.uiUxRedesign.privacy.guardianFinanceLeakageChecked",
        "guardianFinanceLeakageChecked",
      );
    }

    requireEmptyArray(
      uiUxRedesign,
      failures,
      "openRisks",
      "productionEvidenceSummary.summary.reports.uiUxRedesign.openRisks",
    );
  }

  const inlineUploadMigration = requireNestedObject(
    reports,
    failures,
    "productionEvidenceSummary.summary.reports.inlineUploadMigration",
    "inlineUploadMigration",
  );
  if (inlineUploadMigration) {
    requireObjectEqual(
      inlineUploadMigration,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.environment",
      "environment",
      "production",
    );
    requireSummaryReportDateNotAfter(
      inlineUploadMigration,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectStringList(
      inlineUploadMigration,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.commandsPassed",
      "commandsPassed",
      3,
      false,
    );
    for (const command of [
      "pnpm inline-upload-content:audit",
      "INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true pnpm inline-upload-content:migrate",
      "pnpm inline-upload-content:orphan-audit",
    ]) {
      if (!Array.isArray(inlineUploadMigration.commandsPassed) || !inlineUploadMigration.commandsPassed.includes(command)) {
        failures.push(`productionEvidenceSummary.summary.reports.inlineUploadMigration.commandsPassed eksik: ${command}`);
      }
    }
    requireSummaryInlineUploadMigration(inlineUploadMigration, failures);
  }

  const auditNullTenant = requireNestedObject(
    reports,
    failures,
    "productionEvidenceSummary.summary.reports.auditNullTenant",
    "auditNullTenant",
  );
  if (auditNullTenant) {
    requireObjectEqual(
      auditNullTenant,
      failures,
      "productionEvidenceSummary.summary.reports.auditNullTenant.environment",
      "environment",
      "production",
    );
    requireSummaryReportDateNotAfter(
      auditNullTenant,
      failures,
      "productionEvidenceSummary.summary.reports.auditNullTenant.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectStringList(
      auditNullTenant,
      failures,
      "productionEvidenceSummary.summary.reports.auditNullTenant.commandsPassed",
      "commandsPassed",
      1,
      false,
    );
    if (!Array.isArray(auditNullTenant.commandsPassed) || !auditNullTenant.commandsPassed.includes("pnpm audit-null-tenant:check")) {
      failures.push("productionEvidenceSummary.summary.reports.auditNullTenant.commandsPassed eksik: pnpm audit-null-tenant:check");
    }
    requireSummaryAuditNullTenant(auditNullTenant, failures);
  }

  const rateLimit = requireNestedObject(reports, failures, "productionEvidenceSummary.summary.reports.rateLimit", "rateLimit");
  if (rateLimit) {
    requireObjectEqual(rateLimit, failures, "productionEvidenceSummary.summary.reports.rateLimit.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      rateLimit,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectStringList(
      rateLimit,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.commandsPassed",
      "commandsPassed",
      2,
      false,
    );
    for (const command of ["pnpm rate-limit:smoke", "pnpm rate-limit:check"]) {
      if (!Array.isArray(rateLimit.commandsPassed) || !rateLimit.commandsPassed.includes(command)) {
        failures.push(`productionEvidenceSummary.summary.reports.rateLimit.commandsPassed eksik: ${command}`);
      }
    }
    requireSummaryRateLimit(rateLimit, failures);
  }

  const rlsLive = requireNestedObject(reports, failures, "productionEvidenceSummary.summary.reports.rlsLive", "rlsLive");
  if (rlsLive) {
    requireObjectEqual(rlsLive, failures, "productionEvidenceSummary.summary.reports.rlsLive.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      rlsLive,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectStringList(
      rlsLive,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.commandsPassed",
      "commandsPassed",
      4,
      false,
    );
    for (const command of [
      "pnpm db:rls:check",
      "pnpm db:rls:check:live",
      "pnpm rls:load:smoke",
      "pnpm rls:live:check",
    ]) {
      if (!Array.isArray(rlsLive.commandsPassed) || !rlsLive.commandsPassed.includes(command)) {
        failures.push(`productionEvidenceSummary.summary.reports.rlsLive.commandsPassed eksik: ${command}`);
      }
    }
    requireSummaryRlsLive(rlsLive, failures);
  }

  const uat = requireNestedObject(reports, failures, "productionEvidenceSummary.summary.reports.uat", "uat");
  if (uat) {
    requireObjectEqual(uat, failures, "productionEvidenceSummary.summary.reports.uat.environment", "environment", "production");
    requireSummaryReportDateNotAfter(
      uat,
      failures,
      "productionEvidenceSummary.summary.reports.uat.checkedAt",
      "checkedAt",
      summary,
      goLiveReport,
    );
    requireObjectString(uat, failures, "productionEvidenceSummary.summary.reports.uat.tester", "tester");
    requireNonPlaceholderString(uat, failures, "productionEvidenceSummary.summary.reports.uat.tester", "tester");
    requireObjectString(uat, failures, "productionEvidenceSummary.summary.reports.uat.releaseCandidate", "releaseCandidate");
    requireNonPlaceholderString(uat, failures, "productionEvidenceSummary.summary.reports.uat.releaseCandidate", "releaseCandidate");
    requireObjectString(uat, failures, "productionEvidenceSummary.summary.reports.uat.rollbackImageTag", "rollbackImageTag");
    requireNonPlaceholderString(uat, failures, "productionEvidenceSummary.summary.reports.uat.rollbackImageTag", "rollbackImageTag");
    requireObjectString(uat, failures, "productionEvidenceSummary.summary.reports.uat.restoreBackupReference", "restoreBackupReference");
    requireNonPlaceholderString(uat, failures, "productionEvidenceSummary.summary.reports.uat.restoreBackupReference", "restoreBackupReference");
    requireMatchingString(
      goLiveReport,
      failures,
      "releaseCandidate",
      "releaseCandidate",
      uat,
      "productionEvidenceSummary.summary.reports.uat.releaseCandidate",
      "releaseCandidate",
    );
    requireMatchingString(
      goLiveReport,
      failures,
      "rollbackImageTag",
      "rollbackImageTag",
      uat,
      "productionEvidenceSummary.summary.reports.uat.rollbackImageTag",
      "rollbackImageTag",
    );
    if (restoreDrill) {
      requireMatchingString(
        restoreDrill,
        failures,
        "productionEvidenceSummary.summary.reports.restoreDrill.sourceBackup",
        "sourceBackup",
        uat,
        "productionEvidenceSummary.summary.reports.uat.restoreBackupReference",
        "restoreBackupReference",
      );
    }
    requireObjectTrue(uat, failures, "productionEvidenceSummary.summary.reports.uat.liveExamCyclePassed", "liveExamCyclePassed");
    requireObjectArrayAtLeast(uat, failures, "productionEvidenceSummary.summary.reports.uat.flowsVerified", "flowsVerified", 1);
    requireObjectArrayAtLeast(uat, failures, "productionEvidenceSummary.summary.reports.uat.journeyScenariosVerified", "journeyScenariosVerified", 21);
    requireObjectArrayAtLeast(uat, failures, "productionEvidenceSummary.summary.reports.uat.commandsPassed", "commandsPassed", 1);
  }
}

function requireSummaryReportDateNotAfter(report, failures, label, key, summary, goLiveReport) {
  requireObjectDate(report, failures, label, key);
  requireDateNotAfter(report, failures, label, key, summary, "productionEvidenceSummary.summary.generatedAt", "generatedAt");
  requireDateNotAfter(report, failures, label, key, goLiveReport, "checkedAt", "checkedAt");
}

function requireSummaryRollbackServices(report, failures) {
  requireObjectArrayAtLeast(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.deploymentRollback.servicesVerified",
    "servicesVerified",
    4,
  );
  const value = report.servicesVerified;
  if (!Array.isArray(value)) return;

  for (const service of ["web", "api", "worker", "queue-board"]) {
    const item = value.find((candidate) => candidate && typeof candidate === "object" && candidate.service === service);
    if (!item) {
      failures.push(`productionEvidenceSummary.summary.reports.deploymentRollback.servicesVerified eksik: ${service}`);
      continue;
    }
    if (!["healthy", "running"].includes(item.status)) {
      failures.push(`productionEvidenceSummary.summary.reports.deploymentRollback.servicesVerified.${service}.status healthy veya running olmali.`);
    }
    requireObjectString(
      item,
      failures,
      `productionEvidenceSummary.summary.reports.deploymentRollback.servicesVerified.${service}.imageTag`,
      "imageTag",
    );
    requireObjectString(
      item,
      failures,
      `productionEvidenceSummary.summary.reports.deploymentRollback.servicesVerified.${service}.evidenceReference`,
      "evidenceReference",
    );
    requireNonPlaceholderString(
      item,
      failures,
      `productionEvidenceSummary.summary.reports.deploymentRollback.servicesVerified.${service}.imageTag`,
      "imageTag",
    );
    requireNonPlaceholderString(
      item,
      failures,
      `productionEvidenceSummary.summary.reports.deploymentRollback.servicesVerified.${service}.evidenceReference`,
      "evidenceReference",
    );
  }
}

function requireSummaryGithubCi(report, failures) {
  requireObjectString(report, failures, "productionEvidenceSummary.summary.reports.githubCi.repository", "repository");
  requireNonPlaceholderString(report, failures, "productionEvidenceSummary.summary.reports.githubCi.repository", "repository");
  requireObjectString(report, failures, "productionEvidenceSummary.summary.reports.githubCi.commitSha", "commitSha");
  if (typeof report.commitSha !== "string" || !/^[a-f0-9]{40}$/i.test(report.commitSha)) {
    failures.push("productionEvidenceSummary.summary.reports.githubCi.commitSha 40 karakter git SHA olmali.");
  }
  requireObjectString(report, failures, "productionEvidenceSummary.summary.reports.githubCi.branch", "branch");
  requireNonPlaceholderString(report, failures, "productionEvidenceSummary.summary.reports.githubCi.branch", "branch");

  const workflow = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.githubCi.workflow", "workflow");
  if (workflow) {
    requireObjectString(workflow, failures, "productionEvidenceSummary.summary.reports.githubCi.workflow.name", "name");
    requireObjectEqual(workflow, failures, "productionEvidenceSummary.summary.reports.githubCi.workflow.path", "path", ".github/workflows/ci.yml");
    requireObjectString(workflow, failures, "productionEvidenceSummary.summary.reports.githubCi.workflow.runId", "runId");
    requireObjectIntegerAtLeast(workflow, failures, "productionEvidenceSummary.summary.reports.githubCi.workflow.runAttempt", "runAttempt", 1);
    requireObjectEqual(workflow, failures, "productionEvidenceSummary.summary.reports.githubCi.workflow.conclusion", "conclusion", "success");
    requireObjectOneOf(workflow, failures, "productionEvidenceSummary.summary.reports.githubCi.workflow.event", "event", [
      "push",
      "pull_request",
      "workflow_dispatch",
    ]);
    requireObjectString(workflow, failures, "productionEvidenceSummary.summary.reports.githubCi.workflow.runUrl", "runUrl");
    requireNonPlaceholderString(workflow, failures, "productionEvidenceSummary.summary.reports.githubCi.workflow.runUrl", "runUrl");
    if (typeof workflow.runUrl === "string" && !workflow.runUrl.startsWith("https://github.com/")) {
      failures.push("productionEvidenceSummary.summary.reports.githubCi.workflow.runUrl GitHub Actions URL'i olmali.");
    }
    requireObjectDate(workflow, failures, "productionEvidenceSummary.summary.reports.githubCi.workflow.startedAt", "startedAt");
    requireObjectDate(workflow, failures, "productionEvidenceSummary.summary.reports.githubCi.workflow.completedAt", "completedAt");
  }

  const command = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.githubCi.command", "command");
  if (command) {
    requireObjectTrue(command, failures, "productionEvidenceSummary.summary.reports.githubCi.command.workflowUsesSingleCiCommand", "workflowUsesSingleCiCommand");
    requireObjectEqual(command, failures, "productionEvidenceSummary.summary.reports.githubCi.command.command", "command", "pnpm run ci");
    requireObjectTrue(command, failures, "productionEvidenceSummary.summary.reports.githubCi.command.localCiParity", "localCiParity");
  }

  const jobs = report.jobs;
  if (!Array.isArray(jobs) || jobs.length === 0) {
    failures.push("productionEvidenceSummary.summary.reports.githubCi.jobs bos olmayan liste olmali.");
  } else {
    let ciCommandSeen = false;
    for (const [index, job] of jobs.entries()) {
      requireObjectString(job, failures, `productionEvidenceSummary.summary.reports.githubCi.jobs.${index}.name`, "name");
      requireObjectEqual(job, failures, `productionEvidenceSummary.summary.reports.githubCi.jobs.${index}.conclusion`, "conclusion", "success");
      requireObjectDate(job, failures, `productionEvidenceSummary.summary.reports.githubCi.jobs.${index}.startedAt`, "startedAt");
      requireObjectDate(job, failures, `productionEvidenceSummary.summary.reports.githubCi.jobs.${index}.completedAt`, "completedAt");
      requireObjectString(job, failures, `productionEvidenceSummary.summary.reports.githubCi.jobs.${index}.logUrl`, "logUrl");
      requireNonPlaceholderString(job, failures, `productionEvidenceSummary.summary.reports.githubCi.jobs.${index}.logUrl`, "logUrl");
      requireObjectStringList(
        job,
        failures,
        `productionEvidenceSummary.summary.reports.githubCi.jobs.${index}.stepsPassed`,
        "stepsPassed",
        1,
        false,
      );
      if (Array.isArray(job.stepsPassed) && job.stepsPassed.includes("pnpm run ci")) {
        ciCommandSeen = true;
      }
    }
    if (!ciCommandSeen) {
      failures.push("productionEvidenceSummary.summary.reports.githubCi.jobs stepsPassed icinde pnpm run ci gorulmeli.");
    }
  }

  requireObjectStringList(report, failures, "productionEvidenceSummary.summary.reports.githubCi.commandsPassed", "commandsPassed", 2, false);
  for (const command of ["pnpm run ci", "pnpm github-ci:check"]) {
    if (!Array.isArray(report.commandsPassed) || !report.commandsPassed.includes(command)) {
      failures.push(`productionEvidenceSummary.summary.reports.githubCi.commandsPassed eksik: ${command}`);
    }
  }
  requireObjectEvidenceReferences(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.githubCi.evidenceReferences",
    "evidenceReferences",
  );
}

function requireSummaryKvkkInventory(report, failures) {
  requireObjectString(report, failures, "productionEvidenceSummary.summary.reports.kvkkInventory.inventorySource", "inventorySource");
  requireNonPlaceholderString(report, failures, "productionEvidenceSummary.summary.reports.kvkkInventory.inventorySource", "inventorySource");
  requireSummaryKvkkDataSubjectCounts(report, failures);
  requireSummaryKvkkPurgeCoverage(report, failures);
  requireObjectStringList(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.kvkkInventory.auditActionsVerified",
    "auditActionsVerified",
    4,
    false,
  );
  for (const action of [
    "kvkk.student_pii_purged",
    "kvkk.teacher_pii_purged",
    "kvkk.guardian_pii_purged",
    "kvkk.user_pii_purged",
  ]) {
    if (!Array.isArray(report.auditActionsVerified) || !report.auditActionsVerified.includes(action)) {
      failures.push(`productionEvidenceSummary.summary.reports.kvkkInventory.auditActionsVerified eksik: ${action}`);
    }
  }

  const redaction = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.kvkkInventory.auditDiffRedactionVerified",
    "auditDiffRedactionVerified",
  );
  if (!redaction) return;

  requireSummaryObjectKeySet(
    redaction,
    ["endpoint", "negativeControls", "actionsSampled", "command"],
    failures,
    "productionEvidenceSummary.summary.reports.kvkkInventory.auditDiffRedactionVerified",
  );
  requireObjectEqual(
    redaction,
    failures,
    "productionEvidenceSummary.summary.reports.kvkkInventory.auditDiffRedactionVerified.endpoint",
    "endpoint",
    "/audit-logs",
  );
  requireExactStringSet(
    redaction.negativeControls,
    failures,
    "productionEvidenceSummary.summary.reports.kvkkInventory.auditDiffRedactionVerified.negativeControls",
    expectedKvkkAuditDiffNegativeControls,
  );
  requireExactStringSet(
    redaction.actionsSampled,
    failures,
    "productionEvidenceSummary.summary.reports.kvkkInventory.auditDiffRedactionVerified.actionsSampled",
    expectedKvkkAuditDiffActions,
  );
  if (typeof redaction.command !== "string" || !redaction.command.includes("audit-log")) {
    failures.push("productionEvidenceSummary.summary.reports.kvkkInventory.auditDiffRedactionVerified.command audit-log doğrulama komutu içermeli.");
  }
}

function requireSummaryKvkkDataSubjectCounts(report, failures) {
  const counts = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.kvkkInventory.dataSubjectCounts",
    "dataSubjectCounts",
  );
  if (!counts) return;

  let total = 0;
  for (const key of ["student", "teacher", "guardian", "user"]) {
    const value = counts[key];
    if (!Number.isInteger(value) || value < 0) {
      failures.push(`productionEvidenceSummary.summary.reports.kvkkInventory.dataSubjectCounts.${key} sifir veya daha buyuk tam sayi olmali.`);
    } else {
      total += value;
    }
  }
  if (total <= 0) {
    failures.push("productionEvidenceSummary.summary.reports.kvkkInventory.dataSubjectCounts toplami sifirdan buyuk olmali.");
  }
}

function requireSummaryKvkkPurgeCoverage(report, failures) {
  const purgeCoverage = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.kvkkInventory.purgeCoverage",
    "purgeCoverage",
  );
  if (!purgeCoverage) return;

  for (const [subject, fields] of Object.entries({
    student: ["firstName", "lastName", "phone", "email"],
    teacher: ["firstName", "lastName"],
    guardian: ["firstName", "lastName", "phone"],
    user: ["email", "name"],
  })) {
    const value = purgeCoverage[subject];
    if (!Array.isArray(value)) {
      failures.push(`productionEvidenceSummary.summary.reports.kvkkInventory.purgeCoverage.${subject} alan listesi zorunlu.`);
      continue;
    }
    for (const field of fields) {
      if (!value.includes(field)) {
        failures.push(`productionEvidenceSummary.summary.reports.kvkkInventory.purgeCoverage.${subject} eksik: ${field}`);
      }
    }
  }
}

function requireSummaryIdentityMigration(report, failures) {
  const decision = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.identityMigration.migrationDecision",
    "migrationDecision",
  );
  if (decision) {
    requireObjectString(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.identityMigration.migrationDecision.approvedBy",
      "approvedBy",
    );
    requireNonPlaceholderString(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.identityMigration.migrationDecision.approvedBy",
      "approvedBy",
    );
    requireObjectString(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.identityMigration.migrationDecision.approvalReference",
      "approvalReference",
    );
    requireNonPlaceholderString(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.identityMigration.migrationDecision.approvalReference",
      "approvalReference",
    );
    requireObjectOneOf(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.identityMigration.migrationDecision.activationMode",
      "activationMode",
      ["invite", "admin_link", "hybrid"],
    );
  }

  requireObjectStringList(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.identityMigration.verifications",
    "verifications",
    4,
    false,
  );
}

function requireSummaryFinancialRetention(report, failures) {
  const decision = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.financialRetention.policyDecision",
    "policyDecision",
  );
  if (decision) {
    requireObjectString(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.financialRetention.policyDecision.approvedBy",
      "approvedBy",
    );
    requireNonPlaceholderString(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.financialRetention.policyDecision.approvedBy",
      "approvedBy",
    );
    requireObjectString(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.financialRetention.policyDecision.approvalReference",
      "approvalReference",
    );
    requireNonPlaceholderString(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.financialRetention.policyDecision.approvalReference",
      "approvalReference",
    );
    requireObjectString(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.financialRetention.policyDecision.legalBasis",
      "legalBasis",
    );
    requireObjectIntegerAtLeast(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.financialRetention.policyDecision.retentionPeriodYears",
      "retentionPeriodYears",
      1,
    );
    requireObjectTrue(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.financialRetention.policyDecision.purgeException",
      "purgeException",
    );
  }

  requireObjectStringList(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.financialRetention.purgeBehaviorVerified",
    "purgeBehaviorVerified",
    2,
    false,
  );
}

function requireSummaryUploadAv(report, failures) {
  const decision = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.uploadAv.scannerDecision",
    "scannerDecision",
  );
  if (decision) {
    requireObjectOneOf(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.uploadAv.scannerDecision.mode",
      "mode",
      ["provider", "local"],
    );
    for (const key of ["approvedBy", "approvalReference", "scannerName", "signatureVersion"]) {
      requireObjectString(
        decision,
        failures,
        `productionEvidenceSummary.summary.reports.uploadAv.scannerDecision.${key}`,
        key,
      );
    }
    for (const key of ["approvedBy", "approvalReference", "scannerName"]) {
      requireNonPlaceholderString(
        decision,
        failures,
        `productionEvidenceSummary.summary.reports.uploadAv.scannerDecision.${key}`,
        key,
      );
    }
    requireObjectTrue(
      decision,
      failures,
      "productionEvidenceSummary.summary.reports.uploadAv.scannerDecision.failClosed",
      "failClosed",
    );
  }

  requireObjectStringList(report, failures, "productionEvidenceSummary.summary.reports.uploadAv.uploadSurfaces", "uploadSurfaces", 2, false);
  const scanResults = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.uploadAv.scanResults",
    "scanResults",
  );
  if (scanResults) {
    requireObjectTrue(scanResults, failures, "productionEvidenceSummary.summary.reports.uploadAv.scanResults.cleanFileAccepted", "cleanFileAccepted");
    requireObjectTrue(scanResults, failures, "productionEvidenceSummary.summary.reports.uploadAv.scanResults.eicarRejected", "eicarRejected");
    requireObjectTrue(
      scanResults,
      failures,
      "productionEvidenceSummary.summary.reports.uploadAv.scanResults.scannerUnavailableRejected",
      "scannerUnavailableRejected",
    );
  }
}

function requireSummaryExternalMonitoring(report, summary, failures) {
  const node = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.externalMonitoring.monitoringNode",
    "monitoringNode",
  );
  if (node) {
    for (const key of ["host", "region", "network"]) {
      requireObjectString(
        node,
        failures,
        `productionEvidenceSummary.summary.reports.externalMonitoring.monitoringNode.${key}`,
        key,
      );
      requireNonPlaceholderString(
        node,
        failures,
        `productionEvidenceSummary.summary.reports.externalMonitoring.monitoringNode.${key}`,
        key,
      );
    }
  }

  const monitors = report.monitorsVerified;
  if (!Array.isArray(monitors)) {
    failures.push("productionEvidenceSummary.summary.reports.externalMonitoring.monitorsVerified alan listesi zorunlu.");
  } else {
    for (const expected of externalMonitoringPublicEdgeMonitors) {
      const monitor = monitors.find((item) => item?.name === expected);
      if (!monitor) {
        failures.push(`productionEvidenceSummary.summary.reports.externalMonitoring.monitorsVerified eksik: ${expected}`);
        continue;
      }
      requireObjectEqual(
        monitor,
        failures,
        `productionEvidenceSummary.summary.reports.externalMonitoring.monitorsVerified.${expected}.status`,
        "status",
        "UP",
      );
      requireObjectString(
        monitor,
        failures,
        `productionEvidenceSummary.summary.reports.externalMonitoring.monitorsVerified.${expected}.url`,
        "url",
      );
      requireNonPlaceholderString(
        monitor,
        failures,
        `productionEvidenceSummary.summary.reports.externalMonitoring.monitorsVerified.${expected}.url`,
        "url",
      );
      if (!String(monitor.url).startsWith("https://")) {
        failures.push(`productionEvidenceSummary.summary.reports.externalMonitoring.monitorsVerified.${expected}.url https:// olmali.`);
      }
      requireMatchingUrlOrigin(
        monitor,
        failures,
        `productionEvidenceSummary.summary.reports.externalMonitoring.monitorsVerified.${expected}.url`,
        "url",
        summary,
        "productionEvidenceSummary.summary.webUrl",
        "webUrl",
      );
      if (expected === "Traefik TLS certificate") {
        requireObjectIntegerAtLeast(
          monitor,
          failures,
          `productionEvidenceSummary.summary.reports.externalMonitoring.monitorsVerified.${expected}.certificateDaysRemaining`,
          "certificateDaysRemaining",
          14,
        );
      }
    }
  }

  const drill = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill",
    "outageDrill",
  );
  if (drill) {
    for (const key of ["inducedAt", "detectedAt", "webhookDeliveredAt", "recoveredAt"]) {
      requireObjectDate(drill, failures, `productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.${key}`, key);
    }
    requireObjectNumberAtMost(
      drill,
      failures,
      "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.detectionLatencySeconds",
      "detectionLatencySeconds",
      120,
    );
    requireObjectNumberAtMost(
      drill,
      failures,
      "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.webhookDeliveryLatencySeconds",
      "webhookDeliveryLatencySeconds",
      120,
    );
    requireDateOrder(
      drill,
      failures,
      "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.inducedAt",
      "inducedAt",
      "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.detectedAt",
      "detectedAt",
    );
    requireDateOrder(
      drill,
      failures,
      "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.detectedAt",
      "detectedAt",
      "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.webhookDeliveredAt",
      "webhookDeliveredAt",
    );
    requireDateOrder(
      drill,
      failures,
      "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.webhookDeliveredAt",
      "webhookDeliveredAt",
      "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.recoveredAt",
      "recoveredAt",
    );
    requireLatencyMatches(
      drill,
      failures,
      "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.detectionLatencySeconds",
      "detectionLatencySeconds",
      "inducedAt",
      "detectedAt",
    );
    requireLatencyMatches(
      drill,
      failures,
      "productionEvidenceSummary.summary.reports.externalMonitoring.outageDrill.webhookDeliveryLatencySeconds",
      "webhookDeliveryLatencySeconds",
      "inducedAt",
      "webhookDeliveredAt",
    );
  }
}

function requireSummaryAdminMfa(report, failures) {
  const policy = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.adminMfa.policy", "policy");
  if (policy) {
    requireObjectEqual(policy, failures, "productionEvidenceSummary.summary.reports.adminMfa.policy.secretStorage", "secretStorage", "aes-256-gcm");
    requireObjectEqual(policy, failures, "productionEvidenceSummary.summary.reports.adminMfa.policy.secretEncryptionKeyEnv", "secretEncryptionKeyEnv", "ADMIN_MFA_SECRET_ENCRYPTION_KEY");
    requireObjectEqual(policy, failures, "productionEvidenceSummary.summary.reports.adminMfa.policy.recoveryCodeHashKeyEnv", "recoveryCodeHashKeyEnv", "ADMIN_MFA_RECOVERY_HASH_KEY");
    requireObjectEqual(policy, failures, "productionEvidenceSummary.summary.reports.adminMfa.policy.challengeSecretEnv", "challengeSecretEnv", "ADMIN_MFA_CHALLENGE_SECRET");
    requireObjectTrue(policy, failures, "productionEvidenceSummary.summary.reports.adminMfa.policy.smsOtpRejected", "smsOtpRejected");
    requireObjectStringList(policy, failures, "productionEvidenceSummary.summary.reports.adminMfa.policy.requiredRoles", "requiredRoles", 2, false);
    for (const role of ["SYSTEM_ADMIN", "TENANT_ADMIN"]) {
      if (!policy.requiredRoles?.includes(role)) {
        failures.push(`productionEvidenceSummary.summary.reports.adminMfa.policy.requiredRoles eksik: ${role}`);
      }
    }
    if (!["optional", "required"].includes(policy.mode)) {
      failures.push("productionEvidenceSummary.summary.reports.adminMfa.policy.mode optional veya required olmalı.");
    }
  }

  const enrollment = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.adminMfa.enrollment", "enrollment");
  if (enrollment) {
    for (const key of [
      "systemAdminsTotal",
      "systemAdminsEnrolled",
      "tenantAdminsTotal",
      "tenantAdminsEnrolled",
      "unenrolledRequiredAdmins",
      "recoveryCodesPerEnrollment",
    ]) {
      requireObjectIntegerAtLeast(enrollment, failures, `productionEvidenceSummary.summary.reports.adminMfa.enrollment.${key}`, key, 0);
    }
    requireObjectEqual(enrollment, failures, "productionEvidenceSummary.summary.reports.adminMfa.enrollment.unenrolledRequiredAdmins", "unenrolledRequiredAdmins", 0);
    requireObjectIntegerAtLeast(
      enrollment,
      failures,
      "productionEvidenceSummary.summary.reports.adminMfa.enrollment.recoveryCodesPerEnrollment",
      "recoveryCodesPerEnrollment",
      8,
    );
    if (enrollment.systemAdminsEnrolled > enrollment.systemAdminsTotal) {
      failures.push("productionEvidenceSummary.summary.reports.adminMfa.enrollment.systemAdminsEnrolled toplamdan büyük olamaz.");
    }
    if (enrollment.tenantAdminsEnrolled > enrollment.tenantAdminsTotal) {
      failures.push("productionEvidenceSummary.summary.reports.adminMfa.enrollment.tenantAdminsEnrolled toplamdan büyük olamaz.");
    }
  }

  const verification = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.adminMfa.loginVerification",
    "loginVerification",
  );
  if (verification) {
    for (const key of [
      "passwordOnlyLoginBlocked",
      "totpLoginSucceeded",
      "invalidTotpRejected",
      "totpReuseRejected",
      "recoveryCodeLoginSucceeded",
      "recoveryCodeReuseRejected",
      "sessionsRevokedOnEnable",
      "sessionsRevokedOnDisable",
    ]) {
      requireObjectTrue(verification, failures, `productionEvidenceSummary.summary.reports.adminMfa.loginVerification.${key}`, key);
    }
  }

  requireObjectStringList(report, failures, "productionEvidenceSummary.summary.reports.adminMfa.commandsPassed", "commandsPassed", 2, false);
}

function requireSummaryAiReportSummary(report, failures) {
  const provider = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.aiReportSummary.provider", "provider");
  if (provider) {
    requireObjectOneOf(
      provider,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.provider.mode",
      "mode",
      ["disabled", "template"],
    );
    requireObjectEqual(
      provider,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.provider.featureFlagEnv",
      "featureFlagEnv",
      "AI_REPORT_SUMMARY_PROVIDER",
    );
    requireObjectEqual(
      provider,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.provider.evidenceTargetEnv",
      "evidenceTargetEnv",
      "AI_REPORT_SUMMARY_EVIDENCE_TARGET",
    );
    requireObjectEqual(
      provider,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.provider.externalProvider",
      "externalProvider",
      "disabled",
    );
    requireObjectEqual(
      provider,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.provider.productionExternalAiEnabled",
      "productionExternalAiEnabled",
      false,
    );
    requireObjectTrue(
      provider,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.provider.templateFallbackAvailable",
      "templateFallbackAvailable",
    );
  }

  const kvkk = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.aiReportSummary.kvkk", "kvkk");
  if (kvkk) {
    requireObjectEqual(kvkk, failures, "productionEvidenceSummary.summary.reports.aiReportSummary.kvkk.piiSentToModel", "piiSentToModel", false);
    requireObjectStringList(kvkk, failures, "productionEvidenceSummary.summary.reports.aiReportSummary.kvkk.fieldsSent", "fieldsSent", 1, false);
    requireObjectStringList(kvkk, failures, "productionEvidenceSummary.summary.reports.aiReportSummary.kvkk.excludedFields", "excludedFields", 6, false);
    for (const field of ["studentId", "studentName", "guardianName", "tcKimlikNo", "phone", "email"]) {
      if (!kvkk.excludedFields?.includes(field)) {
        failures.push(`productionEvidenceSummary.summary.reports.aiReportSummary.kvkk.excludedFields eksik: ${field}`);
      }
    }
    for (const field of kvkk.fieldsSent ?? []) {
      if (/(studentId|studentName|guardian|tcKimlik|phone|email|address|firstName|lastName)/i.test(field)) {
        failures.push(`productionEvidenceSummary.summary.reports.aiReportSummary.kvkk.fieldsSent PII alanı içeremez: ${field}`);
      }
    }
    requireObjectString(
      kvkk,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.kvkk.overseasTransferAssessment",
      "overseasTransferAssessment",
    );
    requireNonPlaceholderString(
      kvkk,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.kvkk.overseasTransferAssessment",
      "overseasTransferAssessment",
    );
  }

  const stopRule = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.aiReportSummary.externalAiStopRule",
    "externalAiStopRule",
  );
  if (stopRule) {
    for (const key of ["kvkkAssessmentRequired", "productOwnerApprovalRequired", "teacherReviewRequired"]) {
      requireObjectTrue(stopRule, failures, `productionEvidenceSummary.summary.reports.aiReportSummary.externalAiStopRule.${key}`, key);
    }
    requireObjectEqual(
      stopRule,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.externalAiStopRule.anthropicEnabledInProduction",
      "anthropicEnabledInProduction",
      false,
    );
    requireObjectString(
      stopRule,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.externalAiStopRule.decisionReference",
      "decisionReference",
    );
    requireNonPlaceholderString(
      stopRule,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.externalAiStopRule.decisionReference",
      "decisionReference",
    );
  }

  const generation = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.aiReportSummary.generation", "generation");
  if (generation) {
    requireObjectTrue(
      generation,
      failures,
      "productionEvidenceSummary.summary.reports.aiReportSummary.generation.deterministicOutput",
      "deterministicOutput",
    );
    if (provider?.mode === "disabled") {
      requireObjectTrue(
        generation,
        failures,
        "productionEvidenceSummary.summary.reports.aiReportSummary.generation.featureDisabled",
        "featureDisabled",
      );
      for (const key of [
        "templateSummaryGenerated",
        "studentCommentaryGenerated",
        "teacherActionDraftGenerated",
        "outputStoredInSnapshot",
      ]) {
        requireObjectEqual(
          generation,
          failures,
          `productionEvidenceSummary.summary.reports.aiReportSummary.generation.${key}`,
          key,
          false,
        );
      }
    }
    if (provider?.mode === "template") {
      for (const key of [
        "teacherReviewRequired",
        "disclaimerIncluded",
        "outputStoredInSnapshot",
      ]) {
        requireObjectTrue(generation, failures, `productionEvidenceSummary.summary.reports.aiReportSummary.generation.${key}`, key);
      }
      for (const key of ["templateSummaryGenerated", "studentCommentaryGenerated", "teacherActionDraftGenerated"]) {
        requireObjectTrue(generation, failures, `productionEvidenceSummary.summary.reports.aiReportSummary.generation.${key}`, key);
      }
    }
  }

  const validation = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.aiReportSummary.validation", "validation");
  if (validation) {
    for (const key of ["piiLeakageCheckPassed", "logsExcludePromptResponse", "externalProviderNotCalled"]) {
      requireObjectTrue(validation, failures, `productionEvidenceSummary.summary.reports.aiReportSummary.validation.${key}`, key);
    }
    if (provider?.mode === "template") {
      requireObjectTrue(
        validation,
        failures,
        "productionEvidenceSummary.summary.reports.aiReportSummary.validation.templateRegressionPassed",
        "templateRegressionPassed",
      );
    }
  }

  requireObjectStringList(report, failures, "productionEvidenceSummary.summary.reports.aiReportSummary.commandsPassed", "commandsPassed", 2, false);
}

function requireSummaryLiveExamCycle(report, failures) {
  const examCycle = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.liveExamCycle.examCycle",
    "examCycle",
  );
  if (!examCycle) return;

  for (const key of [
    "examId",
    "answerKeyId",
    "answerKeyVersion",
    "parserConfigVersion",
    "rawImportId",
    "reportSnapshotId",
    "firstStudentId",
  ]) {
    requireObjectString(examCycle, failures, `productionEvidenceSummary.summary.reports.liveExamCycle.examCycle.${key}`, key);
    requireNonPlaceholderString(examCycle, failures, `productionEvidenceSummary.summary.reports.liveExamCycle.examCycle.${key}`, key);
  }

  requireObjectIntegerAtLeast(
    examCycle,
    failures,
    "productionEvidenceSummary.summary.reports.liveExamCycle.examCycle.answerKeyQuestionCount",
    "answerKeyQuestionCount",
    90,
  );
  requireObjectIntegerAtLeast(
    examCycle,
    failures,
    "productionEvidenceSummary.summary.reports.liveExamCycle.examCycle.bookletVariantCount",
    "bookletVariantCount",
    1,
  );
  requireObjectIntegerAtLeast(
    examCycle,
    failures,
    "productionEvidenceSummary.summary.reports.liveExamCycle.examCycle.participantCount",
    "participantCount",
    1,
  );
  requireObjectIntegerAtLeast(
    examCycle,
    failures,
    "productionEvidenceSummary.summary.reports.liveExamCycle.examCycle.matchedCount",
    "matchedCount",
    1,
  );
  requireObjectIntegerAtLeast(
    examCycle,
    failures,
    "productionEvidenceSummary.summary.reports.liveExamCycle.examCycle.examResultCount",
    "examResultCount",
    1,
  );
  requireObjectIntegerAtLeast(
    examCycle,
    failures,
    "productionEvidenceSummary.summary.reports.liveExamCycle.examCycle.reportResultCount",
    "reportResultCount",
    1,
  );

  for (const key of [
    "answerKeyImported",
    "opticalImportCommitted",
    "rawImportArchived",
    "evaluationQueued",
    "quarantinePathVerified",
    "reportGenerated",
    "reportReady",
    "karnePdfDownloaded",
    "excelDownloaded",
    "studentPortalViewed",
    "guardianPortalViewed",
    "noMockRoutes",
  ]) {
    requireObjectTrue(examCycle, failures, `productionEvidenceSummary.summary.reports.liveExamCycle.examCycle.${key}`, key);
  }

  requireObjectEvidenceReferences(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.liveExamCycle.evidenceReferences",
    "evidenceReferences",
  );
}

function requireSummaryInlineUploadMigration(report, failures) {
  const storageMode = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.inlineUploadMigration.storageMode",
    "storageMode",
  );
  if (storageMode) {
    requireObjectEqual(
      storageMode,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.storageMode.supportAttachmentStorage",
      "supportAttachmentStorage",
      "s3",
    );
    requireObjectEqual(
      storageMode,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.storageMode.homeworkMaterialFileStorage",
      "homeworkMaterialFileStorage",
      "s3",
    );
    requireObjectEqual(
      storageMode,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.storageMode.downloadMode",
      "downloadMode",
      "signed-url",
    );
    requireObjectTrue(
      storageMode,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.storageMode.contentBase64WriteDisabled",
      "contentBase64WriteDisabled",
    );
    requireObjectTrue(
      storageMode,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.storageMode.inlineReadCompatibility",
      "inlineReadCompatibility",
    );
    requireObjectIntegerAtLeast(
      storageMode,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.storageMode.downloadUrlExpiresInSeconds",
      "downloadUrlExpiresInSeconds",
      1,
    );
    requireObjectNumberAtMost(
      storageMode,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.storageMode.downloadUrlExpiresInSeconds",
      "downloadUrlExpiresInSeconds",
      300,
    );
  }

  const dryRun = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.inlineUploadMigration.dryRun",
    "dryRun",
  );
  if (dryRun) {
    requireObjectEqual(dryRun, failures, "productionEvidenceSummary.summary.reports.inlineUploadMigration.dryRun.status", "status", "DRY_RUN");
    requireObjectDate(dryRun, failures, "productionEvidenceSummary.summary.reports.inlineUploadMigration.dryRun.generatedAt", "generatedAt");
    requireObjectEqual(
      dryRun,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.dryRun.approvalRequired",
      "approvalRequired",
      "INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true",
    );
    requireSummaryInlineUploadSubjects(dryRun.subjects, failures, "dryRun", false);
  }

  const migration = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.inlineUploadMigration.migration",
    "migration",
  );
  if (migration) {
    requireObjectEqual(
      migration,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.migration.status",
      "status",
      "MIGRATED",
    );
    requireObjectDate(
      migration,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.migration.generatedAt",
      "generatedAt",
    );
    requireObjectString(
      migration,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.migration.approvedBy",
      "approvedBy",
    );
    requireNonPlaceholderString(
      migration,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.migration.approvedBy",
      "approvedBy",
    );
    requireObjectString(
      migration,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.migration.approvalReference",
      "approvalReference",
    );
    requireNonPlaceholderString(
      migration,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.migration.approvalReference",
      "approvalReference",
    );
    requireObjectEqual(
      migration,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.migration.approvalEnv",
      "approvalEnv",
      "INLINE_UPLOAD_CONTENT_MIGRATION_APPROVED=true",
    );
    requireSummaryInlineUploadSubjects(migration.subjects, failures, "migration", true);
    requireSummaryInlineUploadMigrated(migration.migrated, failures);
  }

  const orphanAudit = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.inlineUploadMigration.orphanAudit",
    "orphanAudit",
  );
  if (orphanAudit) {
    requireObjectEqual(
      orphanAudit,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.orphanAudit.result",
      "result",
      "PASS",
    );
    requireObjectEqual(
      orphanAudit,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.orphanAudit.status",
      "status",
      "NO_ORPHANS",
    );
    requireObjectTrue(
      orphanAudit,
      failures,
      "productionEvidenceSummary.summary.reports.inlineUploadMigration.orphanAudit.bucketVerified",
      "bucketVerified",
    );
    requireSummaryInlineUploadOrphanSubjects(orphanAudit.subjects, failures);
  }

  requireObjectEvidenceReferences(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.inlineUploadMigration.evidenceReferences",
    "evidenceReferences",
  );
}

function requireSummaryInlineUploadOrphanSubjects(subjects, failures) {
  if (!Array.isArray(subjects)) {
    failures.push("productionEvidenceSummary.summary.reports.inlineUploadMigration.orphanAudit.subjects listesi zorunlu.");
    return;
  }

  for (const subject of inlineUploadSubjects) {
    const item = subjects.find((candidate) => candidate?.subject === subject);
    if (!item) {
      failures.push(`productionEvidenceSummary.summary.reports.inlineUploadMigration.orphanAudit.subjects eksik: ${subject}`);
      continue;
    }
    for (const key of ["listedObjects", "dbReferencedObjects", "referencedObjectsPresent"]) {
      requireObjectIntegerAtLeast(
        item,
        failures,
        `productionEvidenceSummary.summary.reports.inlineUploadMigration.orphanAudit.subjects.${subject}.${key}`,
        key,
        0,
      );
    }
    for (const key of ["dbReferencedMissingObjects", "orphanObjects", "invalidKeyObjects", "legacyDbStorageKeyRows"]) {
      requireObjectEqual(
        item,
        failures,
        `productionEvidenceSummary.summary.reports.inlineUploadMigration.orphanAudit.subjects.${subject}.${key}`,
        key,
        0,
      );
    }
  }
}

function requireSummaryInlineUploadSubjects(subjects, failures, scope, requirePendingZero) {
  if (!Array.isArray(subjects)) {
    failures.push(`productionEvidenceSummary.summary.reports.inlineUploadMigration.${scope}.subjects listesi zorunlu.`);
    return;
  }

  for (const subject of ["homework_material_files", "support_ticket_attachments"]) {
    const item = subjects.find((candidate) => candidate?.subject === subject);
    if (!item) {
      failures.push(`productionEvidenceSummary.summary.reports.inlineUploadMigration.${scope}.subjects eksik: ${subject}`);
      continue;
    }
    for (const key of [
      "totalRows",
      "pendingRows",
      "pendingActiveRows",
      "pendingDeletedRows",
      "pendingBase64Characters",
      "tableSizeBytes",
    ]) {
      requireObjectIntegerAtLeast(
        item,
        failures,
        `productionEvidenceSummary.summary.reports.inlineUploadMigration.${scope}.subjects.${subject}.${key}`,
        key,
        0,
      );
    }
    if (requirePendingZero) {
      for (const key of ["pendingRows", "pendingActiveRows", "pendingDeletedRows", "pendingBase64Characters"]) {
        requireObjectEqual(
          item,
          failures,
          `productionEvidenceSummary.summary.reports.inlineUploadMigration.${scope}.subjects.${subject}.${key}`,
          key,
          0,
        );
      }
    }
  }
}

function requireSummaryInlineUploadMigrated(migrated, failures) {
  if (!Array.isArray(migrated)) {
    failures.push("productionEvidenceSummary.summary.reports.inlineUploadMigration.migration.migrated listesi zorunlu.");
    return;
  }

  for (const subject of ["homework_material_files", "support_ticket_attachments"]) {
    const item = migrated.find((candidate) => candidate?.subject === subject);
    if (!item) {
      failures.push(`productionEvidenceSummary.summary.reports.inlineUploadMigration.migration.migrated eksik: ${subject}`);
      continue;
    }
    requireObjectIntegerAtLeast(
      item,
      failures,
      `productionEvidenceSummary.summary.reports.inlineUploadMigration.migration.migrated.${subject}.migratedRows`,
      "migratedRows",
      0,
    );
    requireObjectIntegerAtLeast(
      item,
      failures,
      `productionEvidenceSummary.summary.reports.inlineUploadMigration.migration.migrated.${subject}.migratedBytes`,
      "migratedBytes",
      0,
    );
  }
}

function requireSummaryRlsLive(report, failures) {
  const schema = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.rlsLive.schema", "schema");
  if (schema) {
    requireObjectIntegerAtLeast(
      schema,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.schema.tenantScopedTables",
      "tenantScopedTables",
      expectedTenantTables.length,
    );
    requireObjectTrue(schema, failures, "productionEvidenceSummary.summary.reports.rlsLive.schema.derivedFromSchema", "derivedFromSchema");
    requireObjectTrue(schema, failures, "productionEvidenceSummary.summary.reports.rlsLive.schema.staticCheckPassed", "staticCheckPassed");
    requireObjectTrue(schema, failures, "productionEvidenceSummary.summary.reports.rlsLive.schema.liveCheckPassed", "liveCheckPassed");
    requireObjectStringList(
      schema,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.schema.tablesVerified",
      "tablesVerified",
      expectedTenantTables.length,
      false,
    );
    if (schema.tenantScopedTables !== expectedTenantTables.length) {
      failures.push(`productionEvidenceSummary.summary.reports.rlsLive.schema.tenantScopedTables ${expectedTenantTables.length} olmali.`);
    }
    if (Array.isArray(schema.tablesVerified)) {
      for (const table of expectedTenantTables) {
        if (!schema.tablesVerified.includes(table)) {
          failures.push(`productionEvidenceSummary.summary.reports.rlsLive.schema.tablesVerified eksik: ${table}`);
        }
      }
    }
  }

  const isolation = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.rlsLive.isolation", "isolation");
  if (isolation) {
    requireObjectString(isolation, failures, "productionEvidenceSummary.summary.reports.rlsLive.isolation.tenantAHash", "tenantAHash");
    requireObjectString(isolation, failures, "productionEvidenceSummary.summary.reports.rlsLive.isolation.tenantBHash", "tenantBHash");
    requireNonPlaceholderString(isolation, failures, "productionEvidenceSummary.summary.reports.rlsLive.isolation.tenantAHash", "tenantAHash");
    requireNonPlaceholderString(isolation, failures, "productionEvidenceSummary.summary.reports.rlsLive.isolation.tenantBHash", "tenantBHash");
    requireObjectEqual(isolation, failures, "productionEvidenceSummary.summary.reports.rlsLive.isolation.crossTenantReadRows", "crossTenantReadRows", 0);
    requireObjectIntegerAtLeast(
      isolation,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.isolation.crossTenantReadChecks",
      "crossTenantReadChecks",
      expectedTenantTables.length,
    );
    requireObjectStringList(
      isolation,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.isolation.withCheckRejects",
      "withCheckRejects",
      requiredRlsWriteRejects.length,
      false,
    );
    for (const reject of requiredRlsWriteRejects) {
      if (!Array.isArray(isolation.withCheckRejects) || !isolation.withCheckRejects.includes(reject)) {
        failures.push(`productionEvidenceSummary.summary.reports.rlsLive.isolation.withCheckRejects eksik: ${reject}`);
      }
    }
    requireObjectTrue(
      isolation,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.isolation.systemAdminBypassDefaultOff",
      "systemAdminBypassDefaultOff",
    );
    requireObjectTrue(
      isolation,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.isolation.bypassRequiresReason",
      "bypassRequiresReason",
    );
    requireObjectEqual(
      isolation,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.isolation.auditBypassAction",
      "auditBypassAction",
      "system.rls_bypass_requested",
    );
  }

  const tenantFkPreflight = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.rlsLive.tenantFkPreflight",
    "tenantFkPreflight",
  );
  if (tenantFkPreflight) {
    requireSummaryObjectKeySet(
      tenantFkPreflight,
      [
        "requiredCompositeRelations",
        "relationsVerified",
        "legacyAllowlistCount",
        "orphanRows",
        "crossTenantParentRows",
        "crossTenantInsertRejects",
        "migrationPreflightCommand",
      ],
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.tenantFkPreflight",
    );
    requireObjectEqual(
      tenantFkPreflight,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.tenantFkPreflight.requiredCompositeRelations",
      "requiredCompositeRelations",
      expectedTenantCompositeRelations.length,
    );
    requireExactStringSet(
      tenantFkPreflight.relationsVerified,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.tenantFkPreflight.relationsVerified",
      expectedTenantCompositeRelations,
    );
    requireObjectEqual(
      tenantFkPreflight,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.tenantFkPreflight.legacyAllowlistCount",
      "legacyAllowlistCount",
      0,
    );
    requireObjectEqual(
      tenantFkPreflight,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.tenantFkPreflight.orphanRows",
      "orphanRows",
      0,
    );
    requireObjectEqual(
      tenantFkPreflight,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.tenantFkPreflight.crossTenantParentRows",
      "crossTenantParentRows",
      0,
    );
    requireExactStringSet(
      tenantFkPreflight.crossTenantInsertRejects,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.tenantFkPreflight.crossTenantInsertRejects",
      expectedTenantFkInsertRejects,
    );
    if (
      typeof tenantFkPreflight.migrationPreflightCommand !== "string" ||
      !tenantFkPreflight.migrationPreflightCommand.includes("pnpm tenant-db:check")
    ) {
      failures.push("productionEvidenceSummary.summary.reports.rlsLive.tenantFkPreflight.migrationPreflightCommand pnpm tenant-db:check icermeli.");
    }
  }

  const loadSmoke = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.rlsLive.loadSmoke", "loadSmoke");
  if (loadSmoke) {
    requireObjectIntegerAtLeast(loadSmoke, failures, "productionEvidenceSummary.summary.reports.rlsLive.loadSmoke.targetRps", "targetRps", 200);
    requireObjectNumberAtLeast(
      loadSmoke,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.loadSmoke.actualRps",
      "actualRps",
      loadSmoke.targetRps ?? 200,
    );
    requireObjectIntegerAtLeast(
      loadSmoke,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.loadSmoke.durationSeconds",
      "durationSeconds",
      1,
    );
    requireObjectIntegerAtLeast(
      loadSmoke,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.loadSmoke.concurrency",
      "concurrency",
      1,
    );
    requireObjectIntegerAtLeast(
      loadSmoke,
      failures,
      "productionEvidenceSummary.summary.reports.rlsLive.loadSmoke.queriesCompleted",
      "queriesCompleted",
      1,
    );
    requireObjectEqual(loadSmoke, failures, "productionEvidenceSummary.summary.reports.rlsLive.loadSmoke.failures", "failures", 0);
  }

  requireObjectEvidenceReferences(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.rlsLive.evidenceReferences",
    "evidenceReferences",
  );
  requireRlsEvidenceReferences(
    report.evidenceReferences,
    failures,
    "productionEvidenceSummary.summary.reports.rlsLive.evidenceReferences",
  );
}

function requireSummaryAuditNullTenant(report, failures) {
  const classification = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant",
    "auditNullTenant",
  );
  if (!classification) return;

  requireSummaryObjectKeySet(
    classification,
    ["totalRows", "tenantRows", "nullTenantRows", "nullTenantBreakdown"],
    failures,
    "productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant",
  );
  requireObjectIntegerAtLeast(
    classification,
    failures,
    "productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.totalRows",
    "totalRows",
    0,
  );
  requireObjectIntegerAtLeast(
    classification,
    failures,
    "productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.tenantRows",
    "tenantRows",
    0,
  );
  requireObjectIntegerAtLeast(
    classification,
    failures,
    "productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.nullTenantRows",
    "nullTenantRows",
    0,
  );
  if (
    Number.isInteger(classification.totalRows) &&
    Number.isInteger(classification.tenantRows) &&
    Number.isInteger(classification.nullTenantRows) &&
    classification.totalRows !== classification.tenantRows + classification.nullTenantRows
  ) {
    failures.push(
      "productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.totalRows tenantRows + nullTenantRows toplamına esit olmali.",
    );
  }

  const breakdown = requireNestedObject(
    classification,
    failures,
    "productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.nullTenantBreakdown",
    "nullTenantBreakdown",
  );
  if (!breakdown) return;

  requireSummaryObjectKeySet(
    breakdown,
    ["system", "deletedTenant", "unknown"],
    failures,
    "productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.nullTenantBreakdown",
  );

  let breakdownCount = 0;
  for (const key of ["system", "deletedTenant", "unknown"]) {
    const item = requireNestedObject(
      breakdown,
      failures,
      `productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.nullTenantBreakdown.${key}`,
      key,
    );
    if (!item) continue;
    requireSummaryObjectKeySet(
      item,
      ["count", "classificationRule"],
      failures,
      `productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.nullTenantBreakdown.${key}`,
    );
    requireObjectIntegerAtLeast(
      item,
      failures,
      `productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.nullTenantBreakdown.${key}.count`,
      "count",
      0,
    );
    requireObjectString(
      item,
      failures,
      `productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.nullTenantBreakdown.${key}.classificationRule`,
      "classificationRule",
    );
    if (Number.isInteger(item.count)) breakdownCount += item.count;
  }

  if (breakdown.unknown?.count !== 0) {
    failures.push("productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.nullTenantBreakdown.unknown.count 0 olmali.");
  }
  if (Number.isInteger(classification.nullTenantRows) && breakdownCount !== classification.nullTenantRows) {
    failures.push(
      "productionEvidenceSummary.summary.reports.auditNullTenant.auditNullTenant.nullTenantBreakdown count toplami nullTenantRows degerine esit olmali.",
    );
  }
}

function requireSummaryRateLimit(report, failures) {
  const config = requireNestedObject(report, failures, "productionEvidenceSummary.summary.reports.rateLimit.config", "config");
  if (config) {
    requireObjectTrue(config, failures, "productionEvidenceSummary.summary.reports.rateLimit.config.apiRateLimitEnabled", "apiRateLimitEnabled");
    requireObjectEqual(config, failures, "productionEvidenceSummary.summary.reports.rateLimit.config.apiRateLimitStore", "apiRateLimitStore", "redis");
    requireObjectEqual(
      config,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.config.loginAttemptLimiterStore",
      "loginAttemptLimiterStore",
      "redis",
    );
    requireObjectIntegerAtLeast(config, failures, "productionEvidenceSummary.summary.reports.rateLimit.config.windowMs", "windowMs", 1);
    requireObjectIntegerAtLeast(config, failures, "productionEvidenceSummary.summary.reports.rateLimit.config.maxRequests", "maxRequests", 1);
    requireObjectIntegerAtLeast(
      config,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.config.loginMaxAttempts",
      "loginMaxAttempts",
      1,
    );
    requireObjectTrue(
      config,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.config.keyIncludesClientIpHash",
      "keyIncludesClientIpHash",
    );
    requireObjectStringList(
      config,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.config.excludedPaths",
      "excludedPaths",
      2,
      false,
    );
    for (const path of ["/health", "/metrics"]) {
      if (!Array.isArray(config.excludedPaths) || !config.excludedPaths.includes(path)) {
        failures.push(`productionEvidenceSummary.summary.reports.rateLimit.config.excludedPaths eksik: ${path}`);
      }
    }
  }

  const instances = report.instances;
  if (!Array.isArray(instances) || instances.length < 2) {
    failures.push("productionEvidenceSummary.summary.reports.rateLimit.instances en az 2 API instance kaniti icermeli.");
  } else {
    for (const [index, instance] of instances.entries()) {
      requireObjectString(instance, failures, `productionEvidenceSummary.summary.reports.rateLimit.instances.${index}.label`, "label");
      requireObjectString(instance, failures, `productionEvidenceSummary.summary.reports.rateLimit.instances.${index}.baseUrl`, "baseUrl");
      requireNonPlaceholderString(instance, failures, `productionEvidenceSummary.summary.reports.rateLimit.instances.${index}.baseUrl`, "baseUrl");
    }
  }

  const apiRateLimit = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit",
    "apiRateLimit",
  );
  if (apiRateLimit) {
    requireObjectString(apiRateLimit, failures, "productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit.clientIpHash", "clientIpHash");
    requireObjectIntegerAtLeast(apiRateLimit, failures, "productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit.requestsSent", "requestsSent", 1);
    requireObjectIntegerAtLeast(
      apiRateLimit,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit.allowedBeforeLimit",
      "allowedBeforeLimit",
      0,
    );
    requireObjectIntegerAtLeast(
      apiRateLimit,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit.limitedAtRequest",
      "limitedAtRequest",
      1,
    );
    requireObjectEqual(apiRateLimit, failures, "productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit.limitStatusCode", "limitStatusCode", 429);
    requireObjectEqual(apiRateLimit, failures, "productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit.errorCode", "errorCode", "RATE_LIMITED");
    requireObjectTrue(
      apiRateLimit,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit.retryAfterHeaderPresent",
      "retryAfterHeaderPresent",
    );
    requireObjectTrue(
      apiRateLimit,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit.secondInstanceLimitObserved",
      "secondInstanceLimitObserved",
    );
    requireObjectTrue(
      apiRateLimit,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit.healthEndpointExcluded",
      "healthEndpointExcluded",
    );
    requireObjectTrue(
      apiRateLimit,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit.metricsEndpointExcluded",
      "metricsEndpointExcluded",
    );
    if (Number.isInteger(config?.maxRequests) && Number.isInteger(apiRateLimit.limitedAtRequest)) {
      if (apiRateLimit.limitedAtRequest !== config.maxRequests + 1) {
        failures.push("productionEvidenceSummary.summary.reports.rateLimit.apiRateLimit.limitedAtRequest config.maxRequests + 1 olmali.");
      }
    }
  }

  const loginAttemptLimiter = requireNestedObject(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.rateLimit.loginAttemptLimiter",
    "loginAttemptLimiter",
  );
  if (loginAttemptLimiter) {
    requireObjectString(
      loginAttemptLimiter,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.loginAttemptLimiter.clientIpHash",
      "clientIpHash",
    );
    requireObjectString(
      loginAttemptLimiter,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.loginAttemptLimiter.nationalIdHash",
      "nationalIdHash",
    );
    requireObjectIntegerAtLeast(
      loginAttemptLimiter,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.loginAttemptLimiter.attemptsSent",
      "attemptsSent",
      1,
    );
    requireObjectEqual(
      loginAttemptLimiter,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.loginAttemptLimiter.lockStatusCode",
      "lockStatusCode",
      429,
    );
    requireObjectEqual(
      loginAttemptLimiter,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.loginAttemptLimiter.errorCode",
      "errorCode",
      "LOGIN_LOCKED",
    );
    requireObjectTrue(
      loginAttemptLimiter,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.loginAttemptLimiter.sharedAcrossInstances",
      "sharedAcrossInstances",
    );
    requireObjectTrue(
      loginAttemptLimiter,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.loginAttemptLimiter.nationalIdAndIpScoped",
      "nationalIdAndIpScoped",
    );
    requireObjectTrue(
      loginAttemptLimiter,
      failures,
      "productionEvidenceSummary.summary.reports.rateLimit.loginAttemptLimiter.differentIpNotLocked",
      "differentIpNotLocked",
    );
    if (Number.isInteger(config?.loginMaxAttempts) && Number.isInteger(loginAttemptLimiter.attemptsSent)) {
      if (loginAttemptLimiter.attemptsSent < config.loginMaxAttempts + 1) {
        failures.push("productionEvidenceSummary.summary.reports.rateLimit.loginAttemptLimiter.attemptsSent config.loginMaxAttempts + 1 veya daha fazla olmali.");
      }
    }
  }

  requireObjectEvidenceReferences(
    report,
    failures,
    "productionEvidenceSummary.summary.reports.rateLimit.evidenceReferences",
    "evidenceReferences",
  );
}

function requireDeployment(report, failures) {
  const value = requireObject(report, failures, "deployment");
  if (!value) return;

  requireSummaryObjectKeySet(value, goLiveDeploymentKeys, failures, "deployment");

  for (const key of [
    "githubCiPassed",
    "traefikHttpsPassed",
    "restoreDrillPassed",
    "walArchivePassed",
    "reportGenerationPassed",
    "rollbackDrillPassed",
    "observabilityUatPassed",
    "externalMonitoringPassed",
    "adminMfaPassed",
    "aiReportSummaryPassed",
    "rateLimitRedisPassed",
    "rlsLivePassed",
    "securityAuditPassed",
  ]) {
    requireObjectTrue(value, failures, `deployment.${key}`, key);
  }
}

function requireUat(report, failures) {
  const value = requireObject(report, failures, "uat");
  if (!value) return;

  requireSummaryObjectKeySet(value, goLiveUatKeys, failures, "uat");
  requireObjectTrue(value, failures, "uat.stagingUatPassed", "stagingUatPassed");
  requireObjectTrue(value, failures, "uat.productionSmokePassed", "productionSmokePassed");
  requireObjectIntegerAtLeast(value, failures, "uat.journeyScenarioCount", "journeyScenarioCount", 21);
  requireObjectTrue(value, failures, "uat.liveOnboardingPassed", "liveOnboardingPassed");
  requireObjectTrue(value, failures, "uat.liveExamCyclePassed", "liveExamCyclePassed");
  requireObjectTrue(value, failures, "uat.liveUiWorkerReportPassed", "liveUiWorkerReportPassed");
  requireObjectTrue(value, failures, "uat.roleReportsSigned", "roleReportsSigned");
}

function requirePilot(report, failures, linkedPilotEvidence) {
  const value = requireObject(report, failures, "pilot");
  if (!value) return;

  requireSummaryObjectKeySet(value, goLivePilotKeys, failures, "pilot");
  requireObjectTrue(value, failures, "pilot.pilotEvidencePassed", "pilotEvidencePassed");
  requireObjectIntegerAtLeast(value, failures, "pilot.pilotDurationDays", "pilotDurationDays", 14);
  requireObjectNumberAtMost(value, failures, "pilot.criticalDefectsOpen", "criticalDefectsOpen", 0);
  requireObjectEqual(value, failures, "pilot.goLiveDecision", "goLiveDecision", "APPROVED");
  requireObjectString(value, failures, "pilot.pilotEvidenceReference", "pilotEvidenceReference");
  requireNonPlaceholderString(value, failures, "pilot.pilotEvidenceReference", "pilotEvidenceReference");

  if (!linkedPilotEvidence) {
    failures.push("pilot.pilotEvidenceReference okunabilir pilot evidence JSON'una baglanmali.");
    return;
  }

  validateLinkedPilotEvidence(linkedPilotEvidence, failures, value, report);
}

function validateLinkedPilotEvidence(report, failures, pilotSummary, goLiveReport) {
  requireObjectEqual(report, failures, "pilotEvidence.result", "result", "PASS");
  requireObjectEqual(report, failures, "pilotEvidence.environment", "environment", "production");
  requireObjectDate(report, failures, "pilotEvidence.checkedAt", "checkedAt");
  requireDateNotInFuture(report, failures, "pilotEvidence.checkedAt", "checkedAt");
  requireDateNotAfter(report, failures, "pilotEvidence.checkedAt", "checkedAt", goLiveReport, "checkedAt", "checkedAt");
  requireObjectString(report, failures, "pilotEvidence.pilotTenantReference", "pilotTenantReference");
  requireNonPlaceholderString(report, failures, "pilotEvidence.pilotTenantReference", "pilotTenantReference");
  requireObjectDate(report, failures, "pilotEvidence.pilotStartDate", "pilotStartDate");
  requireObjectDate(report, failures, "pilotEvidence.pilotEndDate", "pilotEndDate");
  requireDateNotInFuture(report, failures, "pilotEvidence.pilotEndDate", "pilotEndDate");
  requireDateNotAfter(report, failures, "pilotEvidence.pilotEndDate", "pilotEndDate", report, "pilotEvidence.checkedAt", "checkedAt");
  requireObjectTrue(report, failures, "pilotEvidence.dataProcessingAgreementSigned", "dataProcessingAgreementSigned");
  requireObjectTrue(report, failures, "pilotEvidence.kvkkNoticeApproved", "kvkkNoticeApproved");
  requireObjectTrue(report, failures, "pilotEvidence.phase0And5GatesPassed", "phase0And5GatesPassed");
  requirePilotEvidenceDuration(report, failures, pilotSummary);
  requireLinkedPilotRealDataImport(report, failures);
  requireLinkedPilotExamCycle(report, failures);
  requireLinkedPilotPerformance(report, failures);
  requireLinkedPilotOperations(report, failures);
  requireLinkedPilotAssessmentCriteria(report, failures);
  requireObjectNumberAtMost(report, failures, "pilotEvidence.criticalDefectsOpen", "criticalDefectsOpen", 0);
  requireObjectEqual(report, failures, "pilotEvidence.goLiveDecision", "goLiveDecision", "APPROVED");
  requireEvidenceReferences(report, failures, "pilotEvidence.evidenceReferences");
  requireEmptyArray(report, failures, "gaps", "pilotEvidence.gaps");
}

function requireLiveStatusEvidence(report, failures, linkedLiveStatusEvidence, productionEvidenceSummary, pilotEvidence) {
  const value = requireObject(report, failures, "liveStatusEvidence");
  if (!value) return;

  requireSummaryObjectKeySet(value, goLiveLiveStatusEvidenceKeys, failures, "liveStatusEvidence");
  requireObjectEqual(value, failures, "liveStatusEvidence.result", "result", "PASS");
  requireObjectString(value, failures, "liveStatusEvidence.evidenceTarget", "evidenceTarget");
  requireNonPlaceholderString(value, failures, "liveStatusEvidence.evidenceTarget", "evidenceTarget");
  requireObjectDate(value, failures, "liveStatusEvidence.generatedAt", "generatedAt");
  requireDateNotAfter(value, failures, "liveStatusEvidence.generatedAt", "generatedAt", report, "checkedAt", "checkedAt");
  requireObjectStringList(
    value,
    failures,
    "liveStatusEvidence.gatesPassed",
    "gatesPassed",
    liveStatusGates.length,
    true,
  );

  if (Array.isArray(value.gatesPassed)) {
    requireLiveStatusGateLabelSet(value.gatesPassed, failures, "liveStatusEvidence.gatesPassed");
    for (const gate of liveStatusGates) {
      if (!value.gatesPassed.includes(gate.label)) {
        failures.push(`liveStatusEvidence.gatesPassed eksik: ${gate.label}`);
      }
    }
  }

  if (!linkedLiveStatusEvidence) {
    failures.push("liveStatusEvidence.evidenceTarget okunabilir live status JSON'una baglanmali.");
    return;
  }

  validateLinkedLiveStatusEvidence(
    linkedLiveStatusEvidence.report,
    failures,
    value,
    report,
    linkedLiveStatusEvidence.url,
    productionEvidenceSummary,
    pilotEvidence,
  );
}

function validateLinkedLiveStatusEvidence(
  report,
  failures,
  declaredLiveStatus,
  goLiveReport,
  liveStatusUrl,
  productionEvidenceSummary,
  pilotEvidence,
) {
  requireSummaryObjectKeySet(report, linkedLiveStatusTopLevelKeys, failures, "liveStatusEvidence");
  requireObjectEqual(report, failures, "liveStatusEvidence.result", "result", "PASS");
  requireObjectEqual(report, failures, "liveStatusEvidence.environment", "environment", "production");
  requireObjectDate(report, failures, "liveStatusEvidence.generatedAt", "generatedAt");
  requireMatchingDate(
    declaredLiveStatus,
    failures,
    "liveStatusEvidence.generatedAt",
    "generatedAt",
    report,
    "liveStatusEvidence.generatedAt",
    "generatedAt",
  );
  requireDateNotAfter(report, failures, "liveStatusEvidence.generatedAt", "generatedAt", goLiveReport, "checkedAt", "checkedAt");
  requireObjectString(report, failures, "liveStatusEvidence.productionEvidenceSummaryTarget", "productionEvidenceSummaryTarget");
  requireNonPlaceholderString(report, failures, "liveStatusEvidence.productionEvidenceSummaryTarget", "productionEvidenceSummaryTarget");
  requireObjectString(report, failures, "liveStatusEvidence.goLiveEvidenceTarget", "goLiveEvidenceTarget");
  requireNonPlaceholderString(report, failures, "liveStatusEvidence.goLiveEvidenceTarget", "goLiveEvidenceTarget");
  requireObjectString(report, failures, "liveStatusEvidence.pilotEvidenceTarget", "pilotEvidenceTarget");
  requireNonPlaceholderString(report, failures, "liveStatusEvidence.pilotEvidenceTarget", "pilotEvidenceTarget");
  requireResolvedTargetMatch(
    report,
    failures,
    "liveStatusEvidence.productionEvidenceSummaryTarget",
    "productionEvidenceSummaryTarget",
    liveStatusUrl,
    goLiveReport.productionEvidenceSummary,
    "productionEvidenceSummary.summaryTarget",
    "summaryTarget",
    targetUrl,
  );
  requireResolvedTargetHref(
    report,
    failures,
    "liveStatusEvidence.goLiveEvidenceTarget",
    "goLiveEvidenceTarget",
    liveStatusUrl,
    targetUrl.href,
    "GO_LIVE_EVIDENCE_TARGET",
  );
  requireResolvedTargetMatch(
    report,
    failures,
    "liveStatusEvidence.pilotEvidenceTarget",
    "pilotEvidenceTarget",
    liveStatusUrl,
    goLiveReport.pilot,
    "pilot.pilotEvidenceReference",
    "pilotEvidenceReference",
    targetUrl,
  );

  if (!Array.isArray(report.gates)) {
    failures.push("liveStatusEvidence.gates listesi zorunlu.");
    return;
  }

  requireLiveStatusGateObjectSet(report.gates, failures, "liveStatusEvidence.gates");

  for (const item of report.gates) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failures.push("liveStatusEvidence.gates satiri nesne olmali.");
      continue;
    }
    requireSummaryObjectKeySet(
      item,
      linkedLiveStatusGateKeys,
      failures,
      `liveStatusEvidence.gates.${typeof item.label === "string" ? item.label : "unknown"}`,
    );
  }

  for (const gate of liveStatusGates) {
    const item = report.gates.find((candidate) => candidate?.label === gate.label);
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failures.push(`liveStatusEvidence.gates eksik: ${gate.label}`);
      continue;
    }
    requireObjectEqual(item, failures, `liveStatusEvidence.gates.${gate.label}.status`, "status", "PASS");
    requireObjectEqual(item, failures, `liveStatusEvidence.gates.${gate.label}.command`, "command", gate.command);
    requireObjectEqual(item, failures, `liveStatusEvidence.gates.${gate.label}.source`, "source", gate.source);
    requireObjectDate(item, failures, `liveStatusEvidence.gates.${gate.label}.checkedAt`, "checkedAt");
    requireDateNotAfter(
      item,
      failures,
      `liveStatusEvidence.gates.${gate.label}.checkedAt`,
      "checkedAt",
      report,
      "liveStatusEvidence.generatedAt",
      "generatedAt",
    );
    requireDateNotAfter(
      item,
      failures,
      `liveStatusEvidence.gates.${gate.label}.checkedAt`,
      "checkedAt",
      goLiveReport,
      "checkedAt",
      "checkedAt",
    );
    requireLiveStatusGateSourceDate(item, failures, gate, productionEvidenceSummary, pilotEvidence, goLiveReport);
    requireObjectString(item, failures, `liveStatusEvidence.gates.${gate.label}.evidenceReference`, "evidenceReference");
    requireNonPlaceholderString(
      item,
      failures,
      `liveStatusEvidence.gates.${gate.label}.evidenceReference`,
      "evidenceReference",
    );
    requireLiveStatusGateEvidenceReference(item, failures, gate, productionEvidenceSummary, pilotEvidence, goLiveReport, report);
  }
}

function requireLiveStatusGateSourceDate(item, failures, gate, productionEvidenceSummary, pilotEvidence, goLiveReport) {
  const sourceDocument =
    gate.target === "summary" ? productionEvidenceSummary : gate.target === "pilot" ? pilotEvidence : goLiveReport;
  const sourceScope = resolveObjectPath(sourceDocument, gate.path);
  if (!sourceScope || typeof sourceScope !== "object" || Array.isArray(sourceScope)) {
    failures.push(`liveStatusEvidence.gates.${gate.label}.source kaynak nesnesi okunamadi.`);
    return;
  }
  requireLiveStatusGateSourceStatus(sourceScope, failures, gate);

  requireMatchingDate(
    item,
    failures,
    `liveStatusEvidence.gates.${gate.label}.checkedAt`,
    "checkedAt",
    sourceScope,
    `${gate.source}.${gate.dateKey}`,
    gate.dateKey,
  );
}

function requireLiveStatusGateSourceStatus(sourceScope, failures, gate) {
  if (Object.prototype.hasOwnProperty.call(sourceScope, "result") && sourceScope.result !== "PASS") {
    failures.push(`liveStatusEvidence.gates.${gate.label}.source.result PASS olmali.`);
  }
  if (Object.prototype.hasOwnProperty.call(sourceScope, "environment") && sourceScope.environment !== "production") {
    failures.push(`liveStatusEvidence.gates.${gate.label}.source.environment production olmali.`);
  }
}

function requireLiveStatusGateEvidenceReference(
  item,
  failures,
  gate,
  productionEvidenceSummary,
  pilotEvidence,
  goLiveReport,
  liveStatusReport,
) {
  const sourceDocument =
    gate.target === "summary" ? productionEvidenceSummary : gate.target === "pilot" ? pilotEvidence : goLiveReport;
  const sourceScope = resolveObjectPath(sourceDocument, gate.path);
  if (!sourceScope || typeof sourceScope !== "object" || Array.isArray(sourceScope)) return;

  const expected = resolveLiveStatusGateEvidenceReference(sourceScope, gate, liveStatusReport);
  if (!expected) {
    failures.push(`liveStatusEvidence.gates.${gate.label}.evidenceReference kaynak referansı üretilemedi.`);
    return;
  }
  if (item.evidenceReference !== expected) {
    failures.push(`liveStatusEvidence.gates.${gate.label}.evidenceReference ${gate.source} kaynak referansı ile eslesmeli.`);
  }
}

function resolveLiveStatusGateEvidenceReference(sourceScope, gate, liveStatusReport) {
  const sourceTarget = resolveLiveStatusSourceTarget(gate, liveStatusReport);
  if (!sourceTarget) return undefined;

  if (!Array.isArray(gate.path) || gate.path.length === 0) {
    return sourceTarget;
  }
  if (typeof sourceScope.evidenceReference === "string" && sourceScope.evidenceReference.trim() !== "") {
    return sourceScope.evidenceReference;
  }
  if (Array.isArray(sourceScope.evidenceReferences)) {
    const first = sourceScope.evidenceReferences.find((item) => typeof item === "string" && item.trim() !== "");
    if (first) return first;
  }
  return `${sourceTarget}${jsonPointer(gate.path)}`;
}

function resolveLiveStatusSourceTarget(gate, liveStatusReport) {
  if (gate.target === "summary") return liveStatusReport.productionEvidenceSummaryTarget;
  if (gate.target === "pilot") return liveStatusReport.pilotEvidenceTarget;
  return liveStatusReport.goLiveEvidenceTarget;
}

function resolveObjectPath(value, path) {
  if (!Array.isArray(path) || path.length === 0) return value;
  return path.reduce((current, key) => current?.[key], value);
}

function jsonPointer(path) {
  if (!Array.isArray(path) || path.length === 0) return "";
  return `#/${path.map((item) => item.replaceAll("~", "~0").replaceAll("/", "~1")).join("/")}`;
}

function requireLiveStatusGateLabelSet(labels, failures, label) {
  const expectedLabels = new Set(liveStatusGates.map((gate) => gate.label));
  const seenLabels = new Set();

  if (labels.length !== liveStatusGates.length) {
    failures.push(`${label} tam ${liveStatusGates.length} gate içermeli.`);
  }

  for (const item of labels) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} bos olmayan metinlerden olusmali.`);
      continue;
    }
    if (!expectedLabels.has(item)) {
      failures.push(`${label} beklenmeyen gate iceriyor: ${item}`);
    }
    if (seenLabels.has(item)) {
      failures.push(`${label} tekrarlı gate iceriyor: ${item}`);
    }
    seenLabels.add(item);
  }
}

function requireLiveStatusGateObjectSet(gates, failures, label) {
  const labels = gates.map((gate) => gate?.label);
  requireLiveStatusGateLabelSet(labels, failures, label);
}

function requirePilotEvidenceDuration(report, failures, pilotSummary) {
  const start = Date.parse(report.pilotStartDate);
  const end = Date.parse(report.pilotEndDate);
  if (Number.isNaN(start) || Number.isNaN(end)) return;

  if (end < start) {
    failures.push("pilotEvidence pilot bitis tarihi baslangictan once olamaz.");
    return;
  }
  const durationDays = (end - start) / (24 * 60 * 60 * 1000);
  if (durationDays < 14) {
    failures.push("pilotEvidence pilot suresi en az 14 gun olmali.");
  }
  if (Number.isInteger(pilotSummary.pilotDurationDays) && durationDays < pilotSummary.pilotDurationDays) {
    failures.push("pilotEvidence pilot suresi go-live pilot.pilotDurationDays degerini desteklemeli.");
  }
}

function requireLinkedPilotRealDataImport(report, failures) {
  const value = requireNestedObject(report, failures, "pilotEvidence.realDataImport", "realDataImport");
  if (!value) return;

  requireObjectString(value, failures, "pilotEvidence.realDataImport.source", "source");
  requireObjectIntegerAtLeast(value, failures, "pilotEvidence.realDataImport.dryRunRows", "dryRunRows", 1);
  requireObjectIntegerAtLeast(value, failures, "pilotEvidence.realDataImport.committedRows", "committedRows", 1);
  requireObjectTrue(value, failures, "pilotEvidence.realDataImport.rollbackTested", "rollbackTested");
  requireObjectTrue(value, failures, "pilotEvidence.realDataImport.identityMigrationApproved", "identityMigrationApproved");
  requireObjectString(value, failures, "pilotEvidence.realDataImport.identityMigrationReference", "identityMigrationReference");
  requireNonPlaceholderString(
    value,
    failures,
    "pilotEvidence.realDataImport.identityMigrationReference",
    "identityMigrationReference",
  );
}

function requireLinkedPilotExamCycle(report, failures) {
  const value = requireNestedObject(report, failures, "pilotEvidence.examCycle", "examCycle");
  if (!value) return;

  requireObjectString(value, failures, "pilotEvidence.examCycle.examReference", "examReference");
  requireNonPlaceholderString(value, failures, "pilotEvidence.examCycle.examReference", "examReference");
  requireObjectIntegerAtLeast(value, failures, "pilotEvidence.examCycle.participantCount", "participantCount", 1);
  for (const key of [
    "answerKeyImported",
    "opticalImportCommitted",
    "quarantineResolved",
    "reportGenerated",
    "karnePdfDownloaded",
    "excelDownloaded",
    "guardianPortalViewed",
    "idempotencyVerified",
  ]) {
    requireObjectTrue(value, failures, `pilotEvidence.examCycle.${key}`, key);
  }
  requireObjectEvidenceReferences(value, failures, "pilotEvidence.examCycle.evidenceReferences", "evidenceReferences");
}

function requireLinkedPilotPerformance(report, failures) {
  const value = requireNestedObject(report, failures, "pilotEvidence.performance", "performance");
  if (!value) return;

  requireObjectIntegerAtLeast(value, failures, "pilotEvidence.performance.reportListingExpectedResultCount", "reportListingExpectedResultCount", 10000);
  requireObjectNumberAtMost(value, failures, "pilotEvidence.performance.reportListingP95Ms", "reportListingP95Ms", 1500);
  requireObjectNumberAtMost(value, failures, "pilotEvidence.performance.studentProgressP95Ms", "studentProgressP95Ms", 1200);
  requireObjectNumberAtLeast(value, failures, "pilotEvidence.performance.rlsLoadRps", "rlsLoadRps", 200);
  requireObjectIntegerAtLeast(value, failures, "pilotEvidence.performance.reportGenerationResultCount", "reportGenerationResultCount", 10000);
  requireObjectNumberAtMost(value, failures, "pilotEvidence.performance.reportGenerationDurationMs", "reportGenerationDurationMs", 60000);
  requireObjectTrue(value, failures, "pilotEvidence.performance.thresholdsPassed", "thresholdsPassed");
}

function requireLinkedPilotOperations(report, failures) {
  const value = requireNestedObject(report, failures, "pilotEvidence.operations", "operations");
  if (!value) return;

  for (const key of [
    "incidentDrillPerformed",
    "alertDelivered",
    "sentryEventReviewed",
    "supportTicketExercised",
    "restoreDrillRepeated",
  ]) {
    requireObjectTrue(value, failures, `pilotEvidence.operations.${key}`, key);
  }
  requireObjectString(value, failures, "pilotEvidence.operations.restoreDrillReference", "restoreDrillReference");
  requireNonPlaceholderString(value, failures, "pilotEvidence.operations.restoreDrillReference", "restoreDrillReference");
  requireObjectNumberAtMost(value, failures, "pilotEvidence.operations.incidentResponseMinutes", "incidentResponseMinutes", 30);
}

function requireLinkedPilotAssessmentCriteria(report, failures) {
  const value = report.assessmentCriteria;
  if (!Array.isArray(value)) {
    failures.push("pilotEvidence.assessmentCriteria listesi zorunlu.");
    return;
  }
  if (value.length !== 10) {
    failures.push("pilotEvidence.assessmentCriteria tam 10 madde icermeli.");
  }

  for (const expectedId of ["AC-01", "AC-02", "AC-03", "AC-04", "AC-05", "AC-06", "AC-07", "AC-08", "AC-09", "AC-10"]) {
    const item = value.find((candidate) => candidate?.id === expectedId);
    if (!item) {
      failures.push(`pilotEvidence.assessmentCriteria eksik: ${expectedId}`);
      continue;
    }
    requireObjectEqual(item, failures, `pilotEvidence.assessmentCriteria.${expectedId}.status`, "status", "PASS");
    requireObjectString(item, failures, `pilotEvidence.assessmentCriteria.${expectedId}.evidence`, "evidence");
    requireNonPlaceholderString(item, failures, `pilotEvidence.assessmentCriteria.${expectedId}.evidence`, "evidence");
  }
}

function requireLegal(report, failures) {
  const value = requireObject(report, failures, "legal");
  if (!value) return;

  requireSummaryObjectKeySet(value, goLiveLegalKeys, failures, "legal");
  for (const key of [
    "dataProcessingAgreementSigned",
    "kvkkNoticeApproved",
    "privacyInventoryPassed",
    "financialRetentionPassed",
    "inlineUploadMigrationPassed",
    "auditNullTenantPassed",
  ]) {
    requireObjectTrue(value, failures, `legal.${key}`, key);
  }
}

function requireOperations(report, failures) {
  const value = requireObject(report, failures, "operations");
  if (!value) return;

  requireSummaryObjectKeySet(value, goLiveOperationsKeys, failures, "operations");
  for (const key of [
    "incidentRunbookAcknowledged",
    "supportChannelReady",
    "alertChannelReady",
    "backupRestoreOwnerAssigned",
    "rollbackOwnerAssigned",
    "monitoringOwnerAssigned",
  ]) {
    requireObjectTrue(value, failures, `operations.${key}`, key);
  }
  requireObjectString(value, failures, "operations.onCallPrimary", "onCallPrimary");
  requireNonPlaceholderString(value, failures, "operations.onCallPrimary", "onCallPrimary");
  requireObjectString(value, failures, "operations.supportChannelReference", "supportChannelReference");
  requireNonPlaceholderString(value, failures, "operations.supportChannelReference", "supportChannelReference");
}

function requireCutover(report, failures) {
  const value = requireObject(report, failures, "cutover");
  if (!value) return;

  requireSummaryObjectKeySet(value, goLiveCutoverKeys, failures, "cutover");
  requireObjectDate(value, failures, "cutover.scheduledAt", "scheduledAt");
  requireDateNotAfter(report, failures, "checkedAt", "checkedAt", value, "cutover.scheduledAt", "scheduledAt");
  requireObjectIntegerAtLeast(value, failures, "cutover.rollbackWindowMinutes", "rollbackWindowMinutes", 30);
  requireObjectIntegerAtLeast(value, failures, "cutover.monitoringWindowHours", "monitoringWindowHours", 24);
  requireObjectTrue(value, failures, "cutover.statusPageReady", "statusPageReady");
  requireObjectTrue(value, failures, "cutover.customerCommunicationReady", "customerCommunicationReady");
}

function requireApprovals(report, failures) {
  const value = report.approvals;
  if (!Array.isArray(value)) {
    failures.push("approvals listesi zorunlu.");
    return;
  }

  requireApprovalRoleSet(value, failures, "approvals");

  for (const role of requiredApprovals) {
    const approval = value.find((item) => item?.role === role);
    if (!approval) {
      failures.push(`approvals eksik rol: ${role}`);
      continue;
    }
    requireSummaryObjectKeySet(approval, goLiveApprovalKeys, failures, `approvals.${role}`);
    requireObjectEqual(approval, failures, `${role}.decision`, "decision", "APPROVED");
    requireObjectString(approval, failures, `${role}.approver`, "approver");
    requireNonPlaceholderString(approval, failures, `${role}.approver`, "approver");
    requireObjectDate(approval, failures, `${role}.approvedAt`, "approvedAt");
    requireDateNotInFuture(approval, failures, `${role}.approvedAt`, "approvedAt");
    requireDateNotAfter(approval, failures, `${role}.approvedAt`, "approvedAt", report, "checkedAt", "checkedAt");
  }
}

function requireOpenRisks(report, failures) {
  const value = report.openRisks;
  if (!Array.isArray(value)) {
    failures.push("openRisks listesi zorunlu.");
    return;
  }

  for (const risk of value) {
    if (!risk || typeof risk !== "object" || Array.isArray(risk)) {
      failures.push("openRisks nesnelerden olusmali.");
      return;
    }
    requireSummaryObjectKeySet(risk, goLiveOpenRiskKeys, failures, `openRisks.${typeof risk.id === "string" ? risk.id : "unknown"}`);
    requireObjectString(risk, failures, "openRisks.id", "id");
    requireObjectString(risk, failures, "openRisks.owner", "owner");
    requireNonPlaceholderString(risk, failures, "openRisks.owner", "owner");
    requireObjectString(risk, failures, "openRisks.mitigation", "mitigation");
    if (!["LOW", "MEDIUM"].includes(risk.severity)) {
      failures.push(`${risk.id ?? "openRisks"}.severity yalniz LOW veya MEDIUM olabilir.`);
    }
    if (risk.accepted !== true) {
      failures.push(`${risk.id ?? "openRisks"}.accepted true olmali.`);
    }
  }
}

function requireApprovalRoleSet(approvals, failures, label) {
  const expectedRoles = new Set(requiredApprovals);
  const seenRoles = new Set();

  if (approvals.length !== requiredApprovals.length) {
    failures.push(`${label} tam ${requiredApprovals.length} onay icermeli.`);
  }

  for (const approval of approvals) {
    const role = approval?.role;
    if (typeof role !== "string" || role.trim() === "") {
      failures.push(`${label}.role bos olmayan metin olmali.`);
      continue;
    }
    if (!expectedRoles.has(role)) {
      failures.push(`${label} beklenmeyen rol iceriyor: ${role}`);
    }
    if (seenRoles.has(role)) {
      failures.push(`${label} tekrarlı rol iceriyor: ${role}`);
    }
    seenRoles.add(role);
  }
}

function requireEqual(report, failures, key, expected) {
  if (report[key] !== expected) {
    failures.push(`${key} ${expected} olmali.`);
  }
}

function requireDate(report, failures, key) {
  const value = report[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${key} gecerli tarih olmali.`);
  }
}

function requireDateNotInFuture(report, failures, label, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) {
    return;
  }

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${label} gelecekte olamaz.`);
  }
}

function requireDateNotAfter(report, failures, firstLabel, firstKey, secondReport, secondLabel, secondKey) {
  const first = Date.parse(report[firstKey]);
  const second = Date.parse(secondReport[secondKey]);
  if (Number.isNaN(first) || Number.isNaN(second)) return;
  if (first > second) {
    failures.push(`${firstLabel} ${secondLabel} tarihinden sonra olamaz.`);
  }
}

function requireDateOrder(report, failures, firstLabel, firstKey, secondLabel, secondKey) {
  const first = Date.parse(report[firstKey]);
  const second = Date.parse(report[secondKey]);
  if (Number.isNaN(first) || Number.isNaN(second)) return;
  if (first > second) {
    failures.push(`${firstLabel} ${secondLabel} sonrasinda olamaz.`);
  }
}

function requireMatchingDate(firstReport, failures, firstLabel, firstKey, secondReport, secondLabel, secondKey) {
  const first = Date.parse(firstReport[firstKey]);
  const second = Date.parse(secondReport[secondKey]);
  if (Number.isNaN(first) || Number.isNaN(second)) return;
  if (first !== second) {
    failures.push(`${firstLabel} ${secondLabel} ile eslesmeli.`);
  }
}

function requireMatchingString(firstReport, failures, firstLabel, firstKey, secondReport, secondLabel, secondKey) {
  const first = firstReport[firstKey];
  const second = secondReport[secondKey];
  if (typeof first !== "string" || typeof second !== "string") return;
  if (first !== second) {
    failures.push(`${firstLabel} ${secondLabel} ile eslesmeli.`);
  }
}

function requireMatchingUrlOrigin(firstReport, failures, firstLabel, firstKey, secondReport, secondLabel, secondKey) {
  const first = firstReport[firstKey];
  const second = secondReport[secondKey];
  if (typeof first !== "string" || typeof second !== "string") return;

  try {
    if (new URL(first).origin !== new URL(second).origin) {
      failures.push(`${firstLabel} ${secondLabel} origin'i ile eslesmeli.`);
    }
  } catch {
    // URL format errors are reported by the field-specific URL validators.
  }
}

function requireLatencyMatches(report, failures, label, key, startKey, endKey) {
  const start = Date.parse(report[startKey]);
  const end = Date.parse(report[endKey]);
  const value = report[key];
  if (Number.isNaN(start) || Number.isNaN(end) || !Number.isInteger(value)) return;

  const seconds = Math.round((end - start) / 1000);
  if (value !== seconds) {
    failures.push(`${label} ${startKey}/${endKey} farkiyla eslesmeli.`);
  }
}

function requireResolvedTargetMatch(
  firstReport,
  failures,
  firstLabel,
  firstKey,
  firstBaseUrl,
  secondReport,
  secondLabel,
  secondKey,
  secondBaseUrl,
) {
  const first = resolveTargetHref(firstReport?.[firstKey], firstBaseUrl, failures, firstLabel);
  const second = resolveTargetHref(secondReport?.[secondKey], secondBaseUrl, failures, secondLabel);
  if (!first || !second) return;
  if (first !== second) {
    failures.push(`${firstLabel} ${secondLabel} ile ayni artifact hedefine baglanmali.`);
  }
}

function requireResolvedTargetHref(report, failures, label, key, baseUrl, expectedHref, expectedLabel) {
  const resolved = resolveTargetHref(report?.[key], baseUrl, failures, label);
  if (!resolved) return;
  if (resolved !== expectedHref) {
    failures.push(`${label} ${expectedLabel} ile ayni artifact hedefine baglanmali.`);
  }
}

function resolveTargetHref(value, baseUrl, failures, label) {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  try {
    const url = new URL(value, baseUrl);
    if (!isAllowedEvidenceTargetUrl(url)) {
      failures.push(`${label} file:// veya https:// URL olmali.`);
      return undefined;
    }
    if (hasSecretBearingUrlParts(url)) {
      failures.push(`${label} target URL userinfo, query veya fragment iceremez.`);
      return undefined;
    }
    if (url.protocol === "file:" && isLocalSmokeEvidenceTargetUrl(url)) {
      failures.push(`${label} artifacts/local altinda olmamali.`);
      return undefined;
    }
    return url.href;
  } catch {
    failures.push(`${label} file:// veya https:// URL olmali.`);
    return undefined;
  }
}

function isAllowedEvidenceTargetUrl(url) {
  return (
    (url.protocol === "file:" && !isLocalTempEvidenceTargetUrl(url)) ||
    (url.protocol === "https:" && !isPlaceholderEvidenceTargetHost(url.hostname))
  );
}

function hasSecretBearingUrlParts(url) {
  return url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "";
}

function isPlaceholderEvidenceTargetHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".test") ||
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized.includes("example") ||
    normalized.includes("__set") ||
    normalized.includes("placeholder")
  );
}

function isLocalTempEvidenceTargetUrl(url) {
  const path = fileURLToPath(url).replace(/\/+$/g, "") || "/";
  return (
    path === "/tmp" ||
    path.startsWith("/tmp/") ||
    path === "/var/tmp" ||
    path.startsWith("/var/tmp/") ||
    path === "/private/tmp" ||
    path.startsWith("/private/tmp/")
  );
}

function isLocalSmokeEvidenceTargetUrl(url) {
  const path = fileURLToPath(url).replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return path.endsWith("/artifacts/local") || path.includes("/artifacts/local/");
}

function requireString(report, failures, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${key} bos olmayan metin olmali.`);
  }
}

function requireHttpsUrl(report, failures, label, key) {
  const value = report[key];
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || isPlaceholderHost(url.hostname)) {
      failures.push(`${label} production icin https ve gercek host olmali.`);
    }
  } catch {
    failures.push(`${label} gecerli URL olmali.`);
  }
}

function requireSmokeCheck(report, failures, key, expectedCheck, summary, goLiveReport) {
  const label = `productionEvidenceSummary.summary.smokeEvidence.${key}`;
  const item = report[key];
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return undefined;
  }
  requireObjectEqual(item, failures, `${label}.result`, "result", "PASS");
  requireObjectEqual(item, failures, `${label}.check`, "check", expectedCheck);
  requireObjectEqual(item, failures, `${label}.environment`, "environment", "production");
  requireObjectDate(item, failures, `${label}.generatedAt`, "generatedAt");
  requireDateNotInFuture(item, failures, `${label}.generatedAt`, "generatedAt");
  requireDateNotAfter(item, failures, `${label}.generatedAt`, "generatedAt", summary, "productionEvidenceSummary.summary.generatedAt", "generatedAt");
  requireDateNotAfter(item, failures, `${label}.generatedAt`, "generatedAt", goLiveReport, "checkedAt", "checkedAt");
  return item;
}

function requireObjectStatus2xx(report, failures, label, key) {
  const value = report[key];
  if (!Number.isInteger(value) || value < 200 || value > 299) {
    failures.push(`${label} 2xx HTTP durum kodu olmali.`);
  }
}

function requireObjectSha256(report, failures, label, key) {
  const value = report[key];
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/i.test(value)) {
    failures.push(`${label} 64 karakter hex sha256 olmali.`);
  }
}

function requireSmokeTargetSummary(report, failures, label) {
  const target = requireNestedObject(report, failures, label, "target");
  if (!target) return;

  if (!["s3", "file"].includes(target.protocol)) {
    failures.push(`${label}.protocol s3 veya file olmali.`);
    return;
  }

  if (target.protocol === "s3") {
    requireObjectString(target, failures, `${label}.bucket`, "bucket");
    requireNonPlaceholderString(target, failures, `${label}.bucket`, "bucket");
    if ("prefix" in target && typeof target.prefix !== "string") {
      failures.push(`${label}.prefix metin olmali.`);
    }
    if (typeof target.prefix === "string" && target.prefix.trim() !== "") {
      requireNonPlaceholderString(target, failures, `${label}.prefix`, "prefix");
    }
    return;
  }

  if (target.pathRedacted !== true) {
    failures.push(`${label}.pathRedacted true olmali.`);
  }
}

function requireNonPlaceholderString(report, failures, label, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  if (typeof value !== "string" || value.trim() === "") {
    return;
  }

  if (hasPlaceholderToken(value)) {
    failures.push(`${label} production icin ornek/placeholder/redacted deger olmamali.`);
  }
}

function isPlaceholderHost(hostname) {
  if (allowExampleEvidence) return false;

  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".test") ||
    normalized === "example.com" ||
    normalized.endsWith(".example.com") ||
    normalized.includes("example") ||
    normalized.includes("__set")
  );
}

function requireObject(report, failures, key) {
  const value = report[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${key} nesnesi zorunlu.`);
    return undefined;
  }
  return value;
}

function requireNestedObject(report, failures, label, key) {
  const value = report[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return undefined;
  }
  return value;
}

function requireObjectEqual(report, failures, label, key, expected) {
  if (report[key] !== expected) {
    failures.push(`${label} ${expected} olmali.`);
  }
}

function requireObjectDate(report, failures, label, key) {
  const value = report[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${label} gecerli tarih olmali.`);
  }
}

function requireObjectString(report, failures, label, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${label} bos olmayan metin olmali.`);
  }
}

function requireObjectTrue(report, failures, label, key) {
  if (report[key] !== true) {
    failures.push(`${label} true olmali.`);
  }
}

function requireObjectOneOf(report, failures, label, key, allowedValues) {
  if (!allowedValues.includes(report[key])) {
    failures.push(`${label} ${allowedValues.join(" veya ")} olmali.`);
  }
}

function requireObjectIntegerAtLeast(report, failures, label, key, minValue) {
  const value = report[key];
  if (!Number.isInteger(value) || value < minValue) {
    failures.push(`${label} en az ${minValue} tam sayi olmali.`);
  }
}

function requireObjectNumberAtMost(report, failures, label, key, maxValue) {
  const value = report[key];
  if (typeof value !== "number" || value > maxValue) {
    failures.push(`${label} en fazla ${maxValue} sayi olmali.`);
  }
}

function requireObjectNumberAtLeast(report, failures, label, key, minValue) {
  const value = report[key];
  if (typeof value !== "number" || value < minValue) {
    failures.push(`${label} en az ${minValue} sayi olmali.`);
  }
}

function requireObjectArrayAtLeast(report, failures, label, key, minLength) {
  const value = report[key];
  if (!Array.isArray(value) || value.length < minLength) {
    failures.push(`${label} en az ${minLength} maddelik liste olmali.`);
  }
}

function requireExactStringSet(value, failures, label, expected) {
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }

  if (value.length !== expected.length) {
    failures.push(`${label} tam ${expected.length} madde icermeli.`);
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} bos olmayan metinlerden olusmali.`);
      continue;
    }
    if (!expected.includes(item)) {
      failures.push(`${label} beklenmeyen madde iceriyor: ${item}`);
    }
  }

  for (const expectedItem of expected) {
    if (!value.includes(expectedItem)) {
      failures.push(`${label} eksik: ${expectedItem}`);
    }
  }
}

function requireObjectStringList(report, failures, label, key, minLength, rejectPlaceholders) {
  const value = report[key];
  if (!Array.isArray(value) || value.length < minLength) {
    failures.push(`${label} en az ${minLength} maddelik liste olmali.`);
    return;
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} bos olmayan metinlerden olusmali.`);
      return;
    }
    if (rejectPlaceholders && !allowExampleEvidence && hasPlaceholderToken(item)) {
      failures.push(`${label} production icin ornek/placeholder/redacted deger icermemeli.`);
      return;
    }
    if (rejectPlaceholders && !allowExampleEvidence && hasRawRecipientToken(item)) {
      failures.push(`${label} ham e-posta/telefon/push endpoint icermemeli.`);
      return;
    }
  }
}

function requireMaskedRecipientString(value, failures, label) {
  if (typeof value !== "string" || value.trim() === "") return;
  if (!value.includes("*")) {
    failures.push(`${label} maskeli recipient olmali.`);
  }
  if (!allowExampleEvidence && hasRawRecipientToken(value)) {
    failures.push(`${label} ham e-posta/telefon/push endpoint icermemeli.`);
  }
}

function hasRawRecipientToken(value) {
  return (
    value.includes("@") ||
    /[^\s@]+@[^\s@]+\.[^\s@]+/.test(value) ||
    /(?:\+?90[\s-]?)?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/.test(value) ||
    /https?:\/\//i.test(value)
  );
}

function requireEmptyArray(report, failures, key, label = key) {
  const value = report?.[key];
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }

  if (value.length > 0) {
    failures.push(`${label} bos olmali.`);
  }
}

function requireObjectEvidenceReferences(report, failures, label, key) {
  const value = report[key];
  if (!Array.isArray(value) || value.length === 0) {
    failures.push(`${label} bos olmayan liste olmali.`);
    return;
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} bos olmayan metinlerden olusmali.`);
      return;
    }
    if (!allowExampleEvidence && hasPlaceholderToken(item)) {
      failures.push(`${label} production icin ornek/placeholder/redacted deger icermemeli.`);
      return;
    }
  }
}

function requireEvidenceReferences(report, failures, label) {
  const value = report.evidenceReferences;
  if (!Array.isArray(value) || value.length === 0) {
    failures.push(`${label} bos olmayan liste olmali.`);
    return;
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} bos olmayan metinlerden olusmali.`);
      return;
    }
    if (!allowExampleEvidence && hasPlaceholderToken(item)) {
      failures.push(`${label} production icin ornek/placeholder/redacted deger icermemeli.`);
      return;
    }
  }
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return [
    "__set",
    "change-me",
    "replace-me",
    "placeholder",
    "redacted",
    "example",
    ".test",
    ".invalid",
    "test-token",
    "test-message-id",
    "dummy",
    "fake",
    "sms-provider-message",
    "localhost",
    "127.0.0.1",
  ].some((token) => normalized.includes(token));
}

function requireRlsEvidenceReferences(references, failures, label) {
  if (!Array.isArray(references) || references.length === 0) {
    failures.push(`${label} bos olmayan liste olmali.`);
    return;
  }

  for (const [index, reference] of references.entries()) {
    if (typeof reference !== "string" || reference.trim() === "") {
      failures.push(`${label}.${index} bos olmayan metin olmali.`);
      continue;
    }
    if (!hasAllowedEvidenceReferencePrefix(reference)) {
      failures.push(
        `${label}.${index} artifact:, run:, log:, url:, https://, file://, s3:// veya artifacts/ ile baslayan kalici referans olmali.`,
      );
    }
    if (isLocalSmokeEvidenceReference(reference)) {
      failures.push(`${label}.${index} local smoke artifact referansi tasimamali.`);
    }
  }

  for (const fileName of expectedRlsEvidenceReferenceFileNames) {
    if (!references.some((reference) => hasEvidenceReferenceFileName(reference, fileName))) {
      failures.push(`${label} ${fileName} kanıt artifact'ini içermeli.`);
    }
  }
}

function isLocalSmokeEvidenceReference(value) {
  return typeof value === "string" && value.replaceAll("\\", "/").includes("artifacts/local/");
}

function hasAllowedEvidenceReferencePrefix(value) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith("artifact:") ||
    normalized.startsWith("run:") ||
    normalized.startsWith("log:") ||
    normalized.startsWith("url:") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("file://") ||
    normalized.startsWith("s3://") ||
    normalized.startsWith("artifacts/")
  );
}

function hasEvidenceReferenceFileName(value, fileName) {
  if (typeof value !== "string") return false;
  const normalized = value.split(/[?#]/)[0].replaceAll("\\", "/").replace(/\/+$/g, "");
  return normalized.endsWith(`/${fileName}`) || normalized === fileName;
}

function fail(failures) {
  console.error("Go-live kanit kontrolu basarisiz:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
