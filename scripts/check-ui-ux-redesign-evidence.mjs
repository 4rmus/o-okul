import { createHash } from "node:crypto";
import { existsSync, lstatSync } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { isIP } from "node:net";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pinnedHttpsFetch } from "./pinned-https-fetch.mjs";
import { inspectPng } from "./png-artifact.mjs";

const target = process.env.UI_UX_REDESIGN_EVIDENCE_TARGET ?? process.argv[2];
const allowExampleEvidence = process.env.UI_UX_REDESIGN_ALLOW_EXAMPLE_EVIDENCE === "1";
const verifyRemoteReferences = process.env.UI_UX_REDESIGN_VERIFY_REMOTE_REFERENCES === "1";

const topLevelKeys = [
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
];
const githubCiKeys = ["repository", "commitSha", "workflowPath", "runId", "runUrl", "completedAt", "conclusion", "successfulJobs"];
const artifactKeys = [
  "reference",
  "mediaType",
  "byteSize",
  "sha256",
  "surface",
  "viewportWidth",
  "imageWidth",
  "imageHeight",
  "piiReview",
];
const localKeys = ["result", "releaseBlocking", "commandsPassed", "note"];
const releaseKeys = ["result", "requiredForRelease", "commandsPassed", "evidenceReferences"];
const phaseKeys = ["phase", "status", "scope", "commandsPassed", "evidenceReferences"];
const viewportKeys = ["surface", "widths", "evidenceReferences"];
const privacyKeys = [
  "piiReview",
  "reviewReference",
  "rawPiiInArtifacts",
  "smsRecipientPreviewExported",
  "guardianFinanceLeakageChecked",
  "forbiddenRawFields",
];
const approvalKeys = ["role", "approvedBy", "decision", "approvedAt", "sourceCommitSha", "runUrl"];

const requiredPhases = ["Faz 0", "Faz 1", "Faz 2", "Faz 3", "Faz 4", "Faz 5"];
const requiredWidths = [320, 375, 414, 768, 1024, 1440];
const requiredSurfaces = [
  "kurum dashboard",
  "system dashboard",
  "system tenants",
  "optik workspace",
  "rapor workspace",
  "portal shell",
];
const localCommands = [
  "pnpm --filter @o-okul/web typecheck",
  "pnpm web:design-tokens:check",
  "pnpm web:a11y:check",
  "pnpm web:auth-contract:check",
  "pnpm web:ux-baseline:check",
  "pnpm web:ux-contract:check",
  "pnpm web:ux-rc:check",
  "pnpm karne:visual-contract:check",
];
const releaseCommands = [
  "pnpm prod:evidence:templates:check",
  "pnpm prod:plan:check",
  "pnpm live:onboarding:smoke",
  "pnpm live:ui-worker:smoke",
  "pnpm uat:check",
];
const evidencePrefixes = ["artifact:", "https://", "run:https://", "url:https://"];
const rawPiiPatterns = [/\b\d{11}\b/, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, /\b(?:\+90|0)?5\d{9}\b/];
const forbiddenPiiKeyFragments = ["email", "phone", "nationalid", "rawanswer", "rawline", "rawrow"];
const maxArtifactBytes = 20 * 1024 * 1024;
const configuredEvidenceHosts = new Set(
  (process.env.UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean),
);

if (!target) fail(["UI_UX_REDESIGN_EVIDENCE_TARGET veya dosya argümanı boş bırakılamaz."]);

let targetUrl;
try {
  targetUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(target) ? new URL(target) : pathToFileURL(resolve(target));
} catch {
  fail(["UI_UX_REDESIGN_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
}

requireTargetUrl(targetUrl);

const report = await readJsonTarget(targetUrl);
const failures = validateReport(report);
if (failures.length === 0 && !allowExampleEvidence) {
  failures.push(...(await validateArtifactBytes(report)));
}
if (failures.length === 0 && verifyRemoteReferences) {
  failures.push(...(await validateRemoteReferences(report)));
}

if (failures.length > 0) fail(failures);

console.log(`UI/UX redesign kanıt kontrolü geçti: ${report.environment} ${report.checkedAt}`);

async function readJsonTarget(url) {
  if (url.protocol === "https:") {
    const response = await secureFetch(url, { headers: { Accept: "application/json" } });
    if (!response.ok) fail([`UI/UX redesign kanıtı okunamadı: HTTP ${response.status}`]);
    return parseJson(await response.text());
  }

  if (url.protocol !== "file:") {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET yalnız file:// veya https:// destekler."]);
  }

  const filePath = fileURLToPath(url);
  await assertParentPathAllowed(dirname(filePath));

  let stat;
  try {
    stat = await lstat(filePath);
  } catch {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET okunabilir file:// artifact olmalı."]);
  }

  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET symlink olmayan file:// artifact olmalı."]);
  }

  return parseJson(await readFile(filePath, "utf8"));
}

function validateReport(report) {
  const failures = [];
  if (!keys(report, topLevelKeys, failures, "uiUxRedesignEvidence")) return failures;

  eq(report.schemaVersion, 2, failures, "schemaVersion");
  eq(report.result, "PASS", failures, "result");
  oneOf(report.environment, ["staging", "production"], failures, "environment");
  date(report.checkedAt, failures, "checkedAt");
  notFuture(report.checkedAt, failures, "checkedAt");
  string(report.releaseCandidate, failures, "releaseCandidate");
  nonPlaceholder(report.releaseCandidate, failures, "releaseCandidate");
  commitSha(report.sourceCommitSha, failures, "sourceCommitSha");
  releaseCandidateBinding(report.releaseCandidate, report.sourceCommitSha, failures);
  validateGithubCi(report.githubCi, report.sourceCommitSha, report.checkedAt, report.stagingProductionEvidence, failures);
  validateAllowedEvidenceHosts(report.allowedEvidenceHosts, failures);
  eq(report.redesignPlanPath, "docs/ui-ux-professionalization-contract.md", failures, "redesignPlanPath");

  validateLocal(report.localStaticEvidence, failures);
  validateRelease(report.stagingProductionEvidence, failures);
  validatePhases(report.phaseEvidence, failures);
  validateViewports(report.viewportCoverage, failures);
  validateArtifacts(report, failures);
  validatePrivacy(report, failures);
  validateApprovals(report, failures);

  if (Array.isArray(report.openRisks) && report.openRisks.length > 0) failures.push("openRisks boş olmalı.");
  scanRawPii(report, failures);
  return failures;
}

async function validateRemoteReferences(report) {
  const failures = [];
  const runUrls = [...new Set(allEvidenceReferences(report).filter((reference) => reference.startsWith("run:https://"))
    .map((reference) => remoteReferenceUrl(reference)))];

  await Promise.all(
    runUrls.map(async (url) => {
      try {
        await validateGithubRun(url, report, failures);
      } catch (error) {
        failures.push(`Uzak kanıt referansı okunamadı: ${url} (${safeErrorMessage(error)})`);
      }
    }),
  );

  return failures;
}

async function validateGithubRun(url, report, failures) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    failures.push(`GitHub run exact-SHA doğrulaması için GITHUB_TOKEN zorunlu: ${url}`);
    return;
  }
  const apiUrl = githubActionsRunApiUrl(url);
  if (!apiUrl) {
    failures.push(`GitHub run URL biçimi geçersiz: ${url}`);
    return;
  }
  const headers = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "o-okul-gate-e-evidence",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const response = await secureFetch(apiUrl, { headers });
  if (!response.ok) {
    failures.push(`GitHub run kanıtı okunamadı: HTTP ${response.status} ${url}`);
    await response.body?.cancel();
    return;
  }
  const run = await response.json();
  const expectedRepository = new URL(apiUrl).pathname.match(/^\/repos\/([^/]+\/[^/]+)\/actions\/runs\/\d+$/)?.[1];
  if (run.head_sha?.toLowerCase() !== report.sourceCommitSha.toLowerCase()) failures.push(`GitHub run head_sha sourceCommitSha ile eşleşmeli: ${url}`);
  if (run.status !== "completed" || run.conclusion !== "success") failures.push(`GitHub run completed/success olmalı: ${url}`);
  if (run.path !== ".github/workflows/ci.yml") failures.push(`GitHub run .github/workflows/ci.yml olmalı: ${url}`);
  if (run.repository?.full_name !== expectedRepository) failures.push(`GitHub run repository URL ile eşleşmeli: ${url}`);
  if (run.html_url !== url) failures.push(`GitHub run html_url kanıt referansıyla eşleşmeli: ${url}`);
  if (run.repository?.full_name !== report.githubCi?.repository) failures.push(`GitHub run repository githubCi ile eşleşmeli: ${url}`);
  if (String(run.id) !== report.githubCi?.runId) failures.push(`GitHub run id githubCi ile eşleşmeli: ${url}`);

  const jobsResponse = await secureFetch(`${apiUrl}/jobs?per_page=100`, { headers });
  if (!jobsResponse.ok) {
    failures.push(`GitHub run job kanıtı okunamadı: HTTP ${jobsResponse.status} ${url}`);
    await jobsResponse.body?.cancel();
    return;
  }
  const jobs = (await jobsResponse.json()).jobs ?? [];
  const completedJobs = jobs.filter((job) => job.conclusion !== "skipped");
  if (completedJobs.length === 0 || !completedJobs.some((job) => job.conclusion === "success")) {
    failures.push(`GitHub run en az bir başarılı job içermeli: ${url}`);
  }
  if (completedJobs.some((job) => job.status !== "completed" || job.conclusion !== "success")) {
    failures.push(`GitHub run başarısız veya tamamlanmamış job içermemeli: ${url}`);
  }
  const successfulJobNames = completedJobs.filter((job) => job.conclusion === "success").map((job) => job.name).sort();
  if (JSON.stringify(successfulJobNames) !== JSON.stringify([...report.githubCi.successfulJobs].sort())) {
    failures.push(`GitHub run başarılı job listesi githubCi ile eşleşmeli: ${url}`);
  }
}

function githubActionsRunApiUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.hostname !== "github.com") return null;
  const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/actions\/runs\/(\d+)\/?$/);
  if (!match) return null;
  const [, owner, repo, runId] = match;
  return `https://api.github.com/repos/${owner}/${repo}/actions/runs/${runId}`;
}

function remoteReferenceUrl(reference) {
  if (typeof reference !== "string") return null;
  const separator = reference.indexOf(":");
  const prefix = reference.slice(0, separator + 1).toLowerCase();
  const candidate = prefix === "url:" || prefix === "run:" ? reference.slice(separator + 1) : reference;
  return candidate.startsWith("https://") ? candidate : null;
}

function validateGithubCi(value, sourceCommitSha, checkedAt, stagingEvidence, failures) {
  if (!keys(value, githubCiKeys, failures, "githubCi")) return;
  string(value.repository, failures, "githubCi.repository");
  commitSha(value.commitSha, failures, "githubCi.commitSha");
  if (typeof value.commitSha === "string" && typeof sourceCommitSha === "string" && value.commitSha.toLowerCase() !== sourceCommitSha.toLowerCase()) {
    failures.push("githubCi.commitSha sourceCommitSha ile eşleşmeli.");
  }
  eq(value.workflowPath, ".github/workflows/ci.yml", failures, "githubCi.workflowPath");
  if (typeof value.runId !== "string" || !/^\d+$/.test(value.runId)) failures.push("githubCi.runId sayısal metin olmalı.");
  date(value.completedAt, failures, "githubCi.completedAt");
  notFuture(value.completedAt, failures, "githubCi.completedAt");
  if (!Number.isNaN(Date.parse(value.completedAt)) && Date.parse(value.completedAt) > Date.parse(checkedAt)) {
    failures.push("githubCi.completedAt checkedAt zamanından sonra olamaz.");
  }
  if (!allowExampleEvidence && !Number.isNaN(Date.parse(value.completedAt)) && Date.parse(checkedAt) - Date.parse(value.completedAt) > 24 * 60 * 60 * 1000) {
    failures.push("githubCi.completedAt rapor zamanından en fazla 24 saat önce olabilir.");
  }
  eq(value.conclusion, "success", failures, "githubCi.conclusion");
  list(value.successfulJobs, failures, "githubCi.successfulJobs", 1);
  const expectedRunUrl = `https://github.com/${value.repository}/actions/runs/${value.runId}`;
  eq(value.runUrl, expectedRunUrl, failures, "githubCi.runUrl");
  if (!stagingEvidence?.evidenceReferences?.includes(`run:${value.runUrl}`)) {
    failures.push("stagingProductionEvidence exact githubCi.runUrl referansını içermeli.");
  }
}

function validateAllowedEvidenceHosts(value, failures) {
  if (!Array.isArray(value)) {
    failures.push("allowedEvidenceHosts listesi zorunlu.");
    return;
  }
  const seen = new Set();
  for (const host of value) {
    if (typeof host !== "string" || host.trim() !== host || !/^[a-z0-9.-]+$/i.test(host)) {
      failures.push("allowedEvidenceHosts yalnız hostname değerlerinden oluşmalı.");
      continue;
    }
    const normalized = host.toLowerCase();
    if (seen.has(normalized)) failures.push(`allowedEvidenceHosts tekrarlı host içeriyor: ${host}`);
    seen.add(normalized);
    if (placeholderHost(normalized) || privateIp(normalized)) failures.push(`allowedEvidenceHosts public gerçek host içermeli: ${host}`);
  }
  const embedded = [...seen].sort();
  const trusted = [...configuredEvidenceHosts].sort();
  if (JSON.stringify(embedded) !== JSON.stringify(trusted)) {
    failures.push("allowedEvidenceHosts güvenilir UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS ile birebir eşleşmeli.");
  }
}

function validateLocal(value, failures) {
  if (!keys(value, localKeys, failures, "localStaticEvidence")) return;
  eq(value.result, "PASS", failures, "localStaticEvidence.result");
  eq(value.releaseBlocking, false, failures, "localStaticEvidence.releaseBlocking");
  includes(value.commandsPassed, localCommands, failures, "localStaticEvidence.commandsPassed");
  string(value.note, failures, "localStaticEvidence.note");
}

function validateRelease(value, failures) {
  if (!keys(value, releaseKeys, failures, "stagingProductionEvidence")) return;
  eq(value.result, "PASS", failures, "stagingProductionEvidence.result");
  eq(value.requiredForRelease, true, failures, "stagingProductionEvidence.requiredForRelease");
  includes(value.commandsPassed, releaseCommands, failures, "stagingProductionEvidence.commandsPassed");
  refs(value.evidenceReferences, failures, "stagingProductionEvidence.evidenceReferences", 3);
  if (
    value.evidenceReferences?.length !== 4 ||
    !value.evidenceReferences[1]?.startsWith("run:")
  ) {
    failures.push("stagingProductionEvidence.evidenceReferences sırası summary, GitHub run, UAT, privacy review olmalı.");
  }
}

function validatePhases(value, failures) {
  if (!Array.isArray(value)) {
    failures.push("phaseEvidence alan listesi zorunlu.");
    return;
  }
  if (value.length !== requiredPhases.length) failures.push(`phaseEvidence tam ${requiredPhases.length} faz içermeli.`);

  const seen = new Set();
  for (const item of value) {
    if (!keys(item, phaseKeys, failures, `phaseEvidence.${item?.phase ?? "unknown"}`)) continue;
    if (seen.has(item.phase)) failures.push(`phaseEvidence tekrarlı faz içeriyor: ${item.phase}`);
    seen.add(item.phase);
    if (!requiredPhases.includes(item.phase)) failures.push(`phaseEvidence beklenmeyen faz içeriyor: ${item.phase}`);
    eq(item.status, "PASS", failures, `${item.phase}.status`);
    oneOf(item.scope, ["local-static", "staging-production"], failures, `${item.phase}.scope`);
    list(item.commandsPassed, failures, `${item.phase}.commandsPassed`, 1);
    refs(item.evidenceReferences, failures, `${item.phase}.evidenceReferences`, 1);
    if (item.evidenceReferences?.some((reference) => typeof reference === "string" && reference.startsWith("run:"))) {
      failures.push(`${item.phase}.evidenceReferences okunabilir JSON artifact/url olmalı; run: kullanılamaz.`);
    }
  }

  for (const phase of requiredPhases) {
    if (!seen.has(phase)) failures.push(`phaseEvidence eksik: ${phase}`);
  }

  const phase5 = value.find((item) => item?.phase === "Faz 5");
  if (phase5) {
    eq(phase5.scope, "staging-production", failures, "Faz 5.scope");
    includes(phase5.commandsPassed, ["pnpm prod:evidence:templates:check", "pnpm uat:check"], failures, "Faz 5.commandsPassed");
  }
}

function validateViewports(value, failures) {
  if (!Array.isArray(value)) {
    failures.push("viewportCoverage alan listesi zorunlu.");
    return;
  }

  const seen = new Set();
  for (const item of value) {
    if (!keys(item, viewportKeys, failures, `viewportCoverage.${item?.surface ?? "unknown"}`)) continue;
    if (seen.has(item.surface)) failures.push(`viewportCoverage tekrarlı yüzey içeriyor: ${item.surface}`);
    seen.add(item.surface);
    if (!requiredSurfaces.includes(item.surface)) failures.push(`viewportCoverage beklenmeyen yüzey içeriyor: ${item.surface}`);
    widths(item.widths, failures, `viewportCoverage.${item.surface}.widths`);
    refs(item.evidenceReferences, failures, `viewportCoverage.${item.surface}.evidenceReferences`, requiredWidths.length);
    if (item.evidenceReferences?.some((reference) => typeof reference === "string" && reference.startsWith("run:"))) {
      failures.push(`viewportCoverage.${item.surface}.evidenceReferences okunabilir PNG artifact/url olmalı; run: kullanılamaz.`);
    }
    if (Array.isArray(item.evidenceReferences) && item.evidenceReferences.length !== requiredWidths.length) {
      failures.push(`viewportCoverage.${item.surface}.evidenceReferences tam ${requiredWidths.length} referans içermeli.`);
    }
  }

  for (const surface of requiredSurfaces) {
    if (!seen.has(surface)) failures.push(`viewportCoverage eksik: ${surface}`);
  }
}

function validateArtifacts(report, failures) {
  if (!Array.isArray(report.artifacts)) {
    failures.push("artifacts listesi zorunlu.");
    return;
  }

  const expectedReferences = artifactEvidenceReferences(report);
  const roleReferences = [
    report.stagingProductionEvidence?.evidenceReferences?.[0],
    report.stagingProductionEvidence?.evidenceReferences?.[2],
    report.privacy?.reviewReference,
    ...(report.phaseEvidence ?? []).flatMap((phase) => phase.evidenceReferences ?? []),
  ].filter((reference) => typeof reference === "string" && !reference.startsWith("run:"));
  if (new Set(roleReferences).size !== roleReferences.length) {
    failures.push("Kanıt referansı birden fazla evidence rolünde kullanılamaz.");
  }
  const seen = new Map();
  for (const [index, item] of report.artifacts.entries()) {
    const label = `artifacts.${index}`;
    if (!keys(item, artifactKeys, failures, label)) continue;
    if (seen.has(item.reference)) failures.push(`${label}.reference tekrarlı: ${item.reference}`);
    seen.set(item.reference, item);
    if (!expectedReferences.has(item.reference)) failures.push(`${label}.reference kanıt yüzeylerinde kullanılmıyor.`);
    oneOf(item.mediaType, ["application/json", "image/png", "text/plain"], failures, `${label}.mediaType`);
    if (artifactContract(report, item.reference) && item.mediaType !== "application/json") {
      failures.push(`${label}.mediaType evidence rolü için application/json olmalı.`);
    }
    if (!Number.isInteger(item.byteSize) || item.byteSize <= 0) failures.push(`${label}.byteSize pozitif tam sayı olmalı.`);
    if (typeof item.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(item.sha256)) failures.push(`${label}.sha256 64 karakter hex olmalı.`);
    eq(item.piiReview, "PASS", failures, `${label}.piiReview`);

    const viewportBinding = viewportReferenceBinding(report, item.reference);
    if (viewportBinding) {
      eq(item.surface, viewportBinding.surface, failures, `${label}.surface`);
      eq(item.viewportWidth, viewportBinding.width, failures, `${label}.viewportWidth`);
      eq(item.mediaType, "image/png", failures, `${label}.mediaType`);
      eq(item.imageWidth, viewportBinding.width, failures, `${label}.imageWidth`);
      if (!Number.isInteger(item.imageHeight) || item.imageHeight <= 0) failures.push(`${label}.imageHeight pozitif tam sayı olmalı.`);
    } else {
      eq(item.surface, null, failures, `${label}.surface`);
      eq(item.viewportWidth, null, failures, `${label}.viewportWidth`);
      if (item.mediaType === "image/png") {
        if (!Number.isInteger(item.imageWidth) || item.imageWidth <= 0) failures.push(`${label}.imageWidth pozitif tam sayı olmalı.`);
        if (!Number.isInteger(item.imageHeight) || item.imageHeight <= 0) failures.push(`${label}.imageHeight pozitif tam sayı olmalı.`);
      } else {
        eq(item.imageWidth, null, failures, `${label}.imageWidth`);
        eq(item.imageHeight, null, failures, `${label}.imageHeight`);
      }
    }
  }

  if (!allowExampleEvidence) {
    for (const reference of expectedReferences) {
      if (!seen.has(reference)) failures.push(`artifacts manifesti eksik referans içeriyor: ${reference}`);
    }
  }
}

async function validateArtifactBytes(report) {
  const failures = [];
  for (const item of report.artifacts ?? []) {
    const remoteUrl = remoteReferenceUrl(item.reference);
    if (remoteUrl && !verifyRemoteReferences) continue;
    try {
      const bytes = remoteUrl
        ? await readRemoteArtifactBytes(remoteUrl)
        : await readArtifactBytes(item.reference);
      validateArtifactContent(item, bytes, report, failures);
    } catch (error) {
      failures.push(`Artifact okunamadı: ${item.reference} (${safeErrorMessage(error)})`);
    }
  }
  return failures;
}

function validateArtifactContent(item, bytes, report, failures) {
  if (bytes.byteLength !== item.byteSize) failures.push(`Artifact byteSize uyuşmuyor: ${item.reference}`);
  if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) failures.push(`Artifact sha256 uyuşmuyor: ${item.reference}`);

  const detected = detectArtifact(bytes);
  if (detected.mediaType !== item.mediaType) failures.push(`Artifact mediaType uyuşmuyor: ${item.reference}`);
  if (item.mediaType === "image/png") {
    if (detected.imageWidth !== item.imageWidth || detected.imageHeight !== item.imageHeight) {
      failures.push(`Artifact PNG ölçüsü manifestle uyuşmuyor: ${item.reference}`);
    }
    return;
  }

  const contents = bytes.toString("utf8");
  if (item.mediaType === "application/json") {
    let parsed;
    try {
      parsed = JSON.parse(contents);
    } catch {
      failures.push(`Artifact JSON geçerli olmalı: ${item.reference}`);
      return;
    }
    scanArtifactPii(parsed, item.reference, failures);
    if (parsed?.result !== "PASS") failures.push(`Artifact result PASS olmalı: ${item.reference}`);
    if (parsed?.sourceCommitSha?.toLowerCase() !== report.sourceCommitSha.toLowerCase()) {
      failures.push(`Artifact sourceCommitSha raporla eşleşmeli: ${item.reference}`);
    }
    if (parsed?.environment !== report.environment) failures.push(`Artifact environment raporla eşleşmeli: ${item.reference}`);
    if (typeof parsed?.checkedAt !== "string" || Number.isNaN(Date.parse(parsed.checkedAt)) || Date.parse(parsed.checkedAt) > Date.parse(report.checkedAt)) {
      failures.push(`Artifact checkedAt rapor zamanından geç olmamalı: ${item.reference}`);
    }
    if (!Number.isNaN(Date.parse(parsed?.checkedAt)) && Date.parse(parsed.checkedAt) < Date.parse(report.githubCi?.completedAt)) {
      failures.push(`Artifact checkedAt GitHub CI tamamlanma zamanından önce olmamalı: ${item.reference}`);
    }
    const approvalTime = Math.min(...(report.approvals ?? []).map((approval) => Date.parse(approval.approvedAt)).filter(Number.isFinite));
    if (Number.isFinite(approvalTime) && !Number.isNaN(Date.parse(parsed?.checkedAt)) && Date.parse(parsed.checkedAt) > approvalTime) {
      failures.push(`Artifact checkedAt release onayından sonra olmamalı: ${item.reference}`);
    }
    const contract = artifactContract(report, item.reference);
    if (contract) {
      if (parsed?.evidenceType !== contract.evidenceType) {
        failures.push(`Artifact evidenceType ${contract.evidenceType} olmalı: ${item.reference}`);
      }
      if (parsed?.runUrl !== report.githubCi?.runUrl) {
        failures.push(`Artifact runUrl GitHub CI run URL ile eşleşmeli: ${item.reference}`);
      }
      if (contract.commandsPassed && !sameStringSet(parsed?.commandsPassed, contract.commandsPassed)) {
        failures.push(`Artifact commandsPassed evidence rolünün exact komut setiyle eşleşmeli: ${item.reference}`);
      }
    }
    if (item.reference === report.privacy?.reviewReference) {
      validatePrivacyReviewContent(parsed, report, failures);
    }
  } else if (rawPiiPatterns.some((pattern) => pattern.test(contents))) {
    failures.push(`Artifact ham PII benzeri değer içermemeli: ${item.reference}`);
  }
}

function artifactContract(report, reference) {
  const stagingReferences = report.stagingProductionEvidence?.evidenceReferences ?? [];
  if (reference === stagingReferences[0]) {
    return { evidenceType: "ui-ux-redesign-summary", commandsPassed: releaseCommands };
  }
  if (reference === stagingReferences[2]) {
    return { evidenceType: "ui-ux-redesign-uat", commandsPassed: ["pnpm uat:check"] };
  }
  if (reference === report.privacy?.reviewReference) {
    return { evidenceType: "ui-ux-redesign-privacy-review" };
  }
  for (const phase of report.phaseEvidence ?? []) {
    if (phase.evidenceReferences?.includes(reference)) {
      return {
        evidenceType: `ui-ux-redesign-phase-${phase.phase.slice(-1)}`,
        commandsPassed: phase.commandsPassed,
      };
    }
  }
  return null;
}

function sameStringSet(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((value) => actual.includes(value));
}

function validatePrivacy(report, failures) {
  const value = report.privacy;
  if (!keys(value, privacyKeys, failures, "privacy")) return;
  eq(value.piiReview, "PASS", failures, "privacy.piiReview");
  string(value.reviewReference, failures, "privacy.reviewReference");
  if (!report.stagingProductionEvidence?.evidenceReferences?.includes(value.reviewReference)) {
    failures.push("privacy.reviewReference stagingProductionEvidence referanslarına bağlanmalı.");
  }
  if (report.stagingProductionEvidence?.evidenceReferences?.[3] !== value.reviewReference) {
    failures.push("privacy.reviewReference stagingProductionEvidence dördüncü referansı olmalı.");
  }
  eq(value.rawPiiInArtifacts, false, failures, "privacy.rawPiiInArtifacts");
  eq(value.smsRecipientPreviewExported, false, failures, "privacy.smsRecipientPreviewExported");
  eq(value.guardianFinanceLeakageChecked, true, failures, "privacy.guardianFinanceLeakageChecked");
  includes(value.forbiddenRawFields, ["email", "phone", "nationalId", "rawLine", "rawRow"], failures, "privacy.forbiddenRawFields");
}

function validateApprovals(report, failures) {
  const value = report.approvals;
  if (!Array.isArray(value) || value.length === 0) {
    failures.push("approvals boş olmayan liste olmalı.");
    return;
  }

  for (const [index, approval] of value.entries()) {
    if (!keys(approval, approvalKeys, failures, `approvals.${index}`)) continue;
    eq(approval.role, "release-owner", failures, `approvals.${index}.role`);
    string(approval.approvedBy, failures, `approvals.${index}.approvedBy`);
    nonPlaceholder(approval.approvedBy, failures, `approvals.${index}.approvedBy`);
    eq(approval.decision, "PASS", failures, `approvals.${index}.decision`);
    date(approval.approvedAt, failures, `approvals.${index}.approvedAt`);
    notFuture(approval.approvedAt, failures, `approvals.${index}.approvedAt`);
    if (!Number.isNaN(Date.parse(approval.approvedAt)) && Date.parse(approval.approvedAt) > Date.parse(report.checkedAt)) {
      failures.push(`approvals.${index}.approvedAt checkedAt zamanından sonra olamaz.`);
    }
    if (!Number.isNaN(Date.parse(approval.approvedAt)) && Date.parse(approval.approvedAt) < Date.parse(report.githubCi?.completedAt)) {
      failures.push(`approvals.${index}.approvedAt GitHub CI tamamlanma zamanından önce olamaz.`);
    }
    eq(approval.sourceCommitSha, report.sourceCommitSha, failures, `approvals.${index}.sourceCommitSha`);
    eq(approval.runUrl, report.githubCi?.runUrl, failures, `approvals.${index}.runUrl`);
  }
}

function validatePrivacyReviewContent(review, report, failures) {
  const expectedHashes = (report.artifacts ?? [])
    .filter((artifact) => artifact.mediaType === "image/png")
    .map((artifact) => artifact.sha256)
    .sort();
  const reviewedHashes = Array.isArray(review.reviewedPngSha256) ? [...review.reviewedPngSha256].sort() : [];
  if (
    review.syntheticDataOnly !== true ||
    review.reviewer?.role !== "privacy-owner" ||
    typeof review.reviewer?.id !== "string" ||
    review.reviewer.id.trim() === "" ||
    placeholder(review.reviewer?.id ?? "") ||
    JSON.stringify(reviewedHashes) !== JSON.stringify(expectedHashes)
  ) {
    failures.push("PNG gizlilik incelemesi exact hash, sentetik veri ve privacy-owner onayına bağlanmalı.");
  }
}

function keys(value, expectedKeys, failures, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    failures.push(`${label} nesnesi zorunlu.`);
    return false;
  }
  const actual = Object.keys(value);
  if (actual.length !== expectedKeys.length) failures.push(`${label} tam ${expectedKeys.length} alan içermeli.`);
  for (const key of actual) {
    if (!expectedKeys.includes(key)) failures.push(`${label}.${key} beklenmeyen alan.`);
  }
  for (const key of expectedKeys) {
    if (!actual.includes(key)) failures.push(`${label}.${key} eksik.`);
  }
  return true;
}

function includes(actual, expected, failures, label) {
  list(actual, failures, label, expected.length);
  if (!Array.isArray(actual)) return;
  const values = new Set(actual);
  for (const item of expected) {
    if (!values.has(item)) failures.push(`${label} eksik: ${item}`);
  }
}

function list(value, failures, label, min) {
  if (!Array.isArray(value)) {
    failures.push(`${label} liste olmalı.`);
    return;
  }
  if (value.length < min) failures.push(`${label} en az ${min} değer içermeli.`);
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || item.trim() === "") failures.push(`${label} boş olmayan metinlerden oluşmalı.`);
    if (seen.has(item)) failures.push(`${label} tekrarlı değer içeriyor: ${item}`);
    seen.add(item);
  }
}

function refs(value, failures, label, min) {
  list(value, failures, label, min);
  if (!Array.isArray(value)) return;

  for (const reference of value) {
    if (typeof reference !== "string" || reference.trim() === "") continue;
    const normalized = reference.trim().toLowerCase();
    if (!evidencePrefixes.some((prefix) => normalized.startsWith(prefix))) {
      failures.push(`${label} kalıcı artifact/run/log/url referansı içermeli: ${reference}`);
      continue;
    }
    if (!allowExampleEvidence && placeholder(reference)) failures.push(`${label} placeholder/redacted değer içermemeli.`);
    if (secretUrl(reference)) failures.push(`${label} userinfo, query veya fragment taşımamalı.`);
    if (normalized.startsWith("artifact:")) artifact(reference.slice("artifact:".length), failures, label);
    const remoteUrl = remoteReferenceUrl(reference);
    if (remoteUrl) {
      const urlFailure = publicEvidenceUrlFailure(remoteUrl);
      if (urlFailure) failures.push(`${label} güvenli public HTTPS referansı olmalı: ${urlFailure}`);
    }
  }
}

function artifact(artifactPath, failures, label) {
  const segments = artifactPath.split("/");
  if (!artifactPath || artifactPath.startsWith("/") || artifactPath.includes("\\") || segments.includes("..")) {
    failures.push(`${label} artifact referansı repo içi relative path olmalı.`);
    return;
  }

  const resolvedPath = resolve(artifactPath);
  if (localTempPath(resolvedPath) || localArtifactPath(resolvedPath)) {
    failures.push(`${label} artifact referansı temp veya artifacts/local altında olmamalı.`);
    return;
  }

  if (allowExampleEvidence) return;

  const parentFailure = parentSymlinkFailure(dirname(resolvedPath), label);
  if (parentFailure) {
    failures.push(parentFailure);
    return;
  }
  if (!existsSync(resolvedPath)) {
    failures.push(`${label} artifact referansı mevcut dosyaya bağlanmalı: ${artifactPath}`);
    return;
  }
  const stat = lstatSync(resolvedPath);
  if (stat.isSymbolicLink() || !stat.isFile()) failures.push(`${label} artifact referansı symlink olmayan dosya olmalı.`);
}

function widths(value, failures, label) {
  if (!Array.isArray(value)) {
    failures.push(`${label} liste olmalı.`);
    return;
  }
  const seen = new Set(value);
  if (value.length !== requiredWidths.length) failures.push(`${label} tam ${requiredWidths.length} viewport içermeli.`);
  for (const width of value) {
    if (!Number.isInteger(width)) failures.push(`${label} sayılardan oluşmalı.`);
  }
  for (const width of requiredWidths) {
    if (!seen.has(width)) failures.push(`${label} eksik viewport: ${width}`);
  }
  if (value.some((width, index) => width !== requiredWidths[index])) failures.push(`${label} kanonik viewport sırasını korumalı.`);
}

function allEvidenceReferences(report) {
  return [
    ...(report.stagingProductionEvidence?.evidenceReferences ?? []),
    ...(report.phaseEvidence ?? []).flatMap((item) => item?.evidenceReferences ?? []),
    ...(report.viewportCoverage ?? []).flatMap((item) => item?.evidenceReferences ?? []),
  ];
}

function artifactEvidenceReferences(report) {
  return new Set(allEvidenceReferences(report).filter((reference) =>
    typeof reference === "string" && !reference.startsWith("run:"),
  ));
}

function viewportReferenceBinding(report, reference) {
  for (const coverage of report.viewportCoverage ?? []) {
    const index = coverage.evidenceReferences?.indexOf(reference) ?? -1;
    if (index !== -1) return { surface: coverage.surface, width: coverage.widths[index] };
  }
  return null;
}

async function readArtifactBytes(reference) {
  if (!reference.startsWith("artifact:")) throw new Error("yalnız artifact: yerel referansı desteklenir");
  const filePath = resolve(reference.slice("artifact:".length));
  await assertParentPathAllowed(dirname(filePath));
  const stat = await lstat(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("symlink olmayan dosya olmalı");
  if (stat.size > maxArtifactBytes) throw new Error("artifact 20 MiB sınırını aşıyor");
  return readFile(filePath);
}

async function readRemoteArtifactBytes(url) {
  const response = await secureFetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxArtifactBytes) throw new Error("artifact 20 MiB sınırını aşıyor");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxArtifactBytes) throw new Error("artifact 20 MiB sınırını aşıyor");
  return bytes;
}

function detectArtifact(bytes) {
  const png = inspectPng(bytes);
  if (png) {
    if (!png.hasVisibleContent) throw new Error("PNG kanıtı boş/şeffaf pixel verisi içeremez.");
    return {
      mediaType: "image/png",
      imageWidth: png.width,
      imageHeight: png.height,
    };
  }
  const text = bytes.toString("utf8").trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      JSON.parse(text);
      return { mediaType: "application/json", imageWidth: null, imageHeight: null };
    } catch {
      // Geçersiz JSON, text/plain olarak sınıflandırılır ve ayrıca içerik doğrulamasında reddedilir.
    }
  }
  return { mediaType: "text/plain", imageWidth: null, imageHeight: null };
}

function scanArtifactPii(value, reference, failures, path = "artifact") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanArtifactPii(item, reference, failures, `${path}.${index}`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenPiiKeyFragments.some((fragment) => key.toLowerCase().includes(fragment))) {
        failures.push(`Artifact yasak PII alanı içeriyor: ${reference} ${path}.${key}`);
      }
      scanArtifactPii(child, reference, failures, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && !path.endsWith(".runUrl") && rawPiiPatterns.some((pattern) => pattern.test(value))) {
    failures.push(`Artifact ham PII benzeri değer içermemeli: ${reference} ${path}`);
  }
}

function eq(actual, expected, failures, label) {
  if (actual !== expected) failures.push(`${label} ${expected} olmalı.`);
}

function oneOf(actual, expected, failures, label) {
  if (!expected.includes(actual)) failures.push(`${label} ${expected.join(" veya ")} olmalı.`);
}

function string(value, failures, label) {
  if (typeof value !== "string" || value.trim() === "") failures.push(`${label} boş olmayan metin olmalı.`);
}

function commitSha(value, failures, label) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) {
    failures.push(`${label} 40 karakter hex commit SHA olmalı.`);
  }
}

function releaseCandidateBinding(releaseCandidate, sourceCommitSha, failures) {
  if (typeof releaseCandidate !== "string" || typeof sourceCommitSha !== "string") return;
  const tag = releaseCandidate.match(/:([a-f0-9]{40})$/i)?.[1];
  if (!tag || tag.toLowerCase() !== sourceCommitSha.toLowerCase()) {
    failures.push("releaseCandidate tag'i sourceCommitSha ile birebir eşleşmeli.");
  }
}

function date(value, failures, label) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) failures.push(`${label} geçerli tarih olmalı.`);
}

function notFuture(value, failures, label) {
  if (allowExampleEvidence || typeof value !== "string") return;
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp) && timestamp > Date.now() + 5 * 60 * 1000) failures.push(`${label} gelecekte olamaz.`);
}

function nonPlaceholder(value, failures, label) {
  if (!allowExampleEvidence && typeof value === "string" && placeholder(value)) {
    failures.push(`${label} production kanıtı için örnek/placeholder/redacted değer olmamalı.`);
  }
}

function requireTargetUrl(url) {
  if (url.protocol !== "file:" && url.protocol !== "https:") fail(["UI_UX_REDESIGN_EVIDENCE_TARGET file:// veya https:// URL olmalı."]);
  if (url.username || url.password || url.search || url.hash) fail(["UI_UX_REDESIGN_EVIDENCE_TARGET userinfo, query veya fragment taşımamalı."]);
  if (url.protocol === "https:" && placeholderHost(url.hostname)) {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET production kanıtı için gerçek https host olmalı."]);
  }
  if (url.protocol === "file:" && localTempPath(fileURLToPath(url))) {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET production kanıtı için lokal temp path olmamalı."]);
  }
  if (url.protocol === "file:" && localArtifactPath(fileURLToPath(url))) {
    fail(["UI_UX_REDESIGN_EVIDENCE_TARGET production kanıtı için artifacts/local altında olmamalı."]);
  }
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
      fail(["UI_UX_REDESIGN_EVIDENCE_TARGET parent dizini okunabilir olmalı."]);
    }
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(["UI_UX_REDESIGN_EVIDENCE_TARGET parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function parentSymlinkFailure(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return null;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) return `${label} artifact parent dizini symlink olmayan dizin olmalı.`;
  }
  return null;
}

function secretUrl(value) {
  const candidate = value.slice(value.indexOf(":") + 1);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return false;
  try {
    const url = new URL(candidate);
    return Boolean(url.username || url.password || url.search || url.hash);
  } catch {
    return false;
  }
}

function placeholder(value) {
  const normalized = value.toLowerCase();
  return normalized.includes("example") || normalized.includes("__set") || normalized.includes("placeholder") || normalized.includes("redacted") || normalized.includes("todo");
}

function placeholderHost(hostname) {
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

function publicEvidenceUrlFailure(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return "URL çözümlenemedi";
  }
  if (url.protocol !== "https:") return "yalnız HTTPS desteklenir";
  const allowedGithubJobsQuery =
    url.hostname === "api.github.com" &&
    /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/\d+\/jobs$/.test(url.pathname) &&
    url.search === "?per_page=100";
  if (url.username || url.password || (!allowedGithubJobsQuery && url.search) || url.hash) return "userinfo, query veya fragment taşınamaz";
  const hostname = url.hostname.toLowerCase();
  if (placeholderHost(hostname)) return `placeholder/local host reddedildi: ${hostname}`;
  if (privateIp(hostname)) return `private veya link-local IP reddedildi: ${hostname}`;
  if (
    !allowExampleEvidence &&
    !["github.com", "api.github.com"].includes(hostname) &&
    !configuredEvidenceHosts.has(hostname)
  ) {
    return `host allowlist içinde değil: ${hostname}`;
  }
  return null;
}

async function secureFetch(value, options = {}) {
  const url = value instanceof URL ? value : new URL(value);
  return pinnedHttpsFetch(url, {
    headers: options.headers,
    signal: options.signal,
    validateAddress: privateIp,
    validateUrl: (candidate) => publicEvidenceUrlFailure(candidate.href),
  });
}

function privateIp(value) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return privateIp(mapped);
  const version = isIP(normalized);
  if (version === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0) ||
      a >= 224
    );
  }
  if (version === 6) {
    return normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:") ||
      normalized.startsWith("2001:db8") || normalized.startsWith("fc") || normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith("ff");
  }
  return false;
}

function localTempPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized === "/tmp" || normalized.startsWith("/tmp/") || normalized === "/var/tmp" || normalized.startsWith("/var/tmp/") || normalized === "/private/tmp" || normalized.startsWith("/private/tmp/");
}

function localArtifactPath(path) {
  const normalized = path.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function scanRawPii(value, failures, path = "report") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanRawPii(item, failures, `${path}.${index}`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) scanRawPii(child, failures, `${path}.${key}`);
    return;
  }
  if (typeof value !== "string" || (path.endsWith(".runId") && /^\d+$/.test(value))) return;
  const normalized = value.replace(
    /(github\.com\/[^/]+\/[^/]+\/actions\/runs\/)\d+/gi,
    "$1{run-id}",
  );
  if (rawPiiPatterns.some((pattern) => pattern.test(normalized))) {
    failures.push("Kanıt JSON ham PII benzeri değer içermemeli.");
  }
}

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    fail(["UI/UX redesign kanıtı geçerli JSON olmalı."]);
  }
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 240) : "bilinmeyen hata";
}

function fail(failures) {
  console.error("UI/UX redesign kanıt kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
