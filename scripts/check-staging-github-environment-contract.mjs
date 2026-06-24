import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve("artifacts/staging-github-environment-contract");
const fakeGhPath = join(root, "fake-gh.mjs");

rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
writeFileSync(
  fakeGhPath,
  `#!/usr/bin/env node
const scenario = process.env.FAKE_GH_SCENARIO ?? "pass";
const args = process.argv.slice(2);

if (args[0] !== "api") fail("unsupported command");

const path = args[1];
if (path === "repos/owner/repo/environments/staging") {
  writeJson({ name: "staging" });
}

if (path === "repos/owner/repo/environments/staging/variables?per_page=100") {
  const values = {
    STAGING_DEPLOY_DIR: "/root/o-okul",
    STAGING_NEXT_PUBLIC_API_URL: "https://212.108.107.190",
    STAGING_EDGE_MODE: "ip",
  };
  if (scenario === "bad-edge") values.STAGING_EDGE_MODE = "domain";
  if (scenario === "bad-deploy-dir") values.STAGING_DEPLOY_DIR = "root/o-okul";
  if (scenario === "wrong-deploy-dir") values.STAGING_DEPLOY_DIR = "/srv/o-okul";
  writeJson({ variables: Object.entries(values).map(([name, value]) => ({ name, value })) });
}

if (path === "repos/owner/repo/environments/staging/secrets?per_page=100") {
  const names =
    scenario === "missing-secrets"
      ? ["STAGING_SSH_HOST", "STAGING_SSH_USER", "STAGING_SSH_PRIVATE_KEY"]
      : ["STAGING_SSH_HOST", "STAGING_SSH_USER", "STAGING_SSH_PRIVATE_KEY", "GHCR_READ_TOKEN", "STAGING_EVIDENCE_ENV_B64"];
  writeJson({ secrets: names.map((name) => ({ name, value: "super-secret-value-that-must-not-leak" })) });
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

try {
  expectPass("pass", "GitHub staging environment kontrolü geçti: owner/repo/staging");
  expectFailure("missing-secrets", [
    "GitHub staging secret eksik: GHCR_READ_TOKEN",
    "GitHub staging secret eksik: STAGING_EVIDENCE_ENV_B64",
  ]);
  expectNoOutput("missing-secrets", "super-secret-value-that-must-not-leak");
  expectFailure("bad-edge", ["STAGING_EDGE_MODE ip staging host için ip olmalı."]);
  expectFailure("bad-deploy-dir", ["STAGING_DEPLOY_DIR absolute path olmalı."]);
  expectFailure("wrong-deploy-dir", ["STAGING_DEPLOY_DIR /root/o-okul olmalı."]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("GitHub staging environment contract kontrolü geçti.");

function expectPass(scenario, expectedOutput) {
  const result = runChecker(scenario);
  if (result.status !== 0) {
    failContract(`${scenario} senaryosu geçmeli.`, result);
  }
  if (!combinedOutput(result).includes(expectedOutput)) {
    failContract(`${scenario} senaryosu beklenen çıktıyı üretmeli: ${expectedOutput}`, result);
  }
}

function expectFailure(scenario, expectedMessages) {
  const result = runChecker(scenario);
  if (result.status === 0) {
    failContract(`${scenario} senaryosu kırılmalı.`, result);
  }

  const output = combinedOutput(result);
  for (const message of expectedMessages) {
    if (!output.includes(message)) {
      failContract(`${scenario} senaryosu beklenen hatayı üretmeli: ${message}`, result);
    }
  }
}

function expectNoOutput(scenario, forbiddenText) {
  const result = runChecker(scenario);
  if (combinedOutput(result).includes(forbiddenText)) {
    failContract(`${scenario} senaryosu secret değerini yazdırmamalı.`, result);
  }
}

function runChecker(scenario) {
  return spawnSync(
    process.execPath,
    [
      "scripts/check-staging-github-environment.mjs",
      "--repo",
      "owner/repo",
      "--environment",
      "staging",
      "--gh-bin",
      fakeGhPath,
    ],
    {
      env: { ...process.env, FAKE_GH_SCENARIO: scenario },
      encoding: "utf8",
    },
  );
}

function combinedOutput(result) {
  return `${result.stdout ?? ""}${result.stderr ?? ""}`;
}

function failContract(message, result) {
  console.error("GitHub staging environment contract kontrolü başarısız:");
  console.error(`- ${message}`);
  if (result) {
    console.error(combinedOutput(result));
  }
  process.exit(1);
}
