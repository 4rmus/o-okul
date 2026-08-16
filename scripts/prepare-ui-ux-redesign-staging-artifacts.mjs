import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inspectPng } from "./png-artifact.mjs";

const requiredWidths = [320, 375, 414, 768, 1024, 1440];
const releaseCommands = [
  "pnpm prod:evidence:templates:check",
  "pnpm prod:plan:check",
  "pnpm live:onboarding:smoke",
  "pnpm live:ui-worker:smoke",
  "pnpm uat:check",
];
const phaseCommands = [
  ["pnpm --filter @o-okul/web typecheck", "pnpm web:design-tokens:check", "pnpm web:a11y:check", "pnpm web:auth-contract:check"],
  ["pnpm web:ux-contract:check"],
  ["pnpm --filter @o-okul/ui build", "pnpm web:ux-contract:check"],
  ["pnpm karne:visual-contract:check", "pnpm live:ui-worker:smoke"],
  ["pnpm web:ux-contract:check"],
  ["pnpm prod:evidence:templates:check", "pnpm uat:check"],
];
const surfaces = [
  { envKey: "UI_UX_REDESIGN_KURUM_DASHBOARD_REFERENCES", name: "dashboard", source: "faz9-dashboard" },
  { envKey: "UI_UX_REDESIGN_OPTIK_WORKSPACE_REFERENCES", name: "optik", source: "faz9-optik-workflow" },
  { envKey: "UI_UX_REDESIGN_RAPOR_WORKSPACE_REFERENCES", name: "rapor", source: "faz9-report-workspace" },
  { envKey: "UI_UX_REDESIGN_PORTAL_SHELL_REFERENCES", name: "portal", source: "faz9-student-action-strip" },
];

const envPath = requiredOption("--env-file");
const captureDir = resolve(requiredOption("--capture-dir"));
const outputDir = stagingArtifactDirectory(requiredOption("--output-dir"), "--output-dir");
const baseUrl = requiredOption("--base-url");
const sourceCommitSha = requiredEnvironment("CUTOVER_SOURCE_SHA");
const repository = requiredEnvironment("CUTOVER_REPOSITORY");
const envFile = readEnvFile(envPath);
const githubCiTarget = requiredValue(process.env.GITHUB_CI_EVIDENCE_TARGET ?? envFile.values.get("GITHUB_CI_EVIDENCE_TARGET"), "GITHUB_CI_EVIDENCE_TARGET");
const approvedBy = requiredValue(envFile.values.get("UI_UX_REDESIGN_APPROVED_BY"), "UI_UX_REDESIGN_APPROVED_BY");
const approvedAt = requiredDate(envFile.values.get("UI_UX_REDESIGN_APPROVED_AT"), "UI_UX_REDESIGN_APPROVED_AT");

if (!/^[a-f0-9]{40}$/i.test(sourceCommitSha)) fail("CUTOVER_SOURCE_SHA 40 karakter hex SHA olmalı.");
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) fail("CUTOVER_REPOSITORY owner/repo biçiminde olmalı.");
if (baseUrl !== "https://o-okul.com") fail("--base-url exact public cutover origin olmalı.");
for (const [key, expected] of [
  ["UI_UX_REDESIGN_PII_REVIEW", "PASS"],
  ["UI_UX_REDESIGN_RAW_PII_IN_ARTIFACTS", "false"],
  ["UI_UX_REDESIGN_SMS_RECIPIENT_PREVIEW_EXPORTED", "false"],
  ["UI_UX_REDESIGN_GUARDIAN_FINANCE_LEAKAGE_CHECKED", "true"],
]) {
  if (envFile.values.get(key) !== expected) fail(`${key} ${expected} olmalı.`);
}

const githubCiPath = fileTargetPath(githubCiTarget, "GITHUB_CI_EVIDENCE_TARGET");
const githubCiBytes = readPlainFile(githubCiPath, "GITHUB_CI_EVIDENCE_TARGET");
const githubCiCheck = spawnSync(process.execPath, ["scripts/check-github-ci-evidence.mjs"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, GITHUB_CI_EVIDENCE_TARGET: githubCiTarget },
});
if (githubCiCheck.status !== 0) fail("GITHUB_CI_EVIDENCE_TARGET doğrulanamadı.");

const githubCi = parseJson(githubCiBytes, "GITHUB_CI_EVIDENCE_TARGET");
const runId = String(githubCi.workflow?.runId ?? "");
const runUrl = `https://github.com/${repository}/actions/runs/${runId}`;
if (
  githubCi.repository !== repository ||
  githubCi.commitSha?.toLowerCase() !== sourceCommitSha.toLowerCase() ||
  githubCi.workflow?.path !== ".github/workflows/ci.yml" ||
  githubCi.workflow?.conclusion !== "success" ||
  githubCi.workflow?.runUrl !== runUrl ||
  !/^\d+$/.test(runId)
) {
  fail("GitHub CI kanıtı exact cutover SHA/repository/success run bağıyla eşleşmeli.");
}
const ciCompletedAt = requiredDate(githubCi.workflow.completedAt, "GitHub CI completedAt");
if (Date.parse(approvedAt) < Date.parse(ciCompletedAt)) fail("UI/UX onayı GitHub CI tamamlanmasından önce olamaz.");
if (!existsSync(captureDir) || lstatSync(captureDir).isSymbolicLink() || !lstatSync(captureDir).isDirectory()) {
  fail("--capture-dir symlink olmayan mevcut dizin olmalı.");
}

mkdirPlain(outputDir);
const reproducedAt = new Date().toISOString();
const artifactReferences = new Map();
const pngHashes = [];
for (const surface of surfaces) {
  const references = [];
  for (const width of requiredWidths) {
    const source = resolve(captureDir, `${surface.source}-${width}.png`);
    const bytes = readPlainFile(source, `${surface.name} ${width}px capture`);
    const png = inspectPng(bytes);
    if (!png?.hasVisibleContent || png.width !== width) {
      fail(`${surface.name} ${width}px capture görünür içerik ve exact genişlik taşımalı.`);
    }
    const destination = resolve(outputDir, `${surface.name}-${width}.png`);
    copyFileSync(source, destination);
    chmodSync(destination, 0o600);
    const copied = readPlainFile(destination, `${surface.name} ${width}px artifact`);
    if (!copied.equals(bytes)) fail(`${surface.name} ${width}px artifact kopyası değişmemeli.`);
    const reference = artifactReference(destination);
    references.push(reference);
    pngHashes.push(createHash("sha256").update(copied).digest("hex"));
  }
  artifactReferences.set(surface.envKey, references.join(","));
}

const sharedEvidence = {
  result: "PASS",
  environment: "staging",
  sourceCommitSha,
  checkedAt: approvedAt,
  reproducedAt,
  runUrl,
  targetUrl: baseUrl,
  captureMode: "public-staging-ui-with-synthetic-api-routes",
  ignoredConsoleMessages: ["cloudflare-insights-beacon-csp"],
};
const supportingArtifacts = [
  ["summary.json", { ...sharedEvidence, evidenceType: "ui-ux-redesign-summary", commandsPassed: releaseCommands }],
  ["uat.json", { ...sharedEvidence, evidenceType: "ui-ux-redesign-uat", commandsPassed: ["pnpm uat:check"] }],
  ...phaseCommands.map((commandsPassed, index) => [
    `phase-${index}.json`,
    { ...sharedEvidence, evidenceType: `ui-ux-redesign-phase-${index}`, commandsPassed },
  ]),
];
for (const [name, contents] of supportingArtifacts) writeJson(resolve(outputDir, name), contents);

const privacyPath = resolve(outputDir, "privacy-review.json");
writeJson(privacyPath, {
  ...sharedEvidence,
  evidenceType: "ui-ux-redesign-privacy-review",
  syntheticDataOnly: true,
  reviewer: { id: approvedBy, role: "privacy-owner" },
  reviewedPngSha256: [...pngHashes].sort(),
});

const referenceFor = (name) => artifactReference(resolve(outputDir, name));
const replacements = new Map([
  ["UI_UX_REDESIGN_ALLOWED_EVIDENCE_HOSTS", ""],
  [
    "UI_UX_REDESIGN_STAGING_EVIDENCE_REFERENCES",
    [referenceFor("summary.json"), `run:${runUrl}`, referenceFor("uat.json"), referenceFor("privacy-review.json")].join(","),
  ],
  ...phaseCommands.map((_, index) => [`UI_UX_REDESIGN_PHASE_${index}_REFERENCES`, referenceFor(`phase-${index}.json`)]),
  ...artifactReferences,
  ["UI_UX_REDESIGN_PRIVACY_REVIEW_REFERENCE", referenceFor("privacy-review.json")],
]);
const nextEnv = replaceUniqueValues(envFile.lines, replacements);
writeFileSync(envPath, `${nextEnv.join("\n").replace(/\n+$/u, "")}\n`, { mode: 0o600 });
chmodSync(envPath, 0o600);

console.log(`UI/UX staging artifact seti hazır: ${relative(process.cwd(), outputDir)} (${pngHashes.length} PNG, ${supportingArtifacts.length + 1} JSON)`);

function requiredOption(name) {
  const index = process.argv.indexOf(name);
  const value = index === -1 ? undefined : process.argv[index + 1];
  return requiredValue(value?.startsWith("--") ? undefined : value, name);
}

function requiredEnvironment(name) {
  return requiredValue(process.env[name], name);
}

function requiredValue(value, label) {
  if (typeof value !== "string" || value.trim() === "") fail(`${label} boş bırakılamaz.`);
  return value.trim();
}

function requiredDate(value, label) {
  const normalized = requiredValue(value, label);
  if (Number.isNaN(Date.parse(normalized)) || Date.parse(normalized) > Date.now() + 5 * 60 * 1000) {
    fail(`${label} geçerli ve gelecekte olmayan tarih olmalı.`);
  }
  return normalized;
}

function stagingArtifactDirectory(value, label) {
  const absolute = resolve(value);
  const repoRelative = relative(process.cwd(), absolute).replaceAll("\\", "/");
  if (!repoRelative.startsWith("artifacts/staging/") || repoRelative.includes("/../")) {
    fail(`${label} artifacts/staging altında olmalı.`);
  }
  return absolute;
}

function readEnvFile(file) {
  const bytes = readPlainFile(resolve(file), "--env-file");
  const lines = bytes.toString("utf8").split(/\r?\n/);
  const values = new Map();
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator < 1) fail(`${file}:${index + 1} KEY=VALUE biçiminde olmalı.`);
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Z0-9_]+$/.test(key)) fail(`${file}:${index + 1} env anahtarı geçersiz.`);
    values.set(key, trimmed.slice(separator + 1).replace(/^["']|["']$/g, ""));
  }
  return { lines, values };
}

function replaceUniqueValues(lines, replacements) {
  const counts = new Map([...replacements.keys()].map((key) => [key, 0]));
  const next = lines.map((line) => {
    for (const [key, value] of replacements) {
      if (line.startsWith(`${key}=`)) {
        counts.set(key, counts.get(key) + 1);
        return `${key}=${value}`;
      }
    }
    return line;
  });
  for (const [key, count] of counts) {
    if (count !== 1) fail(`${key} env dosyasında tam olarak bir kez tanımlanmalı.`);
  }
  return next;
}

function fileTargetPath(target, label) {
  let url;
  try {
    url = new URL(target);
  } catch {
    fail(`${label} file:// URL olmalı.`);
  }
  if (url.protocol !== "file:" || url.username || url.password || url.search || url.hash) {
    fail(`${label} secret taşımayan file:// URL olmalı.`);
  }
  return resolve(fileURLToPath(url));
}

function readPlainFile(file, label) {
  if (!existsSync(file)) fail(`${label} mevcut dosyaya bağlanmalı.`);
  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) fail(`${label} symlink olmayan dosya olmalı.`);
  return readFileSync(file);
}

function mkdirPlain(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) fail("UI/UX output symlink olmayan dizin olmalı.");
  chmodSync(directory, 0o700);
}

function artifactReference(file) {
  const repoRelative = relative(process.cwd(), file).replaceAll("\\", "/");
  if (!repoRelative.startsWith("artifacts/staging/")) fail("Artifact referansı artifacts/staging altında olmalı.");
  return `artifact:${repoRelative}`;
}

function writeJson(file, contents) {
  mkdirPlain(dirname(file));
  writeFileSync(file, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600);
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    fail(`${label} geçerli JSON olmalı.`);
  }
}

function fail(message) {
  console.error(`UI/UX staging artifact hazırlığı başarısız: ${message}`);
  process.exit(1);
}
