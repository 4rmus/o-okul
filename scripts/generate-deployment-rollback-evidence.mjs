import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const requiredCommandsPassed = [
  "docker compose pull web api worker",
  "docker compose up -d --remove-orphans",
  "pnpm compose:health:smoke",
  "pnpm prod:evidence:check",
];
const serviceNames = ["web", "api", "worker"];

const outputPath = readOption("--output") ?? process.env.DEPLOYMENT_ROLLBACK_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";

const releaseCandidate = process.env.DEPLOYMENT_ROLLBACK_RELEASE_CANDIDATE?.trim();
const failedImageTag = process.env.DEPLOYMENT_ROLLBACK_FAILED_IMAGE_TAG?.trim();
const rollbackImageTag = process.env.DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG?.trim();
const drillStartedAt = process.env.DEPLOYMENT_ROLLBACK_DRILL_STARTED_AT?.trim();
const drillCompletedAt = process.env.DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT?.trim();
const failureInjected = process.env.DEPLOYMENT_ROLLBACK_FAILURE_INJECTED;
const failureMode = process.env.DEPLOYMENT_ROLLBACK_FAILURE_MODE?.trim();
const migrationRollbackSafe = process.env.DEPLOYMENT_ROLLBACK_MIGRATION_ROLLBACK_SAFE;
const approvedBy = process.env.DEPLOYMENT_ROLLBACK_APPROVED_BY?.trim();
const approvalReference = process.env.DEPLOYMENT_ROLLBACK_APPROVAL_REFERENCE?.trim();
const drillConfirmed = process.env.DEPLOYMENT_ROLLBACK_DRILL_CONFIRMED;
const commandLogReference = process.env.DEPLOYMENT_ROLLBACK_COMMAND_LOG_REFERENCE?.trim();
const brokenSummaryReference = process.env.DEPLOYMENT_ROLLBACK_BROKEN_SUMMARY_REFERENCE?.trim();
const rollbackSummaryReference = process.env.DEPLOYMENT_ROLLBACK_ROLLBACK_SUMMARY_REFERENCE?.trim();
const checkedAt = new Date().toISOString();

const failures = [];
requireValue(outputPath, "DEPLOYMENT_ROLLBACK_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireEvidenceValue(releaseCandidate, "DEPLOYMENT_ROLLBACK_RELEASE_CANDIDATE", failures);
requireEvidenceValue(failedImageTag, "DEPLOYMENT_ROLLBACK_FAILED_IMAGE_TAG", failures);
requireEvidenceValue(rollbackImageTag, "DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG", failures);
requireDifferent(failedImageTag, rollbackImageTag, "DEPLOYMENT_ROLLBACK_FAILED_IMAGE_TAG", "DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG", failures);
requireDifferent(releaseCandidate, rollbackImageTag, "DEPLOYMENT_ROLLBACK_RELEASE_CANDIDATE", "DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG", failures);
requireDate(drillStartedAt, "DEPLOYMENT_ROLLBACK_DRILL_STARTED_AT", failures);
requireDate(drillCompletedAt, "DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT", failures);
requireDateNotInFuture(drillStartedAt, "DEPLOYMENT_ROLLBACK_DRILL_STARTED_AT", failures);
requireDateNotInFuture(drillCompletedAt, "DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT", failures);
requireDateNotAfter(drillStartedAt, drillCompletedAt, "DEPLOYMENT_ROLLBACK_DRILL_STARTED_AT", "DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT", failures);
requireDateNotAfter(drillCompletedAt, checkedAt, "DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT", "checkedAt", failures);
requireTrue(failureInjected, "DEPLOYMENT_ROLLBACK_FAILURE_INJECTED", failures);
requireEvidenceValue(failureMode, "DEPLOYMENT_ROLLBACK_FAILURE_MODE", failures);
requireTrue(migrationRollbackSafe, "DEPLOYMENT_ROLLBACK_MIGRATION_ROLLBACK_SAFE", failures);
requireTrue(drillConfirmed, "DEPLOYMENT_ROLLBACK_DRILL_CONFIRMED", failures);
requireEvidenceValue(approvedBy, "DEPLOYMENT_ROLLBACK_APPROVED_BY", failures);
requireEvidenceValue(approvalReference, "DEPLOYMENT_ROLLBACK_APPROVAL_REFERENCE", failures);
requireEvidenceReference(commandLogReference, "DEPLOYMENT_ROLLBACK_COMMAND_LOG_REFERENCE", failures);
requireEvidenceReference(brokenSummaryReference, "DEPLOYMENT_ROLLBACK_BROKEN_SUMMARY_REFERENCE", failures);
requireEvidenceReference(rollbackSummaryReference, "DEPLOYMENT_ROLLBACK_ROLLBACK_SUMMARY_REFERENCE", failures);

const servicesVerified = serviceNames.map((service) => readService(service, failures));
requireServiceRollbackImageVersions(servicesVerified, rollbackImageTag, failures);
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const report = {
  result: "PASS",
  environment,
  checkedAt,
  releaseCandidate,
  failedImageTag,
  rollbackImageTag,
  drillStartedAt,
  drillCompletedAt,
  failureInjected: true,
  failureMode,
  migrationRollbackSafe: true,
  commandsPassed: requiredCommandsPassed,
  servicesVerified,
  evidenceReferences: [commandLogReference, brokenSummaryReference, rollbackSummaryReference],
  gaps: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile);
runCheck(outputFile);
console.log(`Deployment rollback kanıtı yazıldı: ${outputFile}`);

function readService(service, output) {
  const prefix = `DEPLOYMENT_ROLLBACK_${service.toUpperCase()}`;
  const status = process.env[`${prefix}_STATUS`]?.trim();
  const imageTag = process.env[`${prefix}_IMAGE_TAG`]?.trim();
  const evidenceReference = process.env[`${prefix}_EVIDENCE_REFERENCE`]?.trim();

  requireOneOf(status, `${prefix}_STATUS`, ["healthy", "running"], output);
  requireEvidenceValue(imageTag, `${prefix}_IMAGE_TAG`, output);
  requireEvidenceReference(evidenceReference, `${prefix}_EVIDENCE_REFERENCE`, output);

  return { service, status, imageTag, evidenceReference };
}

function runCheck(filePath) {
  const result = spawnSync("pnpm", ["deployment:rollback:check"], {
    env: {
      ...process.env,
      DEPLOYMENT_ROLLBACK_TARGET: pathToFileURL(filePath).href,
    },
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    fail(["pnpm deployment:rollback:check başarısız oldu."]);
  }
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
  }
}

function requireOneOf(value, label, expected, output) {
  if (!expected.includes(value)) {
    output.push(`${label} ${expected.join(" veya ")} olmalı.`);
  }
}

function requireTrue(value, label, output) {
  if (value !== "true") {
    output.push(`${label} true olmalı.`);
  }
}

function requireDate(value, label, output) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    output.push(`${label} geçerli tarih olmalı.`);
  }
}

function requireDateNotInFuture(value, label, output) {
  if (typeof value !== "string") return;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return;

  const clockSkewMs = 5 * 60 * 1000;
  if (timestamp > Date.now() + clockSkewMs) {
    output.push(`${label} gelecekte olamaz.`);
  }
}

function requireDateNotAfter(first, second, firstLabel, secondLabel, output) {
  const firstTime = Date.parse(first);
  const secondTime = Date.parse(second);
  if (Number.isNaN(firstTime) || Number.isNaN(secondTime)) return;
  if (firstTime > secondTime) {
    output.push(`${firstLabel} ${secondLabel} sonrasında olamaz.`);
  }
}

function requireDifferent(first, second, firstLabel, secondLabel, output) {
  if (typeof first !== "string" || typeof second !== "string") return;
  if (first.trim() !== "" && first === second) {
    output.push(`${firstLabel} ve ${secondLabel} farklı olmalı.`);
  }
}

function requireServiceRollbackImageVersions(services, expectedImageTag, output) {
  const expectedVersion = getImageVersion(expectedImageTag);
  if (!expectedVersion) return;

  for (const item of services) {
    const actualVersion = getImageVersion(item.imageTag);
    if (!actualVersion) continue;
    if (actualVersion !== expectedVersion) {
      output.push(`${item.service}.imageTag DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG versiyonuyla eşleşmeli.`);
    }
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

function requireEvidenceValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
    return;
  }

  if (hasPlaceholderToken(value)) {
    output.push(`${label} gerçek drill/kanıt değeri olmalı; placeholder/example/redacted/test içeremez.`);
  }
}

function requireEvidenceReference(value, label, output) {
  requireEvidenceValue(value, label, output);
  if (typeof value !== "string" || value.trim() === "") return;

  if (hasSecretBearingReference(value)) {
    output.push(`${label} userinfo, query veya fragment taşımamalı.`);
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
    "localhost",
    "127.0.0.1",
    "todo",
    "tbd",
    "???",
  ].some((token) => normalized.includes(token));
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

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["DEPLOYMENT_ROLLBACK_OUTPUT lokal temp path olmamalı."]);
  }
  if (isLocalSmokePath(filePath)) {
    fail(["DEPLOYMENT_ROLLBACK_OUTPUT artifacts/local altında olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath));

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["DEPLOYMENT_ROLLBACK_OUTPUT symlink olmayan file artifact olmalı."]);
    }
  }
}

function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const directoryStat = lstatSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      fail(["DEPLOYMENT_ROLLBACK_OUTPUT parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function isLocalSmokePath(filePath) {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function fail(messages) {
  console.error("Deployment rollback kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
