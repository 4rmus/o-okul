import pg from "pg";
import { type TenantQueryable, withBypassRlsQuery } from "../db/tenant-query.js";

export interface TenantRecord {
  id: string;
  name: string;
}

export interface TenantStore {
  findById(id: string): Promise<TenantRecord | undefined>;
}

export const tenantStoreToken = Symbol("TenantStore");

const demoTenants: TenantRecord[] = [
  { id: "tenant-a", name: "DNA EĞİTİM KURUMU" },
  { id: "tenant-b", name: "Demo Kurum B" },
];

export class InMemoryTenantStore implements TenantStore {
  private readonly tenants = demoTenants.map((record) => ({ ...record }));

  async findById(id: string): Promise<TenantRecord | undefined> {
    return this.tenants.find((tenant) => tenant.id === id);
  }
}

export class PostgresTenantStore implements TenantStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async findById(id: string): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT "id", "name" FROM "Tenant"
         WHERE "id" = $1 AND "status" = 'ACTIVE'
         LIMIT 1`,
        [id],
      );
      const row = result.rows[0];
      return row ? { id: row.id, name: row.name } : undefined;
    });
  }
}

interface TenantRow {
  id: string;
  name: string;
}

export function createTenantStore(): TenantStore {
  return process.env.TENANT_STORE === "postgres" ? new PostgresTenantStore() : new InMemoryTenantStore();
}
