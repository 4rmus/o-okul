import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve("artifacts/local/staging-github-env-gap-contract");
const fakeGhPath = join(root, "fake-gh.mjs");
const gapReportFile = join(root, "gap-report.json");
const secretLeakMarker = "super-secret-value-that-must-not-leak";

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
writeFakeGh();

try {
  expectGapSummary();
  expectPassSummary();
  expectFailure("gap report outside artifacts/local", ["--gap-report-file", "../staging-github-env-gap-report.json"], [
    "STAGING_GITHUB_ENV_GAP_REPORT_FILE artifacts/local altında olmalı.",
  ]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("GitHub staging environment gap summary contract kontrolü geçti.");

function expectGapSummary() {
  const result = runSummary("missing-secrets", ["--gap-report-file", gapReportFile]);
  if (result.status === 0) failContract("missing-secrets senaryosu non-zero dönmeli.", result);

  const output = combinedOutput(result);
  for (const token of [
    "GitHub staging environment gap özeti",
    "- result: GAP",
    "- overallStatus: BLOCKED",
    "- missingSecrets: 2",
    "missing secret: GHCR_READ_TOKEN",
    "missing secret: STAGING_EVIDENCE_ENV_B64",
    "pnpm staging:ghcr-read-token:secret:set",
    "pnpm staging:evidence-env:secret:set",
    "GitHub staging environment gap raporu yazıldı:",
  ]) {
    if (!output.includes(token)) failContract(`gap çıktısı beklenen token'ı içermeli: ${token}`, result);
  }
  assertNoSecretLeak(result, "missing-secrets");

  if (!existsSync(gapReportFile)) failContract("gap raporu yazılmalı.", result);
  const report = JSON.parse(readFileSync(gapReportFile, "utf8"));
  if (report.result !== "GAP") failContract("gap raporu result=GAP olmalı.", result);
  if (report.overallStatus !== "BLOCKED") failContract("gap raporu BLOCKED olmalı.", result);
  if (JSON.stringify(report.missingSecrets) !== JSON.stringify(["GHCR_READ_TOKEN", "STAGING_EVIDENCE_ENV_B64"])) {
    failContract("gap raporu eksik secret isimlerini taşımalı.", result);
  }
  if (JSON.stringify(report).includes(secretLeakMarker)) failContract("gap raporu secret değeri içermemeli.", result);
}

function expectPassSummary() {
  const passReportFile = join(root, "pass-report.json");
  const result = runSummary("pass", ["--gap-report-file", passReportFile]);
  if (result.status !== 0) failContract("pass senaryosu sıfır dönmeli.", result);
  const output = combinedOutput(result);
  if (!output.includes("GitHub staging environment gap özeti PASS: owner/repo/staging")) {
    failContract("pass çıktısı PASS özetini üretmeli.", result);
  }
  const report = JSON.parse(readFileSync(passReportFile, "utf8"));
  if (report.result !== "PASS" || report.overallStatus !== "READY") {
    failContract("pass raporu READY olmalı.", result);
  }
}

function expectFailure(label, extraArgs, expectedMessages) {
  const result = runSummary("pass", extraArgs);
  if (result.status === 0) failContract(`${label} senaryosu kırılmalı.`, result);
  const output = combinedOutput(result);
  for (const message of expectedMessages) {
    if (!output.includes(message)) failContract(`${label} beklenen hatayı üretmeli: ${message}`, result);
  }
}

function runSummary(scenario, extraArgs = []) {
  return spawnSync(
    process.execPath,
    [
      "scripts/print-staging-github-env-gap-summary.mjs",
      "--repo",
      "owner/repo",
      "--environment",
      "staging",
      "--gh-bin",
      fakeGhPath,
      ...extraArgs,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, FAKE_GH_SCENARIO: scenario },
      encoding: "utf8",
    },
  );
}

function writeFakeGh() {
  writeFileSync(
    fakeGhPath,
    `#!/usr/bin/env node
const scenario = process.env.FAKE_GH_SCENARIO ?? "pass";
const args = process.argv.slice(2);

if (args[0] !== "api") fail("unsupported command");
const path = args[1];
if (path === "repos/owner/repo/environments/staging") writeJson({ name: "staging" });
if (path === "repos/owner/repo/environments/staging/variables?per_page=100") {
  writeJson({
    variables: [
      { name: "STAGING_DEPLOY_DIR", value: "/root/uzman-hocam" },
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

function assertNoSecretLeak(result, label) {
  if (combinedOutput(result).includes(secretLeakMarker)) {
    failContract(`${label} senaryosu secret değerini yazdırmamalı.`, result);
  }
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function failContract(message, result) {
  console.error("GitHub staging environment gap summary contract kontrolü başarısız:");
  console.error(`- ${message}`);
  if (result) console.error(combinedOutput(result));
  process.exit(1);
}
