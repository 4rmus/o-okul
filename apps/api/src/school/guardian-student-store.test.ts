import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { PostgresGuardianStudentStore } from "./guardian-student-store.js";

describe("PostgresGuardianStudentStore", () => {
  it("GuardianStudent bağlantıları için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return {
          rows: [
            {
              id: "guardian-student-a",
              tenantId: "tenant-a",
              guardianId: "guardian-a",
              studentId: "student-a",
              canViewFinance: true,
              canReceiveSms: true,
              canReceiveAnnouncements: true,
              canOpenSupportTickets: true,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresGuardianStudentStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.listByGuardian("guardian-a");
        await store.listByStudent("student-a");
        await store.listByStudentIds(["student-a", "student-b"]);
        await store.create({
          tenantId: "tenant-a",
          guardianId: "guardian-a",
          studentId: "student-a",
          canViewFinance: true,
          canReceiveSms: true,
          canReceiveAnnouncements: true,
          canOpenSupportTickets: false,
        });
        await store.update("guardian-a", "student-a", { canViewFinance: false, canReceiveSms: false });
        await store.delete("guardian-a", "student-a");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('FROM "GuardianStudent"');
    expect(businessQueries[0]?.values).toEqual(["guardian-a"]);
    expect(businessQueries[1]?.sql).toContain('FROM "GuardianStudent"');
    expect(businessQueries[1]?.values).toEqual(["student-a"]);
    expect(businessQueries[2]?.sql).toContain('"studentId" = ANY($1::text[])');
    expect(businessQueries[2]?.values).toEqual([["student-a", "student-b"]]);
    expect(businessQueries[3]?.sql).toContain('INSERT INTO "GuardianStudent"');
    expect(businessQueries[3]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "guardian-a",
      "student-a",
      true,
      true,
      true,
      false,
    ]);
    expect(businessQueries[4]?.sql).toContain('UPDATE "GuardianStudent"');
    expect(businessQueries[4]?.values).toEqual(["guardian-a", "student-a", false, false, undefined, undefined]);
    expect(businessQueries[5]?.sql).toContain('DELETE FROM "GuardianStudent"');
    expect(businessQueries[5]?.values).toEqual(["guardian-a", "student-a"]);
  });

  it("mevcut bağlantı tekrar istenirse mevcut kaydı döndürür", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        const isInsert = sql.includes('INSERT INTO "GuardianStudent"');
        return {
          rows: isInsert
            ? []
            : [
                {
                  id: "guardian-student-a",
                  tenantId: "tenant-a",
                  guardianId: "guardian-a",
                  studentId: "student-a",
                },
              ] as T[],
        };
      },
    };

    const store = new PostgresGuardianStudentStore(pool);

    const record = await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.create({ tenantId: "tenant-a", guardianId: "guardian-a", studentId: "student-a" }),
    );

    expect(record.id).toBe("guardian-student-a");
    expect(record).toEqual(expect.objectContaining({
      canViewFinance: true,
      canReceiveSms: true,
      canReceiveAnnouncements: true,
      canOpenSupportTickets: true,
    }));
    expect(queries.find((query) => query.sql.includes('INSERT INTO "GuardianStudent"'))?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "guardian-a",
      "student-a",
      true,
      true,
      true,
      true,
    ]);
    expect(queries.some((query) => query.sql.includes("ON CONFLICT"))).toBe(true);
    expect(queries.some((query) => query.sql.includes("LIMIT 1"))).toBe(true);
  });
});
