import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const root = resolve("artifacts/local/ui-ux-release-readiness-contract");
const fakeBinDir = join(root, "bin");
const fakeGhPath = join(root, "fake-gh.mjs");
const fakeSshPath = join(fakeBinDir, "ssh");
const fakeRemoteArtifacts = join(root, "fake-remote-artifacts");
const githubGapReportFile = join(root, "github-gap.json");
const remoteSnapshotDir = join(root, "remote-snapshot");
const remoteGapReportFile = join(root, "remote-gap.json");
const summaryFile = join(root, "summary.json");
const secretLeakMarker = "super-secret-value-that-must-not-leak";

rmSync(root, { recursive: true, force: true });
mkdirSync(fakeBinDir, { recursive: true });
mkdirSync(fakeRemoteArtifacts, { recursive: true });
writeFakeGh();
writeFakeSsh();

try {
  expectBlockedSummary();
  expectFailure("summary outside artifacts/local", ["--summary-file", "../ui-ux-release-readiness.json"], [
    "UI_UX_REDESIGN_RELEASE_READINESS_SUMMARY_FILE artifacts/local altında olmalı.",
  ]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("UI/UX redesign release readiness summary contract kontrolü geçti.");

function expectBlockedSummary() {
  const result = runSummary([]);
  if (result.status === 0) failContract("eksik secret ve artifact için komut non-zero dönmeli.", result);

  const output = combinedOutput(result);
  for (const token of [
    "UI/UX redesign release readiness özeti",
    "- result: GAP",
    "- overallStatus: BLOCKED",
    "- releaseEvidence: false",
    "- githubMissingSecrets: 2",
    "- remoteCommit: contract123",
    "- remoteUiUxEvidenceScript: missing",
    "- localHead:",
    "- localDirty:",
    "github_environment_secret: GHCR_READ_TOKEN",
    "github_environment_secret: STAGING_EVIDENCE_ENV_B64",
    "remote_code_deploy: deploy-ui-ux-redesign-evidence-scripts",
    "gh workflow run staging-deploy.yml",
    "remote_release_artifact: reports/ui-ux-redesign.json",
  ]) {
    if (!output.includes(token)) failContract(`çıktı beklenen token'ı içermeli: ${token}`, result);
  }
  if (output.includes(secretLeakMarker)) failContract("çıktı secret değerini içermemeli.", result);

  if (!existsSync(summaryFile)) failContract("readiness summary yazılmalı.", result);
  const summary = JSON.parse(readFileSync(summaryFile, "utf8"));
  if (summary.result !== "GAP" || summary.overallStatus !== "BLOCKED") {
    failContract("summary GAP/BLOCKED olmalı.", result);
  }
  if (summary.releaseEvidence !== false) failContract("summary releaseEvidence=false olmalı.", result);
  if (JSON.stringify(summary).includes(secretLeakMarker)) failContract("summary secret değerini içermemeli.", result);
  if (JSON.stringify(summary.githubEnvironment.missingSecrets) !== JSON.stringify(["GHCR_READ_TOKEN", "STAGING_EVIDENCE_ENV_B64"])) {
    failContract("summary eksik GitHub secret isimlerini taşımalı.", result);
  }
  if (!summary.remoteReleaseBundle.openClosureItems?.some((item) => item.path === "reports/ui-ux-redesign.json")) {
    failContract("summary UI/UX remote kapanış kalemini taşımalı.", result);
  }
  if (!summary.nextActions?.some((item) => item.name === "reports/ui-ux-redesign.json")) {
    failContract("summary nextActions içinde UI/UX artifact kapanışını taşımalı.", result);
  }
  if (!summary.nextActions?.some((item) => item.kind === "remote_code_deploy")) {
    failContract("summary remote code deploy önkoşulunu taşımalı.", result);
  }
}

function expectFailure(label, extraArgs, expectedMessages) {
  const result = runSummary(extraArgs);
  if (result.status === 0) failContract(`${label} senaryosu kırılmalı.`, result);
  const output = combinedOutput(result);
  for (const message of expectedMessages) {
    if (!output.includes(message)) failContract(`${label} beklenen hatayı üretmeli: ${message}`, result);
  }
}

function runSummary(extraArgs) {
  return spawnSync(
    process.execPath,
    [
      "scripts/print-ui-ux-redesign-release-readiness-summary.mjs",
      "--repo",
      "owner/repo",
      "--environment",
      "staging",
      "--gh-bin",
      fakeGhPath,
      "--host",
      "fake-remote",
      "--remote-root",
      "/root/o-okul",
      "--github-gap-report-file",
      githubGapReportFile,
      "--remote-snapshot-dir",
      remoteSnapshotDir,
      "--remote-gap-report-file",
      remoteGapReportFile,
      "--summary-file",
      summaryFile,
      ...extraArgs,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${fakeBinDir}${delimiter}${process.env.PATH}`,
        FAKE_GH_SCENARIO: "missing-secrets",
        FAKE_REMOTE_ARTIFACTS_DIR: fakeRemoteArtifacts,
      },
      maxBuffer: 40 * 1024 * 1024,
    },
  );
}

function writeFakeGh() {
  writeFileSync(
    fakeGhPath,
    `#!/usr/bin/env node
const scenario = process.env.FAKE_GH_SCENARIO ?? "missing-secrets";
const args = process.argv.slice(2);

if (args[0] !== "api") fail("unsupported command");
const path = args[1];
if (path === "repos/owner/repo/environments/staging") writeJson({ name: "staging" });
if (path === "repos/owner/repo/environments/staging/variables?per_page=100") {
  writeJson({
    variables: [
      { name: "STAGING_DEPLOY_DIR", value: "/root/o-okul" },
      { name: "STAGING_NEXT_PUBLIC_API_URL", value: "https://212.108.107.190" },
      { name: "STAGING_EDGE_MODE", value: "ip" },
    ],
  });
}
if (path === "repos/owner/repo/environments/staging/secrets?per_page=100") {
  const names =
    scenario === "missing-secrets"
      ? ["STAGING_SSH_HOST", "STAGING_SSH_USER", "STAGING_SSH_PRIVATE_KEY"]
      : ["STAGING_SSH_HOST", "STAGING_SSH_USER", "STAGING_SSH_PRIVATE_KEY", "GHCR_READ_TOKEN", "STAGING_EVIDENCE_ENV_B64"];
  writeJson({ secrets: names.map((name) => ({ name, value: "${secretLeakMarker}" })) });
}
fail("unknown path");

function writeJson(value) {
  process.stdout.write(JSON.stringify(value));
  process.exit(0);
}
function fail(message) {
  process.stderr.write(message);
  process.exit(1);
}
`,
  );
  chmodSync(fakeGhPath, 0o700);
}

function writeFakeSsh() {
  writeFileSync(
    fakeSshPath,
    `#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const command = process.argv.at(-1) ?? "";
if (command === "printf remote-ok") {
  process.stdout.write("remote-ok");
  process.exit(0);
}
if (command.includes("git rev-parse --short HEAD")) {
  process.stdout.write("Remote staging source: fake-remote:/root/o-okul/artifacts/staging\\n");
  process.stdout.write("Remote commit: contract123\\n");
  process.stdout.write("Remote ui-ux evidence script: missing\\n");
  process.exit(0);
}
if (command.includes("tar -cf -")) {
  const result = spawnSync("tar", ["-cf", "-", "-C", process.env.FAKE_REMOTE_ARTIFACTS_DIR, "."], {
    encoding: "buffer",
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
  process.stdout.write(result.stdout);
  process.exit(0);
}
process.stderr.write("unexpected fake ssh command");
process.exit(2);
`,
  );
  chmodSync(fakeSshPath, 0o700);
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function failContract(message, result) {
  console.error("UI/UX redesign release readiness summary contract kontrolü başarısız:");
  console.error(`- ${message}`);
  if (result) console.error(combinedOutput(result));
  process.exit(1);
}
