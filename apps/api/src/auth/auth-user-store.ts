import { randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withBypassRlsQuery } from "../db/tenant-query.js";
import { hashTcIdentity } from "../student/tc-identity.js";

export interface AuthUser {
  id: string;
  tenantId: string;
  email?: string;
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
  name: string;
  passwordHash: string;
  roles: string[];
  membershipVersion: number;
  mustChangePassword?: boolean;
  passwordChangedAt?: string;
  purgedAt?: string;
  totpSecretEncrypted?: string;
  totpEnabledAt?: string;
  totpRecoveryCodeHashes?: string[];
  totpLastUsedCounter?: string;
}

export interface AuthUserStore {
  findByEmail(email: string): Promise<AuthUser | undefined>;
  findByTenantAndNationalIdHash(tenantId: string, nationalIdHash: string): Promise<AuthUser | undefined>;
  findByNationalIdHash(nationalIdHash: string): Promise<AuthUser[]>;
  findById(id: string): Promise<AuthUser | undefined>;
  listByTenant(tenantId: string): Promise<AuthUser[]>;
  createOrAttachTenantIdentity(input: CreateTenantIdentityUserInput): Promise<AuthUser>;
  updatePassword(id: string, passwordHash: string, input?: PasswordStateUpdate): Promise<AuthUser | undefined>;
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

export interface CreateTenantIdentityUserInput {
  tenantId: string;
  email?: string;
  nationalIdEncrypted: string;
  nationalIdHash: string;
  name: string;
  passwordHash: string;
  roles: string[];
  mustChangePassword: boolean;
}

export interface PasswordStateUpdate {
  mustChangePassword?: boolean;
  passwordChangedAt?: string;
}

export const authUserStoreToken = Symbol("AuthUserStore");

const demoNationalIdHashes = {
  adminA: hashTcIdentity("10000000146"),
  system: hashTcIdentity("10000000214"),
  assistantA: hashTcIdentity("10000000382"),
  adminB: hashTcIdentity("10000000832"),
  studentA: hashTcIdentity("10000000528"),
  teacherA: hashTcIdentity("10000000696"),
  guardianA: hashTcIdentity("10000000764"),
  expiredTenant: hashTcIdentity("10000000900"),
  privacy: hashTcIdentity("10000001068"),
  financePrivacy: hashTcIdentity("10000001136"),
};

const demoUsers: AuthUser[] = [
  {
    id: "user-tenant-a",
    email: "admin-a@example.test",
    nationalIdHash: demoNationalIdHashes.adminA,
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
    nationalIdHash: demoNationalIdHashes.adminB,
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
    nationalIdHash: demoNationalIdHashes.assistantA,
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
    nationalIdHash: demoNationalIdHashes.teacherA,
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
    nationalIdHash: demoNationalIdHashes.studentA,
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
    nationalIdHash: demoNationalIdHashes.guardianA,
    name: "Guardian A",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["GUARDIAN"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
  {
    id: "user-system",
    nationalIdHash: demoNationalIdHashes.system,
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
    nationalIdHash: demoNationalIdHashes.expiredTenant,
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
    nationalIdHash: demoNationalIdHashes.privacy,
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
    nationalIdHash: demoNationalIdHashes.financePrivacy,
    name: "Finance Privacy User",
    passwordHash: hashPassword("password"),
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    membershipVersion: 1,
    totpRecoveryCodeHashes: [],
  },
];

const inMemoryUsers = demoUsers.map((user) => ({ ...user, roles: [...user.roles] }));

export function resetInMemoryAuthUsers(): void {
  inMemoryUsers.splice(0, inMemoryUsers.length, ...demoUsers.map(cloneRequiredUser));
}

export function upsertInMemoryAuthUser(input: {
  id: string;
  email?: string;
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
  name: string;
  password?: string;
  passwordHash?: string;
  tenantId: string;
  roles: string[];
  mustChangePassword?: boolean;
  passwordChangedAt?: string;
  totpSecretEncrypted?: string;
  totpEnabledAt?: string;
  totpRecoveryCodeHashes?: string[];
  totpLastUsedCounter?: string;
}): AuthUser {
  const email = input.email?.toLowerCase();
  const existing = inMemoryUsers.find((candidate) => (
    (email && candidate.email?.toLowerCase() === email) ||
    (input.nationalIdHash && candidate.tenantId === input.tenantId && candidate.nationalIdHash === input.nationalIdHash)
  ));
  if (existing) {
    existing.email = email ?? existing.email;
    existing.nationalIdEncrypted = input.nationalIdEncrypted ?? existing.nationalIdEncrypted;
    existing.nationalIdHash = input.nationalIdHash ?? existing.nationalIdHash;
    existing.name = input.name;
    existing.tenantId = input.tenantId;
    existing.roles = [...input.roles];
    existing.membershipVersion += 1;
    existing.mustChangePassword = input.mustChangePassword ?? existing.mustChangePassword;
    existing.passwordChangedAt = input.passwordChangedAt ?? existing.passwordChangedAt;
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
    nationalIdEncrypted: input.nationalIdEncrypted,
    nationalIdHash: input.nationalIdHash,
    name: input.name,
    passwordHash: input.passwordHash ?? (input.password === undefined ? "" : hashPassword(input.password)),
    tenantId: input.tenantId,
    roles: [...input.roles],
    membershipVersion: 1,
    mustChangePassword: input.mustChangePassword,
    passwordChangedAt: input.passwordChangedAt,
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
    return cloneUser(this.users.find((candidate) => candidate.email?.toLowerCase() === normalizedEmail));
  }

  async findByTenantAndNationalIdHash(tenantId: string, nationalIdHash: string): Promise<AuthUser | undefined> {
    return cloneUser(this.users.find((candidate) => candidate.tenantId === tenantId && candidate.nationalIdHash === nationalIdHash));
  }

  async findByNationalIdHash(nationalIdHash: string): Promise<AuthUser[]> {
    return this.users
      .filter((candidate) => candidate.tenantId !== "system" && candidate.nationalIdHash === nationalIdHash)
      .map(cloneRequiredUser);
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    return cloneUser(this.users.find((candidate) => candidate.id === id));
  }

  async listByTenant(tenantId: string): Promise<AuthUser[]> {
    return this.users.filter((candidate) => candidate.tenantId === tenantId).map(cloneRequiredUser);
  }

  async createOrAttachTenantIdentity(input: CreateTenantIdentityUserInput): Promise<AuthUser> {
    return upsertInMemoryAuthUser({
      id: `user-${this.users.length + 1}`,
      tenantId: input.tenantId,
      email: input.email,
      nationalIdEncrypted: input.nationalIdEncrypted,
      nationalIdHash: input.nationalIdHash,
      name: input.name,
      passwordHash: input.passwordHash,
      roles: input.roles,
      mustChangePassword: input.mustChangePassword,
    });
  }

  async updatePassword(id: string, passwordHash: string, input: PasswordStateUpdate = {}): Promise<AuthUser | undefined> {
    const user = this.users.find((candidate) => candidate.id === id);
    if (!user) return undefined;

    user.passwordHash = passwordHash;
    user.mustChangePassword = input.mustChangePassword ?? user.mustChangePassword;
    user.passwordChangedAt = input.passwordChangedAt ?? user.passwordChangedAt;
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
    if (!user || user.totpSecretEncrypted || user.totpEnabledAt) return undefined;

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
       GROUP BY u."id", u."tenantId", u."email", u."nationalIdEncrypted", u."nationalIdHash", u."name", u."passwordHash",
                u."membershipVersion", u."mustChangePassword", u."passwordChangedAt", u."totpSecretEncrypted",
                u."totpEnabledAt", u."totpRecoveryCodeHashes", u."totpLastUsedCounter", m."tenantId"
       ORDER BY min(m."createdAt") ASC
       LIMIT 1`,
      [email],
    );
    return result[0];
  }

  async findByTenantAndNationalIdHash(tenantId: string, nationalIdHash: string): Promise<AuthUser | undefined> {
    const result = await this.queryAuthUsers(
      `WHERE u."tenantId" = $1
         AND u."nationalIdHash" = $2
         AND m."tenantId" = $1
         AND t."status" = 'ACTIVE'
       GROUP BY u."id", u."tenantId", u."email", u."nationalIdEncrypted", u."nationalIdHash", u."name", u."passwordHash",
                u."membershipVersion", u."mustChangePassword", u."passwordChangedAt", u."totpSecretEncrypted",
                u."totpEnabledAt", u."totpRecoveryCodeHashes", u."totpLastUsedCounter", m."tenantId"
       LIMIT 1`,
      [tenantId, nationalIdHash],
    );
    return result[0];
  }

  async findByNationalIdHash(nationalIdHash: string): Promise<AuthUser[]> {
    return this.queryAuthUsers(
      `WHERE u."tenantId" IS NOT NULL
         AND u."tenantId" <> 'system'
         AND u."nationalIdHash" = $1
         AND m."tenantId" = u."tenantId"
         AND t."status" = 'ACTIVE'
         AND (t."licenseEndsAt" IS NULL OR t."licenseEndsAt" >= now())
       GROUP BY u."id", u."tenantId", u."email", u."nationalIdEncrypted", u."nationalIdHash", u."name", u."passwordHash",
                u."membershipVersion", u."mustChangePassword", u."passwordChangedAt", u."totpSecretEncrypted",
                u."totpEnabledAt", u."totpRecoveryCodeHashes", u."totpLastUsedCounter", m."tenantId"
       ORDER BY min(t."createdAt") ASC
       LIMIT 20`,
      [nationalIdHash],
    );
  }

  async findById(id: string): Promise<AuthUser | undefined> {
    const result = await this.queryAuthUsers(
      `WHERE u."id" = $1
         AND t."status" = 'ACTIVE'
       GROUP BY u."id", u."tenantId", u."email", u."nationalIdEncrypted", u."nationalIdHash", u."name", u."passwordHash",
                u."membershipVersion", u."mustChangePassword", u."passwordChangedAt", u."totpSecretEncrypted",
                u."totpEnabledAt", u."totpRecoveryCodeHashes", u."totpLastUsedCounter", m."tenantId"
       ORDER BY min(m."createdAt") ASC
       LIMIT 1`,
      [id],
    );
    return result[0];
  }

  async listByTenant(tenantId: string): Promise<AuthUser[]> {
    return this.queryAuthUsers(
      `WHERE m."tenantId" = $1
         AND t."status" = 'ACTIVE'
       GROUP BY u."id", u."tenantId", u."email", u."nationalIdEncrypted", u."nationalIdHash", u."name", u."passwordHash",
                u."membershipVersion", u."mustChangePassword", u."passwordChangedAt", u."totpSecretEncrypted",
                u."totpEnabledAt", u."totpRecoveryCodeHashes", u."totpLastUsedCounter", m."tenantId"
       ORDER BY lower(u."name") ASC, u."id" ASC`,
      [tenantId],
    );
  }

  async purgePii(id: string, input: { email: string; name: string; purgedAt: string }): Promise<AuthUser | undefined> {
    const updated = await withBypassRlsQuery(this.pool, async (client) => {
      const update = await client.query(
        `UPDATE "User"
         SET "email" = $2,
             "name" = $3,
             "passwordHash" = '',
             "nationalIdEncrypted" = NULL,
             "nationalIdHash" = NULL,
             "mustChangePassword" = false,
             "totpSecretEncrypted" = NULL,
             "totpEnabledAt" = NULL,
             "totpRecoveryCodeHashes" = ARRAY[]::TEXT[],
             "totpLastUsedCounter" = NULL,
             "membershipVersion" = "membershipVersion" + 1,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id"`,
        [id, input.email, input.name],
      );
      return Boolean(update.rows[0]);
    });
    return updated ? this.findById(id) : undefined;
  }

  async createOrAttachTenantIdentity(input: CreateTenantIdentityUserInput): Promise<AuthUser> {
    const userId = await withBypassRlsQuery(this.pool, async (client) => {
      const created = await client.query<{ id: string }>(
        `INSERT INTO "User" (
           "id", "tenantId", "email", "nationalIdEncrypted", "nationalIdHash", "name",
           "passwordHash", "mustChangePassword", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
         ON CONFLICT ("tenantId", "nationalIdHash") DO UPDATE
         SET "name" = EXCLUDED."name",
             "email" = COALESCE("User"."email", EXCLUDED."email"),
             "updatedAt" = now()
         RETURNING "id"`,
        [
          randomUUID(),
          input.tenantId,
          input.email?.toLowerCase() ?? null,
          input.nationalIdEncrypted,
          input.nationalIdHash,
          input.name,
          input.passwordHash,
          input.mustChangePassword,
        ],
      );
      const id = created.rows[0]?.id;
      if (!id) throw new Error("USER_CREATE_FAILED");

      for (const role of input.roles) {
        await client.query(
          `INSERT INTO "TenantMembership" ("id", "tenantId", "userId", "role", "updatedAt")
           VALUES ($1, $2, $3, $4, now())
           ON CONFLICT ("tenantId", "userId", "role") DO NOTHING`,
          [randomUUID(), input.tenantId, id, role],
        );
      }
      return id;
    });
    const user = await this.findById(userId);
    if (!user) throw new Error("USER_CREATE_FAILED");
    return user;
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
             "membershipVersion" = "membershipVersion" + 1,
             "updatedAt" = now()
         WHERE "id" = $1
           AND "totpSecretEncrypted" IS NULL
           AND "totpEnabledAt" IS NULL
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
             "membershipVersion" = "membershipVersion" + 1,
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

  async updatePassword(id: string, passwordHash: string, input: PasswordStateUpdate = {}): Promise<AuthUser | undefined> {
    const updated = await withBypassRlsQuery(this.pool, async (client) => {
      const update = await client.query(
        `UPDATE "User"
         SET "passwordHash" = $2,
             "mustChangePassword" = COALESCE($3, "mustChangePassword"),
             "passwordChangedAt" = COALESCE($4::timestamptz, "passwordChangedAt"),
             "membershipVersion" = "membershipVersion" + 1,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id"`,
        [id, passwordHash, input.mustChangePassword ?? null, input.passwordChangedAt ?? null],
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
           u."tenantId",
           u."email",
           u."nationalIdEncrypted",
           u."nationalIdHash",
           u."name",
           u."passwordHash",
           u."membershipVersion",
           u."mustChangePassword",
           u."passwordChangedAt",
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
  tenantId: string | null;
  email: string | null;
  nationalIdEncrypted: string | null;
  nationalIdHash: string | null;
  name: string;
  passwordHash: string;
  membershipVersion: number;
  mustChangePassword: boolean;
  passwordChangedAt: Date | string | null;
  totpSecretEncrypted: string | null;
  totpEnabledAt: Date | string | null;
  totpRecoveryCodeHashes: string[] | null;
  totpLastUsedCounter: string | null;
  roles: string[];
}

function toAuthUser(row: AuthUserRow): AuthUser {
  return {
    id: row.id,
    email: row.email ?? undefined,
    nationalIdEncrypted: row.nationalIdEncrypted ?? undefined,
    nationalIdHash: row.nationalIdHash ?? undefined,
    name: row.name,
    passwordHash: row.passwordHash,
    tenantId: row.tenantId ?? "system",
    roles: row.roles,
    membershipVersion: row.membershipVersion,
    mustChangePassword: row.mustChangePassword,
    passwordChangedAt: row.passwordChangedAt ? new Date(row.passwordChangedAt).toISOString() : undefined,
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
