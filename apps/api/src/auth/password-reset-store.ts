import { randomUUID } from "node:crypto";
import type { SecretDeliveryOutboxInput } from "@o-okul/db";
import { resolvePersistenceDriver } from "../config/persistence.js";
import type { Queryable } from "../db/tenant-query.js";
import pg from "pg";

export type PasswordResetStatus = "PENDING" | "USED" | "REVOKED";

export interface PasswordResetRecord {
  id: string;
  userId: string;
  tokenHash: string;
  status: PasswordResetStatus;
  expiresAt: string;
  usedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PasswordResetStore {
  findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined>;
  findPendingForUser(userId: string): Promise<PasswordResetRecord | undefined>;
  issue(input: PasswordResetIssueInput): Promise<PasswordResetRecord | undefined>;
  markUsed(id: string, usedAt: string): Promise<PasswordResetRecord | undefined>;
  confirm<T>(
    id: string,
    usedAt: string,
    operation: (transaction: PasswordResetTransaction) => Promise<T>,
  ): Promise<T | undefined>;
  revokePendingForUser(userId: string): Promise<void>;
}

export type PasswordResetTransaction =
  | { kind: "memory"; stage(operation: () => void): void }
  | {
      kind: "postgres";
      updateUserPassword(input: {
        userId: string;
        passwordHash: string;
        passwordHashVersion: number;
        mustChangePassword?: boolean;
        passwordChangedAt?: string;
      }): Promise<boolean>;
      revokeUserSessions(userId: string): Promise<void>;
    };

export interface PasswordResetIssueInput {
  userId: string;
  tokenHash: string;
  expiresAt: string;
  delivery: SecretDeliveryOutboxInput;
  resendNotBefore: string;
}

export const passwordResetStoreToken = Symbol("PasswordResetStore");

export class InMemoryPasswordResetStore implements PasswordResetStore {
  private readonly records: PasswordResetRecord[] = [];
  private readonly confirming = new Set<string>();

  async issue(input: PasswordResetIssueInput): Promise<PasswordResetRecord | undefined> {
    const pending = this.records.find((record) => record.userId === input.userId && record.status === "PENDING");
    if (pending && Date.parse(pending.createdAt) > Date.parse(input.resendNotBefore)) return undefined;

    this.revokePending(input.userId, new Date().toISOString());
    return this.createRecord(input);
  }

  private createRecord(input: Omit<PasswordResetIssueInput, "resendNotBefore">): PasswordResetRecord {
    const now = new Date().toISOString();
    const record: PasswordResetRecord = {
      id: `password-reset-${this.records.length + 1}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      status: "PENDING",
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.records.push(record);
    return { ...record };
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined> {
    return clone(this.records.find((record) => record.tokenHash === tokenHash));
  }

  async findPendingForUser(userId: string): Promise<PasswordResetRecord | undefined> {
    return clone(this.records.find((record) => record.userId === userId && record.status === "PENDING"));
  }

  async markUsed(id: string, usedAt: string): Promise<PasswordResetRecord | undefined> {
    return this.markUsedNow(id, usedAt);
  }

  private markUsedNow(id: string, usedAt: string): PasswordResetRecord | undefined {
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record || record.status !== "PENDING") return undefined;

    record.status = "USED";
    record.usedAt = usedAt;
    record.updatedAt = usedAt;
    this.revokePending(record.userId, usedAt);
    return { ...record };
  }

  async confirm<T>(
    id: string,
    usedAt: string,
    operation: (transaction: PasswordResetTransaction) => Promise<T>,
  ): Promise<T | undefined> {
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record || record.status !== "PENDING" || Date.parse(record.expiresAt) <= Date.parse(usedAt) || this.confirming.has(id)) {
      return undefined;
    }

    this.confirming.add(id);
    const staged: Array<() => void> = [];
    try {
      const result = await operation({ kind: "memory", stage: (change) => staged.push(change) });
      if (record.status !== "PENDING") return undefined;
      for (const change of staged) change();
      return this.markUsedNow(id, usedAt) ? result : undefined;
    } finally {
      this.confirming.delete(id);
    }
  }

  async revokePendingForUser(userId: string): Promise<void> {
    this.revokePending(userId, new Date().toISOString());
  }

  private revokePending(userId: string, now: string): void {
    for (const record of this.records) {
      if (record.userId === userId && record.status === "PENDING") {
        record.status = "REVOKED";
        record.updatedAt = now;
      }
    }
  }
}

export class PostgresPasswordResetStore implements PasswordResetStore {
  constructor(private readonly pool: pg.Pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async issue(input: PasswordResetIssueInput): Promise<PasswordResetRecord | undefined> {
    return this.withClient(async (client) => {
      await lockPasswordResetUser(client, input.userId);
      const pending = await client.query<PasswordResetRow>(
        `${passwordResetSelect('"PasswordResetToken"')}
         WHERE "userId" = $1
           AND "status" = 'PENDING'
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [input.userId],
      );
      if (pending.rows[0] && Date.parse(pending.rows[0].createdAt.toISOString()) > Date.parse(input.resendNotBefore)) {
        return undefined;
      }

      const revoked = await revokePendingForUser(client, input.userId);
      await clearPasswordResetDeliveries(client, revoked, new Date().toISOString());
      return insertPasswordReset(client, input);
    });
  }

  async findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined> {
    return this.withClient(async (client) => {
      const result = await client.query<PasswordResetRow>(
        `${passwordResetSelect('"PasswordResetToken"')}
         WHERE "tokenHash" = $1
         LIMIT 1`,
        [tokenHash],
      );
      return result.rows[0] ? toPasswordResetRecord(result.rows[0]) : undefined;
    });
  }

  async findPendingForUser(userId: string): Promise<PasswordResetRecord | undefined> {
    return this.withClient(async (client) => {
      const result = await client.query<PasswordResetRow>(
        `${passwordResetSelect('"PasswordResetToken"')}
         WHERE "userId" = $1
           AND "status" = 'PENDING'
         ORDER BY "createdAt" DESC
         LIMIT 1`,
        [userId],
      );
      return result.rows[0] ? toPasswordResetRecord(result.rows[0]) : undefined;
    });
  }

  async markUsed(id: string, usedAt: string): Promise<PasswordResetRecord | undefined> {
    return this.withClient(async (client) => {
      return markPasswordResetUsed(client, id, usedAt);
    });
  }

  async confirm<T>(
    id: string,
    usedAt: string,
    operation: (transaction: PasswordResetTransaction) => Promise<T>,
  ): Promise<T | undefined> {
    return this.withClient(async (client) => {
      const consumed = await markPasswordResetUsed(client, id, usedAt);
      if (!consumed) return undefined;
      return operation({
        kind: "postgres",
        async updateUserPassword(input) {
          const updated = await client.query<{ id: string; tenantId: string | null; membershipVersion: number }>(
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
             RETURNING "id", "tenantId", "membershipVersion"`,
            [
              input.userId,
              input.passwordHash,
              input.mustChangePassword ?? null,
              input.passwordChangedAt ?? null,
              input.passwordHashVersion,
            ],
          );
          const user = updated.rows[0];
          if (!user) return false;
          if (user.tenantId) {
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
          return true;
        },
        async revokeUserSessions(userId) {
          await client.query(
            `UPDATE "AuthSession"
             SET "status" = 'REVOKED',
                 "updatedAt" = now()
             WHERE "userId" = $1`,
            [userId],
          );
        },
      });
    });
  }

  async revokePendingForUser(userId: string): Promise<void> {
    await this.withClient(async (client) => {
      await lockPasswordResetUser(client, userId);
      const revoked = await revokePendingForUser(client, userId);
      await clearPasswordResetDeliveries(client, revoked, new Date().toISOString());
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

async function markPasswordResetUsed(
  client: Queryable,
  id: string,
  usedAt: string,
): Promise<PasswordResetRecord | undefined> {
  const owner = await client.query<{ userId: string }>(
    `SELECT "userId" FROM "PasswordResetToken" WHERE "id" = $1 LIMIT 1`,
    [id],
  );
  const userId = owner.rows[0]?.userId;
  if (!userId) return undefined;
  await lockPasswordResetUser(client, userId);
  const result = await client.query<PasswordResetRow>(
    `WITH updated AS (
       UPDATE "PasswordResetToken"
       SET "status" = 'USED',
           "usedAt" = $2,
           "updatedAt" = now()
       WHERE "id" = $1
         AND "status" = 'PENDING'
         AND "expiresAt" > $2::timestamptz
       RETURNING *
     )
     ${passwordResetSelect("updated")}`,
    [id, usedAt],
  );
  if (!result.rows[0]) return undefined;
  const siblingIds = await revokePendingForUser(client, userId, id);
  await clearPasswordResetDeliveries(client, [id, ...siblingIds], usedAt);
  return toPasswordResetRecord(result.rows[0]);
}

async function insertPasswordReset(client: pg.PoolClient, input: PasswordResetIssueInput): Promise<PasswordResetRecord> {
  const result = await client.query<PasswordResetRow>(
    `WITH inserted AS (
       INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "status", "expiresAt", "updatedAt")
       VALUES ($1, $2, $3, 'PENDING', $4, now())
       RETURNING *
     )
     ${passwordResetSelect("inserted")}`,
    [randomUUID(), input.userId, input.tokenHash, input.expiresAt],
  );
  const record = toPasswordResetRecord(result.rows[0]);
  await client.query(
    `INSERT INTO "SecretDeliveryOutbox" (
       "id", "tenantId", "purpose", "sourceId", "payloadEncrypted", "status", "availableAt", "expiresAt", "updatedAt"
     ) VALUES ($1, $2, $3, $4, $5, 'PENDING', now(), $6, now())`,
    [randomUUID(), input.delivery.tenantId ?? null, input.delivery.purpose, record.id, input.delivery.payloadEncrypted, input.delivery.expiresAt],
  );
  return record;
}

async function lockPasswordResetUser(client: Queryable, userId: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [userId],
  );
}

async function revokePendingForUser(client: Queryable, userId: string, exceptId?: string): Promise<string[]> {
  const result = await client.query<{ id: string }>(
    `UPDATE "PasswordResetToken"
     SET "status" = 'REVOKED',
         "updatedAt" = now()
     WHERE "userId" = $1
       AND "status" = 'PENDING'
       ${exceptId ? 'AND "id" <> $2' : ""}
     RETURNING "id"`,
    exceptId ? [userId, exceptId] : [userId],
  );
  return result.rows.map((row) => row.id);
}

async function clearPasswordResetDeliveries(client: Queryable, sourceIds: string[], now: string): Promise<void> {
  if (sourceIds.length === 0) return;
  await client.query(
    `UPDATE "SecretDeliveryOutbox"
     SET "status" = 'EXPIRED',
         "payloadEncrypted" = NULL,
         "claimedAt" = NULL,
         "claimToken" = NULL,
         "lastErrorCode" = NULL,
         "updatedAt" = $2
     WHERE "purpose" = 'PASSWORD_RESET'
       AND "sourceId" = ANY($1::text[])
       AND "payloadEncrypted" IS NOT NULL`,
    [sourceIds, now],
  );
}

export function createPasswordResetStore(): PasswordResetStore {
  return resolvePersistenceDriver(process.env.PASSWORD_RESET_STORE ?? process.env.AUTH_USER_STORE) === "postgres"
    ? new PostgresPasswordResetStore()
    : new InMemoryPasswordResetStore();
}

interface PasswordResetRow {
  id: string;
  userId: string;
  tokenHash: string;
  status: PasswordResetStatus;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function passwordResetSelect(source: string): string {
  return `SELECT
    "id",
    "userId",
    "tokenHash",
    "status",
    "expiresAt" AT TIME ZONE 'UTC' AS "expiresAt",
    "usedAt" AT TIME ZONE 'UTC' AS "usedAt",
    "createdAt" AT TIME ZONE 'UTC' AS "createdAt",
    "updatedAt" AT TIME ZONE 'UTC' AS "updatedAt"
  FROM ${source}`;
}

function toPasswordResetRecord(row: PasswordResetRow | undefined): PasswordResetRecord {
  if (!row) {
    throw new Error("PASSWORD_RESET_RECORD_MISSING");
  }
  return {
    id: row.id,
    userId: row.userId,
    tokenHash: row.tokenHash,
    status: row.status,
    expiresAt: row.expiresAt.toISOString(),
    usedAt: row.usedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function clone(record: PasswordResetRecord | undefined): PasswordResetRecord | undefined {
  return record ? { ...record } : undefined;
}
