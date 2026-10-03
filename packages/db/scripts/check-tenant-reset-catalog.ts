import { readdirSync, readFileSync } from "node:fs";
import { assertResetBoundaries, assertResetCatalog, assertResetColumns } from "../src/tenant-reset-catalog.js";
const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
assertResetCatalog([...schema.matchAll(/^model\s+(\w+)\s*\{/gm)].map((match) => match[1]!));
console.log("Tenant reset catalog: all direct, indirect and global tables classified.");

const columns: Record<string, string[]> = {};
const scalarTypes = new Set(["String", "Int", "Float", "Boolean", "DateTime", "Json", "Decimal", "BigInt", "Bytes", "TenantRole", "StaffRole"]);
for (const match of schema.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)) {
  columns[match[1]!] = [...match[2]!.matchAll(/^\s*(\w+)\s+(\w+)[?\[\]]*/gm)].filter((field) => scalarTypes.has(field[2]!)).map((field) => field[1]!).sort();
}
assertResetColumns(columns);

// Same source as check-rls.mjs: every migration in order, so a new table's reset boundary may live in its own migration.
const migrationsDir = new URL("../prisma/migrations/", import.meta.url);
const migration = readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((name) => readFileSync(new URL(`${name}/migration.sql`, migrationsDir), "utf8"))
  .join("\n");
assertResetBoundaries(migration);
if (!migration.includes('WHERE "status" <> \'COMPLETED\'') || !migration.includes('REVOKE DELETE ON "TenantFreshResetOperation" FROM app')) throw new Error("RESET_OPERATION_GUARD_MISSING");
console.log("Tenant reset operation: unique unfinished operation and restrictive worker grants verified.");
