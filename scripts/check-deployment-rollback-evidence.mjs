import { lstat, readFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const allowExampleEvidence =
  process.env.DEPLOYMENT_ROLLBACK_ALLOW_EXAMPLE_EVIDENCE === "1" ||
  process.env.PRODUCTION_EVIDENCE_SUMMARY_ALLOW_EXAMPLE_EVIDENCE === "1" ||
  process.env.GO_LIVE_ALLOW_EXAMPLE_EVIDENCE === "1";
const deploymentRollbackTopLevelKeys = [
  "schemaVersion",
  "result",
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
  "gaps",
];
const drillKeys = [
  "mode",
  "sourceImageTag",
  "rollbackImageTag",
  "restoredImageTag",
  "startedAt",
  "completedAt",
  "failureInjected",
  "failureMode",
  "evidence",
];
const drillEvidenceKeys = ["commandLogReference", "source", "rollback", "restored"];
const drillCheckpointKeys = ["sha", "runUrl", "uatArtifactUrl", "artifactName", "artifactDigest"];
const approvalKeys = ["approvedBy", "approvalReference"];
const serviceVerifiedItemKeys = ["service", "status", "imageTag", "evidenceReference"];
const requiredServices = ["web", "api", "worker", "queue-board"];
const requiredCommandsByMode = {
  "failure-injection": [
    "docker compose pull web api worker queue-board",
    "docker compose up -d --remove-orphans",
    "pnpm compose:health:smoke",
    "pnpm prod:evidence:check",
  ],
  "cold-rollback-rehearsal": [
    "docker compose up -d --remove-orphans",
    "docker inspect four-service image parity",
    "curl public health/readiness HTTP 200",
    "node tenant-subdomain-live-uat.mjs",
  ],
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

async function main() {
  const target = process.env.DEPLOYMENT_ROLLBACK_TARGET;
  if (!target) fail(["DEPLOYMENT_ROLLBACK_TARGET boş bırakılamaz."]);

  let targetUrl;
  try {
    targetUrl = new URL(target);
  } catch {
    fail(["DEPLOYMENT_ROLLBACK_TARGET file:// veya https:// URL olmalı."]);
  }

  requireAllowedEvidenceTargetUrl(targetUrl);
  const report = await readJsonTarget(targetUrl);
  const failures = validateDeploymentRollbackReport(report);
  if (failures.length > 0) fail(failures);
  console.log(`Deployment rollback kanıt kontrolü geçti: ${report.environment} ${report.rollbackImageTag}`);
}

async function readJsonTarget(url) {
  if (url.protocol === "file:") {
    return parseJson(await readEvidenceFile(url));
  }

  if (url.protocol === "https:") {
    const response = await fetch(url);
    if (!response.ok) {
      fail([`Deployment rollback raporu okunamadı: HTTP ${response.status}`]);
    }
    return parseJson(await response.text());
  }

  fail(["DEPLOYMENT_ROLLBACK_TARGET yalnız file:// veya https:// destekler."]);
}

async function readEvidenceFile(url) {
  const filePath = fileURLToPath(url);
  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["DEPLOYMENT_ROLLBACK_TARGET okunabilir file:// artifact olmali."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["DEPLOYMENT_ROLLBACK_TARGET symlink olmayan file:// artifact olmali."]);
  }

  await assertParentPathAllowed(dirname(filePath));

  return readFile(filePath, "utf8");
}

async function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);

    let stat;
    try {
      stat = await lstat(current);
    } catch {
      fail(["DEPLOYMENT_ROLLBACK_TARGET parent dizini okunabilir olmali."]);
    }

    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["DEPLOYMENT_ROLLBACK_TARGET parent dizini symlink olmayan dizin olmali."]);
    }
  }
}

function requireAllowedEvidenceTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") {
    fail(["DEPLOYMENT_ROLLBACK_TARGET file:// veya https:// URL olmali."]);
  }

  if (url.username || url.password || url.search || url.hash) {
    fail(["DEPLOYMENT_ROLLBACK_TARGET userinfo, query veya fragment tasimamali."]);
  }

  if (url.protocol === "https:" && isPlaceholderEvidenceTargetHost(url.hostname)) {
    fail(["DEPLOYMENT_ROLLBACK_TARGET production kaniti icin gercek https host olmali."]);
  }

  if (url.protocol === "file:" && isLocalTempEvidenceTargetUrl(url)) {
    fail(["DEPLOYMENT_ROLLBACK_TARGET production kaniti icin lokal temp path olmamali."]);
  }

  if (url.protocol === "file:" && isLocalSmokeEvidenceTargetUrl(url)) {
    fail(["DEPLOYMENT_ROLLBACK_TARGET production kaniti icin artifacts/local altinda olmamali."]);
  }
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

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["Deployment rollback raporu geçerli JSON olmalı."]);
  }
}

export function validateDeploymentRollbackReport(report) {
  const failures = [];

  if (!requireObjectKeySet(report, deploymentRollbackTopLevelKeys, failures, "deploymentRollback")) {
    return failures;
  }
  requireEqual(report, failures, "schemaVersion", 2);
  requireEqual(report, failures, "result", "PASS");
  requireOneOf(report, failures, "environment", ["staging", "production"]);
  requireDate(report, failures, "checkedAt");
  requireDateNotInFuture(report, failures, "checkedAt");
  requireString(report, failures, "releaseCandidate");
  requireString(report, failures, "rollbackImageTag");
  requireNonPlaceholderString(report, failures, "releaseCandidate");
  requireNonPlaceholderString(report, failures, "rollbackImageTag");
  requireReleaseImageCommitSha(report.releaseCandidate, failures, "releaseCandidate");
  requireReleaseImageCommitSha(report.rollbackImageTag, failures, "rollbackImageTag");
  requireDrill(report, failures);
  requireTrue(report, failures, "migrationRollbackSafe");
  requireExactStringSet(report, failures, "commandsPassed", requiredCommandsByMode[report.drill?.mode] ?? []);
  requireServices(report, failures);
  requireApproval(report, failures);
  requireEvidenceReferences(report, failures);
  requireEmptyArray(report, failures, "gaps");

  if (report.releaseCandidate && report.rollbackImageTag && report.releaseCandidate === report.rollbackImageTag) {
    failures.push("releaseCandidate ve rollbackImageTag farklı olmalı.");
  }

  return failures;
}

function requireDrill(report, failures) {
  const drill = report.drill;
  if (!requireObjectKeySet(drill, drillKeys, failures, "drill")) return;

  requireOneOf(drill, failures, "mode", Object.keys(requiredCommandsByMode));
  for (const key of ["sourceImageTag", "rollbackImageTag", "restoredImageTag"]) {
    requireObjectString(drill, failures, `drill.${key}`, key);
    requireObjectNonPlaceholderString(drill, failures, `drill.${key}`, key);
  }
  for (const key of ["startedAt", "completedAt"]) {
    requireObjectDate(drill, failures, `drill.${key}`, key);
    requireObjectDateNotInFuture(drill, failures, `drill.${key}`, key);
  }
  requireObjectDateNotAfter(drill, failures, "startedAt", "completedAt", "drill.startedAt drill.completedAt sonrasında olamaz.");
  requireDateValueNotAfter(drill.completedAt, report.checkedAt, failures, "drill.completedAt checkedAt sonrasında olamaz.");

  if (drill.sourceImageTag === drill.rollbackImageTag) {
    failures.push("drill.sourceImageTag ve drill.rollbackImageTag farklı olmalı.");
  }

  if (drill.mode === "failure-injection") {
    if (drill.failureInjected !== true) failures.push("drill.failureInjected failure-injection modunda true olmalı.");
    requireObjectString(drill, failures, "drill.failureMode", "failureMode");
    requireObjectNonPlaceholderString(drill, failures, "drill.failureMode", "failureMode");
    if (drill.restoredImageTag !== drill.rollbackImageTag) {
      failures.push("drill.restoredImageTag failure-injection modunda drill.rollbackImageTag ile eşleşmeli.");
    }
  }

  if (drill.mode === "cold-rollback-rehearsal") {
    if (drill.failureInjected !== false) failures.push("drill.failureInjected cold-rollback-rehearsal modunda false olmalı.");
    if (drill.failureMode !== null) failures.push("drill.failureMode cold-rollback-rehearsal modunda null olmalı.");
    if (drill.restoredImageTag !== drill.sourceImageTag) {
      failures.push("drill.restoredImageTag cold-rollback-rehearsal modunda drill.sourceImageTag ile eşleşmeli.");
    }
  }

  requireDrillEvidence(report, drill, failures);
}

function requireDrillEvidence(report, drill, failures) {
  const evidence = drill.evidence;
  if (!requireObjectKeySet(evidence, drillEvidenceKeys, failures, "drill.evidence")) return;
  requireObjectString(evidence, failures, "drill.evidence.commandLogReference", "commandLogReference");
  requireObjectNonPlaceholderString(evidence, failures, "drill.evidence.commandLogReference", "commandLogReference");
  requireObjectNoSecretBearingReference(evidence, failures, "drill.evidence.commandLogReference", "commandLogReference");

  const checkpoints = {};
  for (const key of ["source", "rollback", "restored"]) {
    const checkpoint = evidence[key];
    checkpoints[key] = checkpoint;
    if (!requireObjectKeySet(checkpoint, drillCheckpointKeys, failures, `drill.evidence.${key}`)) continue;
    requireCheckpointSha(checkpoint, failures, `drill.evidence.${key}.sha`);
    requireGithubRunReference(report, checkpoint, failures, `drill.evidence.${key}.runUrl`);
    requireGithubArtifactReference(report, checkpoint, failures, `drill.evidence.${key}.uatArtifactUrl`);
    requireCheckpointArtifactMetadata(checkpoint, failures, key);
    requireCheckpointImageSha(drill, checkpoint, failures, key);
    requireMatchingRunId(checkpoint, failures, key);
  }

  if (drill.mode === "failure-injection" && !sameCheckpoint(checkpoints.restored, checkpoints.rollback)) {
    failures.push("drill.evidence.restored failure-injection modunda drill.evidence.rollback ile eşleşmeli.");
  }
  if (drill.mode === "cold-rollback-rehearsal") {
    if (checkpoints.restored?.sha !== checkpoints.source?.sha) {
      failures.push("drill.evidence.restored.sha cold-rollback-rehearsal modunda drill.evidence.source.sha ile eşleşmeli.");
    }
    if (checkpoints.restored?.runUrl === checkpoints.source?.runUrl || checkpoints.restored?.uatArtifactUrl === checkpoints.source?.uatArtifactUrl) {
      failures.push("drill.evidence.restored cold-rollback-rehearsal modunda ayrı restore run ve UAT artifact'i taşımalı.");
    }
  }
}

function requireCheckpointSha(checkpoint, failures, label) {
  if (typeof checkpoint?.sha !== "string" || !/^[a-f0-9]{40}$/.test(checkpoint.sha)) {
    failures.push(`${label} 40 karakter lowercase commit SHA olmalı.`);
  }
}

function requireGithubRunReference(report, checkpoint, failures, label) {
  if (typeof checkpoint?.runUrl !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*$/.test(checkpoint.runUrl)) {
    failures.push(`${label} canonical GitHub Actions run URL olmalı.`);
    return;
  }
  requireObjectNoSecretBearingReference(checkpoint, failures, label, "runUrl");
  requireGithubRepository(report, checkpoint.runUrl, failures, label);
}

function requireGithubArtifactReference(report, checkpoint, failures, label) {
  if (typeof checkpoint?.uatArtifactUrl !== "string" || !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*\/artifacts\/[1-9][0-9]*$/.test(checkpoint.uatArtifactUrl)) {
    failures.push(`${label} canonical GitHub Actions artifact URL olmalı.`);
    return;
  }
  requireObjectNoSecretBearingReference(checkpoint, failures, label, "uatArtifactUrl");
  requireGithubRepository(report, checkpoint.uatArtifactUrl, failures, label);
}

function requireGithubRepository(report, value, failures, label) {
  const expected = getImageRepository(report.releaseCandidate);
  const actual = value?.match(/^https:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\//)?.[1];
  if (!expected || actual !== expected) failures.push(`${label} releaseCandidate GitHub repository ile eşleşmeli.`);
}

function requireCheckpointArtifactMetadata(checkpoint, failures, key) {
  if (checkpoint?.artifactName !== `staging-activation-evidence-${checkpoint?.sha ?? ""}`) {
    failures.push(`drill.evidence.${key}.artifactName checkpoint SHA'ya bağlı staging activation artifact adı olmalı.`);
  }
  if (typeof checkpoint?.artifactDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(checkpoint.artifactDigest)) {
    failures.push(`drill.evidence.${key}.artifactDigest sha256 digest olmalı.`);
  }
}

function requireCheckpointImageSha(drill, checkpoint, failures, key) {
  const imageSha = getImageVersion(drill?.[`${key}ImageTag`]);
  if (imageSha && checkpoint?.sha && imageSha !== checkpoint.sha) {
    failures.push(`drill.evidence.${key}.sha drill.${key}ImageTag versiyonuyla eşleşmeli.`);
  }
}

function requireMatchingRunId(checkpoint, failures, key) {
  const runId = checkpoint?.runUrl?.match(/\/actions\/runs\/([1-9][0-9]*)$/)?.[1];
  const artifactRunId = checkpoint?.uatArtifactUrl?.match(/\/actions\/runs\/([1-9][0-9]*)\/artifacts\/[1-9][0-9]*$/)?.[1];
  if (runId && artifactRunId && runId !== artifactRunId) {
    failures.push(`drill.evidence.${key}.runUrl ve uatArtifactUrl aynı GitHub run'a ait olmalı.`);
  }
}

function sameCheckpoint(first, second) {
  return Boolean(first && second && drillCheckpointKeys.every((key) => first[key] === second[key]));
}

function requireApproval(report, failures) {
  const approval = report.approval;
  if (!requireObjectKeySet(approval, approvalKeys, failures, "approval")) return;
  requireObjectString(approval, failures, "approval.approvedBy", "approvedBy");
  requireObjectNonPlaceholderString(approval, failures, "approval.approvedBy", "approvedBy");
  requireObjectString(approval, failures, "approval.approvalReference", "approvalReference");
  requireObjectNonPlaceholderString(approval, failures, "approval.approvalReference", "approvalReference");
  requireObjectNoSecretBearingReference(approval, failures, "approval.approvalReference", "approvalReference");
}

function requireEqual(report, failures, key, expected) {
  if (report[key] !== expected) {
    failures.push(`${key} ${expected} olmalı.`);
  }
}

function requireOneOf(report, failures, key, expectedValues) {
  if (!expectedValues.includes(report[key])) {
    failures.push(`${key} ${expectedValues.join(" veya ")} olmalı.`);
  }
}

function requireDate(report, failures, key) {
  const value = report[key];
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    failures.push(`${key} geçerli tarih olmalı.`);
  }
}

function requireDateNotInFuture(report, failures, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  const timestamp = Date.parse(value);
  if (typeof value !== "string" || Number.isNaN(timestamp)) {
    return;
  }

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    failures.push(`${key} gelecekte olamaz.`);
  }
}

function requireObjectDate(report, failures, label, key) {
  if (typeof report?.[key] !== "string" || Number.isNaN(Date.parse(report[key]))) failures.push(`${label} geçerli tarih olmalı.`);
}

function requireObjectDateNotInFuture(report, failures, label, key) {
  if (allowExampleEvidence) return;
  const value = Date.parse(report?.[key]);
  if (Number.isFinite(value) && value > Date.now() + 5 * 60 * 1000) failures.push(`${label} gelecekte olamaz.`);
}

function requireObjectDateNotAfter(report, failures, firstKey, secondKey, message) {
  requireDateValueNotAfter(report?.[firstKey], report?.[secondKey], failures, message);
}

function requireDateValueNotAfter(firstValue, secondValue, failures, message) {
  const first = Date.parse(firstValue);
  const second = Date.parse(secondValue);
  if (Number.isFinite(first) && Number.isFinite(second) && first > second) failures.push(message);
}

function requireString(report, failures, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${key} boş olmayan metin olmalı.`);
  }
}

function requireNonPlaceholderString(report, failures, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  if (typeof value !== "string" || value.trim() === "") {
    return;
  }

  if (hasPlaceholderToken(value)) {
    failures.push(`${key} production kanıtı için örnek/placeholder değer olmamalı.`);
  }
}

function requireObjectNonPlaceholderString(report, failures, label, key) {
  if (allowExampleEvidence) return;

  const value = report[key];
  if (typeof value !== "string" || value.trim() === "") {
    return;
  }

  if (hasPlaceholderToken(value)) {
    failures.push(`${label} production kanıtı için örnek/placeholder değer olmamalı.`);
  }
}

function requireObjectString(report, failures, label, key) {
  if (typeof report[key] !== "string" || report[key].trim() === "") {
    failures.push(`${label} boş olmayan metin olmalı.`);
  }
}

function requireTrue(report, failures, key) {
  if (report[key] !== true) {
    failures.push(`${key} true olmalı.`);
  }
}

function requireExactStringSet(report, failures, key, expectedValues) {
  const value = report[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} alan listesi zorunlu.`);
    return;
  }

  if (value.length !== expectedValues.length) {
    failures.push(`${key} tam ${expectedValues.length} madde içermeli.`);
  }

  for (const expected of expectedValues) {
    if (!value.includes(expected)) {
      failures.push(`${key} eksik: ${expected}`);
    }
  }

  const expected = new Set(expectedValues);
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push(`${key} boş olmayan metinlerden oluşmalı.`);
      continue;
    }
    if (!expected.has(item)) {
      failures.push(`${key} beklenmeyen madde içeriyor: ${item}`);
    }
  }
}

function requireEmptyArray(report, failures, key) {
  const value = report[key];
  if (!Array.isArray(value)) {
    failures.push(`${key} listesi zorunlu.`);
    return;
  }
  if (value.length > 0) {
    failures.push(`${key} boş olmalı.`);
  }
}

function requireServices(report, failures) {
  const value = report.servicesVerified;
  if (!Array.isArray(value)) {
    failures.push("servicesVerified alan listesi zorunlu.");
    return;
  }

  if (value.length !== requiredServices.length) {
    failures.push("servicesVerified tam 4 servis içermeli.");
  }

  for (const service of requiredServices) {
    const item = value.find((candidate) => candidate && typeof candidate === "object" && candidate.service === service);
    if (!item) {
      failures.push(`servicesVerified eksik: ${service}`);
      continue;
    }
    requireObjectKeySet(item, serviceVerifiedItemKeys, failures, `servicesVerified.${service}`);
    if (!["healthy", "running"].includes(item.status)) {
      failures.push(`${service}.status healthy veya running olmalı.`);
    }
    requireObjectString(item, failures, `${service}.imageTag`, "imageTag");
    requireObjectString(item, failures, `${service}.evidenceReference`, "evidenceReference");
    requireObjectNonPlaceholderString(item, failures, `${service}.imageTag`, "imageTag");
    requireServiceRollbackImageVersion(report, item, failures, service);
    requireObjectNonPlaceholderString(item, failures, `${service}.evidenceReference`, "evidenceReference");
    requireObjectNoSecretBearingReference(item, failures, `${service}.evidenceReference`, "evidenceReference");
  }
}

function requireServiceRollbackImageVersion(report, item, failures, service) {
  const expectedVersion = getImageVersion(report.drill?.rollbackImageTag);
  const actualVersion = getImageVersion(item.imageTag);
  if (!expectedVersion || !actualVersion) return;

  if (actualVersion !== expectedVersion) {
    failures.push(`${service}.imageTag drill.rollbackImageTag versiyonuyla eşleşmeli.`);
  }
}

function getImageVersion(value) {
  if (typeof value !== "string" || value.trim() === "") return undefined;

  const normalized = value.trim();
  const digestIndex = normalized.indexOf("@sha256:");
  if (digestIndex !== -1) {
    return normalized.slice(digestIndex);
  }

  const lastSlash = normalized.lastIndexOf("/");
  const lastColon = normalized.lastIndexOf(":");
  if (lastColon <= lastSlash) return undefined;

  return normalized.slice(lastColon + 1);
}

function getImageRepository(value) {
  if (typeof value !== "string") return undefined;
  return value.trim().match(/^ghcr\.io\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\/[A-Za-z0-9_.-]+(?::|@)/)?.[1];
}

function requireReleaseImageCommitSha(value, failures, label) {
  if (allowExampleEvidence) return;
  const version = getImageVersion(value);
  if (!version || !/^[a-f0-9]{40}$/.test(version)) {
    failures.push(`${label} 40 karakter lowercase commit SHA tag'i taşımalı.`);
  }
}

function requireEvidenceReferences(report, failures) {
  const value = report.evidenceReferences;
  if (!Array.isArray(value)) {
    failures.push("evidenceReferences listesi zorunlu.");
    return;
  }

  const evidence = report.drill?.evidence;
  const expected = new Set([
    evidence?.commandLogReference,
    evidence?.source?.runUrl,
    evidence?.source?.uatArtifactUrl,
    evidence?.rollback?.runUrl,
    evidence?.rollback?.uatArtifactUrl,
    evidence?.restored?.runUrl,
    evidence?.restored?.uatArtifactUrl,
  ].filter(Boolean));
  requireExactStringSet(report, failures, "evidenceReferences", [...expected]);

  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") {
      failures.push("evidenceReferences boş olmayan metinlerden oluşmalı.");
      return;
    }
    if (!allowExampleEvidence && hasPlaceholderToken(item)) {
      failures.push("evidenceReferences production kanıtı için örnek/placeholder değer içermemeli.");
      return;
    }
    if (hasSecretBearingReference(item)) {
      failures.push("evidenceReferences userinfo, query veya fragment tasimamali.");
      return;
    }
  }

  const checkpointReferences = [
    evidence?.source?.runUrl,
    evidence?.source?.uatArtifactUrl,
    evidence?.rollback?.runUrl,
    evidence?.rollback?.uatArtifactUrl,
    evidence?.restored?.runUrl,
    evidence?.restored?.uatArtifactUrl,
  ];
  if (evidence?.commandLogReference && checkpointReferences.includes(evidence.commandLogReference)) {
    failures.push("drill.evidence.commandLogReference run veya UAT artifact referansından farklı olmalı.");
  }
}

function requireObjectKeySet(value, expectedKeys, failures, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }

  const actualKeys = Object.keys(value);
  if (actualKeys.length !== expectedKeys.length) {
    failures.push(`${label} tam ${expectedKeys.length} alan içermeli.`);
  }

  const expected = new Set(expectedKeys);
  for (const key of actualKeys) {
    if (!expected.has(key)) {
      failures.push(`${label}.${key} beklenmeyen alan.`);
    }
  }
  for (const key of expectedKeys) {
    if (!actualKeys.includes(key)) {
      failures.push(`${label}.${key} eksik.`);
    }
  }

  return true;
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return [
    "__set",
    "change-me",
    "replace-me",
    "placeholder",
    "example",
    ".test",
    ".invalid",
    "localhost",
    "127.0.0.1",
  ].some((token) => normalized.includes(token));
}

function requireObjectNoSecretBearingReference(report, failures, label, key) {
  const value = report[key];
  if (typeof value !== "string" || value.trim() === "") return;

  if (hasSecretBearingReference(value)) {
    failures.push(`${label} userinfo, query veya fragment tasimamali.`);
  }
}

function hasSecretBearingReference(value) {
  const normalized = value.trim();
  if (normalized.includes("?") || normalized.includes("#")) {
    return true;
  }

  const urlCandidate = normalized.toLowerCase().startsWith("url:") ? normalized.slice(4) : normalized;
  if (!/^(https|file|s3):\/\//i.test(urlCandidate)) {
    return false;
  }

  try {
    const url = new URL(urlCandidate);
    return Boolean(url.username || url.password || url.search || url.hash);
  } catch {
    return false;
  }
}

function fail(failures) {
  console.error("Deployment rollback kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
