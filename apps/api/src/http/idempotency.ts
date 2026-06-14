import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import type { RequestContext } from "../context/request-context.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export const idempotencyStoreToken = Symbol("IdempotencyStore");

export interface IdempotencyStartInput {
  tenantId: string;
  key: string;
  operation: string;
  requestHash: string;
}

export type IdempotencyStartResult =
  | { kind: "started" }
  | { kind: "replay"; responseBody: unknown }
  | { kind: "in_progress" }
  | { kind: "mismatch" };

export interface IdempotencyStore {
  start(input: IdempotencyStartInput): Promise<IdempotencyStartResult>;
  complete(input: IdempotencyStartInput & { responseBody: unknown }): Promise<void>;
  release(input: IdempotencyStartInput): Promise<void>;
}

interface IdempotencyRecord {
  requestHash: string;
  status: "IN_PROGRESS" | "COMPLETED";
  responseBody?: unknown;
}

const maxIdempotencyKeyLength = 128;
const idempotencyKeyPattern = /^[A-Za-z0-9._:-]+$/;

@Injectable()
export class IdempotencyService {
  constructor(@Inject(idempotencyStoreToken) private readonly store: IdempotencyStore) {}

  async run<T>(
    context: RequestContext,
    options: { key?: string; operation: string; request: unknown },
    callback: () => Promise<T>,
  ): Promise<T> {
    const key = normalizeIdempotencyKey(options.key);
    if (!key) return callback();
    if (!context.tenantId) {
      throw new BadRequestException("IDEMPOTENCY_TENANT_REQUIRED");
    }

    const input = {
      tenantId: context.tenantId,
      key,
      operation: options.operation,
      requestHash: hashIdempotencyRequest(options.operation, options.request),
    };
    const start = await this.store.start(input);
    if (start.kind === "replay") {
      return start.responseBody as T;
    }
    if (start.kind === "mismatch") {
      throw new ConflictException("IDEMPOTENCY_KEY_BODY_MISMATCH");
    }
    if (start.kind === "in_progress") {
      throw new ConflictException("IDEMPOTENCY_KEY_IN_PROGRESS");
    }

    try {
      const responseBody = await callback();
      await this.store.complete({ ...input, responseBody });
      return responseBody;
    } catch (error) {
      await this.store.release(input);
      throw error;
    }
  }
}

export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly records = new Map<string, IdempotencyRecord>();

  async start(input: IdempotencyStartInput): Promise<IdempotencyStartResult> {
    const mapKey = recordKey(input);
    const existing = this.records.get(mapKey);
    if (!existing) {
      this.records.set(mapKey, { requestHash: input.requestHash, status: "IN_PROGRESS" });
      return { kind: "started" };
    }

    return toStartResult(existing, input.requestHash);
  }

  async complete(input: IdempotencyStartInput & { responseBody: unknown }): Promise<void> {
    this.records.set(recordKey(input), {
      requestHash: input.requestHash,
      responseBody: cloneJson(input.responseBody),
      status: "COMPLETED",
    });
  }

  async release(input: IdempotencyStartInput): Promise<void> {
    const mapKey = recordKey(input);
    const existing = this.records.get(mapKey);
    if (existing?.requestHash === input.requestHash && existing.status === "IN_PROGRESS") {
      this.records.delete(mapKey);
    }
  }
}

export class PostgresIdempotencyStore implements IdempotencyStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async start(input: IdempotencyStartInput): Promise<IdempotencyStartResult> {
    return withTenantQuery(this.pool, async (client) => {
      const inserted = await client.query<IdempotencyRow>(
        `INSERT INTO "IdempotencyKey" ("tenantId", "key", "operation", "requestHash", "status", "updatedAt")
         VALUES ($1, $2, $3, $4, 'IN_PROGRESS', now())
         ON CONFLICT ("tenantId", "key", "operation") DO NOTHING
         RETURNING "requestHash", "status", "responseBody"`,
        [input.tenantId, input.key, input.operation, input.requestHash],
      );
      const insertedRecord = inserted.rows[0];
      if (insertedRecord) return { kind: "started" };

      const existing = await client.query<IdempotencyRow>(
        `SELECT "requestHash", "status", "responseBody"
         FROM "IdempotencyKey"
         WHERE "tenantId" = $1 AND "key" = $2 AND "operation" = $3
         LIMIT 1`,
        [input.tenantId, input.key, input.operation],
      );
      const record = existing.rows[0];
      if (!record) return { kind: "started" };
      return toStartResult(toRecord(record), input.requestHash);
    });
  }

  async complete(input: IdempotencyStartInput & { responseBody: unknown }): Promise<void> {
    await withTenantQuery(this.pool, async (client) => {
      await client.query(
        `UPDATE "IdempotencyKey"
         SET "status" = 'COMPLETED',
             "responseBody" = $5::jsonb,
             "completedAt" = now(),
             "updatedAt" = now()
         WHERE "tenantId" = $1 AND "key" = $2 AND "operation" = $3 AND "requestHash" = $4`,
        [input.tenantId, input.key, input.operation, input.requestHash, serializeJson(input.responseBody)],
      );
    });
  }

  async release(input: IdempotencyStartInput): Promise<void> {
    await withTenantQuery(this.pool, async (client) => {
      await client.query(
        `DELETE FROM "IdempotencyKey"
         WHERE "tenantId" = $1 AND "key" = $2 AND "operation" = $3 AND "requestHash" = $4 AND "status" = 'IN_PROGRESS'`,
        [input.tenantId, input.key, input.operation, input.requestHash],
      );
    });
  }
}

export function createIdempotencyStore(env = process.env): IdempotencyStore {
  const explicit = env.IDEMPOTENCY_STORE;
  if (env.NODE_ENV === "production" && explicit === "memory") {
    throw new Error('IDEMPOTENCY_STORE must be "postgres" in production.');
  }
  const usePostgres =
    explicit === "postgres" ||
    (explicit === undefined && resolvePersistenceDriver(env.PERSISTENCE_DRIVER, env) === "postgres");
  return usePostgres ? new PostgresIdempotencyStore() : new InMemoryIdempotencyStore();
}

export function hashIdempotencyRequest(operation: string, request: unknown): string {
  return createHash("sha256").update(canonicalJson({ operation, request })).digest("hex");
}

function normalizeIdempotencyKey(key: string | undefined): string | undefined {
  const trimmed = key?.trim();
  if (!trimmed) return undefined;
  if (trimmed.length > maxIdempotencyKeyLength || !idempotencyKeyPattern.test(trimmed)) {
    throw new BadRequestException("IDEMPOTENCY_KEY_INVALID");
  }
  return trimmed;
}

function toStartResult(record: IdempotencyRecord, requestHash: string): IdempotencyStartResult {
  if (record.requestHash !== requestHash) return { kind: "mismatch" };
  if (record.status === "COMPLETED") return { kind: "replay", responseBody: cloneJson(record.responseBody) };
  return { kind: "in_progress" };
}

function recordKey(input: Pick<IdempotencyStartInput, "tenantId" | "key" | "operation">): string {
  return `${input.tenantId}\0${input.operation}\0${input.key}`;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalJson(entryValue)}`).join(",")}}`;
}

function cloneJson<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function serializeJson(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

interface IdempotencyRow {
  requestHash: string;
  status: "IN_PROGRESS" | "COMPLETED";
  responseBody: unknown;
}

function toRecord(row: IdempotencyRow): IdempotencyRecord {
  return {
    requestHash: row.requestHash,
    responseBody: row.responseBody,
    status: row.status,
  };
}
