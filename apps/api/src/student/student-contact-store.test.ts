import { describe, expect, it } from "vitest";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryStudentContactStore, PostgresStudentContactStore } from "./student-contact-store.js";

const contact = {
  tenantId: "tenant-a",
  studentId: "student-a",
  firstName: "Fatma",
  lastName: "Veli",
  relationType: "MOTHER" as const,
  phoneEncrypted: "encrypted-phone",
  phoneHash: "phone-hash",
  emailEncrypted: "encrypted-email",
  emailHash: "email-hash",
  canReceiveSms: true,
  canReceiveAnnouncements: true,
  canReceiveFinance: true,
  consentSource: "FORM",
  consentRecordedAt: "2026-08-12T00:00:00.000Z",
};

describe("StudentContactStore", () => {
  it("in-memory silmede PII, hash ve izin kanıtını temizler", async () => {
    const store = new InMemoryStudentContactStore();
    const created = await store.create(contact);

    expect(await store.softDelete("tenant-a", created.id)).toBe(true);
    const stored = (store as unknown as { records: Array<typeof created> }).records[0];
    expect(stored).toMatchObject({
      firstName: "Anonim",
      lastName: "İletişim",
      relationType: "OTHER",
      canReceiveSms: false,
      canReceiveAnnouncements: false,
      canReceiveFinance: false,
      deletedAt: expect.any(String),
    });
    expect(stored?.phoneEncrypted).toBeUndefined();
    expect(stored?.phoneHash).toBeUndefined();
    expect(stored?.emailEncrypted).toBeUndefined();
    expect(stored?.emailHash).toBeUndefined();
    expect(stored?.consentSource).toBeUndefined();
    expect(stored?.consentRecordedAt).toBeUndefined();
  });

  it("Postgres silmede tenant kapsamını koruyup PII, hash ve izin kanıtını temizler", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("RETURNING \"id\"")) return { rows: [{ id: "contact-a" }] as T[] };
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresStudentContactStore(pool);

    expect(await store.softDelete("tenant-a", "contact-a")).toBe(true);

    const update = queries.find((query) => query.sql.includes('UPDATE "StudentContact"'));
    expect(update?.values).toEqual(["tenant-a", "contact-a"]);
    expect(update?.sql).toContain('"firstName"=\'Anonim\'');
    expect(update?.sql).toContain('"phoneEncrypted"=NULL');
    expect(update?.sql).toContain('"phoneHash"=NULL');
    expect(update?.sql).toContain('"emailEncrypted"=NULL');
    expect(update?.sql).toContain('"emailHash"=NULL');
    expect(update?.sql).toContain('"consentSource"=NULL');
    expect(update?.sql).toContain('"consentRecordedAt"=NULL');
    expect(update?.sql).toContain('WHERE "tenantId"=$1 AND "id"=$2 AND "deletedAt" IS NULL');
  });

  it("veli bağını yalnız boşken yazar; genel güncelleme ve silme bağı korumaz/temizler", async () => {
    const store = new InMemoryStudentContactStore();
    const created = await store.create(contact);

    expect(await store.linkGuardian("tenant-b", created.id, "guardian-x")).toBe(false);
    expect(await store.linkGuardian("tenant-a", created.id, "guardian-1")).toBe(true);
    expect(await store.linkGuardian("tenant-a", created.id, "guardian-2")).toBe(false);
    await store.update(created.id, { ...contact, firstName: "Ayse" });
    expect(await store.findById("tenant-a", created.id)).toMatchObject({ firstName: "Ayse", guardianId: "guardian-1" });

    await store.softDelete("tenant-a", created.id);
    const stored = (store as unknown as { records: Array<typeof created> }).records[0];
    expect(stored?.guardianId).toBeUndefined();
  });

  it("Postgres veli bağını tenant kapsamında ve yalnız boş guardianId üzerine yazar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        return { rows: [] as T[] };
      },
    };

    expect(await new PostgresStudentContactStore(pool).linkGuardian("tenant-a", "contact-a", "guardian-a")).toBe(false);
    const update = queries.find((query) => query.sql.includes('UPDATE "StudentContact"'));
    expect(update?.values).toEqual(["tenant-a", "contact-a", "guardian-a"]);
    expect(update?.sql).toContain('"tenantId"=$1 AND "id"=$2 AND "deletedAt" IS NULL AND "guardianId" IS NULL');
  });

  it("KV-3b elle bağda GuardianStudent'ı izinler kapalı oluşturur, mevcut bağı yeniden kullanır ve bağ kaldırma yalnız beklenen veliyi siler", async () => {
    const guardianStudents = new InMemoryGuardianStudentStore();
    const store = new InMemoryStudentContactStore(guardianStudents);
    const created = await store.create({ ...contact, studentId: "student-kv3b" });

    expect(await store.linkGuardianWithStudentLink("tenant-b", created.id, "guardian-x")).toEqual({ linked: false, guardianStudentCreated: false });
    const first = await store.linkGuardianWithStudentLink("tenant-a", created.id, "guardian-1");
    expect(first).toEqual({ linked: true, guardianStudentId: expect.any(String), guardianStudentCreated: true });
    expect(await guardianStudents.listByStudent("student-kv3b")).toEqual([expect.objectContaining({
      guardianId: "guardian-1", canViewFinance: false, canReceiveSms: false, canReceiveAnnouncements: false, canOpenSupportTickets: false,
    })]);
    expect(await store.linkGuardianWithStudentLink("tenant-a", created.id, "guardian-2")).toEqual({ linked: false, guardianStudentCreated: false });

    expect(await store.unlinkGuardian("tenant-a", created.id, "guardian-2")).toBe(false);
    expect(await store.unlinkGuardian("tenant-a", created.id, "guardian-1")).toBe(true);
    expect((await store.findById("tenant-a", created.id))?.guardianId).toBeUndefined();
    expect(await guardianStudents.listByStudent("student-kv3b")).toHaveLength(1);
    expect(await store.linkGuardianWithStudentLink("tenant-a", created.id, "guardian-1"))
      .toEqual({ linked: true, guardianStudentId: first.guardianStudentId, guardianStudentCreated: false });
  });

  it("Postgres elle bağı tek transaction'da kilitli iletişim, GuardianStudent insert ve koşullu güncelleme ile yazar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    let updateRows: Array<{ id: string }> = [{ id: "contact-a" }];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('SELECT "studentId" FROM "StudentContact"')) return { rows: [{ studentId: "student-a" }] as T[] };
        if (sql.includes('INSERT INTO "GuardianStudent"')) return { rows: [{ id: "link-a" }] as T[] };
        if (sql.includes('UPDATE "StudentContact"')) return { rows: updateRows as T[] };
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresStudentContactStore(pool);

    expect(await store.linkGuardianWithStudentLink("tenant-a", "contact-a", "guardian-a"))
      .toEqual({ linked: true, guardianStudentId: "link-a", guardianStudentCreated: true });
    const sqls = queries.map((query) => query.sql);
    const begin = sqls.indexOf("BEGIN");
    const select = sqls.findIndex((sql) => sql.includes("FOR UPDATE"));
    const insert = sqls.findIndex((sql) => sql.includes('INSERT INTO "GuardianStudent"'));
    const update = sqls.findIndex((sql) => sql.includes('UPDATE "StudentContact"'));
    expect(begin).toBeGreaterThanOrEqual(0);
    expect(begin < select && select < insert && insert < update && update < sqls.indexOf("COMMIT")).toBe(true);
    expect(sqls[insert]).toContain("false, false, false, false");
    expect(sqls[insert]).toContain('ON CONFLICT ("tenantId", "guardianId", "studentId") DO NOTHING');
    expect(queries[insert]?.values?.slice(1)).toEqual(["tenant-a", "guardian-a", "student-a"]);
    expect(sqls[update]).toContain('"guardianId" IS NULL');

    queries.length = 0;
    updateRows = [];
    await expect(store.linkGuardianWithStudentLink("tenant-a", "contact-a", "guardian-a")).rejects.toThrow("STUDENT_CONTACT_GUARDIAN_LINK_FAILED");
    expect(queries.map((query) => query.sql)).toContain("ROLLBACK");
    expect(queries.map((query) => query.sql)).not.toContain("COMMIT");

    queries.length = 0;
    expect(await store.unlinkGuardian("tenant-a", "contact-a", "guardian-a")).toBe(false);
    const unlink = queries.find((query) => query.sql.includes('UPDATE "StudentContact"'));
    expect(unlink?.sql).toContain('"guardianId"=NULL');
    expect(unlink?.sql).toContain('"guardianId"=$3');
    expect(unlink?.sql).not.toContain("GuardianStudent");
    expect(unlink?.values).toEqual(["tenant-a", "contact-a", "guardian-a"]);
  });
});
