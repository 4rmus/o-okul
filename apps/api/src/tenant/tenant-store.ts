import { randomUUID } from "node:crypto";
import pg from "pg";
import { hashPassword, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withBypassRlsQuery } from "../db/tenant-query.js";
import { encryptTcIdentity, hashTcIdentity } from "../student/tc-identity.js";
import type { TenantUserRecord } from "../user-management/user-management-store.js";

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  plan: string;
  licenseStartsAt?: string;
  licenseEndsAt?: string;
  institutionType?: string;
  contactEmail?: string;
  logoUrl?: string;
  seatLimit?: number;
  activeSeatCount?: number;
  status: string;
}

export interface TenantStore {
  list(): Promise<TenantRecord[]>;
  findById(id: string): Promise<TenantRecord | undefined>;
  findBySlug(slug: string): Promise<TenantRecord | undefined>;
  findForAdmin(id: string): Promise<TenantRecord | undefined>;
  create(input: CreateTenantInput): Promise<TenantRecord>;
  createWithFirstAdmin?(input: CreateTenantInput, firstAdmin: CreateTenantFirstAdminInput): Promise<TenantCreateWithAdminResult>;
  update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined>;
  delete(id: string): Promise<TenantRecord | undefined>;
}

export const tenantStoreToken = Symbol("TenantStore");

const demoTenants: TenantRecord[] = [
  { id: "tenant-a", name: "DNA EĞİTİM KURUMU", slug: "dna-egitim", plan: "PRO", activeSeatCount: 4, status: "ACTIVE" },
  { id: "tenant-b", name: "Demo Kurum B", slug: "demo-kurum-b", plan: "TRIAL", activeSeatCount: 1, status: "ACTIVE" },
  {
    id: "tenant-expired",
    name: "Demo Süresi Dolmuş Kurum",
    slug: "demo-suresi-dolmus-kurum",
    plan: "TRIAL",
    licenseEndsAt: "2020-01-01T00:00:00.000Z",
    activeSeatCount: 0,
    status: "ACTIVE",
  },
];

export class InMemoryTenantStore implements TenantStore {
  private readonly tenants = demoTenants.map((record) => ({ ...record }));
  private readonly firstAdmins: TenantUserRecord[] = [];

  async list(): Promise<TenantRecord[]> {
    return this.tenants.filter((tenant) => tenant.status !== "DELETED").map((tenant) => ({ ...tenant }));
  }

  async findById(id: string): Promise<TenantRecord | undefined> {
    const tenant = this.tenants.find((record) => record.id === id && isUsableTenant(record));
    return tenant ? { ...tenant } : undefined;
  }

  async findBySlug(slug: string): Promise<TenantRecord | undefined> {
    const normalizedSlug = slug.trim().toLowerCase();
    const tenant = this.tenants.find((record) => record.slug.toLowerCase() === normalizedSlug && isUsableTenant(record));
    return tenant ? { ...tenant } : undefined;
  }

  async findForAdmin(id: string): Promise<TenantRecord | undefined> {
    const tenant = this.tenants.find((record) => record.id === id && record.status !== "DELETED");
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
      institutionType: input.institutionType,
      contactEmail: input.contactEmail,
      logoUrl: input.logoUrl,
      seatLimit: input.seatLimit,
      activeSeatCount: 0,
      status: input.status ?? "ACTIVE",
    };
    this.tenants.push(tenant);
    return { ...tenant };
  }

  async createWithFirstAdmin(input: CreateTenantInput, firstAdmin: CreateTenantFirstAdminInput): Promise<TenantCreateWithAdminResult> {
    const tenant = await this.create(input);
    const storedTenant = this.tenants.find((record) => record.id === tenant.id);
    if (storedTenant) {
      storedTenant.activeSeatCount = 1;
    }
    tenant.activeSeatCount = 1;
    const now = new Date().toISOString();
    const admin: TenantUserRecord = {
      id: randomUUID(),
      email: firstAdmin.email.toLowerCase(),
      name: firstAdmin.name,
      tenantId: tenant.id,
      roles: ["TENANT_ADMIN"],
      createdAt: now,
      updatedAt: now,
    };
    this.firstAdmins.push(admin);
    upsertInMemoryAuthUser({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      nationalIdHash: hashTcIdentity(firstAdmin.nationalId),
      mustChangePassword: true,
      password: firstAdmin.phone,
      tenantId: admin.tenantId,
      roles: admin.roles,
    });
    return { tenant: { ...tenant, activeSeatCount: 1 }, admin: { ...admin } };
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined> {
    const tenant = this.tenants.find((record) => record.id === id);
    if (!tenant) return undefined;
    Object.assign(tenant, withoutUndefined(input));
    return { ...tenant };
  }

  async delete(id: string): Promise<TenantRecord | undefined> {
    const index = this.tenants.findIndex((record) => record.id === id && record.id !== "system");
    if (index === -1) return undefined;
    const tenant = this.tenants[index];
    if (!tenant) return undefined;
    this.tenants.splice(index, 1);
    for (let i = this.firstAdmins.length - 1; i >= 0; i -= 1) {
      if (this.firstAdmins[i]?.tenantId === id) {
        this.firstAdmins.splice(i, 1);
      }
    }
    return { ...tenant, status: "DELETED" };
  }
}

export class PostgresTenantStore implements TenantStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async list(): Promise<TenantRecord[]> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT
           t."id",
           t."name",
           t."slug",
           t."plan",
           t."licenseStartsAt",
           t."licenseEndsAt",
           t."institutionType",
           t."contactEmail",
           t."logoUrl",
           t."seatLimit",
           COUNT(DISTINCT m."userId")::int AS "activeSeatCount",
           t."status"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE t."id" <> 'system' AND t."status" <> 'DELETED'
         GROUP BY t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt", t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status", t."createdAt"
         ORDER BY t."createdAt" DESC`,
      );
      return result.rows.map(mapTenantRow);
    });
  }

  async findById(id: string): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT
           t."id",
           t."name",
           t."slug",
           t."plan",
           t."licenseStartsAt",
           t."licenseEndsAt",
           t."institutionType",
           t."contactEmail",
           t."logoUrl",
           t."seatLimit",
           COUNT(DISTINCT m."userId")::int AS "activeSeatCount",
           t."status"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE t."id" = $1 AND t."status" = 'ACTIVE'
           AND (t."licenseEndsAt" IS NULL OR t."licenseEndsAt" >= now())
         GROUP BY t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt", t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status"
         LIMIT 1`,
        [id],
      );
      const row = result.rows[0];
      return row ? mapTenantRow(row) : undefined;
    });
  }

  async findBySlug(slug: string): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT
           t."id",
           t."name",
           t."slug",
           t."plan",
           t."licenseStartsAt",
           t."licenseEndsAt",
           t."institutionType",
           t."contactEmail",
           t."logoUrl",
           t."seatLimit",
           COUNT(DISTINCT m."userId")::int AS "activeSeatCount",
           t."status"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE lower(t."slug") = lower($1) AND t."status" = 'ACTIVE'
           AND (t."licenseEndsAt" IS NULL OR t."licenseEndsAt" >= now())
         GROUP BY t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt", t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status"
         LIMIT 1`,
        [slug],
      );
      const row = result.rows[0];
      return row ? mapTenantRow(row) : undefined;
    });
  }

  async findForAdmin(id: string): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<TenantRow>(
        `SELECT
           t."id",
           t."name",
           t."slug",
           t."plan",
           t."licenseStartsAt",
           t."licenseEndsAt",
           t."institutionType",
           t."contactEmail",
           t."logoUrl",
           t."seatLimit",
           COUNT(DISTINCT m."userId")::int AS "activeSeatCount",
           t."status"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE t."id" = $1 AND t."status" <> 'DELETED'
         GROUP BY t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt", t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status"
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
        `INSERT INTO "Tenant" ("id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType", "contactEmail", "logoUrl", "seatLimit", "status", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         RETURNING "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType", "contactEmail", "logoUrl", "seatLimit", 0::int AS "activeSeatCount", "status"`,
        [
          input.id ?? randomUUID(),
          input.name,
          input.slug,
          input.plan ?? "TRIAL",
          input.licenseStartsAt ?? null,
          input.licenseEndsAt ?? null,
          input.institutionType ?? null,
          input.contactEmail ?? null,
          input.logoUrl ?? null,
          input.seatLimit ?? null,
          input.status ?? "ACTIVE",
        ],
      );
      return mapTenantRow(result.rows[0]!);
    });
  }

  async createWithFirstAdmin(input: CreateTenantInput, firstAdmin: CreateTenantFirstAdminInput): Promise<TenantCreateWithAdminResult> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const normalizedEmail = firstAdmin.email.toLowerCase();
      const existingUser = await client.query<{ id: string }>(
        `SELECT "id" FROM "User" WHERE lower("email") = lower($1) LIMIT 1`,
        [normalizedEmail],
      );
      if (existingUser.rows[0]) {
        throw tenantFirstAdminEmailAlreadyExists();
      }

      const tenantResult = await client.query<TenantRow>(
        `INSERT INTO "Tenant" ("id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType", "contactEmail", "logoUrl", "seatLimit", "status", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
         RETURNING "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType", "contactEmail", "logoUrl", "seatLimit", 0::int AS "activeSeatCount", "status"`,
        [
          input.id ?? randomUUID(),
          input.name,
          input.slug,
          input.plan ?? "TRIAL",
          input.licenseStartsAt ?? null,
          input.licenseEndsAt ?? null,
          input.institutionType ?? null,
          input.contactEmail ?? null,
          input.logoUrl ?? null,
          input.seatLimit ?? null,
          input.status ?? "ACTIVE",
        ],
      );
      const tenant = mapTenantRow(tenantResult.rows[0]!);
      const passwordHash = hashPassword(firstAdmin.phone, randomUUID());
      const nationalIdEncrypted = encryptTcIdentity(firstAdmin.nationalId);
      const nationalIdHash = hashTcIdentity(firstAdmin.nationalId);
      const createdUser = await client.query<{ id: string }>(
        `INSERT INTO "User" ("id", "tenantId", "email", "nationalIdEncrypted", "nationalIdHash", "name", "passwordHash", "mustChangePassword", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, true, now())
         ON CONFLICT ("email") DO NOTHING
         RETURNING "id"`,
        [randomUUID(), tenant.id, normalizedEmail, nationalIdEncrypted, nationalIdHash, firstAdmin.name, passwordHash],
      );
      const userId = createdUser.rows[0]?.id;
      if (!userId) {
        throw tenantFirstAdminEmailAlreadyExists();
      }

      await client.query(`DELETE FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = $2`, [tenant.id, userId]);
      await client.query(
        `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
         VALUES ($1, $2, $3, 'TENANT_ADMIN', now())`,
        [randomUUID(), tenant.id, userId],
      );
      const adminResult = await client.query<TenantAdminRow>(
        `SELECT
           u."id",
           u."email",
           u."name",
           m."tenantId",
           array_agg(m."role"::text ORDER BY m."role"::text) AS roles,
           min(u."createdAt") AS "createdAt",
           max(u."updatedAt") AS "updatedAt"
         FROM "TenantMembership" m
         JOIN "User" u ON u."id" = m."userId"
         WHERE m."tenantId" = $1 AND u."id" = $2
         GROUP BY u."id", u."email", u."name", m."tenantId"
         LIMIT 1`,
        [tenant.id, userId],
      );
      const admin = adminResult.rows[0] ? mapTenantAdminRow(adminResult.rows[0]) : undefined;
      if (!admin) {
        throw new Error("USER_MEMBERSHIP_CREATE_FAILED");
      }
      return { tenant: { ...tenant, activeSeatCount: 1 }, admin };
    });
  }

  async update(id: string, input: UpdateTenantInput): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const currentResult = await client.query<TenantRow>(
        `SELECT "id", "name", "slug", "plan", "licenseStartsAt", "licenseEndsAt", "institutionType", "contactEmail", "logoUrl", "seatLimit", 0::int AS "activeSeatCount", "status" FROM "Tenant"
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
             "institutionType" = $7,
             "contactEmail" = $8,
             "logoUrl" = $9,
             "seatLimit" = $10,
             "status" = $11,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING
           "id",
           "name",
           "slug",
           "plan",
           "licenseStartsAt",
           "licenseEndsAt",
           "institutionType",
           "contactEmail",
           "logoUrl",
           "seatLimit",
           (
             SELECT COUNT(DISTINCT "userId")::int
             FROM "TenantMembership"
             WHERE "tenantId" = "Tenant"."id"
           ) AS "activeSeatCount",
           "status"`,
        [
          id,
          next.name,
          next.slug,
          next.plan,
          next.licenseStartsAt ?? null,
          next.licenseEndsAt ?? null,
          next.institutionType ?? null,
          next.contactEmail ?? null,
          next.logoUrl ?? null,
          next.seatLimit ?? null,
          next.status,
        ],
      );
      return mapTenantRow(result.rows[0]!);
    });
  }

  async delete(id: string): Promise<TenantRecord | undefined> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const currentResult = await client.query<TenantRow>(
        `SELECT
           t."id",
           t."name",
           t."slug",
           t."plan",
           t."licenseStartsAt",
           t."licenseEndsAt",
           t."institutionType",
           t."contactEmail",
           t."logoUrl",
           t."seatLimit",
           COUNT(DISTINCT m."userId")::int AS "activeSeatCount",
           t."status"
         FROM "Tenant" t
         LEFT JOIN "TenantMembership" m ON m."tenantId" = t."id"
         WHERE t."id" = $1 AND t."id" <> 'system' AND t."status" <> 'DELETED'
         GROUP BY t."id", t."name", t."slug", t."plan", t."licenseStartsAt", t."licenseEndsAt", t."institutionType", t."contactEmail", t."logoUrl", t."seatLimit", t."status"
         LIMIT 1`,
        [id],
      );
      const current = currentResult.rows[0] ? mapTenantRow(currentResult.rows[0]) : undefined;
      if (!current) return undefined;
      await client.query(`DELETE FROM "Tenant" WHERE "id" = $1 AND "id" <> 'system'`, [id]);
      return { ...current, status: "DELETED" };
    });
  }
}

function tenantFirstAdminEmailAlreadyExists(): Error & { code: string } {
  return Object.assign(new Error("TENANT_FIRST_ADMIN_EMAIL_ALREADY_EXISTS"), {
    code: "TENANT_FIRST_ADMIN_EMAIL_ALREADY_EXISTS",
  });
}

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  licenseStartsAt: Date | string | null;
  licenseEndsAt: Date | string | null;
  institutionType: string | null;
  contactEmail: string | null;
  logoUrl: string | null;
  seatLimit: number | null;
  activeSeatCount?: number | string | null;
  status: string;
}

interface TenantAdminRow {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  roles: TenantUserRecord["roles"];
  createdAt: Date | string;
  updatedAt: Date | string;
}

export interface CreateTenantInput {
  id?: string;
  name: string;
  slug: string;
  plan?: string;
  licenseStartsAt?: string;
  licenseEndsAt?: string;
  institutionType?: string;
  contactEmail?: string;
  logoUrl?: string;
  seatLimit?: number;
  status?: string;
}

export interface CreateTenantFirstAdminInput {
  email: string;
  name: string;
  nationalId: string;
  phone: string;
}

export interface TenantCreateWithAdminResult {
  tenant: TenantRecord;
  admin: TenantUserRecord;
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
    institutionType: row.institutionType ?? undefined,
    contactEmail: row.contactEmail ?? undefined,
    logoUrl: row.logoUrl ?? undefined,
    seatLimit: row.seatLimit ?? undefined,
    activeSeatCount: optionalNumber(row.activeSeatCount),
    status: row.status,
  };
}

function optionalDateString(value: Date | string | null): string | undefined {
  if (!value) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function mapTenantAdminRow(row: TenantAdminRow): TenantUserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    tenantId: row.tenantId,
    roles: row.roles,
    createdAt: dateString(row.createdAt),
    updatedAt: dateString(row.updatedAt),
  };
}

function dateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function optionalNumber(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
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
