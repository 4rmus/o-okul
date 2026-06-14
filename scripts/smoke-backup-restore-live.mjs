import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { validateSmokeEvidenceOutputTarget, writeSmokeEvidence } from "./smoke-evidence.mjs";

const restoreDb = `uzman_hocam_restore_smoke_${Date.now()}`;
const dumpPath = `/tmp/${restoreDb}.dump`;
const evidenceFile = process.env.BACKUP_RESTORE_SMOKE_EVIDENCE_FILE ?? process.env.SMOKE_EVIDENCE_FILE;
const environment = process.env.STAGING_ENVIRONMENT ?? process.env.NODE_ENV ?? "unknown";
const startedAt = performance.now();

await validateSmokeEvidenceOutputTarget(evidenceFile);

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

  const checks = run(
    `psql -U "$POSTGRES_USER" -d "${restoreDb}" -Atc "select 'Tenant=' || count(*) from \\"Tenant\\" union all select 'AuditLog=' || count(*) from \\"AuditLog\\" union all select 'ReportSnapshot=' || count(*) from \\"ReportSnapshot\\" union all select 'Migration=' || count(*) from \\"_prisma_migrations\\";"`,
  )
    .split("\n")
    .filter(Boolean);

  if (!checks.some((line) => line.startsWith("Tenant="))) {
    throw new Error("Restore kontrolünde Tenant tablosu okunamadı.");
  }
  if (!checks.some((line) => line.startsWith("AuditLog="))) {
    throw new Error("Restore kontrolünde AuditLog tablosu okunamadı.");
  }
  if (!checks.some((line) => line.startsWith("ReportSnapshot="))) {
    throw new Error("Restore kontrolünde ReportSnapshot tablosu okunamadı.");
  }
  if (!checks.some((line) => line.startsWith("Migration="))) {
    throw new Error("Restore kontrolünde migration tablosu okunamadı.");
  }
  const tableCounts = parseTableCounts(checks);
  if (tableCounts._prisma_migrations < 1) {
    throw new Error("Restore kontrolünde _prisma_migrations en az 1 satır olmalı.");
  }

  await writeSmokeEvidence(evidenceFile, {
    result: "PASS",
    check: "backup_restore_smoke",
    environment,
    checkedAt: new Date().toISOString(),
    restoreDatabaseHash: sha256(restoreDb),
    dumpFormat: "custom",
    tableCounts,
    durationMs: Math.round(performance.now() - startedAt),
    commandsPassed: ["pnpm backup:restore:smoke"],
    gaps: [],
  });

  console.log(`Backup/restore smoke geçti: ${restoreDb} (${checks.join(", ")})`);
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

function parseTableCounts(lines) {
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
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`Restore kontrolünde ${key} sayımı geçersiz: ${rawValue}`);
    }
    counts[key] = value;
  }

  for (const [key, value] of Object.entries(counts)) {
    if (value === null) {
      throw new Error(`Restore kontrolünde ${key} sayımı eksik.`);
    }
  }

  return counts;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
