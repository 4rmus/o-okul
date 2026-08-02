import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve("artifacts/local/account-management-preflight-contract");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const fixture = JSON.parse(readFileSync("docs/evidence-templates/account-management-preflight.example.json", "utf8"));

expectPass("valid", fixture, { ACCOUNT_MANAGEMENT_PREFLIGHT_ALLOW_EXAMPLE: "1" });
expectPass("teacher-backfill-remains-report-only", {
  ...fixture,
  checks: {
    ...fixture.checks,
    teacherEmployeeBackfill: { teachers: 12, missingEmployeeLinks: 12, tenantsAffected: 2 },
  },
}, { ACCOUNT_MANAGEMENT_PREFLIGHT_ALLOW_EXAMPLE: "1" });

expectFail("blocked", { ...fixture, result: "BLOCKED", blockers: ["TENANT_EMAIL_COLLISIONS"], gaps: ["TENANT_EMAIL_COLLISIONS"] }, "result PASS olmalı");
expectFail("email-collision", {
  ...fixture,
  checks: { ...fixture.checks, tenantEmailCollisions: { groups: 1, accounts: 2, tenantsAffected: 1 } },
}, "checks.tenantEmailCollisions.groups 0 olmalı");
expectFail("guardian-unverified", {
  ...fixture,
  checks: {
    ...fixture.checks,
    guardianInventory: { ...fixture.checks.guardianInventory, classification: "UNVERIFIED", classificationEvidenceReference: null },
  },
}, "classification FIXTURE_ONLY olmalı");
expectFail("extra-pii-field", {
  ...fixture,
  checks: {
    ...fixture.checks,
    tenantEmailCollisions: { ...fixture.checks.tenantEmailCollisions, emails: ["raw@example.test"] },
  },
}, "checks.tenantEmailCollisions alanları exact olmalı");
expectFail("stale", { ...fixture, checkedAt: "2020-01-01T00:00:00.000Z" }, "saatten eski olamaz", {});
expectRawFail("malformed-json", "{", "geçerli JSON olmalı");

rmSync(root, { recursive: true, force: true });
console.log("Account management preflight contract kontrolü geçti.");

function expectPass(name, report, extraEnv = { ACCOUNT_MANAGEMENT_PREFLIGHT_ALLOW_EXAMPLE: "1" }) {
  const result = run(name, report, extraEnv);
  if (result.status !== 0) fail(`${name} PASS bekleniyordu`, result);
}

function expectFail(name, report, expected, extraEnv = { ACCOUNT_MANAGEMENT_PREFLIGHT_ALLOW_EXAMPLE: "1" }) {
  const result = run(name, report, extraEnv);
  if (result.status === 0 || !`${result.stderr}${result.stdout}`.includes(expected)) {
    fail(`${name} beklenen hata üretmedi: ${expected}`, result);
  }
}

function run(name, report, extraEnv) {
  const path = resolve(root, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return runPath(path, extraEnv);
}

function expectRawFail(name, contents, expected) {
  const path = resolve(root, `${name}.json`);
  writeFileSync(path, contents, "utf8");
  const result = runPath(path, { ACCOUNT_MANAGEMENT_PREFLIGHT_ALLOW_EXAMPLE: "1" });
  if (result.status === 0 || !`${result.stderr}${result.stdout}`.includes(expected)) {
    fail(`${name} beklenen hata üretmedi: ${expected}`, result);
  }
}

function runPath(path, extraEnv) {
  return spawnSync(process.execPath, ["scripts/check-account-management-preflight.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ACCOUNT_MANAGEMENT_PREFLIGHT_TARGET: pathToFileURL(path).href,
      ACCOUNT_MANAGEMENT_PREFLIGHT_MAX_AGE_HOURS: "24",
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

function fail(message, result) {
  console.error(message);
  if (result.stdout) console.error(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}
