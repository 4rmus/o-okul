import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

const root = resolve("artifacts/local/remote-staging-gap-contract");
const fakeBinDir = join(root, "bin");
const fakeSshPath = join(fakeBinDir, "ssh");
const fakeRemoteArtifacts = join(root, "fake-remote-artifacts");
const snapshotDir = join(root, "snapshot");
const gapReportFile = join(root, "remote-gap-report.json");

rmSync(root, { recursive: true, force: true });
mkdirSync(fakeBinDir, { recursive: true });
mkdirSync(fakeRemoteArtifacts, { recursive: true });
writeFakeSsh();

try {
  expectGapSummaryPassesContract();
  expectDefaultHostIsOOkulProd();
  expectFailure("snapshot outside artifacts/local", ["--snapshot-dir", "../remote-staging-snapshot"], [
    "REMOTE_STAGING_RELEASE_SNAPSHOT_DIR artifacts/local altında olmalı.",
  ]);
  expectFailure("gap report outside artifacts/local", ["--gap-report-file", "../remote-staging-gap-report.json"], [
    "REMOTE_STAGING_RELEASE_GAP_REPORT_FILE artifacts/local altında olmalı.",
  ]);
  expectFailure("absolute remote artifacts dir", ["--remote-artifacts-dir", "/root/o-okul/artifacts/staging"], [
    "REMOTE_STAGING_RELEASE_ARTIFACTS_DIR remote root altında relative path olmalı.",
  ]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

console.log("Remote staging release gap summary contract kontrolü geçti.");

function expectGapSummaryPassesContract() {
  const result = runSummary([
    "--host",
    "fake-remote",
    "--remote-root",
    "/root/o-okul",
    "--snapshot-dir",
    snapshotDir,
    "--gap-report-file",
    gapReportFile,
  ]);
  if (result.status === 0) {
    failContract("eksik artifact bundle için komut non-zero dönmeli.", result);
  }

  const output = combinedOutput(result);
  for (const token of [
    "Remote staging source: fake-remote:/root/o-okul/artifacts/staging",
    "Remote commit: contract123",
    "Remote ui-ux evidence script: present",
    "Remote staging artifact snapshot yazıldı:",
    "Remote staging gap raporu hedefi:",
    "Staging release artifact gap özeti",
    "- result: NOT_RELEASE_EVIDENCE",
    "reports/ui-ux-redesign.json",
    "release-summary-*.json",
  ]) {
    if (!output.includes(token)) failContract(`çıktı beklenen token'ı içermeli: ${token}`, result);
  }

  if (!existsSync(gapReportFile)) failContract("gap raporu yazılmalı.", result);
  const report = JSON.parse(readFileSync(gapReportFile, "utf8"));
  if (report.result !== "NOT_RELEASE_EVIDENCE") failContract("gap raporu NOT_RELEASE_EVIDENCE olmalı.", result);
  if ((report.missingRequiredFiles?.length ?? 0) === 0) failContract("gap raporu eksik dosya listesi içermeli.", result);
  if (!report.openClosureItems?.some((item) => item.path === "reports/ui-ux-redesign.json")) {
    failContract("gap raporu UI/UX redesign kapanış kalemini içermeli.", result);
  }
}

function expectDefaultHostIsOOkulProd() {
  const defaultGapReportFile = join(root, "remote-gap-report-default-host.json");
  const result = runSummary([
    "--remote-root",
    "/root/o-okul",
    "--snapshot-dir",
    join(root, "snapshot-default-host"),
    "--gap-report-file",
    defaultGapReportFile,
  ]);
  if (result.status === 0) {
    failContract("default host eksik artifact bundle için non-zero dönmeli.", result);
  }

  const output = combinedOutput(result);
  if (!output.includes("Remote staging source: o-okul-prod:/root/o-okul/artifacts/staging")) {
    failContract("default host o-okul-prod olmalı.", result);
  }
}

function expectFailure(label, extraArgs, expectedMessages) {
  const result = runSummary([
    "--host",
    "fake-remote",
    "--remote-root",
    "/root/o-okul",
    ...extraArgs,
  ]);
  if (result.status === 0) failContract(`${label} senaryosu kırılmalı.`, result);
  const output = combinedOutput(result);
  for (const message of expectedMessages) {
    if (!output.includes(message)) failContract(`${label} beklenen hatayı üretmeli: ${message}`, result);
  }
}

function runSummary(args) {
  const env = { ...process.env };
  delete env.REMOTE_STAGING_RELEASE_HOST;
  delete env.REMOTE_EVIDENCE_HOST;

  return spawnSync(process.execPath, ["scripts/print-remote-staging-release-gap-summary.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...env,
      PATH: `${fakeBinDir}${delimiter}${process.env.PATH}`,
      FAKE_REMOTE_ARTIFACTS_DIR: fakeRemoteArtifacts,
    },
    maxBuffer: 20 * 1024 * 1024,
  });
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
  const host = process.argv.at(-2) ?? "unknown-host";
  process.stdout.write(\`Remote staging source: \${host}:/root/o-okul/artifacts/staging\\n\`);
  process.stdout.write("Remote commit: contract123\\n");
  process.stdout.write("Remote ui-ux evidence script: present\\n");
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
  console.error("Remote staging release gap summary contract kontrolü başarısız:");
  console.error(`- ${message}`);
  if (result) console.error(combinedOutput(result));
  process.exit(1);
}
