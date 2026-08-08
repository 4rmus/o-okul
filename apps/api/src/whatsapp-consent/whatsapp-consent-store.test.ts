import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresWhatsAppConsentStore } from "./whatsapp-consent-store.js";

const decision = {
  studentContactId: "contact-a",
  purpose: "UTILITY_ANNOUNCEMENT" as const,
  eventType: "GRANTED" as const,
  noticeVersion: "wa-utility-v1",
  source: "CONTACT_SELF_SERVICE" as const,
  commandKey: "command-a",
};

const commandKeyHash = hashValue("o-okul:whatsapp-consent:command:v1", decision.commandKey);
const requestHash = requestHashFor(decision);

const eventRow = {
  id: "event-a",
  tenantId: "tenant-a",
  whatsappConsentId: "consent-a",
  studentContactId: "contact-a",
  purpose: "UTILITY_ANNOUNCEMENT" as const,
  sequence: 1,
  eventType: "GRANTED" as const,
  noticeVersion: "wa-utility-v1",
  source: "CONTACT_SELF_SERVICE" as const,
  recordedAt: new Date("2026-08-08T17:00:00.000Z"),
  commandKeyHash,
  requestHash,
};

describe("PostgresWhatsAppConsentStore", () => {
  it("telefon hashini aktif StudentContact kaydından çözüp immutable event ekler", async () => {
    const { pool, queries } = createPool((sql) => {
      if (sql.includes('FROM "StudentContact"') && !sql.includes("JOIN")) return [{ phoneHash: "c".repeat(64) }];
      if (sql.includes('FROM "WhatsAppConsent"')) return [{ id: "consent-a" }];
      if (sql.includes('INSERT INTO "WhatsAppConsentEvent"')) return [eventRow];
      return [];
    });
    const store = new PostgresWhatsAppConsentStore(pool);

    await expect(withTenantContext(() => store.recordDecision(decision))).resolves.toEqual({
      id: "event-a",
      tenantId: "tenant-a",
      whatsappConsentId: "consent-a",
      studentContactId: "contact-a",
      purpose: "UTILITY_ANNOUNCEMENT",
      sequence: 1,
      eventType: "GRANTED",
      noticeVersion: "wa-utility-v1",
      source: "CONTACT_SELF_SERVICE",
      recordedAt: "2026-08-08T17:00:00.000Z",
    });
    const contactQuery = queries.find((query) => query.sql.includes('FROM "StudentContact"'));
    expect(contactQuery?.sql).toContain('"deletedAt" IS NULL');
    expect(contactQuery?.values).toEqual(["tenant-a", "contact-a"]);
    const eventInsert = queries.find((query) => query.sql.includes('INSERT INTO "WhatsAppConsentEvent"'));
    expect(eventInsert?.sql).not.toContain('"phoneHash"');
    expect(eventInsert?.sql.split("RETURNING")[0]).not.toContain('"recordedAt"');
    expect(eventInsert?.values).not.toContain("c".repeat(64));
    expect(eventInsert?.values?.slice(-2)).toEqual([commandKeyHash, requestHash]);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("silinmiş, hash'i kaldırılmış veya tenant dışında kalan contact için fail-closed davranır", async () => {
    const { pool, queries } = createPool(() => []);
    const store = new PostgresWhatsAppConsentStore(pool);

    await expect(withTenantContext(() => store.recordDecision(decision))).rejects.toThrow("WHATSAPP_CONSENT_CONTACT_INACTIVE");
    expect(queries.some((query) => query.sql.includes('INSERT INTO "WhatsAppConsent"'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("aynı canonical command ve payload tekrarında mevcut immutable eventi döndürür", async () => {
    const { pool, queries } = createPool((sql) => {
      if (sql.includes('FROM "WhatsAppConsentEvent"')) return [eventRow];
      return [];
    });
    const store = new PostgresWhatsAppConsentStore(pool);

    await expect(withTenantContext(() => store.recordDecision(decision))).resolves.toMatchObject({ id: "event-a", sequence: 1 });
    expect(queries.find((query) => query.sql.includes('FROM "WhatsAppConsentEvent"'))?.values)
      .toEqual(["tenant-a", commandKeyHash]);
    expect(queries.some((query) => query.sql.includes('FROM "StudentContact"'))).toBe(false);
  });

  it.each([
    ["eventType", { eventType: "WITHDRAWN" as const }],
    ["studentContactId", { studentContactId: "contact-b" }],
    ["source", { source: "TENANT_ADMIN_DOCUMENTED" as const }],
  ])("aynı command farklı %s ile tekrar kullanılırsa contact'tan önce conflict verir", async (_field, change) => {
    const { pool, queries } = createPool((sql) => sql.includes('FROM "WhatsAppConsentEvent"') ? [eventRow] : []);
    const store = new PostgresWhatsAppConsentStore(pool);

    await expect(withTenantContext(() => store.recordDecision({ ...decision, ...change })))
      .rejects.toThrow("WHATSAPP_CONSENT_IDEMPOTENCY_CONFLICT");
    expect(queries.some((query) => query.sql.includes('FROM "StudentContact"'))).toBe(false);
  });

  it("trigger idempotent tekrarında INSERT RETURNING boşsa event'i hashleriyle yeniden okur", async () => {
    let eventReadCount = 0;
    const { pool, queries } = createPool((sql) => {
      if (sql.includes('FROM "WhatsAppConsentEvent"')) {
        eventReadCount += 1;
        return eventReadCount === 1 ? [] : [eventRow];
      }
      if (sql.includes('FROM "StudentContact"') && !sql.includes("JOIN")) return [{ phoneHash: "c".repeat(64) }];
      if (sql.includes('FROM "WhatsAppConsent"')) return [{ id: "consent-a" }];
      if (sql.includes('INSERT INTO "WhatsAppConsentEvent"')) return [];
      return [];
    });
    const store = new PostgresWhatsAppConsentStore(pool);

    await expect(withTenantContext(() => store.recordDecision(decision))).resolves.toMatchObject({ id: "event-a" });
    const eventReads = queries.filter((query) => query.sql.includes('FROM "WhatsAppConsentEvent"'));
    expect(eventReads).toHaveLength(2);
    expect(eventReads[1]?.values).toEqual(["tenant-a", commandKeyHash, requestHash]);
  });

  it("paralel command unique yarışını domain conflict hatasına çevirir", async () => {
    const { pool, queries } = createPool((sql) => {
      if (sql.includes('FROM "WhatsAppConsentEvent"')) return [];
      if (sql.includes('FROM "StudentContact"') && !sql.includes("JOIN")) return [{ phoneHash: "c".repeat(64) }];
      if (sql.includes('FROM "WhatsAppConsent"')) return [{ id: "consent-a" }];
      if (sql.includes('INSERT INTO "WhatsAppConsentEvent"')) {
        throw Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
          constraint: "WhatsAppConsentEvent_tenantId_commandKeyHash_key",
        });
      }
      return [];
    });
    const store = new PostgresWhatsAppConsentStore(pool);

    await expect(withTenantContext(() => store.recordDecision(decision)))
      .rejects.toThrow("WHATSAPP_CONSENT_IDEMPOTENCY_CONFLICT");
    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
  });

  it("current lookup'ı aktif contact ve DB-derived eşit phoneHash ile sınırlar", async () => {
    const current = {
      id: "consent-a",
      tenantId: "tenant-a",
      studentContactId: "contact-a",
      purpose: "UTILITY_ANNOUNCEMENT",
      canReceiveWhatsapp: true,
      version: 3,
      noticeVersion: "wa-utility-v1",
      source: "CONTACT_SELF_SERVICE",
      recordedAt: "2026-08-08T17:00:00.000Z",
      withdrawnAt: null,
    };
    const { pool, queries } = createPool((sql) => sql.includes('JOIN "WhatsAppConsent"') ? [current] : []);
    const store = new PostgresWhatsAppConsentStore(pool);

    await expect(withTenantContext(() => store.hasActiveConsent({
      studentContactId: "contact-a",
      purpose: "UTILITY_ANNOUNCEMENT",
    }))).resolves.toBe(true);
    const lookup = queries.find((query) => query.sql.includes('JOIN "WhatsAppConsent"'));
    expect(lookup?.sql).toContain('consent."phoneHash" = contact."phoneHash"');
    expect(lookup?.sql).toContain('contact."deletedAt" IS NULL');
    expect(lookup?.sql).toContain('latest_event."sequence" = consent."version"');
    expect(lookup?.sql).toContain('latest_contact."phoneHash" = consent."phoneHash"');
    expect(lookup?.sql).toContain('latest_contact."deletedAt" IS NULL');
    expect(lookup?.values).toEqual(["tenant-a", "contact-a", "UTILITY_ANNOUNCEMENT"]);
  });

  it("tenantId olmayan request context ile DB erişimini reddeder", async () => {
    const { pool } = createPool(() => []);
    const store = new PostgresWhatsAppConsentStore(pool);

    await expect(runWithRequestContext(
      { userId: "system", tenantId: null, roles: ["SYSTEM_ADMIN"], bypassRls: false },
      () => store.recordDecision(decision),
    )).rejects.toThrow("TENANT_CONTEXT_MISSING");
    await expect(runWithRequestContext(
      { userId: "system", tenantId: null, roles: ["SYSTEM_ADMIN"], bypassRls: true },
      () => store.recordDecision(decision),
    )).rejects.toThrow("TENANT_CONTEXT_MISSING");
  });
});

function withTenantContext<T>(callback: () => T): T {
  return runWithRequestContext(
    { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
    callback,
  );
}

function createPool(respond: (sql: string, values?: unknown[]) => unknown[]) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    async query<T>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      return { rows: respond(sql, values) as T[] };
    },
    release() {},
  };
  return {
    queries,
    pool: {
      async query<T>(sql: string, values?: unknown[]) {
        return client.query<T>(sql, values);
      },
      async connect() {
        return client;
      },
    },
  };
}

function requestHashFor(input: typeof decision): string {
  return hashValue("o-okul:whatsapp-consent:request:v1", JSON.stringify({
    studentContactId: input.studentContactId,
    purpose: input.purpose,
    eventType: input.eventType,
    noticeVersion: input.noticeVersion,
    source: input.source,
  }));
}

function hashValue(domain: string, value: string): string {
  return createHash("sha256").update(domain).update("\0").update(value).digest("hex");
}
