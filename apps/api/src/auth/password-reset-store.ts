import { randomUUID } from "node:crypto";
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
  create(input: { userId: string; tokenHash: string; expiresAt: string }): Promise<PasswordResetRecord>;
  findByTokenHash(tokenHash: string): Promise<PasswordResetRecord | undefined>;
  markUsed(id: string, usedAt: string): Promise<PasswordResetRecord | undefined>;
  revokePendingForUser(userId: string): Promise<void>;
}

export const passwordResetStoreToken = Symbol("PasswordResetStore");

export class InMemoryPasswordResetStore implements PasswordResetStore {
  private readonly records: PasswordResetRecord[] = [];

  async create(input: { userId: string; tokenHash: string; expiresAt: string }): Promise<PasswordResetRecord> {
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

  async markUsed(id: string, usedAt: string): Promise<PasswordResetRecord | undefined> {
    const record = this.records.find((candidate) => candidate.id === id);
    if (!record) return undefined;

    record.status = "USED";
    record.usedAt = usedAt;
    record.updatedAt = usedAt;
    return { ...record };
  }

  async revokePendingForUser(userId: string): Promise<void> {
    const now = new Date().toISOString();
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

  async create(input: { userId: string; tokenHash: string; expiresAt: string }): Promise<PasswordResetRecord> {
    return this.withClient(async (client) => {
      const result = await client.query<PasswordResetRow>(
        `WITH inserted AS (
           INSERT INTO "PasswordResetToken" ("id", "userId", "tokenHash", "status", "expiresAt", "updatedAt")
           VALUES ($1, $2, $3, 'PENDING', $4, now())
           RETURNING *
         )
         ${passwordResetSelect("inserted")}`,
        [randomUUID(), input.userId, input.tokenHash, input.expiresAt],
      );
      return toPasswordResetRecord(result.rows[0]);
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

  async markUsed(id: string, usedAt: string): Promise<PasswordResetRecord | undefined> {
    return this.withClient(async (client) => {
      const result = await client.query<PasswordResetRow>(
        `WITH updated AS (
           UPDATE "PasswordResetToken"
           SET "status" = 'USED',
               "usedAt" = $2,
               "updatedAt" = now()
           WHERE "id" = $1
           RETURNING *
         )
         ${passwordResetSelect("updated")}`,
        [id, usedAt],
      );
      return result.rows[0] ? toPasswordResetRecord(result.rows[0]) : undefined;
    });
  }

  async revokePendingForUser(userId: string): Promise<void> {
    await this.withClient(async (client) => {
      await client.query(
        `UPDATE "PasswordResetToken"
         SET "status" = 'REVOKED',
             "updatedAt" = now()
         WHERE "userId" = $1
           AND "status" = 'PENDING'`,
        [userId],
      );
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
