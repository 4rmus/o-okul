import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve("artifacts/local/ui-ux-release-preflight-contract");
const blockedSummary = join(root, "blocked-summary.json");
const readySummary = join(root, "ready-summary.json");
const missingSummary = join(root, "missing-summary.json");
const blockedSummaryScript = join(root, "fake-blocked-summary.mjs");
const readySummaryScript = join(root, "fake-ready-summary.mjs");
const missingSummaryScript = join(root, "fake-missing-summary.mjs");

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

try {
  writeFakeSummaryScripts();

  expectFailure(
    "blocked preflight",
    [
      "--summary-script",
      blockedSummaryScript,
      "--summary-file",
      blockedSummary,
      "--max-age-minutes",
      "10",
    ],
    ["UI/UX release preflight", "summary komutu non-zero", "--require-ready için result=PASS olmalı."],
  );

  expectPass(
    "ready preflight",
    [
      "--summary-script",
      readySummaryScript,
      "--summary-file",
      readySummary,
      "--max-age-minutes",
      "10",
    ],
    ["deploy/release readiness koşulları hazır görünüyor"],
  );

  expectFailure(
    "missing summary preflight",
    ["--summary-script", missingSummaryScript, "--summary-file", missingSummary],
    ["summary dosyası yazılmadı"],
  );

  expectFailure("summary outside artifacts/local", ["--summary-file", "../ui-ux-release-preflight.json"], [
    "UI_UX_REDESIGN_RELEASE_PREFLIGHT_SUMMARY_FILE artifacts/local altında olmalı.",
  ]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("UI/UX redesign release preflight contract kontrolü geçti.");

function expectPass(label, args, expectedTokens) {
  const result = runPreflight(args);
  if (result.status !== 0) failContract(`${label} geçmeli.`, result);
  const output = combinedOutput(result);
  for (const token of expectedTokens) {
    if (!output.includes(token)) failContract(`${label} çıktısı beklenen token'ı içermeli: ${token}`, result);
  }
}

function expectFailure(label, args, expectedTokens) {
  const result = runPreflight(args);
  if (result.status === 0) failContract(`${label} kırılmalı.`, result);
  const output = combinedOutput(result);
  for (const token of expectedTokens) {
    if (!output.includes(token)) failContract(`${label} beklenen çıktıyı üretmeli: ${token}`, result);
  }
}

function runPreflight(args) {
  return spawnSync(process.execPath, ["scripts/run-ui-ux-redesign-release-preflight.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function writeFakeSummaryScripts() {
  writeFileSync(
    blockedSummaryScript,
    fakeSummaryScript({
      result: "GAP",
      overallStatus: "BLOCKED",
      localDirty: true,
      githubResult: "GAP",
      githubStatus: "BLOCKED",
      remoteResult: "NOT_RELEASE_EVIDENCE",
      remoteStatus: "BLOCKED",
      remoteScript: "missing",
      missingSecrets: ["GHCR_READ_TOKEN", "STAGING_EVIDENCE_ENV_B64"],
      missingFiles: [{ path: "reports/ui-ux-redesign.json" }],
      openItems: [{ path: "reports/ui-ux-redesign.json" }],
      nextActions: [
        { kind: "github_environment_secret", name: "GHCR_READ_TOKEN" },
        { kind: "github_environment_secret", name: "STAGING_EVIDENCE_ENV_B64" },
        { kind: "remote_code_deploy", name: "deploy-ui-ux-redesign-evidence-scripts" },
        { kind: "remote_release_artifact", name: "reports/ui-ux-redesign.json" },
      ],
      exitCode: 1,
    }),
    "utf8",
  );
  writeFileSync(
    readySummaryScript,
    fakeSummaryScript({
      result: "PASS",
      overallStatus: "READY",
      localDirty: false,
      githubResult: "PASS",
      githubStatus: "READY",
      remoteResult: "PASS",
      remoteStatus: "READY",
      remoteScript: "present",
      missingSecrets: [],
      missingFiles: [],
      openItems: [],
      nextActions: [],
      exitCode: 0,
    }),
    "utf8",
  );
  writeFileSync(
    missingSummaryScript,
    `console.error("fake summary failed before write");\nprocess.exit(1);\n`,
    "utf8",
  );
}

function fakeSummaryScript(config) {
  return `import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const summaryFile = readOption("--summary-file");
if (!summaryFile) {
  console.error("--summary-file gerekli");
  process.exit(1);
}
mkdirSync(dirname(summaryFile), { recursive: true });
const now = new Date().toISOString();
const githubReport = join(dirname(summaryFile), "github-gap-" + ${JSON.stringify(config.result)} + ".json");
const remoteReport = join(dirname(summaryFile), "remote-gap-" + ${JSON.stringify(config.result)} + ".json");
writeJson(githubReport, {
  result: ${JSON.stringify(config.githubResult)},
  overallStatus: ${JSON.stringify(config.githubStatus)},
  generatedAt: now,
});
writeJson(remoteReport, {
  result: ${JSON.stringify(config.remoteResult)},
  overallStatus: ${JSON.stringify(config.remoteStatus)},
  generatedAt: now,
});
writeJson(summaryFile, {
  result: ${JSON.stringify(config.result)},
  overallStatus: ${JSON.stringify(config.overallStatus)},
  startedAt: now,
  generatedAt: now,
  releaseEvidence: false,
  localWorkspace: { head: "abc1234", dirty: ${JSON.stringify(config.localDirty)} },
  githubEnvironment: {
    reportFile: githubReport,
    result: ${JSON.stringify(config.githubResult)},
    overallStatus: ${JSON.stringify(config.githubStatus)},
    missingSecrets: ${JSON.stringify(config.missingSecrets)},
    missingVariables: [],
    invalidVariables: [],
  },
  remoteReleaseBundle: {
    reportFile: remoteReport,
    result: ${JSON.stringify(config.remoteResult)},
    overallStatus: ${JSON.stringify(config.remoteStatus)},
    remoteCommit: "abc1234",
    remoteUiUxEvidenceScript: ${JSON.stringify(config.remoteScript)},
    missingRequiredFiles: ${JSON.stringify(config.missingFiles)},
    openClosureItems: ${JSON.stringify(config.openItems)},
  },
  nextActions: ${JSON.stringify(config.nextActions)},
});
console.log("fake summary wrote " + summaryFile);
process.exit(${config.exitCode});

function readOption(name) {
  const index = args.lastIndexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + "\\n", "utf8");
}
`;
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function failContract(message, result) {
  console.error("UI/UX redesign release preflight contract kontrolü başarısız:");
  console.error(`- ${message}`);
  if (result) console.error(combinedOutput(result));
  process.exit(1);
}
