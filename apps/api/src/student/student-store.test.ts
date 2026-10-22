import { describe, expect, it, vi } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { InMemoryStudentStore, PostgresStudentStore, type StudentImportBatchInput } from "./student-store.js";

describe("PostgresStudentStore", () => {
  it("seviye filtresi sınıfsız öğrenciyi doğrudan gradeLevelId ile döndürür", async () => {
    const store = new InMemoryStudentStore();
    await store.create({ tenantId: "tenant-a", firstName: "Sınıfsız", lastName: "Sekiz", gradeLevelId: "grade-8", status: "ACTIVE" });
    await store.create({ tenantId: "tenant-a", firstName: "Sınıfsız", lastName: "Yedi", gradeLevelId: "grade-7", status: "ACTIVE" });

    const page = await store.listRegistryPage("tenant-a", { direction: "next", limit: 20, sort: "lastName", gradeLevelId: "grade-8" });

    const classlessStudent = page.records.find((student) => student.firstName === "Sınıfsız" && student.lastName === "Sekiz");
    expect(classlessStudent).toMatchObject({ gradeLevelId: "grade-8" });
    expect(classlessStudent?.classId).toBeUndefined();
    expect(page.records.every((student) => student.gradeLevelId === "grade-8")).toBe(true);
  });

  it("10 bin kayıtlı sentetik registry'de cursor ile ilerleyip yalnız istenen sayfayı 500 ms altında döndürür", async () => {
    const store = new InMemoryStudentStore();
    await store.createMany(Array.from({ length: 10_000 }, (_, index) => ({
      tenantId: "tenant-a",
      studentNo: String(1_000 + index),
      firstName: `Öğrenci ${index}`,
      lastName: `Soyad ${String(index).padStart(5, "0")}`,
      status: "ACTIVE",
    })));

    const first = await store.listRegistryPage("tenant-a", { direction: "next", limit: 50, sort: "lastName" });
    const startedAt = performance.now();
    const page = await store.listRegistryPage("tenant-a", {
      cursor: first.meta.nextCursor,
      direction: "next",
      limit: 50,
      sort: "lastName",
    });
    const durationMs = performance.now() - startedAt;

    expect(page.records).toHaveLength(50);
    expect(page.meta).toEqual({
      limit: 50,
      total: 10_001,
      nextCursor: expect.any(String),
      previousCursor: expect.any(String),
    });
    expect(page.records[0]?.id).not.toBe(first.records.at(-1)?.id);
    expect(durationMs).toBeLessThan(500);
    expect(page.records.every((student) => student.tenantId === "tenant-a")).toBe(true);
  });

  it("v2 registry arama/filtre/cursor sayfalamayı SQL içinde tenant ve contact scope ile uygular", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
        if (sql.includes("COUNT(*)::int AS total")) return { rows: [{ total: 2 }] as T[] };
        if (sql.includes('SELECT student.*')) {
          return { rows: [{
            id: "student-a",
            tenantId: "tenant-a",
            studentNo: "100",
            firstName: "Ada",
            lastName: "A",
            classId: "class-a",
            responsibleTeacherId: "teacher-a",
            status: "ACTIVE",
            nationalIdEncrypted: null,
            nationalIdHash: null,
            phone: null,
            email: null,
            photoKey: null,
            userId: null,
            deletedAt: null,
            cursorKey: "a",
          }, {
            id: "student-b",
            tenantId: "tenant-a",
            studentNo: "101",
            firstName: "Ada",
            lastName: "B",
            classId: "class-a",
            responsibleTeacherId: "teacher-a",
            status: "ACTIVE",
            nationalIdEncrypted: null,
            nationalIdHash: null,
            phone: null,
            email: null,
            photoKey: null,
            userId: null,
            deletedAt: null,
            cursorKey: "b",
          }] as T[] };
        }
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresStudentStore(pool);
    const registryQuery = {
      direction: "next" as const,
      limit: 1,
      q: "Ada",
      sort: "-lastName" as const,
      gradeLevelId: "grade-8",
      classIds: ["class-a"],
      hasContact: true,
      teacherId: "teacher-a",
      teacherStudentIds: ["student-a"],
      teacherClassIds: ["class-a"],
    };

    const first = await store.listRegistryPage("tenant-a", registryQuery);
    expect(first).toEqual({
      records: [expect.objectContaining({ id: "student-a", tenantId: "tenant-a" })],
      meta: { limit: 1, total: 2, nextCursor: expect.any(String) },
    });
    const firstListQuery = queries.find((query) => query.sql.includes('SELECT student.*'));
    expect(firstListQuery?.sql).toContain('FROM "StudentContact" contact');
    expect(firstListQuery?.sql).toContain('student."tenantId" = $1');
    expect(firstListQuery?.sql).toContain('student."gradeLevelId" = $2');
    expect(firstListQuery?.sql).toContain('ORDER BY lower(student."lastName") DESC, student."id" DESC');
    expect(firstListQuery?.sql).toContain("LIMIT $8");
    expect(firstListQuery?.sql).not.toContain("OFFSET");
    expect(firstListQuery?.values).toEqual([
      "tenant-a",
      "grade-8",
      ["class-a"],
      "teacher-a",
      ["student-a"],
      ["class-a"],
      "%ada%",
      2,
    ]);

    queries.length = 0;
    const second = await store.listRegistryPage("tenant-a", { ...registryQuery, cursor: first.meta.nextCursor });
    expect(second.meta.previousCursor).toEqual(expect.any(String));
    expect(queries.some((query) => query.sql.includes('SELECT 1 FROM "Student"'))).toBe(false);
    const secondListQuery = queries.find((query) => query.sql.includes('SELECT student.*'));
    expect(secondListQuery?.sql).toContain('(lower(student."lastName"), student."id") < ($8::text, $9::text)');
    expect(secondListQuery?.values?.slice(-3)).toEqual(["a", "student-a", 2]);

    queries.length = 0;
    await expect(store.listRegistryPage("tenant-b", { ...registryQuery, cursor: first.meta.nextCursor }))
      .rejects.toThrow("STUDENT_CURSOR_INVALID");
    await expect(store.listRegistryPage("tenant-a", { ...registryQuery, status: "PASSIVE", cursor: first.meta.nextCursor }))
      .rejects.toThrow("STUDENT_CURSOR_INVALID");
    expect(queries.some((query) => query.sql.includes('SELECT student.*'))).toBe(false);
  });

  it("portal erişimini tenant RLS, SQL arama ve cursor meta ile listeler; e-postayı maskeler", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
        if (sql.includes("WITH anchor AS")) {
          return {
            rows: [
              {
                studentId: "student-a",
                tenantId: "tenant-a",
                studentNo: "100",
                firstName: "Ada",
                lastName: "A",
                studentStatus: "ACTIVE",
                userId: "student-user-a",
                accountStatus: "ACTIVE",
                membershipId: "membership-a",
                membershipStatus: "ACTIVE",
                membershipVersion: 3,
                invitationId: null,
                invitationKind: null,
                invitationStatus: null,
                invitationEmail: null,
                invitationExpiresAt: null,
                activeSessionCount: 2,
              },
              {
                studentId: "student-b",
                tenantId: "tenant-a",
                studentNo: "101",
                firstName: "Bora",
                lastName: "B",
                studentStatus: "ACTIVE",
                userId: null,
                accountStatus: null,
                membershipId: null,
                membershipStatus: null,
                membershipVersion: null,
                invitationId: "invitation-b",
                invitationKind: "EMAIL_LINK",
                invitationStatus: "PENDING",
                invitationEmail: "bora@example.test",
                invitationExpiresAt: new Date("2026-08-02T12:00:00.000Z"),
                activeSessionCount: 0,
              },
              {
                studentId: "student-c",
                tenantId: "tenant-a",
                studentNo: "102",
                firstName: "Cem",
                lastName: "C",
                studentStatus: "ACTIVE",
                userId: null,
                accountStatus: null,
                membershipId: null,
                membershipStatus: null,
                membershipVersion: null,
                invitationId: null,
                invitationKind: null,
                invitationStatus: null,
                invitationEmail: null,
                invitationExpiresAt: null,
                activeSessionCount: 0,
              },
            ] as T[],
          };
        }
        return { rows: [] as T[] };
      },
    };
    const store = new PostgresStudentStore(pool);

    const result = await store.listPortalAccess("tenant-a", { direction: "next", limit: 2, q: "Ada" });

    expect(result.records).toEqual([
      expect.objectContaining({
        studentId: "student-a",
        accessState: "ACTIVE",
        activeSessionCount: 2,
        membership: { id: "membership-a", status: "ACTIVE", version: 3 },
      }),
      expect.objectContaining({
        studentId: "student-b",
        accessState: "INVITED",
        invitation: expect.objectContaining({ emailMasked: "bo••@•••.test" }),
      }),
    ]);
    expect(result.meta).toEqual({
      limit: 2,
      nextCursor: Buffer.from("student-b").toString("base64url"),
    });
    const listQuery = queries.find((query) => query.sql.includes("WITH anchor AS"));
    expect(listQuery?.values).toEqual(["tenant-a", "%ada%", null, 3, null]);
    expect(listQuery?.sql).toContain('u."tenantId" = s."tenantId"');
    expect(listQuery?.sql).toContain('invitation_row."subjectType" = \'STUDENT\'');
    expect(queries.some((query) => query.sql.includes("set_config('app.current_tenant_id'") && query.values?.[0] === "tenant-a")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("example.test");

    await expect(store.listPortalAccess("tenant-a", { cursor: "not+base64", direction: "next", limit: 20 })).rejects.toThrow(
      "STUDENT_PORTAL_CURSOR_INVALID",
    );
  });

  it("Student CRUD için beklenen SQL parametrelerini kullanır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    let nextStudentNo = 101;
    const pool = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
        if (sql.includes('candidate::text AS "studentNo"')) {
          return { rows: [{ studentNo: String(nextStudentNo++) }] as T[] };
        }
        if (sql.includes('INSERT INTO "Student"')) {
          return {
            rows: [
              {
                id: String(values?.[0]),
                tenantId: String(values?.[1]),
                studentNo: String(values?.[2]),
                firstName: String(values?.[3]),
                lastName: String(values?.[4]),
                classId: null,
                responsibleTeacherId: null,
                status: String(values?.at(-1)),
                deletedAt: null,
              },
            ] as T[],
          };
        }
        return {
          rows: [
            {
              id: "student-a",
              tenantId: "tenant-a",
              studentNo: "100",
              firstName: "Ada",
              lastName: "A",
              status: "ACTIVE",
              deletedAt: null,
            },
          ] as T[],
        };
      },
    };

    const store = new PostgresStudentStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await store.list();
        await store.findById("student-a");
        await store.create({ tenantId: "tenant-a", firstName: "Ece", lastName: "Import", gradeLevelId: "grade-8" });
        await store.createMany([
          { tenantId: "tenant-a", firstName: "Deniz", lastName: "Import", gradeLevelId: "grade-8" },
          { tenantId: "tenant-a", firstName: "Mert", lastName: "Import", gradeLevelId: "grade-8" },
        ]);
        await store.update("student-a", { firstName: "Ada Guncel" });
        await store.purgePii("student-a");
        await store.updateTenant("student-a", "tenant-a");
        await store.softDelete("student-a", "2026-06-01T12:00:00.000Z");
      },
    );

    const businessQueries = queries.filter((query) => !query.sql.includes("set_config") && !["BEGIN", "COMMIT", "ROLLBACK"].includes(query.sql));
    const insertQueries = businessQueries.filter((query) => query.sql.includes('INSERT INTO "Student"'));
    expect(queries.some((query) => query.values?.[0] === "tenant-a")).toBe(true);
    expect(businessQueries[0]?.sql).toContain('SELECT * FROM "Student"');
    expect(businessQueries[1]?.values).toEqual(["student-a"]);
    expect(businessQueries.filter((query) => query.sql.includes("pg_advisory_xact_lock"))).toHaveLength(3);
    expect(insertQueries[0]?.values).toEqual([expect.any(String), "tenant-a", "101", "Ece", "Import", "grade-8", null, null, "ACTIVE"]);
    expect(insertQueries[1]?.values).toEqual([expect.any(String), "tenant-a", "102", "Deniz", "Import", "grade-8", null, null, "ACTIVE"]);
    expect(insertQueries[2]?.values).toEqual([expect.any(String), "tenant-a", "103", "Mert", "Import", "grade-8", null, null, "ACTIVE"]);
    expect(businessQueries.find((query) => query.values?.[1] === "Ada Guncel")?.values).toEqual([
      "student-a", "Ada Guncel", null, false, null, false, null, false, null, null,
    ]);
    expect(businessQueries.some((query) => query.sql.includes('"firstName" = \'Anonim\''))).toBe(true);
    expect(businessQueries.some((query) => query.sql.includes('"nationalIdEncrypted" = NULL'))).toBe(true);
    expect(businessQueries.some((query) => query.sql.includes('"photoKey" = NULL'))).toBe(true);
    expect(businessQueries.find((query) => query.values?.[1] === "tenant-a" && query.sql.includes('SET "tenantId"'))?.values).toEqual(["student-a", "tenant-a"]);
    expect(businessQueries.find((query) => query.values?.[1] === "2026-06-01T12:00:00.000Z")?.values).toEqual(["student-a", "2026-06-01T12:00:00.000Z"]);
  });

  it("silinen öğrencinin okul numarasını yeni öğrenciye verir", async () => {
    const store = new InMemoryStudentStore();

    const firstInNewTenant = await store.create({ tenantId: "tenant-c", firstName: "Ilk", lastName: "Ogrenci" });
    expect(firstInNewTenant.studentNo).toBe("100");

    const created = await store.create({ tenantId: "tenant-a", firstName: "Ece", lastName: "Bir" });
    expect(created.studentNo).toBe("101");

    await store.softDelete(created.id, "2026-06-04T12:00:00.000Z");
    const next = await store.create({ tenantId: "tenant-a", firstName: "Can", lastName: "Iki" });

    expect(next.studentNo).toBe("101");
  });

  it("createMany hata alırsa tenant transaction rollback yapar", async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string, _values?: unknown[]) {
        queries.push(sql);
        if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
        if (sql.includes('candidate::text AS "studentNo"')) {
          return { rows: [{ studentNo: "101" }] as T[] };
        }
        if (sql.includes('INSERT INTO "Student"')) {
          throw new Error("INSERT_FAILED");
        }
        return { rows: [] as T[] };
      },
      releaseCalled: false,
      release() {
        this.releaseCalled = true;
      },
    };
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return client;
      },
    };

    const store = new PostgresStudentStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await expect(
          store.createMany([{ tenantId: "tenant-a", firstName: "Ada", lastName: "Rollback" }]),
        ).rejects.toThrow("INSERT_FAILED");
      },
    );

    expect(queries).toContain("BEGIN");
    expect(queries.some((sql) => sql.includes('INSERT INTO "Student"'))).toBe(true);
    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(client.releaseCalled).toBe(true);
  });

  it("5.000 satırlık importBatch'i O(parça) sorguyla, tek BEGIN/COMMIT ve en fazla 1.000 elemanlı dizilerle yazar", async () => {
    const { client, queries } = createImportBatchClient();
    const store = new PostgresStudentStore({ async query<T>() { return { rows: [] as T[] }; }, async connect() { return client; } });
    const input = importBatchInput(5_000);
    let finalizeSawStudents = 0;
    input.finalize = async (tx, students) => {
      finalizeSawStudents = students.length;
      await tx.query(`UPDATE "IdempotencyKey" SET "status" = 'COMPLETED'`, []);
    };

    const students = await runWithRequestContext(importBatchContext, () => store.importBatch(input));

    // BEGIN + shared tenant lock + 2 set_config, class, number lock, count, TC, number, allocation,
    // 5 Student + 5 StudentEnrollment + 5 StudentContact + 6 AuditLog chunks, finalize, COMMIT.
    expect(queries).toHaveLength(33);
    expect(queries.filter((query) => query.sql === "BEGIN")).toHaveLength(1);
    expect(queries.filter((query) => query.sql === "COMMIT")).toHaveLength(1);
    expect(queries.some((query) => query.sql === "ROLLBACK")).toBe(false);
    expect(queries.filter((query) => query.sql.includes('INSERT INTO "Student" ('))).toHaveLength(5);
    expect(queries.filter((query) => query.sql.includes('INSERT INTO "StudentEnrollment"'))).toHaveLength(5);
    expect(queries.filter((query) => query.sql.includes('INSERT INTO "StudentContact"'))).toHaveLength(5);
    expect(queries.filter((query) => query.sql.includes('INSERT INTO "AuditLog"'))).toHaveLength(6);
    // Insert chunks bind at most 1,000 elements per array; each lookup stays a single whole-file `= ANY` (DEC-20261021-02).
    for (const query of queries.filter((candidate) => candidate.sql.includes("INSERT INTO"))) {
      for (const value of query.values ?? []) {
        if (Array.isArray(value)) expect(value.length).toBeLessThanOrEqual(1_000);
      }
    }
    expect(queries.filter((query) => query.sql.includes('"nationalIdHash" = ANY'))).toHaveLength(1);
    expect(queries.filter((query) => query.sql.includes('btrim("studentNo") = ANY'))).toHaveLength(1);
    const allocation = queries.find((query) => query.sql.includes('candidate::text AS "studentNo"'));
    expect(allocation?.values?.[0]).toBe("tenant-a");
    expect(allocation?.values?.[1]).toHaveLength(2_500);
    expect(allocation?.values?.[2]).toBe(2_500);
    const studentInsert = queries.find((query) => query.sql.includes('INSERT INTO "Student" ('));
    expect(studentInsert?.sql).toContain("FROM unnest(");
    expect(studentInsert?.values?.[0]).toBe("tenant-a");
    expect(finalizeSawStudents).toBe(5_000);
    expect(queries.findIndex((query) => query.sql.includes('UPDATE "IdempotencyKey"')))
      .toBe(queries.findIndex((query) => query.sql === "COMMIT") - 1);
    // Returned in input order although the fake returns each chunk reversed; numbers fill the gaps in input order.
    expect(students.map((student) => student.id)).toEqual(input.rows.map((row) => row.id));
    expect(students.slice(0, 4).map((student) => student.studentNo)).toEqual(["9000", "100", "9002", "101"]);
    const auditInsert = queries.find((query) => query.sql.includes('INSERT INTO "AuditLog"'));
    expect(auditInsert?.values?.slice(0, 3)).toEqual(["tenant-a", "user-a", input.auditCreatedAt]);
    expect(auditInsert?.sql).toContain('input."diff"::jsonb, $3::timestamp(3)');
    expect(JSON.parse((auditInsert?.values?.[7] as string[])[0]!)).toEqual({ studentId: input.rows[0]!.id });
    expect(client.releaseCalled).toBe(true);
  });

  it("importBatch parça insert'i hata alırsa tek transaction'ı ROLLBACK eder ve finalize çağrılmaz", async () => {
    const { client, queries } = createImportBatchClient({ failOn: 'INSERT INTO "StudentContact"' });
    const store = new PostgresStudentStore({ async query<T>() { return { rows: [] as T[] }; }, async connect() { return client; } });
    const input = importBatchInput(1_500);
    const finalize = vi.fn(async () => undefined);
    input.finalize = finalize;

    await expect(runWithRequestContext(importBatchContext, () => store.importBatch(input))).rejects.toThrow("CONTACT_INSERT_FAILED");

    expect(queries.filter((query) => query.sql === "BEGIN")).toHaveLength(1);
    expect(queries.some((query) => query.sql === "ROLLBACK")).toBe(true);
    expect(queries.some((query) => query.sql === "COMMIT")).toBe(false);
    expect(finalize).not.toHaveBeenCalled();
    expect(client.releaseCalled).toBe(true);
  });

  it.each([
    ["eksik sınıf", { classes: [] }, "CLASS_NOT_FOUND"],
    ["sınıf-seviye uyuşmazlığı", { classes: [{ id: "class-a", gradeLevelId: "grade-7", campusId: "campus-a" }] }, "STUDENT_CLASS_GRADE_LEVEL_MISMATCH"],
    ["kampüs dışı sınıf", { campusIds: ["campus-b"] }, "STUDENT_CAMPUS_SCOPE_FORBIDDEN"],
    ["lisans limiti", { activeStudentLimit: 10, currentActive: 8 }, "ACTIVE_STUDENT_LIMIT_REACHED"],
    ["silinmiş öğrencide kayıtlı TC", { nationalIdExists: true }, "STUDENT_NATIONAL_ID_CONFLICT"],
    ["kayıtlı okul no", { studentNoExists: true }, "STUDENT_NO_CONFLICT"],
    ["TC unique ihlali", { failOn: 'INSERT INTO "Student" (', failWith: { code: "23505", constraint: "Student_tenantId_nationalIdHash_key" } }, "STUDENT_NATIONAL_ID_CONFLICT"],
    ["okul no unique ihlali", { failOn: 'INSERT INTO "Student" (', failWith: { code: "23505", constraint: "Student_tenantId_studentNo_active_key" } }, "STUDENT_NO_CONFLICT"],
  ] as const)("importBatch %s durumunda yazmadan ROLLBACK eder", async (_name, options, code) => {
    const { client, queries } = createImportBatchClient(options as ImportBatchClientOptions);
    const store = new PostgresStudentStore({ async query<T>() { return { rows: [] as T[] }; }, async connect() { return client; } });
    const input = importBatchInput(3);
    if ("campusIds" in options) input.campusIds = [...options.campusIds];
    if ("activeStudentLimit" in options) input.activeStudentLimit = options.activeStudentLimit;

    await expect(runWithRequestContext(importBatchContext, () => store.importBatch(input))).rejects.toThrow(code);
    expect(queries.some((query) => query.sql === "ROLLBACK")).toBe(true);
    expect(queries.some((query) => query.sql === "COMMIT")).toBe(false);
  });

  it("importBatch başka tenant'ın request context'inde çalışmaz", async () => {
    const { client, queries } = createImportBatchClient();
    const store = new PostgresStudentStore({ async query<T>() { return { rows: [] as T[] }; }, async connect() { return client; } });

    await expect(runWithRequestContext({ ...importBatchContext, tenantId: "tenant-b" }, () => store.importBatch(importBatchInput(1))))
      .rejects.toThrow("FORBIDDEN_TENANT");
    expect(queries).toHaveLength(0);
  });

  it("bellek içi createMany dosyada sonra gelen açık okul no'yu ayırır ve numaraları metin olarak karşılaştırır", async () => {
    const store = new InMemoryStudentStore();
    await store.createMany([{ tenantId: "tenant-c", studentNo: "0101", firstName: "Sıfırlı", lastName: "No" }]);

    const created = await store.createMany([
      { tenantId: "tenant-c", firstName: "Numarasız", lastName: "Bir" },
      { tenantId: "tenant-c", studentNo: "100", firstName: "Numaralı", lastName: "İki" },
      { tenantId: "tenant-c", firstName: "Numarasız", lastName: "Üç" },
    ]);

    // "0101" does not hold 101 (Postgres compares text), and the file's own "100" is skipped.
    expect(created.map((student) => student.studentNo)).toEqual(["101", "100", "102"]);
  });

  it("bellek içi store TC aramasında silinmiş öğrenciyi yalnız includeDeleted ile döndürür ve okul no'yu kırparak eşler", async () => {
    const store = new InMemoryStudentStore();
    const [kept, removed] = await store.createMany([
      { tenantId: "tenant-a", studentNo: "7001", firstName: "Ada", lastName: "Kaya", nationalIdHash: "hash-kept", phone: "5551234567" },
      { tenantId: "tenant-a", studentNo: "7002", firstName: "Can", lastName: "Kaya", nationalIdHash: "hash-removed" },
    ]);
    await store.softDelete(removed!.id, "2026-10-22T00:00:00.000Z");

    await expect(store.findProfileById(kept!.id)).resolves.toMatchObject({ nationalIdHash: "hash-kept", phone: "5551234567" });
    await expect(store.findExistingNationalIdHashes("tenant-a", ["hash-kept", "hash-removed"])).resolves.toEqual(["hash-kept"]);
    await expect(store.findExistingNationalIdHashes("tenant-a", ["hash-kept", "hash-removed"], { includeDeleted: true }))
      .resolves.toEqual(["hash-kept", "hash-removed"]);
    await expect(store.findExistingNationalIdHashes("tenant-b", ["hash-kept"], { includeDeleted: true })).resolves.toEqual([]);
    await expect(store.findExistingStudentNos("tenant-a", ["7001", "7002", "9999"])).resolves.toEqual(["7001"]);
  });

  it("enrollment kota reddinde öğrenci oluşturmayı aynı transaction içinde rollback yapar", async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push(sql);
        if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
        if (sql.includes('FROM "Class"') && sql.includes("FOR SHARE")) {
          return { rows: [{ gradeLevelId: "grade-8" }] as T[] };
        }
        if (sql.includes('candidate::text AS "studentNo"')) {
          return { rows: [{ studentNo: "101" }] as T[] };
        }
        if (sql.includes('INSERT INTO "Student"')) {
          return {
            rows: [{
              id: String(values?.[0]),
              tenantId: "tenant-a",
              studentNo: "101",
              firstName: "Kotalı",
              lastName: "Öğrenci",
              classId: "class-a",
              responsibleTeacherId: null,
              status: "ACTIVE",
              deletedAt: null,
            }] as T[],
          };
        }
        if (sql.includes('INSERT INTO "StudentEnrollment"')) {
          throw Object.assign(new Error("ACTIVE_STUDENT_LIMIT_REACHED"), { code: "P0001" });
        }
        return { rows: [] as T[] };
      },
      releaseCalled: false,
      release() {
        this.releaseCalled = true;
      },
    };
    const pool = {
      async query<T>() {
        return { rows: [] as T[] };
      },
      async connect() {
        return client;
      },
    };
    const store = new PostgresStudentStore(pool);

    await runWithRequestContext(
      { userId: "user-tenant-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      async () => {
        await expect(store.createWithEnrollment(
          { tenantId: "tenant-a", firstName: "Kotalı", lastName: "Öğrenci", gradeLevelId: "grade-8", classId: "class-a" },
          { gradeLevelId: "grade-8", classId: "class-a", startsAt: "2026-08-01", status: "ACTIVE", reason: "CREATED" },
        )).rejects.toThrow("ACTIVE_STUDENT_LIMIT_REACHED");
      },
    );

    expect(queries.some((sql) => sql.includes('INSERT INTO "Student"'))).toBe(true);
    expect(queries.some((sql) => sql.includes('FROM "Class"') && sql.includes("FOR SHARE"))).toBe(true);
    expect(queries.some((sql) => sql.includes('INSERT INTO "StudentEnrollment"'))).toBe(true);
    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
    expect(client.releaseCalled).toBe(true);
  });

  it("öğrenci pasifleştirmesini enrollment, davet, hesap, üyelik ve session ile atomik kapatır", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
        if (sql.includes('UPDATE "Student"') && sql.includes('RETURNING *')) {
          return {
            rows: [{
              id: "student-a",
              tenantId: "tenant-a",
              studentNo: "100",
              firstName: "Ada",
              lastName: "A",
              userId: "student-user-a",
              classId: "class-a",
              responsibleTeacherId: null,
              status: "PASSIVE",
              deletedAt: null,
            }] as T[],
          };
        }
        if (sql.includes('UPDATE "IdentityInvitation"')) return { rows: [{ id: "invitation-a" }] as T[] };
        if (sql.includes('UPDATE "TenantMembership"')) return { rows: [{ id: "membership-a" }] as T[] };
        if (sql.includes('UPDATE "AuthSession"')) return { rows: [{ id: "session-a" }, { id: "session-b" }] as T[] };
        return { rows: [] as T[] };
      },
      release() {},
    };
    const store = new PostgresStudentStore({
      query: client.query,
      async connect() { return client; },
    });

    const result = await runWithRequestContext(
      { userId: "admin-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.updateWithEnrollmentTransition(
        "student-a",
        { status: "PASSIVE" },
        {
          closeActive: { endsAt: "2026-08-01", status: "PASSIVE" },
          suspendPortalAccess: { reason: "STUDENT_STATUS_PASSIVE" },
        },
      ),
    );

    expect(result?.portalAccess).toEqual({
      userId: "student-user-a",
      membershipSuspended: true,
      sessionsRevoked: 2,
      invitationsRevoked: 1,
    });
    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some(({ sql }) => sql.includes('UPDATE "StudentEnrollment"'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "IdentityInvitation"') && sql.includes("'REVOKED'"))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "SecretDeliveryOutbox"') && sql.includes('"payloadEncrypted" = NULL'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "TenantMembership"') && sql.includes('"version" = "version" + 1'))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "User"') && sql.includes('"accountStatus" = \'DISABLED\''))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "AuthSession"') && sql.includes("'REVOKED'"))).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "NotificationDeviceToken"'))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });

  it("portal session kapanışı hata verirse öğrenci pasifleştirmesini rollback eder", async () => {
    const queries: string[] = [];
    const client = {
      async query<T>(sql: string) {
        queries.push(sql);
        if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
        if (sql.includes('UPDATE "Student"') && sql.includes('RETURNING *')) {
          return {
            rows: [{
              id: "student-a",
              tenantId: "tenant-a",
              studentNo: "100",
              firstName: "Ada",
              lastName: "A",
              userId: "student-user-a",
              status: "PASSIVE",
              deletedAt: null,
            }] as T[],
          };
        }
        if (sql.includes('UPDATE "TenantMembership"')) return { rows: [{ id: "membership-a" }] as T[] };
        if (sql.includes('UPDATE "AuthSession"')) throw new Error("SESSION_REVOKE_FAILED");
        return { rows: [] as T[] };
      },
      release() {},
    };
    const store = new PostgresStudentStore({
      query: client.query,
      async connect() { return client; },
    });

    await expect(runWithRequestContext(
      { userId: "admin-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => store.updateWithEnrollmentTransition(
        "student-a",
        { status: "PASSIVE" },
        {
          closeActive: { endsAt: "2026-08-01", status: "PASSIVE" },
          suspendPortalAccess: { reason: "STUDENT_STATUS_PASSIVE" },
        },
      ),
    )).rejects.toThrow("SESSION_REVOKE_FAILED");

    expect(queries).toContain("ROLLBACK");
    expect(queries).not.toContain("COMMIT");
  });

  it("portal erişim PATCH'ini üyelik CAS, hesap sürümü ve session revoke ile tek transaction'da uygular", async () => {
    const queries: Array<{ sql: string; values?: unknown[] }> = [];
    const client = {
      async query<T>(sql: string, values?: unknown[]) {
        queries.push({ sql, values });
        if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
        if (sql.includes('SELECT s."id" AS "studentId"')) {
          return { rows: [{
            studentId: "student-a",
            studentStatus: "ACTIVE",
            userId: "student-user-a",
            accountStatus: "ACTIVE",
            membershipId: "membership-a",
            membershipStatus: "ACTIVE",
            membershipVersion: 4,
          }] as T[] };
        }
        if (sql.includes('UPDATE "TenantMembership"')) return { rows: [{ version: 5 }] as T[] };
        if (sql.includes('UPDATE "AuthSession"')) return { rows: [{ id: "session-a" }] as T[] };
        return { rows: [] as T[] };
      },
      release() {},
    };
    const store = new PostgresStudentStore({
      query: client.query,
      async connect() { return client; },
    });

    const result = await store.updatePortalAccess("tenant-a", "student-a", {
      status: "SUSPENDED",
      expectedVersion: 4,
    });

    expect(result).toEqual({
      studentId: "student-a",
      tenantId: "tenant-a",
      userId: "student-user-a",
      accountStatus: "DISABLED",
      membership: { id: "membership-a", status: "SUSPENDED", version: 5 },
      sessionsRevoked: 1,
    });
    expect(queries[0]?.sql).toBe("BEGIN");
    expect(queries.some(({ sql, values }) => sql.includes('UPDATE "TenantMembership"') && values?.[4] === 4)).toBe(true);
    expect(queries.some(({ sql, values }) => sql.includes('UPDATE "User"') && values?.[3] === 5)).toBe(true);
    expect(queries.some(({ sql }) => sql.includes('UPDATE "AuthSession"'))).toBe(true);
    expect(queries.at(-1)?.sql).toBe("COMMIT");
  });
});

describe("InMemoryStudentStore registry cursor listesi", () => {
  async function seededStore() {
    const store = new InMemoryStudentStore();
    await store.createMany([
      { tenantId: "tenant-a", firstName: "Cem", lastName: "Cursor", status: "ACTIVE" },
      { tenantId: "tenant-a", firstName: "Deniz", lastName: "Durum", status: "PASSIVE" },
      { tenantId: "tenant-a", firstName: "Ece", lastName: "Ekin", status: "ACTIVE" },
    ]);
    return store;
  }
  const query = { direction: "next" as const, limit: 2, sort: "lastName" as const };

  it("ileri ve geri cursor ile sayfalar, toplamı filtreli sayımdan verir", async () => {
    const store = await seededStore();

    const first = await store.listRegistryPage("tenant-a", query);
    expect(first.records.map((student) => student.lastName)).toEqual(["A", "Cursor"]);
    expect(first.meta).toEqual({ limit: 2, total: 4, nextCursor: expect.any(String) });

    const second = await store.listRegistryPage("tenant-a", { ...query, cursor: first.meta.nextCursor });
    expect(second.records.map((student) => student.lastName)).toEqual(["Durum", "Ekin"]);
    expect(second.meta.nextCursor).toBeUndefined();
    expect(second.meta.previousCursor).toEqual(expect.any(String));

    const back = await store.listRegistryPage("tenant-a", {
      ...query,
      cursor: second.meta.previousCursor,
      direction: "previous",
    });
    expect(back.records.map((student) => student.lastName)).toEqual(["A", "Cursor"]);
    expect(back.meta.previousCursor).toBeUndefined();
    expect(back.meta.nextCursor).toEqual(expect.any(String));
  });

  it("başka filtre, sıralama veya tenant için verilen cursor'ı reddeder", async () => {
    const store = await seededStore();
    const first = await store.listRegistryPage("tenant-a", query);
    const cursor = first.meta.nextCursor;

    await expect(store.listRegistryPage("tenant-a", { ...query, cursor, status: "ACTIVE" })).rejects.toThrow("STUDENT_CURSOR_INVALID");
    await expect(store.listRegistryPage("tenant-a", { ...query, cursor, q: "ece" })).rejects.toThrow("STUDENT_CURSOR_INVALID");
    await expect(store.listRegistryPage("tenant-a", { ...query, cursor, sort: "-lastName" })).rejects.toThrow("STUDENT_CURSOR_INVALID");
    await expect(store.listRegistryPage("tenant-b", { ...query, cursor })).rejects.toThrow("STUDENT_CURSOR_INVALID");
    await expect(store.listRegistryPage("tenant-a", { ...query, cursor: "bm90LWEtY3Vyc29y" })).rejects.toThrow("STUDENT_CURSOR_INVALID");
  });

  it("ad, soyad ve okul numarasında büyük/küçük harfe duyarsız arar", async () => {
    const store = await seededStore();

    const byName = await store.listRegistryPage("tenant-a", { ...query, q: "DENİZ" });
    expect(byName.records.map((student) => student.firstName)).toEqual(["Deniz"]);
    expect(byName.meta.total).toBe(1);
    const byNo = await store.listRegistryPage("tenant-a", { ...query, q: "100" });
    expect(byNo.records.map((student) => student.id)).toEqual(["student-a"]);
  });
});

describe("InMemoryStudentStore cursor dayanıklılığı ve Türkçe arama", () => {
  const query = { direction: "next" as const, limit: 2, sort: "lastName" as const };

  async function seeded() {
    const store = new InMemoryStudentStore();
    const created = await store.createMany([
      { tenantId: "tenant-a", firstName: "B", lastName: "BETA", status: "ACTIVE" },
      { tenantId: "tenant-a", firstName: "C", lastName: "CEYLAN", status: "ACTIVE" },
      { tenantId: "tenant-a", firstName: "D", lastName: "DEMİR", status: "ACTIVE" },
      { tenantId: "tenant-a", firstName: "E", lastName: "EKİN", status: "ACTIVE" },
    ]);
    return { store, created };
  }

  it("önceki sayfanın son satırı silinse, pasife alınsa veya adı değişse de sonraki sayfa doğru gelir", async () => {
    for (const change of ["delete", "deactivate", "rename"] as const) {
      const { store } = await seeded();
      const active = { ...query, status: "ACTIVE" as const };
      const first = await store.listRegistryPage("tenant-a", active);
      expect(first.records.map((student) => student.lastName)).toEqual(["A", "BETA"]);
      const boundary = first.records.at(-1)!;
      if (change === "delete") await store.softDelete(boundary.id, "2026-10-21T00:00:00.000Z");
      if (change === "deactivate") await store.update(boundary.id, { status: "PASSIVE" });
      if (change === "rename") await store.update(boundary.id, { lastName: "ZORLU" });

      const second = await store.listRegistryPage("tenant-a", { ...active, cursor: first.meta.nextCursor });
      expect(second.records.map((student) => student.lastName), change).toEqual(["CEYLAN", "DEMİR"]);
    }
  });

  it("IŞIK ve İSMAİL kayıtlarını I/İ/ı/i varyantlarıyla bulur", async () => {
    const store = new InMemoryStudentStore();
    await store.createMany([
      { tenantId: "tenant-a", firstName: "AYŞE", lastName: "IŞIK", status: "ACTIVE" },
      { tenantId: "tenant-a", firstName: "İSMAİL", lastName: "KAYA", status: "ACTIVE" },
    ]);
    const lastNames = async (q: string) =>
      (await store.listRegistryPage("tenant-a", { ...query, limit: 10, q })).records.map((student) => student.lastName);

    for (const q of ["ışık", "IŞIK", "Işık", "işık"]) expect(await lastNames(q), q).toEqual(["IŞIK"]);
    for (const q of ["ismail", "İsmail", "ISMAIL", "ısmaıl"]) expect(await lastNames(q), q).toEqual(["KAYA"]);
    // Only I variants fold: ş stays ş, so an ASCII "isik" does not match "IŞIK".
    expect(await lastNames("isik")).toEqual([]);
    const portal = await store.listPortalAccess("tenant-a", { direction: "next", limit: 10, q: "ışık" });
    expect(portal.records.map((record) => record.lastName)).toEqual(["IŞIK"]);
  });
});

const importBatchContext = { userId: "user-a", tenantId: "tenant-a", roles: ["TENANT_ADMIN" as const], bypassRls: false };

function importBatchInput(count: number): StudentImportBatchInput {
  const rows = Array.from({ length: count }, (_, index) => {
    const id = `student-${index}`;
    return {
      id,
      student: {
        tenantId: "tenant-a",
        // Every other row brings its own number; the rest are allocated around them.
        ...(index % 2 === 0 ? { studentNo: String(9_000 + index) } : {}),
        firstName: `AD ${index}`,
        lastName: "SOYAD",
        gradeLevelId: "grade-8",
        classId: "class-a",
        status: "ACTIVE" as const,
        ...(index % 3 === 0 ? { nationalIdEncrypted: `enc-${index}`, nationalIdHash: `hash-${index}` } : {}),
      },
      enrollment: { gradeLevelId: "grade-8", classId: "class-a", startsAt: "2026-10-22", status: "ACTIVE" as const, reason: "CREATED" },
      contact: {
        tenantId: "tenant-a",
        studentId: id,
        firstName: "VELİ",
        lastName: "SOYAD",
        relationType: "LEGAL_GUARDIAN" as const,
        phoneEncrypted: `phone-enc-${index}`,
        phoneHash: `phone-hash-${index}`,
        canReceiveSms: false,
        canReceiveAnnouncements: false,
        canReceiveFinance: false,
      },
    };
  });
  return {
    tenantId: "tenant-a",
    actorUserId: "user-a",
    rows,
    audits: [
      ...rows.map((row) => ({ entityType: "StudentContact", entityId: row.id, action: "student_contact.imported", diff: { studentId: row.id } })),
      { entityType: "StudentImport", action: "student_import.completed", diff: { totalRows: count } },
    ],
    auditCreatedAt: "2026-10-22T08:00:00.000Z",
    activeStudentLimit: 100_000,
  };
}

interface ImportBatchClientOptions {
  classes?: Array<{ id: string; gradeLevelId: string | null; campusId: string | null }>;
  currentActive?: number;
  nationalIdExists?: boolean;
  studentNoExists?: boolean;
  failOn?: string;
  failWith?: Record<string, unknown>;
}

function createImportBatchClient(options: ImportBatchClientOptions = {}) {
  const queries: Array<{ sql: string; values?: unknown[] }> = [];
  const client = {
    releaseCalled: false,
    async query<T>(sql: string, values?: unknown[]) {
      queries.push({ sql, values });
      if (options.failOn && sql.includes(options.failOn)) {
        throw Object.assign(new Error(options.failWith ? "duplicate key value" : "CONTACT_INSERT_FAILED"), options.failWith ?? {});
      }
      if (sql.includes("pg_try_advisory_xact_lock_shared")) return { rows: [{ locked: true }] as T[] };
      if (sql.includes('FROM "Class"') && sql.includes("FOR SHARE")) {
        return { rows: (options.classes ?? [{ id: "class-a", gradeLevelId: "grade-8", campusId: "campus-a" }]) as T[] };
      }
      if (sql.includes('count(*)::int AS "count"')) return { rows: [{ count: options.currentActive ?? 0 }] as T[] };
      if (sql.includes('"nationalIdHash" = ANY')) return { rows: (options.nationalIdExists ? [{ "?column?": 1 }] : []) as T[] };
      if (sql.includes('btrim("studentNo") = ANY')) return { rows: (options.studentNoExists ? [{ "?column?": 1 }] : []) as T[] };
      if (sql.includes('candidate::text AS "studentNo"')) {
        return { rows: Array.from({ length: Number(values?.[2]) }, (_, index) => ({ studentNo: String(100 + index) })) as T[] };
      }
      if (sql.includes('INSERT INTO "Student" (')) {
        const [, ids, studentNos, firstNames, lastNames] = values as [string, string[], string[], string[], string[]];
        return {
          rows: ids.map((id, index) => ({
            id, tenantId: "tenant-a", studentNo: studentNos[index], firstName: firstNames[index], lastName: lastNames[index],
            gradeLevelId: "grade-8", classId: "class-a", responsibleTeacherId: null, status: "ACTIVE",
            nationalIdEncrypted: null, nationalIdHash: null, phone: null, email: null, photoKey: null, userId: null, deletedAt: null,
          })).reverse() as T[],
        };
      }
      return { rows: [] as T[] };
    },
    release() {
      this.releaseCalled = true;
    },
  };
  return { client, queries };
}
