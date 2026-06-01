import { randomUUID } from "node:crypto";
import pg from "pg";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";
import type { MessageTemplateRecord } from "./message-template.service.js";

export interface MessageTemplateStore {
  list(): Promise<MessageTemplateRecord[]>;
  findById(id: string): Promise<MessageTemplateRecord | undefined>;
  create(input: Omit<MessageTemplateRecord, "id">): Promise<MessageTemplateRecord>;
  update(
    id: string,
    input: Pick<MessageTemplateRecord, "name" | "channel" | "body">,
  ): Promise<MessageTemplateRecord | undefined>;
  softDelete(id: string, deletedAt: string): Promise<MessageTemplateRecord | undefined>;
}

export const messageTemplateStoreToken = Symbol("MessageTemplateStore");

const demoTemplates: MessageTemplateRecord[] = [
  {
    id: "message-template-a",
    tenantId: "tenant-a",
    name: "Deneme sınavı hatırlatma",
    channel: "SMS",
    body: "Sayın veli, öğrencimizin deneme sınavı Pazartesi günü yapılacaktır.",
  },
  {
    id: "message-template-b",
    tenantId: "tenant-b",
    name: "Tenant B şablonu",
    channel: "SMS",
    body: "Tenant B mesajı",
  },
];

export class InMemoryMessageTemplateStore implements MessageTemplateStore {
  private readonly templates = demoTemplates.map((record) => ({ ...record }));

  async list(): Promise<MessageTemplateRecord[]> {
    return this.templates;
  }

  async findById(id: string): Promise<MessageTemplateRecord | undefined> {
    return this.templates.find((candidate) => candidate.id === id);
  }

  async create(input: Omit<MessageTemplateRecord, "id">): Promise<MessageTemplateRecord> {
    const record = {
      id: `message-template-${this.templates.length + 1}`,
      ...input,
    };
    this.templates.push(record);
    return record;
  }

  async update(
    id: string,
    input: Pick<MessageTemplateRecord, "name" | "channel" | "body">,
  ): Promise<MessageTemplateRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.name = input.name;
    record.channel = input.channel;
    record.body = input.body;
    return record;
  }

  async softDelete(id: string, deletedAt: string): Promise<MessageTemplateRecord | undefined> {
    const record = await this.findById(id);
    if (!record) return undefined;

    record.deletedAt = deletedAt;
    return record;
  }
}

export class PostgresMessageTemplateStore implements MessageTemplateStore {
  constructor(
    private readonly pool: TenantQueryable = new pg.Pool({
      connectionString: process.env.DATABASE_URL ?? "postgresql://app:app@localhost:5432/uzman_hocam",
    }),
  ) {}

  async list(): Promise<MessageTemplateRecord[]> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<MessageTemplateRow>(
        `SELECT * FROM "MessageTemplate"
         ORDER BY "createdAt" DESC`,
      );
      return result.rows.map(toMessageTemplateRecord);
    });
  }

  async findById(id: string): Promise<MessageTemplateRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<MessageTemplateRow>(
        `SELECT * FROM "MessageTemplate" WHERE "id" = $1 LIMIT 1`,
        [id],
      );
      return result.rows[0] ? toMessageTemplateRecord(result.rows[0]) : undefined;
    });
  }

  async create(input: Omit<MessageTemplateRecord, "id">): Promise<MessageTemplateRecord> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<MessageTemplateRow>(
        `INSERT INTO "MessageTemplate" ("id", "tenantId", "name", "channel", "body", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, now())
         RETURNING *`,
        [randomUUID(), input.tenantId, input.name, input.channel, input.body],
      );
      const record = result.rows[0];
      if (!record) {
        throw new Error("MESSAGE_TEMPLATE_CREATE_FAILED");
      }
      return toMessageTemplateRecord(record);
    });
  }

  async update(
    id: string,
    input: Pick<MessageTemplateRecord, "name" | "channel" | "body">,
  ): Promise<MessageTemplateRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<MessageTemplateRow>(
        `UPDATE "MessageTemplate"
         SET "name" = $2,
             "channel" = $3,
             "body" = $4,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, input.name, input.channel, input.body],
      );
      return result.rows[0] ? toMessageTemplateRecord(result.rows[0]) : undefined;
    });
  }

  async softDelete(id: string, deletedAt: string): Promise<MessageTemplateRecord | undefined> {
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<MessageTemplateRow>(
        `UPDATE "MessageTemplate"
         SET "deletedAt" = $2,
             "updatedAt" = now()
         WHERE "id" = $1
         RETURNING *`,
        [id, deletedAt],
      );
      return result.rows[0] ? toMessageTemplateRecord(result.rows[0]) : undefined;
    });
  }
}

export function createMessageTemplateStore(): MessageTemplateStore {
  return process.env.MESSAGE_TEMPLATE_STORE === "postgres"
    ? new PostgresMessageTemplateStore()
    : new InMemoryMessageTemplateStore();
}

interface MessageTemplateRow {
  id: string;
  tenantId: string;
  name: string;
  channel: MessageTemplateRecord["channel"];
  body: string;
  deletedAt: Date | string | null;
}

function toMessageTemplateRecord(record: MessageTemplateRow): MessageTemplateRecord {
  return {
    id: record.id,
    tenantId: record.tenantId,
    name: record.name,
    channel: record.channel,
    body: record.body,
    deletedAt: record.deletedAt ? toIsoString(record.deletedAt) : undefined,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}
