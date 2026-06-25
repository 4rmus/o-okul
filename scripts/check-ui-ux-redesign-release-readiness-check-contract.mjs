import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve("artifacts/local/ui-ux-release-readiness-check-contract");
const blockedSummary = join(root, "blocked-summary.json");
const readySummary = join(root, "ready-summary.json");
const badSummary = join(root, "bad-summary.json");
const blockedGithubReport = join(root, "blocked-github-gap.json");
const blockedRemoteReport = join(root, "blocked-remote-gap.json");
const readyGithubReport = join(root, "ready-github-gap.json");
const readyRemoteReport = join(root, "ready-remote-gap.json");

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

try {
  writeJson(blockedSummary, makeBlockedSummary());
  expectPass("blocked summary shape", ["--target", blockedSummary], ["GAP/BLOCKED"]);
  expectPass("blocked summary max-age", ["--target", blockedSummary, "--max-age-minutes", "10"], ["GAP/BLOCKED"]);
  expectFailure("blocked summary require-ready", ["--target", blockedSummary, "--require-ready"], [
    "--require-ready için result=PASS olmalı.",
    "--require-ready için eksik GitHub secret olmamalı.",
    "--require-ready için remote ui-ux evidence script present olmalı.",
  ]);

  writeJson(readySummary, makeReadySummary());
  expectPass("ready summary require-ready", ["--target", readySummary, "--require-ready"], [
    "PASS/READY",
    "deploy/release readiness koşulları hazır görünüyor",
  ]);

  const bad = makeBlockedSummary();
  bad.nextActions = bad.nextActions.filter((item) => item.kind !== "remote_code_deploy");
  writeJson(badSummary, bad);
  expectFailure("missing remote_code_deploy", ["--target", badSummary], [
    "Remote UI/UX evidence script yokken remote_code_deploy nextAction zorunlu.",
  ]);

  expectFailure("target outside artifacts/local", ["--target", "../ui-ux-release-readiness-summary.json"], [
    "UI_UX_REDESIGN_RELEASE_READINESS_SUMMARY_TARGET artifacts/local altında olmalı.",
  ]);
  const stale = makeBlockedSummary();
  stale.generatedAt = "2026-01-01T00:00:00.000Z";
  stale.startedAt = "2026-01-01T00:00:00.000Z";
  writeJson(badSummary, stale);
  expectFailure("stale summary max-age", ["--target", badSummary, "--max-age-minutes", "10"], [
    "generatedAt 10 dakika sınırından eski",
  ]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("UI/UX redesign release readiness check contract kontrolü geçti.");

function expectPass(label, args, expectedTokens) {
  const result = runCheck(args);
  if (result.status !== 0) failContract(`${label} geçmeli.`, result);
  const output = combinedOutput(result);
  for (const token of expectedTokens) {
    if (!output.includes(token)) failContract(`${label} çıktısı beklenen token'ı içermeli: ${token}`, result);
  }
}

function expectFailure(label, args, expectedMessages) {
  const result = runCheck(args);
  if (result.status === 0) failContract(`${label} kırılmalı.`, result);
  const output = combinedOutput(result);
  for (const message of expectedMessages) {
    if (!output.includes(message)) failContract(`${label} beklenen hatayı üretmeli: ${message}`, result);
  }
}

function runCheck(args) {
  return spawnSync(process.execPath, ["scripts/check-ui-ux-redesign-release-readiness-summary.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function makeBlockedSummary() {
  const now = new Date().toISOString();
  writeJson(blockedGithubReport, { result: "GAP", overallStatus: "BLOCKED", generatedAt: now });
  writeJson(blockedRemoteReport, { result: "NOT_RELEASE_EVIDENCE", overallStatus: "BLOCKED", generatedAt: now });
  return {
    result: "GAP",
    overallStatus: "BLOCKED",
    startedAt: now,
    generatedAt: now,
    releaseEvidence: false,
    localWorkspace: { head: "abc1234", dirty: true },
    githubEnvironment: {
      reportFile: blockedGithubReport,
      result: "GAP",
      overallStatus: "BLOCKED",
      missingSecrets: ["GHCR_READ_TOKEN", "STAGING_EVIDENCE_ENV_B64"],
      missingVariables: [],
      invalidVariables: [],
    },
    remoteReleaseBundle: {
      reportFile: blockedRemoteReport,
      result: "NOT_RELEASE_EVIDENCE",
      overallStatus: "BLOCKED",
      remoteCommit: "remote123",
      remoteUiUxEvidenceScript: "missing",
      missingRequiredFiles: [{ path: "reports/ui-ux-redesign.json" }],
      openClosureItems: [{ path: "reports/ui-ux-redesign.json" }],
    },
    nextActions: [
      { kind: "github_environment_secret", name: "GHCR_READ_TOKEN" },
      { kind: "github_environment_secret", name: "STAGING_EVIDENCE_ENV_B64" },
      { kind: "remote_code_deploy", name: "deploy-ui-ux-redesign-evidence-scripts" },
      { kind: "remote_release_artifact", name: "reports/ui-ux-redesign.json" },
    ],
  };
}

function makeReadySummary() {
  const now = new Date().toISOString();
  writeJson(readyGithubReport, { result: "PASS", overallStatus: "READY", generatedAt: now });
  writeJson(readyRemoteReport, { result: "PASS", overallStatus: "READY", generatedAt: now });
  return {
    result: "PASS",
    overallStatus: "READY",
    startedAt: now,
    generatedAt: now,
    releaseEvidence: false,
    localWorkspace: { head: "abc1234", dirty: false },
    githubEnvironment: {
      reportFile: readyGithubReport,
      result: "PASS",
      overallStatus: "READY",
      missingSecrets: [],
      missingVariables: [],
      invalidVariables: [],
    },
    remoteReleaseBundle: {
      reportFile: readyRemoteReport,
      result: "PASS",
      overallStatus: "READY",
      remoteCommit: "abc1234",
      remoteUiUxEvidenceScript: "present",
      missingRequiredFiles: [],
      openClosureItems: [],
    },
    nextActions: [],
  };
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function failContract(message, result) {
  console.error("UI/UX redesign release readiness check contract kontrolü başarısız:");
  console.error(`- ${message}`);
  if (result) console.error(combinedOutput(result));
  process.exit(1);
}
