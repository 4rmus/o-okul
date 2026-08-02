import { randomUUID } from "node:crypto";
import type { SecretDeliveryOutboxInput } from "@o-okul/db";
import { resolvePersistenceDriver } from "../config/persistence.js";
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
  revokePendingForUser(userId: string): Promise<void>;
}

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
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record || record.status !== "PENDING") return undefined;

    record.status = "USED";
    record.usedAt = usedAt;
    record.updatedAt = usedAt;
    this.revokePending(record.userId, usedAt);
    return { ...record };
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
           RETURNING *
         )
         ${passwordResetSelect("updated")}`,
        [id, usedAt],
      );
      if (!result.rows[0]) return undefined;
      const siblingIds = await revokePendingForUser(client, userId, id);
      await clearPasswordResetDeliveries(client, [id, ...siblingIds], usedAt);
      return toPasswordResetRecord(result.rows[0]);
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

async function lockPasswordResetUser(client: pg.PoolClient, userId: string): Promise<void> {
  await client.query(
    `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
    [userId],
  );
}

async function revokePendingForUser(client: pg.PoolClient, userId: string, exceptId?: string): Promise<string[]> {
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

async function clearPasswordResetDeliveries(client: pg.PoolClient, sourceIds: string[], now: string): Promise<void> {
  if (sourceIds.length === 0) return;
  await client.query(
    `UPDATE "SecretDeliveryOutbox"
     SET "status" = 'EXPIRED',
         "payloadEncrypted" = NULL,
         "claimedAt" = NULL,
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
