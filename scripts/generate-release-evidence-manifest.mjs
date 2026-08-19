import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

const outputFile = resolve(process.env.RELEASE_EVIDENCE_MANIFEST_OUTPUT ?? "artifacts/staging/release-evidence-manifest.json");
const artifactsDir = resolve(process.env.RELEASE_EVIDENCE_ARTIFACTS_DIR ?? dirname(outputFile));
const repository = process.env.RELEASE_EVIDENCE_REPOSITORY?.trim();
const sourceSha = process.env.RELEASE_EVIDENCE_SOURCE_SHA?.trim()?.toLowerCase();
const releaseImageTag = process.env.RELEASE_EVIDENCE_IMAGE_TAG?.trim();
const deployRunId = process.env.RELEASE_EVIDENCE_DEPLOY_RUN_ID?.trim();
const verifierRunId = process.env.RELEASE_EVIDENCE_VERIFIER_RUN_ID?.trim();
const outboxReuseRunId = process.env.RELEASE_EVIDENCE_OUTBOX_REUSE_RUN_ID?.trim() || null;
const providerReuseRunId = process.env.RELEASE_EVIDENCE_PROVIDER_REUSE_RUN_ID?.trim() || null;
const aggregateReuseRunId = process.env.RELEASE_EVIDENCE_AGGREGATE_REUSE_RUN_ID?.trim() || null;
const cutoverAt = process.env.RELEASE_EVIDENCE_CUTOVER_AT?.trim();
const allowExampleEvidence = process.env.RELEASE_EVIDENCE_MANIFEST_ALLOW_EXAMPLE_EVIDENCE === "1";
const failures = [];

if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) failures.push("RELEASE_EVIDENCE_REPOSITORY owner/repo biçiminde olmalı.");
if (!/^[a-f0-9]{40}$/.test(sourceSha ?? "")) failures.push("RELEASE_EVIDENCE_SOURCE_SHA 40 karakter hex SHA olmalı.");
if (releaseImageTag !== sourceSha) failures.push("RELEASE_EVIDENCE_IMAGE_TAG source SHA ile aynı exact tag olmalı.");
for (const [label, value] of [["RELEASE_EVIDENCE_DEPLOY_RUN_ID", deployRunId], ["RELEASE_EVIDENCE_VERIFIER_RUN_ID", verifierRunId]]) {
  if (!/^\d+$/.test(value ?? "")) failures.push(`${label} sayısal run ID olmalı.`);
}
for (const [label, value] of [
  ["RELEASE_EVIDENCE_OUTBOX_REUSE_RUN_ID", outboxReuseRunId],
  ["RELEASE_EVIDENCE_PROVIDER_REUSE_RUN_ID", providerReuseRunId],
  ["RELEASE_EVIDENCE_AGGREGATE_REUSE_RUN_ID", aggregateReuseRunId],
]) {
  if (value !== null && !/^\d+$/.test(value)) failures.push(`${label} boş veya sayısal run ID olmalı.`);
}
if (!validDate(cutoverAt) || Date.parse(cutoverAt) > Date.now() + 5 * 60 * 1000) failures.push("RELEASE_EVIDENCE_CUTOVER_AT geçerli ve gelecekte olmayan tarih olmalı.");
if (artifactsDir !== dirname(outputFile) || basename(outputFile) !== "release-evidence-manifest.json") {
  failures.push("Manifest artifacts root altında release-evidence-manifest.json olmalı.");
}
requireExampleEvidenceOnlyForTemplateCheck(artifactsDir, allowExampleEvidence, failures);
if (failures.length > 0) fail(failures);

const files = listPlainFiles(artifactsDir).filter((file) => resolve(file) !== outputFile);
const githubCi = readJson(resolve(artifactsDir, "reports/github-ci.json"), "github-ci");
const rollback = readJson(resolve(artifactsDir, "reports/deployment-rollback.json"), "deployment rollback");
const uiUat = readJson(resolve(artifactsDir, "ui-ux-redesign/uat.json"), "UI/UX UAT");
const loadSmoke = readJson(resolve(artifactsDir, "reports/rls-load-smoke.json"), "RLS load smoke");
const verifierRunUrl = `https://github.com/${repository}/actions/runs/${verifierRunId}`;
const deployRunUrl = `https://github.com/${repository}/actions/runs/${deployRunId}`;
const ciRunUrl = `https://github.com/${repository}/actions/runs/${githubCi.workflow?.runId}`;
const reuseRunUrls = {
  outbox: outboxReuseRunId ? `https://github.com/${repository}/actions/runs/${outboxReuseRunId}` : verifierRunUrl,
  provider: providerReuseRunId ? `https://github.com/${repository}/actions/runs/${providerReuseRunId}` : verifierRunUrl,
  aggregate: aggregateReuseRunId ? `https://github.com/${repository}/actions/runs/${aggregateReuseRunId}` : verifierRunUrl,
};
if (githubCi.commitSha?.toLowerCase() !== sourceSha || githubCi.workflow?.runUrl !== ciRunUrl) {
  fail(["GitHub CI artifact exact source SHA/repository run bağıyla eşleşmeli."]);
}

const entries = files.map((file) => {
  const path = relative(artifactsDir, file).replaceAll("\\", "/");
  const payload = path.endsWith(".json") ? readJson(file, path) : undefined;
  const evidenceClass = evidenceClassFor(path);
  const observedAt = evidenceClass === "CI"
    ? githubCi.workflow.completedAt
    : evidenceClass === "HISTORICAL_DRILL"
      ? rollback.drill?.completedAt
      : observedAtFor(path, payload, uiUat, loadSmoke);
  const entrySourceSha = evidenceClass === "HISTORICAL_DRILL"
    ? imageTagSha(rollback.drill?.sourceImageTag)
    : sourceSha;
  const runUrl = evidenceClass === "CI"
    ? ciRunUrl
    : evidenceClass === "HISTORICAL_DRILL"
      ? rollback.drill?.evidence?.source?.runUrl
      : evidenceClass === "DEPLOYMENT_ACTIVATION"
        ? deployRunUrl
        : stagingRunUrlFor(path, verifierRunUrl, reuseRunUrls);

  if (!validDate(observedAt) || Date.parse(observedAt) > Date.now() + 5 * 60 * 1000) failures.push(`${path} observedAt geçerli ve gelecekte olmayan tarih olmalı.`);
  if (!allowExampleEvidence && evidenceClass === "STAGING" && Date.parse(observedAt) < Date.parse(cutoverAt)) failures.push(`${path} cutover öncesi stale artifact; STAGING exact-SHA kanıtı olamaz.`);
  if (!allowExampleEvidence && evidenceClass === "DEPLOYMENT_ACTIVATION" && Math.abs(Date.parse(observedAt) - Date.parse(cutoverAt)) > 15 * 60 * 1000) failures.push(`${path} cutover zamanından 15 dakikadan uzak; deploy activation kanıtı olamaz.`);
  if (!allowExampleEvidence && path === "reports/observability-uat.json" && Date.parse(payload?.alertDelivery?.firingAt) < Date.parse(cutoverAt)) failures.push(`${path} alertDelivery.firingAt cutover öncesi olamaz.`);
  if (!/^[a-f0-9]{40}$/.test(entrySourceSha ?? "")) failures.push(`${path} sourceSha 40 karakter hex olmalı.`);
  if (evidenceClass !== "HISTORICAL_DRILL" && entrySourceSha !== sourceSha) failures.push(`${path} sourceSha release source SHA ile eşleşmeli.`);
  requireRunUrl(runUrl, repository, path, failures);
  validateExplicitSourceBinding(path, payload, sourceSha, evidenceClass, failures);

  return {
    path,
    sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    checker: checkerFor(path),
    evidenceClass,
    observedAt,
    sourceSha: entrySourceSha,
    runUrl,
  };
});
if (failures.length > 0) fail(failures);

const manifest = {
  schemaVersion: 1,
  result: "PASS",
  environment: "staging",
  repository,
  sourceSha,
  releaseImageTag,
  deployRunId,
  verifierRunId,
  outboxReuseRunId,
  providerReuseRunId,
  aggregateReuseRunId,
  cutoverAt,
  generatedAt: new Date().toISOString(),
  entries,
};
writeFileSync(outputFile, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(`Release evidence manifest yazıldı: ${entries.length} artifact, ${sourceSha}`);

function observedAtFor(path, payload, uiPayload, loadPayload) {
  if (path.startsWith("ui-ux-redesign/")) return uiPayload.reproducedAt;
  if (path === "reports/db-rls-check.log" || path === "reports/db-rls-check-live.log") return loadPayload.checkedAt;
  for (const key of ["checkedAt", "generatedAt", "reproducedAt", "cutoverAt", "notBefore", "drillDate"]) {
    if (validDate(payload?.[key])) return payload[key];
  }
  return undefined;
}

function evidenceClassFor(path) {
  if (path === "reports/deployment-rollback.json") return "HISTORICAL_DRILL";
  if (path === "reports/github-ci.json") return "CI";
  if (path === "reports/deployment-cutover.json" || path === "smoke/wal-archive.json") return "DEPLOYMENT_ACTIVATION";
  return "STAGING";
}

function stagingRunUrlFor(path, defaultRunUrl, reuseRunUrls) {
  if (path === "smoke/secret-delivery-outbox.json") return reuseRunUrls.outbox;
  if (["smoke/sentry-event.json", "smoke/alert-webhook.json", "smoke/notification-provider.json"].includes(path)) return reuseRunUrls.provider;
  if (path === "smoke/report-generation.json") return reuseRunUrls.aggregate;
  return defaultRunUrl;
}

function validateExplicitSourceBinding(path, payload, expectedSha, evidenceClass, output) {
  if (!payload || evidenceClass === "HISTORICAL_DRILL") return;
  for (const key of ["sourceSha", "sourceCommitSha", "commitSha", "releaseImageTag"]) {
    const value = payload[key];
    if (typeof value === "string" && /^[a-f0-9]{40}$/i.test(value) && value.toLowerCase() !== expectedSha) {
      output.push(`${path}.${key} release source SHA ile eşleşmeli.`);
    }
  }
}

function checkerFor(path) {
  if (path.startsWith("ui-ux-redesign/") && path.endsWith(".png")) return "pnpm ui-ux-redesign:evidence-check";
  if (path.startsWith("first-gates/")) return "pnpm staging:first-gates:check";
  if (path.startsWith("smoke/")) return "pnpm prod:evidence:check";
  if (path === "reports/runtime-parity.json") return "pnpm runtime-parity:check";
  if (path === "reports/live-onboarding.json") return "pnpm live:onboarding:result-check";
  if (path === "reports/db-rls-check.log" || path === "reports/db-rls-check-live.log" || path === "reports/rls-load-smoke.json") return "pnpm rls:live:check";
  if (/^release-summary-.+\.json$/u.test(path)) return "pnpm prod:evidence:summary:check";
  return "pnpm staging:release-artifacts:check";
}

function listPlainFiles(root) {
  if (!existsSync(root) || lstatSync(root).isSymbolicLink() || !lstatSync(root).isDirectory()) fail(["RELEASE_EVIDENCE_ARTIFACTS_DIR symlink olmayan dizin olmalı."]);
  const output = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) fail([`Bundle symlink içeremez: ${relative(root, path)}`]);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(path);
      else fail([`Bundle plain file/directory dışında entry içeremez: ${relative(root, path)}`]);
    }
  };
  visit(root);
  return output.sort();
}

function readJson(path, label) {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !statSync(path).isFile()) fail([`${label} plain JSON artifact olmalı.`]);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    fail([`${label} geçerli JSON olmalı.`]);
  }
}

function imageTagSha(value) {
  return typeof value === "string" ? value.match(/:([a-f0-9]{40})$/i)?.[1]?.toLowerCase() : undefined;
}

function requireRunUrl(value, expectedRepository, label, output) {
  let url;
  try { url = new URL(value); } catch { output.push(`${label} runUrl geçerli olmalı.`); return; }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash
    || url.pathname.match(/^\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/?$/u)?.[1] !== expectedRepository) {
    output.push(`${label} runUrl repository ile eşleşen secret taşımayan GitHub Actions URL olmalı.`);
  }
}

function validDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function requireExampleEvidenceOnlyForTemplateCheck(path, allowed, output) {
  if (!allowed) return;
  const normalized = resolve(path).replaceAll("\\", "/");
  const allowedRoot = resolve("artifacts/prod-evidence-template-check").replaceAll("\\", "/");
  if (normalized !== allowedRoot && !normalized.startsWith(`${allowedRoot}/`)) {
    output.push("RELEASE_EVIDENCE_MANIFEST_ALLOW_EXAMPLE_EVIDENCE=1 yalnız prod evidence template fixture bundle'ında kullanılabilir.");
  }
}

function fail(messages) {
  console.error("Release evidence manifest üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
