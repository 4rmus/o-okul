import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// KF-5 contract: nightly backup and encrypted restore drill against a fake `docker` (no Docker/Postgres needed).
// The fake emits known bytes for pg_dump and records what pg_restore receives, so the round trip is byte-exact.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(repoRoot, "artifacts", "backup-nightly-check");
const binDir = join(root, "bin");
const backupDir = join(root, "backups");
const dumpFile = join(root, "plain.dump");
const restoredFile = join(root, "restored.dump");
const key = randomBytes(32).toString("base64");
const failures = [];

rmSync(root, { force: true, recursive: true });
mkdirSync(binDir, { recursive: true });
mkdirSync(backupDir, { recursive: true });
const plaintext = Buffer.concat([Buffer.from("PGDMP-FAKE-PLAINTEXT-MARKER"), randomBytes(3 * 1024 * 1024)]);
writeFileSync(dumpFile, plaintext);
writeFileSync(join(binDir, "docker"), `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const command = process.argv.at(-1);
if (command.startsWith("pg_dump")) process.stdout.write(readFileSync(${JSON.stringify(dumpFile)}));
else if (command.startsWith("pg_restore")) {
  const chunks = [];
  process.stdin.on("data", (chunk) => chunks.push(chunk));
  process.stdin.on("end", () => writeFileSync(${JSON.stringify(restoredFile)}, Buffer.concat(chunks)));
} else if (command.startsWith("psql")) process.stdout.write("Tenant=1\\nAuditLog=2\\nReportSnapshot=3\\nMigration=4\\n");
`);
chmodSync(join(binDir, "docker"), 0o755);

const env = { ...process.env, PATH: `${binDir}:${process.env.PATH}`, BACKUP_PATH: backupDir, BACKUP_RETENTION_DAYS: "7", BACKUP_ENCRYPTION_KEY_BASE64: key };
const node = (script, args = [], extraEnv = {}) => spawnSync(process.execPath, [join(repoRoot, "scripts", script), ...args], { env: { ...env, ...extraEnv }, encoding: "utf8" });

try {
  const stale = join(backupDir, "o-okul-20200101T000000Z.dump.enc");
  writeFileSync(stale, "old");
  utimesSync(stale, new Date("2020-01-01"), new Date("2020-01-01"));

  const backup = node("backup-nightly.mjs");
  if (backup.status !== 0) failures.push(`backup-nightly başarısız: ${backup.stderr}`);
  const files = readdirSync(backupDir).filter((name) => name.endsWith(".dump.enc"));
  if (files.length !== 1 || existsSync(stale)) failures.push(`saklama süresi uygulanmadı: ${files.join(",")}`);
  const backupFile = join(backupDir, files[0] ?? "missing");
  if (existsSync(backupFile)) {
    if ((statSync(backupFile).mode & 0o077) !== 0) failures.push("yedek dosyası yalnız sahibine okunur olmalı (0600).");
    if (readFileSync(backupFile).includes(Buffer.from("PGDMP-FAKE-PLAINTEXT-MARKER"))) failures.push("yedek dosyasında şifresiz içerik var.");
  }

  const drillOutput = join(root, "restore-drill.json");
  const drill = node("generate-restore-drill-evidence.mjs", ["--from", backupFile, "--output", drillOutput, "--environment", "staging"]);
  if (drill.status !== 0) failures.push(`şifreli restore tatbikatı başarısız: ${drill.stderr}`);
  else {
    if (!readFileSync(restoredFile).equals(plaintext)) failures.push("geri yüklenen döküm orijinalle aynı değil.");
    const report = JSON.parse(readFileSync(drillOutput, "utf8"));
    if (report.result !== "PASS" || !String(report.sourceBackup).startsWith("encrypted-nightly-dump:") || Object.keys(report).length !== 7) {
      failures.push(`restore raporu beklenmiyor: ${JSON.stringify(report)}`);
    }
  }

  if (node("generate-restore-drill-evidence.mjs", ["--from", backupFile, "--output", drillOutput], { BACKUP_ENCRYPTION_KEY_BASE64: randomBytes(32).toString("base64") }).status === 0) {
    failures.push("yanlış anahtarla restore reddedilmeli.");
  }
  const tampered = readFileSync(backupFile);
  tampered[tampered.length - 100] ^= 0xff;
  writeFileSync(backupFile, tampered);
  if (node("generate-restore-drill-evidence.mjs", ["--from", backupFile, "--output", drillOutput]).status === 0) {
    failures.push("değiştirilmiş yedekle restore reddedilmeli.");
  }
  if (node("backup-nightly.mjs", [], { BACKUP_ENCRYPTION_KEY_BASE64: "" }).status === 0) failures.push("anahtarsız yedek reddedilmeli.");
} finally {
  rmSync(root, { force: true, recursive: true });
}

if (failures.length > 0) {
  console.error("Gecelik yedek kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log("Gecelik yedek kontrolü geçti: şifreli yedek, saklama, birebir şifreli restore, yanlış anahtar ve değişiklik reddi.");
