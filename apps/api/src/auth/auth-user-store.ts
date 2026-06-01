import { scryptSync, timingSafeEqual } from "node:crypto";
import pg from "pg";

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  tenantId: string;
  roles: string[];
  membershipVersion: number;
  purgedAt?: string;
}

export interface AuthUserStore {
  findByEmail(email: string): Promise<AuthUser | undefined>;
  findById(id: string): Promise<AuthUser | undefined>;
  updatePassword(id: string, passwordHash: string): Promise<AuthUser | undefined>;
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
  },
  {
    id: "user-tenant-b",
    email: "admin-b@example.test",
    name: "Tenant B Admin",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-b",
    roles: ["TENANT_ADMIN"],
    membershipVersion: 1,
  },
  {
    id: "teacher-tenant-a",
    email: "teacher-a@example.test",
    name: "Teacher A",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["TEACHER"],
    membershipVersion: 1,
  },
  {
    id: "student-tenant-a",
    email: "student-a@example.test",
    name: "Student A",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["STUDENT"],
    membershipVersion: 1,
  },
  {
    id: "guardian-tenant-a",
    email: "guardian-a@example.test",
    name: "Guardian A",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["GUARDIAN"],
    membershipVersion: 1,
  },
  {
    id: "user-system",
    email: "system@example.test",
    name: "System Admin",
    passwordHash: hashPassword("password"),
    tenantId: "system",
    roles: ["SYSTEM_ADMIN"],
    membershipVersion: 1,
  },
  {
    id: "user-privacy",
    email: "privacy@example.test",
    name: "Privacy User",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    membershipVersion: 1,
  },
  {
    id: "user-finance-privacy",
    email: "finance-privacy@example.test",
    name: "Finance Privacy User",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    membershipVersion: 1,
  },
];

export class InMemoryAuthUserStore implements AuthUserStore {
  private readonly users = demoUsers.map((user) => ({ ...user, roles: [...user.roles] }));

  async findByEmail(email: string): Promise<AuthUser | undefined> {
    return cloneUser(this.users.find((candidate) => candidate.email === email));
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

  async purgePii(id: string, input: { email: string; name: string; purgedAt: string }): Promise<AuthUser | undefined> {
    const user = this.users.find((candidate) => candidate.id === id);
    if (!user) return undefined;

    user.email = input.email;
    user.name = input.name;
    user.passwordHash = "";
    user.membershipVersion += 1;
    user.purgedAt = input.purgedAt;
    return cloneUser(user);
  }
}

export class PostgresAuthUserStore implements AuthUserStore {
  constructor(private readonly pool: pg.Pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async findByEmail(email: string): Promise<AuthUser | undefined> {
    const result = await this.queryAuthUsers(
      `WHERE lower(u."email") = lower($1)
       GROUP BY u."id", u."email", u."name", u."passwordHash", m."tenantId"
       ORDER BY min(m."createdAt") ASC
       LIMIT 1`,
      [email],
    );
    return result[0];
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    const result = await this.queryAuthUsers(
      `WHERE u."id" = $1
       GROUP BY u."id", u."email", u."name", u."passwordHash", m."tenantId"
       ORDER BY min(m."createdAt") ASC
       LIMIT 1`,
      [id],
    );
    return result[0];
  }

  async purgePii(id: string, input: { email: string; name: string; purgedAt: string }): Promise<AuthUser | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
      const update = await client.query(
        `UPDATE "User"
         SET "email" = $2, "name" = $3, "passwordHash" = '', "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id"`,
        [id, input.email, input.name],
      );
      await client.query("COMMIT");
      return update.rows[0] ? this.findById(id) : undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async updatePassword(id: string, passwordHash: string): Promise<AuthUser | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
      const update = await client.query(
        `UPDATE "User"
         SET "passwordHash" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id"`,
        [id, passwordHash],
      );
      await client.query("COMMIT");
      return update.rows[0] ? this.findById(id) : undefined;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async queryAuthUsers(whereSql: string, values: unknown[]): Promise<AuthUser[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
      const result = await client.query<AuthUserRow>(
        `SELECT
           u."id",
           u."email",
           u."name",
           u."passwordHash",
           m."tenantId",
           array_agg(m."role"::text ORDER BY m."role"::text) AS roles
         FROM "User" u
         JOIN "TenantMembership" m ON m."userId" = u."id"
         ${whereSql}`,
        values,
      );
      await client.query("COMMIT");
      return result.rows.map(toAuthUser);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

export function createAuthUserStore(): AuthUserStore {
  return process.env.AUTH_USER_STORE === "postgres" ? new PostgresAuthUserStore() : new InMemoryAuthUserStore();
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
  };
}

function cloneUser(user: AuthUser | undefined): AuthUser | undefined {
  return user ? { ...user, roles: [...user.roles] } : undefined;
}
