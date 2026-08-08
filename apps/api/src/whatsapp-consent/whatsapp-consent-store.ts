import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { getRequestContext } from "../context/request-context.js";
import { type TenantQueryable, withTenantQuery } from "../db/tenant-query.js";

export type WhatsAppConsentPurpose = "UTILITY_ANNOUNCEMENT";
export type WhatsAppConsentEventType = "GRANTED" | "WITHDRAWN";
export type WhatsAppConsentSource = "CONTACT_SELF_SERVICE" | "TENANT_ADMIN_DOCUMENTED";

export interface RecordWhatsAppConsentDecisionInput {
  studentContactId: string;
  purpose: WhatsAppConsentPurpose;
  eventType: WhatsAppConsentEventType;
  noticeVersion: string;
  source: WhatsAppConsentSource;
  commandKey: string;
}

export interface FindWhatsAppConsentInput {
  studentContactId: string;
  purpose: WhatsAppConsentPurpose;
}

export interface WhatsAppConsentEventRecord {
  id: string;
  tenantId: string;
  whatsappConsentId: string;
  studentContactId: string;
  purpose: WhatsAppConsentPurpose;
  sequence: number;
  eventType: WhatsAppConsentEventType;
  noticeVersion: string;
  source: WhatsAppConsentSource;
  recordedAt: string;
}

export interface WhatsAppConsentCurrentRecord {
  id: string;
  tenantId: string;
  studentContactId: string;
  purpose: WhatsAppConsentPurpose;
  canReceiveWhatsapp: boolean;
  version: number;
  noticeVersion: string;
  source: string;
  recordedAt: string;
  withdrawnAt?: string;
}

export class PostgresWhatsAppConsentStore {
  constructor(private readonly pool: TenantQueryable = new pg.Pool({ connectionString: process.env.DATABASE_URL })) {}

  async recordDecision(input: RecordWhatsAppConsentDecisionInput): Promise<WhatsAppConsentEventRecord> {
    const tenantId = requireStoreTenantId();
    const commandKey = input.commandKey.trim();
    if (!commandKey) throw new Error("WHATSAPP_CONSENT_COMMAND_KEY_REQUIRED");
    const commandKeyHash = hashValue("o-okul:whatsapp-consent:command:v1", commandKey);
    const requestHash = hashValue("o-okul:whatsapp-consent:request:v1", JSON.stringify({
      studentContactId: input.studentContactId,
      purpose: input.purpose,
      eventType: input.eventType,
      noticeVersion: input.noticeVersion,
      source: input.source,
    }));
    return withTenantQuery(this.pool, async (client) => {
      const prior = await client.query<WhatsAppConsentEventRow>(
        `SELECT "id", "tenantId", "whatsappConsentId", "studentContactId", "purpose", "sequence",
                "eventType", "noticeVersion", "source", "recordedAt", "commandKeyHash", "requestHash"
         FROM "WhatsAppConsentEvent"
         WHERE "tenantId" = $1 AND "commandKeyHash" = $2`,
        [tenantId, commandKeyHash],
      );
      const priorEvent = prior.rows[0];
      if (priorEvent) {
        if (priorEvent.requestHash !== requestHash) throw new Error("WHATSAPP_CONSENT_IDEMPOTENCY_CONFLICT");
        return mapEvent(priorEvent);
      }

      const contact = await client.query<{ phoneHash: string }>(
        `SELECT "phoneHash"
         FROM "StudentContact"
         WHERE "tenantId" = $1
           AND "id" = $2
           AND "deletedAt" IS NULL
           AND "phoneHash" IS NOT NULL`,
        [tenantId, input.studentContactId],
      );
      const phoneHash = contact.rows[0]?.phoneHash;
      if (!phoneHash) throw new Error("WHATSAPP_CONSENT_CONTACT_INACTIVE");

      await client.query(
        `INSERT INTO "WhatsAppConsent" (
           "id", "tenantId", "phoneHash", "purpose", "noticeVersion", "source", "recordedAt", "updatedAt"
         ) VALUES ($1, $2, $3, $4, 'UNRECORDED', 'UNRECORDED', now(), now())
         ON CONFLICT ("tenantId", "phoneHash", "purpose") DO NOTHING`,
        [randomUUID(), tenantId, phoneHash, input.purpose],
      );

      const projection = await client.query<{ id: string }>(
        `SELECT "id"
         FROM "WhatsAppConsent"
         WHERE "tenantId" = $1 AND "phoneHash" = $2 AND "purpose" = $3`,
        [tenantId, phoneHash, input.purpose],
      );
      const whatsappConsentId = projection.rows[0]?.id;
      if (!whatsappConsentId) throw new Error("WHATSAPP_CONSENT_PROJECTION_CREATE_FAILED");

      let inserted;
      try {
        inserted = await client.query<WhatsAppConsentEventRow>(
          `INSERT INTO "WhatsAppConsentEvent" (
             "id", "tenantId", "whatsappConsentId", "studentContactId", "purpose", "sequence",
             "eventType", "noticeVersion", "source", "commandKeyHash", "requestHash"
           ) VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $9, $10)
           RETURNING "id", "tenantId", "whatsappConsentId", "studentContactId", "purpose", "sequence",
                     "eventType", "noticeVersion", "source", "recordedAt", "commandKeyHash", "requestHash"`,
          [
            randomUUID(),
            tenantId,
            whatsappConsentId,
            input.studentContactId,
            input.purpose,
            input.eventType,
            input.noticeVersion,
            input.source,
            commandKeyHash,
            requestHash,
          ],
        );
      } catch (error) {
        if (isIdempotencyConflict(error)) throw new Error("WHATSAPP_CONSENT_IDEMPOTENCY_CONFLICT");
        throw error;
      }

      const event = inserted.rows[0] ?? (await client.query<WhatsAppConsentEventRow>(
        `SELECT "id", "tenantId", "whatsappConsentId", "studentContactId", "purpose", "sequence",
                "eventType", "noticeVersion", "source", "recordedAt", "commandKeyHash", "requestHash"
         FROM "WhatsAppConsentEvent"
         WHERE "tenantId" = $1 AND "commandKeyHash" = $2 AND "requestHash" = $3`,
        [tenantId, commandKeyHash, requestHash],
      )).rows[0];

      if (!event) throw new Error("WHATSAPP_CONSENT_EVENT_CREATE_FAILED");
      return mapEvent(event);
    });
  }

  async findCurrent(input: FindWhatsAppConsentInput): Promise<WhatsAppConsentCurrentRecord | undefined> {
    const tenantId = requireStoreTenantId();
    return withTenantQuery(this.pool, async (client) => {
      const result = await client.query<WhatsAppConsentCurrentRow>(
        `SELECT consent."id", consent."tenantId", contact."id" AS "studentContactId", consent."purpose",
                consent."canReceiveWhatsapp", consent."version", consent."noticeVersion", consent."source",
                consent."recordedAt", consent."withdrawnAt"
         FROM "StudentContact" contact
         JOIN "WhatsAppConsent" consent
           ON consent."tenantId" = contact."tenantId"
          AND consent."phoneHash" = contact."phoneHash"
          AND consent."purpose" = $3
         JOIN "WhatsAppConsentEvent" latest_event
           ON latest_event."tenantId" = consent."tenantId"
          AND latest_event."whatsappConsentId" = consent."id"
          AND latest_event."sequence" = consent."version"
         JOIN "StudentContact" latest_contact
           ON latest_contact."tenantId" = latest_event."tenantId"
          AND latest_contact."id" = latest_event."studentContactId"
          AND latest_contact."deletedAt" IS NULL
          AND latest_contact."phoneHash" = consent."phoneHash"
         WHERE contact."tenantId" = $1
           AND contact."id" = $2
           AND contact."deletedAt" IS NULL
           AND contact."phoneHash" IS NOT NULL`,
        [tenantId, input.studentContactId, input.purpose],
      );
      return result.rows[0] ? mapCurrent(result.rows[0]) : undefined;
    });
  }

  async hasActiveConsent(input: FindWhatsAppConsentInput): Promise<boolean> {
    return (await this.findCurrent(input))?.canReceiveWhatsapp === true;
  }
}

interface WhatsAppConsentEventRow extends Omit<WhatsAppConsentEventRecord, "recordedAt"> {
  recordedAt: Date | string;
  commandKeyHash: string;
  requestHash: string;
}

interface WhatsAppConsentCurrentRow extends Omit<WhatsAppConsentCurrentRecord, "recordedAt" | "withdrawnAt"> {
  recordedAt: Date | string;
  withdrawnAt: Date | string | null;
}

function mapEvent(row: WhatsAppConsentEventRow): WhatsAppConsentEventRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    whatsappConsentId: row.whatsappConsentId,
    studentContactId: row.studentContactId,
    purpose: row.purpose,
    sequence: row.sequence,
    eventType: row.eventType,
    noticeVersion: row.noticeVersion,
    source: row.source,
    recordedAt: toIsoString(row.recordedAt),
  };
}

function mapCurrent(row: WhatsAppConsentCurrentRow): WhatsAppConsentCurrentRecord {
  return {
    ...row,
    recordedAt: toIsoString(row.recordedAt),
    withdrawnAt: row.withdrawnAt ? toIsoString(row.withdrawnAt) : undefined,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function isIdempotencyConflict(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && error.code === "23505"
    && (("constraint" in error
      && error.constraint === "WhatsAppConsentEvent_tenantId_commandKeyHash_key")
      || ("message" in error
        && String(error.message).includes("WHATSAPP_CONSENT_IDEMPOTENCY_CONFLICT")));
}

function requireStoreTenantId(): string {
  const tenantId = getRequestContext().tenantId;
  if (!tenantId) throw new Error("TENANT_CONTEXT_MISSING");
  return tenantId;
}

function hashValue(domain: string, value: string): string {
  return createHash("sha256").update(domain).update("\0").update(value).digest("hex");
}
