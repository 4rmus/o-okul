import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresMessageTemplateStore } from "./message-template-store.js";

describe("PostgresMessageTemplateStore", () => {
  it("Mesaj şablonu akışı için beklenen tenant-aware SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "message-template-a",
              tenantId: "tenant-a",
              name: "Deneme sınavı hatırlatma",
              channel: "SMS",
              body: "Sayın veli, öğrencimizin deneme sınavı Pazartesi günü yapılacaktır.",
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresMessageTemplateStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list();
        await store.findById("message-template-a");
        await store.create({
          tenantId: "tenant-a",
          name: "Devamsızlık bilgilendirme",
          channel: "SMS",
          body: "Sayın veli, öğrencimizin bugün devamsızlığı bulunmaktadır.",
        });
        await store.update("message-template-a", {
          name: "Devamsızlık SMS",
          channel: "SMS",
          body: "Sayın veli, öğrencimiz bugün derse katılmamıştır.",
        });
        await store.softDelete("message-template-a", "2026-06-08T11:00:00.000Z");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config"));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "MessageTemplate"');
    expect(businessQueries[1]?.sql).toContain('WHERE "id" = $1');
    expect(businessQueries[1]?.values).toEqual(["message-template-a"]);
    expect(businessQueries[2]?.sql).toContain('INSERT INTO "MessageTemplate"');
    expect(businessQueries[2]?.values?.[0]).toEqual(expect.any(String));
    expect(businessQueries[2]?.values?.slice(1)).toEqual([
      "tenant-a",
      "Devamsızlık bilgilendirme",
      "SMS",
      "Sayın veli, öğrencimizin bugün devamsızlığı bulunmaktadır.",
    ]);
    expect(businessQueries[3]?.sql).toContain('UPDATE "MessageTemplate"');
    expect(businessQueries[3]?.values).toEqual([
      "message-template-a",
      "Devamsızlık SMS",
      "SMS",
      "Sayın veli, öğrencimiz bugün derse katılmamıştır.",
    ]);
    expect(businessQueries[4]?.values).toEqual(["message-template-a", "2026-06-08T11:00:00.000Z"]);
  });
});
