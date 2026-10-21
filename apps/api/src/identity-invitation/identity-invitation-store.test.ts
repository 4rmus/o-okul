import { describe, expect, it } from "vitest";
import { InMemoryIdentityInvitationStore, PostgresIdentityInvitationStore } from "./identity-invitation-store.js";

describe("PostgresIdentityInvitationStore", () => {
  it("invitation ve secret outbox insertlerini aynı tenant transactionında tutar", async () => {
    const queries: string[] = [];
    const pool = {
      async connect() {
        return {
          async query<T>(sql: string) {
            queries.push(sql);
            if (sql.includes('FROM "Tenant"')) return { rows: [{ id: "tenant-a" }] as T[] };
            if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
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
        sourceScope: "TENANT", tenantLifecycleVersion: 0, purpose: "IDENTITY_INVITATION",
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
            if (sql.includes('FROM "Tenant"')) return { rows: [{ id: "tenant-a" }] as T[] };
            if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
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
        sourceScope: "TENANT", tenantLifecycleVersion: 0, purpose: "IDENTITY_INVITATION",
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
            if (sql.includes('FROM "Tenant"')) return { rows: [{ id: "tenant-a" }] as T[] };
            if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
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
    expect(queries.some((sql) => sql.includes(`"claimToken" = CASE WHEN "attempts" = 0 THEN NULL ELSE "claimToken" END`))).toBe(true);
    expect(queries.at(-1)).toBe("COMMIT");
  });
});

describe("PostgresIdentityInvitationStore cursor listesi", () => {
  function listPool(queries: Array<{ sql: string; values?: unknown[] }>) {
    return {
      async connect() {
        return {
          async query<T>(sql: string, values?: unknown[]) {
            queries.push({ sql, values });
            if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
            if (sql.includes('FROM "IdentityInvitation" i')) {
              const cursorKey = "2026-08-01 12:00:00";
              return { rows: [{ ...invitationRow(), cursorKey }, { ...invitationRow(), id: "invitation-b", cursorKey }] as T[] };
            }
            return { rows: [] as T[] };
          },
          release() {},
        };
      },
      async query<T>() { return { rows: [] as T[] }; },
    };
  }
  const query = { direction: "next" as const, limit: 1, sort: "-createdAt" as const };

  it("filtre ve aramayı SQL'de uygular, tokenHash seçmez ve limit+1 okur", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresIdentityInvitationStore(listPool(queries));

    const page = await store.listPage("tenant-a", { ...query, q: "Teacher_a", subjectType: "TEACHER", status: "PENDING", subjectId: "teacher-a" });

    expect(page.records.map((record) => record.id)).toEqual(["invitation-a"]);
    expect(page.meta).toEqual({ limit: 1, nextCursor: expect.any(String) });
    const listQuery = queries.find((entry) => entry.sql.includes('FROM "IdentityInvitation" i'));
    expect(listQuery?.values).toEqual(["tenant-a", "TEACHER", "teacher-a", "PENDING", "%teacher\\_a%", 2]);
    expect(listQuery?.sql).toContain('i."tenantId" = $1');
    expect(listQuery?.sql).toContain("LIKE $5 ESCAPE");
    expect(listQuery?.sql).toContain('ORDER BY i."createdAt" DESC, i."id" DESC');
    expect(listQuery?.sql).toContain('lower(translate(');
    expect(listQuery?.sql).not.toContain("tokenHash");
    expect(listQuery?.sql).not.toContain("OFFSET");
  });

  it("sonraki sayfayı cursor içindeki sıralama değeriyle okur; anchor satırını yeniden sorgulamaz", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresIdentityInvitationStore(listPool(queries));
    const first = await store.listPage("tenant-a", { ...query, subjectType: "TEACHER" });
    queries.length = 0;

    const second = await store.listPage("tenant-a", { ...query, subjectType: "TEACHER", cursor: first.meta.nextCursor });

    expect(second.meta.previousCursor).toEqual(expect.any(String));
    expect(queries.filter((entry) => entry.sql.includes('FROM "IdentityInvitation"'))).toHaveLength(1);
    const listQuery = queries.find((entry) => entry.sql.includes("ORDER BY"));
    expect(listQuery?.sql).toContain('(i."createdAt", i."id") < ($3::timestamp(3), $4::text)');
    expect(listQuery?.values).toEqual(["tenant-a", "TEACHER", "2026-08-01 12:00:00", "invitation-a", 2]);
  });

  it("başka tenant veya filtre için cursor'ı reddeder", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const store = new PostgresIdentityInvitationStore(listPool(queries));
    const first = await store.listPage("tenant-a", { ...query, subjectType: "TEACHER" });
    queries.length = 0;

    await expect(store.listPage("tenant-b", { ...query, subjectType: "TEACHER", cursor: first.meta.nextCursor }))
      .rejects.toThrow("IDENTITY_INVITATION_CURSOR_INVALID");
    await expect(store.listPage("tenant-a", { ...query, subjectType: "GUARDIAN", cursor: first.meta.nextCursor }))
      .rejects.toThrow("IDENTITY_INVITATION_CURSOR_INVALID");
    expect(queries).toEqual([]);
  });
});

describe("InMemoryIdentityInvitationStore cursor listesi", () => {
  async function seededStore() {
    const store = new InMemoryIdentityInvitationStore();
    const base = { tenantId: "tenant-a", role: "TEACHER" as const, tokenHash: "hash", expiresAt: "2099-01-01T00:00:00.000Z" };
    await store.create({ ...base, id: "inv-1", subjectType: "TEACHER", subjectId: "teacher-1", name: "Ada Öğretmen", email: "ada@example.test" });
    await store.create({ ...base, id: "inv-2", subjectType: "TEACHER", subjectId: "teacher-2", name: "Bora Öğretmen", email: "bora@example.test" });
    await store.create({ ...base, id: "inv-3", subjectType: "GUARDIAN", subjectId: "guardian-1", name: "Cem Veli", email: "cem@example.test", role: "GUARDIAN" });
    await store.create({ ...base, tenantId: "tenant-b", id: "inv-b", subjectType: "TEACHER", subjectId: "teacher-b", name: "B Öğretmen" });
    return store;
  }
  const query = { direction: "next" as const, limit: 1, sort: "createdAt" as const };

  it("ileri/geri sayfalar ve yalnız kendi tenant'ını döndürür", async () => {
    const store = await seededStore();

    const first = await store.listPage("tenant-a", query);
    const second = await store.listPage("tenant-a", { ...query, cursor: first.meta.nextCursor });
    const third = await store.listPage("tenant-a", { ...query, cursor: second.meta.nextCursor });
    const back = await store.listPage("tenant-a", { ...query, cursor: third.meta.previousCursor, direction: "previous" });

    expect([first, second, third].map((page) => page.records[0]?.id)).toEqual(["inv-1", "inv-2", "inv-3"]);
    expect(third.meta.nextCursor).toBeUndefined();
    expect(back.records.map((record) => record.id)).toEqual(["inv-2"]);
    expect(back.meta.previousCursor).toEqual(expect.any(String));
  });

  it("cursor'ı tenant, filtre ve sıralamaya bağlar", async () => {
    const store = await seededStore();
    const cursor = (await store.listPage("tenant-a", query)).meta.nextCursor;

    await expect(store.listPage("tenant-b", { ...query, cursor })).rejects.toThrow("IDENTITY_INVITATION_CURSOR_INVALID");
    await expect(store.listPage("tenant-a", { ...query, cursor, status: "PENDING" })).rejects.toThrow("IDENTITY_INVITATION_CURSOR_INVALID");
    await expect(store.listPage("tenant-a", { ...query, cursor, sort: "-createdAt" })).rejects.toThrow("IDENTITY_INVITATION_CURSOR_INVALID");
  });

  it("q ile subjectId/subjectType eşleşmesini korur; açık filtreler kesin eşleşir", async () => {
    const store = await seededStore();
    const all = { ...query, limit: 50 };

    expect((await store.listPage("tenant-a", { ...all, q: "teacher-2" })).records.map((record) => record.id)).toEqual(["inv-2"]);
    expect((await store.listPage("tenant-a", { ...all, q: "GUARDIAN" })).records.map((record) => record.id)).toEqual(["inv-3"]);
    expect((await store.listPage("tenant-a", { ...all, q: "BORA@EXAMPLE" })).records.map((record) => record.id)).toEqual(["inv-2"]);
    expect((await store.listPage("tenant-a", { ...all, subjectType: "TEACHER", subjectId: "teacher-1" })).records.map((record) => record.id))
      .toEqual(["inv-1"]);
    expect((await store.listPage("tenant-a", { ...all, status: "REVOKED" })).records).toEqual([]);
  });
});

describe("InMemoryIdentityInvitationStore cursor dayanıklılığı ve Türkçe arama", () => {
  it("bekleyen davet listesi gezilirken sınır davet kabul edilse de kalan davetler atlanmadan gelir", async () => {
    const store = new InMemoryIdentityInvitationStore();
    for (const index of [1, 2, 3, 4]) {
      await store.create({
        id: `inv-${index}`, tenantId: "tenant-a", role: "TEACHER", tokenHash: `hash-${index}`, expiresAt: "2099-01-01T00:00:00.000Z",
        subjectType: "TEACHER", subjectId: `teacher-${index}`, name: `Öğretmen ${index}`,
      });
    }
    const pending = { direction: "next" as const, limit: 2, sort: "createdAt" as const, status: "PENDING" as const };
    const first = await store.listPage("tenant-a", pending);
    expect(first.records.map((record) => record.id)).toEqual(["inv-1", "inv-2"]);
    await store.markAccepted("inv-2", "user-2", "2026-10-21T00:00:00.000Z");

    const second = await store.listPage("tenant-a", { ...pending, cursor: first.meta.nextCursor });
    expect(second.records.map((record) => record.id)).toEqual(["inv-3", "inv-4"]);
  });

  it("ad aramasında I/İ/ı/i varyantlarını eşler", async () => {
    const store = new InMemoryIdentityInvitationStore();
    const base = { tenantId: "tenant-a", role: "TEACHER" as const, tokenHash: "hash", expiresAt: "2099-01-01T00:00:00.000Z", subjectType: "TEACHER" as const };
    await store.create({ ...base, id: "inv-isik", subjectId: "teacher-1", name: "AYŞE IŞIK" });
    await store.create({ ...base, id: "inv-ismail", subjectId: "teacher-2", name: "İSMAİL KAYA" });
    const ids = async (q: string) =>
      (await store.listPage("tenant-a", { direction: "next", limit: 10, sort: "createdAt", q })).records.map((record) => record.id);

    for (const q of ["ışık", "IŞIK", "Işık"]) expect(await ids(q), q).toEqual(["inv-isik"]);
    for (const q of ["ismail", "İsmail", "ISMAIL"]) expect(await ids(q), q).toEqual(["inv-ismail"]);
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
