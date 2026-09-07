import type { AuthUserMutationSource } from "./auth-user-store.js";
import { acquireTenantDatabaseSharedLock } from "@o-okul/db";
import { UnauthorizedException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { resolvePersistenceDriver } from "../config/persistence.js";
import pg from "pg";
import type { ActivePersona } from "@o-okul/shared-types";
import type { PasswordResetTransaction } from "./password-reset-store.js";

export type SessionStatus = "ACTIVE" | "REVOKED" | "COMPROMISED";

export interface SessionRecord {
  id: string;
  userId: string;
  tenantId: string;
  membershipId?: string;
  activePersona?: ActivePersona;
  roles: string[];
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
  deviceLabel?: string;
  clientIpPrefix?: string;
  lastSeenAt?: Date;
  tokenFamilyId: string;
  refreshTokenHash: string;
  status: SessionStatus;
  membershipVersion: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionIssueInput {
  userId: string;
  tenantId: string;
  membershipId?: string;
  activePersona?: ActivePersona;
  roles: string[];
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
  deviceLabel?: string;
  clientIpPrefix?: string;
  refreshToken: string;
  membershipVersion: number;
  expiresAt: Date;
}

export interface SessionStore {
  create(input: SessionIssueInput): Promise<SessionRecord>;
  replace(sessionId: string, input: SessionIssueInput): Promise<SessionRecord>;
  findById(sessionId: string): Promise<SessionRecord | null>;
  findByRefreshToken(refreshToken: string): Promise<SessionRecord | null>;
  listActiveByUser(userId: string, tenantId: string): Promise<SessionRecord[]>;
  updateRefreshToken(sessionId: string, currentRefreshToken: string, nextRefreshToken: string, expiresAt: Date): Promise<SessionRecord>;
  markFamilyCompromised(tokenFamilyId: string): Promise<void>;
  findConsumedTokenFamily(refreshToken: string): Promise<string | null>;
  revoke(sessionId: string): Promise<void>;
  revokeOwned(sessionId: string, userId: string, tenantId: string, membershipVersion: number): Promise<boolean>;
  revokeAllOwned(userId: string, tenantId: string, membershipVersion: number): Promise<number>;
  revokeByTenant(tenantId: string, lifecycleVersion: number): Promise<number>;
  revokeByMembership(userId: string, tenantId: string, membershipVersion: number): Promise<void>;
  revokeByUser(userId: string, source: AuthUserMutationSource | PasswordResetTransaction): Promise<void>;
}

export const authSessionStoreToken = Symbol("AuthSessionStore");

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, SessionRecord>();
  private readonly consumedRefreshTokens = new Map<string, string>();

  async create(input: SessionIssueInput): Promise<SessionRecord> {
    const now = new Date();
    const session: SessionRecord = {
      id: randomUUID(),
      userId: input.userId,
      tenantId: input.tenantId,
      membershipId: input.membershipId,
      activePersona: input.activePersona,
      roles: [...input.roles],
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      deviceLabel: input.deviceLabel,
      clientIpPrefix: input.clientIpPrefix,
      lastSeenAt: now,
      tokenFamilyId: randomUUID(),
      refreshTokenHash: hashRefreshToken(input.refreshToken),
      status: "ACTIVE",
      membershipVersion: input.membershipVersion,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(session.id, session);
    return cloneSession(session);
  }

  async replace(sessionId: string, input: SessionIssueInput): Promise<SessionRecord> {
    const current = this.requireSession(sessionId);
    if (current.status !== "ACTIVE" || current.userId !== input.userId || current.tenantId !== input.tenantId) {
      throw new Error("SESSION_REPLACE_CONFLICT");
    }
    const replacement = await this.create(input);
    this.sessions.set(sessionId, { ...current, status: "REVOKED", updatedAt: new Date() });
    return replacement;
  }

  async findById(sessionId: string): Promise<SessionRecord | null> {
    return cloneSession(this.sessions.get(sessionId) ?? null);
  }

  async findByRefreshToken(refreshToken: string): Promise<SessionRecord | null> {
    const hash = hashRefreshToken(refreshToken);
    for (const session of this.sessions.values()) {
      if (session.refreshTokenHash === hash) {
        return cloneSession(session);
      }
    }
    return null;
  }

  async listActiveByUser(userId: string, tenantId: string): Promise<SessionRecord[]> {
    return [...this.sessions.values()]
      .filter((session) => session.userId === userId && session.tenantId === tenantId && session.status === "ACTIVE" && session.expiresAt.getTime() > Date.now())
      .sort((left, right) => (right.lastSeenAt ?? right.updatedAt).getTime() - (left.lastSeenAt ?? left.updatedAt).getTime())
      .map((session) => cloneSession(session));
  }

  async updateRefreshToken(sessionId: string, currentRefreshToken: string, nextRefreshToken: string, expiresAt: Date): Promise<SessionRecord> {
    const session = this.requireSession(sessionId);
    if (session.status !== "ACTIVE" || session.refreshTokenHash !== hashRefreshToken(currentRefreshToken)) {
      throw new Error("REFRESH_TOKEN_ROTATION_CONFLICT");
    }
    this.consumedRefreshTokens.set(session.refreshTokenHash, session.tokenFamilyId);
    const updated = {
      ...session,
      refreshTokenHash: hashRefreshToken(nextRefreshToken),
      expiresAt,
      lastSeenAt: new Date(),
      updatedAt: new Date(),
    };
    this.sessions.set(sessionId, updated);
    return cloneSession(updated);
  }

  async markFamilyCompromised(tokenFamilyId: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.tokenFamilyId === tokenFamilyId) {
        this.sessions.set(id, { ...session, status: "COMPROMISED", updatedAt: new Date() });
      }
    }
  }

  async findConsumedTokenFamily(refreshToken: string): Promise<string | null> {
    return this.consumedRefreshTokens.get(hashRefreshToken(refreshToken)) ?? null;
  }

  async revoke(sessionId: string): Promise<void> {
    const session = this.requireSession(sessionId);
    this.sessions.set(sessionId, { ...session, status: "REVOKED", updatedAt: new Date() });
  }

  async revokeOwned(sessionId: string, userId: string, tenantId: string, membershipVersion: number): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.userId !== userId || session.tenantId !== tenantId || session.status !== "ACTIVE" || session.membershipVersion > membershipVersion) return false;
    this.sessions.set(sessionId, { ...session, status: "REVOKED", updatedAt: new Date() });
    return true;
  }

  async revokeAllOwned(userId: string, tenantId: string, membershipVersion: number): Promise<number> {
    let revokedCount = 0;
    for (const [id, session] of this.sessions) {
      if (session.userId === userId && session.tenantId === tenantId && session.status === "ACTIVE" && session.membershipVersion <= membershipVersion) {
        this.sessions.set(id, { ...session, status: "REVOKED", updatedAt: new Date() });
        revokedCount += 1;
      }
    }
    return revokedCount;
  }

  async revokeByTenant(tenantId: string, lifecycleVersion: number): Promise<number> {
    if (!Number.isInteger(lifecycleVersion) || lifecycleVersion < 0) throw new Error("SESSION_REVOCATION_SOURCE_REQUIRED");
    let revokedCount = 0;
    for (const [id, session] of this.sessions) {
      if (session.tenantId === tenantId && session.status === "ACTIVE") {
        this.sessions.set(id, { ...session, status: "REVOKED", updatedAt: new Date() });
        revokedCount += 1;
      }
    }
    return revokedCount;
  }

  async revokeByMembership(userId: string, tenantId: string, membershipVersion: number): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (
        session.userId === userId &&
        session.tenantId === tenantId &&
        session.membershipVersion < membershipVersion
      ) {
        this.sessions.set(id, { ...session, status: "REVOKED", updatedAt: new Date() });
      }
    }
  }

  async revokeByUser(userId: string, source: AuthUserMutationSource | PasswordResetTransaction): Promise<void> {
    const transaction = "kind" in source ? source : undefined;
    if (!transaction) assertRevocationSource(source as AuthUserMutationSource);
    const revoke = () => {
      for (const [id, session] of this.sessions) {
        if (session.userId === userId && (transaction || (session.tenantId === (source as AuthUserMutationSource).tenantId && session.membershipVersion <= (source as AuthUserMutationSource).membershipVersion))) {
          this.sessions.set(id, { ...session, status: "REVOKED", updatedAt: new Date() });
        }
      }
    };
    if (transaction?.kind === "memory") {
      transaction.stage(revoke);
    } else {
      revoke();
    }
  }


  private requireSession(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error("SESSION_NOT_FOUND");
    }
    return session;
  }
}

export class PostgresSessionStore implements SessionStore {
  constructor(private readonly pool: pg.Pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async create(input: SessionIssueInput): Promise<SessionRecord> {
    return this.withClient(async (client) => {
      await this.assertActiveTenant(client, input.tenantId);
      await this.assertOriginalMembership(client, input);
      return this.insert(client, input);
    });
  }

  async replace(sessionId: string, input: SessionIssueInput): Promise<SessionRecord> {
    return this.withClient(async (client) => {
      await this.assertActiveTenant(client, input.tenantId);
      await this.assertOriginalMembership(client, input);
      const revoked = await client.query(
        `UPDATE "AuthSession"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "id" = $1
           AND "userId" = $2
           AND "tenantId" = $3
           AND "status" = 'ACTIVE'
         RETURNING "id"`,
        [sessionId, input.userId, input.tenantId],
      );
      if (!revoked.rows[0]) throw new Error("SESSION_REPLACE_CONFLICT");
      return this.insert(client, input);
    });
  }

  private async assertActiveTenant(client: pg.PoolClient, tenantId: string): Promise<void> {
    if (tenantId !== "system") await acquireTenantDatabaseSharedLock(client, tenantId);
    // Lock order matches lifecycle transitions: Tenant, then AuthSession.
    const tenant = await client.query(`SELECT "id" FROM "Tenant" WHERE "id" = $1 AND "status" = 'ACTIVE' FOR SHARE`, [tenantId]);
    if (!tenant.rows[0]) throw new UnauthorizedException("SESSION_TENANT_INACTIVE");
  }

  private async assertOriginalMembership(client: pg.PoolClient, input: Pick<SessionIssueInput, "tenantId" | "userId" | "membershipId" | "membershipVersion">): Promise<void> {
    if (input.tenantId === "system") return;
    const user = await client.query(`SELECT u."id" FROM "User" u JOIN "TenantMembership" m ON m."userId" = u."id" AND m."tenantId" = u."tenantId" WHERE u."id" = $1 AND u."tenantId" = $2 AND u."accountStatus" = 'ACTIVE' AND u."membershipVersion" = $3 AND m."id" = $4 AND m."version" = $3 AND m."status" = 'ACTIVE' AND m."startsAt" <= now() AND (m."endsAt" IS NULL OR m."endsAt" > now()) FOR SHARE OF u,m`, [input.userId, input.tenantId, input.membershipVersion, input.membershipId]);
    if (!user.rows.length) throw new Error("SESSION_MEMBERSHIP_CHANGED");
  }

  private async insert(client: pg.PoolClient, input: SessionIssueInput): Promise<SessionRecord> {
    const result = await client.query<SessionRow>(
        `INSERT INTO "AuthSession" (
           "id", "userId", "tenantId", "membershipId", "activePersona", "roles", "subjectType", "subjectId",
           "deviceLabel", "clientIpPrefix", "lastSeenAt",
           "tokenFamilyId", "refreshTokenHash", "status", "membershipVersion", "expiresAt", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now(), $11, $12, 'ACTIVE', $13, $14, now())
         RETURNING *`,
        [
          randomUUID(),
          input.userId,
          input.tenantId,
          input.membershipId ?? null,
          input.activePersona ?? null,
          input.roles,
          input.subjectType ?? null,
          input.subjectId ?? null,
          input.deviceLabel ?? null,
          input.clientIpPrefix ?? null,
          randomUUID(),
          hashRefreshToken(input.refreshToken),
          input.membershipVersion,
          input.expiresAt,
        ],
    );
    const record = result.rows[0];
    if (!record) throw new Error("SESSION_CREATE_FAILED");
    return toSessionRecord(record);
  }

  async findById(sessionId: string): Promise<SessionRecord | null> {
    return this.withClient(async (client) => {
      const result = await client.query<SessionRow>(`SELECT * FROM "AuthSession" WHERE "id" = $1 LIMIT 1`, [
        sessionId,
      ]);
      return result.rows[0] ? toSessionRecord(result.rows[0]) : null;
    });
  }

  async findByRefreshToken(refreshToken: string): Promise<SessionRecord | null> {
    return this.withClient(async (client) => {
      const result = await client.query<SessionRow>(
        `SELECT * FROM "AuthSession" WHERE "refreshTokenHash" = $1 LIMIT 1`,
        [hashRefreshToken(refreshToken)],
      );
      return result.rows[0] ? toSessionRecord(result.rows[0]) : null;
    });
  }

  async listActiveByUser(userId: string, tenantId: string): Promise<SessionRecord[]> {
    return this.withClient(async (client) => {
      const result = await client.query<SessionRow>(
        `SELECT * FROM "AuthSession"
         WHERE "userId" = $1
           AND "tenantId" = $2
           AND "status" = 'ACTIVE'
           AND "expiresAt" > now()
         ORDER BY "lastSeenAt" DESC`,
        [userId, tenantId],
      );
      return result.rows.map(toSessionRecord);
    });
  }

  async updateRefreshToken(sessionId: string, currentRefreshToken: string, nextRefreshToken: string, expiresAt: Date): Promise<SessionRecord> {
    return this.withClient(async (client) => {
      const source = (await client.query<SessionRow>('SELECT * FROM "AuthSession" WHERE "id" = $1 AND "refreshTokenHash" = $2 AND "status" = \'ACTIVE\' AND "expiresAt" > now()', [sessionId, hashRefreshToken(currentRefreshToken)])).rows[0];
      if (!source) throw new Error("REFRESH_TOKEN_ROTATION_CONFLICT");
      const captured = toSessionRecord(source);
      await this.assertActiveTenant(client, captured.tenantId);
      await this.assertOriginalMembership(client, captured);
      const updated = await client.query<SessionRow>(
        `WITH rotated AS (
           UPDATE "AuthSession"
           SET "refreshTokenHash" = $3,
               "expiresAt" = $4,
               "lastSeenAt" = now(),
               "updatedAt" = now()
           WHERE "id" = $1
             AND "refreshTokenHash" = $2
             AND "status" = 'ACTIVE'
           RETURNING *
         ), consumed AS (
           INSERT INTO "ConsumedRefreshToken" ("refreshTokenHash", "tokenFamilyId", "updatedAt")
           SELECT $2, "tokenFamilyId", now() FROM rotated
           ON CONFLICT ("refreshTokenHash") DO UPDATE
           SET "tokenFamilyId" = EXCLUDED."tokenFamilyId",
               "updatedAt" = now()
         )
         SELECT * FROM rotated`,
        [sessionId, hashRefreshToken(currentRefreshToken), hashRefreshToken(nextRefreshToken), expiresAt],
      );
      const record = updated.rows[0];
      if (!record) {
        throw new Error("REFRESH_TOKEN_ROTATION_CONFLICT");
      }
      return toSessionRecord(record);
    });
  }

  async markFamilyCompromised(tokenFamilyId: string): Promise<void> {
    await this.withClient(async (client) => {
      const sources = (await client.query<AuthUserMutationSource>('SELECT DISTINCT "tenantId", "membershipVersion" FROM "AuthSession" WHERE "tokenFamilyId" = $1', [tokenFamilyId])).rows;
      if (!sources.length) return;
      if (new Set(sources.map((source) => source.tenantId)).size !== 1) throw new Error("SESSION_FAMILY_SCOPE_CONFLICT");
      await this.lockSource(client, sources[0]!);
      for (const source of sources) {
        assertRevocationSource(source);
        await client.query('UPDATE "AuthSession" SET "status" = \'COMPROMISED\', "updatedAt" = now() WHERE "tokenFamilyId" = $1 AND "tenantId" = $2 AND "membershipVersion" = $3', [tokenFamilyId, source.tenantId, source.membershipVersion]);
      }
    });
  }

  async findConsumedTokenFamily(refreshToken: string): Promise<string | null> {
    return this.withClient(async (client) => {
      const result = await client.query<{ tokenFamilyId: string }>(
        `SELECT "tokenFamilyId" FROM "ConsumedRefreshToken" WHERE "refreshTokenHash" = $1 LIMIT 1`,
        [hashRefreshToken(refreshToken)],
      );
      return result.rows[0]?.tokenFamilyId ?? null;
    });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.withClient(async (client) => {
      const source = (await client.query<AuthUserMutationSource>('SELECT "tenantId", "membershipVersion" FROM "AuthSession" WHERE "id" = $1', [sessionId])).rows[0];
      if (!source) return;
      await this.lockSource(client, source);
      await client.query('UPDATE "AuthSession" SET "status" = \'REVOKED\', "updatedAt" = now() WHERE "id" = $1 AND "tenantId" = $2 AND "membershipVersion" = $3', [sessionId, source.tenantId, source.membershipVersion]);
    });
  }

  async revokeOwned(sessionId: string, userId: string, tenantId: string, membershipVersion: number): Promise<boolean> {
    return this.withClient(async (client) => {
      await this.lockSource(client, { tenantId, membershipVersion });
      const result = await client.query(
        `UPDATE "AuthSession"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "id" = $1
           AND "userId" = $2
           AND "tenantId" = $3
           AND "status" = 'ACTIVE' AND "membershipVersion" <= $4
         RETURNING "id"`,
        [sessionId, userId, tenantId, membershipVersion],
      );
      return Boolean(result.rows[0]);
    });
  }

  async revokeAllOwned(userId: string, tenantId: string, membershipVersion: number): Promise<number> {
    return this.withClient(async (client) => {
      await this.lockSource(client, { tenantId, membershipVersion });
      const result = await client.query(
        `UPDATE "AuthSession"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "userId" = $1
           AND "tenantId" = $2
           AND "status" = 'ACTIVE' AND "membershipVersion" <= $3
         RETURNING "id"`,
        [userId, tenantId, membershipVersion],
      );
      return result.rowCount ?? result.rows.length;
    });
  }

  async revokeByTenant(tenantId: string, lifecycleVersion: number): Promise<number> {
    return this.withClient(async (client) => {
      if (!Number.isInteger(lifecycleVersion) || lifecycleVersion < 0) throw new Error("SESSION_REVOCATION_SOURCE_REQUIRED");
      if (tenantId !== "system") await acquireTenantDatabaseSharedLock(client, tenantId);
      const target = await client.query('SELECT "id" FROM "Tenant" WHERE "id" = $1 AND "lifecycleVersion" = $2 FOR SHARE', [tenantId, lifecycleVersion]);
      if (!target.rows.length) return 0;
      const result = await client.query(
        `UPDATE "AuthSession"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "tenantId" = $1
           AND "status" = 'ACTIVE'
         RETURNING "id"`,
        [tenantId],
      );
      return result.rowCount ?? result.rows.length;
    });
  }

  async revokeByMembership(userId: string, tenantId: string, membershipVersion: number): Promise<void> {
    await this.withClient(async (client) => {
      await this.lockSource(client, { tenantId, membershipVersion });
      await client.query(
        `UPDATE "AuthSession"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "userId" = $1
           AND "tenantId" = $2
           AND "membershipVersion" < $3`,
        [userId, tenantId, membershipVersion],
      );
    });
  }

  async revokeByUser(userId: string, source: AuthUserMutationSource | PasswordResetTransaction): Promise<void> {
    if ("kind" in source && source.kind === "postgres") return source.revokeUserSessions(userId);
    if ("kind" in source) throw new Error("SESSION_REVOCATION_SOURCE_REQUIRED");
    await this.withClient(async (client) => {
      await this.lockSource(client, source);
      await client.query('UPDATE "AuthSession" SET "status" = \'REVOKED\', "updatedAt" = now() WHERE "userId" = $1 AND "tenantId" = $2 AND "membershipVersion" <= $3', [userId, source.tenantId, source.membershipVersion]);
    });
  }

  private async lockSource(client: pg.PoolClient, source: AuthUserMutationSource): Promise<void> {
    assertRevocationSource(source);
    if (source.tenantId !== "system") await acquireTenantDatabaseSharedLock(client, source.tenantId);
  }

  private async withClient<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let discard = false;
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      try { await client.query("ROLLBACK"); } catch { discard = true; }
      throw error;
    } finally {
      client.release(discard || undefined);
    }
  }
}

export function createSessionStore(): SessionStore {
  return resolvePersistenceDriver(process.env.AUTH_SESSION_STORE) === "postgres" ? new PostgresSessionStore() : new InMemorySessionStore();
}

export function hashRefreshToken(refreshToken: string): string {
  return createHash("sha256").update(refreshToken).digest("hex");
}

interface SessionRow {
  id: string;
  userId: string;
  tenantId: string;
  membershipId: string | null;
  activePersona: ActivePersona | null;
  roles: string[];
  subjectType: "STUDENT" | "GUARDIAN" | "TEACHER" | null;
  subjectId: string | null;
  deviceLabel: string | null;
  clientIpPrefix: string | null;
  lastSeenAt: Date;
  tokenFamilyId: string;
  refreshTokenHash: string;
  status: SessionStatus;
  membershipVersion: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    membershipId: row.membershipId ?? undefined,
    activePersona: row.activePersona ?? undefined,
    roles: row.roles,
    subjectType: row.subjectType ?? undefined,
    subjectId: row.subjectId ?? undefined,
    deviceLabel: row.deviceLabel ?? undefined,
    clientIpPrefix: row.clientIpPrefix ?? undefined,
    lastSeenAt: row.lastSeenAt,
    tokenFamilyId: row.tokenFamilyId,
    refreshTokenHash: row.refreshTokenHash,
    status: row.status,
    membershipVersion: row.membershipVersion,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function cloneSession(session: SessionRecord): SessionRecord;
function cloneSession(session: null): null;
function cloneSession(session: SessionRecord | null): SessionRecord | null;
function cloneSession(session: SessionRecord | null): SessionRecord | null {
  if (!session) return null;
  return { ...session, roles: [...session.roles] };
}

function assertRevocationSource(source: AuthUserMutationSource | undefined): asserts source is AuthUserMutationSource {
  if (!source || !source.tenantId || source.tenantId.trim() !== source.tenantId || !Number.isInteger(source.membershipVersion) || source.membershipVersion < 1) throw new Error("SESSION_REVOCATION_SOURCE_REQUIRED");
}
