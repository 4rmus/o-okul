import { randomUUID } from "node:crypto";
import pg from "pg";
import type { TenantAssignableRoleName } from "@o-okul/shared-types";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withExplicitTenantQuery } from "../db/tenant-query.js";
import { hashPassword, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { assertTenantSeatCapacity } from "../tenant/tenant-seat-limit.js";

export type TenantUserRole = TenantAssignableRoleName;

export interface TenantUserRecord {
  id: string;
  email?: string;
  name: string;
  tenantId: string;
  roles: TenantUserRole[];
  createdAt: string;
  updatedAt: string;
}

export interface TenantUserPasswordResetTarget {
  userId: string;
  phone?: string;
  subjectType?: "STUDENT" | "TEACHER" | "GUARDIAN";
}

export interface CreateTenantUserInput {
  tenantId: string;
  email: string;
  name: string;
  nationalIdEncrypted: string;
  nationalIdHash: string;
  password: string;
  roles: TenantUserRole[];
}

export interface UserManagementStore {
  listTenantUsers(tenantId: string): Promise<TenantUserRecord[]>;
  findTenantUser(tenantId: string, userId: string): Promise<TenantUserRecord | undefined>;
  findTenantUserPasswordResetTarget(tenantId: string, userId: string): Promise<TenantUserPasswordResetTarget | undefined>;
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

const demoPasswordResetTargets: Record<string, TenantUserPasswordResetTarget> = {
  "teacher-tenant-a": { userId: "teacher-tenant-a", phone: "5550000010", subjectType: "TEACHER" },
  "student-tenant-a": { userId: "student-tenant-a", phone: "5550000001", subjectType: "STUDENT" },
  "guardian-tenant-a": { userId: "guardian-tenant-a", phone: "5000000001", subjectType: "GUARDIAN" },
};

export class InMemoryUserManagementStore implements UserManagementStore {
  private readonly users = demoUsers.map((user) => ({ ...user, roles: [...user.roles] }));

  async listTenantUsers(tenantId: string): Promise<TenantUserRecord[]> {
    return this.users.filter((user) => user.tenantId === tenantId).map(cloneRequiredTenantUser);
  }

  async findTenantUser(tenantId: string, userId: string): Promise<TenantUserRecord | undefined> {
    return cloneTenantUser(this.users.find((user) => user.tenantId === tenantId && user.id === userId));
  }

  async findTenantUserPasswordResetTarget(tenantId: string, userId: string): Promise<TenantUserPasswordResetTarget | undefined> {
    const user = this.users.find((candidate) => candidate.tenantId === tenantId && candidate.id === userId);
    if (!user) return undefined;
    const target = demoPasswordResetTargets[userId];
    return target ? { ...target } : { userId };
  }

  async createOrAttachTenantUser(input: CreateTenantUserInput): Promise<TenantUserRecord> {
    const existing = this.users.find((user) => user.tenantId === input.tenantId && user.email === input.email);
    if (existing) {
      existing.name = input.name;
      existing.roles = [...input.roles];
      existing.updatedAt = new Date().toISOString();
      upsertInMemoryAuthUser({
        id: existing.id,
        email: existing.email,
        name: existing.name,
        nationalIdHash: input.nationalIdHash,
        password: input.password,
        tenantId: existing.tenantId,
        roles: existing.roles,
      });
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
    upsertInMemoryAuthUser({
      id: record.id,
      email: record.email,
      name: record.name,
      nationalIdHash: input.nationalIdHash,
      password: input.password,
      tenantId: record.tenantId,
      roles: record.roles,
    });
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
         ORDER BY lower(coalesce(u."email", u."name")) ASC`,
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

  async findTenantUserPasswordResetTarget(tenantId: string, userId: string): Promise<TenantUserPasswordResetTarget | undefined> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const result = await client.query<TenantUserPasswordResetTargetRow>(
        `SELECT
           u."id" AS "userId",
           COALESCE(s."phone", t."phone", g."phone") AS "phone",
           CASE
             WHEN s."id" IS NOT NULL THEN 'STUDENT'
             WHEN t."id" IS NOT NULL THEN 'TEACHER'
             WHEN g."id" IS NOT NULL THEN 'GUARDIAN'
             ELSE NULL
           END AS "subjectType"
         FROM "TenantMembership" m
         JOIN "User" u ON u."id" = m."userId"
         LEFT JOIN "Student" s ON s."tenantId" = m."tenantId" AND s."userId" = u."id" AND s."deletedAt" IS NULL
         LEFT JOIN "Teacher" t ON t."tenantId" = m."tenantId" AND t."userId" = u."id" AND t."deletedAt" IS NULL
         LEFT JOIN "Guardian" g ON g."tenantId" = m."tenantId" AND g."userId" = u."id" AND g."deletedAt" IS NULL
         WHERE m."tenantId" = $1 AND u."id" = $2
         LIMIT 1`,
        [tenantId, userId],
      );
      return result.rows[0] ? toTenantUserPasswordResetTarget(result.rows[0]) : undefined;
    });
  }

  async createOrAttachTenantUser(input: CreateTenantUserInput): Promise<TenantUserRecord> {
    return withExplicitTenantQuery(this.pool, input.tenantId, async (client) => {
      const normalizedEmail = input.email.toLowerCase();
      const passwordHash = hashPassword(input.password, randomUUID());
      const existingByEmail = await client.query<{ id: string }>(`SELECT "id" FROM "User" WHERE lower("email") = lower($1) LIMIT 1`, [
        normalizedEmail,
      ]);
      let userId = existingByEmail.rows[0]?.id;
      if (!userId) {
        const created = await client.query<{ id: string }>(
          `INSERT INTO "User" ("id", "tenantId", "email", "nationalIdEncrypted", "nationalIdHash", "name", "passwordHash", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, now())
           ON CONFLICT ("tenantId", "nationalIdHash") DO UPDATE
           SET "email" = EXCLUDED."email",
               "nationalIdEncrypted" = EXCLUDED."nationalIdEncrypted",
               "name" = EXCLUDED."name",
               "passwordHash" = EXCLUDED."passwordHash",
               "updatedAt" = now()
           RETURNING "id"`,
          [randomUUID(), input.tenantId, normalizedEmail, input.nationalIdEncrypted, input.nationalIdHash, input.name, passwordHash],
        );
        userId = created.rows[0]?.id;
      }
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
  email: string | null;
  name: string;
  tenantId: string;
  roles: TenantUserRole[];
  createdAt: Date;
  updatedAt: Date;
}

interface TenantUserPasswordResetTargetRow {
  userId: string;
  phone: string | null;
  subjectType: "STUDENT" | "TEACHER" | "GUARDIAN" | null;
}

function toTenantUserRecord(row: TenantUserRow): TenantUserRecord {
  return {
    id: row.id,
    email: row.email ?? undefined,
    name: row.name,
    tenantId: row.tenantId,
    roles: row.roles,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTenantUserPasswordResetTarget(row: TenantUserPasswordResetTargetRow): TenantUserPasswordResetTarget {
  return {
    userId: row.userId,
    phone: row.phone ?? undefined,
    subjectType: row.subjectType ?? undefined,
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
