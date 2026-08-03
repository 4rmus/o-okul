import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const defaultSchemaPath = join(__dirname, "../prisma/schema.prisma");

// RLS zorunluluğu `tenantId` kolonu taşıyan her modelden türetilir. Tenant'sız
// kalan tablolar (PasswordResetToken, ConsumedRefreshToken, AuditLog) global
// auth/denetim altyapısıdır: global User kimliğine (User.tenantId NULL olabilen
// sistem kullanıcıları dahil) bağlandıkları için tenant policy uygulanamaz.
// Bu listeye ekleme, tenantId taşıdığı halde RLS dışı bırakılacak model içindir.
export const tenantScopedTableExceptions = ["SecretDeliveryOutbox"];

export function getTenantScopedTables(schemaPath = defaultSchemaPath) {
  const schema = readFileSync(schemaPath, "utf8");
  const tables = [];

  for (const match of schema.matchAll(/model\s+(\w+)\s+\{([\s\S]*?)\n\}/g)) {
    const [, modelName, body = ""] = match;
    if (!/^\s*tenantId\s+String\??\b/m.test(body)) continue;
    if (tenantScopedTableExceptions.includes(modelName)) continue;
    tables.push(readMappedTableName(modelName, body));
  }

  return tables;
}

function readMappedTableName(modelName, body) {
  return body.match(/@@map\("([^"]+)"\)/)?.[1] ?? modelName;
}
