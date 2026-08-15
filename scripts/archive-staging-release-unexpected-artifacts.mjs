import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";

const artifactsTarget = readOption("--artifacts-dir") ?? process.env.STAGING_RELEASE_ARTIFACTS_TARGET ?? "artifacts/staging";
const gapReportFile =
  readOption("--gap-report-file") ?? process.env.STAGING_RELEASE_GAP_REPORT_FILE ?? "artifacts/local/staging-release-gap-report.json";
const archiveTarget =
  readOption("--archive-dir") ??
  process.env.STAGING_RELEASE_UNEXPECTED_ARCHIVE_DIR ??
  `artifacts/local/staging-release-unexpected-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const apply = process.argv.includes("--apply");

const artifactsDir = resolve(artifactsTarget);
const archiveDir = resolve(archiveTarget);
const gapReportPath = resolve(gapReportFile);

const checkResult = spawnSync(
  process.execPath,
  ["scripts/check-staging-release-artifacts.mjs", "--artifacts-dir", artifactsDir, "--gap-report-file", gapReportPath],
  { encoding: "utf8", env: process.env },
);

if (checkResult.status === 0) {
  console.log("Staging release bundle zaten temiz; unexpected artifact yok.");
  process.exit(0);
}

if (!existsSync(gapReportPath)) {
  console.error("Staging release gap raporu üretilemedi.");
  console.error(`${checkResult.stdout ?? ""}${checkResult.stderr ?? ""}`.trim());
  process.exit(checkResult.status ?? 1);
}

const report = JSON.parse(readFileSync(gapReportPath, "utf8"));
const unexpectedFiles = Array.isArray(report.unexpectedFiles) ? report.unexpectedFiles : [];

if (unexpectedFiles.length === 0) {
  console.log("Staging release bundle içinde arşivlenecek unexpected artifact yok.");
  process.exit(0);
}

const entries = unexpectedFiles.map((item) => buildArchiveEntry(item.path));

console.log(`Staging release unexpected artifact arşivi: ${formatPath(archiveDir)}`);
console.log(`- mode: ${apply ? "apply" : "dry-run"}`);
console.log(`- unexpectedFiles: ${entries.length}`);
for (const entry of entries) {
  console.log(`* ${entry.artifactPath} -> ${formatPath(entry.destinationPath)}`);
}

if (!apply) {
  console.log("--apply verilmedi; dosyalar taşınmadı.");
  process.exit(0);
}

preflightArchiveApply(entries);
mkdirSync(archiveDir, { recursive: true });
for (const entry of entries) {
  mkdirSync(dirname(entry.destinationPath), { recursive: true });
  renameSync(entry.sourcePath, entry.destinationPath);
}

const manifestPath = resolve(archiveDir, "manifest.json");
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      archivedAt: new Date().toISOString(),
      result: "ARCHIVED_UNEXPECTED_STAGING_RELEASE_ARTIFACTS",
      artifactsTarget: formatPath(artifactsDir),
      gapReportFile: formatPath(gapReportPath),
      entries: entries.map((entry) => ({
        path: entry.artifactPath,
        archivedTo: formatPath(entry.destinationPath),
      })),
    },
    null,
    2,
  )}\n`,
);

console.log(`Unexpected artifact arşiv manifest'i yazıldı: ${formatPath(manifestPath)}`);

function preflightArchiveApply(archiveEntries) {
  if (existsSync(archiveDir)) {
    throw new Error(`archive-dir apply öncesi mevcut olmamalı: ${formatPath(archiveDir)}`);
  }

  const archiveRelativeToArtifacts = relative(artifactsDir, archiveDir);
  if (
    archiveRelativeToArtifacts === "" ||
    (!archiveRelativeToArtifacts.startsWith("..") && !isAbsolute(archiveRelativeToArtifacts))
  ) {
    throw new Error("archive-dir staging release bundle dışında olmalı.");
  }

  const seenSources = new Set();
  const seenDestinations = new Set();
  for (const entry of archiveEntries) {
    if (seenSources.has(entry.sourcePath) || seenDestinations.has(entry.destinationPath)) {
      throw new Error(`unexpected artifact listesi tekrarlı path içeriyor: ${entry.artifactPath}`);
    }
    seenSources.add(entry.sourcePath);
    seenDestinations.add(entry.destinationPath);

    if (!existsSync(entry.sourcePath)) {
      throw new Error(`unexpected artifact bulunamadı: ${entry.artifactPath}`);
    }
    const sourceStat = lstatSync(entry.sourcePath);
    if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
      throw new Error(`unexpected artifact symlink olmayan dosya olmalı: ${entry.artifactPath}`);
    }
    if (existsSync(entry.destinationPath)) {
      throw new Error(`archive hedefi zaten var: ${formatPath(entry.destinationPath)}`);
    }
  }
}

function buildArchiveEntry(artifactPath) {
  if (typeof artifactPath !== "string" || artifactPath.trim() === "") {
    throw new Error("unexpected artifact path boş olamaz.");
  }
  if (isAbsolute(artifactPath)) {
    throw new Error(`unexpected artifact path relative olmalı: ${artifactPath}`);
  }

  const normalizedPath = normalize(artifactPath);
  if (normalizedPath === "." || normalizedPath.startsWith("..")) {
    throw new Error(`unexpected artifact path bundle dışına çıkamaz: ${artifactPath}`);
  }

  const sourcePath = resolve(artifactsDir, normalizedPath);
  if (!sourcePath.startsWith(`${artifactsDir}/`)) {
    throw new Error(`unexpected artifact path bundle dışına çıkamaz: ${artifactPath}`);
  }

  return {
    artifactPath: normalizedPath,
    sourcePath,
    destinationPath: resolve(archiveDir, normalizedPath),
  };
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`${name} için değer gerekli.`);
    process.exit(1);
  }
  return value;
}

function formatPath(path) {
  const absolutePath = resolve(path);
  const cwd = resolve(".");
  const relativePath = relative(cwd, absolutePath);
  return relativePath && !relativePath.startsWith("..") ? relativePath : absolutePath;
}
