import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { type RequestContext, runWithRequestContext } from "../context/request-context.js";
import { IdempotencyService, InMemoryIdempotencyStore } from "../http/idempotency.js";
import { InMemoryClassStore } from "../school/class-store.js";
import { InMemoryGradeLevelStore } from "../school/grade-level-store.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import type { SchoolService } from "../school/school.service.js";
import { InMemoryStudentContactStore } from "./student-contact-store.js";
import { InMemoryStudentEnrollmentStore } from "./student-enrollment-store.js";
import { StudentImportService } from "./student-import.service.js";
import { InMemoryStudentStore } from "./student-store.js";
import { StudentService } from "./student.service.js";
import { hashTcIdentity } from "./tc-identity.js";

const context: RequestContext = {
  userId: "operations-a",
  tenantId: "tenant-a",
  roles: ["OPERATIONS_STAFF"],
  activePersona: "STAFF",
  campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
  bypassRls: false,
};

describe("StudentImportService Gate D", () => {
  it("commit için Idempotency-Key zorunlu tutar", async () => {
    const { service, students } = createService();

    await expect(service.import(context, { fileBase64: csv("ad;soyad\nAda;Kaya") }))
      .rejects.toThrow("IDEMPOTENCY_KEY_REQUIRED");
    expect(students.createMany).not.toHaveBeenCalled();
  });

  it("öğrenci TC/telefonunu işler; veli sütunlarını veli hesabı açmadan iletişim kişisine çevirir", async () => {
    const { service, students } = createService();
    const fileBase64 = csv([
      "ad;soyad;seviye;tc;telefon;veli_ad;veli_soyad;veli_tc;veli_telefon",
      "Tc;Ogrenci;8. Sınıf;10000000146;;;;;",
      "Telefon;Ogrenci;8. Sınıf;;05551234567;;;;",
      "VeliTc;Ogrenci;8. Sınıf;;;Fatma;Kaya;10000001372;",
      "VeliTelefon;Ogrenci;8. Sınıf;;;;;;05557654321",
      "YalnizVeliTc;Ogrenci;8. Sınıf;;;;;10000001372;",
    ].join("\n"));

    const preview = await service.dryRun(context, { fileBase64 });
    expect(preview).toMatchObject({ totalRows: 5, errors: [], wouldImport: true });
    expect(JSON.stringify(preview)).not.toContain("10000001372");
    expect(JSON.stringify(preview)).not.toContain("guardian");

    await service.import(context, { fileBase64 }, "independent-identity-fields-a");
    const [, inputs] = students.createMany.mock.calls[0] as unknown as [RequestContext, Array<Record<string, unknown>>];
    expect(inputs).toEqual([
      expect.objectContaining({ nationalId: "10000000146", firstName: "TC" }),
      expect.objectContaining({ phone: "5551234567", firstName: "TELEFON" }),
      expect.objectContaining({ contact: expect.objectContaining({ firstName: "FATMA", lastName: "KAYA", relationType: "LEGAL_GUARDIAN" }) }),
      expect.objectContaining({ contact: expect.objectContaining({ firstName: "VELİ", lastName: "OGRENCİ", phone: "5557654321" }) }),
      expect.not.objectContaining({ contact: expect.anything() }),
    ]);
    expect(JSON.stringify(inputs)).not.toContain("10000001372");
    expect(inputs.every((input) => !("guardian" in input))).toBe(true);
  });

  it("aynı satırda veli ve iletişim sütunları doluysa satırı commit öncesinde reddeder", async () => {
    const { service, students } = createService();
    const fileBase64 = csv([
      "ad;soyad;seviye;veli_ad;veli_telefon;contactFirstName;contactLastName;contactPhone",
      "Ada;Kaya;8. Sınıf;Fatma;05557654321;Ali;Kaya;05551234567",
    ].join("\n"));

    await expect(service.dryRun(context, { fileBase64 })).resolves.toMatchObject({
      wouldImport: false,
      errors: [{ row: 2, field: "guardian", code: "CONTACT_COLUMNS_CONFLICT" }],
    });
    await expect(service.import(context, { fileBase64 }, "contact-columns-conflict-a"))
      .rejects.toMatchObject({ response: { code: "STUDENT_IMPORT_INVALID" } });
    expect(students.createMany).not.toHaveBeenCalled();
  });

  it("şablondaki öğrenci e-posta sütununu profil verisi olarak kabul eder", async () => {
    const { service, students } = createService();
    const fileBase64 = csv("ad;soyad;seviye;email\nAda;Kaya;8. Sınıf;ada@example.test");

    await expect(service.dryRun(context, { fileBase64 })).resolves.toMatchObject({ wouldImport: true, errors: [] });
    await service.import(context, { fileBase64 }, "student-email-profile-a");
    expect(students.createMany).toHaveBeenCalledWith(context, [expect.objectContaining({ email: "ada@example.test" })], expect.anything());
  });

  it("iletişim kişisini maskeli dry-run ve default-off izinlerle import girdisine taşır", async () => {
    const { service, students } = createService();
    const fileBase64 = csv([
      "ad;soyad;seviye;contactFirstName;contactLastName;contactRelation;contactPhone;contactEmail",
      "Ada;Kaya;8. Sınıf;Fatma;Kaya;ANNE;5551234567;fatma@example.test",
    ].join("\n"));

    const preview = await service.dryRun(context, { fileBase64 });
    expect(preview).toMatchObject({
      wouldImport: true,
      validRows: [{
        contact: {
          firstName: "FATMA",
          lastName: "KAYA",
          relationType: "MOTHER",
          phoneMasked: "••• ••• ••67",
          emailMasked: "fa••@•••.test",
        },
      }],
    });
    expect(JSON.stringify(preview)).not.toContain("5551234567");
    expect(JSON.stringify(preview)).not.toContain("fatma@example.test");

    await expect(service.import(context, { fileBase64 }, "contact-import-a"))
      .resolves.toMatchObject({ importedContacts: 1 });
    expect(students.createMany).toHaveBeenCalledWith(context, [expect.objectContaining({
      contact: expect.objectContaining({
        firstName: "FATMA",
        relationType: "MOTHER",
        phone: "5551234567",
        canReceiveSms: false,
        canReceiveAnnouncements: false,
        canReceiveFinance: false,
      }),
    })], expect.anything());
  });

  it("dry-run sınıf ve okul no kontrolünü kampüs kapsamı ile tenant benzersizliğinde yapar", async () => {
    const { service } = createService({
      classes: [{ id: "class-main", tenantId: "tenant-a", campusId: "campus-main", gradeLevelId: "grade-8", name: "8-A" }],
      studentNos: ["999"],
    });
    const preview = await service.dryRun(context, {
      fileBase64: csv("okul_no;ad;soyad;sinif\n999;Ada;Kaya;Uzak Sınıf"),
    });

    expect(preview.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "studentNo", code: "STUDENT_NO_DUPLICATE" }),
      expect.objectContaining({ field: "className", code: "CLASS_NOT_FOUND" }),
    ]));
  });

  it("özel sınıf adını boşluk ve harf farkı olmadan eşleştirip aynı classId ile commit eder", async () => {
    const { service, students } = createService({
      classes: [{ id: "class-custom", tenantId: "tenant-a", campusId: "campus-main", gradeLevelId: "grade-8", name: "Bilim Atölyesi" }],
    });
    const fileBase64 = csv("okul_no;ad;soyad;sinif\n100;Ada;Kaya; bİLİMAtölyesi ");

    await expect(service.dryRun(context, { fileBase64 })).resolves.toMatchObject({
      errors: [],
      validRows: [expect.objectContaining({ gradeLevelId: "grade-8", gradeLevelName: "8. Sınıf", classId: "class-custom", className: "bİLİMAtölyesi" })],
      wouldImport: true,
    });
    await service.import(context, { fileBase64 }, "custom-class-name-import");
    expect(students.createMany).toHaveBeenCalledWith(
      context,
      [expect.objectContaining({ gradeLevelId: "grade-8", classId: "class-custom" })],
      expect.objectContaining({ classById: expect.any(Map), gradeLevelById: expect.any(Map) }),
    );
  });

  it("seviye ile sınıf uyuşmadığında satırı reddeder", async () => {
    const { service } = createService({
      classes: [{ id: "class-main", tenantId: "tenant-a", campusId: "campus-main", gradeLevelId: "grade-8", name: "8-A" }],
      gradeLevels: [
        { id: "grade-7", tenantId: "tenant-a", code: "7", name: "7. Sınıf" },
        { id: "grade-8", tenantId: "tenant-a", code: "8", name: "8. Sınıf" },
      ],
    });

    await expect(service.dryRun(context, {
      fileBase64: csv("ad;soyad;seviye;sinif\nAda;Kaya;7. Sınıf;8-A"),
    })).resolves.toMatchObject({
      wouldImport: false,
      errors: [expect.objectContaining({ row: 2, field: "gradeLevelName", code: "CLASS_GRADE_LEVEL_MISMATCH" })],
    });
  });

  it("eksik, bilinmeyen ve belirsiz seviye değerlerini ayrı hata kodlarıyla reddeder", async () => {
    const missing = createService();
    await expect(missing.service.dryRun(context, {
      fileBase64: csv("ad;soyad\nAda;Kaya"),
    })).resolves.toMatchObject({
      errors: [expect.objectContaining({ code: "GRADE_LEVEL_REQUIRED" })],
    });

    const unknown = createService();
    await expect(unknown.service.dryRun(context, {
      fileBase64: csv("ad;soyad;seviye\nAda;Kaya;Bilinmeyen"),
    })).resolves.toMatchObject({
      errors: [expect.objectContaining({ code: "GRADE_LEVEL_NOT_FOUND" })],
    });

    const ambiguous = createService({
      gradeLevels: [
        { id: "grade-8-a", tenantId: "tenant-a", code: "8A", name: "8. Sınıf" },
        { id: "grade-8-b", tenantId: "tenant-a", code: "8B", name: "8. Sınıf" },
      ],
    });
    await expect(ambiguous.service.dryRun(context, {
      fileBase64: csv("ad;soyad;seviye\nAda;Kaya;8. Sınıf"),
    })).resolves.toMatchObject({
      errors: [expect.objectContaining({ code: "GRADE_LEVEL_AMBIGUOUS" })],
    });
  });
  it("dosyadaki okul no ve TC'leri satır başına değil tek toplu sorguyla arar; hata sırası ve satır numaraları korunur", async () => {
    const { service, students } = createService({ studentNos: ["1002"] });
    students.findExistingNationalIds.mockResolvedValue(new Set(["10000000146"]));
    const fileBase64 = csv([
      "okul_no;ad;soyad;seviye;tc;telefon",
      "1001;Ada;Kaya;8. Sınıf;10000000146;",
      "1002;Bora;Bal;8. Sınıf;;",
      "1001;Cem;Can;8. Sınıf;1000000014;",
      "1003;Ece;Er;8. Sınıf;10000000146;05551234567",
    ].join("\n"));

    const preview = await service.dryRun(context, { fileBase64 });

    expect(students.findExistingStudentNos).toHaveBeenCalledTimes(1);
    expect(students.findExistingStudentNos).toHaveBeenCalledWith(context, ["1001", "1002", "1001", "1003"]);
    expect(students.findExistingNationalIds).toHaveBeenCalledTimes(1);
    expect(students.findExistingNationalIds).toHaveBeenCalledWith(context, ["10000000146", "10000000146"]);
    expect(preview.errors).toEqual([
      { row: 2, field: "nationalId", code: "STUDENT_NATIONAL_ID_DUPLICATE", value: "*******0146" },
      { row: 3, field: "studentNo", code: "STUDENT_NO_DUPLICATE", value: "1002" },
      { row: 4, field: "studentNo", code: "STUDENT_NO_DUPLICATE", value: "1001" },
      { row: 4, field: "nationalId", code: "INVALID_NATIONAL_ID", value: "*******0014" },
      { row: 5, field: "nationalId", code: "STUDENT_NATIONAL_ID_DUPLICATE", value: "*******0146" },
    ]);
  });

  it("commit tamamlanma auditini ve idempotency tamamlamasını öğrenci yazımına aynı çağrıda devreder", async () => {
    const { service, students } = createService();
    const idempotencyStore = new InMemoryIdempotencyStore();
    const completeInTransaction = vi.fn(async () => undefined);
    Object.assign(idempotencyStore, { completeInTransaction });
    const withIdempotency = new StudentImportService(
      students as unknown as StudentService,
      { listClasses: async () => [{ id: "class-main", tenantId: "tenant-a", campusId: "campus-main", gradeLevelId: "grade-8", name: "8-A" }],
        listGradeLevels: async () => [{ id: "grade-8", tenantId: "tenant-a", code: "8", name: "8. Sınıf" }] } as unknown as SchoolService,
      new IdempotencyService(idempotencyStore),
    );
    students.createMany.mockImplementation((async (_context: RequestContext, rows: unknown[], options: { finalize?: (client: unknown, created: unknown[]) => Promise<void> }) => {
      const created = rows.map((_, index) => ({ id: `student-${index}`, tenantId: "tenant-a", studentNo: "1001", firstName: "ADA", lastName: "KAYA", status: "ACTIVE" }));
      await options.finalize?.({ query: vi.fn() }, created);
      return created;
    }) as never);

    const result = await withIdempotency.import(context, { fileBase64: csv("okul_no;ad;soyad;seviye\n1001;Ada;Kaya;8. Sınıf") }, "import-finalize-a");

    const [, , options] = students.createMany.mock.calls[0] as unknown as [RequestContext, unknown[], Record<string, unknown>];
    expect(options.extraAudits).toEqual([{
      entityType: "StudentImport",
      action: "student_import.completed",
      diff: { totalRows: 1, importedRows: 1, errorCount: 0, quota: { limit: 200, current: 0, incoming: 1, wouldExceed: false } },
    }]);
    expect(completeInTransaction).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      key: "import-finalize-a",
      operation: "student.import.commit",
      responseBody: result,
    }));
    expect(result).toEqual({
      importedRows: 1,
      importedContacts: 0,
      students: [{ id: "student-0", tenantId: "tenant-a", studentNo: "1001", firstName: "ADA", lastName: "KAYA", status: "ACTIVE" }],
    });
  });

  it("S1-03 dosyası 30 öğrenci ve 29 kapalı izinli LEGAL_GUARDIAN iletişim kişisi yazar; ön izleme gövdesi değişmez", async () => {
    const setup = createRealImport();
    const fileBase64 = readFileSync("../../docs/examples/staging-uat-s1/ogrenciler-8a-30.csv").toString("base64");

    const preview = await runWithRequestContext(context, () => setup.service.dryRun(context, { fileBase64 }));
    // Digest of the dry-run body produced by the pre-DEC-20261021-02 code for this fixture.
    expect(createHash("sha256").update(JSON.stringify(preview)).digest("hex"))
      .toBe("8acfc46b172a85454171c1afab39ab10d205970d950f24bca79f053c4dce9d32");
    expect(JSON.stringify(preview)).not.toContain("05550000001");

    const result = await runWithRequestContext(context, () => setup.service.import(context, { fileBase64 }, "s1-03-fixture"));
    expect(result).toMatchObject({ importedRows: 30, importedContacts: 29 });
    expect(result.students.map((student) => student.studentNo)).toEqual(Array.from({ length: 30 }, (_, index) => String(1001 + index)));
    expect(result.students[0]).toEqual({
      id: expect.any(String), tenantId: "tenant-a", studentNo: "1001", firstName: "ADA", lastName: "AK",
      gradeLevelId: "grade-8", classId: "class-a", status: "ACTIVE",
    });
    const contacts = (await Promise.all(result.students.map((student) => setup.contacts.listByStudent("tenant-a", student.id)))).flat();
    expect(contacts).toHaveLength(29);
    expect(contacts.every((contact) => contact.relationType === "LEGAL_GUARDIAN"
      && !contact.canReceiveSms && !contact.canReceiveAnnouncements && !contact.canReceiveFinance)).toBe(true);
    expect(setup.audits.filter((audit) => audit.action === "student_contact.imported")).toHaveLength(29);
    expect(setup.audits.filter((audit) => audit.action === "student_import.completed")).toHaveLength(1);
    await expect(runWithRequestContext(context, () => setup.service.import(context, { fileBase64 }, "s1-03-fixture")))
      .resolves.toEqual(JSON.parse(JSON.stringify(result)));
  });

  it("silinmiş öğrencide kayıtlı TC'yi ön izlemede satır hatası olarak gösterir; commit hiçbir satırı yazmaz", async () => {
    const setup = createRealImport();
    const [removed] = await setup.studentStore.createMany([{
      tenantId: "tenant-a", studentNo: "900", firstName: "SİLİNMİŞ", lastName: "ÖĞRENCİ", nationalIdHash: hashTcIdentity("10000002277"),
    }]);
    await setup.studentStore.softDelete(removed!.id, "2026-10-01T00:00:00.000Z");
    const before = await setup.studentStore.list();
    const fileBase64 = csv([
      "okul_no;ad;soyad;seviye;sinif;tc",
      "3001;Deniz;Er;8. Sınıf;8-A;10000003001",
      "3002;Ece;Ek;8. Sınıf;8-A;10000002277",
    ].join("\n"));

    const preview = await runWithRequestContext(context, () => setup.service.dryRun(context, { fileBase64 }));
    expect(preview).toMatchObject({
      wouldImport: false,
      errors: [{ row: 3, field: "nationalId", code: "STUDENT_NATIONAL_ID_DUPLICATE", value: "*******2277" }],
    });
    expect(preview.validRows.map((row) => row.row)).toEqual([2]);
    await expect(runWithRequestContext(context, () => setup.service.import(context, { fileBase64 }, "soft-deleted-tc")))
      .rejects.toMatchObject({
        status: 400,
        response: { code: "STUDENT_IMPORT_INVALID", errors: [{ row: 3, field: "nationalId", code: "STUDENT_NATIONAL_ID_DUPLICATE", value: "*******2277" }] },
      });
    await expect(setup.studentStore.list()).resolves.toEqual(before);
    expect(setup.audits).toEqual([]);
  });

  it("S1-03 çakışma dosyasını CONTACT_COLUMNS_CONFLICT ile reddeder ve hiçbir şey yazmaz", async () => {
    const setup = createRealImport();
    const fileBase64 = readFileSync("../../docs/examples/staging-uat-s1/cakisma-tek-satir.csv").toString("base64");

    await expect(runWithRequestContext(context, () => setup.service.dryRun(context, { fileBase64 }))).resolves.toEqual({
      dryRun: true,
      totalRows: 1,
      validRows: [],
      errors: [{ row: 2, field: "guardian", code: "CONTACT_COLUMNS_CONFLICT" }],
      quota: { limit: 200, current: 1, incoming: 0, wouldExceed: false },
      wouldImport: false,
    });
    await expect(runWithRequestContext(context, () => setup.service.import(context, { fileBase64 }, "s1-03-conflict")))
      .rejects.toMatchObject({ response: { code: "STUDENT_IMPORT_INVALID", errors: [{ row: 2, field: "guardian", code: "CONTACT_COLUMNS_CONFLICT" }] } });
    expect(setup.audits).toEqual([]);
  });
});

function createRealImport() {
  const audits: Array<{ action: string }> = [];
  const classStore = new InMemoryClassStore();
  const gradeLevelStore = new InMemoryGradeLevelStore();
  const contacts = new InMemoryStudentContactStore();
  const idempotency = new IdempotencyService(new InMemoryIdempotencyStore());
  const studentStore = new InMemoryStudentStore();
  const students = new StudentService(
    studentStore,
    new InMemoryGuardianStudentStore(),
    {} as never,
    new InMemoryStudentEnrollmentStore(),
    { listYears: async () => [], listTerms: async () => [] } as never,
    {} as never,
    classStore,
    gradeLevelStore,
    {} as never,
    {} as never,
    { record: async (input: { action: string }) => { audits.push(input); } } as never,
    idempotency,
    undefined,
    undefined,
    undefined,
    contacts,
  );
  const school = {
    listClasses: async () => (await classStore.list()).filter((record) => record.tenantId === "tenant-a" && record.campusId === "campus-main"),
    listGradeLevels: async () => (await gradeLevelStore.list()).filter((record) => record.tenantId === "tenant-a"),
  };
  return { service: new StudentImportService(students, school as unknown as SchoolService, idempotency), audits, contacts, studentStore };
}

function createService(options: {
  classes?: Array<{ id: string; tenantId: string; campusId?: string; gradeLevelId?: string; name: string }>;
  gradeLevels?: Array<{ id: string; tenantId: string; code?: string; name: string }>;
  studentNos?: string[];
} = {}) {
  const students = {
    createMany: vi.fn(async () => []),
    findExistingNationalIds: vi.fn(async () => new Set<string>()),
    list: vi.fn(async () => []),
    findExistingStudentNos: vi.fn(async (_context, studentNos: string[]) => new Set(studentNos.filter((studentNo) => options.studentNos?.includes(studentNo)))),
    previewQuota: vi.fn(async (_context, incoming: number) => ({ limit: 200, current: 0, incoming, wouldExceed: false })),
  };
  const school = {
    listClasses: vi.fn(async () => options.classes ?? [{ id: "class-main", tenantId: "tenant-a", campusId: "campus-main", gradeLevelId: "grade-8", name: "8-A" }]),
    listGradeLevels: vi.fn(async () => options.gradeLevels ?? [{ id: "grade-8", tenantId: "tenant-a", code: "8", name: "8. Sınıf" }]),
  };
  return {
    service: new StudentImportService(
      students as unknown as StudentService,
      school as unknown as SchoolService,
    ),
    students,
  };
}

function csv(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
