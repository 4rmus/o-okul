import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresAnnouncementDeliveryReportStore } from "./announcement-delivery-report-store.js";

describe("PostgresAnnouncementDeliveryReportStore", () => {
  it("duyuru dış bildirim raporu için tenant-aware SQL kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "announcement-delivery-report-email-a",
              tenantId: "tenant-a",
              announcementId: "announcement-a",
              channel: "EMAIL",
              recipientCount: 3,
              deliveredCount: 2,
              failedCount: 1,
              status: "completed",
              providerErrorCode: null,
              createdAt: new Date("2026-06-08T09:05:00.000Z"),
              updatedAt: new Date("2026-06-08T09:10:00.000Z"),
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresAnnouncementDeliveryReportStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.listByAnnouncement("tenant-a", "announcement-a");
        await store.upsert({
          tenantId: "tenant-a",
          announcementId: "announcement-a",
          channel: "EMAIL",
          recipientCount: 3,
          deliveredCount: 2,
          failedCount: 1,
          status: "completed",
        });
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('FROM "AnnouncementDeliveryReport"');
    expect(businessQueries[0]?.sql).toContain('"tenantId" = $1 AND "announcementId" = $2');
    expect(businessQueries[0]?.values).toEqual(["tenant-a", "announcement-a"]);
    expect(businessQueries[1]?.sql).toContain('INSERT INTO "AnnouncementDeliveryReport"');
    expect(businessQueries[1]?.sql).toContain('ON CONFLICT ("tenantId", "announcementId", "channel") DO UPDATE');
    expect(businessQueries[1]?.values?.[0]).toEqual(expect.any(String));
    expect(businessQueries[1]?.values?.slice(1)).toEqual([
      "tenant-a",
      "announcement-a",
      "EMAIL",
      3,
      2,
      1,
      "completed",
      null,
    ]);
  });
});
