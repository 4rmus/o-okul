import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, parse, resolve } from "node:path";

const outputPath = readOption("--output") ?? process.env.RESTORE_DRILL_OUTPUT;
const environment = readOption("--environment") ?? process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "staging";
const restoreDb = `o_okul_restore_drill_${Date.now()}`;
const dumpPath = `/tmp/${restoreDb}.dump`;

const failures = [];
requireValue(outputPath, "RESTORE_DRILL_OUTPUT veya --output", failures);
requireOneOf(environment, "environment", ["staging", "production"], failures);
if (failures.length > 0) fail(failures);

const outputFile = resolve(outputPath);
validateOutputTarget(outputFile);

function run(command) {
  const result = spawnSync("docker", ["compose", "exec", "-T", "postgres", "sh", "-lc", command], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command}\n${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

try {
  run(`pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-privileges --file="${dumpPath}"`);
  run(`createdb -U "$POSTGRES_USER" "${restoreDb}"`);
  run(`pg_restore -U "$POSTGRES_USER" -d "${restoreDb}" "${dumpPath}"`);

  const tableCounts = readTableCounts(restoreDb);
  const report = {
    result: "PASS",
    environment,
    drillDate: new Date().toISOString(),
    sourceBackup: `docker-compose-postgres-dump:${restoreDb}.dump`,
    targetDatabase: restoreDb,
    tableCounts,
    errors: [],
  };

  mkdirSync(dirname(outputFile), { recursive: true });
  validateOutputTarget(outputFile);
  writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`);
  validateOutputTarget(outputFile);
  console.log(`Restore drill kanıtı yazıldı: ${outputFile}`);
} finally {
  try {
    run(`dropdb -U "$POSTGRES_USER" --if-exists "${restoreDb}"`);
  } catch {
    // Best-effort cleanup.
  }
  try {
    run(`rm -f "${dumpPath}"`);
  } catch {
    // Best-effort cleanup.
  }
}

function readTableCounts(databaseName) {
  const lines = run(
    `psql -U "$POSTGRES_USER" -d "${databaseName}" -Atc "select 'Tenant=' || count(*) from \\"Tenant\\" union all select 'AuditLog=' || count(*) from \\"AuditLog\\" union all select 'ReportSnapshot=' || count(*) from \\"ReportSnapshot\\" union all select 'Migration=' || count(*) from \\"_prisma_migrations\\";"`,
  )
    .split("\n")
    .filter(Boolean);

  const counts = {
    Tenant: null,
    AuditLog: null,
    ReportSnapshot: null,
    _prisma_migrations: null,
  };
  const labels = new Map([
    ["Tenant", "Tenant"],
    ["AuditLog", "AuditLog"],
    ["ReportSnapshot", "ReportSnapshot"],
    ["Migration", "_prisma_migrations"],
  ]);

  for (const line of lines) {
    const [rawLabel, rawValue] = line.split("=");
    const key = labels.get(rawLabel);
    if (!key) continue;
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Restore drill ${key} sayımı en az 1 olmalı: ${rawValue}`);
    }
    counts[key] = value;
  }

  for (const [key, value] of Object.entries(counts)) {
    if (value === null) {
      throw new Error(`Restore drill ${key} sayımı eksik.`);
    }
  }

  return counts;
}

function readOption(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    fail([`${name} için değer gerekli.`]);
  }
  return value;
}

function requireValue(value, label, output) {
  if (typeof value !== "string" || value.trim() === "") {
    output.push(`${label} boş bırakılamaz.`);
  }
}

function requireOneOf(value, label, expected, output) {
  if (!expected.includes(value)) {
    output.push(`${label} ${expected.join(" veya ")} olmalı.`);
  }
}

function validateOutputTarget(filePath) {
  if (isLocalTempPath(filePath)) {
    fail(["RESTORE_DRILL_OUTPUT lokal temp path olmamalı."]);
  }

  assertParentPathAllowed(dirname(filePath));

  if (existsSync(filePath)) {
    const fileStat = lstatSync(filePath);
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      fail(["RESTORE_DRILL_OUTPUT symlink olmayan file artifact olmalı."]);
    }
  }
}

function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const directoryStat = lstatSync(current);
    if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) {
      fail(["RESTORE_DRILL_OUTPUT parent dizini symlink olmayan dizin olmalı."]);
    }
  }
}

function isLocalTempPath(filePath) {
  const normalized = filePath.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function fail(messages) {
  console.error("Restore drill kanıtı üretimi başarısız:");
  for (const message of messages) console.error(`- ${message}`);
  process.exit(1);
}
