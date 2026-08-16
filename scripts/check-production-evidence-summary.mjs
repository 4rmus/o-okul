import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getTenantScopedTables } from "../packages/db/scripts/tenant-models.mjs";
import { validateSmokeEvidencePayload } from "./smoke-evidence.mjs";
import { validateDeploymentRollbackReport } from "./check-deployment-rollback-evidence.mjs";
import { ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST } from "./isem-optical-pipeline-contract.mjs";
import { validateUiUxRedesignBindings } from "./ui-ux-redesign-evidence-bindings.mjs";

const target = process.env.PRODUCTION_EVIDENCE_SUMMARY_TARGET ?? process.argv[2];
const allowExampleEvidence = process.env.PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE === "1";
const allowStagingUiUx = process.env.PRODUCTION_EVIDENCE_ALLOW_STAGING_UI_UX === "1";
const allowStagingOutbox = process.env.PRODUCTION_EVIDENCE_ALLOW_STAGING_OUTBOX === "1";
const trustedUiUxEvidenceHosts = (process.env.UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim())
  .filter(Boolean);

const requiredSummaryKeys = ["result", "canPromote", "generatedAt", "nodeEnv", "appUrl", "apiUrl", "webUrl", "checks", "smokeEvidence", "reports"];
const requiredCheckItemKeys = ["label", "script", "status"];
const expectedTenantTables = getTenantScopedTables();

const requiredChecks = new Map([
  ["Production env", "scripts/check-prod-env.mjs"],
  ["Traefik HTTPS", "scripts/smoke-traefik-https.mjs"],
  ["SMS disabled path", "scripts/smoke-sms-provider.mjs"],
  ["Notification provider", "scripts/smoke-notification-provider.mjs"],
  ["Sentry test event", "scripts/smoke-sentry-event.mjs"],
  ["Alert webhook", "scripts/smoke-alert-webhook.mjs"],
  ["WAL archive target", "scripts/smoke-wal-archive-target.mjs"],
  ["Report generation smoke", "scripts/smoke-report-generation-live.mjs"],
  ["Secret delivery outbox evidence", "scripts/check-secret-delivery-outbox-evidence.mjs"],
  ["Deployment rollback evidence", "scripts/check-deployment-rollback-evidence.mjs"],
  ["GitHub CI evidence", "scripts/check-github-ci-evidence.mjs"],
  ["Restore drill evidence", "scripts/check-restore-drill-evidence.mjs"],
  ["KVKK inventory evidence", "scripts/check-kvkk-inventory-evidence.mjs"],
  ["Identity migration evidence", "scripts/check-identity-migration-evidence.mjs"],
  ["Financial retention evidence", "scripts/check-financial-retention-evidence.mjs"],
  ["Upload AV evidence", "scripts/check-upload-av-evidence.mjs"],
  ["Observability UAT evidence", "scripts/check-observability-uat-evidence.mjs"],
  ["Admin MFA evidence", "scripts/check-admin-mfa-evidence.mjs"],
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

const requiredSmokeEvidence = new Map([
  ["traefikHttps", "traefik_https_smoke"],
  ["smsProvider", "sms_provider_smoke"],
  ["notificationProvider", "notification_provider_smoke"],
  ["sentryEvent", "sentry_smoke"],
  ["alertWebhook", "alert_webhook_smoke"],
  ["walArchive", "wal_archive_smoke"],
  ["reportGeneration", "report_generation_smoke"],
  ["secretDeliveryOutbox", "secret_delivery_outbox_staging_smoke"],
]);

const requiredReports = {
  restoreDrill: ["environment", "drillDate", "sourceBackup", "targetDatabase", "tableCounts"],
  deploymentRollback: [
    "schemaVersion",
    "environment",
    "checkedAt",
    "releaseCandidate",
    "rollbackImageTag",
    "drill",
    "migrationRollbackSafe",
    "commandsPassed",
    "servicesVerified",
    "approval",
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
    "whatsappConsent",
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
    "alertDelivery",
    "evidenceReferences",
  ],
  adminMfa: ["environment", "checkedAt", "policy", "enrollment", "loginVerification", "commandsPassed", "evidenceReferences"],
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
    "fixtureId",
    "checkedAt",
    "parserConfigVersion",
    "answerKeyVersion",
    "answerKeyQuestionCount",
    "bookletVariantCount",
    "counts",
    "pipeline",
    "quarantineProbe",
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
    "sessionLogoutVerified",
    "commandsPassed",
    "gaps",
  ],
  uiUxRedesign: [
    "schemaVersion",
    "result",
    "environment",
    "checkedAt",
    "releaseCandidate",
    "sourceCommitSha",
    "githubCi",
    "allowedEvidenceHosts",
    "redesignPlanPath",
    "localStaticEvidence",
    "stagingProductionEvidence",
    "phaseEvidence",
    "viewportCoverage",
    "artifacts",
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
const expectedUatJourneyScenarios = [
  ["UAT-SYS-01", "SYSTEM_ADMIN"],
  ["UAT-SYS-02", "SYSTEM_ADMIN"],
  ["UAT-SYS-03", "SYSTEM_ADMIN"],
  ["UAT-SYS-04", "SYSTEM_ADMIN"],
  ["UAT-KURUM-01", "TENANT_ADMIN"],
  ["UAT-KURUM-02", "TENANT_ADMIN"],
  ["UAT-KURUM-03", "TENANT_ADMIN"],
  ["UAT-KURUM-04", "TENANT_ADMIN"],
  ["UAT-KURUM-05", "TENANT_ADMIN"],
  ["UAT-KURUM-06", "TENANT_ADMIN"],
  ["UAT-KURUM-07", "TENANT_ADMIN"],
  ["UAT-KURUM-08", "TENANT_ADMIN"],
  ["UAT-TEACHER-01", "TEACHER"],
  ["UAT-TEACHER-02", "TEACHER"],
  ["UAT-TEACHER-03", "TEACHER"],
  ["UAT-STUDENT-01", "STUDENT"],
  ["UAT-STUDENT-02", "STUDENT"],
  ["UAT-STUDENT-03", "STUDENT"],
  ["UAT-GUARDIAN-01", "GUARDIAN"],
  ["UAT-GUARDIAN-02", "GUARDIAN"],
  ["UAT-GUARDIAN-03", "GUARDIAN"],
];
const expectedUatCommandsPassed = [
  "pnpm run ci",
  "pnpm prod:env:check",
  "pnpm db:rls:check:live",
  "pnpm raw-import:smoke",
  "pnpm report-generation:smoke",
  "pnpm live:exam-cycle:check",
  "pnpm queue:smoke",
  "pnpm live:onboarding:smoke",
  "pnpm live:ui-worker:smoke",
  "pnpm sms:smoke",
  "pnpm notification:smoke",
  "pnpm traefik:https:smoke",
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
  "kvkk.student_contact_pii_purged",
  "kvkk.teacher_pii_purged",
  "kvkk.guardian_pii_purged",
  "kvkk.user_pii_purged",
];
const expectedWhatsappConsentStoredFields = [
  "phoneHash",
  "purpose",
  "canReceiveWhatsapp",
  "version",
  "noticeVersion",
  "source",
  "recordedAt",
  "withdrawnAt",
];
const expectedWhatsappConsentEventStoredFields = [
  "whatsappConsentId",
  "studentContactId",
  "purpose",
  "sequence",
  "eventType",
  "noticeVersion",
  "source",
  "recordedAt",
  "commandKeyHash",
  "requestHash",
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
  "MembershipCampusScope.membership",
  "MembershipCampusScope.campus",
  "LicenseUsage.licenseTerm",
  "Employee.accountUser",
  "Teacher.employee",
  "StudentContact.student",
  "WhatsAppConsentEvent.whatsappConsent",
  "WhatsAppConsentEvent.studentContact",
];
const expectedTenantFkInsertRejects = expectedTenantCompositeRelations.map((relation) => `${relation} cross tenant insert`);
const expectedRlsWriteRejects = [
  "Student wrong tenant insert",
  "Homework wrong tenant insert",
  "Announcement wrong tenant insert",
  "MessageTemplate wrong tenant insert",
  "WhatsAppConsent wrong tenant insert",
  "WhatsAppConsentEvent cross tenant contact",
  "WhatsAppConsentEvent update forbidden",
  "WhatsAppConsentEvent delete forbidden",
  "WhatsAppConsent direct update forbidden",
  "WhatsAppConsent direct delete forbidden",
  "WhatsAppConsent grant withdraw regrant",
  "WhatsAppConsent sibling withdrawal",
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
if (!target) {
  fail(["PRODUCTION_EVIDENCE_SUMMARY_TARGET veya dosya argümanı boş bırakılamaz."]);
}

let targetUrl;
try {
  targetUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? new URL(target) : pathToFileURL(target);
} catch {
  fail(["PRODUCTION_EVIDENCE_SUMMARY_TARGET file:// veya https:// URL olmalı."]);
}

if (!isAllowedEvidenceTargetUrl(targetUrl)) {
  fail(["PRODUCTION_EVIDENCE_SUMMARY_TARGET file:// veya https:// URL olmalı."]);
}
if (hasSecretBearingUrlParts(targetUrl)) {
  fail(["PRODUCTION_EVIDENCE_SUMMARY_TARGET production evidence target URL userinfo, query veya fragment içeremez."]);
}

const summary = await readJsonTarget(targetUrl);
const failures = validateSummary(summary);

if (failures.length > 0) {
  fail(failures);
}

console.log(`Production evidence summary kontrolü geçti: ${summary.generatedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url, "PRODUCTION_EVIDENCE_SUMMARY_TARGET"));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Production evidence summary okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["PRODUCTION_EVIDENCE_SUMMARY_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url, label) {
  const filePath = fileURLToPath(url);
  await assertParentPathAllowed(dirname(filePath), label);

  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail([`${label} okunabilir file:// artifact olmalı.`]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail([`${label} symlink olmayan file:// artifact olmalı.`]);
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
      const failure =
        label === "PRODUCTION_EVIDENCE_SUMMARY_TARGET"
          ? "PRODUCTION_EVIDENCE_SUMMARY_TARGET parent dizini symlink olmayan dizin olmalı."
          : `${label} parent dizini symlink olmayan dizin olmalı.`;
      fail([failure]);
    }
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

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Production evidence summary geçerli JSON olmalı."]);
  }
}

function validateSummary(summary) {
  const failures = [];

  if (!summary || typeof summary !== "object" || Array.isArray(summary)) {
    failures.push("summary nesnesi zorunlu.");
    return failures;
  }

  requireExpectedObjectKeys(summary, requiredSummaryKeys, failures, "summary");
  requireEqual(summary, failures, "result", "PASS");
  requireEqual(summary, failures, "canPromote", true);
  requireEqual(summary, failures, "nodeEnv", "production");
  requireDate(summary, failures, "generatedAt");
  requireDateNotInFuture(summary, failures, "generatedAt");
  requireHttpsUrl(summary, failures, "appUrl");
  requireHttpsUrl(summary, failures, "apiUrl");
  requireHttpsUrl(summary, failures, "webUrl");
  requireChecks(summary, failures);
  requireSmokeEvidence(summary, failures);
  requireReports(summary, failures);
  requireNoPlaceholderValues(summary, failures, "summary");

  return failures;
}

function requireChecks(summary, failures) {
  if (!Array.isArray(summary.checks)) {
    failures.push("checks listesi zorunlu.");
    return;
  }

  requireExpectedCheckSet(summary.checks, failures, "checks");

  for (const [label, expectedScript] of requiredChecks) {
    const item = summary.checks.find((candidate) => candidate?.label === label);
    if (!item) {
      failures.push(`checks eksik: ${label}`);
      continue;
    }
    if (item.status !== "PASS") {
      failures.push(`checks.${label} PASS olmalı.`);
    }
    if (item.script !== expectedScript) {
      failures.push(`checks.${label}.script ${expectedScript} olmalı.`);
    }
  }
}

function requireExpectedCheckSet(checks, failures, label) {
  const expectedLabels = new Set(requiredChecks.keys());
  const seenLabels = new Set();

  if (checks.length !== requiredChecks.size) {
    failures.push(`${label} tam ${requiredChecks.size} madde içermeli.`);
  }

  for (const item of checks) {
    const itemLabel = item?.label;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failures.push(`${label} madde nesnesi olmalı.`);
      continue;
    }
    requireExpectedObjectKeys(item, requiredCheckItemKeys, failures, `${label}.${typeof itemLabel === "string" ? itemLabel : "unknown"}`);
    if (typeof itemLabel !== "string" || itemLabel.trim() === "") {
      failures.push(`${label}.label boş olmayan string olmalı.`);
      continue;
    }
    if (!expectedLabels.has(itemLabel)) {
      failures.push(`${label} beklenmeyen madde içeriyor: ${itemLabel}`);
    }
    if (seenLabels.has(itemLabel)) {
      failures.push(`${label} tekrarlı madde içeriyor: ${itemLabel}`);
    }
    seenLabels.add(itemLabel);
  }
}

function requireExpectedObjectKeys(value, expectedKeys, failures, label) {
  const expected = [...expectedKeys];
  const expectedSet = new Set(expected);
  const actual = Object.keys(value);

  if (actual.length !== expected.length) {
    failures.push(`${label} tam ${expected.length} alan içermeli.`);
  }

  for (const key of expected) {
    if (!(key in value)) {
      failures.push(`${label} eksik alan içeriyor: ${key}`);
    }
  }

  for (const key of actual) {
    if (!expectedSet.has(key)) {
      failures.push(`${label} beklenmeyen alan içeriyor: ${key}`);
    }
  }
}

function requireSmokeEvidence(summary, failures) {
  const value = requireObject(summary, failures, "smokeEvidence");
  if (!value) return;

  requireExpectedObjectKeys(value, requiredSmokeEvidence.keys(), failures, "smokeEvidence");

  for (const [key, expectedCheck] of requiredSmokeEvidence) {
    failures.push(
      ...validateSmokeEvidencePayload(value[key], {
        expectedCheck,
        allowedEnvironments: ["staging", "production"],
        label: `smokeEvidence.${key}`,
        allowExampleEvidence,
      }),
    );
    if (key === "secretDeliveryOutbox") requireSecretDeliveryOutboxSmoke(value[key], failures);
    if (value[key]) {
      if (key === "secretDeliveryOutbox" && allowStagingOutbox) {
        if (!["staging", "production"].includes(value[key].environment)) {
          failures.push("smokeEvidence.secretDeliveryOutbox.environment staging veya production olmalı.");
        }
      } else {
        requireObjectEqual(value[key], failures, `smokeEvidence.${key}.environment`, "environment", "production");
      }
      if (key === "traefikHttps") {
        requireMatchingUrlOrigin(value[key], failures, "smokeEvidence.traefikHttps.url", "url", summary, "webUrl", "webUrl");
      }
      requireDateNotAfter(value[key], failures, `smokeEvidence.${key}.generatedAt`, "generatedAt", summary, "generatedAt");
    }
  }
}

function requireSecretDeliveryOutboxSmoke(value, failures) {
  const label = "smokeEvidence.secretDeliveryOutbox";
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return;
  }
  requireExpectedObjectKeys(value, [
    "schemaVersion", "result", "check", "environment", "generatedAt", "releaseImageTag", "notBefore", "outboxRecordHash", "purpose", "retry",
    "terminalStatus", "payloadCleared", "deliveredAt", "updatedAt", "separateRolePrivilege", "commandsPassed", "gaps",
  ], failures, label);
  if (value.schemaVersion !== 1) failures.push(`${label}.schemaVersion 1 olmalı.`);
  if (value.terminalStatus !== "DELIVERED") failures.push(`${label}.terminalStatus DELIVERED olmalı.`);
  if (value.payloadCleared !== true) failures.push(`${label}.payloadCleared true olmalı.`);
  if (typeof value.releaseImageTag !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(value.releaseImageTag)) failures.push(`${label}.releaseImageTag güvenli IMAGE_TAG olmalı.`);
  requireObjectDate(value, failures, label, "notBefore");
  if (Date.parse(value.notBefore) > Date.parse(value.generatedAt) || Date.parse(value.generatedAt) - Date.parse(value.notBefore) > 24 * 60 * 60 * 1000) {
    failures.push(`${label}.notBefore generatedAt öncesindeki son 24 saat içinde olmalı.`);
  }
  if (typeof value.outboxRecordHash !== "string" || !/^[a-f0-9]{64}$/.test(value.outboxRecordHash)) failures.push(`${label}.outboxRecordHash SHA-256 hex olmalı.`);
  if (!['IDENTITY_INVITATION', 'PASSWORD_RESET'].includes(value.purpose)) failures.push(`${label}.purpose geçersiz.`);
  requireObjectDate(value, failures, label, "deliveredAt");
  requireObjectDate(value, failures, label, "updatedAt");
  if (Date.parse(value.deliveredAt) < Date.parse(value.notBefore) || Date.parse(value.updatedAt) < Date.parse(value.notBefore)) {
    failures.push(`${label}.deliveredAt ve updatedAt notBefore zamanından önce olamaz.`);
  }
  if (!allowExampleEvidence && [value.deliveredAt, value.updatedAt].some((timestamp) => Date.now() - Date.parse(timestamp) > 24 * 60 * 60 * 1000)) {
    failures.push(`${label}.deliveredAt ve updatedAt 24 saatten eski olamaz.`);
  }
  const retry = requireObject(value, failures, `${label}.retry`, "retry");
  if (retry && (!Number.isSafeInteger(retry.attempts) || retry.attempts < 2 || retry.retried !== true)) failures.push(`${label}.retry retry edilmiş en az iki deneme olmalı.`);
  const privilege = requireObject(value, failures, `${label}.separateRolePrivilege`, "separateRolePrivilege");
  if (!privilege) return;
  if (privilege.role !== "secret_delivery_worker" || privilege.result !== "PASS") failures.push(`${label}.separateRolePrivilege ayrı worker rolü PASS olmalı.`);
  if (privilege.outboxTable?.select !== true || privilege.outboxTable?.update !== true || privilege.outboxTable?.insert !== false || privilege.outboxTable?.delete !== false || privilege.outboxTable?.truncate !== false || privilege.otherTables?.userSelect !== false || privilege.publicSchema?.create !== false || privilege.publicSchema?.owner !== false || Object.values(privilege.elevatedCapabilities ?? {}).some((value) => value !== false)) {
    failures.push(`${label}.separateRolePrivilege least-privilege sonucu geçersiz.`);
  }
  if (JSON.stringify(value).toLowerCase().match(/https?:\/\/|[\w.+-]+@[\w.-]+\.[a-z]{2,}|recipient|token|payloadencrypted|sourceid/)) {
    failures.push(`${label} recipient, token, URL veya payload taşımamalı.`);
  }
}

function requireReports(summary, failures) {
  const reports = requireObject(summary, failures, "reports");
  if (!reports) return;

  requireExpectedObjectKeys(reports, Object.keys(requiredReports), failures, "reports");

  for (const [key, requiredKeys] of Object.entries(requiredReports)) {
    const report = requireObject(reports, failures, `reports.${key}`, key);
    if (!report) continue;

    requireExpectedObjectKeys(report, requiredKeys, failures, `reports.${key}`);

    if (key === "uiUxRedesign" && (allowExampleEvidence || allowStagingUiUx)) {
      if (!["staging", "production"].includes(report.environment)) {
        failures.push("reports.uiUxRedesign.environment staging veya production olmalı.");
      }
    } else {
      const expectedEnvironment = key === "githubCi" ? "github-actions" : "production";
      requireObjectEqual(report, failures, `reports.${key}.environment`, "environment", expectedEnvironment);
    }

    const dateKey = key === "restoreDrill" ? "drillDate" : "checkedAt";
    if (dateKey in report) {
      requireObjectDate(report, failures, `reports.${key}.${dateKey}`, dateKey);
      requireDateNotInFuture(report, failures, `reports.${key}.${dateKey}`, dateKey);
      requireDateNotAfter(report, failures, `reports.${key}.${dateKey}`, dateKey, summary, "generatedAt");
    }
  }

  if (reports.deploymentRollback) {
    failures.push(
      ...validateDeploymentRollbackReport({
        ...reports.deploymentRollback,
        result: "PASS",
        gaps: [],
      }).map((failure) => `reports.deploymentRollback: ${failure}`),
    );
  }
  requireObjectTrue(reports.securityAudit, failures, "reports.securityAudit.prodEnvCheckOk", "prodEnvCheckOk");
  requireObjectTrue(reports.securityAudit, failures, "reports.securityAudit.httpsOk", "httpsOk");
  requireObjectTrue(reports.securityAudit, failures, "reports.securityAudit.rlsLiveCheckOk", "rlsLiveCheckOk");
  requireObjectTrue(reports.securityAudit, failures, "reports.securityAudit.noCriticalFindings", "noCriticalFindings");
  requireRlsLiveReport(reports.rlsLive, failures);
  requireAuditNullTenantReport(reports.auditNullTenant, failures);
  requireLiveUiWorkerResultReport(reports.liveUiWorkerResult, failures);
  requireUiUxRedesignReport(reports.uiUxRedesign, reports.deploymentRollback, reports.githubCi, failures);
  requireMatchingString(
    reports.observabilityUat?.alertDelivery,
    failures,
    "reports.observabilityUat.alertDelivery.releaseCandidate",
    "releaseCandidate",
    reports.githubCi,
    "reports.githubCi.commitSha",
    "commitSha",
  );
  requireKvkkInventoryReport(reports.kvkkInventory, failures);
  requireUatJourneyScenarios(reports.uat, failures);
  requireObjectTrue(reports.uat, failures, "reports.uat.liveExamCyclePassed", "liveExamCyclePassed");
  requireMatchingString(
    reports.liveExamCycle,
    failures,
    "reports.liveExamCycle.releaseCandidate",
    "releaseCandidate",
    reports.uat,
    "reports.uat.releaseCandidate",
    "releaseCandidate",
  );
  requireMatchingString(
    reports.liveExamCycle,
    failures,
    "reports.liveExamCycle.appUrl",
    "appUrl",
    summary,
    "appUrl",
    "appUrl",
  );
  requireMatchingString(
    reports.liveExamCycle,
    failures,
    "reports.liveExamCycle.apiUrl",
    "apiUrl",
    summary,
    "apiUrl",
    "apiUrl",
  );
  requireIsemLiveExamCycleConsistency(reports, failures);
  requireIsemQuarantineProbe(reports.isemOpticalPipeline, failures);
  requireMatchingString(
    reports.uat,
    failures,
    "reports.uat.releaseCandidate",
    "releaseCandidate",
    reports.deploymentRollback,
    "reports.deploymentRollback.releaseCandidate",
    "releaseCandidate",
  );
  requireMatchingString(
    reports.uat,
    failures,
    "reports.uat.rollbackImageTag",
    "rollbackImageTag",
    reports.deploymentRollback,
    "reports.deploymentRollback.rollbackImageTag",
    "rollbackImageTag",
  );
  requireMatchingString(
    reports.uat,
    failures,
    "reports.uat.restoreBackupReference",
    "restoreBackupReference",
    reports.restoreDrill,
    "reports.restoreDrill.sourceBackup",
    "sourceBackup",
  );
  requireExactStringSet(reports.uat?.commandsPassed, failures, "reports.uat.commandsPassed", expectedUatCommandsPassed);
}

function requireIsemQuarantineProbe(report, failures) {
  const probe = requireObject(
    report,
    failures,
    "reports.isemOpticalPipeline.quarantineProbe",
    "quarantineProbe",
  );
  if (!probe) return;
  requireExpectedObjectKeys(probe, [
    "openCount",
    "resolvedCount",
    "examResultCount",
    "reportResultCount",
    "idempotentReplayVerified",
    "studentReportVerified",
    "excelExportVerified",
    "pdfExportVerified",
    "reportReady",
    "reportJobQueued",
  ], failures, "reports.isemOpticalPipeline.quarantineProbe");
  for (const key of ["openCount", "resolvedCount", "examResultCount", "reportResultCount"]) {
    requireObjectEqual(probe, failures, `reports.isemOpticalPipeline.quarantineProbe.${key}`, key, 1);
  }
  for (const key of [
    "idempotentReplayVerified",
    "studentReportVerified",
    "excelExportVerified",
    "pdfExportVerified",
    "reportReady",
    "reportJobQueued",
  ]) {
    requireObjectTrue(probe, failures, `reports.isemOpticalPipeline.quarantineProbe.${key}`, key);
  }
}

function requireKvkkInventoryReport(scope, failures) {
  requireWhatsappConsent(scope, failures);

  const redaction = requireObject(scope, failures, "reports.kvkkInventory.auditDiffRedactionVerified", "auditDiffRedactionVerified");
  if (!redaction) return;

  requireExpectedObjectKeys(
    redaction,
    ["endpoint", "negativeControls", "actionsSampled", "command"],
    failures,
    "reports.kvkkInventory.auditDiffRedactionVerified",
  );
  requireObjectEqual(redaction, failures, "reports.kvkkInventory.auditDiffRedactionVerified.endpoint", "endpoint", "/audit-logs");
  requireExactStringSet(
    redaction.negativeControls,
    failures,
    "reports.kvkkInventory.auditDiffRedactionVerified.negativeControls",
    expectedKvkkAuditDiffNegativeControls,
  );
  requireExactStringSet(
    redaction.actionsSampled,
    failures,
    "reports.kvkkInventory.auditDiffRedactionVerified.actionsSampled",
    expectedKvkkAuditDiffActions,
  );
  if (typeof redaction.command !== "string" || !redaction.command.includes("audit-log")) {
    failures.push("reports.kvkkInventory.auditDiffRedactionVerified.command audit-log doğrulama komutu içermeli.");
  }
}

function requireWhatsappConsent(scope, failures) {
  const whatsappConsent = requireObject(scope, failures, "reports.kvkkInventory.whatsappConsent", "whatsappConsent");
  if (!whatsappConsent) return;

  requireExpectedObjectKeys(
    whatsappConsent,
    ["recordCount", "eventRecordCount", "piiRelevantStoredFields", "piiRelevantEventStoredFields", "policy"],
    failures,
    "reports.kvkkInventory.whatsappConsent",
  );
  requireObjectEqual(whatsappConsent, failures, "reports.kvkkInventory.whatsappConsent.recordCount", "recordCount", 0);
  requireObjectEqual(whatsappConsent, failures, "reports.kvkkInventory.whatsappConsent.eventRecordCount", "eventRecordCount", 0);
  requireExactStringSet(
    whatsappConsent.piiRelevantStoredFields,
    failures,
    "reports.kvkkInventory.whatsappConsent.piiRelevantStoredFields",
    expectedWhatsappConsentStoredFields,
  );
  requireExactStringSet(
    whatsappConsent.piiRelevantEventStoredFields,
    failures,
    "reports.kvkkInventory.whatsappConsent.piiRelevantEventStoredFields",
    expectedWhatsappConsentEventStoredFields,
  );

  const policy = requireObject(whatsappConsent, failures, "reports.kvkkInventory.whatsappConsent.policy", "policy");
  if (!policy) return;

  requireExpectedObjectKeys(
    policy,
    ["featureEnabled", "retentionPeriodDays", "disposalMethod", "purgeException", "explanation"],
    failures,
    "reports.kvkkInventory.whatsappConsent.policy",
  );
  requireObjectEqual(policy, failures, "reports.kvkkInventory.whatsappConsent.policy.featureEnabled", "featureEnabled", false);
  requireObjectEqual(policy, failures, "reports.kvkkInventory.whatsappConsent.policy.retentionPeriodDays", "retentionPeriodDays", 0);
  requireObjectEqual(
    policy,
    failures,
    "reports.kvkkInventory.whatsappConsent.policy.disposalMethod",
    "disposalMethod",
    "NO_RECORDS_WHILE_DISABLED",
  );
  requireObjectEqual(policy, failures, "reports.kvkkInventory.whatsappConsent.policy.purgeException", "purgeException", false);
  if (typeof policy.explanation !== "string" || policy.explanation.trim() === "") {
    failures.push("reports.kvkkInventory.whatsappConsent.policy.explanation boş olmayan metin olmalı.");
  }
}

function requireRlsLiveReport(scope, failures) {
  const schema = requireObject(scope, failures, "reports.rlsLive.schema", "schema");
  if (schema) {
    requireExpectedObjectKeys(
      schema,
      ["tenantScopedTables", "derivedFromSchema", "staticCheckPassed", "liveCheckPassed", "tablesVerified"],
      failures,
      "reports.rlsLive.schema",
    );
    requireObjectEqual(schema, failures, "reports.rlsLive.schema.tenantScopedTables", "tenantScopedTables", expectedTenantTables.length);
    requireObjectTrue(schema, failures, "reports.rlsLive.schema.derivedFromSchema", "derivedFromSchema");
    requireObjectTrue(schema, failures, "reports.rlsLive.schema.staticCheckPassed", "staticCheckPassed");
    requireObjectTrue(schema, failures, "reports.rlsLive.schema.liveCheckPassed", "liveCheckPassed");
    requireExactStringSet(schema.tablesVerified, failures, "reports.rlsLive.schema.tablesVerified", expectedTenantTables);
  }

  const isolation = requireObject(scope, failures, "reports.rlsLive.isolation", "isolation");
  if (isolation) {
    requireExpectedObjectKeys(
      isolation,
      [
        "tenantAHash",
        "tenantBHash",
        "crossTenantReadRows",
        "crossTenantReadChecks",
        "withCheckRejects",
        "systemAdminBypassDefaultOff",
        "bypassRequiresReason",
        "auditBypassAction",
      ],
      failures,
      "reports.rlsLive.isolation",
    );
    requireObjectEqual(isolation, failures, "reports.rlsLive.isolation.crossTenantReadRows", "crossTenantReadRows", 0);
    requireObjectEqual(isolation, failures, "reports.rlsLive.isolation.crossTenantReadChecks", "crossTenantReadChecks", expectedTenantTables.length);
    requireExactStringSet(isolation.withCheckRejects, failures, "reports.rlsLive.isolation.withCheckRejects", expectedRlsWriteRejects);
    requireObjectTrue(isolation, failures, "reports.rlsLive.isolation.systemAdminBypassDefaultOff", "systemAdminBypassDefaultOff");
    requireObjectTrue(isolation, failures, "reports.rlsLive.isolation.bypassRequiresReason", "bypassRequiresReason");
    requireObjectEqual(isolation, failures, "reports.rlsLive.isolation.auditBypassAction", "auditBypassAction", "system.rls_bypass_requested");
  }

  const tenantFkPreflight = requireObject(scope, failures, "reports.rlsLive.tenantFkPreflight", "tenantFkPreflight");
  if (tenantFkPreflight) {
    requireExpectedObjectKeys(
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
      "reports.rlsLive.tenantFkPreflight",
    );
    requireObjectEqual(
      tenantFkPreflight,
      failures,
      "reports.rlsLive.tenantFkPreflight.requiredCompositeRelations",
      "requiredCompositeRelations",
      expectedTenantCompositeRelations.length,
    );
    requireExactStringSet(
      tenantFkPreflight.relationsVerified,
      failures,
      "reports.rlsLive.tenantFkPreflight.relationsVerified",
      expectedTenantCompositeRelations,
    );
    requireObjectEqual(tenantFkPreflight, failures, "reports.rlsLive.tenantFkPreflight.legacyAllowlistCount", "legacyAllowlistCount", 0);
    requireObjectEqual(tenantFkPreflight, failures, "reports.rlsLive.tenantFkPreflight.orphanRows", "orphanRows", 0);
    requireObjectEqual(tenantFkPreflight, failures, "reports.rlsLive.tenantFkPreflight.crossTenantParentRows", "crossTenantParentRows", 0);
    requireExactStringSet(
      tenantFkPreflight.crossTenantInsertRejects,
      failures,
      "reports.rlsLive.tenantFkPreflight.crossTenantInsertRejects",
      expectedTenantFkInsertRejects,
    );
    if (
      typeof tenantFkPreflight.migrationPreflightCommand !== "string" ||
      !tenantFkPreflight.migrationPreflightCommand.includes("pnpm tenant-db:check")
    ) {
      failures.push("reports.rlsLive.tenantFkPreflight.migrationPreflightCommand pnpm tenant-db:check içermeli.");
    }
  }

  const loadSmoke = requireObject(scope, failures, "reports.rlsLive.loadSmoke", "loadSmoke");
  if (loadSmoke) {
    requireExpectedObjectKeys(
      loadSmoke,
      ["targetRps", "actualRps", "durationSeconds", "concurrency", "queriesCompleted", "failures"],
      failures,
      "reports.rlsLive.loadSmoke",
    );
    requireObjectNumberAtLeast(loadSmoke, failures, "reports.rlsLive.loadSmoke.targetRps", "targetRps", 200);
    requireObjectNumberAtLeast(loadSmoke, failures, "reports.rlsLive.loadSmoke.actualRps", "actualRps", loadSmoke.targetRps ?? 200);
    requireObjectEqual(loadSmoke, failures, "reports.rlsLive.loadSmoke.failures", "failures", 0);
  }

  requireExactStringSet(
    scope?.commandsPassed,
    failures,
    "reports.rlsLive.commandsPassed",
    ["pnpm db:rls:check", "pnpm db:rls:check:live", "pnpm rls:load:smoke", "pnpm rls:live:check"],
  );
  requireRlsEvidenceReferences(scope?.evidenceReferences, failures, "reports.rlsLive.evidenceReferences");
}

function requireAuditNullTenantReport(scope, failures) {
  const classification = requireObject(scope, failures, "reports.auditNullTenant.auditNullTenant", "auditNullTenant");
  if (classification) {
    requireExpectedObjectKeys(
      classification,
      ["totalRows", "tenantRows", "nullTenantRows", "nullTenantBreakdown"],
      failures,
      "reports.auditNullTenant.auditNullTenant",
    );
    requireObjectNumberAtLeast(classification, failures, "reports.auditNullTenant.auditNullTenant.totalRows", "totalRows", 0);
    requireObjectNumberAtLeast(classification, failures, "reports.auditNullTenant.auditNullTenant.tenantRows", "tenantRows", 0);
    requireObjectNumberAtLeast(classification, failures, "reports.auditNullTenant.auditNullTenant.nullTenantRows", "nullTenantRows", 0);
    if (
      Number.isInteger(classification.totalRows) &&
      Number.isInteger(classification.tenantRows) &&
      Number.isInteger(classification.nullTenantRows) &&
      classification.totalRows !== classification.tenantRows + classification.nullTenantRows
    ) {
      failures.push("reports.auditNullTenant.auditNullTenant.totalRows tenantRows + nullTenantRows toplamına eşit olmalı.");
    }

    const breakdown = requireObject(
      classification,
      failures,
      "reports.auditNullTenant.auditNullTenant.nullTenantBreakdown",
      "nullTenantBreakdown",
    );
    if (breakdown) {
      requireExpectedObjectKeys(breakdown, ["system", "deletedTenant", "unknown"], failures, "reports.auditNullTenant.auditNullTenant.nullTenantBreakdown");
      let breakdownCount = 0;
      for (const key of ["system", "deletedTenant", "unknown"]) {
        const item = requireObject(
          breakdown,
          failures,
          `reports.auditNullTenant.auditNullTenant.nullTenantBreakdown.${key}`,
          key,
        );
        if (!item) continue;
        requireExpectedObjectKeys(
          item,
          ["count", "classificationRule"],
          failures,
          `reports.auditNullTenant.auditNullTenant.nullTenantBreakdown.${key}`,
        );
        requireObjectNumberAtLeast(
          item,
          failures,
          `reports.auditNullTenant.auditNullTenant.nullTenantBreakdown.${key}.count`,
          "count",
          0,
        );
        if (Number.isInteger(item.count)) breakdownCount += item.count;
        if (typeof item.classificationRule !== "string" || item.classificationRule.trim() === "") {
          failures.push(`reports.auditNullTenant.auditNullTenant.nullTenantBreakdown.${key}.classificationRule boş olmayan metin olmalı.`);
        }
      }
      requireObjectEqual(breakdown.unknown, failures, "reports.auditNullTenant.auditNullTenant.nullTenantBreakdown.unknown.count", "count", 0);
      if (Number.isInteger(classification.nullTenantRows) && breakdownCount !== classification.nullTenantRows) {
        failures.push("reports.auditNullTenant.auditNullTenant.nullTenantBreakdown count toplamı nullTenantRows değerine eşit olmalı.");
      }
    }
  }

  requireExactStringSet(scope?.commandsPassed, failures, "reports.auditNullTenant.commandsPassed", ["pnpm audit-null-tenant:check"]);
}

function requireLiveUiWorkerResultReport(scope, failures) {
  failures.push(
    ...validateSmokeEvidencePayload(scope, {
      expectedCheck: "live_ui_worker_report_smoke",
      allowedEnvironments: ["staging", "production"],
      label: "reports.liveUiWorkerResult",
      allowExampleEvidence,
    }),
  );
  requireObjectEqual(scope, failures, "reports.liveUiWorkerResult.environment", "environment", "production");
  requireExactStringSet(scope?.commandsPassed, failures, "reports.liveUiWorkerResult.commandsPassed", ["pnpm live:ui-worker:smoke"]);
}

function requireUiUxRedesignReport(scope, deploymentRollback, githubCi, failures) {
  requireObjectEqual(scope, failures, "reports.uiUxRedesign.schemaVersion", "schemaVersion", 2);
  requireObjectEqual(scope, failures, "reports.uiUxRedesign.result", "result", "PASS");
  requireObjectEqual(scope, failures, "reports.uiUxRedesign.redesignPlanPath", "redesignPlanPath", "docs/ui-ux-professionalization-contract.md");
  requireMatchingString(
    scope,
    failures,
    "reports.uiUxRedesign.releaseCandidate",
    "releaseCandidate",
    deploymentRollback,
    "reports.deploymentRollback.releaseCandidate",
    "releaseCandidate",
  );
  const releaseCandidateTag = scope?.releaseCandidate?.match(/:([a-f0-9]{40})$/i)?.[1];
  const sourceCommitSha = scope?.sourceCommitSha;
  const githubCommitSha = githubCi?.commitSha;
  if (
    !releaseCandidateTag ||
    typeof sourceCommitSha !== "string" ||
    !/^[a-f0-9]{40}$/i.test(sourceCommitSha) ||
    typeof githubCommitSha !== "string" ||
    !/^[a-f0-9]{40}$/i.test(githubCommitSha) ||
    releaseCandidateTag.toLowerCase() !== sourceCommitSha.toLowerCase() ||
    sourceCommitSha.toLowerCase() !== githubCommitSha.toLowerCase()
  ) {
    failures.push("reports.uiUxRedesign releaseCandidate tag'i, sourceCommitSha ve reports.githubCi.commitSha aynı 40 karakter SHA olmalı.");
  }
  failures.push(...validateUiUxRedesignBindings(scope, {
    allowExampleEvidence,
    expectedGithubCi: githubCi,
    label: "reports.uiUxRedesign",
    trustedEvidenceHosts: trustedUiUxEvidenceHosts,
  }));

  const localStaticEvidence = requireObject(scope, failures, "reports.uiUxRedesign.localStaticEvidence", "localStaticEvidence");
  if (localStaticEvidence) {
    requireObjectEqual(localStaticEvidence, failures, "reports.uiUxRedesign.localStaticEvidence.result", "result", "PASS");
    requireObjectEqual(localStaticEvidence, failures, "reports.uiUxRedesign.localStaticEvidence.releaseBlocking", "releaseBlocking", false);
  }

  const stagingProductionEvidence = requireObject(
    scope,
    failures,
    "reports.uiUxRedesign.stagingProductionEvidence",
    "stagingProductionEvidence",
  );
  if (stagingProductionEvidence) {
    requireObjectEqual(stagingProductionEvidence, failures, "reports.uiUxRedesign.stagingProductionEvidence.result", "result", "PASS");
    requireObjectTrue(
      stagingProductionEvidence,
      failures,
      "reports.uiUxRedesign.stagingProductionEvidence.requiredForRelease",
      "requiredForRelease",
    );
  }

  const privacy = requireObject(scope, failures, "reports.uiUxRedesign.privacy", "privacy");
  if (privacy) {
    requireObjectEqual(privacy, failures, "reports.uiUxRedesign.privacy.piiReview", "piiReview", "PASS");
    requireObjectEqual(privacy, failures, "reports.uiUxRedesign.privacy.rawPiiInArtifacts", "rawPiiInArtifacts", false);
    requireObjectEqual(privacy, failures, "reports.uiUxRedesign.privacy.smsRecipientPreviewExported", "smsRecipientPreviewExported", false);
    requireObjectTrue(privacy, failures, "reports.uiUxRedesign.privacy.guardianFinanceLeakageChecked", "guardianFinanceLeakageChecked");
  }

  if (!Array.isArray(scope?.openRisks) || scope.openRisks.length !== 0) {
    failures.push("reports.uiUxRedesign.openRisks boş liste olmalı.");
  }
}

function requireIsemLiveExamCycleConsistency(reports, failures) {
  const liveExamCycle = reports.liveExamCycle?.examCycle;
  const isemOpticalPipeline = reports.isemOpticalPipeline;
  const isemCounts = isemOpticalPipeline?.counts;

  if (!liveExamCycle || typeof liveExamCycle !== "object" || Array.isArray(liveExamCycle)) return;
  if (!isemOpticalPipeline || typeof isemOpticalPipeline !== "object" || Array.isArray(isemOpticalPipeline)) return;
  if (!isemCounts || typeof isemCounts !== "object" || Array.isArray(isemCounts)) return;

  requireObjectEqual(
    isemOpticalPipeline,
    failures,
    "reports.isemOpticalPipeline.fixtureId",
    "fixtureId",
    ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST.fixtureId,
  );
  requireObjectEqual(
    isemOpticalPipeline.hashes ?? {},
    failures,
    "reports.isemOpticalPipeline.hashes.opticalTxtSha256",
    "opticalTxtSha256",
    ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST.inputs.opticalTxt.sha256,
  );
  requireObjectEqual(
    isemOpticalPipeline.hashes ?? {},
    failures,
    "reports.isemOpticalPipeline.hashes.answerKeyFileSha256",
    "answerKeyFileSha256",
    ISEM_OPTICAL_PIPELINE_INPUT_MANIFEST.inputs.answerKey.sha256,
  );

  requireMatchingValue(
    liveExamCycle,
    failures,
    "reports.liveExamCycle.examCycle.answerKeyVersion",
    "answerKeyVersion",
    isemOpticalPipeline,
    "reports.isemOpticalPipeline.answerKeyVersion",
    "answerKeyVersion",
  );
  requireMatchingValue(
    liveExamCycle,
    failures,
    "reports.liveExamCycle.examCycle.parserConfigVersion",
    "parserConfigVersion",
    isemOpticalPipeline,
    "reports.isemOpticalPipeline.parserConfigVersion",
    "parserConfigVersion",
  );
  requireMatchingValue(
    liveExamCycle,
    failures,
    "reports.liveExamCycle.examCycle.answerKeyQuestionCount",
    "answerKeyQuestionCount",
    isemOpticalPipeline,
    "reports.isemOpticalPipeline.answerKeyQuestionCount",
    "answerKeyQuestionCount",
  );
  requireMatchingValue(
    liveExamCycle,
    failures,
    "reports.liveExamCycle.examCycle.bookletVariantCount",
    "bookletVariantCount",
    isemOpticalPipeline,
    "reports.isemOpticalPipeline.bookletVariantCount",
    "bookletVariantCount",
  );

  for (const key of ["participantCount", "matchedCount", "quarantineCount", "examResultCount", "reportResultCount"]) {
    requireMatchingValue(
      liveExamCycle,
      failures,
      `reports.liveExamCycle.examCycle.${key}`,
      key,
      isemCounts,
      `reports.isemOpticalPipeline.counts.${key}`,
      key,
    );
  }
}

function requireNoPlaceholderValues(value, failures, label) {
  if (allowExampleEvidence) return;
  if (!value || typeof value !== "object") return;

  if (Array.isArray(value)) {
    value.forEach((item, index) => requireNoPlaceholderValues(item, failures, `${label}.${index}`));
    return;
  }

  for (const [key, item] of Object.entries(value)) {
    const itemLabel = `${label}.${key}`;
    if (typeof item === "string" && hasPlaceholderToken(item)) {
      failures.push(`${itemLabel} production için örnek/placeholder/redacted değer olmamalı.`);
      continue;
    }
    if (item && typeof item === "object") {
      requireNoPlaceholderValues(item, failures, itemLabel);
    }
  }
}

function requireObject(scope, failures, label, key = label) {
  const value = scope?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return undefined;
  }
  return value;
}

function requireEqual(scope, failures, key, expected) {
  if (scope?.[key] !== expected) {
    failures.push(`${key} ${expected} olmalı.`);
  }
}

function requireObjectEqual(scope, failures, label, key, expected) {
  if (scope?.[key] !== expected) {
    failures.push(`${label} ${expected} olmalı.`);
  }
}

function requireObjectTrue(scope, failures, label, key) {
  if (scope?.[key] !== true) {
    failures.push(`${label} true olmalı.`);
  }
}

function requireObjectNumberAtLeast(scope, failures, label, key, min) {
  const value = scope?.[key];
  if (typeof value !== "number" || Number.isNaN(value) || value < min) {
    failures.push(`${label} en az ${min} olmalı.`);
  }
}

function requireMatchingString(firstScope, failures, firstLabel, firstKey, secondScope, secondLabel, secondKey) {
  if (firstScope?.[firstKey] !== secondScope?.[secondKey]) {
    failures.push(`${firstLabel} ${secondLabel} ile eşleşmeli.`);
  }
}

function requireMatchingValue(firstScope, failures, firstLabel, firstKey, secondScope, secondLabel, secondKey) {
  if (firstScope?.[firstKey] !== secondScope?.[secondKey]) {
    failures.push(`${firstLabel} ${secondLabel} ile eşleşmeli.`);
  }
}

function requireObjectStringList(scope, failures, label, key, minLength) {
  const value = scope?.[key];
  if (!Array.isArray(value) || value.length < minLength) {
    failures.push(`${label} en az ${minLength} madde içermeli.`);
  }
}

function requireUatJourneyScenarios(scope, failures) {
  const value = scope?.journeyScenariosVerified;
  if (!Array.isArray(value) || value.length !== expectedUatJourneyScenarios.length) {
    failures.push(`reports.uat.journeyScenariosVerified tam ${expectedUatJourneyScenarios.length} senaryo içermeli.`);
    return;
  }

  const expected = new Map(expectedUatJourneyScenarios);
  const seen = new Set();
  for (const [index, item] of value.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      failures.push(`reports.uat.journeyScenariosVerified.${index} senaryo nesnesi olmalı.`);
      continue;
    }
    const keys = Object.keys(item).sort();
    const expectedKeys = ["evidence", "id", "persona", "status"];
    if (stableStringify(keys) !== stableStringify(expectedKeys)) {
      failures.push(`reports.uat.journeyScenariosVerified.${index} tam id/persona/status/evidence alanlarını içermeli.`);
    }
    if (typeof item.id !== "string" || !item.id.startsWith("UAT-")) {
      failures.push(`reports.uat.journeyScenariosVerified.${index}.id UAT-* olmalı.`);
    } else if (!expected.has(item.id)) {
      failures.push(`reports.uat.journeyScenariosVerified beklenmeyen senaryo içeriyor: ${item.id}`);
    } else if (seen.has(item.id)) {
      failures.push(`reports.uat.journeyScenariosVerified tekrarlı senaryo içeriyor: ${item.id}`);
    } else {
      seen.add(item.id);
      if (item.persona !== expected.get(item.id)) {
        failures.push(`reports.uat.journeyScenariosVerified.${item.id}.persona ${expected.get(item.id)} olmalı.`);
      }
    }
    if (item.status !== "PASS") {
      failures.push(`reports.uat.journeyScenariosVerified.${index}.status PASS olmalı.`);
    }
    if (!Array.isArray(item.evidence) || item.evidence.length === 0 || item.evidence.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
      failures.push(`reports.uat.journeyScenariosVerified.${index}.evidence boş olmayan metin listesi olmalı.`);
    }
  }

  for (const [id] of expectedUatJourneyScenarios) {
    if (!seen.has(id)) {
      failures.push(`reports.uat.journeyScenariosVerified eksik: ${id}`);
    }
  }
}

function requireExactStringSet(value, failures, label, expected) {
  if (!Array.isArray(value)) {
    failures.push(`${label} listesi zorunlu.`);
    return;
  }

  if (value.length !== expected.length) {
    failures.push(`${label} tam ${expected.length} madde içermeli.`);
  }

  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${label} boş olmayan metinlerden oluşmalı.`);
      continue;
    }
    if (!expected.includes(item)) {
      failures.push(`${label} beklenmeyen madde içeriyor: ${item}`);
    }
  }

  for (const expectedItem of expected) {
    if (!value.includes(expectedItem)) {
      failures.push(`${label} eksik: ${expectedItem}`);
    }
  }
}

function requireDate(scope, failures, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${key} geçerli tarih olmalı.`);
  }
}

function requireObjectDate(scope, failures, label, key) {
  const value = scope?.[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${label} geçerli tarih olmalı.`);
  }
}

function requireDateNotInFuture(scope, failures, label, key = label) {
  if (allowExampleEvidence) return;

  const value = scope?.[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) return;

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${label} gelecekte olamaz.`);
  }
}

function requireDateNotAfter(scope, failures, firstLabel, firstKey, secondScope, secondKey) {
  const first = Date.parse(scope?.[firstKey]);
  const second = Date.parse(secondScope?.[secondKey]);
  if (Number.isNaN(first) || Number.isNaN(second)) return;
  if (first > second) {
    failures.push(`${firstLabel} ${secondKey} tarihinden sonra olamaz.`);
  }
}

function requireHttpsUrl(scope, failures, key) {
  const value = scope?.[key];
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") {
      failures.push(`${key} https URL olmalı.`);
      return;
    }
    if (!allowExampleEvidence && isPlaceholderHost(url.hostname)) {
      failures.push(`${key} production için gerçek host olmalı.`);
    }
  } catch {
    failures.push(`${key} geçerli URL olmalı.`);
  }
}

function requireMatchingUrlOrigin(firstScope, failures, firstLabel, firstKey, secondScope, secondLabel, secondKey) {
  const first = firstScope?.[firstKey];
  const second = secondScope?.[secondKey];
  if (typeof first !== "string" || typeof second !== "string") return;

  try {
    if (new URL(first).origin !== new URL(second).origin) {
      failures.push(`${firstLabel} ${secondLabel} origin'i ile eşleşmeli.`);
    }
  } catch {
    // URL format errors are reported by the field-specific URL validators.
  }
}

function isPlaceholderHost(hostname) {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".test") ||
    normalized.includes("example") ||
    normalized.includes("__set")
  );
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return (
    normalized.includes("example") ||
    normalized.includes("placeholder") ||
    normalized.includes("change-me") ||
    normalized.includes("replace-me") ||
    normalized.includes("redacted") ||
    normalized.includes("__set") ||
    normalized.includes("localhost") ||
    normalized.includes(".test") ||
    normalized.includes(".example") ||
    normalized.includes(".invalid") ||
    normalized.includes("test-token") ||
    normalized.includes("test-message-id") ||
    normalized.includes("dummy") ||
    normalized.includes("fake") ||
    normalized.includes("sms-provider-message") ||
    normalized.includes("backup-bucket") ||
      normalized.includes("provider-console-or-contract-reference")
  );
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

function fail(failures) {
  console.error("Production evidence summary kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
