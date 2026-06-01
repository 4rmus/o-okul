import { spawnSync } from "node:child_process";

const restoreDb = `uzman_hocam_restore_smoke_${Date.now()}`;
const dumpPath = `/tmp/${restoreDb}.dump`;

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
