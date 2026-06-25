import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const repo = readArgValue("--repo") ?? process.env.GITHUB_REPOSITORY ?? inferRepoFromRemote();
const environment = readArgValue("--environment") ?? process.env.STAGING_GITHUB_ENVIRONMENT ?? "staging";
const ghBin = readArgValue("--gh-bin") ?? process.env.GH_BIN ?? defaultGhBin();
const gapReportFile = allowedLocalPath(
  readArgValue("--gap-report-file") ??
    process.env.STAGING_GITHUB_ENV_GAP_REPORT_FILE ??
    "artifacts/local/staging-github-env-gap-report.json",
  "STAGING_GITHUB_ENV_GAP_REPORT_FILE",
);

if (!repo) fail(["GitHub repo belirlenemedi; --repo owner/name veya GITHUB_REPOSITORY verilmeli."]);

const startedAt = new Date().toISOString();
const result = spawnSync(
  process.execPath,
  ["scripts/check-staging-github-environment.mjs", "--repo", repo, "--environment", environment, "--gh-bin", ghBin],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  },
);

const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
const failureMessages = parseFailureMessages(output);
const report = {
  result: result.status === 0 ? "PASS" : "GAP",
  overallStatus: result.status === 0 ? "READY" : "BLOCKED",
  generatedAt: new Date().toISOString(),
  startedAt,
  repo,
  environment,
  missingSecrets: extractNamedItems(failureMessages, "GitHub staging secret eksik:"),
  missingVariables: extractNamedItems(failureMessages, "GitHub staging variable eksik:"),
  invalidVariables: failureMessages.filter((message) => message.startsWith("STAGING_")),
  failureMessages,
  remediation: buildRemediation(failureMessages),
};

mkdirSync(dirname(gapReportFile), { recursive: true });
writeFileSync(gapReportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");

if (result.status === 0) {
  console.log(`GitHub staging environment gap özeti PASS: ${repo}/${environment}`);
  console.log(`GitHub staging environment gap raporu yazıldı: ${formatPath(gapReportFile)}`);
  process.exit(0);
}

console.log("GitHub staging environment gap özeti");
console.log(`- result: ${report.result}`);
console.log(`- overallStatus: ${report.overallStatus}`);
console.log(`- repo: ${repo}`);
console.log(`- environment: ${environment}`);
console.log(`- gapReportFile: ${formatPath(gapReportFile)}`);
console.log(`- missingSecrets: ${report.missingSecrets.length}`);
console.log(`- missingVariables: ${report.missingVariables.length}`);
console.log(`- invalidVariables: ${report.invalidVariables.length}`);

for (const secret of report.missingSecrets) {
  console.log("");
  console.log(`* missing secret: ${secret}`);
  const remediation = report.remediation.find((item) => item.name === secret);
  if (remediation) console.log(`  command: ${remediation.command}`);
}

for (const variable of report.missingVariables) {
  console.log("");
  console.log(`* missing variable: ${variable}`);
}

console.log("");
console.log(`GitHub staging environment gap raporu yazıldı: ${formatPath(gapReportFile)}`);
process.exit(result.status ?? 1);

function parseFailureMessages(value) {
  const marker = "GitHub staging environment kontrolü başarısız:";
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2))
    .filter((line) => line && !line.includes("secret set") && !line.includes("gh secret"));
}

function extractNamedItems(messages, prefix) {
  return messages
    .filter((message) => message.startsWith(prefix))
    .map((message) => message.slice(prefix.length).trim())
    .filter(Boolean);
}

function buildRemediation(messages) {
  const missingSecrets = new Set(extractNamedItems(messages, "GitHub staging secret eksik:"));
  const remediation = [];
  if (missingSecrets.has("GHCR_READ_TOKEN")) {
    remediation.push({
      name: "GHCR_READ_TOKEN",
      command:
        "pnpm staging:ghcr-read-token:secret:set -- --repo 4rmus/o-okul --environment staging --token-file /secure/path/ghcr-read-token",
    });
  }
  if (missingSecrets.has("STAGING_EVIDENCE_ENV_B64")) {
    remediation.push({
      name: "STAGING_EVIDENCE_ENV_B64",
      command:
        "pnpm staging:evidence-env:secret:set -- --repo 4rmus/o-okul --environment staging --env-file /secure/path/staging-evidence.env",
    });
  }
  return remediation;
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

function defaultGhBin() {
  if (existsSync("/opt/homebrew/bin/gh")) return "/opt/homebrew/bin/gh";
  return "gh";
}

function inferRepoFromRemote() {
  const result = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) return "";
  const remoteUrl = result.stdout.trim();
  const githubMatch = remoteUrl.match(/github\.com[:/](?<owner>[^/]+)\/(?<repo>[^/.]+)(?:\.git)?$/);
  if (!githubMatch?.groups) return "";
  return `${githubMatch.groups.owner}/${githubMatch.groups.repo}`;
}

function readArgValue(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) fail([`${name} için değer gerekli.`]);
  return value;
}

function formatPath(path) {
  const cwd = resolve(".");
  const relativePath = relative(cwd, path);
  return relativePath && !relativePath.startsWith("..") ? relativePath : path;
}

function fail(messages) {
  console.error("GitHub staging environment gap özeti başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
