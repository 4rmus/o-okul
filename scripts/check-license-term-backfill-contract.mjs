import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve("artifacts/local/license-term-backfill-contract");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });
const fixture = JSON.parse(readFileSync("docs/evidence-templates/license-term-backfill.example.json", "utf8"));
const ready = { ...fixture, result: "READY", mode: "DRY_RUN", databaseMutationApplied: false, checks: { ...fixture.checks, readyTenants: 0 } };

expectPass("valid-pass", fixture);
expectPass("valid-ready", ready, { LICENSE_TERM_BACKFILL_ALLOW_READY: "1" });
expectFail("ready-without-opt-in", ready, "READY yalnız LICENSE_TERM_BACKFILL_ALLOW_READY=1");
expectFail("missing-snapshot", { ...fixture, checks: { ...fixture.checks, missingSnapshots: 1 } }, "checks.missingSnapshots 0 olmalı");
expectFail("parity-drift", { ...fixture, checks: { ...fixture.checks, mirrorParityMismatches: 1 } }, "checks.mirrorParityMismatches 0 olmalı");
expectFail("incomplete", { ...fixture, checks: { ...fixture.checks, readyTenants: 2 } }, "PASS tüm eligible tenantları hazır doğrulamalı");
expectFail("extra-identifier", { ...fixture, checks: { ...fixture.checks, tenantIds: ["tenant-secret"] } }, "checks alanları exact olmalı");
expectRawFail("malformed-json", "{", "geçerli JSON olmalı");

rmSync(root, { recursive: true, force: true });
console.log("LicenseTerm backfill contract kontrolü geçti.");

function expectPass(name, report, extraEnv = {}) {
  const result = run(name, report, { LICENSE_TERM_BACKFILL_ALLOW_EXAMPLE: "1", ...extraEnv });
  if (result.status !== 0) fail(`${name} PASS bekleniyordu`, result);
}
function expectFail(name, report, expected) {
  const result = run(name, report, { LICENSE_TERM_BACKFILL_ALLOW_EXAMPLE: "1" });
  if (result.status === 0 || !`${result.stderr}${result.stdout}`.includes(expected)) fail(`${name} beklenen hata üretmedi: ${expected}`, result);
}
function expectRawFail(name, contents, expected) {
  const path = resolve(root, `${name}.json`);
  writeFileSync(path, contents, "utf8");
  const result = runPath(path, { LICENSE_TERM_BACKFILL_ALLOW_EXAMPLE: "1" });
  if (result.status === 0 || !`${result.stderr}${result.stdout}`.includes(expected)) fail(`${name} beklenen hata üretmedi: ${expected}`, result);
}
function run(name, report, extraEnv) {
  const path = resolve(root, `${name}.json`);
  writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return runPath(path, extraEnv);
}
function runPath(path, extraEnv) {
  return spawnSync(process.execPath, ["scripts/check-license-term-backfill.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, LICENSE_TERM_BACKFILL_TARGET: pathToFileURL(path).href, ...extraEnv },
    encoding: "utf8",
  });
}
function fail(message, result) {
  console.error(message);
  if (result.stdout) console.error(result.stdout);
  if (result.stderr) console.error(result.stderr);
  process.exit(1);
}
