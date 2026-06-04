import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { InMemoryStudentStore, PostgresStudentStore } from "./student-store.js";

describe("PostgresStudentStore", () => {
  it("Student CRUD için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    let nextStudentNo = 101;
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('candidate::text AS "studentNo"')) {
          return { rows: [{ studentNo: String(nextStudentNo++) }] as T[] };
        }
        if (sql.includes('INSERT INTO "Student"')) {
          return {
            rows: [
              {
                id: String(values?.[0]),
                tenantId: String(values?.[1]),
                studentNo: String(values?.[2]),
                firstName: String(values?.[3]),
                lastName: String(values?.[4]),
                classId: null,
                responsibleTeacherId: null,
                status: String(values?.at(-1)),
                deletedAt: null,
              },
            ] as T[],
          };
        }
        return {
          rows: [
            {
              id: "student-a",
              tenantId: "tenant-a",
              studentNo: "100",
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
    const insertQueries = businessQueries.filter((query) => query.sql.includes('INSERT INTO "Student"'));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "Student"');
    expect(businessQueries[1]?.values).toEqual(["student-a"]);
    expect(businessQueries.filter((query) => query.sql.includes("pg_advisory_xact_lock"))).toHaveLength(3);
    expect(insertQueries[0]?.values).toEqual([expect.any(String), "tenant-a", "101", "Ece", "Import", null, null, "ACTIVE"]);
    expect(insertQueries[1]?.values).toEqual([expect.any(String), "tenant-a", "102", "Deniz", "Import", null, "ACTIVE"]);
    expect(insertQueries[2]?.values).toEqual([expect.any(String), "tenant-a", "103", "Mert", "Import", null, "ACTIVE"]);
    expect(businessQueries.find((query) => query.values?.[1] === "Ada Guncel")?.values).toEqual(["student-a", "Ada Guncel", null, false, null, false, null, null]);
    expect(businessQueries.some((query) => query.sql.includes('"firstName" = \'Anonim\''))).toBe(true);
    expect(businessQueries.find((query) => query.values?.[1] === "tenant-a" && query.sql.includes('SET "tenantId"'))?.values).toEqual(["student-a", "tenant-a"]);
    expect(businessQueries.find((query) => query.values?.[1] === "2026-06-01T12:00:00.000Z")?.values).toEqual(["student-a", "2026-06-01T12:00:00.000Z"]);
  });

  it("silinen öğrencinin okul numarasını yeni öğrenciye verir", async () => {
    const store = new InMemoryStudentStore();

    const firstInNewTenant = await store.create({ tenantId: "tenant-c", firstName: "Ilk", lastName: "Ogrenci" });
    expect(firstInNewTenant.studentNo).toBe("100");

    const created = await store.create({ tenantId: "tenant-a", firstName: "Ece", lastName: "Bir" });
    expect(created.studentNo).toBe("101");

    await store.softDelete(created.id, "2026-06-04T12:00:00.000Z");
    const next = await store.create({ tenantId: "tenant-a", firstName: "Can", lastName: "Iki" });

    expect(next.studentNo).toBe("101");
  });

  it("createMany hata alırsa tenant transaction rollback yapar", async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string, _values?: unknown[]) {
        queries.push(sql);
        if (sql.includes('candidate::text AS "studentNo"')) {
          return { rows: [{ studentNo: "101" }] as T[] };
        }
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
