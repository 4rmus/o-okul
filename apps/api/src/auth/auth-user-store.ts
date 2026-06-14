import { scryptSync, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withBypassRlsQuery } from "../db/tenant-query.js";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  tenantId: string;
  roles: string[];
  membershipVersion: number;
  purgedAt?: string;
  totpSecretEncrypted?: string;
  totpEnabledAt?: string;
  totpRecoveryCodeHashes?: string[];
  totpLastUsedCounter?: string;
}

export interface AuthUserStore {
  findByEmail(email: string): Promise<AuthUser | undefined>;
  findById(id: string): Promise<AuthUser | undefined>;
  updatePassword(id: string, passwordHash: string): Promise<AuthUser | undefined>;
  enableTotp(input: {
    userId: string;
    secretEncrypted: string;
    enabledAt: string;
    recoveryCodeHashes: string[];
    lastUsedCounter?: string;
  }): Promise<AuthUser | undefined>;
  disableTotp(userId: string): Promise<AuthUser | undefined>;
  markTotpCounterUsed(userId: string, counter: string): Promise<boolean>;
  consumeTotpRecoveryCode(userId: string, codeHash: string): Promise<boolean>;
  purgePii(id: string, input: { email: string; name: string; purgedAt: string }): Promise<AuthUser | undefined>;
}

export const authUserStoreToken = Symbol("AuthUserStore");

const demoUsers: AuthUser[] = [
  {
    id: "user-tenant-a",
    email: "admin-a@example.test",
    name: "Tenant A Admin",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
  {
    id: "user-tenant-b",
    email: "admin-b@example.test",
    name: "Tenant B Admin",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-b",
    roles: ["TENANT_ADMIN"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
  {
    id: "assistant-tenant-a",
    email: "assistant-a@example.test",
    name: "Assistant Admin A",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["ASSISTANT_ADMIN"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
  {
    id: "teacher-tenant-a",
    email: "teacher-a@example.test",
    name: "Teacher A",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["TEACHER"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
  {
    id: "student-tenant-a",
    email: "student-a@example.test",
    name: "Student A",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["STUDENT"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
  {
    id: "guardian-tenant-a",
    email: "guardian-a@example.test",
    name: "Guardian A",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["GUARDIAN"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
  {
    id: "user-system",
    email: "system@example.test",
    name: "System Admin",
    passwordHash: hashPassword("password"),
    tenantId: "system",
    roles: ["SYSTEM_ADMIN"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
  {
    id: "user-expired-tenant",
    email: "expired-tenant@example.test",
    name: "Expired Tenant User",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-expired",
    roles: ["TENANT_ADMIN"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
  {
    id: "user-privacy",
    email: "privacy@example.test",
    name: "Privacy User",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
  {
    id: "user-finance-privacy",
    email: "finance-privacy@example.test",
    name: "Finance Privacy User",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
];

const inMemoryUsers = demoUsers.map((user) => ({ ...user, roles: [...user.roles] }));

export function upsertInMemoryAuthUser(input: {
  id: string;
  email: string;
  name: string;
  password?: string;
  passwordHash?: string;
  tenantId: string;
  roles: string[];
  totpSecretEncrypted?: string;
  totpEnabledAt?: string;
  totpRecoveryCodeHashes?: string[];
  totpLastUsedCounter?: string;
}): AuthUser {
  const email = input.email.toLowerCase();
  const existing = inMemoryUsers.find((candidate) => candidate.email.toLowerCase() === email);
  if (existing) {
    existing.name = input.name;
    existing.tenantId = input.tenantId;
    existing.roles = [...input.roles];
    existing.membershipVersion += 1;
    existing.totpSecretEncrypted = input.totpSecretEncrypted;
    existing.totpEnabledAt = input.totpEnabledAt;
    existing.totpRecoveryCodeHashes = [...(input.totpRecoveryCodeHashes ?? existing.totpRecoveryCodeHashes ?? [])];
    existing.totpLastUsedCounter = input.totpLastUsedCounter;
    if (input.password !== undefined || input.passwordHash !== undefined) {
      existing.passwordHash = input.passwordHash ?? hashPassword(input.password ?? "");
    }
    return cloneRequiredUser(existing);
  }

  const user: AuthUser = {
    id: input.id,
    email,
    name: input.name,
    passwordHash: input.passwordHash ?? (input.password === undefined ? "" : hashPassword(input.password)),
    tenantId: input.tenantId,
    roles: [...input.roles],
    membershipVersion: 1,
    totpSecretEncrypted: input.totpSecretEncrypted,
    totpEnabledAt: input.totpEnabledAt,
    totpRecoveryCodeHashes: [...(input.totpRecoveryCodeHashes ?? [])],
    totpLastUsedCounter: input.totpLastUsedCounter,
  };
  inMemoryUsers.push(user);
  return cloneRequiredUser(user);
}

export class InMemoryAuthUserStore implements AuthUserStore {
  private readonly users = inMemoryUsers;

  async findByEmail(email: string): Promise<AuthUser | undefined> {
    const normalizedEmail = email.toLowerCase();
    return cloneUser(this.users.find((candidate) => candidate.email.toLowerCase() === normalizedEmail));
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    return cloneUser(this.users.find((candidate) => candidate.id === id));
  }

  async updatePassword(id: string, passwordHash: string): Promise<AuthUser | undefined> {
    const user = this.users.find((candidate) => candidate.id === id);
    if (!user) return undefined;

    user.passwordHash = passwordHash;
    user.membershipVersion += 1;
    return cloneUser(user);
  }

  async enableTotp(input: {
    userId: string;
    secretEncrypted: string;
    enabledAt: string;
    recoveryCodeHashes: string[];
    lastUsedCounter?: string;
  }): Promise<AuthUser | undefined> {
    const user = this.users.find((candidate) => candidate.id === input.userId);
    if (!user) return undefined;

    user.totpSecretEncrypted = input.secretEncrypted;
    user.totpEnabledAt = input.enabledAt;
    user.totpRecoveryCodeHashes = [...input.recoveryCodeHashes];
    user.totpLastUsedCounter = input.lastUsedCounter;
    user.membershipVersion += 1;
    return cloneUser(user);
  }

  async disableTotp(userId: string): Promise<AuthUser | undefined> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user) return undefined;

    user.totpSecretEncrypted = undefined;
    user.totpEnabledAt = undefined;
    user.totpRecoveryCodeHashes = [];
    user.totpLastUsedCounter = undefined;
    user.membershipVersion += 1;
    return cloneUser(user);
  }

  async markTotpCounterUsed(userId: string, counter: string): Promise<boolean> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user || user.totpLastUsedCounter === counter) return false;

    user.totpLastUsedCounter = counter;
    return true;
  }

  async consumeTotpRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (!user?.totpRecoveryCodeHashes?.includes(codeHash)) return false;

    user.totpRecoveryCodeHashes = user.totpRecoveryCodeHashes.filter((hash) => hash !== codeHash);
    return true;
  }

  async purgePii(id: string, input: { email: string; name: string; purgedAt: string }): Promise<AuthUser | undefined> {
    const user = this.users.find((candidate) => candidate.id === id);
    if (!user) return undefined;

    user.email = input.email;
    user.name = input.name;
    user.passwordHash = "";
    user.membershipVersion += 1;
    user.purgedAt = input.purgedAt;
    user.totpSecretEncrypted = undefined;
    user.totpEnabledAt = undefined;
    user.totpRecoveryCodeHashes = [];
    user.totpLastUsedCounter = undefined;
    return cloneUser(user);
  }
}

export class PostgresAuthUserStore implements AuthUserStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async findByEmail(email: string): Promise<AuthUser | undefined> {
    const result = await this.queryAuthUsers(
      `WHERE lower(u."email") = lower($1)
         AND t."status" = 'ACTIVE'
       GROUP BY u."id", u."email", u."name", u."passwordHash", u."totpSecretEncrypted",
                u."totpEnabledAt", u."totpRecoveryCodeHashes", u."totpLastUsedCounter", m."tenantId"
       ORDER BY min(m."createdAt") ASC
       LIMIT 1`,
      [email],
    );
    return result[0];
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    const result = await this.queryAuthUsers(
      `WHERE u."id" = $1
         AND t."status" = 'ACTIVE'
       GROUP BY u."id", u."email", u."name", u."passwordHash", u."totpSecretEncrypted",
                u."totpEnabledAt", u."totpRecoveryCodeHashes", u."totpLastUsedCounter", m."tenantId"
       ORDER BY min(m."createdAt") ASC
       LIMIT 1`,
      [id],
    );
    return result[0];
  }

  async purgePii(id: string, input: { email: string; name: string; purgedAt: string }): Promise<AuthUser | undefined> {
    const updated = await withBypassRlsQuery(this.pool, async (client) => {
      const update = await client.query(
        `UPDATE "User"
         SET "email" = $2,
             "name" = $3,
             "passwordHash" = '',
             "totpSecretEncrypted" = NULL,
             "totpEnabledAt" = NULL,
             "totpRecoveryCodeHashes" = ARRAY[]::TEXT[],
             "totpLastUsedCounter" = NULL,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id"`,
        [id, input.email, input.name],
      );
      return Boolean(update.rows[0]);
    });
    return updated ? this.findById(id) : undefined;
  }

  async enableTotp(input: {
    userId: string;
    secretEncrypted: string;
    enabledAt: string;
    recoveryCodeHashes: string[];
    lastUsedCounter?: string;
  }): Promise<AuthUser | undefined> {
    const updated = await withBypassRlsQuery(this.pool, async (client) => {
      const update = await client.query(
        `UPDATE "User"
         SET "totpSecretEncrypted" = $2,
             "totpEnabledAt" = $3::timestamptz,
             "totpRecoveryCodeHashes" = $4::text[],
             "totpLastUsedCounter" = $5,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id"`,
        [input.userId, input.secretEncrypted, input.enabledAt, input.recoveryCodeHashes, input.lastUsedCounter ?? null],
      );
      return Boolean(update.rows[0]);
    });
    return updated ? this.findById(input.userId) : undefined;
  }

  async disableTotp(userId: string): Promise<AuthUser | undefined> {
    const updated = await withBypassRlsQuery(this.pool, async (client) => {
      const update = await client.query(
        `UPDATE "User"
         SET "totpSecretEncrypted" = NULL,
             "totpEnabledAt" = NULL,
             "totpRecoveryCodeHashes" = ARRAY[]::TEXT[],
             "totpLastUsedCounter" = NULL,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id"`,
        [userId],
      );
      return Boolean(update.rows[0]);
    });
    return updated ? this.findById(userId) : undefined;
  }

  async markTotpCounterUsed(userId: string, counter: string): Promise<boolean> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const update = await client.query(
        `UPDATE "User"
         SET "totpLastUsedCounter" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
           AND "totpLastUsedCounter" IS DISTINCT FROM $2
         RETURNING "id"`,
        [userId, counter],
      );
      return Boolean(update.rows[0]);
    });
  }

  async consumeTotpRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const update = await client.query(
        `UPDATE "User"
         SET "totpRecoveryCodeHashes" = array_remove("totpRecoveryCodeHashes", $2),
             "updatedAt" = now()
         WHERE "id" = $1
           AND $2 = ANY("totpRecoveryCodeHashes")
         RETURNING "id"`,
        [userId, codeHash],
      );
      return Boolean(update.rows[0]);
    });
  }

  async updatePassword(id: string, passwordHash: string): Promise<AuthUser | undefined> {
    const updated = await withBypassRlsQuery(this.pool, async (client) => {
      const update = await client.query(
        `UPDATE "User"
         SET "passwordHash" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id"`,
        [id, passwordHash],
      );
      return Boolean(update.rows[0]);
    });
    return updated ? this.findById(id) : undefined;
  }

  private async queryAuthUsers(whereSql: string, values: unknown[]): Promise<AuthUser[]> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<AuthUserRow>(
        `SELECT
           u."id",
           u."email",
           u."name",
           u."passwordHash",
           u."totpSecretEncrypted",
           u."totpEnabledAt",
           u."totpRecoveryCodeHashes",
           u."totpLastUsedCounter",
           m."tenantId",
           array_agg(m."role"::text ORDER BY m."role"::text) AS roles
         FROM "User" u
         JOIN "TenantMembership" m ON m."userId" = u."id"
         JOIN "Tenant" t ON t."id" = m."tenantId"
         ${whereSql}`,
        values,
      );
      return result.rows.map(toAuthUser);
    });
  }
}

export function createAuthUserStore(): AuthUserStore {
  return resolvePersistenceDriver(process.env.AUTH_USER_STORE) === "postgres" ? new PostgresAuthUserStore() : new InMemoryAuthUserStore();
}

export function hashPassword(password: string, salt = "demo-auth-salt"): string {
  return `scrypt:${salt}:${scryptSync(password, salt, 32).toString("base64url")}`;
}

export function verifyPassword(password: string, passwordHash: string): boolean {
  const [scheme, salt, expected] = passwordHash.split(":");
  if (scheme !== "scrypt" || !salt || !expected) {
    return false;
  }

  const actualBuffer = scryptSync(password, salt, 32);
  const expectedBuffer = Buffer.from(expected, "base64url");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

interface AuthUserRow {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  totpSecretEncrypted: string | null;
  totpEnabledAt: Date | string | null;
  totpRecoveryCodeHashes: string[] | null;
  totpLastUsedCounter: string | null;
  tenantId: string;
  roles: string[];
}

function toAuthUser(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    passwordHash: row.passwordHash,
    tenantId: row.tenantId,
    roles: row.roles,
    membershipVersion: 1,
    totpSecretEncrypted: row.totpSecretEncrypted ?? undefined,
    totpEnabledAt: row.totpEnabledAt ? new Date(row.totpEnabledAt).toISOString() : undefined,
    totpRecoveryCodeHashes: [...(row.totpRecoveryCodeHashes ?? [])],
    totpLastUsedCounter: row.totpLastUsedCounter ?? undefined,
  };
}

function cloneRequiredUser(user: AuthUser): AuthUser {
  return { ...user, roles: [...user.roles], totpRecoveryCodeHashes: [...(user.totpRecoveryCodeHashes ?? [])] };
}

function cloneUser(user: AuthUser | undefined): AuthUser | undefined {
  return user ? cloneRequiredUser(user) : undefined;
}
