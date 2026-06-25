import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, parse, relative, resolve } from "node:path";

const args = process.argv.slice(2);

const repo = readOption("--repo") ?? process.env.GITHUB_REPOSITORY ?? inferRepoFromRemote();
const environment = readOption("--environment") ?? process.env.STAGING_GITHUB_ENVIRONMENT ?? "staging";
const ghBin = readOption("--gh-bin") ?? process.env.GH_BIN;
const host = readOption("--host") ?? process.env.REMOTE_STAGING_RELEASE_HOST ?? process.env.REMOTE_EVIDENCE_HOST;
const remoteRoot = readOption("--remote-root") ?? process.env.REMOTE_STAGING_RELEASE_ROOT ?? process.env.REMOTE_EVIDENCE_ROOT;
const remoteArtifactsDir = readOption("--remote-artifacts-dir") ?? process.env.REMOTE_STAGING_RELEASE_ARTIFACTS_DIR;
const connectTimeout = readOption("--connect-timeout") ?? process.env.REMOTE_STAGING_RELEASE_CONNECT_TIMEOUT_SECONDS;

const githubGapReportFile = allowedLocalPath(
  readOption("--github-gap-report-file") ??
    process.env.UI_UX_REDESIGN_GITHUB_ENV_GAP_REPORT_FILE ??
    "artifacts/local/staging-github-env-gap-report.json",
  "UI_UX_REDESIGN_GITHUB_ENV_GAP_REPORT_FILE",
);
const remoteSnapshotDir = allowedLocalPath(
  readOption("--remote-snapshot-dir") ??
    process.env.UI_UX_REDESIGN_REMOTE_STAGING_SNAPSHOT_DIR ??
    "artifacts/local/remote-staging-snapshot",
  "UI_UX_REDESIGN_REMOTE_STAGING_SNAPSHOT_DIR",
);
const remoteGapReportFile = allowedLocalPath(
  readOption("--remote-gap-report-file") ??
    process.env.UI_UX_REDESIGN_REMOTE_STAGING_GAP_REPORT_FILE ??
    "artifacts/local/remote-staging-gap-report.json",
  "UI_UX_REDESIGN_REMOTE_STAGING_GAP_REPORT_FILE",
);
const summaryFile = allowedLocalPath(
  readOption("--summary-file") ??
    process.env.UI_UX_REDESIGN_RELEASE_READINESS_SUMMARY_FILE ??
    "artifacts/local/ui-ux-redesign-release-readiness-summary.json",
  "UI_UX_REDESIGN_RELEASE_READINESS_SUMMARY_FILE",
);

if (!repo) fail(["GitHub repo belirlenemedi; --repo owner/name veya GITHUB_REPOSITORY verilmeli."]);

const startedAt = new Date().toISOString();
const githubRun = runGithubGapSummary();
const remoteRun = runRemoteGapSummary();
const githubReport = readJsonIfExists(githubGapReportFile);
const remoteReport = readJsonIfExists(remoteGapReportFile);
const githubReady = githubRun.status === 0 && githubReport?.result === "PASS";
const remoteReady = remoteRun.status === 0 && remoteReport?.result === "PASS";
const remoteMetadata = parseRemoteMetadata(remoteRun.output);
const localGit = readLocalGitState();

const summary = {
  result: githubReady && remoteReady ? "PASS" : "GAP",
  overallStatus: githubReady && remoteReady ? "READY" : "BLOCKED",
  generatedAt: new Date().toISOString(),
  startedAt,
  releaseEvidence: false,
  note:
    "Bu dosya UI/UX redesign release readiness handoff raporudur; tek başına staging/prod release evidence sayılmaz.",
  localWorkspace: localGit,
  githubEnvironment: {
    reportFile: formatPath(githubGapReportFile),
    result: githubReport?.result ?? "ERROR",
    overallStatus: githubReport?.overallStatus ?? "BLOCKED",
    repo,
    environment,
    missingSecrets: githubReport?.missingSecrets ?? [],
    missingVariables: githubReport?.missingVariables ?? [],
    invalidVariables: githubReport?.invalidVariables ?? [],
    remediation: githubReport?.remediation ?? [],
  },
  remoteReleaseBundle: {
    reportFile: formatPath(remoteGapReportFile),
    snapshotDir: formatPath(remoteSnapshotDir),
    result: remoteReport?.result ?? "ERROR",
    overallStatus: remoteReport?.overallStatus ?? "BLOCKED",
    remoteCommit: remoteMetadata.commit,
    remoteUiUxEvidenceScript: remoteMetadata.uiUxEvidenceScript,
    missingRequiredFiles: remoteReport?.missingRequiredFiles ?? [],
    openClosureItems: remoteReport?.openClosureItems ?? [],
    unexpectedFiles: remoteReport?.unexpectedFiles ?? [],
    invalidFiles: remoteReport?.invalidFiles ?? [],
  },
  nextActions: buildNextActions(githubReport, remoteReport, remoteMetadata, localGit),
};

mkdirSync(dirname(summaryFile), { recursive: true });
writeFileSync(summaryFile, `${JSON.stringify(summary, null, 2)}\n`, "utf8");

console.log("UI/UX redesign release readiness özeti");
console.log(`- result: ${summary.result}`);
console.log(`- overallStatus: ${summary.overallStatus}`);
console.log(`- releaseEvidence: ${summary.releaseEvidence}`);
console.log(`- summaryFile: ${formatPath(summaryFile)}`);
console.log(`- githubMissingSecrets: ${summary.githubEnvironment.missingSecrets.length}`);
console.log(`- githubMissingVariables: ${summary.githubEnvironment.missingVariables.length}`);
console.log(`- remoteCommit: ${summary.remoteReleaseBundle.remoteCommit ?? "unknown"}`);
console.log(`- remoteUiUxEvidenceScript: ${summary.remoteReleaseBundle.remoteUiUxEvidenceScript ?? "unknown"}`);
console.log(`- localHead: ${summary.localWorkspace.head ?? "unknown"}`);
console.log(`- localDirty: ${summary.localWorkspace.dirty}`);
console.log(`- remoteMissingRequiredFiles: ${summary.remoteReleaseBundle.missingRequiredFiles.length}`);
console.log(`- openClosureItems: ${summary.remoteReleaseBundle.openClosureItems.length}`);

for (const action of summary.nextActions.slice(0, 12)) {
  console.log("");
  console.log(`* ${action.kind}: ${action.name}`);
  if (action.command) console.log(`  command: ${action.command}`);
  if (action.ownerAgent) console.log(`  ownerAgent: ${action.ownerAgent}`);
  if (action.evidenceGate) console.log(`  evidenceGate: ${action.evidenceGate}`);
}

if (summary.nextActions.length > 12) {
  console.log("");
  console.log(`... ${summary.nextActions.length - 12} ek kapanış kalemi için ${formatPath(summaryFile)} dosyasına bakın.`);
}

process.exit(summary.result === "PASS" ? 0 : 1);

function runGithubGapSummary() {
  const commandArgs = [
    "scripts/print-staging-github-env-gap-summary.mjs",
    "--repo",
    repo,
    "--environment",
    environment,
    "--gap-report-file",
    githubGapReportFile,
  ];
  if (ghBin) commandArgs.push("--gh-bin", ghBin);
  return runNode(commandArgs);
}

function runRemoteGapSummary() {
  const commandArgs = [
    "scripts/print-remote-staging-release-gap-summary.mjs",
    "--snapshot-dir",
    remoteSnapshotDir,
    "--gap-report-file",
    remoteGapReportFile,
  ];
  if (host) commandArgs.push("--host", host);
  if (remoteRoot) commandArgs.push("--remote-root", remoteRoot);
  if (remoteArtifactsDir) commandArgs.push("--remote-artifacts-dir", remoteArtifactsDir);
  if (connectTimeout) commandArgs.push("--connect-timeout", connectTimeout);
  return runNode(commandArgs);
}

function runNode(commandArgs) {
  const result = spawnSync(process.execPath, commandArgs, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 40 * 1024 * 1024,
  });
  return {
    status: result.status ?? 1,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

function buildNextActions(githubReport, remoteReport, remoteMetadata, localGit) {
  const actions = [];
  for (const item of githubReport?.remediation ?? []) {
    actions.push({
      kind: "github_environment_secret",
      name: item.name,
      command: item.command,
      evidenceGate: "staging:github-env:check",
    });
  }
  if (remoteMetadata.uiUxEvidenceScript !== "present") {
    actions.push({
      kind: "remote_code_deploy",
      name: "deploy-ui-ux-redesign-evidence-scripts",
      command: `gh workflow run staging-deploy.yml --repo ${repo} -f rollback_image_tag=<last-known-good-tag>`,
      ownerAgent: "ops_release_engineer",
      evidenceGate: "staging:remote-release-gaps:summary",
      phase: "Faz 5 - UI/UX redesign staging deploy",
      nextActionKind: "commit_push_and_dispatch_staging_deploy",
      prerequisite:
        "GitHub staging env PASS olmalı; UI/UX redesign değişiklikleri commit/push edilmeden workflow dispatch edilmemeli.",
      blocker: `Remote package ui-ux-redesign:evidence-generate script'ini içermiyor; remoteCommit=${remoteMetadata.commit ?? "unknown"}, localHead=${localGit.head ?? "unknown"}, localDirty=${localGit.dirty}.`,
    });
  }
  for (const item of remoteReport?.missingRequiredFiles ?? []) {
    actions.push({
      kind: "remote_release_artifact",
      name: item.path,
      command: item.remediation?.command,
      ownerAgent: item.remediation?.ownerAgent,
      evidenceGate: item.remediation?.evidenceGate,
      phase: item.remediation?.phase,
      nextActionKind: item.remediation?.nextActionKind,
      prerequisite: item.remediation?.prerequisite,
      blocker: item.remediation?.blocker,
    });
  }
  return actions.sort(compareNextAction);
}

function compareNextAction(left, right) {
  return nextActionPriority(left) - nextActionPriority(right);
}

function nextActionPriority(action) {
  if (action.kind === "github_environment_secret") return 0;
  if (action.kind === "remote_code_deploy") return 1;
  if (action.name === "reports/ui-ux-redesign.json") return 1;
  if (action.name === "reports/uat.json") return 2;
  if (action.name === "release-summary-*.json") return 3;
  return 10;
}

function readJsonIfExists(path) {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseRemoteMetadata(output) {
  return {
    commit: readOutputValue(output, "Remote commit:"),
    uiUxEvidenceScript: readOutputValue(output, "Remote ui-ux evidence script:"),
  };
}

function readLocalGitState() {
  const head = runGit(["rev-parse", "--short", "HEAD"]);
  const status = runGit(["status", "--short"]);
  return {
    head: head || undefined,
    dirty: Boolean(status),
  };
}

function runGit(commandArgs) {
  const result = spawnSync("git", commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  if (result.status !== 0) return "";
  return result.stdout.trim();
}

function readOutputValue(output, prefix) {
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(prefix));
  return line ? line.slice(prefix.length).trim() : undefined;
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

function readOption(name) {
  const index = args.lastIndexOf(name);
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
  console.error("UI/UX redesign release readiness özeti başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
