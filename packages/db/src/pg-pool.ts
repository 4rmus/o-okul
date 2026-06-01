import pg from "pg";
import type { TenantQueryable } from "./tenant-db.js";

export function createTenantPgPool(
  databaseUrl = process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/uzman_hocam",
): TenantQueryable {
  return new pg.Pool({ connectionString: databaseUrl });
}
