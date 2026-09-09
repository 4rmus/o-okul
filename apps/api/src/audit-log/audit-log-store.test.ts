import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresAuditLogStore } from "./audit-log-store.js";

describe("PostgresAuditLogStore", () => {
  it("AuditLog okuma ve yazma akışı için tenant-aware SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('INSERT INTO "AuditLog"')) {
          return {
            rows: [
              {
                id: "audit-log-created",
                tenantId: "tenant-a",
                actorUserId: "user-tenant-a",
                entityType: "SupportTicket",
                entityId: "support-ticket-created",
                action: "support_ticket.created",
                diff: { status: "OPEN" },
                createdAt: new Date("2026-06-08T10:00:00.000Z"),
              },
            ] as T[],
          };
        }
        if (sql.includes("set_config")) {
          return { rows: [] as T[] };
        }
        return {
          rows: [
            {
              id: "audit-log-a",
              tenantId: "tenant-a",
              actorUserId: "user-tenant-a",
              entityType: "SupportTicket",
              entityId: "support-ticket-a",
              action: "support_ticket.created",
              diff: { subject: "Optik dosya yüklenemiyor" },
              createdAt: new Date("2026-06-08T09:00:00.000Z"),
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresAuditLogStore(pool);

    const result = await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        const records = await store.list();
        await store.create({
          tenantId: "tenant-a",
          actorUserId: "user-tenant-a",
          entityType: "SupportTicket",
          entityId: "support-ticket-created",
          action: "support_ticket.created",
          diff: { status: "OPEN" },
          createdAt: "2026-06-08T10:00:00.000Z",
        });
        return records;
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "AuditLog"');
    expect(businessQueries[0]?.sql).toContain("LIMIT 100");
    expect(businessQueries[1]?.sql).toContain('INSERT INTO "AuditLog"');
    expect(businessQueries[1]?.values?.slice(1)).toEqual([
      "tenant-a",
      "user-tenant-a",
      "SupportTicket",
      "support-ticket-created",
      "support_ticket.created",
      { status: "OPEN" },
      "2026-06-08T10:00:00.000Z",
    ]);
    expect(result).toEqual([
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
    ]);
  });
});

it("known-tenant audit is append-only historical data, serialized with reset; failed rollback discards connection", async () => {
  for (const locked of [true, false]) {
    const calls: Array<{ sql: string; values?: unknown[] }> = []; const released: Array<boolean | undefined> = [];
    const input = { tenantId: "tenant-a", actorUserId: "historical-actor", entityType: "Auth", action: "auth.historical", createdAt: "2020-01-01T00:00:00.000Z" };
    const db = { async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
      calls.push({ sql, values });
      if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked }] as T[] };
      if (sql === "ROLLBACK" && !locked) throw new Error("CONNECTION_LOST");
      if (sql.startsWith('INSERT INTO "AuditLog"')) return { rows: [{ ...input, id: "audit-a", createdAt: new Date(input.createdAt) }] as T[] };
      return { rows: [] };
    }, release(destroy?: boolean) { released.push(destroy); } };
    const store = new PostgresAuditLogStore({ query: db.query, connect: async () => db });
    if (locked) { expect(await store.create(input)).toMatchObject({ actorUserId: input.actorUserId, createdAt: input.createdAt }); expect(released).toEqual([undefined]); }
    else { await expect(store.create(input)).rejects.toThrow("TENANT_DATABASE_BUSY"); expect(calls.some(({ sql }) => sql.startsWith("INSERT"))).toBe(false); expect(released).toEqual([true]); }
    expect(calls.some(({ sql }) => /^(UPDATE|DELETE)/.test(sql))).toBe(false);
    expect(calls.some(({ sql }) => sql.includes('FROM "User"') || sql.includes('FROM "Tenant"'))).toBe(false);
  }
});
