import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(process.env.RELEASE_EVIDENCE_ARTIFACTS_DIR ?? "artifacts/staging");
const manifestPath = resolve(process.env.RELEASE_EVIDENCE_MANIFEST_TARGET ?? `${root}/release-evidence-manifest.json`);
const allowExampleEvidence = process.env.RELEASE_EVIDENCE_MANIFEST_ALLOW_EXAMPLE_EVIDENCE === "1";
const failures = [];
requireExampleEvidenceOnlyForTemplateCheck(root, allowExampleEvidence, failures);
const manifest = readJson(manifestPath, "release evidence manifest", failures);
const githubCi = readJson(resolve(root, "reports/github-ci.json"), "github-ci", failures);
const rollback = readJson(resolve(root, "reports/deployment-rollback.json"), "deployment rollback", failures);
const cutover = readJson(resolve(root, "reports/deployment-cutover.json"), "deployment cutover", failures);
const uiUat = readJson(resolve(root, "ui-ux-redesign/uat.json"), "UI/UX UAT", failures);
const loadSmoke = readJson(resolve(root, "reports/rls-load-smoke.json"), "RLS load smoke", failures);
const summaryFiles = listFiles(root).filter((path) => /^release-summary-.+\.json$/u.test(path));
if (summaryFiles.length !== 1) failures.push("Bundle tam bir release-summary-*.json içermeli.");
const summary = summaryFiles.length === 1 ? readJson(resolve(root, summaryFiles[0]), "release summary", failures) : undefined;
if (manifest && githubCi && rollback && cutover && uiUat && loadSmoke && summary) {
  validate(manifest, { githubCi, rollback, cutover, uiUat, loadSmoke, summary }, failures);
}
if (failures.length > 0) fail(failures);
console.log(`Release evidence manifest kontrolü geçti: ${manifest.entries.length} artifact, ${manifest.sourceSha}`);

function validate(value, evidence, output) {
  const keys = ["schemaVersion", "result", "environment", "repository", "sourceSha", "releaseImageTag", "deployRunId", "verifierRunId", "outboxReuseRunId", "providerReuseRunId", "aggregateReuseRunId", "cutoverAt", "generatedAt", "entries"];
  exactKeys(value, keys, "manifest", output);
  if (value.schemaVersion !== 1) output.push("manifest.schemaVersion 1 olmalı.");
  if (value.result !== "PASS" || value.environment !== "staging") output.push("manifest result PASS ve environment staging olmalı.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.repository ?? "")) output.push("manifest.repository owner/repo biçiminde olmalı.");
  if (!/^[a-f0-9]{40}$/.test(value.sourceSha ?? "") || value.releaseImageTag !== value.sourceSha) output.push("manifest sourceSha/releaseImageTag exact 40 karakter SHA olmalı.");
  if (!/^\d+$/.test(value.deployRunId ?? "") || !/^\d+$/.test(value.verifierRunId ?? "")) output.push("manifest deployRunId/verifierRunId sayısal olmalı.");
  for (const key of ["outboxReuseRunId", "providerReuseRunId", "aggregateReuseRunId"]) {
    if (value[key] !== null && !/^\d+$/.test(value[key] ?? "")) output.push(`manifest.${key} null veya sayısal olmalı.`);
  }
  for (const key of ["cutoverAt", "generatedAt"]) if (!validDate(value[key])) output.push(`manifest.${key} geçerli tarih olmalı.`);
  if (validDate(value.generatedAt) && Date.parse(value.generatedAt) > Date.now() + 5 * 60 * 1000) output.push("manifest.generatedAt gelecekte olamaz.");

  const expectedVerifierRunUrl = `https://github.com/${value.repository}/actions/runs/${value.verifierRunId}`;
  const expectedDeployRunUrl = `https://github.com/${value.repository}/actions/runs/${value.deployRunId}`;
  const expectedCiRunUrl = `https://github.com/${value.repository}/actions/runs/${evidence.githubCi.workflow?.runId}`;
  const reuseRunUrls = {
    outbox: value.outboxReuseRunId ? `https://github.com/${value.repository}/actions/runs/${value.outboxReuseRunId}` : expectedVerifierRunUrl,
    provider: value.providerReuseRunId ? `https://github.com/${value.repository}/actions/runs/${value.providerReuseRunId}` : expectedVerifierRunUrl,
    aggregate: value.aggregateReuseRunId ? `https://github.com/${value.repository}/actions/runs/${value.aggregateReuseRunId}` : expectedVerifierRunUrl,
  };
  if (
    value.repository !== evidence.cutover.repository ||
    value.repository !== evidence.githubCi.repository ||
    value.sourceSha !== evidence.cutover.sourceSha?.toLowerCase() ||
    value.sourceSha !== evidence.githubCi.commitSha?.toLowerCase() ||
    value.releaseImageTag !== evidence.cutover.releaseImageTag ||
    value.deployRunId !== String(evidence.cutover.deployRunId) ||
    value.cutoverAt !== evidence.cutover.cutoverAt
  ) {
    output.push("manifest metadata deployment-cutover/github-ci exact release bağıyla eşleşmeli.");
  }
  if (evidence.githubCi.workflow?.runUrl !== expectedCiRunUrl) output.push("github-ci workflow run URL manifest repository/run bağıyla eşleşmeli.");
  if (evidence.summary.result !== "PASS" || evidence.summary.canPromote !== true) output.push("release summary final PASS ve canPromote=true olmalı.");
  if (Date.parse(evidence.summary.generatedAt) > Date.parse(value.generatedAt)) output.push("manifest.generatedAt final summary.generatedAt öncesi olamaz.");

  const actualFiles = listFiles(root).filter((path) => path !== "release-evidence-manifest.json");
  if (!Array.isArray(value.entries) || value.entries.length !== actualFiles.length) output.push("manifest.entries bundle dosyalarını tam bir kez kapsamalı.");
  const seen = new Set();
  for (const [index, entry] of (value.entries ?? []).entries()) {
    const label = `manifest.entries.${index}`;
    exactKeys(entry, ["path", "sha256", "checker", "evidenceClass", "observedAt", "sourceSha", "runUrl"], label, output);
    if (seen.has(entry.path)) output.push(`${label}.path tekrarlı.`);
    seen.add(entry.path);
    if (!actualFiles.includes(entry.path)) output.push(`${label}.path bundle içinde mevcut plain file olmalı.`);
    if (typeof entry.path === "string" && actualFiles.includes(entry.path)) {
      const digest = createHash("sha256").update(readFileSync(resolve(root, entry.path))).digest("hex");
      if (entry.sha256 !== digest) output.push(`${label}.sha256 artifact bytes ile eşleşmeli.`);
    }
    if (typeof entry.checker !== "string" || !entry.checker.startsWith("pnpm ")) output.push(`${label}.checker pnpm gate komutu olmalı.`);
    if (!["CI", "STAGING", "DEPLOYMENT_ACTIVATION", "HISTORICAL_DRILL"].includes(entry.evidenceClass)) output.push(`${label}.evidenceClass geçersiz.`);
    if (!validDate(entry.observedAt) || Date.parse(entry.observedAt) > Date.parse(value.generatedAt)) output.push(`${label}.observedAt manifest.generatedAt öncesi geçerli tarih olmalı.`);
    if (!/^[a-f0-9]{40}$/.test(entry.sourceSha ?? "")) output.push(`${label}.sourceSha 40 karakter SHA olmalı.`);
    if (entry.evidenceClass === "STAGING" && (entry.sourceSha !== value.sourceSha || (!allowExampleEvidence && Date.parse(entry.observedAt) < Date.parse(value.cutoverAt)))) {
      output.push(`${label} STAGING exact SHA ve cutover sonrası olmalı.`);
    }
    if (entry.evidenceClass === "DEPLOYMENT_ACTIVATION" && (
      entry.sourceSha !== value.sourceSha ||
      (!allowExampleEvidence && Math.abs(Date.parse(entry.observedAt) - Date.parse(value.cutoverAt)) > 15 * 60 * 1000)
    )) output.push(`${label} DEPLOYMENT_ACTIVATION exact SHA ve cutover zamanına 15 dakika içinde bağlı olmalı.`);
    if (entry.evidenceClass === "CI" && (entry.path !== "reports/github-ci.json" || entry.sourceSha !== value.sourceSha)) output.push(`${label} CI yalnız exact github-ci artifact'i olabilir.`);
    if (entry.evidenceClass === "HISTORICAL_DRILL" && entry.path !== "reports/deployment-rollback.json") output.push(`${label} historical istisna yalnız deployment rollback olabilir.`);
    requireRunUrl(entry.runUrl, value.repository, label, output);

    const payload = entry.path.endsWith(".json") ? readJson(resolve(root, entry.path), entry.path, output) : undefined;
    if (!allowExampleEvidence && entry.path === "reports/observability-uat.json" && Date.parse(payload?.alertDelivery?.firingAt) < Date.parse(value.cutoverAt)) {
      output.push(`${label} observability alertDelivery.firingAt cutover öncesi olamaz.`);
    }
    const expectedClass = evidenceClassFor(entry.path);
    const expectedObservedAt = expectedClass === "CI"
      ? evidence.githubCi.workflow?.completedAt
      : expectedClass === "HISTORICAL_DRILL"
        ? evidence.rollback.drill?.completedAt
        : observedAtFor(entry.path, payload, evidence.uiUat, evidence.loadSmoke);
    const expectedSourceSha = expectedClass === "HISTORICAL_DRILL"
      ? imageTagSha(evidence.rollback.drill?.sourceImageTag)
      : value.sourceSha;
    const expectedRunUrl = expectedClass === "CI"
      ? expectedCiRunUrl
      : expectedClass === "HISTORICAL_DRILL"
        ? evidence.rollback.drill?.evidence?.source?.runUrl
        : expectedClass === "DEPLOYMENT_ACTIVATION"
          ? expectedDeployRunUrl
          : stagingRunUrlFor(entry.path, expectedVerifierRunUrl, reuseRunUrls);
    if (entry.evidenceClass !== expectedClass) output.push(`${label}.evidenceClass path sınıfıyla eşleşmeli.`);
    if (entry.observedAt !== expectedObservedAt) output.push(`${label}.observedAt artifact zamanıyla eşleşmeli.`);
    if (entry.sourceSha !== expectedSourceSha) output.push(`${label}.sourceSha artifact sınıfıyla eşleşmeli.`);
    if (entry.runUrl !== expectedRunUrl) output.push(`${label}.runUrl artifact sınıfıyla eşleşmeli.`);
    if (entry.checker !== checkerFor(entry.path)) output.push(`${label}.checker path gate'iyle eşleşmeli.`);
    validateExplicitSourceBinding(entry.path, payload, value.sourceSha, expectedClass, output);
  }
  for (const path of actualFiles) if (!seen.has(path)) output.push(`manifest.entries eksik path: ${path}`);
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

function observedAtFor(path, payload, uiPayload, loadPayload) {
  if (path.startsWith("ui-ux-redesign/")) return uiPayload.reproducedAt;
  if (path === "reports/db-rls-check.log" || path === "reports/db-rls-check-live.log") return loadPayload.checkedAt;
  for (const key of ["checkedAt", "generatedAt", "reproducedAt", "cutoverAt", "notBefore", "drillDate"]) {
    if (validDate(payload?.[key])) return payload[key];
  }
  return undefined;
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

function validateExplicitSourceBinding(path, payload, expectedSha, evidenceClass, output) {
  if (!payload || evidenceClass === "HISTORICAL_DRILL") return;
  for (const key of ["sourceSha", "sourceCommitSha", "commitSha", "releaseImageTag"]) {
    const value = payload[key];
    if (typeof value === "string" && /^[a-f0-9]{40}$/i.test(value) && value.toLowerCase() !== expectedSha) {
      output.push(`${path}.${key} release source SHA ile eşleşmeli.`);
    }
  }
}

function imageTagSha(value) {
  return typeof value === "string" ? value.match(/:([a-f0-9]{40})$/i)?.[1]?.toLowerCase() : undefined;
}

function listFiles(directory) {
  if (!existsSync(directory) || lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) fail(["RELEASE_EVIDENCE_ARTIFACTS_DIR plain dizin olmalı."]);
  const output = [];
  const visit = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isSymbolicLink()) fail([`Bundle symlink içeremez: ${relative(directory, path)}`]);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) output.push(relative(directory, path).replaceAll("\\", "/"));
      else fail([`Bundle plain olmayan entry içeriyor: ${relative(directory, path)}`]);
    }
  };
  visit(directory);
  return output.sort();
}

function readJson(path, label, output) {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isFile()) { output.push(`${label} plain JSON file olmalı.`); return undefined; }
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { output.push(`${label} geçerli JSON olmalı.`); return undefined; }
}

function exactKeys(value, expected, label, output) {
  if (!value || typeof value !== "object" || Array.isArray(value)) { output.push(`${label} nesnesi zorunlu.`); return; }
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) output.push(`${label} exact alan setini taşımalı.`);
}

function requireRunUrl(value, repository, label, output) {
  let url;
  try { url = new URL(value); } catch { output.push(`${label}.runUrl geçerli olmalı.`); return; }
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.username || url.password || url.search || url.hash
    || url.pathname.match(/^\/([^/]+\/[^/]+)\/actions\/runs\/\d+\/?$/u)?.[1] !== repository) output.push(`${label}.runUrl repository ile eşleşmeli.`);
}

function validDate(value) { return typeof value === "string" && !Number.isNaN(Date.parse(value)); }
function requireExampleEvidenceOnlyForTemplateCheck(path, allowed, output) {
  if (!allowed) return;
  const normalized = resolve(path).replaceAll("\\", "/");
  const allowedRoot = resolve("artifacts/prod-evidence-template-check").replaceAll("\\", "/");
  if (normalized !== allowedRoot && !normalized.startsWith(`${allowedRoot}/`)) {
    output.push("RELEASE_EVIDENCE_MANIFEST_ALLOW_EXAMPLE_EVIDENCE=1 yalnız prod evidence template fixture bundle'ında kullanılabilir.");
  }
}
function fail(messages) { console.error("Release evidence manifest kontrolü başarısız:"); for (const message of messages) console.error(`- ${message}`); process.exit(1); }
