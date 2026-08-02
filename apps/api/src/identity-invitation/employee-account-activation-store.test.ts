import { describe, expect, it } from "vitest";
import { PostgresEmployeeAccountActivationStore } from "./employee-account-activation-store.js";

describe("PostgresEmployeeAccountActivationStore", () => {
  it("hesap, canonical üyelik, çalışan bağı ve davet tüketimini tek transaction'da yazar", async () => {
    const queries: RecordedQuery[] = [];
    const store = new PostgresEmployeeAccountActivationStore(createPool(queries, { role: "TENANT_ADMIN" }));

    await expect(store.accept(acceptInput())).resolves.toMatchObject({
      status: "ACCEPTED",
      invitation: { id: "invitation-a", acceptedUserId: "user-a", role: "TENANT_ADMIN" },
    });

    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some(({ sql }) => sql.includes("app.bypass_rls"))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('JOIN "LicenseTerm" license'))).toBe(true);
    const invitationLock = queryIndex(queries, 'FROM "IdentityInvitation"');
    const userInsert = queryIndex(queries, 'INSERT INTO "User"');
    const membershipInsert = queryIndex(queries, 'INSERT INTO "TenantMembership"');
    const employeeBind = queryIndex(queries, 'UPDATE "Employee"');
    const invitationAccept = queryIndex(queries, `SET "status" = 'ACCEPTED'`);
    expect(invitationLock).toBeGreaterThan(0);
    expect(userInsert).toBeGreaterThan(invitationLock);
    expect(membershipInsert).toBeGreaterThan(userInsert);
    expect(employeeBind).toBeGreaterThan(membershipInsert);
    expect(invitationAccept).toBeGreaterThan(employeeBind);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("kullanıcı insertinden sonraki çalışan bağı hatasında bütün transactionı rollback eder", async () => {
    const queries: RecordedQuery[] = [];
    const store = new PostgresEmployeeAccountActivationStore(createPool(queries, { failEmployeeBind: true }));

    await expect(store.accept(acceptInput())).rejects.toThrow("EMPLOYEE_ACTIVATION_BIND_FAILED");

    expect(queries.some(({ sql }) => sql.includes('INSERT INTO "User"'))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("ROLLBACK");
    expect(queries.some(({ sql }) => sql === "COMMIT")).toBe(false);
  });

  it("davet daha önce tüketildiyse replay'i yazı üretmeden reddeder", async () => {
    const queries: RecordedQuery[] = [];
    const store = new PostgresEmployeeAccountActivationStore(createPool(queries, { invitationStatus: "ACCEPTED" }));

    await expect(store.accept(acceptInput())).resolves.toEqual({ status: "NOT_PENDING" });

    expect(queries.some(({ sql }) => sql.includes('INSERT INTO "User"'))).toBe(false);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "Employee"'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("çalışan hesap sınırı doluysa kullanıcı oluşturmadan reddeder", async () => {
    const queries: RecordedQuery[] = [];
    const store = new PostgresEmployeeAccountActivationStore(createPool(queries, { activeEmployeeAccountCount: 1 }), 1);

    await expect(store.accept(acceptInput())).resolves.toEqual({ status: "ACCOUNT_LIMIT_EXCEEDED" });

    expect(queries.some(({ sql }) => sql.includes('INSERT INTO "User"'))).toBe(false);
    expect(queries.some(({ sql }) => sql.includes('DELETE FROM "TenantMembership"'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("aynı e-postadaki öğrenci hesabını çalışan hesabına dönüştürmez", async () => {
    const queries: RecordedQuery[] = [];
    const store = new PostgresEmployeeAccountActivationStore(createPool(queries, {
      existingUserId: "student-user-a",
      memberships: [{ role: "STUDENT", hasTeacherPersona: false, hasStudentPersona: true, version: 1 }],
    }));

    await expect(store.accept(acceptInput())).resolves.toEqual({ status: "EMAIL_ACCOUNT_INCOMPATIBLE" });

    expect(queries.some(({ sql }) => sql.includes('DELETE FROM "TenantMembership"'))).toBe(false);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "Employee"'))).toBe(false);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });
});

function acceptInput() {
  return {
    tokenHash: "token-hash-a",
    passwordHash: "scrypt:v2:password-hash",
    name: "Ada Operasyon",
    acceptedAt: "2026-08-02T12:00:00.000Z",
  };
}

function createPool(
  queries: RecordedQuery[],
  options: {
    activeEmployeeAccountCount?: number;
    existingUserId?: string;
    failEmployeeBind?: boolean;
    invitationStatus?: "PENDING" | "ACCEPTED" | "REVOKED";
    memberships?: MembershipRow[];
    role?: "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATIONS_STAFF" | "FINANCE_STAFF";
  } = {},
) {
  const invitation = invitationRow(options.invitationStatus ?? "PENDING", options.role ?? "OPERATIONS_STAFF");
  return {
    async connect() {
      return {
        async query<T>(sql: string, values?: unknown[]) {
          queries.push({ sql, values });
          if (sql.includes('FROM "IdentityInvitation"')) return { rows: [invitation] as T[] };
          if (sql.includes('FROM "Tenant" tenant')) {
            return { rows: [{ id: "tenant-a" }] as T[] };
          }
          if (sql.includes('FROM "Employee"') && sql.includes('"id" = $2')) {
            return { rows: [{ id: "employee-a", status: "ACTIVE", userId: null }] as T[] };
          }
          if (sql.includes('FROM "Employee"') && sql.includes('"userId" = $2')) return { rows: [] as T[] };
          if (sql.includes('FROM "User"')) {
            return { rows: options.existingUserId ? [{ id: options.existingUserId }] as T[] : [] as T[] };
          }
          if (sql.includes('FROM "Employee"') && sql.includes('COUNT(DISTINCT')) {
            return { rows: [{ activeEmployeeAccountCount: options.activeEmployeeAccountCount ?? 0 }] as T[] };
          }
          if (sql.includes('FROM "TenantMembership"')) return { rows: (options.memberships ?? []) as T[] };
          if (sql.includes('INSERT INTO "User"')) return { rows: [{ id: "user-a" }] as T[] };
          if (sql.includes('UPDATE "Employee"')) {
            return { rows: options.failEmployeeBind ? [] as T[] : [{ id: "employee-a" }] as T[] };
          }
          if (sql.includes(`SET "status" = 'ACCEPTED'`)) {
            return { rows: [{ ...invitation, status: "ACCEPTED", acceptedAt: new Date(acceptInput().acceptedAt), acceptedUserId: "user-a" }] as T[] };
          }
          return { rows: [] as T[] };
        },
        release() {},
      };
    },
    async query<T>() { return { rows: [] as T[] }; },
  };
}

function invitationRow(
  status: "PENDING" | "ACCEPTED" | "REVOKED",
  role: "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATIONS_STAFF" | "FINANCE_STAFF",
) {
  return {
    id: "invitation-a",
    tenantId: "tenant-a",
    subjectType: "EMPLOYEE",
    subjectId: "employee-a",
    email: "ada@example.test",
    name: "Ada Operasyon",
    role,
    kind: "EMAIL_LINK",
    status,
    expiresAt: new Date("2026-08-03T12:00:00.000Z"),
    acceptedAt: status === "ACCEPTED" ? new Date("2026-08-02T11:00:00.000Z") : null,
    acceptedUserId: status === "ACCEPTED" ? "user-a" : null,
    createdAt: new Date("2026-08-02T10:00:00.000Z"),
    updatedAt: new Date("2026-08-02T10:00:00.000Z"),
  };
}

function queryIndex(queries: RecordedQuery[], fragment: string): number {
  return queries.findIndex(({ sql }) => sql.includes(fragment));
}

interface RecordedQuery {
  sql: string;
  values?: unknown[];
}

interface MembershipRow {
  role: string;
  hasTeacherPersona: boolean;
  hasStudentPersona: boolean;
  version: number;
}
