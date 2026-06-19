import { getTenantScopedTables as getRuntimeTenantScopedTables } from "./tenant-models.mjs";
import { getTenantScopedTables as getPackageTenantScopedTables } from "../src/tenant-models.js";

const runtimeTables = getRuntimeTenantScopedTables();
const packageTables = getPackageTenantScopedTables();

const runtimeJson = JSON.stringify(runtimeTables);
const packageJson = JSON.stringify(packageTables);

if (runtimeJson !== packageJson) {
  console.error("Tenant model kaynakları ayrıştı:");
  console.error(`- scripts/tenant-models.mjs: ${runtimeTables.join(", ")}`);
  console.error(`- src/tenant-models.ts: ${packageTables.join(", ")}`);
  process.exit(1);
}

console.log(`Tenant model parity kontrolü geçti: ${runtimeTables.length} tenant tablo.`);
