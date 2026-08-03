import { describe, expect, it } from "vitest";
import {
  hashStudentPortalActivationCode,
  PostgresStudentPortalActivationStore,
} from "./student-portal-activation-store.js";

describe("PostgresStudentPortalActivationStore", () => {
  it("kod kabulünde user, membership, student bağı ve invitation tüketimini tek transaction'da yazar", async () => {
    const invitationId = "invitation-a";
    const code = "ABCDEFGHJKL2";
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresStudentPortalActivationStore(createPool(queries, { invitationId, code }));

    const result = await store.accept({
      tenantSlug: "okul-a",
      studentNo: "101",
      code,
      password: "secure-password-123",
    });

    expect(result).toMatchObject({ status: "ACCEPTED", invitationId, loginName: "101", tenantId: "tenant-a" });
    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some(({ sql }) => sql.includes("app.bypass_rls"))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('JOIN "LicenseTerm" license') && sql.includes('now() < license."endsAt"'))).toBe(true);
    const userInsert = queries.findIndex(({ sql }) => sql.includes('INSERT INTO "User"'));
    const membershipInsert = queries.findIndex(({ sql }) => sql.includes('INSERT INTO "TenantMembership"'));
    const studentBind = queries.findIndex(({ sql }) => sql.includes('UPDATE "Student" SET "userId"'));
    const invitationAccept = queries.findIndex(({ sql }) => sql.includes(`SET "status" = 'ACCEPTED'`));
    expect(userInsert).toBeGreaterThan(0);
    expect(membershipInsert).toBeGreaterThan(userInsert);
    expect(studentBind).toBeGreaterThan(membershipInsert);
    expect(invitationAccept).toBeGreaterThan(studentBind);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("yanlış kod denemesini commit eder ve deneme sayısını artırır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresStudentPortalActivationStore(createPool(queries, {
      invitationId: "invitation-a",
      code: "ABCDEFGHJKL2",
    }));

    await expect(store.accept({
      tenantSlug: "okul-a",
      studentNo: "101",
      code: "222222222222",
      password: "secure-password-123",
    })).resolves.toEqual({ status: "INVALID" });

    const attemptUpdate = queries.find(({ sql }) => sql.includes('SET "failedAttempts" = $2'));
    expect(attemptUpdate?.values).toEqual(["invitation-a", 1]);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO "User"'))).toBe(false);
  });

  it("hesap inserti başarısızsa bütün aktivasyon transactionını rollback eder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresStudentPortalActivationStore(createPool(queries, {
      invitationId: "invitation-a",
      code: "ABCDEFGHJKL2",
      failUserInsert: true,
    }));

    await expect(store.accept({
      tenantSlug: "okul-a",
      studentNo: "101",
      code: "ABCDEFGHJKL2",
      password: "secure-password-123",
    })).rejects.toThrow("USER_INSERT_FAILED");

    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
    expect(queries.some(({ sql }) => sql.includes('INSERT INTO "TenantMembership"'))).toBe(false);
    expect(queries.some(({ sql }) => sql === "COMMIT")).toBe(false);
  });
});

function createPool(
  queries: Array<{ sql: string; values?: unknown[] }>,
  options: { invitationId: string; code: string; failUserInsert?: boolean },
) {
  return {
    async connect() {
      return {
        async query<T>(sql: string, values?: unknown[]) {
          queries.push({ sql, values });
          if (sql.includes('FROM "Tenant"')) return { rows: [{ id: "tenant-a" }] as T[] };
          if (sql.includes('FROM "Student"')) {
            return {
              rows: [{
                studentId: "student-a",
                studentNo: "101",
                firstName: "Ada",
                lastName: "A",
                status: "ACTIVE",
                userId: null,
                tenantSlug: "okul-a",
              }] as T[],
            };
          }
          if (sql.includes('FROM "IdentityInvitation"')) {
            return {
              rows: [{
                id: options.invitationId,
                tokenHash: hashStudentPortalActivationCode(options.invitationId, options.code),
                expiresAt: new Date(Date.now() + 60_000),
                failedAttempts: 0,
                maxAttempts: 5,
              }] as T[],
            };
          }
          if (options.failUserInsert && sql.includes('INSERT INTO "User"')) throw new Error("USER_INSERT_FAILED");
          return { rows: [] as T[] };
        },
        release() {},
      };
    },
    async query<T>() { return { rows: [] as T[] }; },
  };
}
