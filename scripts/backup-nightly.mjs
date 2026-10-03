import { spawn } from "node:child_process";
import { createWriteStream, lstatSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createEncryptStream, readBackupKey } from "./backup-crypto.mjs";

// KF-5 first version: nightly encrypted pg_dump on the server's own disk (off-host TR S3 upload is PO-2).
// Run from the compose directory (/root/o-okul) by host cron; see docs/phase-6-ops-runbook.md.
const backupDir = process.env.BACKUP_PATH?.trim() ?? "";
const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS ?? "7");
const filePattern = /^o-okul-\d{8}T\d{6}Z\.dump\.enc$/;

if (!backupDir.startsWith("/")) fail("BACKUP_PATH mutlak dizin olmalı.");
const dirStat = lstatSafe(backupDir);
if (!dirStat?.isDirectory() || dirStat.isSymbolicLink()) fail("BACKUP_PATH symlink olmayan mevcut bir dizin olmalı.");
if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 90) fail("BACKUP_RETENTION_DAYS 1-90 arasında tam sayı olmalı.");
let key;
try {
  key = readBackupKey();
} catch (error) {
  fail(error.message);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const finalPath = join(backupDir, `o-okul-${stamp}.dump.enc`);
const partialPath = `${finalPath}.partial`;

const dump = spawn("docker", ["compose", "exec", "-T", "postgres", "sh", "-lc",
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges'], { stdio: ["ignore", "pipe", "pipe"] });
let dumpError = "";
dump.stderr.on("data", (chunk) => { dumpError += chunk; });
const dumpExit = new Promise((resolveExit) => dump.on("close", resolveExit));

try {
  await pipeline(dump.stdout, createEncryptStream(key), createWriteStream(partialPath, { flags: "wx", mode: 0o600 }));
  const code = await dumpExit;
  if (code !== 0) throw new Error(`pg_dump başarısız (${code}): ${dumpError.trim()}`);
  renameSync(partialPath, finalPath);
} catch (error) {
  rmSync(partialPath, { force: true });
  fail(error instanceof Error ? error.message : String(error));
}

const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
let removed = 0;
for (const name of readdirSync(backupDir)) {
  if (!filePattern.test(name)) continue;
  const path = join(backupDir, name);
  if (path !== finalPath && statSync(path).mtimeMs < cutoff) {
    rmSync(path);
    removed += 1;
  }
}

console.log(`Şifreli yedek yazıldı: ${finalPath} (${statSync(finalPath).size} bayt); ${removed} eski yedek silindi.`);

function lstatSafe(path) {
  try {
    return lstatSync(path);
  } catch {
    return undefined;
  }
}

function fail(message) {
  console.error(`Gecelik yedek başarısız: ${message}`);
  process.exit(1);
}
