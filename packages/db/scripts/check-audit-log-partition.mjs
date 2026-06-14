import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  __dirname,
  "../prisma/migrations/20260530143000_partition_audit_log_by_created_at/migration.sql",
);
const sql = readFileSync(migrationPath, "utf8");
const maintenanceScript = readFileSync(join(__dirname, "maintain-audit-log-partitions.mjs"), "utf8");
const maintenanceContractScript = readFileSync(join(__dirname, "check-audit-log-partition-maintenance-contract.mjs"), "utf8");

const expectations = [
  /CREATE TABLE "AuditLog"[\s\S]*?\) PARTITION BY RANGE \("createdAt"\);/,
  /CONSTRAINT "AuditLog_pkey" PRIMARY KEY \("id", "createdAt"\)/,
  /CREATE TABLE "AuditLog_default" PARTITION OF "AuditLog" DEFAULT;/,
  /INSERT INTO "AuditLog"[\s\S]*?SELECT "id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff", "createdAt"[\s\S]*?FROM "AuditLog_legacy";/,
  /ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;/,
  /ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;/,
  /CREATE POLICY "AuditLog_tenant_isolation" ON "AuditLog"[\s\S]*?USING[\s\S]*?WITH CHECK/,
  /GRANT SELECT, INSERT, UPDATE, DELETE ON "AuditLog" TO app;/,
];

const failures = expectations
  .map((expectation, index) => ({ expectation, index }))
  .filter(({ expectation }) => !expectation.test(sql))
  .map(({ index }) => `partition beklentisi ${index + 1} eksik`);

for (const { name, from, to } of expectedBootstrapPartitions("2026-01", 12)) {
  const partition = new RegExp(
    `CREATE TABLE "${name}" PARTITION OF "AuditLog"[\\s\\S]*?FOR VALUES FROM \\('${from}'\\) TO \\('${to}'\\);`,
  );
  if (!partition.test(sql)) {
    failures.push(`${name} bootstrap partition eksik`);
  }
}

requireTokens(
  "maintain-audit-log-partitions.mjs",
  maintenanceScript,
  [
    "AUDIT_LOG_PARTITION_START_MONTH",
    "AUDIT_LOG_PARTITION_MONTHS_AHEAD",
    "AUDIT_LOG_PARTITION_APPLY",
    "AUDIT_LOG_PARTITION_EVIDENCE_FILE",
    "DIRECT_DATABASE_URL",
    "CREATE TABLE IF NOT EXISTS",
    "PARTITION OF \"AuditLog\"",
    "FOR VALUES FROM",
    "AuditLog RANGE partitioned tablo olmalı.",
    "audit_log_partition_maintenance",
    "pnpm audit-log-partition:maintain",
    "AUDIT_LOG_PARTITION_EVIDENCE_FILE lokal temp path olmamalı.",
    "AUDIT_LOG_PARTITION_EVIDENCE_FILE symlink olmayan file artifact olmalı.",
    "AUDIT_LOG_PARTITION_EVIDENCE_FILE parent dizini symlink olmayan dizin olmalı.",
  ],
  failures,
);

requireTokens(
  "check-audit-log-partition-maintenance-contract.mjs",
  maintenanceContractScript,
  [
    "AUDIT_LOG_PARTITION_START_MONTH",
    "2026-06",
    "AUDIT_LOG_PARTITION_MONTHS_AHEAD",
    "3",
    "audit log partition evidence temp path negative",
    "audit log partition evidence symlink file negative",
    "audit log partition evidence symlink parent negative",
    "join(symlinkDirectory, \"nested\", \"evidence.json\")",
    "AuditLog_2026_06",
    "AuditLog_2026_07",
    "AuditLog_2026_08",
    "AuditLog partition maintenance contract kontrolü geçti.",
  ],
  failures,
);

if (failures.length > 0) {
  console.error("AuditLog partition kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("AuditLog partition kontrolü geçti.");

function expectedBootstrapPartitions(startMonth, count) {
  return Array.from({ length: count }, (_, index) => {
    const fromMonth = addMonths(startMonth, index);
    const toMonth = addMonths(startMonth, index + 1);
    return {
      name: `AuditLog_${fromMonth.replace("-", "_")}`,
      from: `${fromMonth}-01`,
      to: `${toMonth}-01`,
    };
  });
}

function addMonths(month, offset) {
  const [year, monthIndex] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthIndex - 1 + offset, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function requireTokens(label, content, tokens, collectedFailures) {
  for (const token of tokens) {
    if (!content.includes(token)) {
      collectedFailures.push(`${label} token eksik: ${token}`);
    }
  }
}
