import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve("artifacts/local/account-management-backfill-contract");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const fixture = JSON.parse(readFileSync("docs/evidence-templates/account-management-backfill.example.json", "utf8"));
const readyFixture = {
  ...fixture,
  result: "READY",
  mode: "DRY_RUN",
  databaseMutationApplied: false,
  checks: {
    ...fixture.checks,
    tenantAccounts: { total: 120, ready: 10, plannedWrites: 110 },
    platformAccounts: { sourceAccounts: 2, readyAccounts: 0, sourceSessions: 3, readySessions: 0 },
    memberships: { canonicalAccounts: 118, readyAccounts: 8 },
    employees: { teachers: 24, linkedTeachers: 0 },
  },
};

expectPass("valid-pass", fixture);
expectPass("valid-ready", readyFixture, { ACCOUNT_MANAGEMENT_BACKFILL_ALLOW_READY: "1" });
expectFail("blocked", { ...fixture, result: "BLOCKED", databaseMutationApplied: false }, "result PASS veya izinli READY olmalı");
expectFail("ready-without-opt-in", readyFixture, "READY yalnız ACCOUNT_MANAGEMENT_BACKFILL_ALLOW_READY=1");
expectFail("mutation-mismatch", { ...fixture, databaseMutationApplied: false }, "PASS sonucu databaseMutationApplied true olmalı");
expectFail("owner-sum-mismatch", {
  ...fixture,
  checks: { ...fixture.checks, owners: { ...fixture.checks.owners, activeTenants: 4 } },
}, "activeTenants dağılımı ile eşleşmeli");
expectFail("precondition-nonzero", {
  ...fixture,
  checks: {
    ...fixture.checks,
    preconditions: { ...fixture.checks.preconditions, emailCollisionGroups: 1 },
  },
}, "checks.preconditions.emailCollisionGroups 0 olmalı");
expectFail("account-incomplete", {
  ...fixture,
  checks: { ...fixture.checks, tenantAccounts: { total: 120, ready: 119, plannedWrites: 1 } },
}, "checks.tenantAccounts backfill tamamlanmalı");
expectFail("planned-writes-over-total", {
  ...fixture,
  checks: { ...fixture.checks, tenantAccounts: { total: 120, ready: 120, plannedWrites: 121 } },
}, "plannedWrites total değerini aşamaz");
expectFail("session-mismatch", {
  ...fixture,
  checks: { ...fixture.checks, sessions: { ...fixture.checks.sessions, membershipVersionMatches: 8 } },
}, "membershipVersionMatches activeSessions ile eşleşmeli");
expectFail("extra-pii-field", {
  ...fixture,
  checks: {
    ...fixture.checks,
    owners: { ...fixture.checks.owners, ownerUserIds: ["user-secret"] },
  },
}, "checks.owners alanları exact olmalı");
expectFail("stale", { ...fixture, checkedAt: "2020-01-01T00:00:00.000Z" }, "saatten eski olamaz", {});
expectRawFail("malformed-json", "{", "geçerli JSON olmalı");

rmSync(root, { recursive: true, force: true });
console.log("Account management backfill contract kontrolü geçti.");

function expectPass(name, report, extraEnv = {}) {
  const result = run(name, report, { ACCOUNT_MANAGEMENT_BACKFILL_ALLOW_EXAMPLE: "1", ...extraEnv });
  if (result.status !== 0) fail(`${name} PASS bekleniyordu`, result);
}

function expectFail(name, report, expected, extraEnv = { ACCOUNT_MANAGEMENT_BACKFILL_ALLOW_EXAMPLE: "1" }) {
  const result = run(name, report, extraEnv);
  if (result.status === 0 || !`${result.stderr}${result.stdout}`.includes(expected)) {
    fail(`${name} beklenen hata üretmedi: ${expected}`, result);
  }
}

function expectRawFail(name, contents, expected) {
  const path = resolve(root, `${name}.json`);
  writeFileSync(path, contents, "utf8");
  const result = runPath(path, { ACCOUNT_MANAGEMENT_BACKFILL_ALLOW_EXAMPLE: "1" });
  if (result.status === 0 || !`${result.stderr}${result.stdout}`.includes(expected)) {
    fail(`${name} beklenen hata üretmedi: ${expected}`, result);
  }
}

function run(name, report, extraEnv) {
  const path = resolve(root, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return runPath(path, extraEnv);
}

function runPath(path, extraEnv) {
  return spawnSync(process.execPath, ["scripts/check-account-management-backfill.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      ACCOUNT_MANAGEMENT_BACKFILL_TARGET: pathToFileURL(path).href,
      ACCOUNT_MANAGEMENT_BACKFILL_MAX_AGE_HOURS: "24",
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
