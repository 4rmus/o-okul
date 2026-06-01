import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresHomeworkStore } from "./homework-store.js";

describe("PostgresHomeworkStore", () => {
  it("Homework ve materyal akışları için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('"HomeworkMaterialAssignment"')) {
          return {
            rows: [
              {
                id: "material-assignment-a",
                tenantId: "tenant-a",
                materialId: "material-a",
                studentId: "student-a",
                assignedById: "user-tenant-a",
                note: "Bireysel tekrar",
                dueAt: new Date("2026-06-09T12:00:00.000Z"),
                createdAt: new Date("2026-06-08T09:20:00.000Z"),
                deletedAt: null,
              },
            ] as T[],
          };
        }

        if (sql.includes('"HomeworkMaterialFile"')) {
          return {
            rows: [
              {
                id: "material-file-a",
                tenantId: "tenant-a",
                materialId: "material-a",
                uploadedById: "user-tenant-a",
                fileName: "kesirler.txt",
                contentType: "text/plain",
                byteSize: 11,
                sha256: "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
                contentBase64: "aGVsbG8gd29ybGQ=",
                createdAt: new Date("2026-06-08T09:10:00.000Z"),
                deletedAt: null,
              },
            ] as T[],
          };
        }

        if (sql.includes('"HomeworkMaterial"')) {
          return {
            rows: [
              {
                id: "material-a",
                tenantId: "tenant-a",
                title: "Kesirler Çalışma Kağıdı",
                description: "Kesirler",
                deletedAt: null,
              },
            ] as T[],
          };
        }

        return {
          rows: [
            {
              id: "homework-a",
              tenantId: "tenant-a",
              classId: "class-a",
              sourceMaterialId: "material-a",
              sourceMaterialTitle: "Kesirler Çalışma Kağıdı",
              title: "Kesirler",
              description: "1-20 arası sorular",
              dueAt: new Date("2026-06-05T12:00:00.000Z"),
              checkedAt: null,
              checkedById: null,
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresHomeworkStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.listMaterials();
        await store.findMaterialById("material-a");
        await store.list();
        await store.findById("homework-a");
        await store.create({
          tenantId: "tenant-a",
          classId: "class-a",
          sourceMaterialId: "material-a",
          sourceMaterialTitle: "Kesirler Çalışma Kağıdı",
          title: "Kesirler",
          description: "1-20 arası sorular",
          dueAt: "2026-06-05T12:00:00.000Z",
        });
        await store.update("homework-a", { title: "Kesirler Tekrar" });
        await store.softDelete("homework-a", "2026-06-01T12:00:00.000Z");
        await store.updateCheckStatus("homework-a", "2026-06-02T12:00:00.000Z", "teacher-tenant-a");
        await store.createMaterial({
          tenantId: "tenant-a",
          title: "Problemler Föyü",
          description: "Yaş problemleri",
        });
        await store.updateMaterial("material-a", {
          title: "Kesirler Tekrar Föyü",
          description: undefined,
        });
        await store.softDeleteMaterial("material-a", "2026-06-03T12:00:00.000Z");
        await store.listMaterialFiles("material-a");
        await store.createMaterialFile({
          tenantId: "tenant-a",
          materialId: "material-a",
          uploadedById: "user-tenant-a",
          fileName: "kesirler.txt",
          contentType: "text/plain",
          byteSize: 11,
          sha256: "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
          contentBase64: "aGVsbG8gd29ybGQ=",
          createdAt: "2026-06-08T10:00:00.000Z",
        });
        await store.listMaterialAssignments("material-a");
        await store.createMaterialAssignment({
          tenantId: "tenant-a",
          materialId: "material-a",
          studentId: "student-a",
          assignedById: "user-tenant-a",
          note: "Bireysel tekrar",
          dueAt: "2026-06-09T12:00:00.000Z",
          createdAt: "2026-06-08T10:05:00.000Z",
        });
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config"));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "HomeworkMaterial"');
    expect(businessQueries[1]?.sql).toContain('WHERE "id" = $1');
    expect(businessQueries[1]?.values).toEqual(["material-a"]);
    expect(businessQueries[2]?.sql).toContain('SELECT * FROM "Homework"');
    expect(businessQueries[3]?.values).toEqual(["homework-a"]);
    expect(businessQueries[4]?.sql).toContain('INSERT INTO "Homework"');
    expect(businessQueries[4]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "class-a",
      "material-a",
      "Kesirler Çalışma Kağıdı",
      "Kesirler",
      "1-20 arası sorular",
      "2026-06-05T12:00:00.000Z",
      null,
      null,
    ]);
    expect(businessQueries[6]?.sql).toContain('UPDATE "Homework"');
    expect(businessQueries[6]?.values).toEqual(["homework-a", null, "Kesirler Tekrar", false, null, false, null]);
    expect(businessQueries[7]?.values).toEqual(["homework-a", "2026-06-01T12:00:00.000Z"]);
    expect(businessQueries[8]?.values).toEqual(["homework-a", "2026-06-02T12:00:00.000Z", "teacher-tenant-a"]);
    expect(businessQueries[9]?.sql).toContain('INSERT INTO "HomeworkMaterial"');
    expect(businessQueries[9]?.values).toEqual([expect.any(String), "tenant-a", "Problemler Föyü", "Yaş problemleri"]);
    expect(businessQueries[10]?.sql).toContain('UPDATE "HomeworkMaterial"');
    expect(businessQueries[10]?.values).toEqual(["material-a", "Kesirler Tekrar Föyü", null]);
    expect(businessQueries[11]?.values).toEqual(["material-a", "2026-06-03T12:00:00.000Z"]);
    expect(businessQueries[12]?.sql).toContain('SELECT * FROM "HomeworkMaterialFile"');
    expect(businessQueries[12]?.values).toEqual(["material-a"]);
    expect(businessQueries[13]?.sql).toContain('INSERT INTO "HomeworkMaterialFile"');
    expect(businessQueries[13]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "material-a",
      "user-tenant-a",
      "kesirler.txt",
      "text/plain",
      11,
      "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
      "aGVsbG8gd29ybGQ=",
      "2026-06-08T10:00:00.000Z",
    ]);
    expect(businessQueries[14]?.sql).toContain('SELECT * FROM "HomeworkMaterialAssignment"');
    expect(businessQueries[14]?.values).toEqual(["material-a"]);
    expect(businessQueries[15]?.sql).toContain('INSERT INTO "HomeworkMaterialAssignment"');
    expect(businessQueries[15]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "material-a",
      "student-a",
      "user-tenant-a",
      "Bireysel tekrar",
      "2026-06-09T12:00:00.000Z",
      "2026-06-08T10:05:00.000Z",
    ]);
  });
});
