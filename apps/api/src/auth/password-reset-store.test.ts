import { describe, expect, it } from "vitest";
import { InMemoryPasswordResetStore, PostgresPasswordResetStore } from "./password-reset-store.js";

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
    expect(queries.at(-1)).toBe("COMMIT");
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

function poolWith(queryImpl: <T>(sql: string, values?: unknown[]) => Promise<{ rows: T[] }>) {
  return {
    async connect() {
      return { query: queryImpl, release() {} };
    },
  };
}
