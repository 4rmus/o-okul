import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { dirname, isAbsolute, normalize, parse, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const host =
  readOption("--host") ?? process.env.REMOTE_STAGING_RELEASE_HOST ?? process.env.REMOTE_EVIDENCE_HOST ?? "uzman-hocam-server";
const remoteRoot =
  readOption("--remote-root") ?? process.env.REMOTE_STAGING_RELEASE_ROOT ?? process.env.REMOTE_EVIDENCE_ROOT ?? "/root/o-okul";
const remoteArtifactsDir =
  readOption("--remote-artifacts-dir") ?? process.env.REMOTE_STAGING_RELEASE_ARTIFACTS_DIR ?? "artifacts/staging";
const snapshotDir = allowedLocalPath(
  readOption("--snapshot-dir") ?? process.env.REMOTE_STAGING_RELEASE_SNAPSHOT_DIR ?? "artifacts/local/remote-staging-snapshot",
  "REMOTE_STAGING_RELEASE_SNAPSHOT_DIR",
);
const gapReportFile = allowedLocalPath(
  readOption("--gap-report-file") ??
    process.env.REMOTE_STAGING_RELEASE_GAP_REPORT_FILE ??
    "artifacts/local/remote-staging-gap-report.json",
  "REMOTE_STAGING_RELEASE_GAP_REPORT_FILE",
);
const connectTimeout = readOption("--connect-timeout") ?? process.env.REMOTE_STAGING_RELEASE_CONNECT_TIMEOUT_SECONDS ?? "10";

validateRemoteArtifactsDir(remoteArtifactsDir);
prepareSnapshotDir(snapshotDir);

const probe = runRemote("SSH bağlantısı", "printf remote-ok");
if (probe.status !== 0 || probe.stdout.trim() !== "remote-ok") {
  fail([formatRemoteFailure("SSH bağlantısı kurulamadı", probe)]);
}

const metadata = runRemote("Remote metadata", remoteMetadataCommand());
if (metadata.status === 0 && metadata.stdout.trim()) {
  console.log(metadata.stdout.trim());
}

copyRemoteArtifacts();

console.log(`Remote staging artifact snapshot yazıldı: ${formatPath(snapshotDir)}`);
console.log(`Remote staging gap raporu hedefi: ${formatPath(gapReportFile)}`);

const summary = spawnSync(
  process.execPath,
  [
    "scripts/print-staging-release-gap-summary.mjs",
    "--artifacts-dir",
    snapshotDir,
    "--gap-report-file",
    gapReportFile,
  ],
  { stdio: "inherit", env: process.env },
);

process.exit(summary.status ?? 1);

function copyRemoteArtifacts() {
  const command = [
    `cd ${shellQuote(remoteRoot)}`,
    `test -d ${shellQuote(remoteArtifactsDir)}`,
    `tar -cf - -C ${shellQuote(remoteArtifactsDir)} .`,
  ].join(" && ");
  const remoteTar = spawnSync("ssh", sshArgs(command), {
    encoding: "buffer",
    maxBuffer: 512 * 1024 * 1024,
  });

  if (remoteTar.status !== 0) {
    fail([formatRemoteFailure(`Remote artifact snapshot alınamadı: ${host}:${remoteRoot}/${remoteArtifactsDir}`, remoteTar)]);
  }

  const localTar = spawnSync("tar", ["-xf", "-", "-C", snapshotDir], {
    input: remoteTar.stdout,
    encoding: "buffer",
  });
  if (localTar.status !== 0) {
    fail([formatRemoteFailure(`Remote artifact snapshot açılamadı: ${formatPath(snapshotDir)}`, localTar)]);
  }
}

function remoteMetadataCommand() {
  const packageProbe = `node -e ${shellQuote(
    'const p=require("./package.json"); console.log(p.scripts?.["ui-ux-redesign:evidence-generate"] ? "present" : "missing");',
  )}`;

  return [
    `cd ${shellQuote(remoteRoot)}`,
    `printf 'Remote staging source: ${shellSafeLabel(host)}:${shellSafeLabel(remoteRoot)}/${shellSafeLabel(remoteArtifactsDir)}\\n'`,
    `commit=$(git rev-parse --short HEAD 2>/dev/null || printf unknown)`,
    `printf 'Remote commit: %s\\n' "$commit"`,
    `uiux=$(${packageProbe} 2>/dev/null || printf missing)`,
    `printf 'Remote ui-ux evidence script: %s\\n' "$uiux"`,
  ].join(" && ");
}

function runRemote(label, command) {
  const result = spawnSync("ssh", sshArgs(command), {
    encoding: "utf8",
  });

  return {
    label,
    status: result.status ?? 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

function sshArgs(command) {
  return ["-o", "BatchMode=yes", "-o", `ConnectTimeout=${connectTimeout}`, host, command];
}

function validateRemoteArtifactsDir(value) {
  const normalized = normalize(value).replaceAll("\\", "/");
  if (!value || isAbsolute(value) || normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) {
    fail(["REMOTE_STAGING_RELEASE_ARTIFACTS_DIR remote root altında relative path olmalı."]);
  }
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

function prepareSnapshotDir(path) {
  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });
}

function readOption(name) {
  const index = args.indexOf(name);
  if (index === -1) return undefined;

  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function shellSafeLabel(value) {
  return String(value).replaceAll("'", "").replaceAll("\n", "").replaceAll("\r", "");
}

function formatRemoteFailure(label, result) {
  const details = [trimForMessage(result.stdout), trimForMessage(result.stderr), result.error?.message].filter(Boolean).join(" | ");
  return details ? `${label}: ${details}` : label;
}

function trimForMessage(value) {
  if (!value) return "";
  const normalized = Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
  const trimmed = normalized.trim().replace(/\s+/g, " ");
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}...` : trimmed;
}

function formatPath(path) {
  const cwd = resolve(".");
  const relativePath = relative(cwd, path);
  return relativePath && !relativePath.startsWith("..") ? relativePath : path;
}

function fail(messages) {
  console.error("Remote staging release gap özeti başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
