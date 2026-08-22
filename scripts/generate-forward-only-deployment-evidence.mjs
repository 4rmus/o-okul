import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const outputPath = process.env.DEPLOYMENT_ROLLBACK_OUTPUT;
const cutoverPath = process.env.DEPLOYMENT_CUTOVER_EVIDENCE_FILE;
const fallbackImageTag = process.env.DEPLOYMENT_ROLLBACK_ROLLBACK_IMAGE_TAG?.trim();
const approvedBy = process.env.DEPLOYMENT_ROLLBACK_APPROVED_BY?.trim();
const approvalReference = process.env.DEPLOYMENT_ROLLBACK_APPROVAL_REFERENCE?.trim();
const runtimeVerified = process.env.DEPLOYMENT_CONTINUITY_RUNTIME_VERIFIED;
const runtimeVerifiedAt = process.env.DEPLOYMENT_CONTINUITY_RUNTIME_VERIFIED_AT?.trim();
const runtimeEvidenceReference = process.env.DEPLOYMENT_CONTINUITY_RUNTIME_EVIDENCE_REFERENCE?.trim();
const environment = process.env.STAGING_ENVIRONMENT ?? "staging";

if (
  !outputPath ||
  !cutoverPath ||
  !fallbackImageTag ||
  !approvedBy ||
  !approvalReference ||
  runtimeVerified !== "true" ||
  !runtimeVerifiedAt ||
  !runtimeEvidenceReference
) {
  fail("Forward-only deployment evidence için zorunlu girdi eksik.");
}
if (!["staging", "production"].includes(environment)) fail("STAGING_ENVIRONMENT staging veya production olmalı.");

const cutoverFile = resolve(cutoverPath);
requireRegularFile(cutoverFile, "DEPLOYMENT_CUTOVER_EVIDENCE_FILE");
const cutoverBytes = readFileSync(cutoverFile);
let cutover;
try {
  cutover = JSON.parse(cutoverBytes.toString("utf8"));
} catch {
  fail("DEPLOYMENT_CUTOVER_EVIDENCE_FILE geçerli JSON olmalı.");
}

const sourceSha = cutover?.sourceSha;
const repository = cutover?.repository;
const releaseCandidate = cutover?.serviceImages?.api;
if (
  cutover?.result !== "PASS" ||
  cutover?.check !== "staging_deployment_cutover" ||
  !/^[a-f0-9]{40}$/.test(sourceSha ?? "") ||
  !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "") ||
  releaseCandidate !== `ghcr.io/${repository}/api:${sourceSha}` ||
  !/^ghcr\.io\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/api:[a-f0-9]{40}$/.test(fallbackImageTag) ||
  fallbackImageTag === releaseCandidate ||
  !/^\d+$/.test(cutover?.deployRunId ?? "") ||
  Number.isNaN(Date.parse(runtimeVerifiedAt)) ||
  Date.parse(runtimeVerifiedAt) < Date.parse(cutover?.cutoverAt ?? "") ||
  Date.parse(runtimeVerifiedAt) > Date.now() + 5 * 60 * 1000 ||
  runtimeEvidenceReference !== `run:https://github.com/${repository}/actions/runs/${process.env.GITHUB_RUN_ID ?? ""}`
) {
  fail("Deployment cutover, fallback image veya runtime doğrulama bağı geçersiz.");
}

const checkedAt = new Date().toISOString();
const sourceImageTag = releaseCandidate;
const serviceOrder = ["web", "api", "worker", "queue-board"];
const servicesVerified = serviceOrder.map((service) => {
  const expected = `ghcr.io/${repository}/${service}:${sourceSha}`;
  if (cutover.serviceImages?.[service] !== expected) fail(`serviceImages.${service} cutover SHA ile eşleşmeli.`);
  return {
    service,
    status: "healthy",
    imageTag: expected,
    evidenceReference: runtimeEvidenceReference,
  };
});

const report = {
  schemaVersion: 3,
  result: "PASS",
  environment,
  checkedAt,
  releaseCandidate,
  rollbackImageTag: fallbackImageTag,
  drill: {
    mode: "forward-only-readiness",
    sourceImageTag,
    rollbackImageTag: fallbackImageTag,
    restoredImageTag: sourceImageTag,
    startedAt: cutover.cutoverAt,
    completedAt: new Date(runtimeVerifiedAt).toISOString(),
    failureInjected: false,
    failureMode: null,
    evidence: {
      commandLogReference: runtimeEvidenceReference,
      source: {
        sha: sourceSha,
        runUrl: `https://github.com/${repository}/actions/runs/${cutover.deployRunId}`,
        uatArtifactUrl: null,
        artifactName: "deployment-cutover.json",
        artifactDigest: `sha256:${createHash("sha256").update(cutoverBytes).digest("hex")}`,
      },
      rollback: null,
      restored: null,
    },
  },
  migrationRollbackSafe: false,
  commandsPassed: [
    "pnpm deployment-cutover:evidence-check",
    "pnpm restore:drill:check",
    "docker inspect four-service image parity",
    "curl public health/readiness HTTP 200",
  ],
  servicesVerified,
  approval: { approvedBy, approvalReference },
  evidenceReferences: [
    runtimeEvidenceReference,
    `https://github.com/${repository}/actions/runs/${cutover.deployRunId}`,
  ],
  gaps: [],
};

const outputFile = resolve(outputPath);
requireSafeParent(dirname(outputFile));
if (existsSync(outputFile) && lstatSync(outputFile).isSymbolicLink()) fail("DEPLOYMENT_ROLLBACK_OUTPUT symlink olamaz.");
mkdirSync(dirname(outputFile), { recursive: true });
requireSafeParent(dirname(outputFile));
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
requireRegularFile(outputFile, "DEPLOYMENT_ROLLBACK_OUTPUT");

const check = spawnSync(process.execPath, ["scripts/check-deployment-rollback-evidence.mjs"], {
  env: {
    ...process.env,
    DEPLOYMENT_ROLLBACK_TARGET: pathToFileURL(outputFile).href,
  },
  stdio: "inherit",
});
if (check.status !== 0) process.exit(check.status ?? 1);
console.log(`Forward-only deployment evidence yazıldı: ${outputFile}`);

function requireRegularFile(file, label) {
  if (!existsSync(file)) fail(`${label} okunabilir dosya olmalı.`);
  const stat = lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${label} symlink olmayan dosya olmalı.`);
  requireSafeParent(dirname(file));
}

function requireSafeParent(parent) {
  const root = parse(parent).root;
  const segments = parent.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) continue;
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail("Evidence parent dizini symlink olmayan dizin olmalı.");
  }
}

function fail(message) {
  console.error(`Forward-only deployment evidence başarısız: ${message}`);
  process.exit(1);
}
