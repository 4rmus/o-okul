import { readFileSync } from "node:fs";
import { assertResetCatalog, assertResetColumns, tenantResetCatalog } from "../src/tenant-reset-catalog.js";
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
assertResetCatalog([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]!));
console.log("Tenant reset catalog: all direct, indirect and global tables classified.");

const columns: Record<string, string[]> = {};
const scalarTypes = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "Decimal", "BigInt", "Bytes", "TenantRole", "StaffRole"]);
for (const match of schema.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)) {
  columns[match[1]!] = [...match[2]!.matchAll(/^\s*(\w+)\s+(\w+)[?\[\]]*/gm)].filter((field) => scalarTypes.has(field[2]!)).map((field) => field[1]!).sort();
}
assertResetColumns(columns);

const migration = readFileSync(new URL("../prisma/migrations/20260907120000_tenant_fresh_reset_operation/migration.sql", import.meta.url), "utf8") + readFileSync(new URL("../prisma/migrations/20260907160000_tenant_mutation_activity/migration.sql", import.meta.url), "utf8");
for (const [table, disposition] of Object.entries(tenantResetCatalog)) {
  if (!migration.includes(`CREATE POLICY "${table}_reset_boundary"`) || !migration.includes(`ON "${table}" AS RESTRICTIVE TO o_okul_reset_worker`)) throw new Error(`RESET_ROLE_BOUNDARY_MISSING:${table}`);
  if (disposition !== "DELETE" && migration.includes(`GRANT DELETE ON "${table}" TO o_okul_reset_worker`)) throw new Error(`RESET_ROLE_DELETE_EXCESS:${table}`);
}
if (!migration.includes('WHERE "status" <> \'COMPLETED\'') || !migration.includes('REVOKE DELETE ON "TenantFreshResetOperation" FROM app')) throw new Error("RESET_OPERATION_GUARD_MISSING");
console.log("Tenant reset operation: unique unfinished operation and restrictive worker grants verified.");
