import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { InMemoryStudentStore, PostgresStudentStore } from "./student-store.js";

describe("PostgresStudentStore", () => {
  it("portal erişimini tenant RLS, SQL arama ve cursor meta ile listeler; e-postayı maskeler", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("WITH anchor AS")) {
          return {
            rows: [
              {
                studentId: "student-a",
                tenantId: "tenant-a",
                studentNo: "100",
                firstName: "Ada",
                lastName: "A",
                studentStatus: "ACTIVE",
                userId: "student-user-a",
                accountStatus: "ACTIVE",
                membershipId: "membership-a",
                membershipStatus: "ACTIVE",
                membershipVersion: 3,
                invitationId: null,
                invitationKind: null,
                invitationStatus: null,
                invitationEmail: null,
                invitationExpiresAt: null,
                activeSessionCount: 2,
              },
              {
                studentId: "student-b",
                tenantId: "tenant-a",
                studentNo: "101",
                firstName: "Bora",
                lastName: "B",
                studentStatus: "ACTIVE",
                userId: null,
                accountStatus: null,
                membershipId: null,
                membershipStatus: null,
                membershipVersion: null,
                invitationId: "invitation-b",
                invitationKind: "EMAIL_LINK",
                invitationStatus: "PENDING",
                invitationEmail: "bora@example.test",
                invitationExpiresAt: new Date("2026-08-02T12:00:00.000Z"),
                activeSessionCount: 0,
              },
              {
                studentId: "student-c",
                tenantId: "tenant-a",
                studentNo: "102",
                firstName: "Cem",
                lastName: "C",
                studentStatus: "ACTIVE",
                userId: null,
                accountStatus: null,
                membershipId: null,
                membershipStatus: null,
                membershipVersion: null,
                invitationId: null,
                invitationKind: null,
                invitationStatus: null,
                invitationEmail: null,
                invitationExpiresAt: null,
                activeSessionCount: 0,
              },
            ] as T[],
          };
        }
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresStudentStore(pool);

    const result = await store.listPortalAccess("tenant-a", { direction: "next", limit: 2, q: "Ada" });

    expect(result.records).toEqual([
      expect.objectContaining({
        studentId: "student-a",
        accessState: "ACTIVE",
        activeSessionCount: 2,
        membership: { id: "membership-a", status: "ACTIVE", version: 3 },
      }),
      expect.objectContaining({
        studentId: "student-b",
        accessState: "INVITED",
        invitation: expect.objectContaining({ emailMasked: "bo••@•••.test" }),
      }),
    ]);
    expect(result.meta).toEqual({
      limit: 2,
      nextCursor: Buffer.from("student-b").toString("base64url"),
    });
    const listQuery = queries.find((query) => query.sql.includes("WITH anchor AS"));
    expect(listQuery?.values).toEqual(["tenant-a", "%ada%", null, 3]);
    expect(listQuery?.sql).toContain('u."tenantId" = s."tenantId"');
    expect(listQuery?.sql).toContain('invitation_row."subjectType" = \'STUDENT\'');
    expect(queries.some((query) => query.sql.includes("set_config('app.current_tenant_id'") && query.values?.[0] === "tenant-a")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("example.test");

    await expect(store.listPortalAccess("tenant-a", { cursor: "not+base64", direction: "next", limit: 20 })).rejects.toThrow(
      "STUDENT_PORTAL_CURSOR_INVALID",
    );
  });

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
    expect(businessQueries.some((query) => query.sql.includes('"nationalIdEncrypted" = NULL'))).toBe(true);
    expect(businessQueries.some((query) => query.sql.includes('"photoKey" = NULL'))).toBe(true);
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

  it("enrollment kota reddinde öğrenci oluşturmayı aynı transaction içinde rollback yapar", async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push(sql);
        if (sql.includes('candidate::text AS "studentNo"')) {
          return { rows: [{ studentNo: "101" }] as T[] };
        }
        if (sql.includes('INSERT INTO "Student"')) {
          return {
            rows: [{
              id: String(values?.[0]),
              tenantId: "tenant-a",
              studentNo: "101",
              firstName: "Kotalı",
              lastName: "Öğrenci",
              classId: "class-a",
              responsibleTeacherId: null,
              status: "ACTIVE",
              deletedAt: null,
            }] as T[],
          };
        }
        if (sql.includes('INSERT INTO "StudentEnrollment"')) {
          throw Object.assign(new Error("ACTIVE_STUDENT_LIMIT_REACHED"), { code: "P0001" });
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
        await expect(store.createWithEnrollment(
          { tenantId: "tenant-a", firstName: "Kotalı", lastName: "Öğrenci", classId: "class-a" },
          { classId: "class-a", startsAt: "2026-08-01", status: "ACTIVE", reason: "CREATED" },
        )).rejects.toThrow("ACTIVE_STUDENT_LIMIT_REACHED");
      },
    );

    expect(queries.some((sql) => sql.includes('INSERT INTO "Student"'))).toBe(true);
    expect(queries.some((sql) => sql.includes('INSERT INTO "StudentEnrollment"'))).toBe(true);
    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(client.releaseCalled).toBe(true);
  });

  it("öğrenci pasifleştirmesini enrollment, davet, hesap, üyelik ve session ile atomik kapatır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('UPDATE "Student"') && sql.includes('RETURNING *')) {
          return {
            rows: [{
              id: "student-a",
              tenantId: "tenant-a",
              studentNo: "100",
              firstName: "Ada",
              lastName: "A",
              userId: "student-user-a",
              classId: "class-a",
              responsibleTeacherId: null,
              status: "PASSIVE",
              deletedAt: null,
            }] as T[],
          };
        }
        if (sql.includes('UPDATE "IdentityInvitation"')) return { rows: [{ id: "invitation-a" }] as T[] };
        if (sql.includes('UPDATE "TenantMembership"')) return { rows: [{ id: "membership-a" }] as T[] };
        if (sql.includes('UPDATE "AuthSession"')) return { rows: [{ id: "session-a" }, { id: "session-b" }] as T[] };
        return { rows: [] as T[] };
      },
      release() {},
    };
    const store = new PostgresStudentStore({
      query: client.query,
      async connect() { return client; },
    });

    const result = await runWithRequestContext(
      { userId: "admin-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.updateWithEnrollmentTransition(
        "student-a",
        { status: "PASSIVE" },
        {
          closeActive: { endsAt: "2026-08-01", status: "PASSIVE" },
          suspendPortalAccess: { reason: "STUDENT_STATUS_PASSIVE" },
        },
      ),
    );

    expect(result?.portalAccess).toEqual({
      userId: "student-user-a",
      membershipSuspended: true,
      sessionsRevoked: 2,
      invitationsRevoked: 1,
    });
    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some(({ sql }) => sql.includes('UPDATE "StudentEnrollment"'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "IdentityInvitation"') && sql.includes("'REVOKED'"))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "SecretDeliveryOutbox"') && sql.includes('"payloadEncrypted" = NULL'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "TenantMembership"') && sql.includes('"version" = "version" + 1'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "User"') && sql.includes('"accountStatus" = \'DISABLED\''))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "AuthSession"') && sql.includes("'REVOKED'"))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "NotificationDeviceToken"'))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("portal session kapanışı hata verirse öğrenci pasifleştirmesini rollback eder", async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string) {
        queries.push(sql);
        if (sql.includes('UPDATE "Student"') && sql.includes('RETURNING *')) {
          return {
            rows: [{
              id: "student-a",
              tenantId: "tenant-a",
              studentNo: "100",
              firstName: "Ada",
              lastName: "A",
              userId: "student-user-a",
              status: "PASSIVE",
              deletedAt: null,
            }] as T[],
          };
        }
        if (sql.includes('UPDATE "TenantMembership"')) return { rows: [{ id: "membership-a" }] as T[] };
        if (sql.includes('UPDATE "AuthSession"')) throw new Error("SESSION_REVOKE_FAILED");
        return { rows: [] as T[] };
      },
      release() {},
    };
    const store = new PostgresStudentStore({
      query: client.query,
      async connect() { return client; },
    });

    await expect(runWithRequestContext(
      { userId: "admin-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.updateWithEnrollmentTransition(
        "student-a",
        { status: "PASSIVE" },
        {
          closeActive: { endsAt: "2026-08-01", status: "PASSIVE" },
          suspendPortalAccess: { reason: "STUDENT_STATUS_PASSIVE" },
        },
      ),
    )).rejects.toThrow("SESSION_REVOKE_FAILED");

    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
  });

  it("portal erişim PATCH'ini üyelik CAS, hesap sürümü ve session revoke ile tek transaction'da uygular", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('SELECT s."id" AS "studentId"')) {
          return { rows: [{
            studentId: "student-a",
            studentStatus: "ACTIVE",
            userId: "student-user-a",
            accountStatus: "ACTIVE",
            membershipId: "membership-a",
            membershipStatus: "ACTIVE",
            membershipVersion: 4,
          }] as T[] };
        }
        if (sql.includes('UPDATE "TenantMembership"')) return { rows: [{ version: 5 }] as T[] };
        if (sql.includes('UPDATE "AuthSession"')) return { rows: [{ id: "session-a" }] as T[] };
        return { rows: [] as T[] };
      },
      release() {},
    };
    const store = new PostgresStudentStore({
      query: client.query,
      async connect() { return client; },
    });

    const result = await store.updatePortalAccess("tenant-a", "student-a", {
      status: "SUSPENDED",
      expectedVersion: 4,
    });

    expect(result).toEqual({
      studentId: "student-a",
      tenantId: "tenant-a",
      userId: "student-user-a",
      accountStatus: "DISABLED",
      membership: { id: "membership-a", status: "SUSPENDED", version: 5 },
      sessionsRevoked: 1,
    });
    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some(({ sql, values }) => sql.includes('UPDATE "TenantMembership"') && values?.[4] === 4)).toBe(true);
    expect(queries.some(({ sql, values }) => sql.includes('UPDATE "User"') && values?.[3] === 5)).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "AuthSession"'))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });
});
