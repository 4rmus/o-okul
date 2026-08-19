import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, parse, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pinnedHttpsFetch } from "./pinned-https-fetch.mjs";
import { inspectPng } from "./png-artifact.mjs";

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
const forbiddenRawFields = ["email", "phone", "nationalId", "rawAnswer", "rawLine", "rawRow"];
const evidenceReferencePrefixes = ["artifact:", "file://", "https://", "log:", "run:", "s3://", "url:"];
const requiredWidths = [320, 375, 414, 768, 1024, 1440];
const rawPiiPatterns = [/\b\d{11}\b/, /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i, /\b(?:\+90|0)?5\d{9}\b/];
const forbiddenPiiKeyFragments = ["email", "phone", "nationalid", "rawanswer", "rawline", "rawrow"];
const maxArtifactBytes = 20 * 1024 * 1024;
const phaseConfigs = [
  {
    commandsPassed: [
      "pnpm --filter @o-okul/web typecheck",
      "pnpm web:design-tokens:check",
      "pnpm web:a11y:check",
      "pnpm web:auth-contract:check",
    ],
    envKey: "UI_UX_REDESIGN_PHASE_0_REFERENCES",
    phase: "Faz 0",
    scope: "staging-production",
  },
  {
    commandsPassed: ["pnpm web:ux-contract:check"],
    envKey: "UI_UX_REDESIGN_PHASE_1_REFERENCES",
    phase: "Faz 1",
    scope: "staging-production",
  },
  {
    commandsPassed: ["pnpm --filter @o-okul/ui build", "pnpm web:ux-contract:check"],
    envKey: "UI_UX_REDESIGN_PHASE_2_REFERENCES",
    phase: "Faz 2",
    scope: "staging-production",
  },
  {
    commandsPassed: ["pnpm karne:visual-contract:check", "pnpm live:ui-worker:smoke"],
    envKey: "UI_UX_REDESIGN_PHASE_3_REFERENCES",
    phase: "Faz 3",
    scope: "staging-production",
  },
  {
    commandsPassed: ["pnpm web:ux-contract:check"],
    envKey: "UI_UX_REDESIGN_PHASE_4_REFERENCES",
    phase: "Faz 4",
    scope: "staging-production",
  },
  {
    commandsPassed: ["pnpm prod:evidence:templates:check", "pnpm uat:check"],
    envKey: "UI_UX_REDESIGN_PHASE_5_REFERENCES",
    phase: "Faz 5",
    scope: "staging-production",
  },
];
const viewportConfigs = [
  ["kurum dashboard", "UI_UX_REDESIGN_KURUM_DASHBOARD_REFERENCES"],
  ["optik workspace", "UI_UX_REDESIGN_OPTIK_WORKSPACE_REFERENCES"],
  ["rapor workspace", "UI_UX_REDESIGN_RAPOR_WORKSPACE_REFERENCES"],
  ["portal shell", "UI_UX_REDESIGN_PORTAL_SHELL_REFERENCES"],
];

const env = { ...readEnvFile(readOption("--env-file")), ...process.env };
const outputPath = readOption("--output") ?? env.UI_UX_REDESIGN_EVIDENCE_OUTPUT;
const environment = readOption("--environment") ?? env.STAGING_ENVIRONMENT ?? "staging";
const checkedAt = env.UI_UX_REDESIGN_CHECKED_AT?.trim() || new Date().toISOString();
const releaseCandidate = env.UI_UX_REDESIGN_RELEASE_CANDIDATE?.trim();
const sourceCommitSha = env.UI_UX_REDESIGN_SOURCE_COMMIT_SHA?.trim();
const githubCiEvidenceTarget = env.GITHUB_CI_EVIDENCE_TARGET?.trim();
const approvalRole = env.UI_UX_REDESIGN_APPROVAL_ROLE?.trim();
const approvedBy = env.UI_UX_REDESIGN_APPROVED_BY?.trim();
const approvedAt = env.UI_UX_REDESIGN_APPROVED_AT?.trim();
const privacyReviewReference = env.UI_UX_REDESIGN_PRIVACY_REVIEW_REFERENCE?.trim();
const allowedEvidenceHosts = (env.UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS ?? "")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

const failures = [];
requireValue(outputPath, "UI_UX_REDESIGN_EVIDENCE_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireEvidenceValue(releaseCandidate, "UI_UX_REDESIGN_RELEASE_CANDIDATE", failures);
requireCommitSha(sourceCommitSha, "UI_UX_REDESIGN_SOURCE_COMMIT_SHA", failures);
requireValue(githubCiEvidenceTarget, "GITHUB_CI_EVIDENCE_TARGET", failures);
requireReleaseCandidateBinding(releaseCandidate, sourceCommitSha, failures);
requireDate(checkedAt, "UI_UX_REDESIGN_CHECKED_AT", failures);
requireOneOf(approvalRole, "UI_UX_REDESIGN_APPROVAL_ROLE", ["release-owner"], failures);
requireEvidenceValue(approvedBy, "UI_UX_REDESIGN_APPROVED_BY", failures);
requireDate(approvedAt, "UI_UX_REDESIGN_APPROVED_AT", failures);
requireDateOrder(approvedAt, checkedAt, "UI_UX_REDESIGN_APPROVED_AT", failures);
requireEvidenceValue(privacyReviewReference, "UI_UX_REDESIGN_PRIVACY_REVIEW_REFERENCE", failures);
requireEqual(env.UI_UX_REDESIGN_PII_REVIEW, "PASS", "UI_UX_REDESIGN_PII_REVIEW", failures);
requireEqual(env.UI_UX_REDESIGN_RAW_PII_IN_ARTIFACTS, "false", "UI_UX_REDESIGN_RAW_PII_IN_ARTIFACTS", failures);
requireEqual(
  env.UI_UX_REDESIGN_SMS_RECIPIENT_PREVIEW_EXPORTED,
  "false",
  "UI_UX_REDESIGN_SMS_RECIPIENT_PREVIEW_EXPORTED",
  failures,
);
requireEqual(
  env.UI_UX_REDESIGN_GUARDIAN_FINANCE_LEAKAGE_CHECKED,
  "true",
  "UI_UX_REDESIGN_GUARDIAN_FINANCE_LEAKAGE_CHECKED",
  failures,
);
for (const host of allowedEvidenceHosts) {
  if (!/^[a-z0-9.-]+$/i.test(host) || hasPlaceholderToken(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".test") || privateIp(host)) {
    failures.push(`UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS public hostname içermeli: ${host}`);
  }
}
if (new Set(allowedEvidenceHosts).size !== allowedEvidenceHosts.length) {
  failures.push("UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS tekrarlı host içermemeli.");
}

const stagingEvidenceReferences = readReferenceList("UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES", 3, failures);
if (
  stagingEvidenceReferences.length !== 4 ||
  !stagingEvidenceReferences[1]?.startsWith("run:") ||
  stagingEvidenceReferences[3] !== privacyReviewReference
) {
  failures.push("UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES sırası summary, GitHub run, UAT, privacy review olmalı.");
}
if (privacyReviewReference && !stagingEvidenceReferences.includes(privacyReviewReference)) {
  failures.push("UI_UX_REDESIGN_PRIVACY_REVIEW_REFERENCE staging evidence referansları içinde olmalı.");
}
const phaseEvidence = phaseConfigs.map((config) => ({
  phase: config.phase,
  status: "PASS",
  scope: config.scope,
  commandsPassed: config.commandsPassed,
  evidenceReferences: readReferenceList(config.envKey, 1, failures),
}));
for (const phase of phaseEvidence) {
  if (phase.evidenceReferences.some((reference) => reference.startsWith("run:"))) {
    failures.push(`${phase.phase} evidence referansları okunabilir JSON artifact/url olmalı; run: kullanılamaz.`);
  }
}
const viewportCoverage = viewportConfigs.map(([surface, envKey]) => ({
  surface,
  widths: requiredWidths,
  evidenceReferences: readReferenceList(envKey, requiredWidths.length, failures),
}));
for (const coverage of viewportCoverage) {
  if (coverage.evidenceReferences.some((reference) => reference.startsWith("run:"))) {
    failures.push(`${coverage.surface} viewport referansları okunabilir PNG artifact/url olmalı; run: kullanılamaz.`);
  }
}
if (failures.length > 0) fail(failures);
viewportCoverage.push(...await readSystemUiCoverage(stagingEvidenceReferences[2]));
const githubCi = readGithubCiEvidence(githubCiEvidenceTarget, sourceCommitSha, stagingEvidenceReferences);
const artifactContracts = buildArtifactContracts(stagingEvidenceReferences, phaseEvidence, privacyReviewReference);
const artifacts = await buildArtifactManifest({
  stagingEvidenceReferences,
  phaseEvidence,
  viewportCoverage,
  artifactContracts,
  githubCi,
});
await validatePrivacyReview(privacyReviewReference, artifacts, sourceCommitSha, environment, checkedAt, githubCi);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const report = {
  schemaVersion: 2,
  result: "PASS",
  environment,
  checkedAt,
  releaseCandidate,
  sourceCommitSha,
  githubCi,
  allowedEvidenceHosts,
  redesignPlanPath: "docs/ui-ux-professionalization-contract.md",
  localStaticEvidence: {
    result: "PASS",
    releaseBlocking: false,
    commandsPassed: localCommands,
    note: "Local/static PASS staging veya production kabul kanıtı değildir.",
  },
  stagingProductionEvidence: {
    result: "PASS",
    requiredForRelease: true,
    commandsPassed: releaseCommands,
    evidenceReferences: stagingEvidenceReferences,
  },
  phaseEvidence,
  viewportCoverage,
  artifacts,
  privacy: {
    piiReview: "PASS",
    reviewReference: privacyReviewReference,
    rawPiiInArtifacts: false,
    smsRecipientPreviewExported: false,
    guardianFinanceLeakageChecked: true,
    forbiddenRawFields,
  },
  approvals: [
    {
      role: approvalRole,
      approvedBy,
      decision: "PASS",
      approvedAt,
      sourceCommitSha,
      runUrl: githubCi.runUrl,
    },
  ],
  openRisks: [],
};

mkdirSync(dirname(outputFile), { recursive: true });
validateOutputTarget(outputFile);
writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
validateOutputTarget(outputFile);
runCheck(outputFile);
console.log(`UI/UX redesign kanıtı yazıldı: ${outputFile}`);

function readGithubCiEvidence(target, sourceCommitSha, stagingEvidenceReferences) {
  let url;
  try {
    url = new URL(target);
  } catch {
    fail(["GITHUB_CI_EVIDENCE_TARGET file:// URL olmalı."]);
  }
  if (url.protocol !== "file:") fail(["GITHUB_CI_EVIDENCE_TARGET generator için file:// artifact olmalı."]);
  const filePath = fileURLToPath(url);
  assertParentPathAllowed(dirname(filePath), "GITHUB_CI_EVIDENCE_TARGET");
  const stat = lstatSync(filePath);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(["GITHUB_CI_EVIDENCE_TARGET symlink olmayan dosya olmalı."]);
  const before = readFileSync(filePath);
  const beforeSha256 = createHash("sha256").update(before).digest("hex");

  const checkResult = spawnSync(process.execPath, ["scripts/check-github-ci-evidence.mjs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: { ...process.env, GITHUB_CI_EVIDENCE_TARGET: target },
  });
  if (checkResult.status !== 0) fail(["GITHUB_CI_EVIDENCE_TARGET doğrulanamadı."]);
  const after = readFileSync(filePath);
  if (createHash("sha256").update(after).digest("hex") !== beforeSha256) {
    fail(["GITHUB_CI_EVIDENCE_TARGET doğrulama sırasında değişmemeli."]);
  }

  let report;
  try {
    report = JSON.parse(after.toString("utf8"));
  } catch {
    fail(["GITHUB_CI_EVIDENCE_TARGET geçerli JSON olmalı."]);
  }
  if (report.commitSha?.toLowerCase() !== sourceCommitSha.toLowerCase()) {
    fail(["GitHub CI commitSha UI_UX_REDESIGN_SOURCE_COMMIT_SHA ile eşleşmeli."]);
  }
  if (report.workflow?.path !== ".github/workflows/ci.yml" || report.workflow?.conclusion !== "success") {
    fail(["GitHub CI workflow .github/workflows/ci.yml ve success olmalı."]);
  }
  if (!stagingEvidenceReferences.includes(`run:${report.workflow.runUrl}`)) {
    fail(["UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES exact GitHub CI run URL'sini içermeli."]);
  }
  const successfulJobs = (report.jobs ?? []).filter((job) => job.conclusion === "success").map((job) => job.name);
  if (successfulJobs.length === 0) fail(["GitHub CI kanıtı en az bir başarılı job içermeli."]);
  return {
    repository: report.repository,
    commitSha: report.commitSha,
    workflowPath: report.workflow.path,
    runId: report.workflow.runId,
    runUrl: report.workflow.runUrl,
    completedAt: report.workflow.completedAt,
    conclusion: report.workflow.conclusion,
    successfulJobs,
  };
}

function buildArtifactContracts(stagingEvidenceReferences, phaseEvidence, privacyReviewReference) {
  const contracts = new Map();
  addArtifactContract(contracts, stagingEvidenceReferences[0], {
    evidenceType: "ui-ux-redesign-summary",
    commandsPassed: releaseCommands,
  });
  addArtifactContract(contracts, stagingEvidenceReferences[2], {
    evidenceType: "ui-ux-redesign-uat",
    commandsPassed: ["pnpm uat:check"],
  });
  addArtifactContract(contracts, privacyReviewReference, {
    evidenceType: "ui-ux-redesign-privacy-review",
  });
  for (const phase of phaseEvidence) {
    for (const reference of phase.evidenceReferences) {
      addArtifactContract(contracts, reference, {
        evidenceType: `ui-ux-redesign-phase-${phase.phase.slice(-1)}`,
        commandsPassed: phase.commandsPassed,
      });
    }
  }
  return contracts;
}

async function readSystemUiCoverage(uatReference) {
  let payload;
  try {
    payload = JSON.parse((await readEvidenceBytes(uatReference)).toString("utf8"));
  } catch {
    fail(["UI/UX UAT artifact systemUiEvidence içeren geçerli JSON olmalı."]);
  }
  const value = payload?.systemUiEvidence;
  if (!value || typeof value !== "object" || Array.isArray(value)
    || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(["system", "system-tenants"])) {
    fail(["UI/UX UAT artifact system ve system-tenants exact kanıt setini taşımalı."]);
  }
  const separator = uatReference.lastIndexOf("/");
  if (!uatReference.startsWith("artifact:") || separator <= "artifact:".length) {
    fail(["UI/UX UAT artifact system UI bağları için repo içi artifact: referansı olmalı."]);
  }
  const artifactPrefix = uatReference.slice(0, separator);
  return [
    ["system dashboard", "system"],
    ["system tenants", "system-tenants"],
  ].map(([surface, key]) => {
    const expected = requiredWidths.map((width) => `${artifactPrefix}/${key}-${width}.png`);
    if (!Array.isArray(value[key]) || value[key].length !== expected.length
      || !expected.every((reference, index) => value[key][index] === reference)) {
      fail([`UI/UX UAT artifact ${key} 320/375/414/768/1024/1440 exact PNG referanslarını taşımalı.`]);
    }
    return { surface, widths: requiredWidths, evidenceReferences: value[key] };
  });
}

function addArtifactContract(contracts, reference, contract) {
  if (!reference || reference.startsWith("run:")) return;
  if (contracts.has(reference)) fail([`Kanıt referansı birden fazla evidence rolünde kullanılamaz: ${reference}`]);
  contracts.set(reference, contract);
}

async function buildArtifactManifest({ stagingEvidenceReferences, phaseEvidence, viewportCoverage, artifactContracts, githubCi }) {
  const references = [
    ...stagingEvidenceReferences,
    ...phaseEvidence.flatMap((item) => item.evidenceReferences),
    ...viewportCoverage.flatMap((item) => item.evidenceReferences),
  ].filter((reference) => !reference.startsWith("run:"));
  const uniqueReferences = [...new Set(references)];
  const bindings = new Map();
  for (const coverage of viewportCoverage) {
    coverage.evidenceReferences.forEach((reference, index) => {
      const nextBinding = { surface: coverage.surface, width: coverage.widths[index] };
      const current = bindings.get(reference);
      if (current && (current.surface !== nextBinding.surface || current.width !== nextBinding.width)) {
        fail([`Viewport referansı birden fazla yüzey/ölçüye bağlanamaz: ${reference}`]);
      }
      bindings.set(reference, nextBinding);
    });
  }

  const manifest = [];
  for (const reference of uniqueReferences) {
    let bytes;
    try {
      bytes = await readEvidenceBytes(reference);
    } catch (error) {
      fail([`Kanıt artifact'i okunamadı: ${reference} (${safeErrorMessage(error)})`]);
    }
    const detected = detectArtifact(bytes);
    const binding = bindings.get(reference);
    const contract = artifactContracts.get(reference);
    if (contract && detected.mediaType !== "application/json") {
      fail([`Evidence rolü JSON artifact olmalı: ${reference}`]);
    }
    if (binding && detected.mediaType !== "image/png") {
      fail([`Viewport kanıtı PNG olmalı: ${reference}`]);
    }
    if (binding && detected.imageWidth !== binding.width) {
      fail([`Viewport kanıtı gerçek genişlikle eşleşmeli: ${reference}; beklenen=${binding.width}, gerçek=${detected.imageWidth}`]);
    }
    scanArtifactPii(
      detected,
      bytes,
      reference,
      sourceCommitSha,
      environment,
      checkedAt,
      githubCi.completedAt,
      githubCi.runUrl,
      approvedAt,
      contract,
    );
    manifest.push({
      reference,
      mediaType: detected.mediaType,
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      surface: binding?.surface ?? null,
      viewportWidth: binding?.width ?? null,
      imageWidth: detected.imageWidth,
      imageHeight: detected.imageHeight,
      piiReview: "PASS",
    });
  }
  return manifest;
}

async function readEvidenceBytes(reference) {
  if (reference.startsWith("artifact:")) {
    const filePath = resolve(reference.slice("artifact:".length));
    const stat = lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error("symlink olmayan dosya olmalı");
    if (stat.size > maxArtifactBytes) throw new Error("artifact 20 MiB sınırını aşıyor");
    assertParentPathAllowed(dirname(filePath), "Kanıt artifact'i");
    return readFileSync(filePath);
  }
  const candidate = reference.startsWith("url:") ? reference.slice("url:".length) : reference;
  if (!candidate.startsWith("https://")) throw new Error("artifact: veya public HTTPS referansı gerekli");
  const response = await secureFetch(candidate);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const declaredSize = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maxArtifactBytes) throw new Error("artifact 20 MiB sınırını aşıyor");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maxArtifactBytes) throw new Error("artifact 20 MiB sınırını aşıyor");
  return bytes;
}

function detectArtifact(bytes) {
  let png;
  try {
    png = inspectPng(bytes);
  } catch (error) {
    fail([`PNG kanıtı geçersiz: ${safeErrorMessage(error)}`]);
  }
  if (png) {
    if (!png.hasVisibleContent) fail(["PNG kanıtı boş/şeffaf pixel verisi içeremez."]);
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
      fail(["JSON uzantılı/biçimli kanıt geçerli JSON olmalı."]);
    }
  }
  return { mediaType: "text/plain", imageWidth: null, imageHeight: null };
}

function scanArtifactPii(
  detected,
  bytes,
  reference,
  sourceCommitSha,
  environment,
  checkedAt,
  minimumCheckedAt,
  runUrl,
  maximumCheckedAt,
  contract,
) {
  if (detected.mediaType === "image/png") return;
  const contents = bytes.toString("utf8");
  if (detected.mediaType === "text/plain") {
    if (rawPiiPatterns.some((pattern) => pattern.test(contents))) fail([`Kanıt artifact'i ham PII benzeri değer içeriyor: ${reference}`]);
    return;
  }
  const parsed = JSON.parse(contents);
  const failures = [];
  scanJsonPii(parsed, failures);
  if (parsed?.result !== "PASS") failures.push("result PASS olmalı");
  if (parsed?.sourceCommitSha?.toLowerCase() !== sourceCommitSha.toLowerCase()) failures.push("sourceCommitSha eşleşmeli");
  if (parsed?.environment !== environment) failures.push("environment eşleşmeli");
  if (
    typeof parsed?.checkedAt !== "string" ||
    Number.isNaN(Date.parse(parsed.checkedAt)) ||
    Date.parse(parsed.checkedAt) < Date.parse(minimumCheckedAt) ||
    Date.parse(parsed.checkedAt) > Date.parse(maximumCheckedAt) ||
    Date.parse(parsed.checkedAt) > Date.parse(checkedAt)
  ) {
    failures.push("checkedAt GitHub CI tamamlanma zamanı ile release onayı arasında olmalı");
  }
  if (contract) {
    if (parsed?.evidenceType !== contract.evidenceType) failures.push(`evidenceType ${contract.evidenceType} olmalı`);
    if (parsed?.runUrl !== runUrl) failures.push("runUrl GitHub CI run URL ile eşleşmeli");
    if (contract.commandsPassed && !sameStringSet(parsed?.commandsPassed, contract.commandsPassed)) {
      failures.push("commandsPassed evidence rolünün exact komut setiyle eşleşmeli");
    }
  }
  if (failures.length > 0) fail([`Kanıt artifact'i PII-safe değil: ${reference}; ${failures[0]}`]);
}

async function validatePrivacyReview(reference, artifacts, sourceCommitSha, environment, checkedAt, githubCi) {
  const reviewArtifact = artifacts.find((artifact) => artifact.reference === reference);
  if (!reviewArtifact || reviewArtifact.mediaType !== "application/json") {
    fail(["UI_UX_REDESIGN_PRIVACY_REVIEW_REFERENCE JSON artifact manifestine bağlanmalı."]);
  }
  const bytes = await readEvidenceBytes(reference);
  const review = JSON.parse(bytes.toString("utf8"));
  const expectedHashes = artifacts.filter((artifact) => artifact.mediaType === "image/png").map((artifact) => artifact.sha256).sort();
  const reviewedHashes = Array.isArray(review.reviewedPngSha256) ? [...review.reviewedPngSha256].sort() : [];
  if (
    review.result !== "PASS" ||
    review.evidenceType !== "ui-ux-redesign-privacy-review" ||
    review.environment !== environment ||
    review.sourceCommitSha?.toLowerCase() !== sourceCommitSha.toLowerCase() ||
    review.runUrl !== githubCi.runUrl ||
    review.syntheticDataOnly !== true ||
    review.reviewer?.role !== "privacy-owner" ||
    typeof review.reviewer?.id !== "string" ||
    review.reviewer.id.trim() === "" ||
    hasPlaceholderToken(review.reviewer.id) ||
    JSON.stringify(reviewedHashes) !== JSON.stringify(expectedHashes) ||
    Date.parse(review.checkedAt) < Date.parse(githubCi.completedAt) ||
    Date.parse(review.checkedAt) > Date.parse(approvedAt) ||
    Date.parse(review.checkedAt) > Date.parse(checkedAt)
  ) {
    fail(["PNG gizlilik incelemesi exact SHA, ortam, sentetik veri ve privacy-owner onayına bağlanmalı."]);
  }
}

function sameStringSet(actual, expected) {
  return Array.isArray(actual) &&
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    expected.every((value) => actual.includes(value));
}

function scanJsonPii(value, output, path = "artifact") {
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanJsonPii(item, output, `${path}.${index}`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (forbiddenPiiKeyFragments.some((fragment) => key.toLowerCase().includes(fragment))) {
        output.push(`yasak alan: ${path}.${key}`);
      }
      scanJsonPii(child, output, `${path}.${key}`);
    }
    return;
  }
  if (typeof value === "string" && !path.endsWith(".runUrl") && rawPiiPatterns.some((pattern) => pattern.test(value))) {
    output.push(`ham PII benzeri değer: ${path}`);
  }
}

async function secureFetch(value) {
  const url = new URL(value);
  return pinnedHttpsFetch(url, {
    validateAddress: privateIp,
    validateUrl: publicEvidenceUrlFailure,
  });
}

function publicEvidenceUrlFailure(url) {
  if (url.protocol !== "https:") return "yalnız HTTPS desteklenir";
  if (url.username || url.password || url.search || url.hash) return "userinfo, query veya fragment taşınamaz";
  const hostname = url.hostname.toLowerCase();
  if (hasPlaceholderToken(hostname) || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".test")) {
    return `placeholder/local host reddedildi: ${hostname}`;
  }
  if (privateIp(hostname)) return `private veya link-local IP reddedildi: ${hostname}`;
  if (!["github.com", "api.github.com"].includes(hostname) && !allowedEvidenceHosts.includes(hostname)) {
    return `host allowlist içinde değil: ${hostname}`;
  }
  return null;
}

function privateIp(value) {
  const normalized = value.toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mapped) return privateIp(mapped);
  const version = isIP(normalized);
  if (version === 4) {
    const [a, b] = normalized.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0) || a >= 224;
  }
  if (version === 6) return normalized === "::" || normalized === "::1" || normalized.startsWith("::ffff:") ||
    normalized.startsWith("2001:db8") || normalized.startsWith("fc") || normalized.startsWith("fd") ||
    /^fe[89ab]/.test(normalized) || normalized.startsWith("ff");
  return false;
}

function safeErrorMessage(error) {
  return error instanceof Error ? error.message.slice(0, 240) : "bilinmeyen hata";
}

function readEnvFile(file) {
  if (!file) return {};
  const contents = readFileSync(file, "utf8");
  const values = {};
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) fail([`${file}:${index + 1} KEY=VALUE biçiminde olmalı.`]);
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).replace(/^["']|["']$/g, "");
    if (!/^[A-Z0-9_]+$/.test(key)) fail([`${file}:${index + 1} geçersiz env anahtarı: ${key}`]);
    values[key] = value;
  }
  return values;
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) fail([`${name} için değer gerekli.`]);
  return value;
}

function readReferenceList(key, minLength, output) {
  const value = env[key]?.trim();
  if (!value) {
    output.push(`${key} boş bırakılamaz.`);
    return [];
  }

  const references = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (references.length < minLength) output.push(`${key} en az ${minLength} referans içermeli.`);
  const seen = new Set();
  for (const reference of references) {
    if (seen.has(reference)) output.push(`${key} tekrarlı referans içeriyor: ${reference}`);
    seen.add(reference);
    validateEvidenceReference(reference, key, output);
  }
  return references;
}

function validateEvidenceReference(reference, label, output) {
  const normalized = reference.toLowerCase();
  if (!evidenceReferencePrefixes.some((prefix) => normalized.startsWith(prefix))) {
    output.push(`${label} kalıcı artifact/run/log/url referansı içermeli: ${reference}`);
    return;
  }
  if (hasPlaceholderToken(reference)) output.push(`${label} placeholder/redacted/example değer içermemeli.`);
  if (hasSecretBearingUrlParts(reference)) output.push(`${label} userinfo, query veya fragment taşımamalı.`);
  if (normalized.startsWith("artifact:")) validateArtifactReference(reference.slice("artifact:".length), label, output);
}

function validateArtifactReference(artifactPath, label, output) {
  const segments = artifactPath.split("/");
  if (!artifactPath || artifactPath.startsWith("/") || artifactPath.includes("\\") || segments.includes("..")) {
    output.push(`${label} artifact referansı repo içi relative path olmalı.`);
    return;
  }
  const resolvedPath = resolve(artifactPath);
  if (isLocalTempPath(resolvedPath) || isLocalArtifactPath(resolvedPath)) {
    output.push(`${label} artifact referansı temp veya artifacts/local altında olmamalı.`);
  }
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) fail(["UI_UX_REDESIGN_EVIDENCE_OUTPUT lokal temp path olmamalı."]);
  if (isLocalArtifactPath(filePath)) fail(["UI_UX_REDESIGN_EVIDENCE_OUTPUT artifacts/local altında olmamalı."]);
  assertParentPathAllowed(dirname(filePath), "UI_UX_REDESIGN_EVIDENCE_OUTPUT");

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["UI_UX_REDESIGN_EVIDENCE_OUTPUT symlink olmayan file artifact olmalı."]);
    }
  }
}

function assertParentPathAllowed(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    const directoryStat = lstatSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      fail([`${label} parent dizini symlink olmayan dizin olmalı.`]);
    }
  }
}

function runCheck(filePath) {
  const checkEnv = { ...process.env };
  delete checkEnv.UI_UX_REDESIGN_ALLOW_EXAMPLE_EVIDENCE;
  if (env.UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS) {
    checkEnv.UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS = env.UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS;
  }
  const result = spawnSync(process.execPath, ["scripts/check-ui-ux-redesign-evidence.mjs", pathToFileURL(filePath).href], {
    env: checkEnv,
    stdio: "inherit",
  });
  if (result.status !== 0) fail(["scripts/check-ui-ux-redesign-evidence.mjs başarısız oldu."]);
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") output.push(`${label} boş bırakılamaz.`);
}

function requireEvidenceValue(value, label, output) {
  requireValue(value, label, output);
  if (typeof value === "string" && hasPlaceholderToken(value)) output.push(`${label} placeholder/redacted/example değer içermemeli.`);
}

function requireCommitSha(value, label, output) {
  if (typeof value !== "string" || !/^[a-f0-9]{40}$/i.test(value)) {
    output.push(`${label} 40 karakter hex commit SHA olmalı.`);
  }
}

function requireReleaseCandidateBinding(releaseCandidate, sourceCommitSha, output) {
  if (typeof releaseCandidate !== "string" || typeof sourceCommitSha !== "string") return;
  const tag = releaseCandidate.match(/:([a-f0-9]{40})$/i)?.[1];
  if (!tag || tag.toLowerCase() !== sourceCommitSha.toLowerCase()) {
    output.push("UI_UX_REDESIGN_RELEASE_CANDIDATE tag'i UI_UX_REDESIGN_SOURCE_COMMIT_SHA ile birebir eşleşmeli.");
  }
}

function requireEqual(value, expected, label, output) {
  if (value !== expected) output.push(`${label} ${expected} olmalı.`);
}

function requireOneOf(value, label, expected, output) {
  if (!expected.includes(value)) output.push(`${label} ${expected.join(" veya ")} olmalı.`);
}

function requireDate(value, label, output) {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    output.push(`${label} geçerli tarih olmalı.`);
    return;
  }
  if (Date.parse(value) > Date.now() + 5 * 60 * 1000) output.push(`${label} gelecekte olamaz.`);
}

function requireDateOrder(earlier, later, label, output) {
  if (!Number.isNaN(Date.parse(earlier)) && !Number.isNaN(Date.parse(later)) && Date.parse(later) < Date.parse(earlier)) {
    output.push(`${label} UI_UX_REDESIGN_CHECKED_AT zamanından sonra olamaz.`);
  }
}

function hasPlaceholderToken(value) {
  const normalized = value.toLowerCase();
  return normalized.includes("example") || normalized.includes("__set") || normalized.includes("placeholder") || normalized.includes("redacted") || normalized.includes("todo");
}

function hasSecretBearingUrlParts(value) {
  const candidate = value.slice(value.indexOf(":") + 1);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(candidate)) return false;
  try {
    const url = new URL(candidate);
    return Boolean(url.username || url.password || url.search || url.hash);
  } catch {
    return false;
  }
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized === "/tmp" || normalized.startsWith("/tmp/") || normalized === "/var/tmp" || normalized.startsWith("/var/tmp/") || normalized === "/private/tmp" || normalized.startsWith("/private/tmp/");
}

function isLocalArtifactPath(filePath) {
  const normalized = filePath.replaceAll("\\", "/").replace(/\/+$/g, "") || "/";
  return normalized.endsWith("/artifacts/local") || normalized.includes("/artifacts/local/");
}

function fail(messages) {
  console.error("UI/UX redesign kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
