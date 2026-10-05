import { describe, expect, it } from "vitest";
import { resetInMemoryAuthUsers, upsertInMemoryAuthUser } from "../auth/auth-user-store.js";
import { InMemoryGuardianStore } from "../school/guardian-store.js";
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

    // A second contact of the same student pointing at the same guardian keeps the access link alive.
    const sibling = await store.create({ ...contact, studentId: "student-kv3b", firstName: "Ikinci" });
    expect(await store.linkGuardianWithStudentLink("tenant-a", sibling.id, "guardian-1"))
      .toEqual({ linked: true, guardianStudentId: first.guardianStudentId, guardianStudentCreated: false });

    expect(await store.unlinkGuardian("tenant-a", created.id, "guardian-2")).toEqual({ unlinked: false, guardianStudentRemoved: false });
    expect(await store.unlinkGuardian("tenant-a", created.id, "guardian-1"))
      .toEqual({ unlinked: true, studentId: "student-kv3b", guardianStudentRemoved: false });
    expect((await store.findById("tenant-a", created.id))?.guardianId).toBeUndefined();
    expect(await guardianStudents.listByStudent("student-kv3b")).toHaveLength(1);
    expect(await store.unlinkGuardian("tenant-a", sibling.id, "guardian-1"))
      .toEqual({ unlinked: true, studentId: "student-kv3b", guardianStudentRemoved: true });
    expect(await guardianStudents.listByStudent("student-kv3b")).toHaveLength(0);
  });

  it("KV-3c bağ kaldırma, akıştan önce var olan GuardianStudent bağını ve izinlerini korur", async () => {
    const guardianStudents = new InMemoryGuardianStudentStore();
    const store = new InMemoryStudentContactStore(guardianStudents);
    const preexisting = await guardianStudents.create({
      tenantId: "tenant-a", guardianId: "guardian-pre", studentId: "student-kv3c", canViewFinance: true, canReceiveSms: true,
    });
    const created = await store.create({ ...contact, studentId: "student-kv3c" });

    expect(await store.linkGuardianWithStudentLink("tenant-a", created.id, "guardian-pre"))
      .toEqual({ linked: true, guardianStudentId: preexisting.id, guardianStudentCreated: false });
    expect(await store.unlinkGuardian("tenant-a", created.id, "guardian-pre"))
      .toEqual({ unlinked: true, studentId: "student-kv3c", guardianStudentRemoved: false });
    expect(await guardianStudents.listByStudent("student-kv3c")).toEqual([
      expect.objectContaining({ id: preexisting.id, guardianId: "guardian-pre", canViewFinance: true, canReceiveSms: true }),
    ]);
  });

  it("Postgres elle bağı tek transaction'da kilitli iletişim, GuardianStudent insert ve koşullu güncelleme ile yazar", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    let updateRows: Array<{ id: string }> = [{ id: "contact-a" }];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes('SELECT "studentId", "firstName", "lastName" FROM "StudentContact"')) return { rows: [{ studentId: "student-a" }] as T[] };
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
    expect(sqls[insert]).toContain("false, false, false, false, true, now()");
    expect(sqls[insert]).toContain('"createdByStudentContact"');
    expect(sqls[insert]).toContain('ON CONFLICT ("tenantId", "guardianId", "studentId") DO NOTHING');
    expect(queries[insert]?.values?.slice(1)).toEqual(["tenant-a", "guardian-a", "student-a"]);
    expect(sqls[update]).toContain('"guardianId" IS NULL');

    queries.length = 0;
    updateRows = [];
    await expect(store.linkGuardianWithStudentLink("tenant-a", "contact-a", "guardian-a")).rejects.toThrow("STUDENT_CONTACT_GUARDIAN_LINK_FAILED");
    expect(queries.map((query) => query.sql)).toContain("ROLLBACK");
    expect(queries.map((query) => query.sql)).not.toContain("COMMIT");

    queries.length = 0;
    expect(await store.unlinkGuardian("tenant-a", "contact-a", "guardian-a")).toEqual({ unlinked: false, guardianStudentRemoved: false });
    const unlink = queries.find((query) => query.sql.includes('UPDATE "StudentContact"'));
    expect(unlink?.sql).toContain('"guardianId"=NULL');
    expect(unlink?.sql).toContain('"guardianId"=$3');
    expect(unlink?.values).toEqual(["tenant-a", "contact-a", "guardian-a"]);
    expect(queries.some((query) => query.sql.includes('DELETE FROM "GuardianStudent"'))).toBe(false);
  });

  it("Postgres bağ kaldırma iletişimi boşaltır, erişim bağını kilitler ve yalnız bu akışın açtığı, başka iletişimin bağlı olmadığı bağı siler", async () => {
    for (const { stillReferenced, createdByStudentContact } of [
      { stillReferenced: false, createdByStudentContact: true },
      { stillReferenced: true, createdByStudentContact: true },
      // KV-3c: a link that existed before the contact flow (guardian API, bulk invite) is never removed.
      { stillReferenced: false, createdByStudentContact: false },
    ]) {
      const queries: Array<{ sql: string; values?: unknown[] }> = [];
      const pool = {
        async query<T>(sql: string, values?: unknown[]) {
          queries.push({ sql, values });
          if (sql.includes('UPDATE "StudentContact"')) return { rows: [{ studentId: "student-a" }] as T[] };
          if (sql.includes('SELECT "id", "createdByStudentContact" FROM "GuardianStudent"')) return { rows: [{ id: "link-a", createdByStudentContact }] as T[] };
          if (sql.includes("SELECT 1 FROM \"StudentContact\"")) return { rows: (stillReferenced ? [{ "?column?": 1 }] : []) as T[] };
          if (sql.includes('DELETE FROM "GuardianStudent"')) return { rows: [{ id: "link-a" }] as T[] };
          return { rows: [] as T[] };
        },
      };

      expect(await new PostgresStudentContactStore(pool).unlinkGuardian("tenant-a", "contact-a", "guardian-a"))
        .toEqual({ unlinked: true, studentId: "student-a", guardianStudentRemoved: createdByStudentContact && !stillReferenced });
      const sqls = queries.map((query) => query.sql);
      const update = sqls.findIndex((sql) => sql.includes('UPDATE "StudentContact"'));
      const lock = sqls.findIndex((sql) => sql.includes('FROM "GuardianStudent"') && sql.includes("FOR UPDATE"));
      const check = sqls.findIndex((sql) => sql.includes('SELECT 1 FROM "StudentContact"'));
      const remove = sqls.findIndex((sql) => sql.includes('DELETE FROM "GuardianStudent"'));
      expect(sqls.indexOf("BEGIN") < update && update < lock && lock < sqls.indexOf("COMMIT")).toBe(true);
      if (!createdByStudentContact) {
        expect(remove).toBe(-1);
        continue;
      }
      expect(lock < check && check < sqls.indexOf("COMMIT")).toBe(true);
      if (stillReferenced) expect(remove).toBe(-1);
      else expect(check < remove && remove < sqls.indexOf("COMMIT")).toBe(true);
      expect(queries[check]?.values).toEqual(["tenant-a", "student-a", "guardian-a"]);
      expect(queries[check]?.sql).toContain('"deletedAt" IS NULL');
    }
  });

  it("Postgres kullanıcı bağı tek transaction'da veli profili, GUARDIAN üyeliği ve erişim bağını yazar; mevcut üyelikleri silmez", async () => {
    const run = async (memberships: Array<{ role: string; staffRole: string | null; hasTeacherPersona: boolean; hasStudentPersona: boolean }>, guardianRow?: { id: string }) => {
      const queries: Array<{ sql: string; values?: unknown[] }> = [];
      const pool = {
        async query<T>(sql: string, values?: unknown[]) {
          queries.push({ sql, values });
          if (sql.includes('SELECT "studentId", "firstName", "lastName" FROM "StudentContact"')) {
            return { rows: [{ studentId: "student-a", firstName: "Ayse", lastName: "Veli" }] as T[] };
          }
          if (sql.includes('SELECT "id" FROM "User"')) return { rows: [{ id: "user-a" }] as T[] };
          if (sql.includes('FROM "TenantMembership"') && sql.startsWith("SELECT")) return { rows: memberships as T[] };
          if (sql.includes('SELECT "id" FROM "Guardian"')) return { rows: (guardianRow ? [guardianRow] : []) as T[] };
          if (sql.includes('INSERT INTO "Guardian"')) return { rows: [{ id: "guardian-new" }] as T[] };
          if (sql.includes('UPDATE "User"')) return { rows: [{ membershipVersion: 5 }] as T[] };
          if (sql.includes('UPDATE "AuthSession"')) return { rows: [{ id: "session-a" }, { id: "session-b" }] as T[] };
          if (sql.includes('INSERT INTO "GuardianStudent"')) return { rows: [{ id: "link-a" }] as T[] };
          if (sql.includes('UPDATE "StudentContact"')) return { rows: [{ id: "contact-a" }] as T[] };
          return { rows: [] as T[] };
        },
      };
      const result = await new PostgresStudentContactStore(pool).linkUserAsGuardianWithStudentLink("tenant-a", "contact-a", "user-a");
      return { result, queries, sqls: queries.map((query) => query.sql) };
    };
    const staff = { role: "TENANT_ADMIN", staffRole: "TENANT_ADMIN", hasTeacherPersona: true, hasStudentPersona: false };
    const teacherRow = { role: "TEACHER", staffRole: null, hasTeacherPersona: false, hasStudentPersona: false };

    const added = await run([staff, teacherRow]);
    expect(added.result).toEqual({
      linked: true, guardianId: "guardian-new", guardianStudentId: "link-a", guardianStudentCreated: true,
      guardianCreated: true, guardianRoleAdded: true, sessionsRevoked: 2,
    });
    const order = [
      'SELECT "studentId", "firstName", "lastName" FROM "StudentContact"',
      'SELECT "id" FROM "User"',
      'FROM "TenantMembership"',
      'INSERT INTO "Guardian"',
      'UPDATE "User"',
      'INSERT INTO "TenantMembership"',
      'UPDATE "TenantMembership"',
      'UPDATE "AuthSession"',
      'INSERT INTO "GuardianStudent"',
      'UPDATE "StudentContact"',
    ].map((fragment) => added.sqls.findIndex((sql) => sql.includes(fragment)));
    expect(order.every((index, position) => index > 0 && (position === 0 || index > order[position - 1]!))).toBe(true);
    expect(added.sqls.indexOf("BEGIN")).toBeLessThan(order[0]!);
    expect(added.sqls.indexOf("COMMIT")).toBeGreaterThan(order.at(-1)!);
    expect(added.sqls.some((sql) => sql.includes('DELETE FROM "TenantMembership"'))).toBe(false);
    const membershipInsert = added.queries[order[5]!];
    expect(membershipInsert?.sql).toContain("'GUARDIAN', NULL, false, false, 'ACTIVE'");
    expect(membershipInsert?.values?.slice(1)).toEqual(["tenant-a", "user-a", 5]);
    expect(added.queries[order[3]!]?.values?.slice(1)).toEqual(["tenant-a", "Ayse", "Veli", "user-a"]);

    // An existing guardian profile and role are reused: no membership or session writes.
    const reused = await run([staff, { role: "GUARDIAN", staffRole: null, hasTeacherPersona: false, hasStudentPersona: false }], { id: "guardian-old" });
    expect(reused.result).toMatchObject({ linked: true, guardianId: "guardian-old", guardianCreated: false, guardianRoleAdded: false, sessionsRevoked: 0 });
    for (const fragment of ['INSERT INTO "Guardian"', 'UPDATE "User"', 'INSERT INTO "TenantMembership"', 'UPDATE "AuthSession"']) {
      expect(reused.sqls.some((sql) => sql.includes(fragment))).toBe(false);
    }

    // Student accounts and users without an active membership are refused before any write.
    for (const memberships of [[{ role: "STUDENT", staffRole: null, hasTeacherPersona: false, hasStudentPersona: true }], []]) {
      const refused = await run(memberships);
      expect(refused.result).toMatchObject({ linked: false, userNotEligible: true });
      expect(refused.sqls.some((sql) => /INSERT|UPDATE "User"|UPDATE "AuthSession"/.test(sql))).toBe(false);
    }
  });

  it("Postgres kullanıcı bağı silinmiş veli profilinin userId'sini boşaltıp yeni profil açar; kalan unique çakışması 409 kodudur", async () => {
    const run = async (insertError?: { code: string }) => {
      const queries: Array<{ sql: string; values?: unknown[] }> = [];
      const pool = {
        async query<T>(sql: string, values?: unknown[]) {
          queries.push({ sql, values });
          if (sql.includes('SELECT "studentId", "firstName", "lastName" FROM "StudentContact"')) {
            return { rows: [{ studentId: "student-a", firstName: "Ayse", lastName: "Veli" }] as T[] };
          }
          if (sql.includes('SELECT "id" FROM "User"')) return { rows: [{ id: "user-a" }] as T[] };
          if (sql.includes('FROM "TenantMembership"') && sql.startsWith("SELECT")) {
            return { rows: [{ role: "GUARDIAN", staffRole: null, hasTeacherPersona: false, hasStudentPersona: false }] as T[] };
          }
          if (sql.includes('INSERT INTO "Guardian"')) {
            if (insertError) throw Object.assign(new Error("duplicate key"), insertError);
            return { rows: [{ id: "guardian-new" }] as T[] };
          }
          if (sql.includes('INSERT INTO "GuardianStudent"')) return { rows: [{ id: "link-a" }] as T[] };
          if (sql.includes('UPDATE "StudentContact"')) return { rows: [{ id: "contact-a" }] as T[] };
          return { rows: [] as T[] };
        },
      };
      const result = new PostgresStudentContactStore(pool).linkUserAsGuardianWithStudentLink("tenant-a", "contact-a", "user-a");
      return { result, queries };
    };

    const ok = await run();
    expect(await ok.result).toMatchObject({ linked: true, guardianId: "guardian-new", guardianCreated: true });
    const sqls = ok.queries.map((query) => query.sql);
    const detach = sqls.findIndex((sql) => sql.includes('UPDATE "Guardian" SET "userId"=NULL'));
    expect(detach).toBeGreaterThan(0);
    expect(detach).toBeLessThan(sqls.findIndex((sql) => sql.includes('INSERT INTO "Guardian"')));
    expect(sqls[detach]).toContain('"tenantId"=$1 AND "userId"=$2 AND "deletedAt" IS NOT NULL');
    expect(ok.queries[detach]?.values).toEqual(["tenant-a", "user-a"]);

    const clash = await run({ code: "23505" });
    await expect(clash.result).rejects.toThrow("STUDENT_CONTACT_GUARDIAN_LINK_CONFLICT");
    expect(clash.queries.map((query) => query.sql)).toContain("ROLLBACK");
    const other = await run({ code: "XX000" });
    await expect(other.result).rejects.toThrow("duplicate key");
  });

  it("Postgres bağ, eşzamanlı bağ kaldırma erişim bağını sildiyse 409 koduyla geri alınır", async () => {
    const queries: string[] = [];
    const pool = {
      async query<T>(sql: string) {
        queries.push(sql);
        if (sql.includes('SELECT "studentId", "firstName", "lastName" FROM "StudentContact"')) return { rows: [{ studentId: "student-a" }] as T[] };
        return { rows: [] as T[] };
      },
    };
    await expect(new PostgresStudentContactStore(pool).linkGuardianWithStudentLink("tenant-a", "contact-a", "guardian-a"))
      .rejects.toThrow("STUDENT_CONTACT_GUARDIAN_LINK_CONFLICT");
    expect(queries).toContain("ROLLBACK");
    expect(queries.some((sql) => sql.includes('UPDATE "StudentContact"'))).toBe(false);
  });

  it("in-memory kullanıcı bağı silinmiş veli profilinden sonra aynı kullanıcıyı yeni profille yeniden bağlar (Postgres ile eş)", async () => {
    resetInMemoryAuthUsers();
    upsertInMemoryAuthUser({
      id: "user-kv3b-relink", email: "kv3b-relink@example.test", name: "Personel", password: "password", tenantId: "tenant-a",
      roles: ["OPERATIONS_STAFF"],
      membership: { id: "membership-kv3b-relink", staffRole: "OPERATIONS_STAFF", hasTeacherPersona: false, hasStudentPersona: false, version: 1 },
    });
    try {
      const guardians = new InMemoryGuardianStore();
      const store = new InMemoryStudentContactStore(new InMemoryGuardianStudentStore(), guardians);
      const first = await store.create({ ...contact, relationType: "LEGAL_GUARDIAN", studentId: "student-relink" });
      const linked = await store.linkUserAsGuardianWithStudentLink("tenant-a", first.id, "user-kv3b-relink");
      expect(linked).toMatchObject({ linked: true, guardianCreated: true });
      await guardians.softDelete(linked.guardianId!, new Date().toISOString());

      const second = await store.create({ ...contact, relationType: "LEGAL_GUARDIAN", studentId: "student-relink-2" });
      const relinked = await store.linkUserAsGuardianWithStudentLink("tenant-a", second.id, "user-kv3b-relink");
      expect(relinked).toMatchObject({ linked: true, guardianCreated: true });
      expect(relinked.guardianId).not.toBe(linked.guardianId);
      expect((await guardians.findByUserId("tenant-a", "user-kv3b-relink"))?.id).toBe(relinked.guardianId);
    } finally {
      resetInMemoryAuthUsers();
    }
  });
});
