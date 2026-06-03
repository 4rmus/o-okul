import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@uzman-hocam/db";
import { PostgresAnnouncementDeliveryReporter } from "./postgres-announcement-delivery-reporter.js";

describe("PostgresAnnouncementDeliveryReporter", () => {
  it("duyuru dış bildirim raporunu upsert eder", async () => {
    const client = new FakeClient();
    const reporter = new PostgresAnnouncementDeliveryReporter(new FakePool(client));

    await reporter.upsert({
      tenantId: "tenant-a",
      announcementId: "announcement-a",
      channel: "EMAIL",
      recipientCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      status: "completed",
      providerErrorCode: "EMAIL_PROVIDER_RETRY",
    });

    const upsert = client.queries.find((query) => query.sql.includes('INSERT INTO "AnnouncementDeliveryReport"'));
    expect(upsert?.sql).toContain('ON CONFLICT ("tenantId", "announcementId", "channel") DO UPDATE');
    expect(upsert?.values).toEqual([
      "tenant-a",
      "announcement-a",
      "EMAIL",
      3,
      2,
      1,
      "completed",
      "EMAIL_PROVIDER_RETRY",
    ]);
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
    return { rows: [] as T[] };
  }

  release(): void {}
}
