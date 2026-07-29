import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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
const environment = readOption("--environment") ?? env.STAGING_ENVIRONMENT ?? env.NODE_ENV ?? "staging";
const checkedAt = env.UI_UX_REDESIGN_CHECKED_AT?.trim() || new Date().toISOString();
const releaseCandidate = env.UI_UX_REDESIGN_RELEASE_CANDIDATE?.trim();
const sourceCommitSha = env.UI_UX_REDESIGN_SOURCE_COMMIT_SHA?.trim();
const approvalRole = env.UI_UX_REDESIGN_APPROVAL_ROLE?.trim();
const approvedAt = env.UI_UX_REDESIGN_APPROVED_AT?.trim();

const failures = [];
requireValue(outputPath, "UI_UX_REDESIGN_EVIDENCE_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
requireEvidenceValue(releaseCandidate, "UI_UX_REDESIGN_RELEASE_CANDIDATE", failures);
requireCommitSha(sourceCommitSha, "UI_UX_REDESIGN_SOURCE_COMMIT_SHA", failures);
requireReleaseCandidateBinding(releaseCandidate, sourceCommitSha, failures);
requireDate(checkedAt, "UI_UX_REDESIGN_CHECKED_AT", failures);
requireEvidenceValue(approvalRole, "UI_UX_REDESIGN_APPROVAL_ROLE", failures);
requireDate(approvedAt, "UI_UX_REDESIGN_APPROVED_AT", failures);
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

const stagingEvidenceReferences = readReferenceList("UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES", 3, failures);
const phaseEvidence = phaseConfigs.map((config) => ({
  phase: config.phase,
  status: "PASS",
  scope: config.scope,
  commandsPassed: config.commandsPassed,
  evidenceReferences: readReferenceList(config.envKey, 1, failures),
}));
const viewportCoverage = viewportConfigs.map(([surface, envKey]) => ({
  surface,
  widths: requiredWidths,
  evidenceReferences: readReferenceList(envKey, requiredWidths.length, failures),
}));

if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

const report = {
  result: "PASS",
  environment,
  checkedAt,
  releaseCandidate,
  sourceCommitSha,
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
  privacy: {
    piiReview: "PASS",
    rawPiiInArtifacts: false,
    smsRecipientPreviewExported: false,
    guardianFinanceLeakageChecked: true,
    forbiddenRawFields,
  },
  approvals: [
    {
      role: approvalRole,
      decision: "PASS",
      approvedAt,
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
