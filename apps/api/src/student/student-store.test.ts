import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresStudentStore } from "./student-store.js";

describe("PostgresStudentStore", () => {
  it("Student CRUD için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "student-a",
              tenantId: "tenant-a",
              firstName: "Ada",
              lastName: "A",
              status: "ACTIVE",
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresStudentStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list();
        await store.findById("student-a");
        await store.create({ tenantId: "tenant-a", firstName: "Ece", lastName: "Import" });
        await store.createMany([
          { tenantId: "tenant-a", firstName: "Deniz", lastName: "Import" },
          { tenantId: "tenant-a", firstName: "Mert", lastName: "Import" },
        ]);
        await store.update("student-a", { firstName: "Ada Guncel" });
        await store.purgePii("student-a");
        await store.updateTenant("student-a", "tenant-a");
        await store.softDelete("student-a", "2026-06-01T12:00:00.000Z");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "Student"');
    expect(businessQueries[1]?.values).toEqual(["student-a"]);
    expect(businessQueries[2]?.sql).toContain('INSERT INTO "Student"');
    expect(businessQueries[2]?.values).toEqual([expect.any(String), "tenant-a", "Ece", "Import", null, null, "ACTIVE"]);
    expect(businessQueries[3]?.sql).toContain('INSERT INTO "Student"');
    expect(businessQueries[3]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "Deniz",
      "Import",
      "ACTIVE",
      expect.any(String),
      "tenant-a",
      "Mert",
      "Import",
      "ACTIVE",
    ]);
    expect(businessQueries[5]?.sql).toContain('UPDATE "Student"');
    expect(businessQueries[5]?.values).toEqual(["student-a", "Ada Guncel", null, false, null, false, null, null]);
    expect(businessQueries[7]?.sql).toContain('"firstName" = \'Anonim\'');
    expect(businessQueries[9]?.values).toEqual(["student-a", "tenant-a"]);
    expect(businessQueries[11]?.values).toEqual(["student-a", "2026-06-01T12:00:00.000Z"]);
  });

  it("createMany hata alırsa tenant transaction rollback yapar", async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string, _values?: unknown[]) {
        queries.push(sql);
        if (sql.includes('INSERT INTO "Student"')) {
          throw new Error("INSERT_FAILED");
        }
        return { rows: [] as T[] };
      },
      releaseCalled: false,
      release() {
        this.releaseCalled = true;
      },
    };
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return client;
      },
    };

    const store = new PostgresStudentStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await expect(
          store.createMany([{ tenantId: "tenant-a", firstName: "Ada", lastName: "Rollback" }]),
        ).rejects.toThrow("INSERT_FAILED");
      },
    );

    expect(queries).toContain("BEGIN");
    expect(queries.some((sql) => sql.includes('INSERT INTO "Student"'))).toBe(true);
    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(client.releaseCalled).toBe(true);
  });
});
