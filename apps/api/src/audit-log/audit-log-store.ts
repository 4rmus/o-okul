import { randomUUID } from "node:crypto";
import pg from "pg";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { type TenantQueryable, withBypassRlsQuery, withTenantQuery } from "../db/tenant-query.js";
import type { AuditLogRecord, CreateAuditLogInput } from "./audit-log.service.js";

export interface AuditLogStore {
  list(): Promise<AuditLogRecord[]>;
  listForAdmin?(): Promise<AuditLogRecord[]>;
  create(input: CreateAuditLogInput & { createdAt: string }): Promise<AuditLogRecord>;
}

export const auditLogStoreToken = Symbol("AuditLogStore");

const demoAuditLogs: AuditLogRecord[] = [
  {
    id: "audit-log-a",
    tenantId: "tenant-a",
    actorUserId: "user-tenant-a",
    entityType: "SupportTicket",
    entityId: "support-ticket-a",
    action: "support_ticket.created",
    diff: { subject: "Optik dosya yüklenemiyor" },
    createdAt: "2026-06-08T09:00:00.000Z",
  },
  {
    id: "audit-log-b",
    tenantId: "tenant-b",
    actorUserId: "user-tenant-b",
    entityType: "SupportTicket",
    entityId: "support-ticket-b",
    action: "support_ticket.created",
    diff: { subject: "Tenant B destek talebi" },
    createdAt: "2026-06-08T09:00:00.000Z",
  },
  {
    id: "audit-log-system",
    actorUserId: "user-system",
    entityType: "Auth",
    entityId: "user-system",
    action: "auth.system_login",
    createdAt: "2026-06-08T08:30:00.000Z",
  },
];

export class InMemoryAuditLogStore implements AuditLogStore {
  private readonly records = demoAuditLogs.map((record) => ({ ...record }));

  async list(): Promise<AuditLogRecord[]> {
    return this.records;
  }

  async listForAdmin(): Promise<AuditLogRecord[]> {
    return this.list();
  }

  async create(input: CreateAuditLogInput & { createdAt: string }): Promise<AuditLogRecord> {
    const record = {
      id: `audit-log-${this.records.length + 1}`,
      ...input,
    };
    this.records.push(record);
    return record;
  }
}

export class PostgresAuditLogStore implements AuditLogStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/o_okul",
    }),
  ) {}

  async list(): Promise<AuditLogRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<AuditLogRow>(
        `SELECT * FROM "AuditLog"
         ORDER BY "createdAt" DESC
         LIMIT 100`,
      );
      return result.rows.map(toAuditLogRecord);
    });
  }

  async listForAdmin(): Promise<AuditLogRecord[]> {
    return withBypassRlsQuery(this.pool, async (client) => {
      const result = await client.query<AuditLogRow>(
        `SELECT * FROM "AuditLog"
         ORDER BY "createdAt" DESC
         LIMIT 100`,
      );
      return result.rows.map(toAuditLogRecord);
    });
  }

  async create(input: CreateAuditLogInput & { createdAt: string }): Promise<AuditLogRecord> {
    return withAuditWriteQuery(this.pool, input, async (client) => {
      const result = await client.query<AuditLogRow>(
        `INSERT INTO "AuditLog" ("id", "tenantId", "actorUserId", "entityType", "entityId", "action", "diff", "createdAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [
          randomUUID(),
          input.tenantId ?? null,
          input.actorUserId ?? null,
          input.entityType,
          input.entityId ?? null,
          input.action,
          input.diff ?? null,
          input.createdAt,
        ],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("AUDIT_LOG_CREATE_FAILED");
      }
      return toAuditLogRecord(record);
    });
  }
}

export function createAuditLogStore(): AuditLogStore {
  return resolvePersistenceDriver(process.env.AUDIT_LOG_STORE) === "postgres"
    ? new PostgresAuditLogStore()
    : new InMemoryAuditLogStore();
}

interface AuditLogRow {
  id: string;
  tenantId: string | null;
  actorUserId: string | null;
  entityType: string;
  entityId: string | null;
  action: string;
  diff: Record<string, unknown> | null;
  createdAt: Date | string;
}

function toAuditLogRecord(record: AuditLogRow): AuditLogRecord {
  return {
    id: record.id,
    tenantId: record.tenantId ?? undefined,
    actorUserId: record.actorUserId ?? undefined,
    entityType: record.entityType,
    entityId: record.entityId ?? undefined,
    action: record.action,
    diff: record.diff ?? undefined,
    createdAt: toIsoString(record.createdAt),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

async function withAuditWriteQuery<T>(
  pool: TenantQueryable,
  input: Pick<CreateAuditLogInput, "tenantId">,
  callback: (client: TenantQueryable) => Promise<T>,
): Promise<T> {
  if (!pool.connect) {
    await applyAuditWriteSettings(pool, input);
    return callback(pool);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await applyAuditWriteSettings(client, input);
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

async function applyAuditWriteSettings(
  client: TenantQueryable,
  input: Pick<CreateAuditLogInput, "tenantId">,
): Promise<void> {
  await client.query("SELECT set_config('app.bypass_rls', $1, true)", [input.tenantId ? "false" : "true"]);
  if (input.tenantId) {
    await client.query("SELECT set_config('app.current_tenant_id', $1, true)", [input.tenantId]);
  }
}
