import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationPath = join(
  __dirname,
  "../prisma/migrations/20260530143000_partition_audit_log_by_created_at/migration.sql",
);
const sql = readFileSync(migrationPath, "utf8");

const expectations = [
  /CREATE TABLE "AuditLog"[\s\S]*?\) PARTITION BY RANGE \("createdAt"\);/,
  /CONSTRAINT "AuditLog_pkey" PRIMARY KEY \("id", "createdAt"\)/,
  /CREATE TABLE "AuditLog_default" PARTITION OF "AuditLog" DEFAULT;/,
  /CREATE TABLE "AuditLog_2026_06" PARTITION OF "AuditLog"[\s\S]*?FOR VALUES FROM \('2026-06-01'\) TO \('2026-07-01'\);/,
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

if (failures.length > 0) {
  console.error("AuditLog partition kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("AuditLog partition kontrolü geçti.");
