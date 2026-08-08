import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getTenantScopedTables } from "./tenant-models.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsPath = join(__dirname, "../prisma/migrations");
const sql = readdirSync(migrationsPath, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name))
  .map((entry) => readFileSync(join(migrationsPath, entry.name, "migration.sql"), "utf8"))
  .join("\n");

const tenantTables = getTenantScopedTables();

const failures = [];
const restrictedPrivilegeProfiles = new Map([
  ["WhatsAppConsent", new Set(["SELECT", "INSERT"])],
  ["WhatsAppConsentEvent", new Set(["SELECT", "INSERT"])],
]);
if (tenantTables.length === 0) {
  failures.push("schema.prisma içinde tenantId taşıyan model bulunamadı");
}
const tenantDeleteGrantIndex = lastMatchIndex(
  sql,
  /GRANT\s+[^;]*(?:\bDELETE\b|\bALL(?:\s+PRIVILEGES)?\b)[^;]*\bON\b[^;]*(?:"Tenant"|ALL\s+TABLES)[^;]*\bTO\s+app\s*;/gi,
);
const tenantDeleteRevokeIndex = lastMatchIndex(
  sql,
  /REVOKE\s+(?:DELETE|ALL(?:\s+PRIVILEGES)?)\s+ON\s+(?:TABLE\s+)?"Tenant"\s+FROM\s+app\s*;/gi,
);
if (tenantDeleteRevokeIndex < tenantDeleteGrantIndex) {
  failures.push("Tenant: app rolü için son DELETE yetki işlemi REVOKE olmalı");
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
  const policyBody = lastCapture(sql, policy);

  if (!enable.test(sql)) failures.push(`${table}: ENABLE ROW LEVEL SECURITY eksik`);
  if (!force.test(sql)) failures.push(`${table}: FORCE ROW LEVEL SECURITY eksik`);
  if (!policyBody || !/\bUSING\b[\s\S]*\bWITH CHECK\b/m.test(policyBody)) {
    failures.push(`${table}: USING + WITH CHECK policy eksik`);
  }
  if (!policyBody.includes("app.current_tenant_id")) failures.push(`${table}: app.current_tenant_id kontrolü eksik`);
  if (!policyBody.includes("app.bypass_rls")) failures.push(`${table}: app.bypass_rls kontrolü eksik`);
  const restrictedPrivileges = restrictedPrivilegeProfiles.get(table);
  if (restrictedPrivileges) {
    const withCheckBody = /\bWITH CHECK\b([\s\S]*)/m.exec(policyBody)?.[1] ?? "";
    if (withCheckBody.includes("app.bypass_rls")) {
      failures.push(`${table}: INSERT WITH CHECK app.bypass_rls kabul etmemeli`);
    }
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
      const hasPrivilege = hasEffectiveAppPrivilege(sql, table, privilege);
      if (restrictedPrivileges.has(privilege) !== hasPrivilege) {
        failures.push(`${table}: app rolü ${privilege} yetki profili geçersiz`);
      }
    }
  } else if (!appGrantTables.has(table)) {
    failures.push(`${table}: app rolü için SELECT/INSERT/UPDATE/DELETE yetkisi eksik`);
  }
}

if (failures.length > 0) {
  console.error("RLS policy kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`RLS policy kontrolü geçti: ${tenantTables.length} tenant tablosu doğrulandı.`);

function lastMatchIndex(source, pattern) {
  let index = -1;
  for (const match of source.matchAll(pattern)) {
    index = match.index ?? index;
  }
  return index;
}

function lastCapture(source, pattern) {
  let value = "";
  for (const match of source.matchAll(new RegExp(pattern.source, `${pattern.flags.replace("g", "")}g`))) {
    value = match[1] ?? value;
  }
  return value;
}

function hasEffectiveAppPrivilege(source, table, privilege) {
  let granted = false;
  for (const statement of source.split(";")) {
    if (!statement.includes(`"${table}"`)) continue;

    const grant = statement.match(/\bGRANT\s+([\s\S]*?)\s+ON\s+[\s\S]*?\bTO\s+app\b/i);
    if (grant) {
      const privileges = grant[1].toUpperCase();
      if (/\bALL(?:\s+PRIVILEGES)?\b/.test(privileges) || new RegExp(`\\b${privilege}\\b`).test(privileges)) {
        granted = true;
      }
    }

    const revoke = statement.match(/\bREVOKE\s+([\s\S]*?)\s+ON\s+[\s\S]*?\bFROM\s+app\b/i);
    if (revoke) {
      const privileges = revoke[1].toUpperCase();
      if (/\bALL(?:\s+PRIVILEGES)?\b/.test(privileges) || new RegExp(`\\b${privilege}\\b`).test(privileges)) {
        granted = false;
      }
    }
  }
  return granted;
}
