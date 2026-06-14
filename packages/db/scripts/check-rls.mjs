import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getTenantScopedTables } from "./tenant-models.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsPath = join(__dirname, "../prisma/migrations");
const sql = readdirSync(migrationsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => readFileSync(join(migrationsPath, entry.name, "migration.sql"), "utf8"))
  .join("\n");

const tenantTables = getTenantScopedTables();

const failures = [];
if (tenantTables.length === 0) {
  failures.push("schema.prisma içinde tenantId taşıyan model bulunamadı");
}

const appGrantTables = new Set(
  [...sql.matchAll(/GRANT SELECT, INSERT, UPDATE, DELETE ON([\s\S]*?)TO app;/g)].flatMap((match) =>
    [...(match[1] ?? "").matchAll(/"([^"]+)"/g)].map((tableMatch) => tableMatch[1]),
  ),
);

for (const table of tenantTables) {
  const escaped = table.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const enable = new RegExp(`ALTER TABLE\\s+"${escaped}"\\s+ENABLE ROW LEVEL SECURITY;`);
  const force = new RegExp(`ALTER TABLE\\s+"${escaped}"\\s+FORCE ROW LEVEL SECURITY;`);
  const policy = new RegExp(`CREATE POLICY\\s+"${escaped}_tenant_isolation"\\s+ON\\s+"${escaped}"([\\s\\S]*?);`, "m");
  const policyBody = policy.exec(sql)?.[1] ?? "";

  if (!enable.test(sql)) failures.push(`${table}: ENABLE ROW LEVEL SECURITY eksik`);
  if (!force.test(sql)) failures.push(`${table}: FORCE ROW LEVEL SECURITY eksik`);
  if (!policyBody || !/\bUSING\b[\s\S]*\bWITH CHECK\b/m.test(policyBody)) {
    failures.push(`${table}: USING + WITH CHECK policy eksik`);
  }
  if (!policyBody.includes("app.current_tenant_id")) failures.push(`${table}: app.current_tenant_id kontrolü eksik`);
  if (!policyBody.includes("app.bypass_rls")) failures.push(`${table}: app.bypass_rls kontrolü eksik`);
  if (!appGrantTables.has(table)) failures.push(`${table}: app rolü için SELECT/INSERT/UPDATE/DELETE yetkisi eksik`);
}

if (failures.length > 0) {
  console.error("RLS policy kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`RLS policy kontrolü geçti: ${tenantTables.length} tenant tablosu doğrulandı.`);
