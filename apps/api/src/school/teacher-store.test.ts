import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { InMemoryTeacherStore, PostgresTeacherStore } from "./teacher-store.js";

const adminContext = { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN" as const], bypassRls: false };

function recordingPool(respond: (sql: string) => Record<string, unknown>[] = () => [teacherRow()]) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const pool = {
    async query<T>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      return { rows: respond(sql) as T[] };
    },
  };
  const business = () => queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
  return { pool, queries, business };
}

function teacherRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "teacher-a",
    tenantId: "tenant-a",
    firstName: "Ayse",
    lastName: "Ogretmen",
    branch: "Matematik",
    deletedAt: null,
    ...overrides,
  };
}

describe("PostgresTeacherStore", () => {
  it("Teacher CRUD için beklenen SQL parametrelerini kullanır", async () => {
    const { pool, queries, business } = recordingPool((sql) => (sql.includes('FROM "Employee" e') ? [] : [teacherRow()]));
    const store = new PostgresTeacherStore(pool);

    await runWithRequestContext(adminContext, async () => {
      await store.list();
      await store.findById("teacher-a");
      await store.create({ tenantId: "tenant-a", firstName: "Ece", lastName: "Ogretmen", branch: "Fen", phone: "5550000010" });
      await store.update("teacher-a", { firstName: "Ayse Guncel", phone: "5550000011" });
      await store.purgePii("teacher-a");
      await store.softDelete("teacher-a", "2026-06-01T12:00:00.000Z");
    });

    const sql = business();
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(sql[0]?.sql).toContain('SELECT * FROM "Teacher"');
    expect(sql[1]?.values).toEqual(["teacher-a"]);
    expect(sql[2]?.sql).toContain('INSERT INTO "Teacher"');
    expect(sql[2]?.values).toEqual([expect.any(String), "tenant-a", "Ece", "Ogretmen", "Fen", null, null, "5550000010"]);
    // The teacher row returned has no linked Employee yet: no match by userId or national ID, so one is inserted.
    expect(sql[3]?.sql).toContain('FROM "Employee" e');
    expect(sql[3]?.values).toEqual(["tenant-a", null, null]);
    expect(sql[4]?.sql).toContain('INSERT INTO "Employee"');
    expect(sql[4]?.sql).toContain("'employee-' || md5($1::text || ':' || $2::text)");
    expect(sql[4]?.sql).toContain("ON CONFLICT DO NOTHING");
    expect(sql[5]?.sql).toContain('SET "employeeId" = $3');
    expect(sql[5]?.values).toEqual(["tenant-a", "teacher-a", "teacher-a"]);
    expect(sql[7]?.sql).toContain('UPDATE "Teacher"');
    expect(sql[7]?.values).toEqual(["teacher-a", "Ayse Guncel", null, false, null, null, null, true, "5550000011"]);
    // The returned teacher row has no employeeId, so neither the mirror nor the Employee purge runs.
    expect(sql[9]?.sql).toContain('"firstName" = $2');
    expect(sql[9]?.values).toEqual(["teacher-a", "Anonim", "Ogretmen"]);
    expect(sql[11]?.values).toEqual(["teacher-a", "2026-06-01T12:00:00.000Z"]);
    expect(sql).toHaveLength(12);
  });

  it("öğretmen güncellemesi bağlı Çalışan'a ad, telefon ve ulusal kimliği yazar", async () => {
    const { pool, business } = recordingPool((sql) => {
      if (sql.includes('SELECT e."id"')) return [];
      return [teacherRow({ employeeId: "employee-1", firstName: "Ayse", lastName: "Yeni", phone: "5550000011", nationalIdEncrypted: "enc", nationalIdHash: "hash" })];
    });
    const store = new PostgresTeacherStore(pool);

    await runWithRequestContext(adminContext, () => store.update("teacher-a", {
      lastName: "Yeni",
      phone: "5550000011",
      nationalIdEncrypted: "enc",
      nationalIdHash: "hash",
    }));

    const sql = business();
    expect(sql[1]?.sql).toContain('e."nationalIdHash" = $3');
    expect(sql[1]?.values).toEqual(["tenant-a", "teacher-a", "hash"]);
    expect(sql[3]?.sql).toContain('UPDATE "Employee"');
    expect(sql[3]?.values).toEqual(["tenant-a", "employee-1", true, "Ayse", "Yeni", true, "5550000011", true, "enc", "hash"]);
  });

  it("başka bir Çalışan'da kayıtlı ulusal kimlik güncellemesini reddeder", async () => {
    const { pool, business } = recordingPool((sql) => (sql.includes('SELECT e."id"') ? [{ id: "employee-other" }] : [teacherRow()]));
    const store = new PostgresTeacherStore(pool);

    await expect(runWithRequestContext(adminContext, () => store.update("teacher-a", { nationalIdEncrypted: "enc", nationalIdHash: "hash" })))
      .rejects.toThrow("TEACHER_NATIONAL_ID_CONFLICT");
    expect(business().some((query) => query.sql.includes('UPDATE "Teacher"'))).toBe(false);
  });

  it("öğretmen oluşturulurken önce hesap, sonra ulusal kimlik ile eşleşen Çalışan'ı bağlar", async () => {
    const { pool, business } = recordingPool((sql) => {
      if (sql.includes('FROM "Employee" e')) return [{ id: "employee-hr", linked: false }];
      return [teacherRow({ nationalIdHash: "hash" })];
    });
    const store = new PostgresTeacherStore(pool);

    await runWithRequestContext(adminContext, () => store.create({ tenantId: "tenant-a", firstName: "Ece", lastName: "Ogretmen", userId: "user-1" }));

    const sql = business();
    expect(sql[1]?.sql).toContain("ORDER BY CASE WHEN $2::text IS NOT NULL AND e.\"userId\" = $2 THEN 0 ELSE 1 END");
    expect(sql[1]?.values).toEqual(["tenant-a", "user-1", "hash"]);
    expect(sql.some((query) => query.sql.includes('INSERT INTO "Employee"'))).toBe(false);
    expect(sql[2]?.values).toEqual(["tenant-a", "teacher-a", "employee-hr"]);
  });

  it("başka öğretmene bağlı Çalışan'ı devralmaz ve yeni satır da eklemez", async () => {
    const { pool, business } = recordingPool((sql) => {
      if (sql.includes('FROM "Employee" e')) return [{ id: "employee-taken", linked: true }];
      return [teacherRow({ nationalIdHash: "hash" })];
    });
    const store = new PostgresTeacherStore(pool);

    await runWithRequestContext(adminContext, () => store.create({ tenantId: "tenant-a", firstName: "Ece", lastName: "Ogretmen" }));

    const sql = business();
    expect(sql.some((query) => query.sql.includes('INSERT INTO "Employee"'))).toBe(false);
    expect(sql.some((query) => query.sql.includes('SET "employeeId"'))).toBe(false);
  });

  it("kişisel veri imhası bağlı Çalışan'ın kişisel alanlarını da aynı işlemde siler", async () => {
    const { pool, business } = recordingPool((sql) => {
      if (sql.includes('UPDATE "Employee"')) return [{ id: "employee-1" }];
      return [teacherRow({ employeeId: "employee-1" })];
    });
    const store = new PostgresTeacherStore(pool);

    const result = await runWithRequestContext(adminContext, () => store.purgePii("teacher-a"));

    const sql = business();
    expect(result).toMatchObject({ teacher: { id: "teacher-a" }, employeeId: "employee-1" });
    expect(sql[2]?.sql).toContain('"workEmail" = NULL');
    expect(sql[2]?.sql).toContain('"nationalIdHash" = NULL');
    expect(sql[2]?.values).toEqual(["tenant-a", "employee-1", "Anonim", "Ogretmen"]);
  });

  it.each([
    [{ id: "employee-1", status: "ACTIVE", keepsStaffAccess: false }, "ENDED", true],
    [{ id: "employee-1", status: "ENDED", keepsStaffAccess: false }, "ALREADY_ENDED", false],
    [{ id: "employee-1", status: "ACTIVE", keepsStaffAccess: true }, "STAFF_ACCESS_KEPT", false],
    [undefined, "NO_EMPLOYEE", false],
  ] as const)("öğretmen silinince bağlı Çalışan pasifleşir (%#)", async (employee, expected, writes) => {
    const { pool, business } = recordingPool((sql) => (sql.includes('FROM "Teacher" t') && employee ? [employee] : []));
    const store = new PostgresTeacherStore(pool);

    await expect(store.endLinkedEmployee("tenant-a", "teacher-a", "2026-06-01T12:00:00.000Z")).resolves.toBe(expected);

    const update = business().find((query) => query.sql.includes('UPDATE "Employee"'));
    expect(Boolean(update)).toBe(writes);
    if (update) {
      expect(update.sql).toContain("\"status\" = 'ENDED'");
      expect(update.sql).toContain("\"endedReason\" = 'TEACHER_DELETED'");
      expect(update.values).toEqual(["tenant-a", "employee-1", "2026-06-01"]);
    }
  });
});

describe("InMemoryTeacherStore", () => {
  it("Çalışan eşitlemesi PostgreSQL deposuna aittir", async () => {
    const store = new InMemoryTeacherStore();
    await expect(store.endLinkedEmployee()).resolves.toBe("NO_EMPLOYEE");
    await expect(store.purgePii("teacher-a")).resolves.toMatchObject({ teacher: { firstName: "Anonim", lastName: "Ogretmen" } });
    expect((await store.purgePii("teacher-a"))?.employeeId).toBeUndefined();
  });
});
