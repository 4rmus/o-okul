import { describe, expect, it } from "vitest";
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
});
