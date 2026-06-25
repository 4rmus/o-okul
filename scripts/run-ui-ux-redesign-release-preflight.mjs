import { spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { dirname, parse, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const summaryFile = allowedLocalPath(
  readOption("--summary-file") ??
    process.env.UI_UX_REDESIGN_RELEASE_PREFLIGHT_SUMMARY_FILE ??
    "artifacts/local/ui-ux-redesign-release-readiness-summary.json",
  "UI_UX_REDESIGN_RELEASE_PREFLIGHT_SUMMARY_FILE",
);
const maxAgeMinutes = readOptionalPositiveNumber("--max-age-minutes") ?? 30;
const summaryScript =
  readOption("--summary-script") ??
  process.env.UI_UX_REDESIGN_RELEASE_PREFLIGHT_SUMMARY_SCRIPT ??
  "scripts/print-ui-ux-redesign-release-readiness-summary.mjs";
const checkScript =
  readOption("--check-script") ??
  process.env.UI_UX_REDESIGN_RELEASE_PREFLIGHT_CHECK_SCRIPT ??
  "scripts/check-ui-ux-redesign-release-readiness-summary.mjs";

const summaryArgs = buildSummaryArgs();

console.log("UI/UX release preflight: readiness özeti üretiliyor");
const summaryResult = runNode(summaryScript, summaryArgs);
writeProcessOutput(summaryResult);

if (summaryResult.status !== 0) {
  console.error(`UI/UX release preflight: summary komutu non-zero döndü (${summaryResult.status}); yazılan özet doğrulanacak.`);
}

if (!existsSync(summaryFile)) {
  fail([`summary dosyası yazılmadı: ${formatPath(summaryFile)}`]);
}

console.log("UI/UX release preflight: deploy readiness kontrolü çalışıyor");
const checkResult = runNode(checkScript, [
  "--target",
  summaryFile,
  "--max-age-minutes",
  String(maxAgeMinutes),
  "--require-ready",
]);
writeProcessOutput(checkResult);

process.exit(checkResult.status);

function buildSummaryArgs() {
  const output = [];
  const skipValueOptions = new Set(["--max-age-minutes", "--summary-script", "--check-script"]);
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (skipValueOptions.has(arg)) {
      index += 1;
      continue;
    }
    output.push(arg);
  }
  if (!args.includes("--summary-file")) {
    output.push("--summary-file", summaryFile);
  }
  return output;
}

function runNode(script, commandArgs) {
  const result = spawnSync(process.execPath, [script, ...commandArgs], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 60 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function writeProcessOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
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
  console.error("UI/UX release preflight başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
