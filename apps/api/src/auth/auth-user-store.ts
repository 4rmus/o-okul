import { randomBytes, randomUUID, scrypt, scryptSync, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type Queryable, type TenantQueryable, withBypassRlsQuery, withExplicitTenantQuery } from "../db/tenant-query.js";
import { buildTenantMembershipDualWriteRows } from "../identity-provisioning/tenant-membership-dual-write.js";
import { hashTcIdentity } from "../student/tc-identity.js";
import {
  assertTenantMembershipParity,
  type CanonicalMembershipProjection,
  type CanonicalStaffRole,
} from "./tenant-membership-projection.js";
import type { PasswordResetTransaction } from "./password-reset-store.js";

export interface AuthUser {
  id: string;
  tenantId: string;
  email?: string;
  loginName?: string;
  phone?: string;
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
  name: string;
  passwordHash: string;
  roles: string[];
  membership?: CanonicalMembershipProjection;
  authorizationSource?: "CANONICAL_PARITY" | "LEGACY";
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
  findByTenantAndLoginName(tenantId: string, loginName: string): Promise<AuthUser | undefined>;
  findByTenantAndNationalIdHash(tenantId: string, nationalIdHash: string): Promise<AuthUser | undefined>;
  findByNationalIdHash(nationalIdHash: string): Promise<AuthUser[]>;
  findById(id: string): Promise<AuthUser | undefined>;
  listByTenant(tenantId: string): Promise<AuthUser[]>;
  createOrAttachTenantIdentity(input: CreateTenantIdentityUserInput): Promise<AuthUser>;
  updatePassword(id: string, passwordHash: string, input?: PasswordStateUpdate): Promise<AuthUser | undefined>;
  updatePasswordForReset(id: string, passwordHash: string, input: PasswordStateUpdate, transaction: PasswordResetTransaction): Promise<boolean>;
  rehashPassword(tenantId: string, id: string, currentPasswordHash: string, passwordHash: string): Promise<boolean>;
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
    email: "system@example.test",
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

export function removeInMemoryAuthUserRole(
  tenantId: string,
  userId: string,
  role: string,
): AuthUser | undefined {
  const user = inMemoryUsers.find((candidate) => candidate.tenantId === tenantId && candidate.id === userId);
  if (!user) return undefined;

  user.roles = user.roles.filter((candidate) => candidate !== role);
  user.membershipVersion += 1;
  return cloneRequiredUser(user);
}

export function upsertInMemoryAuthUser(input: {
  id: string;
  email?: string;
  loginName?: string;
  nationalIdEncrypted?: string;
  nationalIdHash?: string;
  name: string;
  password?: string;
  passwordHash?: string;
  tenantId: string;
  roles: string[];
  membership?: CanonicalMembershipProjection;
  mustChangePassword?: boolean;
  passwordChangedAt?: string;
  totpSecretEncrypted?: string;
  totpEnabledAt?: string;
  totpRecoveryCodeHashes?: string[];
  totpLastUsedCounter?: string;
}): AuthUser {
  const email = input.email?.toLowerCase();
  const loginName = input.loginName?.trim().toLowerCase();
  const existing = inMemoryUsers.find((candidate) => (
    (email && candidate.email?.toLowerCase() === email) ||
    (loginName && candidate.tenantId === input.tenantId && candidate.loginName?.toLowerCase() === loginName) ||
    (input.nationalIdHash && candidate.tenantId === input.tenantId && candidate.nationalIdHash === input.nationalIdHash)
  ));
  if (existing) {
    existing.email = email ?? existing.email;
    existing.loginName = loginName ?? existing.loginName;
    existing.nationalIdEncrypted = input.nationalIdEncrypted ?? existing.nationalIdEncrypted;
    existing.nationalIdHash = input.nationalIdHash ?? existing.nationalIdHash;
    existing.name = input.name;
    existing.tenantId = input.tenantId;
    existing.roles = [...input.roles];
    existing.membership = input.membership ? cloneCanonicalMembership(input.membership) : existing.membership;
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
    loginName,
    nationalIdEncrypted: input.nationalIdEncrypted,
    nationalIdHash: input.nationalIdHash,
    name: input.name,
    passwordHash: input.passwordHash ?? (input.password === undefined ? "" : hashPassword(input.password)),
    tenantId: input.tenantId,
    roles: [...input.roles],
    membership: input.membership ? cloneCanonicalMembership(input.membership) : undefined,
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

  async findByTenantAndLoginName(tenantId: string, loginName: string): Promise<AuthUser | undefined> {
    const normalizedLoginName = loginName.trim().toLowerCase();
    return cloneUser(this.users.find((candidate) => (
      candidate.tenantId === tenantId && (
        candidate.loginName?.trim().toLowerCase() === normalizedLoginName ||
        candidate.email?.trim().toLowerCase() === normalizedLoginName
      )
    )));
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

  async updatePasswordForReset(id: string, passwordHash: string, input: PasswordStateUpdate, transaction: PasswordResetTransaction): Promise<boolean> {
    const user = this.users.find((candidate) => candidate.id === id);
    if (!user || transaction.kind !== "memory") return false;

    transaction.stage(() => {
      user.passwordHash = passwordHash;
      user.mustChangePassword = input.mustChangePassword ?? user.mustChangePassword;
      user.passwordChangedAt = input.passwordChangedAt ?? user.passwordChangedAt;
      user.membershipVersion += 1;
    });
    return true;
  }

  async rehashPassword(tenantId: string, id: string, currentPasswordHash: string, passwordHash: string): Promise<boolean> {
    const user = this.users.find((candidate) => candidate.tenantId === tenantId && candidate.id === id && candidate.passwordHash === currentPasswordHash);
    if (!user) return false;
    user.passwordHash = passwordHash;
    return true;
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
    if (!user || !isNewerTotpCounter(counter, user.totpLastUsedCounter)) return false;

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

  async findByTenantAndLoginName(tenantId: string, loginName: string): Promise<AuthUser | undefined> {
    const result = await this.queryAuthUsers(
      `WHERE u."tenantId" = $1
         AND (
           u."loginNameNormalized" = lower(btrim($2))
           OR u."emailNormalized" = lower(btrim($2))
         )
         AND m."tenantId" = $1
         AND m."status" = 'ACTIVE'
         AND u."accountStatus" IN ('ACTIVE', 'PENDING_ACTIVATION')
         AND t."status" = 'ACTIVE'
       GROUP BY u."id", u."tenantId", u."email", u."nationalIdEncrypted", u."nationalIdHash", u."name", u."passwordHash",
                u."membershipVersion", u."mustChangePassword", u."passwordChangedAt", u."totpSecretEncrypted",
                u."totpEnabledAt", u."totpRecoveryCodeHashes", u."totpLastUsedCounter", m."tenantId"
       LIMIT 1`,
      [tenantId, loginName],
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
             "emailNormalized" = lower(btrim($2)),
             "loginName" = lower(btrim($2)),
             "loginNameNormalized" = lower(btrim($2)),
             "name" = $3,
             "passwordHash" = '',
             "passwordHashVersion" = 1,
             "accountStatus" = 'DISABLED',
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
      const normalizedEmail = input.email?.trim().toLowerCase() ?? null;
      const created = await client.query<{ id: string }>(
        `INSERT INTO "User" (
           "id", "tenantId", "email", "emailNormalized", "loginName", "loginNameNormalized",
           "nationalIdEncrypted", "nationalIdHash", "name", "passwordHash", "passwordHashVersion",
           "accountStatus", "mustChangePassword", "updatedAt"
         )
         VALUES ($1, $2, $3, $3, $3, $3, $4, $5, $6, $7, $8, $9, $10, now())
         ON CONFLICT ("tenantId", "nationalIdHash") DO UPDATE
         SET "name" = EXCLUDED."name",
             "email" = COALESCE("User"."email", EXCLUDED."email"),
             "emailNormalized" = COALESCE("User"."emailNormalized", EXCLUDED."emailNormalized"),
             "loginName" = COALESCE("User"."loginName", EXCLUDED."loginName"),
             "loginNameNormalized" = COALESCE("User"."loginNameNormalized", EXCLUDED."loginNameNormalized"),
             "updatedAt" = now()
         RETURNING "id"`,
        [
          randomUUID(),
          input.tenantId,
          normalizedEmail,
          input.nationalIdEncrypted,
          input.nationalIdHash,
          input.name,
          input.passwordHash,
          passwordHashVersionOf(input.passwordHash),
          input.mustChangePassword ? "PENDING_ACTIVATION" : "ACTIVE",
          input.mustChangePassword,
        ],
      );
      const id = created.rows[0]?.id;
      if (!id) throw new Error("USER_CREATE_FAILED");

      const existingMemberships = await client.query<{ role: string; version: number }>(
        `SELECT "role"::text AS role, "version"
         FROM "TenantMembership"
         WHERE "tenantId" = $1 AND "userId" = $2
         FOR UPDATE`,
        [input.tenantId, id],
      );
      const roles = [...new Set([...existingMemberships.rows.map((row) => row.role), ...input.roles])];
      const membershipVersion = existingMemberships.rows.length > 0
        ? Math.max(...existingMemberships.rows.map((row) => row.version)) + 1
        : 1;
      const memberships = buildTenantMembershipDualWriteRows(roles);
      await client.query(`DELETE FROM "TenantMembership" WHERE "tenantId" = $1 AND "userId" = $2`, [input.tenantId, id]);
      for (const membership of memberships) {
        await client.query(
          `INSERT INTO "TenantMembership" (
             "id", "tenantId", "userId", "role", "staffRole", "hasTeacherPersona", "hasStudentPersona",
             "status", "version", "scopeMode", "updatedAt"
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, 'TENANT', now())`,
          [
            randomUUID(),
            input.tenantId,
            id,
            membership.role,
            membership.staffRole,
            membership.hasTeacherPersona,
            membership.hasStudentPersona,
            membershipVersion,
          ],
        );
      }
      if (existingMemberships.rows.length > 0) {
        await client.query(
          `UPDATE "User"
           SET "membershipVersion" = "membershipVersion" + 1,
               "updatedAt" = now()
           WHERE "tenantId" = $1 AND "id" = $2`,
          [input.tenantId, id],
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
      const update = await client.query<{ id: string; membershipVersion: number; tenantId: string | null }>(
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
         RETURNING "id", "tenantId", "membershipVersion"`,
        [input.userId, input.secretEncrypted, input.enabledAt, input.recoveryCodeHashes, input.lastUsedCounter ?? null],
      );
      const user = update.rows[0];
      if (!user) return false;
      await syncActiveMembershipVersions(client, user);
      return true;
    });
    return updated ? this.findById(input.userId) : undefined;
  }

  async disableTotp(userId: string): Promise<AuthUser | undefined> {
    const updated = await withBypassRlsQuery(this.pool, async (client) => {
      const update = await client.query<{ id: string; membershipVersion: number; tenantId: string | null }>(
        `UPDATE "User"
         SET "totpSecretEncrypted" = NULL,
             "totpEnabledAt" = NULL,
             "totpRecoveryCodeHashes" = ARRAY[]::TEXT[],
             "totpLastUsedCounter" = NULL,
             "membershipVersion" = "membershipVersion" + 1,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id", "tenantId", "membershipVersion"`,
        [userId],
      );
      const user = update.rows[0];
      if (!user) return false;
      await syncActiveMembershipVersions(client, user);
      return true;
    });
    return updated ? this.findById(userId) : undefined;
  }

  async markTotpCounterUsed(userId: string, counter: string): Promise<boolean> {
    if (!isValidTotpCounter(counter)) return false;
    return withBypassRlsQuery(this.pool, async (client) => {
      const update = await client.query(
        `UPDATE "User"
         SET "totpLastUsedCounter" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
           AND CASE
             WHEN "totpLastUsedCounter" IS NULL THEN true
             WHEN "totpLastUsedCounter" ~ '^[0-9]+$' THEN $2::bigint > "totpLastUsedCounter"::bigint
             ELSE false
           END
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
             "passwordHashVersion" = $5,
             "accountStatus" = CASE
               WHEN "accountStatus" = 'PENDING_ACTIVATION' THEN 'ACTIVE'
               ELSE "accountStatus"
             END,
             "mustChangePassword" = COALESCE($3, "mustChangePassword"),
             "passwordChangedAt" = COALESCE($4::timestamptz, "passwordChangedAt"),
             "membershipVersion" = "membershipVersion" + 1,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id"`,
        [id, passwordHash, input.mustChangePassword ?? null, input.passwordChangedAt ?? null, passwordHashVersionOf(passwordHash)],
      );
      return Boolean(update.rows[0]);
    });
    return updated ? this.findById(id) : undefined;
  }

  async updatePasswordForReset(id: string, passwordHash: string, input: PasswordStateUpdate, transaction: PasswordResetTransaction): Promise<boolean> {
    if (transaction.kind !== "postgres") return false;
    return transaction.updateUserPassword({
      userId: id,
      passwordHash,
      passwordHashVersion: passwordHashVersionOf(passwordHash),
      mustChangePassword: input.mustChangePassword,
      passwordChangedAt: input.passwordChangedAt,
    });
  }

  async rehashPassword(tenantId: string, id: string, currentPasswordHash: string, passwordHash: string): Promise<boolean> {
    return withExplicitTenantQuery(this.pool, tenantId, async (client) => {
      const update = await client.query(
        `UPDATE "User"
         SET "passwordHash" = $4,
             "passwordHashVersion" = $5,
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "id" = $2
           AND "passwordHash" = $3
         RETURNING "id"`,
        [tenantId, id, currentPasswordHash, passwordHash, passwordHashVersionOf(passwordHash)],
      );
      return Boolean(update.rows[0]);
    });
  }

  private async queryAuthUsers(whereSql: string, values: unknown[]): Promise<AuthUser[]> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<AuthUserRow>(
        `SELECT
           u."id",
           u."tenantId",
           u."email",
           COALESCE(max(te.phone), max(st.phone), max(gu.phone)) AS phone,
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
           array_agg(DISTINCT m."role"::text ORDER BY m."role"::text) AS roles,
           max(m."id") FILTER (
             WHERE m."staffRole" IS NOT NULL OR m."hasTeacherPersona" OR m."hasStudentPersona"
           ) AS "canonicalMembershipId",
           count(DISTINCT m."id") FILTER (
             WHERE m."staffRole" IS NOT NULL OR m."hasTeacherPersona" OR m."hasStudentPersona"
           )::int AS "canonicalMembershipCount",
           max(m."staffRole"::text) AS "canonicalStaffRole",
           bool_or(m."hasTeacherPersona") AS "canonicalHasTeacherPersona",
           bool_or(m."hasStudentPersona") AS "canonicalHasStudentPersona",
           max(m."version") FILTER (
             WHERE m."staffRole" IS NOT NULL OR m."hasTeacherPersona" OR m."hasStudentPersona"
           ) AS "canonicalMembershipVersion",
           max(m."scopeMode") FILTER (
             WHERE m."staffRole" IS NOT NULL OR m."hasTeacherPersona" OR m."hasStudentPersona"
           ) AS "canonicalScopeMode",
           COALESCE(array_agg(DISTINCT scope."campusId") FILTER (
             WHERE m."staffRole" IS NOT NULL OR m."hasTeacherPersona" OR m."hasStudentPersona"
           ), ARRAY[]::text[]) AS "canonicalCampusIds"
         FROM "User" u
         JOIN "TenantMembership" m ON m."userId" = u."id" AND m."tenantId" = u."tenantId" AND m."status" = 'ACTIVE'
         LEFT JOIN "MembershipCampusScope" scope ON scope."tenantId" = m."tenantId" AND scope."membershipId" = m."id"
         JOIN "Tenant" t ON t."id" = m."tenantId"
         LEFT JOIN "Teacher" te ON te."tenantId" = u."tenantId" AND te."userId" = u."id" AND te."deletedAt" IS NULL
         LEFT JOIN "Student" st ON st."tenantId" = u."tenantId" AND st."userId" = u."id" AND st."deletedAt" IS NULL
         LEFT JOIN "Guardian" gu ON gu."tenantId" = u."tenantId" AND gu."userId" = u."id" AND gu."deletedAt" IS NULL
         ${whereSql}`,
        values,
      );
      return result.rows.map(toAuthUser);
    });
  }
}

async function syncActiveMembershipVersions(
  client: Queryable,
  user: { id: string; membershipVersion: number; tenantId: string | null },
): Promise<void> {
  if (!user.tenantId) return;
  await client.query(
    `UPDATE "TenantMembership"
     SET "version" = $3,
         "updatedAt" = now()
     WHERE "tenantId" = $1
       AND "userId" = $2
       AND "status" = 'ACTIVE'`,
    [user.tenantId, user.id, user.membershipVersion],
  );
}

function isNewerTotpCounter(counter: string, lastUsedCounter: string | undefined): boolean {
  if (!isValidTotpCounter(counter)) return false;
  if (lastUsedCounter === undefined) return true;
  if (!isValidTotpCounter(lastUsedCounter)) return false;
  return BigInt(counter) > BigInt(lastUsedCounter);
}

function isValidTotpCounter(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  try {
    return BigInt(value) <= 9_223_372_036_854_775_807n;
  } catch {
    return false;
  }
}

export function createAuthUserStore(): AuthUserStore {
  return resolvePersistenceDriver(process.env.AUTH_USER_STORE) === "postgres" ? new PostgresAuthUserStore() : new InMemoryAuthUserStore();
}

export function hashPassword(password: string, salt = "demo-auth-salt"): string {
  return `scrypt:${salt}:${scryptSync(password, salt, 32).toString("base64url")}`;
}

const scryptAsync = promisify(scrypt);

export async function hashPasswordAsync(password: string): Promise<string> {
  const salt = randomBytes(16).toString("base64url");
  const derivedKey = await scryptAsync(password, salt, 32) as Buffer;
  return `scrypt:v2:${salt}:${derivedKey.toString("base64url")}`;
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

export async function verifyPasswordAsync(password: string, passwordHash: string): Promise<boolean> {
  const parts = passwordHash.split(":");
  const versioned = parts.length === 4 && parts[0] === "scrypt" && parts[1] === "v2";
  const legacy = parts.length === 3 && parts[0] === "scrypt";
  if (!versioned && !legacy) return false;

  const salt = versioned ? parts[2] : parts[1];
  const expected = versioned ? parts[3] : parts[2];
  if (!salt || !expected) return false;

  const actualBuffer = await scryptAsync(password, salt, 32) as Buffer;
  const expectedBuffer = Buffer.from(expected, "base64url");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function passwordHashNeedsRehash(passwordHash: string): boolean {
  return !passwordHash.startsWith("scrypt:v2:");
}

interface AuthUserRow {
  id: string;
  tenantId: string | null;
  email: string | null;
  phone: string | null;
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
  canonicalMembershipId: string | null;
  canonicalMembershipCount: number;
  canonicalStaffRole: CanonicalStaffRole | null;
  canonicalHasTeacherPersona: boolean | null;
  canonicalHasStudentPersona: boolean | null;
  canonicalMembershipVersion: number | null;
  canonicalScopeMode?: "TENANT" | "CAMPUSES" | null;
  canonicalCampusIds?: string[] | null;
}

function toAuthUser(row: AuthUserRow): AuthUser {
  const membership = toCanonicalMembership(row);
  const roles = membership ? assertTenantMembershipParity(row.roles, membership) : row.roles;
  return {
    id: row.id,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
    nationalIdEncrypted: row.nationalIdEncrypted ?? undefined,
    nationalIdHash: row.nationalIdHash ?? undefined,
    name: row.name,
    passwordHash: row.passwordHash,
    tenantId: row.tenantId ?? "system",
    roles,
    membership,
    authorizationSource: membership ? "CANONICAL_PARITY" : "LEGACY",
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
  return {
    ...user,
    roles: [...user.roles],
    membership: user.membership ? cloneCanonicalMembership(user.membership) : undefined,
    totpRecoveryCodeHashes: [...(user.totpRecoveryCodeHashes ?? [])],
  };
}

function cloneUser(user: AuthUser | undefined): AuthUser | undefined {
  return user ? cloneRequiredUser(user) : undefined;
}

function passwordHashVersionOf(passwordHash: string): number {
  return passwordHash.startsWith("scrypt:v2:") ? 2 : 1;
}

function toCanonicalMembership(row: AuthUserRow): CanonicalMembershipProjection | undefined {
  const canonicalMembershipCount = Number(row.canonicalMembershipCount ?? 0);
  if (canonicalMembershipCount === 0) return undefined;
  if (
    canonicalMembershipCount !== 1 ||
    !row.canonicalMembershipId ||
    row.canonicalMembershipVersion === null ||
    row.canonicalMembershipVersion === undefined ||
    row.canonicalMembershipVersion !== row.membershipVersion
  ) {
    throw new Error("AUTH_MEMBERSHIP_PARITY_MISMATCH");
  }
  const scopeMode = row.canonicalScopeMode === "TENANT" || row.canonicalScopeMode === "CAMPUSES"
    ? row.canonicalScopeMode
    : undefined;
  return {
    id: row.canonicalMembershipId,
    staffRole: row.canonicalStaffRole ?? null,
    hasTeacherPersona: row.canonicalHasTeacherPersona === true,
    hasStudentPersona: row.canonicalHasStudentPersona === true,
    version: row.canonicalMembershipVersion,
    scopeMode,
    campusIds: scopeMode ? [...(row.canonicalCampusIds ?? [])] : undefined,
  };
}

function cloneCanonicalMembership(membership: CanonicalMembershipProjection): CanonicalMembershipProjection {
  return {
    ...membership,
    campusIds: membership.campusIds ? [...membership.campusIds] : undefined,
  };
}
