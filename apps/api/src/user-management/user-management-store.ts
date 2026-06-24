import { randomUUID } from "node:crypto";
import pg from "pg";
import type { TenantAssignableRoleName } from "@o-okul/shared-types";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery } from "../db/tenant-query.js";
import { hashPassword } from "../auth/auth-user-store.js";
import { assertTenantSeatCapacity } from "../tenant/tenant-seat-limit.js";

export type TenantUserRole = TenantAssignableRoleName;

export interface TenantUserRecord {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  roles: TenantUserRole[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateTenantUserInput {
  tenantId: string;
  email: string;
  name: string;
  password: string;
  roles: TenantUserRole[];
}

export interface UserManagementStore {
  listTenantUsers(tenantId: string): Promise<TenantUserRecord[]>;
  findTenantUser(tenantId: string, userId: string): Promise<TenantUserRecord | undefined>;
  createOrAttachTenantUser(input: CreateTenantUserInput): Promise<TenantUserRecord>;
  setTenantRoles(tenantId: string, userId: string, roles: TenantUserRole[]): Promise<TenantUserRecord | undefined>;
}

export const userManagementStoreToken = Symbol("UserManagementStore");

const demoUsers: TenantUserRecord[] = [
  {
    id: "user-tenant-a",
    email: "admin-a@example.test",
    name: "Tenant A Admin",
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "teacher-tenant-a",
    email: "teacher-a@example.test",
    name: "Teacher A",
    tenantId: "tenant-a",
    roles: ["TEACHER"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "student-tenant-a",
    email: "student-a@example.test",
    name: "Student A",
    tenantId: "tenant-a",
    roles: ["STUDENT"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "guardian-tenant-a",
    email: "guardian-a@example.test",
    name: "Guardian A",
    tenantId: "tenant-a",
    roles: ["GUARDIAN"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
  {
    id: "user-tenant-b",
    email: "admin-b@example.test",
    name: "Tenant B Admin",
    tenantId: "tenant-b",
    roles: ["TENANT_ADMIN"],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
  },
];

export class InMemoryUserManagementStore implements UserManagementStore {
  private readonly users = demoUsers.map((user) => ({ ...user, roles: [...user.roles] }));

  async listTenantUsers(tenantId: string): Promise<TenantUserRecord[]> {
    return this.users.filter((user) => user.tenantId === tenantId).map(cloneRequiredTenantUser);
  }

  async findTenantUser(tenantId: string, userId: string): Promise<TenantUserRecord | undefined> {
    return cloneTenantUser(this.users.find((user) => user.tenantId === tenantId && user.id === userId));
  }

  async createOrAttachTenantUser(input: CreateTenantUserInput): Promise<TenantUserRecord> {
    const existing = this.users.find((user) => user.tenantId === input.tenantId && user.email === input.email);
    if (existing) {
      existing.name = input.name;
      existing.roles = [...input.roles];
      existing.updatedAt = new Date().toISOString();
      return cloneRequiredTenantUser(existing);
    }

    const now = new Date().toISOString();
    const record: TenantUserRecord = {
      id: `user-${this.users.length + 1}`,
      email: input.email,
      name: input.name,
      tenantId: input.tenantId,
      roles: [...input.roles],
      createdAt: now,
      updatedAt: now,
    };
    this.users.push(record);
    return cloneRequiredTenantUser(record);
  }

  async setTenantRoles(tenantId: string, userId: string, roles: TenantUserRole[]): Promise<TenantUserRecord | undefined> {
    const user = this.users.find((candidate) => candidate.tenantId === tenantId && candidate.id === userId);
    if (!user) return undefined;

    user.roles = [...roles];
    user.updatedAt = new Date().toISOString();
    return cloneTenantUser(user);
  }
}

export class PostgresUserManagementStore implements UserManagementStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async listTenantUsers(tenantId: string): Promise<TenantUserRecord[]> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<TenantUserRow>(
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
         WHERE m."tenantId" = $1
         GROUP BY u."id", u."email", u."name", m."tenantId"
         ORDER BY lower(u."email") ASC`,
        [tenantId],
      );
      return result.rows.map(toTenantUserRecord);
    });
  }

  async findTenantUser(tenantId: string, userId: string): Promise<TenantUserRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<TenantUserRow>(
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
        [tenantId, userId],
      );
      return result.rows[0] ? toTenantUserRecord(result.rows[0]) : undefined;
    });
  }

  async createOrAttachTenantUser(input: CreateTenantUserInput): Promise<TenantUserRecord> {
    return withExplicitTenantQuery(this.pool, input.tenantId, async (client) => {
      const normalizedEmail = input.email.toLowerCase();
      const created = await client.query<{ id: string }>(
        `INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt")
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT ("email") DO NOTHING
         RETURNING "id"`,
        [randomUUID(), normalizedEmail, input.name, hashPassword(input.password, randomUUID())],
      );
      const userId =
        created.rows[0]?.id ??
        (
          await client.query<{ id: string }>(`SELECT "id" FROM "User" WHERE lower("email") = lower($1) LIMIT 1`, [
            normalizedEmail,
          ])
        ).rows[0]?.id;
      if (!userId) {
        throw new Error("USER_CREATE_FAILED");
      }

      await this.replaceMemberships(client, input.tenantId, userId, input.roles);
      const record = await this.findTenantUserWithClient(client, input.tenantId, userId);
      if (!record) {
        throw new Error("USER_MEMBERSHIP_CREATE_FAILED");
      }
      return record;
    });
  }

  async setTenantRoles(tenantId: string, userId: string, roles: TenantUserRole[]): Promise<TenantUserRecord | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const existing = await client.query<{ id: string }>(
        `SELECT "id" FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = $2 LIMIT 1`,
        [tenantId, userId],
      );
      if (!existing.rows[0]) return undefined;

      await this.replaceMemberships(client, tenantId, userId, roles);
      return this.findTenantUserWithClient(client, tenantId, userId);
    });
  }

  private async findTenantUserWithClient(
    client: Queryable,
    tenantId: string,
    userId: string,
  ): Promise<TenantUserRecord | undefined> {
    const result = await client.query<TenantUserRow>(
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
      [tenantId, userId],
    );
    return result.rows[0] ? toTenantUserRecord(result.rows[0]) : undefined;
  }

  private async replaceMemberships(client: Queryable, tenantId: string, userId: string, roles: TenantUserRole[]): Promise<void> {
    const existing = await client.query<{ id: string }>(
      `SELECT "id" FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = $2 LIMIT 1`,
      [tenantId, userId],
    );
    if (!existing.rows[0]) {
      await this.assertTenantSeatAvailableForNewMembership(client, tenantId);
    }

    await client.query(`DELETE FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = $2`, [tenantId, userId]);
    for (const role of roles) {
      await client.query(
        `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
         VALUES ($1, $2, $3, $4, now())`,
        [randomUUID(), tenantId, userId, role],
      );
    }
  }

  private async assertTenantSeatAvailableForNewMembership(client: Queryable, tenantId: string): Promise<void> {
    const tenant = await client.query<{ seatLimit: number | null }>(
      `SELECT "seatLimit" FROM "Tenant" WHERE "id" = $1 FOR UPDATE`,
      [tenantId],
    );
    const seatLimit = tenant.rows[0]?.seatLimit;
    if (seatLimit === undefined || seatLimit === null) return;

    const usage = await client.query<{ activeSeatCount: number | string | null }>(
      `SELECT COUNT(DISTINCT "userId")::int AS "activeSeatCount" FROM "TenantMembership" WHERE "tenantId" = $1`,
      [tenantId],
    );
    assertTenantSeatCapacity({
      seatLimit,
      activeSeatCount: optionalNumber(usage.rows[0]?.activeSeatCount),
    });
  }
}

export function createUserManagementStore(): UserManagementStore {
  return resolvePersistenceDriver(process.env.USER_MANAGEMENT_STORE ?? process.env.AUTH_USER_STORE) === "postgres"
    ? new PostgresUserManagementStore()
    : new InMemoryUserManagementStore();
}

interface TenantUserRow {
  id: string;
  email: string;
  name: string;
  tenantId: string;
  roles: TenantUserRole[];
  createdAt: Date;
  updatedAt: Date;
}

function toTenantUserRecord(row: TenantUserRow): TenantUserRecord {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    tenantId: row.tenantId,
    roles: row.roles,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function cloneTenantUser(user: TenantUserRecord | undefined): TenantUserRecord | undefined {
  return user ? { ...user, roles: [...user.roles] } : undefined;
}

function cloneRequiredTenantUser(user: TenantUserRecord): TenantUserRecord {
  return { ...user, roles: [...user.roles] };
}

function optionalNumber(value: number | string | null | undefined): number | undefined {
  if (value === undefined || value === null) return undefined;
  return typeof value === "number" ? value : Number(value);
}
