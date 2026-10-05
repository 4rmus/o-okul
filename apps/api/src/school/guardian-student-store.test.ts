import { ConflictException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { InMemoryAuthUserStore, resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { InMemoryGuardianStore } from "./guardian-store.js";
import { InMemoryGuardianStudentStore, PostgresGuardianStudentStore } from "./guardian-student-store.js";

describe("PostgresGuardianStudentStore", () => {
  it("GuardianStudent bağlantıları için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        // No user behind the guardian: create/delete skip the GUARDIAN role rules.
        if (sql.includes("FOR UPDATE OF u")) return { rows: [] as T[] };
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
    // KV-3c R2: the user behind the guardian is locked before the link row on create too.
    expect(businessQueries[2]?.sql).toContain("FOR UPDATE OF u");
    businessQueries.splice(2, 1);
    expect(businessQueries[2]?.sql).toContain('INSERT INTO "GuardianStudent"');
    expect(businessQueries[2]?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "guardian-a",
      "student-a",
      true,
      true,
      true,
      false,
    ]);
    expect(businessQueries[3]?.sql).toContain('UPDATE "GuardianStudent"');
    // Guardian self-service / default update keeps the StudentContact flow marker ($7 false).
    expect(businessQueries[3]?.values).toEqual(["guardian-a", "student-a", false, false, undefined, undefined, false]);
    // KV-3c: the user behind the guardian is locked before the link row (same order as the KV-3b user link).
    expect(businessQueries[4]?.sql).toContain("FOR UPDATE OF u");
    expect(businessQueries[5]?.sql).toContain('DELETE FROM "GuardianStudent"');
    expect(businessQueries[5]?.values).toEqual(["guardian-a", "student-a"]);
  });

  it("KV-3c Postgres: son bağ silinince yalnız başka ACTIVE üyeliği olan kullanıcının GUARDIAN üyeliğini aynı transaction'da bitirir", async () => {
    for (const { otherLinks, roles, ended } of [
      { otherLinks: false, roles: ["OPERATIONS_STAFF", "GUARDIAN"], ended: true },
      { otherLinks: true, roles: ["OPERATIONS_STAFF", "GUARDIAN"], ended: false },
      // A guardian-only account keeps its role (and its Guardian profile) with an empty list.
      { otherLinks: false, roles: ["GUARDIAN"], ended: false },
    ]) {
      const queries: Array<{ sql: string; values?: unknown[] }> = [];
      const pool = {
        async query<T>(sql: string, values?: unknown[]) {
          queries.push({ sql, values });
          const rows = sql.includes("FOR UPDATE OF u") ? [{ tenantId: "tenant-a", userId: "user-staff-parent" }]
            : sql.includes('DELETE FROM "GuardianStudent"') ? [{ id: "link-a" }]
              : sql.includes('SELECT 1 FROM "GuardianStudent"') ? (otherLinks ? [{ "?column?": 1 }] : [])
                : sql.includes('FROM "TenantMembership"') ? roles.map((role) => ({ role }))
                  : sql.includes('UPDATE "User"') ? [{ membershipVersion: 7 }]
                    : sql.includes('UPDATE "AuthSession"') ? [{ id: "session-a" }, { id: "session-b" }]
                      : [];
          return { rows: rows as T[] };
        },
      };
      const write = await runWithRequestContext(
        { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
        () => new PostgresGuardianStudentStore(pool).delete("guardian-a", "student-a"),
      );
      const sqls = queries.map((query) => query.sql);
      const end = sqls.findIndex((sql) => sql.includes("\"status\" = 'ENDED'"));
      if (!ended) {
        expect(write).toEqual({ sessionsRevoked: 0 });
        expect(end).toBe(-1);
        expect(sqls.some((sql) => sql.includes('UPDATE "AuthSession"'))).toBe(false);
        continue;
      }
      expect(write).toEqual({ guardianRoleRemovedUserId: "user-staff-parent", sessionsRevoked: 2 });
      const lock = sqls.findIndex((sql) => sql.includes("FOR UPDATE OF u"));
      const remove = sqls.findIndex((sql) => sql.includes('DELETE FROM "GuardianStudent"'));
      const revoke = sqls.findIndex((sql) => sql.includes('UPDATE "AuthSession"'));
      expect(sqls.indexOf("BEGIN") < lock && lock < remove && remove < end && end < revoke && revoke < sqls.indexOf("COMMIT")).toBe(true);
      expect(sqls[end]).toContain("\"role\" = 'GUARDIAN'");
      expect(queries[end]?.values).toEqual(["tenant-a", "user-staff-parent", 7, "LAST_GUARDIAN_STUDENT_LINK_REMOVED"]);
      // Other memberships only get the shared version; they are never ended or deleted.
      expect(sqls.filter((sql) => sql.includes('UPDATE "TenantMembership"') && !sql.includes("'ENDED'"))).toEqual([
        expect.stringContaining('SET "version" = $3'),
      ]);
      expect(sqls.some((sql) => sql.includes('DELETE FROM "TenantMembership"'))).toBe(false);
    }
  });

  it("mevcut bağlantı tekrar istenirse mevcut kaydı döndürür ve akış işaretini temizler (KV-3c R1)", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        const isUpsert = sql.includes('INSERT INTO "GuardianStudent"');
        return {
          rows: !isUpsert
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

    expect(record).toEqual({ link: expect.objectContaining({ id: "guardian-student-a" }), sessionsRevoked: 0 });
    expect(record.link).toEqual(expect.objectContaining({
      canViewFinance: false,
      canReceiveSms: false,
      canReceiveAnnouncements: false,
      canOpenSupportTickets: false,
    }));
    expect(queries.find((query) => query.sql.includes('INSERT INTO "GuardianStudent"'))?.values).toEqual([
      expect.any(String),
      "tenant-a",
      "guardian-a",
      "student-a",
      false,
      false,
      false,
      false,
    ]);
    // An existing link answered here is adopted by the guardian API: a later contact unlink keeps it.
    const upsert = queries.find((query) => query.sql.includes('INSERT INTO "GuardianStudent"'))?.sql;
    expect(upsert).toContain('ON CONFLICT ("tenantId", "guardianId", "studentId") DO UPDATE');
    expect(upsert).toContain('SET "createdByStudentContact" = false');
    expect(upsert).toContain("RETURNING *");
  });

  it("KV-3c R1: yönetici izin güncellemesi akış işaretini temizler", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      },
    };
    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => new PostgresGuardianStudentStore(pool).update("guardian-a", "student-a", { canViewFinance: true }, { clearStudentContactOrigin: true }),
    );
    const update = queries.find((query) => query.sql.includes('UPDATE "GuardianStudent"'));
    expect(update?.sql).toContain('"createdByStudentContact" = CASE WHEN $7 THEN false ELSE "createdByStudentContact" END');
    expect(update?.values?.[6]).toBe(true);
  });

  it("KV-3c R2 Postgres: yeniden bağlama, son bağ kuralıyla biten GUARDIAN üyeliğini aynı transaction'da yeniden açar", async () => {
    for (const ended of [true, false]) {
      const queries: Array<{ sql: string; values?: unknown[] }> = [];
      const pool = {
        async query<T>(sql: string, values?: unknown[]) {
          queries.push({ sql, values });
          const rows = sql.includes("FOR UPDATE OF u") ? [{ tenantId: "tenant-a", userId: "user-staff-parent" }]
            : sql.includes('INSERT INTO "GuardianStudent"') ? [{ id: "link-a", tenantId: "tenant-a", guardianId: "guardian-a", studentId: "student-a" }]
              : sql.includes(`"status" = 'ENDED' AND "endedReason"`) ? (ended ? [{ id: "membership-guardian" }] : [])
                : sql.includes('UPDATE "User"') ? [{ membershipVersion: 9 }]
                  : sql.includes('UPDATE "AuthSession"') ? [{ id: "session-a" }]
                    : [];
          return { rows: rows as T[] };
        },
      };
      const write = await runWithRequestContext(
        { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
        () => new PostgresGuardianStudentStore(pool).create({ tenantId: "tenant-a", guardianId: "guardian-a", studentId: "student-a" }),
      );
      const sqls = queries.map((query) => query.sql);
      const find = sqls.findIndex((sql) => sql.includes("\"status\" = 'ENDED' AND \"endedReason\""));
      expect(queries[find]?.values).toEqual(["tenant-a", "user-staff-parent", "LAST_GUARDIAN_STUDENT_LINK_REMOVED"]);
      if (!ended) {
        expect(write).toEqual({ link: expect.objectContaining({ id: "link-a" }), sessionsRevoked: 0 });
        expect(sqls.some((sql) => sql.includes('UPDATE "User"') || sql.includes('UPDATE "AuthSession"'))).toBe(false);
        continue;
      }
      expect(write).toEqual({ link: expect.objectContaining({ id: "link-a" }), guardianRoleRestoredUserId: "user-staff-parent", sessionsRevoked: 1 });
      const order = ["FOR UPDATE OF u", 'INSERT INTO "GuardianStudent"', "\"endedReason\" = $3", 'UPDATE "User"', "SET \"status\" = 'ACTIVE'", 'SET "version" = $3', 'UPDATE "AuthSession"']
        .map((fragment) => sqls.findIndex((sql) => sql.includes(fragment)));
      expect(order.every((index, position) => index > 0 && (position === 0 || index > order[position - 1]!))).toBe(true);
      expect(sqls.indexOf("BEGIN")).toBeLessThan(order[0]!);
      expect(sqls.indexOf("COMMIT")).toBeGreaterThan(order.at(-1)!);
      expect(queries[order[4]!]?.values).toEqual(["tenant-a", "membership-guardian", 9]);
    }
  });

  it("KV-3d: GuardianStudent create/delete deadlock/serileştirme hatasında ROLLBACK edip 409 döner; diğer hatalar değişmez", async () => {
    const run = async (code: string, call: (store: PostgresGuardianStudentStore) => Promise<unknown>) => {
      const sqls: string[] = [];
      const pool = {
        async query<T>(sql: string) {
          sqls.push(sql);
          if (sql.includes('"GuardianStudent"')) throw Object.assign(new Error("pg failure"), { code });
          return { rows: [] as T[] };
        },
      };
      const outcome = await runWithRequestContext(
        { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
        () => call(new PostgresGuardianStudentStore(pool)).then(() => undefined, (error: unknown) => error),
      );
      return { outcome, sqls };
    };
    for (const call of [
      (store: PostgresGuardianStudentStore) => store.create({ tenantId: "tenant-a", guardianId: "guardian-a", studentId: "student-a" }),
      (store: PostgresGuardianStudentStore) => store.delete("guardian-a", "student-a"),
    ]) {
      for (const code of ["40P01", "40001"]) {
        const { outcome, sqls } = await run(code, call);
        expect(outcome).toBeInstanceOf(ConflictException);
        expect((outcome as ConflictException).getResponse()).toEqual({
          error: { code: "GUARDIAN_LINK_CONCURRENT_UPDATE", message: "Aynı kayıt üzerinde eşzamanlı bir işlem var, lütfen tekrar deneyin." },
        });
        expect(sqls).toContain("ROLLBACK");
      }
      const other = await run("XX000", call);
      expect(other.outcome).not.toBeInstanceOf(ConflictException);
      expect(other.outcome).toMatchObject({ code: "XX000", message: "pg failure" });
    }
  });
});


describe("InMemoryGuardianStudentStore (KV-3c)", () => {
  it("son bağ silinince personel+veli kullanıcının GUARDIAN rolü biter; birden fazla bağ varken ve yalnız-veli hesabında kalır", async () => {
    resetInMemoryAuthUsers();
    try {
      upsertInMemoryAuthUser({
        id: "user-kv3c-staff-parent", email: "kv3c-store@example.test", name: "Personel Veli", password: "password",
        tenantId: "tenant-a", roles: ["OPERATIONS_STAFF", "GUARDIAN"],
      });
      const guardians = new InMemoryGuardianStore();
      const store = new InMemoryGuardianStudentStore(guardians);
      const staffGuardian = await guardians.create({ tenantId: "tenant-a", firstName: "Personel", lastName: "Veli", userId: "user-kv3c-staff-parent" });
      const first = await store.create({ tenantId: "tenant-a", guardianId: staffGuardian.id, studentId: "student-1" });
      expect(first).toEqual({ link: expect.objectContaining({ studentId: "student-1" }), sessionsRevoked: 0 });
      await store.create({ tenantId: "tenant-a", guardianId: staffGuardian.id, studentId: "student-2" });
      const users = new InMemoryAuthUserStore();
      const before = await users.findById("user-kv3c-staff-parent");

      expect(await store.delete(staffGuardian.id, "student-1")).toEqual({ sessionsRevoked: 0 });
      expect((await users.findById("user-kv3c-staff-parent"))?.roles).toEqual(["OPERATIONS_STAFF", "GUARDIAN"]);
      expect(await store.delete(staffGuardian.id, "student-2"))
        .toEqual({ guardianRoleRemovedUserId: "user-kv3c-staff-parent", sessionsRevoked: 0 });
      const after = await users.findById("user-kv3c-staff-parent");
      expect(after?.roles).toEqual(["OPERATIONS_STAFF"]);
      expect(after?.membershipVersion).toBe((before?.membershipVersion ?? 0) + 1);
      expect(await guardians.findById(staffGuardian.id)).toBeDefined();
      expect(await store.delete(staffGuardian.id, "student-2")).toBeUndefined();

      // KV-3c R2: relinking reopens the GUARDIAN role the last-link rule ended (version bump, once).
      expect(await store.create({ tenantId: "tenant-a", guardianId: staffGuardian.id, studentId: "student-3" }))
        .toEqual({ link: expect.objectContaining({ studentId: "student-3" }), guardianRoleRestoredUserId: "user-kv3c-staff-parent", sessionsRevoked: 0 });
      const restored = await users.findById("user-kv3c-staff-parent");
      expect(restored?.roles).toEqual(["OPERATIONS_STAFF", "GUARDIAN"]);
      expect(restored?.membershipVersion).toBe((after?.membershipVersion ?? 0) + 1);
      expect(await store.create({ tenantId: "tenant-a", guardianId: staffGuardian.id, studentId: "student-4" }))
        .toEqual({ link: expect.objectContaining({ studentId: "student-4" }), sessionsRevoked: 0 });

      // guardian-a is a guardian-only demo account: its last link goes, the role and Guardian profile stay.
      expect(await store.delete("guardian-a", "student-a")).toEqual({ sessionsRevoked: 0 });
      expect((await users.findById("guardian-tenant-a"))?.roles).toEqual(["GUARDIAN"]);
    } finally {
      resetInMemoryAuthUsers();
    }
  });
});
