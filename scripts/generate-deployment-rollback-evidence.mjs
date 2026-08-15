import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
const serviceNames = ["web", "api", "worker", "queue-board"];

const outputPath = readOption("--output") ?? process.env.DEPLOYMENT_ROLLBACK_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";

const releaseCandidate = process.env.DEPLOYMENT_ROLLBACK_RELEASE_CANDIDATE?.trim();
const failedImageTag = process.env.DEPLOYMENT_ROLLBACK_FAILED_IMAGE_TAG?.trim();
const rollbackImageTag = process.env.DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG?.trim();
const drillMode = process.env.DEPLOYMENT_ROLLBACK_DRILL_MODE?.trim() ?? "failure-injection";
const drillSourceImageTag = process.env.DEPLOYMENT_ROLLBACK_DRILL_SOURCE_IMAGE_TAG?.trim() ?? failedImageTag;
const drillRollbackImageTag = process.env.DEPLOYMENT_ROLLBACK_DRILL_ROLLBACK_IMAGE_TAG?.trim() ?? rollbackImageTag;
const drillRestoredImageTag =
  process.env.DEPLOYMENT_ROLLBACK_DRILL_RESTORED_IMAGE_TAG?.trim() ??
  (drillMode === "failure-injection" ? drillRollbackImageTag : undefined);
const drillStartedAt = process.env.DEPLOYMENT_ROLLBACK_DRILL_STARTED_AT?.trim();
const drillCompletedAt = process.env.DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT?.trim();
const failureInjected = process.env.DEPLOYMENT_ROLLBACK_FAILURE_INJECTED;
const failureMode = process.env.DEPLOYMENT_ROLLBACK_FAILURE_MODE?.trim();
const migrationRollbackSafe = process.env.DEPLOYMENT_ROLLBACK_MIGRATION_ROLLBACK_SAFE;
const approvedBy = process.env.DEPLOYMENT_ROLLBACK_APPROVED_BY?.trim();
const approvalReference = process.env.DEPLOYMENT_ROLLBACK_APPROVAL_REFERENCE?.trim();
const drillConfirmed = process.env.DEPLOYMENT_ROLLBACK_DRILL_CONFIRMED;
const commandLogReference = process.env.DEPLOYMENT_ROLLBACK_COMMAND_LOG_REFERENCE?.trim();
const sourceRunUrl = process.env.DEPLOYMENT_ROLLBACK_SOURCE_RUN_URL?.trim();
const sourceUatArtifactUrl = process.env.DEPLOYMENT_ROLLBACK_SOURCE_UAT_ARTIFACT_URL?.trim();
const rollbackRunUrl = process.env.DEPLOYMENT_ROLLBACK_ROLLBACK_RUN_URL?.trim();
const rollbackUatArtifactUrl = process.env.DEPLOYMENT_ROLLBACK_ROLLBACK_UAT_ARTIFACT_URL?.trim();
const restoredRunUrl = process.env.DEPLOYMENT_ROLLBACK_RESTORED_RUN_URL?.trim();
const restoredUatArtifactUrl = process.env.DEPLOYMENT_ROLLBACK_RESTORED_UAT_ARTIFACT_URL?.trim();
const checkedAt = new Date().toISOString();

const failures = [];
requireValue(outputPath, "DEPLOYMENT_ROLLBACK_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireEvidenceValue(releaseCandidate, "DEPLOYMENT_ROLLBACK_RELEASE_CANDIDATE", failures);
requireEvidenceValue(rollbackImageTag, "DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG", failures);
requireImageCommitSha(releaseCandidate, "DEPLOYMENT_ROLLBACK_RELEASE_CANDIDATE", failures);
requireImageCommitSha(rollbackImageTag, "DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG", failures);
requireDifferent(releaseCandidate, rollbackImageTag, "DEPLOYMENT_ROLLBACK_RELEASE_CANDIDATE", "DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG", failures);
requireOneOf(drillMode, "DEPLOYMENT_ROLLBACK_DRILL_MODE", Object.keys(requiredCommandsByMode), failures);
requireEvidenceValue(drillSourceImageTag, "DEPLOYMENT_ROLLBACK_DRILL_SOURCE_IMAGE_TAG", failures);
requireEvidenceValue(drillRollbackImageTag, "DEPLOYMENT_ROLLBACK_DRILL_ROLLBACK_IMAGE_TAG", failures);
requireEvidenceValue(drillRestoredImageTag, "DEPLOYMENT_ROLLBACK_DRILL_RESTORED_IMAGE_TAG", failures);
requireImageCommitSha(drillSourceImageTag, "DEPLOYMENT_ROLLBACK_DRILL_SOURCE_IMAGE_TAG", failures);
requireImageCommitSha(drillRollbackImageTag, "DEPLOYMENT_ROLLBACK_DRILL_ROLLBACK_IMAGE_TAG", failures);
requireImageCommitSha(drillRestoredImageTag, "DEPLOYMENT_ROLLBACK_DRILL_RESTORED_IMAGE_TAG", failures);
requireDifferent(drillSourceImageTag, drillRollbackImageTag, "DEPLOYMENT_ROLLBACK_DRILL_SOURCE_IMAGE_TAG", "DEPLOYMENT_ROLLBACK_DRILL_ROLLBACK_IMAGE_TAG", failures);
const expectedRepository = getImageRepository(releaseCandidate);
requireImageRepository(expectedRepository, "DEPLOYMENT_ROLLBACK_RELEASE_CANDIDATE", failures);
for (const [value, label] of [
  [rollbackImageTag, "DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG"],
  [drillSourceImageTag, "DEPLOYMENT_ROLLBACK_DRILL_SOURCE_IMAGE_TAG"],
  [drillRollbackImageTag, "DEPLOYMENT_ROLLBACK_DRILL_ROLLBACK_IMAGE_TAG"],
  [drillRestoredImageTag, "DEPLOYMENT_ROLLBACK_DRILL_RESTORED_IMAGE_TAG"],
]) {
  requireMatchingImageRepository(value, expectedRepository, label, failures);
}
requireDate(drillStartedAt, "DEPLOYMENT_ROLLBACK_DRILL_STARTED_AT", failures);
requireDate(drillCompletedAt, "DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT", failures);
requireDateNotInFuture(drillStartedAt, "DEPLOYMENT_ROLLBACK_DRILL_STARTED_AT", failures);
requireDateNotInFuture(drillCompletedAt, "DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT", failures);
requireDateNotAfter(drillStartedAt, drillCompletedAt, "DEPLOYMENT_ROLLBACK_DRILL_STARTED_AT", "DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT", failures);
requireDateNotAfter(drillCompletedAt, checkedAt, "DEPLOYMENT_ROLLBACK_DRILL_COMPLETED_AT", "checkedAt", failures);
if (drillMode === "failure-injection") {
  requireTrue(failureInjected, "DEPLOYMENT_ROLLBACK_FAILURE_INJECTED", failures);
  requireEvidenceValue(failureMode, "DEPLOYMENT_ROLLBACK_FAILURE_MODE", failures);
  requireEqual(drillRestoredImageTag, drillRollbackImageTag, "DEPLOYMENT_ROLLBACK_DRILL_RESTORED_IMAGE_TAG", "DEPLOYMENT_ROLLBACK_DRILL_ROLLBACK_IMAGE_TAG", failures);
}
if (drillMode === "cold-rollback-rehearsal") {
  requireFalse(failureInjected, "DEPLOYMENT_ROLLBACK_FAILURE_INJECTED", failures);
  requireEmpty(failureMode, "DEPLOYMENT_ROLLBACK_FAILURE_MODE", failures);
  requireEqual(drillRestoredImageTag, drillSourceImageTag, "DEPLOYMENT_ROLLBACK_DRILL_RESTORED_IMAGE_TAG", "DEPLOYMENT_ROLLBACK_DRILL_SOURCE_IMAGE_TAG", failures);
}
requireTrue(migrationRollbackSafe, "DEPLOYMENT_ROLLBACK_MIGRATION_ROLLBACK_SAFE", failures);
requireTrue(drillConfirmed, "DEPLOYMENT_ROLLBACK_DRILL_CONFIRMED", failures);
requireEvidenceValue(approvedBy, "DEPLOYMENT_ROLLBACK_APPROVED_BY", failures);
requireEvidenceValue(approvalReference, "DEPLOYMENT_ROLLBACK_APPROVAL_REFERENCE", failures);
requireEvidenceReference(commandLogReference, "DEPLOYMENT_ROLLBACK_COMMAND_LOG_REFERENCE", failures);
requireGithubRunUrl(sourceRunUrl, "DEPLOYMENT_ROLLBACK_SOURCE_RUN_URL", failures);
requireGithubArtifactUrl(sourceUatArtifactUrl, sourceRunUrl, "DEPLOYMENT_ROLLBACK_SOURCE_UAT_ARTIFACT_URL", failures);
requireGithubRunUrl(rollbackRunUrl, "DEPLOYMENT_ROLLBACK_ROLLBACK_RUN_URL", failures);
requireGithubArtifactUrl(rollbackUatArtifactUrl, rollbackRunUrl, "DEPLOYMENT_ROLLBACK_ROLLBACK_UAT_ARTIFACT_URL", failures);
requireGithubRunUrl(restoredRunUrl, "DEPLOYMENT_ROLLBACK_RESTORED_RUN_URL", failures);
requireGithubArtifactUrl(restoredUatArtifactUrl, restoredRunUrl, "DEPLOYMENT_ROLLBACK_RESTORED_UAT_ARTIFACT_URL", failures);
if (drillMode === "failure-injection") {
  requireEqual(restoredRunUrl, rollbackRunUrl, "DEPLOYMENT_ROLLBACK_RESTORED_RUN_URL", "DEPLOYMENT_ROLLBACK_ROLLBACK_RUN_URL", failures);
  requireEqual(restoredUatArtifactUrl, rollbackUatArtifactUrl, "DEPLOYMENT_ROLLBACK_RESTORED_UAT_ARTIFACT_URL", "DEPLOYMENT_ROLLBACK_ROLLBACK_UAT_ARTIFACT_URL", failures);
}
if (drillMode === "cold-rollback-rehearsal") {
  requireDifferent(restoredRunUrl, sourceRunUrl, "DEPLOYMENT_ROLLBACK_RESTORED_RUN_URL", "DEPLOYMENT_ROLLBACK_SOURCE_RUN_URL", failures);
  requireDifferent(restoredUatArtifactUrl, sourceUatArtifactUrl, "DEPLOYMENT_ROLLBACK_RESTORED_UAT_ARTIFACT_URL", "DEPLOYMENT_ROLLBACK_SOURCE_UAT_ARTIFACT_URL", failures);
}

const servicesVerified = serviceNames.map((service) => readService(service, failures));
requireServiceRollbackImageVersions(servicesVerified, drillRollbackImageTag, failures);
for (const service of servicesVerified) requireMatchingImageRepository(service.imageTag, expectedRepository, `${service.service}.imageTag`, failures);
let verifiedCheckpoints = {};
if (failures.length === 0) {
  verifiedCheckpoints = await verifyGithubCheckpoints(expectedRepository, {
    source: { imageTag: drillSourceImageTag, runUrl: sourceRunUrl, uatArtifactUrl: sourceUatArtifactUrl },
    rollback: { imageTag: drillRollbackImageTag, runUrl: rollbackRunUrl, uatArtifactUrl: rollbackUatArtifactUrl },
    restored: { imageTag: drillRestoredImageTag, runUrl: restoredRunUrl, uatArtifactUrl: restoredUatArtifactUrl },
  }, failures);
}
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const report = {
  schemaVersion: 2,
  result: "PASS",
  environment,
  checkedAt,
  releaseCandidate,
  rollbackImageTag,
  drill: {
    mode: drillMode,
    sourceImageTag: drillSourceImageTag,
    rollbackImageTag: drillRollbackImageTag,
    restoredImageTag: drillRestoredImageTag,
    startedAt: drillStartedAt,
    completedAt: drillCompletedAt,
    failureInjected: drillMode === "failure-injection",
    failureMode: drillMode === "failure-injection" ? failureMode : null,
    evidence: {
      commandLogReference,
      source: checkpointEvidence(drillSourceImageTag, sourceRunUrl, sourceUatArtifactUrl, verifiedCheckpoints.source),
      rollback: checkpointEvidence(drillRollbackImageTag, rollbackRunUrl, rollbackUatArtifactUrl, verifiedCheckpoints.rollback),
      restored: checkpointEvidence(drillRestoredImageTag, restoredRunUrl, restoredUatArtifactUrl, verifiedCheckpoints.restored),
    },
  },
  migrationRollbackSafe: true,
  commandsPassed: requiredCommandsByMode[drillMode],
  servicesVerified,
  approval: { approvedBy, approvalReference },
  evidenceReferences: [...new Set([
    commandLogReference,
    sourceRunUrl,
    sourceUatArtifactUrl,
    rollbackRunUrl,
    rollbackUatArtifactUrl,
    restoredRunUrl,
    restoredUatArtifactUrl,
  ])],
  gaps: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile);
runCheck(outputFile);
console.log(`Deployment rollback kanıtı yazıldı: ${outputFile}`);

function checkpointEvidence(imageTag, runUrl, uatArtifactUrl, metadata) {
  return {
    sha: getImageVersion(imageTag),
    runUrl,
    uatArtifactUrl,
    artifactName: metadata.artifactName,
    artifactDigest: metadata.artifactDigest,
  };
}

function readService(service, output) {
  const prefix = `DEPLOYMENT_ROLLBACK_${service.toUpperCase().replace(/[^A-Z0-9]/g, "_")}`;
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

function requireFalse(value, label, output) {
  if (value !== "false") output.push(`${label} false olmalı.`);
}

function requireEmpty(value, label, output) {
  if (typeof value === "string" && value.trim() !== "") output.push(`${label} cold-rollback-rehearsal modunda boş olmalı.`);
}

function requireEqual(first, second, firstLabel, secondLabel, output) {
  if (first && second && first !== second) output.push(`${firstLabel} ${secondLabel} ile eşleşmeli.`);
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
      output.push(`${item.service}.imageTag DEPLOYMENT_ROLLBACK_DRILL_ROLLBACK_IMAGE_TAG versiyonuyla eşleşmeli.`);
    }
  }
}

function requireImageCommitSha(value, label, output) {
  const version = getImageVersion(value);
  if (!version || !/^[a-f0-9]{40}$/.test(version)) {
    output.push(`${label} 40 karakter lowercase commit SHA tag'i taşımalı.`);
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

function requireImageRepository(value, label, output) {
  if (!value) output.push(`${label} ghcr.io/<owner>/<repo>/<service>:<sha> biçiminde olmalı.`);
}

function requireMatchingImageRepository(value, expectedRepository, label, output) {
  if (expectedRepository && getImageRepository(value) !== expectedRepository) {
    output.push(`${label} DEPLOYMENT_ROLLBACK_RELEASE_CANDIDATE repository ile eşleşmeli.`);
  }
}

async function verifyGithubCheckpoints(repository, checkpoints, output) {
  const verified = {};
  for (const [key, checkpoint] of Object.entries(checkpoints)) {
    verified[key] = await verifyGithubCheckpoint(repository, key, checkpoint, output);
  }
  return verified;
}

async function verifyGithubCheckpoint(repository, key, checkpoint, output) {
  const runMatch = checkpoint.runUrl.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/([1-9][0-9]*)$/);
  const artifactMatch = checkpoint.uatArtifactUrl.match(
    /^https:\/\/github\.com\/([^/]+\/[^/]+)\/actions\/runs\/([1-9][0-9]*)\/artifacts\/([1-9][0-9]*)$/,
  );
  if (!runMatch || !artifactMatch || runMatch[1] !== repository || artifactMatch[1] !== repository) {
    output.push(`DEPLOYMENT_ROLLBACK ${key} GitHub run/artifact repository release image ile eşleşmeli.`);
    return {};
  }

  const sha = getImageVersion(checkpoint.imageTag);
  const runId = runMatch[2];
  const artifactId = artifactMatch[3];
  try {
    const run = await fetchGithubJson(`https://api.github.com/repos/${repository}/actions/runs/${runId}`);
    if (run.repository?.full_name !== repository || String(run.id) !== runId || run.head_sha !== sha || run.conclusion !== "success") {
      output.push(`DEPLOYMENT_ROLLBACK ${key} GitHub run repository/head SHA/success bağı geçersiz.`);
    }

    const artifact = await fetchGithubJson(`https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}`);
    const expectedName = `staging-activation-evidence-${sha}`;
    if (
      String(artifact.id) !== artifactId ||
      artifact.expired !== false ||
      artifact.name !== expectedName ||
      artifact.workflow_run?.id !== Number(runId) ||
      artifact.workflow_run?.head_sha !== sha ||
      typeof artifact.digest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/.test(artifact.digest)
    ) {
      output.push(`DEPLOYMENT_ROLLBACK ${key} UAT artifact run/head SHA/name/digest bağı geçersiz.`);
    }
    return { artifactName: artifact.name, artifactDigest: artifact.digest };
  } catch (error) {
    output.push(`DEPLOYMENT_ROLLBACK ${key} GitHub kanıtı doğrulanamadı: ${error instanceof Error ? error.message : "unknown error"}`);
    return {};
  }
}

async function fetchGithubJson(url) {
  const token = process.env.GITHUB_TOKEN?.trim();
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "o-okul-deployment-rollback-evidence/1.0",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub API HTTP ${response.status}`);
  return response.json();
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

function requireGithubRunUrl(value, label, output) {
  requireEvidenceReference(value, label, output);
  if (typeof value === "string" && !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/[1-9][0-9]*$/.test(value)) {
    output.push(`${label} canonical GitHub Actions run URL olmalı.`);
  }
}

function requireGithubArtifactUrl(value, runUrl, label, output) {
  requireEvidenceReference(value, label, output);
  const match = typeof value === "string"
    ? value.match(/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/actions\/runs\/([1-9][0-9]*)\/artifacts\/[1-9][0-9]*$/)
    : undefined;
  if (!match) {
    output.push(`${label} canonical GitHub Actions artifact URL olmalı.`);
    return;
  }
  const expectedRunId = typeof runUrl === "string" ? runUrl.match(/\/actions\/runs\/([1-9][0-9]*)$/)?.[1] : undefined;
  if (expectedRunId && match[1] !== expectedRunId) {
    output.push(`${label} ilgili run URL ile aynı GitHub run'a ait olmalı.`);
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
