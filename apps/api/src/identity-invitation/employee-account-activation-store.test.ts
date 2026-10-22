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

  it("iptal edilen daveti REVOKED, kabul edilmiş daveti NOT_PENDING olarak ayırır (UAT F-20)", async () => {
    const revokedQueries: RecordedQuery[] = [];
    const revoked = new PostgresEmployeeAccountActivationStore(createPool(revokedQueries, { invitationStatus: "REVOKED" }));
    await expect(revoked.accept(acceptInput())).resolves.toEqual({ status: "REVOKED" });
    expect(revokedQueries.some(({ sql }) => sql.includes('INSERT INTO "User"'))).toBe(false);

    const accepted = new PostgresEmployeeAccountActivationStore(createPool([], { invitationStatus: "ACCEPTED" }));
    await expect(accepted.accept(acceptInput())).resolves.toEqual({ status: "NOT_PENDING" });
  });

  it("süresi geçmiş iptal edilmiş daveti servisle aynı biçimde EXPIRED olarak bildirir (UAT F-20 inceleme)", async () => {
    const store = new PostgresEmployeeAccountActivationStore(createPool([], { invitationStatus: "REVOKED" }));
    await expect(store.accept({ ...acceptInput(), acceptedAt: "2026-08-04T12:00:00.000Z" })).resolves.toEqual({ status: "EXPIRED" });
  });

  it("öğretmen bağlı çalışan kaydındaki hesabı da başka çalışana bağlı sayar (UAT F-20)", async () => {
    const queries: RecordedQuery[] = [];
    const store = new PostgresEmployeeAccountActivationStore(createPool(queries, {
      existingUserId: "teacher-user-a",
      boundToOtherEmployee: true,
      memberships: [{ role: "TEACHER", hasTeacherPersona: true, hasStudentPersona: false, version: 1 }],
    }));

    await expect(store.accept(acceptInput())).resolves.toEqual({ status: "EMAIL_ACCOUNT_ALREADY_BOUND" });

    const boundCheck = queries.find(({ sql }) => sql.includes('FROM "Employee" e') && sql.includes('"userId" = $2'));
    expect(boundCheck?.sql).toContain('LEFT JOIN "Teacher" t');
    // Activation decides under row locks (the invitation-time pre-check does not).
    expect(boundCheck?.sql).toContain("FOR UPDATE OF e");
    expect(queries.find(({ sql }) => sql.includes('FROM "User"'))?.sql).toContain("FOR UPDATE");
    expect(queries.find(({ sql }) => sql.includes('FROM "TenantMembership"'))?.sql).toContain("FOR UPDATE");
    expect(boundCheck?.sql).toContain('t."userId" = $2');
    expect(boundCheck?.values).toEqual(["tenant-a", "teacher-user-a", "employee-a"]);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "Employee"'))).toBe(false);
  });

  it.each([
    ["başka çalışana bağlı hesap", { existingUserId: "user-b", boundToOtherEmployee: true }, "EMAIL_ACCOUNT_ALREADY_BOUND"],
    [
      "öğrenci hesabı",
      { existingUserId: "student-user-a", memberships: [{ role: "STUDENT", hasTeacherPersona: false, hasStudentPersona: true, version: 1 }] },
      "EMAIL_ACCOUNT_INCOMPATIBLE",
    ],
    [
      "veli hesabı",
      { existingUserId: "guardian-user-a", memberships: [{ role: "GUARDIAN", hasTeacherPersona: false, hasStudentPersona: false, version: 1 }] },
      "EMAIL_ACCOUNT_INCOMPATIBLE",
    ],
    [
      "bağsız öğretmen hesabı",
      { existingUserId: "teacher-user-a", memberships: [{ role: "TEACHER", hasTeacherPersona: true, hasStudentPersona: false, version: 1 }] },
      undefined,
    ],
    ["hesabı olmayan e-posta", {}, undefined],
  ] as const)("davet öncesi e-posta kontrolü %s için aktivasyon kuralını uygular (UAT F-20)", async (_label, options, expected) => {
    const queries: RecordedQuery[] = [];
    const store = new PostgresEmployeeAccountActivationStore(createPool(queries, options as PoolOptions));

    await expect(store.findInvitationEmailConflict({ tenantId: "tenant-a", employeeId: "employee-a", email: " Ada@Example.test " }))
      .resolves.toBe(expected);

    // Runs in the caller's tenant with RLS on, writes nothing and takes no row locks.
    expect(queries).toContainEqual({ sql: "SELECT set_config('app.bypass_rls', $1, true)", values: ["false"] });
    expect(queries).toContainEqual({ sql: "SELECT set_config('app.current_tenant_id', $1, true)", values: ["tenant-a"] });
    expect(queries.find(({ sql }) => sql.includes('FROM "User"'))?.values).toEqual(["tenant-a", "ada@example.test"]);
    expect(queries.some(({ sql }) => /\b(INSERT|UPDATE|DELETE)\b/.test(sql))).toBe(false);
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

  it("mevcut kampüs kapsamlı hesabı aktivasyonda TENANT kapsamına yükseltmez", async () => {
    const queries: RecordedQuery[] = [];
    const store = new PostgresEmployeeAccountActivationStore(createPool(queries, {
      existingUserId: "teacher-user-a",
      memberships: [{
        id: "membership-existing",
        role: "TEACHER",
        staffRole: null,
        hasTeacherPersona: true,
        hasStudentPersona: false,
        version: 3,
        scopeMode: "CAMPUSES",
        campusIds: ["campus-main"],
      }],
    }));

    await expect(store.accept(acceptInput())).resolves.toMatchObject({ status: "ACCEPTED" });

    const membershipInserts = queries.filter(({ sql }) => sql.includes('INSERT INTO "TenantMembership"'));
    expect(membershipInserts).toHaveLength(2);
    expect(membershipInserts.every(({ values }) => values?.[7] === "CAMPUSES")).toBe(true);
    const campusScopeInserts = queries.filter(({ sql }) => sql.includes('INSERT INTO "MembershipCampusScope"'));
    expect(campusScopeInserts).toHaveLength(2);
    expect(campusScopeInserts.every(({ values }) => values?.[3] === "campus-main")).toBe(true);
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

interface PoolOptions {
  activeEmployeeAccountCount?: number;
  boundToOtherEmployee?: boolean;
  existingUserId?: string;
  failEmployeeBind?: boolean;
  invitationStatus?: "PENDING" | "ACCEPTED" | "REVOKED";
  memberships?: MembershipRow[];
  role?: "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATIONS_STAFF" | "FINANCE_STAFF";
}

function createPool(queries: RecordedQuery[], options: PoolOptions = {}) {
  const invitation = invitationRow(options.invitationStatus ?? "PENDING", options.role ?? "OPERATIONS_STAFF");
  return {
    async connect() {
      return {
        async query<T>(sql: string, values?: unknown[]) {
          queries.push({ sql, values });
          if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
          if (sql.includes('FROM "IdentityInvitation"')) return { rows: [invitation] as T[] };
          if (sql.includes('FROM "Tenant" tenant')) {
            return { rows: [{ id: "tenant-a" }] as T[] };
          }
          if (sql.includes('FROM "Employee"') && sql.includes('"id" = $2')) {
            return { rows: [{ id: "employee-a", status: "ACTIVE", userId: null }] as T[] };
          }
          if (sql.includes('FROM "Employee"') && sql.includes('"userId" = $2')) {
            return { rows: options.boundToOtherEmployee ? [{ id: "employee-other" }] as T[] : [] as T[] };
          }
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
  id?: string;
  role: string;
  staffRole?: string | null;
  hasTeacherPersona: boolean;
  hasStudentPersona: boolean;
  version: number;
  scopeMode?: string;
  campusIds?: string[];
}
