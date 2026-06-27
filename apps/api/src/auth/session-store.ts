import { createHash, randomUUID } from "node:crypto";
import { resolvePersistenceDriver } from "../config/persistence.js";
import pg from "pg";

export type SessionStatus = "ACTIVE" | "REVOKED" | "COMPROMISED";

export interface SessionRecord {
  id: string;
  userId: string;
  tenantId: string;
  roles: string[];
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
  tokenFamilyId: string;
  refreshTokenHash: string;
  status: SessionStatus;
  membershipVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionIssueInput {
  userId: string;
  tenantId: string;
  roles: string[];
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
  refreshToken: string;
  membershipVersion: number;
}

export interface SessionStore {
  create(input: SessionIssueInput): Promise<SessionRecord>;
  findById(sessionId: string): Promise<SessionRecord | null>;
  findByRefreshToken(refreshToken: string): Promise<SessionRecord | null>;
  updateRefreshToken(sessionId: string, refreshToken: string): Promise<SessionRecord>;
  markFamilyCompromised(tokenFamilyId: string): Promise<void>;
  findConsumedTokenFamily(refreshToken: string): Promise<string | null>;
  revoke(sessionId: string): Promise<void>;
  revokeByMembership(userId: string, tenantId: string, membershipVersion: number): Promise<void>;
  revokeByUser(userId: string): Promise<void>;
  revokeByUserExcept(userId: string, activeSessionId: string): Promise<void>;
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
      roles: [...input.roles],
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      tokenFamilyId: randomUUID(),
      refreshTokenHash: hashRefreshToken(input.refreshToken),
      status: "ACTIVE",
      membershipVersion: input.membershipVersion,
      createdAt: now,
      updatedAt: now,
    };

    this.sessions.set(session.id, session);
    return cloneSession(session);
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

  async updateRefreshToken(sessionId: string, refreshToken: string): Promise<SessionRecord> {
    const session = this.requireSession(sessionId);
    this.consumedRefreshTokens.set(session.refreshTokenHash, session.tokenFamilyId);
    const updated = {
      ...session,
      refreshTokenHash: hashRefreshToken(refreshToken),
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

  async revokeByUser(userId: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.set(id, { ...session, status: "REVOKED", updatedAt: new Date() });
      }
    }
  }

  async revokeByUserExcept(userId: string, activeSessionId: string): Promise<void> {
    for (const [id, session] of this.sessions) {
      if (session.userId === userId && id !== activeSessionId) {
        this.sessions.set(id, { ...session, status: "REVOKED", updatedAt: new Date() });
      }
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
      const result = await client.query<SessionRow>(
        `INSERT INTO "AuthSession" (
           "id", "userId", "tenantId", "roles", "subjectType", "subjectId",
           "tokenFamilyId", "refreshTokenHash", "status", "membershipVersion", "updatedAt"
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'ACTIVE', $9, now())
         RETURNING *`,
        [
          randomUUID(),
          input.userId,
          input.tenantId,
          input.roles,
          input.subjectType ?? null,
          input.subjectId ?? null,
          randomUUID(),
          hashRefreshToken(input.refreshToken),
          input.membershipVersion,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("SESSION_CREATE_FAILED");
      }
      return toSessionRecord(record);
    });
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

  async updateRefreshToken(sessionId: string, refreshToken: string): Promise<SessionRecord> {
    return this.withClient(async (client) => {
      const existing = await client.query<SessionRow>(`SELECT * FROM "AuthSession" WHERE "id" = $1 LIMIT 1`, [
        sessionId,
      ]);
      const session = existing.rows[0];
      if (!session) {
        throw new Error("SESSION_NOT_FOUND");
      }

      await client.query(
        `INSERT INTO "ConsumedRefreshToken" ("refreshTokenHash", "tokenFamilyId", "updatedAt")
         VALUES ($1, $2, now())
         ON CONFLICT ("refreshTokenHash") DO UPDATE
         SET "tokenFamilyId" = EXCLUDED."tokenFamilyId",
             "updatedAt" = now()`,
        [session.refreshTokenHash, session.tokenFamilyId],
      );

      const updated = await client.query<SessionRow>(
        `UPDATE "AuthSession"
         SET "refreshTokenHash" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [sessionId, hashRefreshToken(refreshToken)],
      );
      const record = updated.rows[0];
      if (!record) {
        throw new Error("SESSION_NOT_FOUND");
      }
      return toSessionRecord(record);
    });
  }

  async markFamilyCompromised(tokenFamilyId: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        `UPDATE "AuthSession"
         SET "status" = 'COMPROMISED',
             "updatedAt" = now()
         WHERE "tokenFamilyId" = $1`,
        [tokenFamilyId],
      );
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
      const result = await client.query(
        `UPDATE "AuthSession"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING "id"`,
        [sessionId],
      );
      if (!result.rows[0]) {
        throw new Error("SESSION_NOT_FOUND");
      }
    });
  }

  async revokeByMembership(userId: string, tenantId: string, membershipVersion: number): Promise<void> {
    await this.withClient(async (client) => {
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

  async revokeByUser(userId: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        `UPDATE "AuthSession"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "userId" = $1`,
        [userId],
      );
    });
  }

  async revokeByUserExcept(userId: string, activeSessionId: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        `UPDATE "AuthSession"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "userId" = $1
           AND "id" <> $2`,
        [userId, activeSessionId],
      );
    });
  }

  private async withClient<T>(callback: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.bypass_rls', 'true', true)");
      const result = await callback(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
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
  roles: string[];
  subjectType: "STUDENT" | "GUARDIAN" | "TEACHER" | null;
  subjectId: string | null;
  tokenFamilyId: string;
  refreshTokenHash: string;
  status: SessionStatus;
  membershipVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

function toSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.userId,
    tenantId: row.tenantId,
    roles: row.roles,
    subjectType: row.subjectType ?? undefined,
    subjectId: row.subjectId ?? undefined,
    tokenFamilyId: row.tokenFamilyId,
    refreshTokenHash: row.refreshTokenHash,
    status: row.status,
    membershipVersion: row.membershipVersion,
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
