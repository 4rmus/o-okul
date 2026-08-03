import { describe, expect, it } from "vitest";
import { PostgresIdentityInvitationStore } from "./identity-invitation-store.js";

describe("PostgresIdentityInvitationStore", () => {
  it("invitation ve secret outbox insertlerini aynı tenant transactionında tutar", async () => {
    const queries: string[] = [];
    const pool = {
      async connect() {
        return {
          async query<T>(sql: string) {
            queries.push(sql);
            if (sql.includes('INSERT INTO "IdentityInvitation"')) {
              return { rows: [invitationRow()] as T[] };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
      async query<T>() { return { rows: [] as T[] }; },
    };
    const store = new PostgresIdentityInvitationStore(pool);
    const expiresAt = "2026-08-02T12:00:00.000Z";

    await store.create({
      tenantId: "tenant-a",
      subjectType: "TEACHER",
      subjectId: "teacher-a",
      email: "teacher@example.test",
      name: "Teacher",
      role: "TEACHER",
      tokenHash: "token-hash",
      expiresAt,
      delivery: {
        tenantId: "tenant-a",
        purpose: "IDENTITY_INVITATION",
        payloadEncrypted: "encrypted-payload",
        expiresAt,
      },
    });

    expect(queries[0]).toBe("BEGIN");
    expect(queries.some((sql) => sql.includes("app.current_tenant_id"))).toBe(true);
    expect(queries.some((sql) => sql.includes('INSERT INTO "IdentityInvitation"'))).toBe(true);
    expect(queries.some((sql) => sql.includes('INSERT INTO "SecretDeliveryOutbox"'))).toBe(true);
    expect(queries.at(-1)).toBe("COMMIT");
  });

  it("resend sırasında eski secret'ı temizleyip yeni outbox kaydını atomik ekler", async () => {
    const queries: string[] = [];
    const pool = {
      async connect() {
        return {
          async query<T>(sql: string) {
            queries.push(sql);
            if (sql.includes('UPDATE "IdentityInvitation"')) return { rows: [invitationRow()] as T[] };
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
      async query<T>() { return { rows: [] as T[] }; },
    };
    const store = new PostgresIdentityInvitationStore(pool);
    const expiresAt = "2026-08-02T12:00:00.000Z";

    await store.resend("tenant-a", "invitation-a", {
      tokenHash: "new-token-hash",
      expiresAt,
      delivery: {
        tenantId: "tenant-a",
        purpose: "IDENTITY_INVITATION",
        payloadEncrypted: "new-encrypted-payload",
        expiresAt,
      },
    });

    const clearIndex = queries.findIndex((sql) => sql.includes(`"payloadEncrypted" = NULL`));
    const insertIndex = queries.findIndex((sql) => sql.includes('INSERT INTO "SecretDeliveryOutbox"'));
    expect(clearIndex).toBeGreaterThan(0);
    expect(insertIndex).toBeGreaterThan(clearIndex);
    expect(queries.at(-1)).toBe("COMMIT");
  });

  it("profil kapanışında bekleyen daveti ve şifreli teslimatı aynı transaction'da iptal eder", async () => {
    const queries: string[] = [];
    const pool = {
      async connect() {
        return {
          async query<T>(sql: string) {
            queries.push(sql);
            if (sql.includes('UPDATE "IdentityInvitation"')) {
              return { rows: [{ id: "invitation-a" }] as T[] };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
      async query<T>() { return { rows: [] as T[] }; },
    };
    const store = new PostgresIdentityInvitationStore(pool);

    await expect(store.revokePendingForSubject("tenant-a", "TEACHER", "teacher-a")).resolves.toBe(1);

    expect(queries.some((sql) => sql.includes(`"status" = 'REVOKED'`))).toBe(true);
    expect(queries.some((sql) => sql.includes(`"payloadEncrypted" = NULL`))).toBe(true);
    expect(queries.some((sql) => sql.includes(`"claimToken" = NULL`))).toBe(true);
    expect(queries.at(-1)).toBe("COMMIT");
  });
});

function invitationRow() {
  const now = new Date("2026-08-01T12:00:00.000Z");
  return {
    id: "invitation-a",
    tenantId: "tenant-a",
    subjectType: "TEACHER" as const,
    subjectId: "teacher-a",
    email: "teacher@example.test",
    name: "Teacher",
    role: "TEACHER" as const,
    kind: "EMAIL_LINK" as const,
    status: "PENDING" as const,
    expiresAt: new Date("2026-08-02T12:00:00.000Z"),
    acceptedAt: null,
    acceptedUserId: null,
    createdAt: now,
    updatedAt: now,
  };
}
