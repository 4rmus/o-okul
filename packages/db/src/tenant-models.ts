import { readFileSync } from "node:fs";
import { join } from "node:path";

const defaultSchemaPath = join(__dirname, "../prisma/schema.prisma");

// Global auth delivery infrastructure also serves system accounts. tenantId is
// optional routing metadata; the encrypted payload is never tenant-queryable.
export const tenantScopedTableExceptions: string[] = ["SecretDeliveryOutbox"];

export function getTenantScopedTables(schemaPath = defaultSchemaPath): string[] {
  const schema = readFileSync(schemaPath, "utf8");
  const tables: string[] = [];

  for (const match of schema.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)) {
    const [, modelName, body = ""] = match;
    if (!modelName || !/^\s*tenantId\s+String\??\b/m.test(body)) continue;
    if (tenantScopedTableExceptions.includes(modelName)) continue;
    tables.push(readMappedTableName(modelName, body));
  }

  return tables;
}

export const tenantScopedTables = getTenantScopedTables();
export type TenantScopedTable = (typeof tenantScopedTables)[number];

function readMappedTableName(modelName: string, body: string): string {
  return body.match(/@@map\("([^"]+)"\)/)?.[1] ?? modelName;
}
