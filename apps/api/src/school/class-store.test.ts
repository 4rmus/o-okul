import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { InMemoryStudentEnrollmentStore } from "../student/student-enrollment-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { InMemoryClassStore, PostgresClassStore, createClassStore, normalizeClassName } from "./class-store.js";

describe("PostgresClassStore", () => {
  it("Class CRUD için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "class-a",
              tenantId: "tenant-a",
              name: "8-A",
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresClassStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list();
        await store.findById("class-a");
        await store.create({ tenantId: "tenant-a", name: "9-A" });
        await store.update("class-a", { name: "9 Fen" });
        await store.softDelete("class-a", "2026-05-29T20:00:00.000Z");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "Class"');
    expect(businessQueries[1]?.values).toEqual(["class-a"]);
    expect(businessQueries[2]?.sql).toContain('INSERT INTO "Class"');
    expect(businessQueries[2]?.values).toEqual([expect.any(String), "tenant-a", null, null, null, "9-A", null]);
    expect(businessQueries[4]?.sql).toContain('UPDATE "Class"');
    expect(businessQueries[4]?.values).toEqual(["class-a", "9 Fen", false, null, false, null, false, null, false, null]);
    expect(businessQueries[6]?.values).toEqual(["class-a", "2026-05-29T20:00:00.000Z"]);
  });

  it("sınıf seviyesi değişince öğrenci ve açık enrollment seviyesini aynı transactionda taşır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('SELECT * FROM "Class"') && sql.includes("FOR UPDATE")) {
          return { rows: [{ id: "class-a", tenantId: "tenant-a", name: "8-A", gradeLevelId: "grade-8", deletedAt: null }] as T[] };
        }
        if (sql.includes('UPDATE "Class"')) {
          return { rows: [{ id: "class-a", tenantId: "tenant-a", name: "8-A", gradeLevelId: "grade-9", deletedAt: null }] as T[] };
        }
        if (sql.includes('UPDATE "StudentEnrollment"')) {
          return { rows: [{ id: "enrollment-a" }, { id: "enrollment-b" }] as T[] };
        }
        if (sql.includes('UPDATE "Student"')) {
          return { rows: [{ id: "student-a" }, { id: "student-b" }] as T[] };
        }
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresClassStore(pool);

    const result = await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.updateWithGradeLevelCascade("class-a", { gradeLevelId: "grade-9" }),
    );

    expect(result).toMatchObject({
      record: { id: "class-a", gradeLevelId: "grade-9" },
      studentsUpdated: 2,
      enrollmentsUpdated: 2,
    });
    expect(queries.some((query) => query.sql === "BEGIN")).toBe(true);
    expect(queries.some((query) => query.sql === "COMMIT")).toBe(true);
    expect(queries.find((query) => query.sql.includes('UPDATE "Student"'))?.values).toEqual(["class-a", "grade-9"]);
    expect(queries.find((query) => query.sql.includes('UPDATE "StudentEnrollment"'))?.sql).toContain('"endsAt" IS NULL');
  });
});

describe("Class name uniqueness", () => {
  it("ignores whitespace and Turkish letter case while preserving the stored name", async () => {
    const store = new InMemoryClassStore();
    const created = await store.create({ tenantId: "tenant-a", name: "  Bilim Atölyesi  " });

    expect(created.name).toBe("Bilim Atölyesi");
    expect(normalizeClassName(" BİLİM\tATÖLYESİ ")).toBe(normalizeClassName(created.name));
    await expect(store.create({ tenantId: "tenant-a", name: " bİlİmAtölyesi " })).rejects.toThrow("CLASS_NAME_ALREADY_EXISTS");
    await expect(store.create({ tenantId: "tenant-b", name: "bİlİmAtölyesi" })).resolves.toMatchObject({ tenantId: "tenant-b" });

    await store.softDelete(created.id, "2026-08-29T12:00:00.000Z");
    await expect(store.create({ tenantId: "tenant-a", name: "bİlİmAtölyesi" })).resolves.toMatchObject({
      name: "bİlİmAtölyesi",
      tenantId: "tenant-a",
    });
  });

  it("memory adapter sınıf seviyesi değişimini öğrenci ve açık enrollment'a taşır", async () => {
    const studentStore = new InMemoryStudentStore();
    const enrollmentStore = new InMemoryStudentEnrollmentStore();
    const store = createClassStore(studentStore, enrollmentStore);

    await store.updateWithGradeLevelCascade("class-a", { gradeLevelId: "grade-9" });

    await expect(studentStore.findById("student-a")).resolves.toMatchObject({ gradeLevelId: "grade-9" });
    await expect(enrollmentStore.listByStudent("student-a")).resolves.toEqual([
      expect.objectContaining({ gradeLevelId: "grade-9", classId: "class-a", status: "ACTIVE" }),
    ]);
  });
});
