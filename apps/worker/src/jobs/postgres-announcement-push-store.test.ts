import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@o-okul/db";
import { PostgresAnnouncementPushStore } from "./postgres-announcement-push-store.js";

describe("PostgresAnnouncementPushStore", () => {
  it("cihazları tenant ve web-push ile sınırlar, pasifleştirir ve chunk sayılarını ekler", async () => {
    const client = new FakeClient();
    const store = new PostgresAnnouncementPushStore(new FakePool(client));

    await store.listActiveDevices("tenant-a", ["device-1"]);
    await store.disableDevices("tenant-a", ["device-1"]);
    await store.addDeliveryCounts({
      tenantId: "tenant-a",
      announcementId: "announcement-a",
      channel: "PUSH",
      recipientCount: 25,
      deliveredCount: 24,
      failedCount: 1,
      status: "completed",
    });

    const select = client.queries.find((query) => query.sql.startsWith("SELECT \"id\", \"token\""));
    expect(select?.sql).toContain("\"provider\" = 'web-push' AND \"disabledAt\" IS NULL");
    expect(select?.values).toEqual(["tenant-a", ["device-1"]]);
    const update = client.queries.find((query) => query.sql.startsWith("UPDATE \"NotificationDeviceToken\""));
    expect(update?.sql).toContain("SET \"disabledAt\" = now()");
    expect(update?.values).toEqual(["tenant-a", ["device-1"]]);
    const upsert = client.queries.find((query) => query.sql.includes("INSERT INTO \"AnnouncementDeliveryReport\""));
    expect(upsert?.sql).toContain("\"deliveredCount\" = report.\"deliveredCount\" + EXCLUDED.\"deliveredCount\"");
    expect(upsert?.values).toEqual(["tenant-a", "announcement-a", "PUSH", 25, 24, 1, "completed", null]);
  });
});

class FakePool implements TenantQueryable {
  constructor(private readonly client: FakeClient) {}

  async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    return this.client.query<T>(sql, values);
  }

  async connect(): Promise<FakeClient> {
    return this.client;
  }
}

class FakeClient implements Queryable {
  readonly queries: Array<{ sql: string; values?: unknown[] }> = [];

  async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    this.queries.push({ sql: sql.trim(), values });
    if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
    return { rows: [] as T[] };
  }

  release(): void {}
}
