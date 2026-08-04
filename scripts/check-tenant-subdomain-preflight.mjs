import pg from "pg";

const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) {
  console.error("TENANT_SUBDOMAIN_PREFLIGHT_DATABASE_URL_REQUIRED");
  process.exit(1);
}

const reserved = new Set([
  "www", "sistem", "system", "api", "admin", "ops", "evidence", "status", "staging", "mail", "support", "cdn", "assets",
]);
const pattern = /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])$/;
const pool = new pg.Pool({ connectionString, max: 1 });

try {
  const result = await pool.query(`SELECT "id", lower(btrim("slug")) AS "slug" FROM "Tenant" WHERE "status" <> 'DELETED' AND "id" <> 'system' ORDER BY "id"`);
  const invalid = result.rows.filter(({ slug }) => !pattern.test(slug) || reserved.has(slug));
  if (invalid.length > 0) {
    console.error("Tenant subdomain preflight başarısız:");
    for (const tenant of invalid) console.error(`- ${tenant.id}: ${tenant.slug}`);
    process.exitCode = 1;
  } else {
    console.log(`Tenant subdomain preflight geçti: ${result.rowCount ?? 0} tenant slug doğrulandı.`);
  }
} finally {
  await pool.end();
}
