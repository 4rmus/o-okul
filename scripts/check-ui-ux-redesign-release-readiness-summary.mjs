import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, parse, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const target = allowedLocalPath(
  readOption("--target") ??
    process.env.UI_UX_REDESIGN_RELEASE_READINESS_SUMMARY_TARGET ??
    "artifacts/local/ui-ux-redesign-release-readiness-summary.json",
  "UI_UX_REDESIGN_RELEASE_READINESS_SUMMARY_TARGET",
);
const requireReady = args.includes("--require-ready");
const maxAgeMinutes = readOptionalPositiveNumber("--max-age-minutes");

if (!existsSync(target)) {
  fail([`${formatPath(target)} bulunamadı; önce pnpm ui-ux-redesign:release-readiness:summary çalıştırılmalı.`]);
}

const summary = JSON.parse(readFileSync(target, "utf8"));
const failures = [];

requireString("result", summary.result, ["PASS", "GAP"]);
requireString("overallStatus", summary.overallStatus, ["READY", "BLOCKED"]);
requireBoolean("releaseEvidence", summary.releaseEvidence);
const generatedAt = requireDate("generatedAt", summary.generatedAt);
const startedAt = requireDate("startedAt", summary.startedAt);
requireObject("localWorkspace", summary.localWorkspace);
requireObject("githubEnvironment", summary.githubEnvironment);
requireObject("remoteReleaseBundle", summary.remoteReleaseBundle);
requireArray("nextActions", summary.nextActions);

validateChildReport(
  "githubEnvironment",
  summary.githubEnvironment?.reportFile,
  summary.githubEnvironment?.result,
  summary.githubEnvironment?.overallStatus,
  startedAt,
  generatedAt,
);
validateChildReport(
  "remoteReleaseBundle",
  summary.remoteReleaseBundle?.reportFile,
  summary.remoteReleaseBundle?.result,
  summary.remoteReleaseBundle?.overallStatus,
  startedAt,
  generatedAt,
);

if (summary.releaseEvidence !== false) {
  failures.push("releaseEvidence false olmalı; readiness handoff final kanıt değildir.");
}

if (generatedAt && startedAt && startedAt.getTime() > generatedAt.getTime()) {
  failures.push("startedAt generatedAt tarihinden sonra olamaz.");
}

if (generatedAt && maxAgeMinutes !== undefined) {
  const ageMs = Date.now() - generatedAt.getTime();
  if (ageMs > maxAgeMinutes * 60 * 1000) {
    failures.push(`generatedAt ${maxAgeMinutes} dakika sınırından eski; summary yeniden üretilmeli.`);
  }
}

if (summary.result === "GAP" && summary.overallStatus !== "BLOCKED") {
  failures.push("result=GAP iken overallStatus=BLOCKED olmalı.");
}

if (summary.result === "PASS" && summary.overallStatus !== "READY") {
  failures.push("result=PASS iken overallStatus=READY olmalı.");
}

if (summary.result === "GAP" && summary.nextActions.length === 0) {
  failures.push("GAP summary en az bir nextActions girdisi taşımalı.");
}

for (const secret of summary.githubEnvironment?.missingSecrets ?? []) {
  if (!hasAction("github_environment_secret", secret)) {
    failures.push(`Eksik GitHub secret için nextAction yok: ${secret}`);
  }
}

const remoteScriptMissing = summary.remoteReleaseBundle?.remoteUiUxEvidenceScript !== "present";
if (remoteScriptMissing) {
  const deployIndex = findActionIndex((item) => item.kind === "remote_code_deploy");
  if (deployIndex === -1) {
    failures.push("Remote UI/UX evidence script yokken remote_code_deploy nextAction zorunlu.");
  }
  const uiArtifactIndex = findActionIndex((item) => item.name === "reports/ui-ux-redesign.json");
  if (deployIndex !== -1 && uiArtifactIndex !== -1 && deployIndex > uiArtifactIndex) {
    failures.push("remote_code_deploy, reports/ui-ux-redesign.json üretiminden önce listelenmeli.");
  }
}

const serialized = JSON.stringify(summary);
for (const leakToken of ["super-secret-value-that-must-not-leak", "github_pat_", "ghp_", "BEGIN OPENSSH PRIVATE KEY"]) {
  if (serialized.includes(leakToken)) failures.push(`Readiness summary hassas değer kalıbı içeriyor: ${leakToken}`);
}

if (requireReady) {
  requireDeployReady(summary);
}

if (failures.length > 0) fail(failures);

console.log(`UI/UX redesign release readiness summary kontrolü geçti: ${summary.result}/${summary.overallStatus}`);
if (requireReady) console.log("UI/UX redesign deploy/release readiness koşulları hazır görünüyor.");

function requireDeployReady(value) {
  if (value.result !== "PASS") failures.push("--require-ready için result=PASS olmalı.");
  if (value.overallStatus !== "READY") failures.push("--require-ready için overallStatus=READY olmalı.");
  if (value.localWorkspace?.dirty !== false) failures.push("--require-ready için localWorkspace.dirty=false olmalı.");
  if ((value.githubEnvironment?.missingSecrets?.length ?? 0) > 0) failures.push("--require-ready için eksik GitHub secret olmamalı.");
  if ((value.githubEnvironment?.missingVariables?.length ?? 0) > 0) failures.push("--require-ready için eksik GitHub variable olmamalı.");
  if ((value.githubEnvironment?.invalidVariables?.length ?? 0) > 0) failures.push("--require-ready için geçersiz GitHub variable olmamalı.");
  if (value.remoteReleaseBundle?.remoteUiUxEvidenceScript !== "present") {
    failures.push("--require-ready için remote ui-ux evidence script present olmalı.");
  }
  if ((value.remoteReleaseBundle?.missingRequiredFiles?.length ?? 0) > 0) {
    failures.push("--require-ready için eksik remote release artifact olmamalı.");
  }
  if ((value.remoteReleaseBundle?.openClosureItems?.length ?? 0) > 0) {
    failures.push("--require-ready için açık remote kapanış kalemi olmamalı.");
  }
  if ((value.nextActions?.length ?? 0) > 0) failures.push("--require-ready için nextActions boş olmalı.");
}

function validateChildReport(label, reportFile, expectedResult, expectedOverallStatus, summaryStartedAt, summaryGeneratedAt) {
  if (typeof reportFile !== "string" || !reportFile) {
    failures.push(`${label}.reportFile zorunlu.`);
    return;
  }

  const reportPath = allowedLocalPath(reportFile, `${label}.reportFile`);
  if (!existsSync(reportPath)) {
    failures.push(`${label}.reportFile bulunamadı: ${formatPath(reportPath)}`);
    return;
  }

  const report = JSON.parse(readFileSync(reportPath, "utf8"));
  if (report.result !== expectedResult) {
    failures.push(`${label}.result child report ile eşleşmeli.`);
  }
  if (report.overallStatus !== expectedOverallStatus) {
    failures.push(`${label}.overallStatus child report ile eşleşmeli.`);
  }

  const reportGeneratedAt = requireDate(`${label}.reportFile.generatedAt`, report.generatedAt);
  if (!reportGeneratedAt || !summaryStartedAt || !summaryGeneratedAt) return;

  if (reportGeneratedAt.getTime() < summaryStartedAt.getTime() - 1000) {
    failures.push(`${label}.reportFile generatedAt summary startedAt tarihinden eski; summary yeniden üretilmeli.`);
  }
  if (reportGeneratedAt.getTime() > summaryGeneratedAt.getTime() + 1000) {
    failures.push(`${label}.reportFile generatedAt summary generatedAt tarihinden sonra olamaz.`);
  }
}

function hasAction(kind, name) {
  return summary.nextActions.some((item) => item.kind === kind && item.name === name);
}

function findActionIndex(predicate) {
  return summary.nextActions.findIndex(predicate);
}

function requireString(path, value, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    failures.push(`${path} şu değerlerden biri olmalı: ${allowed.join(", ")}`);
  }
}

function requireBoolean(path, value) {
  if (typeof value !== "boolean") failures.push(`${path} boolean olmalı.`);
}

function requireDate(path, value) {
  if (typeof value !== "string") {
    failures.push(`${path} ISO tarih string olmalı.`);
    return null;
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    failures.push(`${path} geçerli tarih değil.`);
    return null;
  }
  if (date.getTime() > Date.now() + 60_000) {
    failures.push(`${path} gelecekte olamaz.`);
  }
  return date;
}

function requireObject(path, value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) failures.push(`${path} object olmalı.`);
}

function requireArray(path, value) {
  if (!Array.isArray(value)) failures.push(`${path} array olmalı.`);
}

function allowedLocalPath(value, label) {
  const outputPath = resolve(value);
  const allowedRoot = resolve("artifacts/local");
  if (outputPath === allowedRoot || !outputPath.startsWith(`${allowedRoot}/`)) {
    fail([`${label} artifacts/local altında olmalı.`]);
  }
  if (existsSync(outputPath) && lstatSync(outputPath).isSymbolicLink()) {
    fail([`${label} symlink olmayan hedef olmalı.`]);
  }
  requireParentPathAllowed(dirname(outputPath), label);
  return outputPath;
}

function requireParentPathAllowed(parentPath, label) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;
  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail([`${label} parent dizini symlink olmayan dizin olmalı.`]);
    }
  }
}

function readOption(name) {
  const index = args.lastIndexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail([`${name} için değer gerekli.`]);
  return value;
}

function readOptionalPositiveNumber(name) {
  const value = readOption(name);
  if (value === undefined) return undefined;
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) fail([`${name} pozitif sayı olmalı.`]);
  return numberValue;
}

function formatPath(path) {
  const cwd = resolve(".");
  const relativePath = relative(cwd, path);
  return relativePath && !relativePath.startsWith("..") ? relativePath : path;
}

function fail(messages) {
  console.error("UI/UX redesign release readiness summary kontrolü başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
