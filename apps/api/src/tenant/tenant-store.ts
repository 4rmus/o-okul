import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withBypassRlsQuery } from "../db/tenant-query.js";

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  plan: string;
  licenseStartsAt?: string;
  licenseEndsAt?: string;
  seatLimit?: number;
  status: string;
}

export interface TenantStore {
  list(): Promise<TenantRecord[]>;
  findById(id: string): Promise<TenantRecord | undefined>;
  findForAdmin(id: string): Promise<TenantRecord | undefined>;
  create(input: CreateTenantInput): Promise<TenantRecord>;
  update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined>;
}

export const tenantStoreToken = Symbol("TenantStore");

const demoTenants: TenantRecord[] = [
  { id: "tenant-a", name: "DNA EĞİTİM KURUMU", slug: "dna-egitim", plan: "PRO", status: "ACTIVE" },
  { id: "tenant-b", name: "Demo Kurum B", slug: "demo-kurum-b", plan: "TRIAL", status: "ACTIVE" },
  {
    id: "tenant-expired",
    name: "Demo Süresi Dolmuş Kurum",
    slug: "demo-suresi-dolmus-kurum",
    plan: "TRIAL",
    licenseEndsAt: "2020-01-01T00:00:00.000Z",
    status: "ACTIVE",
  },
];

export class InMemoryTenantStore implements TenantStore {
  private readonly tenants = demoTenants.map((record) => ({ ...record }));

  async list(): Promise<TenantRecord[]> {
    return this.tenants.map((tenant) => ({ ...tenant }));
  }

  async findById(id: string): Promise<TenantRecord | undefined> {
    const tenant = this.tenants.find((record) => record.id === id && isUsableTenant(record));
    return tenant ? { ...tenant } : undefined;
  }

  async findForAdmin(id: string): Promise<TenantRecord | undefined> {
    const tenant = this.tenants.find((record) => record.id === id);
    return tenant ? { ...tenant } : undefined;
  }

  async create(input: CreateTenantInput): Promise<TenantRecord> {
    const tenant: TenantRecord = {
      id: input.id ?? randomUUID(),
      name: input.name,
      slug: input.slug,
      plan: input.plan ?? "TRIAL",
      licenseStartsAt: input.licenseStartsAt,
      licenseEndsAt: input.licenseEndsAt,
      seatLimit: input.seatLimit,
      status: input.status ?? "ACTIVE",
    };
    this.tenants.push(tenant);
    return { ...tenant };
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined> {
    const tenant = this.tenants.find((record) => record.id === id);
    if (!tenant) return undefined;
    Object.assign(tenant, withoutUndefined(input));
    return { ...tenant };
  }
}

export class PostgresTenantStore implements TenantStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<TenantRecord[]> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status"
         FROM "Tenant"
         ORDER BY "createdAt" DESC`,
      );
      return result.rows.map(mapTenantRow);
    });
  }

  async findById(id: string): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status" FROM "Tenant"
         WHERE "id" = $1 AND "status" = 'ACTIVE'
           AND ("licenseEndsAt" IS NULL OR "licenseEndsAt" >= now())
         LIMIT 1`,
        [id],
      );
      const row = result.rows[0];
      return row ? mapTenantRow(row) : undefined;
    });
  }

  async findForAdmin(id: string): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status" FROM "Tenant"
         WHERE "id" = $1
         LIMIT 1`,
        [id],
      );
      const row = result.rows[0];
      return row ? mapTenantRow(row) : undefined;
    });
  }

  async create(input: CreateTenantInput): Promise<TenantRecord> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `INSERT INTO "Tenant" ("id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status"`,
        [
          input.id ?? randomUUID(),
          input.name,
          input.slug,
          input.plan ?? "TRIAL",
          input.licenseStartsAt ?? null,
          input.licenseEndsAt ?? null,
          input.seatLimit ?? null,
          input.status ?? "ACTIVE",
        ],
      );
      return mapTenantRow(result.rows[0]!);
    });
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const currentResult = await client.query<TenantRow>(
        `SELECT "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status" FROM "Tenant"
         WHERE "id" = $1
         LIMIT 1`,
        [id],
      );
      const current = currentResult.rows[0] ? mapTenantRow(currentResult.rows[0]) : undefined;
      if (!current) return undefined;
      const next = { ...current, ...withoutUndefined(input) };
      const result = await client.query<TenantRow>(
        `UPDATE "Tenant"
         SET "name" = $2,
             "slug" = $3,
             "plan" = $4,
             "licenseStartsAt" = $5,
             "licenseEndsAt" = $6,
             "seatLimit" = $7,
             "status" = $8,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "seatLimit", "status"`,
        [
          id,
          next.name,
          next.slug,
          next.plan,
          next.licenseStartsAt ?? null,
          next.licenseEndsAt ?? null,
          next.seatLimit ?? null,
          next.status,
        ],
      );
      return mapTenantRow(result.rows[0]!);
    });
  }
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  licenseStartsAt: Date | string | null;
  licenseEndsAt: Date | string | null;
  seatLimit: number | null;
  status: string;
}

export interface CreateTenantInput {
  id?: string;
  name: string;
  slug: string;
  plan?: string;
  licenseStartsAt?: string;
  licenseEndsAt?: string;
  seatLimit?: number;
  status?: string;
}

export type UpdateTenantInput = Partial<Omit<CreateTenantInput, "id">>;

function mapTenantRow(row: TenantRow): TenantRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    plan: row.plan,
    licenseStartsAt: optionalDateString(row.licenseStartsAt),
    licenseEndsAt: optionalDateString(row.licenseEndsAt),
    seatLimit: row.seatLimit ?? undefined,
    status: row.status,
  };
}

function optionalDateString(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function isUsableTenant(tenant: TenantRecord): boolean {
  if (tenant.status !== "ACTIVE") return false;
  return !tenant.licenseEndsAt || Date.parse(tenant.licenseEndsAt) >= Date.now();
}

function withoutUndefined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

export function createTenantStore(): TenantStore {
  return resolvePersistenceDriver(process.env.TENANT_STORE) === "postgres" ? new PostgresTenantStore() : new InMemoryTenantStore();
}
