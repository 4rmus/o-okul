import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getTenantScopedTables } from "../packages/db/scripts/tenant-models.mjs";

const sourceRoots = ["apps/api/src", "apps/worker/src"];
const ignoredFiles = new Set([
  "apps/api/src/db/tenant-query.ts",
  "apps/api/src/health/health.service.ts",
]);
const tenantScopedTables = getTenantScopedTables();

const failures = [];

for (const file of sourceRoots.flatMap(listTsFiles)) {
  if (ignoredFiles.has(file) || file.endsWith(".test.ts") || file.endsWith(".e2e.test.ts")) {
    continue;
  }

  const contents = readFileSync(file, "utf8");
  if (!usesSql(contents) || !touchesTenantScopedTable(contents)) {
    continue;
  }

  const tenantWrappers = ["withTenantQuery", "withExplicitTenantQuery", "withBypassRlsQuery", "withTenantDb"];
  const hasTenantWrapper = tenantWrappers.some((wrapper) => contents.includes(wrapper));
  const hasTransactionScopedBypass =
    contents.includes("BEGIN") &&
    contents.includes("COMMIT") &&
    contents.includes("set_config('app.bypass_rls'");
  if (!hasTenantWrapper && !hasTransactionScopedBypass) {
    failures.push(`${file}: tenant tablosu SQL'i tenant/bypass wrapper dışından çalışıyor.`);
  }
}

if (failures.length > 0) {
  console.error("Tenant DB erişim kontrolü başarısız:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Tenant DB erişim kontrolü geçti.");

function listTsFiles(root) {
  const entries = readdirSync(root);
  const files = [];
  for (const entry of entries) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      files.push(...listTsFiles(path));
    } else if (path.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
}

function usesSql(contents) {
  return contents.includes(".query(") || contents.includes(".query<") || contents.includes("new pg.Pool");
}

function touchesTenantScopedTable(contents) {
  return tenantScopedTables.some((table) => contents.includes(`"${table}"`));
}
