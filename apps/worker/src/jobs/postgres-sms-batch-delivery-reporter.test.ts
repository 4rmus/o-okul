import { describe, expect, it } from "vitest";
import type { Queryable, TenantQueryable } from "@o-okul/db";
import { PostgresSmsBatchDeliveryReporter } from "./postgres-sms-batch-delivery-reporter.js";

describe("PostgresSmsBatchDeliveryReporter", () => {
  it("completed SMS batch raporunu job retry öncesi bulur", async () => {
    const client = new FakeClient(() => [{
      tenantId: "tenant-a",
      jobId: "message-template-a_sms-hash-a",
      templateId: "message-template-a",
      sentCount: 2,
      failedCount: 0,
      billableSegments: 2,
    }]);
    const reporter = new PostgresSmsBatchDeliveryReporter(new FakePool(client));

    await expect(reporter.findCompleted({
      tenantId: "tenant-a",
      jobId: "message-template-a_sms-hash-a",
    })).resolves.toEqual({
      tenantId: "tenant-a",
      jobId: "message-template-a_sms-hash-a",
      templateId: "message-template-a",
      sentCount: 2,
      failedCount: 0,
      billableSegments: 2,
    });

    const select = client.queries.find((query) => query.sql.includes('FROM "SmsBatchDeliveryReport"'));
    expect(select?.sql).toContain('"status" = \'completed\'');
    expect(select?.values).toEqual(["tenant-a", "message-template-a_sms-hash-a"]);
  });

  it("SMS batch raporunu completed olarak günceller", async () => {
    const client = new FakeClient(() => [{ id: "report-a" }]);
    const reporter = new PostgresSmsBatchDeliveryReporter(new FakePool(client));

    await reporter.markCompleted({
      tenantId: "tenant-a",
      jobId: "message-template-a_sms-hash-a",
      templateId: "message-template-a",
      recipientCount: 2,
      sentCount: 1,
      failedCount: 1,
      billableSegments: 2,
    });

    const update = client.queries.find((query) => query.sql.includes('UPDATE "SmsBatchDeliveryReport"'));
    expect(update?.values).toEqual([
      "tenant-a",
      "message-template-a_sms-hash-a",
      "message-template-a",
      2,
      1,
      1,
      2,
      "completed",
      null,
    ]);
  });

  it("SMS batch raporunu failed olarak günceller", async () => {
    const client = new FakeClient(() => [{ id: "report-a" }]);
    const reporter = new PostgresSmsBatchDeliveryReporter(new FakePool(client));

    await reporter.markFailed({
      tenantId: "tenant-a",
      jobId: "message-template-a_sms-hash-a",
      templateId: "message-template-a",
      recipientCount: 2,
      providerErrorCode: "PROVIDER_DOWN",
    });

    const update = client.queries.find((query) => query.sql.includes('UPDATE "SmsBatchDeliveryReport"'));
    expect(update?.values).toEqual([
      "tenant-a",
      "message-template-a_sms-hash-a",
      "message-template-a",
      2,
      0,
      2,
      0,
      "failed",
      "PROVIDER_DOWN",
    ]);
  });

  it("rapor kaydı yoksa hata verir", async () => {
    const client = new FakeClient(() => []);
    const reporter = new PostgresSmsBatchDeliveryReporter(new FakePool(client));

    await expect(reporter.markCompleted({
      tenantId: "tenant-a",
      jobId: "missing-job",
      templateId: "message-template-a",
      recipientCount: 1,
      sentCount: 1,
      failedCount: 0,
      billableSegments: 1,
    })).rejects.toThrow("SMS_BATCH_DELIVERY_REPORT_NOT_FOUND");
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

  constructor(private readonly handler: (sql: string, values?: unknown[]) => unknown[]) {}

  async query<T>(sql: string, values?: unknown[]): Promise<{ rows: T[] }> {
    this.queries.push({ sql: sql.trim(), values });
    return { rows: this.handler(sql, values) as T[] };
  }

  release(): void {}
}
