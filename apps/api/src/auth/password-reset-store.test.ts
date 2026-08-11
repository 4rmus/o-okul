import { afterEach, describe, expect, it } from "vitest";
import { InMemoryAuthUserStore, PostgresAuthUserStore, resetInMemoryAuthUsers } from "./auth-user-store.js";
import { InMemoryPasswordResetStore, PostgresPasswordResetStore } from "./password-reset-store.js";
import { InMemorySessionStore, PostgresSessionStore } from "./session-store.js";

afterEach(() => resetInMemoryAuthUsers());

describe("PostgresPasswordResetStore", () => {
  it("reset tokenı kullanıcı kilidi ve şifreli outbox ile aynı transaction'da üretir", async () => {
    const queries: string[] = [];
    const store = new PostgresPasswordResetStore(poolWith(async <T>(sql: string) => {
      queries.push(sql);
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] as T[] };
      if (sql.includes('INSERT INTO "PasswordResetToken"')) {
        return { rows: [resetRow()] as T[] };
      }
      return { rows: [] as T[] };
    }) as never);

    await store.issue(resetInput());

    expect(queries[0]).toBe("BEGIN");
    expect(queries.some((sql) => sql.includes("pg_advisory_xact_lock"))).toBe(true);
    expect(queries.some((sql) => sql.includes('INSERT INTO "PasswordResetToken"'))).toBe(true);
    expect(queries.some((sql) => sql.includes('INSERT INTO "SecretDeliveryOutbox"'))).toBe(true);
    expect(queries.at(-1)).toBe("COMMIT");
  });

  it("reissue outbox insert başarısızsa eski tokenı geçersiz kılmadan rollback eder", async () => {
    const queries: string[] = [];
    const store = new PostgresPasswordResetStore(poolWith(async <T>(sql: string) => {
      queries.push(sql);
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] as T[] };
      if (sql.includes('INSERT INTO "PasswordResetToken"')) return { rows: [resetRow()] as T[] };
      if (sql.includes('INSERT INTO "SecretDeliveryOutbox"')) throw new Error("OUTBOX_INSERT_FAILED");
      return { rows: [] as T[] };
    }) as never);

    await expect(store.issue(resetInput())).rejects.toThrow("OUTBOX_INSERT_FAILED");
    expect(queries.at(-1)).toBe("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
  });

  it("token kullanıldığında sibling pending tokenları ve secret payloadlarını aynı transaction'da geçersiz kılar", async () => {
    const queries: string[] = [];
    const store = new PostgresPasswordResetStore(poolWith(async <T>(sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT "userId" FROM "PasswordResetToken"')) return { rows: [{ userId: "user-a" }] as T[] };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] as T[] };
      if (sql.includes("SET \"status\" = 'USED'")) return { rows: [resetRow()] as T[] };
      if (sql.includes("SET \"status\" = 'REVOKED'")) return { rows: [{ id: "reset-sibling" }] as T[] };
      return { rows: [] as T[] };
    }) as never);

    await store.markUsed("reset-a", "2026-08-01T12:05:00.000Z");

    expect(queries.some((sql) => sql.includes('"id" <> $2'))).toBe(true);
    expect(queries.some((sql) => sql.includes(`"payloadEncrypted" = NULL`))).toBe(true);
    expect(queries.some((sql) => sql.includes(`"claimToken" = NULL`))).toBe(true);
    expect(queries.at(-1)).toBe("COMMIT");
  });

  it("parola resetinde membership sürümünü eşitler ve session hatasında transactionı rollback eder", async () => {
    const queries: string[] = [];
    const pool = poolWith(async <T>(sql: string) => {
      queries.push(sql);
      if (sql.includes('SELECT "userId" FROM "PasswordResetToken"')) return { rows: [{ userId: "user-a" }] as T[] };
      if (sql.includes("pg_advisory_xact_lock")) return { rows: [] as T[] };
      if (sql.includes("SET \"status\" = 'USED'")) return { rows: [resetRow()] as T[] };
      if (sql.includes('SET "passwordHash" = $2')) {
        return { rows: [{ id: "user-a", tenantId: "tenant-a", membershipVersion: 2 }] as T[] };
      }
      if (sql.includes('FROM "User" u')) return { rows: [authUserRow()] as T[] };
      if (sql.includes('UPDATE "AuthSession"')) throw new Error("SESSION_REVOKE_FAILED");
      return { rows: [] as T[] };
    }) as never;
    const store = new PostgresPasswordResetStore(pool);
    const users = new PostgresAuthUserStore(pool);
    const sessions = new PostgresSessionStore(pool);

    await expect(store.confirm("reset-a", "2026-08-01T12:05:00.000Z", async (transaction) => {
      const updated = await users.updatePasswordForReset("user-a", "scrypt:v2:salt:hash", {
        mustChangePassword: false,
        passwordChangedAt: "2026-08-01T12:05:00.000Z",
      }, transaction);
      expect(updated).toBe(true);
      await sessions.revokeByUser("user-a", transaction);
    })).rejects.toThrow("SESSION_REVOKE_FAILED");

    expect(queries.some((sql) => sql.includes('SET "passwordHash" = $2'))).toBe(true);
    expect(queries.some((sql) => sql.includes('UPDATE "TenantMembership"'))).toBe(true);
    expect(queries.some((sql) => sql.includes('UPDATE "AuthSession"'))).toBe(true);
    expect(queries.at(-1)).toBe("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
  });
});

describe("InMemoryPasswordResetStore", () => {
  it("reissue sonrası kullanıcı başına yalnız en yeni token pending kalır", async () => {
    const store = new InMemoryPasswordResetStore();
    const first = await store.issue(resetInput());
    const second = await store.issue({
      ...resetInput(),
      tokenHash: "token-hash-next",
      resendNotBefore: new Date().toISOString(),
    });

    expect(first?.status).toBe("PENDING");
    expect(second?.status).toBe("PENDING");
    await expect(store.findByTokenHash("token-hash")).resolves.toMatchObject({ status: "REVOKED" });
    await expect(store.findPendingForUser("user-a")).resolves.toMatchObject({ tokenHash: "token-hash-next" });
  });

  it("onay işlemi başarısızsa gerçek user/session yazımlarını uygulamaz ve tokenı pending bırakır", async () => {
    const store = new InMemoryPasswordResetStore();
    const users = new InMemoryAuthUserStore();
    const sessions = new InMemorySessionStore();
    const before = await users.findById("user-tenant-a");
    const session = await sessions.create({
      userId: "user-tenant-a",
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
      refreshToken: "refresh-token",
      membershipVersion: before!.membershipVersion,
      expiresAt: new Date("2026-09-01T12:00:00.000Z"),
    });
    const reset = await store.issue({ ...resetInput(), userId: "user-tenant-a" });

    await expect(store.confirm(reset!.id, "2026-08-01T12:05:00.000Z", async (transaction) => {
      await users.updatePasswordForReset("user-tenant-a", "scrypt:v2:next:hash", {
        mustChangePassword: false,
        passwordChangedAt: "2026-08-01T12:05:00.000Z",
      }, transaction);
      await sessions.revokeByUser("user-tenant-a", transaction);
      throw new Error("PASSWORD_UPDATE_FAILED");
    })).rejects.toThrow("PASSWORD_UPDATE_FAILED");

    await expect(users.findById("user-tenant-a")).resolves.toMatchObject({
      passwordHash: before!.passwordHash,
      membershipVersion: before!.membershipVersion,
    });
    await expect(sessions.findById(session.id)).resolves.toMatchObject({ status: "ACTIVE" });
    await expect(store.findByTokenHash("token-hash")).resolves.toMatchObject({ status: "PENDING" });
  });
});

function resetInput() {
  const expiresAt = "2026-08-01T12:30:00.000Z";
  return {
    userId: "user-a",
    tokenHash: "token-hash",
    expiresAt,
    resendNotBefore: "2026-08-01T11:50:00.000Z",
    delivery: {
      tenantId: "tenant-a",
      purpose: "PASSWORD_RESET" as const,
      payloadEncrypted: "encrypted-payload",
      expiresAt,
    },
  };
}

function resetRow() {
  const now = new Date("2026-08-01T12:00:00.000Z");
  return {
    id: "reset-a",
    userId: "user-a",
    tokenHash: "token-hash",
    status: "PENDING" as const,
    expiresAt: new Date("2026-08-01T12:30:00.000Z"),
    usedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

function authUserRow() {
  return {
    id: "user-a",
    tenantId: "tenant-a",
    email: "user-a@example.test",
    phone: null,
    nationalIdEncrypted: null,
    nationalIdHash: null,
    name: "User A",
    passwordHash: "scrypt:v2:salt:hash",
    membershipVersion: 2,
    mustChangePassword: false,
    passwordChangedAt: new Date("2026-08-01T12:05:00.000Z"),
    totpSecretEncrypted: null,
    totpEnabledAt: null,
    totpRecoveryCodeHashes: [],
    totpLastUsedCounter: null,
    roles: ["TENANT_ADMIN"],
    canonicalMembershipId: "membership-a",
    canonicalMembershipCount: 1,
    canonicalStaffRole: "TENANT_ADMIN",
    canonicalHasTeacherPersona: false,
    canonicalHasStudentPersona: false,
    canonicalMembershipVersion: 2,
    canonicalScopeMode: "TENANT",
    canonicalCampusIds: [],
  };
}

function poolWith(queryImpl: <T>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>) {
  return {
    async connect() {
      return { query: queryImpl, release() {} };
    },
  };
}
