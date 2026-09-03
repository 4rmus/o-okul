import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import type { FeatureRolloutService } from "../feature-rollout/feature-rollout.service.js";
import type { SchoolService } from "../school/school.service.js";
import { StudentImportService } from "./student-import.service.js";
import type { StudentService } from "./student.service.js";

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

  it("öğrenci ve veli TC/telefon alanlarını birbirinden bağımsız işler", async () => {
    const { service, students } = createService({ registryV2: true });
    const fileBase64 = csv([
      "ad;soyad;seviye;tc;telefon;veli_ad;veli_soyad;veli_tc;veli_telefon",
      "Tc;Ogrenci;8. Sınıf;10000000146;;;;;",
      "Telefon;Ogrenci;8. Sınıf;;05551234567;;;;",
      "VeliTc;Ogrenci;8. Sınıf;;;Fatma;Kaya;10000001372;",
      "VeliTelefon;Ogrenci;8. Sınıf;;;Ayse;Kaya;;05557654321",
    ].join("\n"));

    const preview = await service.dryRun(context, { fileBase64 });
    expect(preview).toMatchObject({ totalRows: 4, errors: [], wouldImport: true });

    await expect(service.import(context, { fileBase64 }, "independent-identity-fields-a"))
      .resolves.toMatchObject({ importedRows: 0 });
    expect(students.assertGuardianProvisioningAllowed).toHaveBeenCalledWith(context);
    expect(students.createMany).toHaveBeenCalledWith(context, [
      expect.objectContaining({ nationalId: "10000000146", firstName: "TC" }),
      expect.objectContaining({ phone: "5551234567", firstName: "TELEFON" }),
      expect.objectContaining({ guardian: expect.objectContaining({ nationalId: "10000001372" }) }),
      expect.objectContaining({ guardian: expect.objectContaining({ phone: "5557654321" }) }),
    ], { provisionAccounts: false });
  });

  it("toplu importta öğrenci ve veli portal hesabını varsayılan kapalı tutar", async () => {
    const { service, students } = createService({ registryV2: true });
    const fileBase64 = csv([
      "ad;soyad;seviye;tc;telefon;veli_ad;veli_soyad;veli_tc;veli_telefon",
      "Ada;Kaya;8. Sınıf;10000000146;05551234567;Fatma;Kaya;10000001372;05557654321",
    ].join("\n"));

    const preview = await service.dryRun(context, { fileBase64 });
    expect(preview).toMatchObject({ totalRows: 1, errors: [], wouldImport: true });
    expect(preview.validRows[0]).not.toHaveProperty("accountPreview");

    await service.import(context, { fileBase64 }, "accounts-default-off-a");
    expect(students.createMany).toHaveBeenCalledWith(context, [
      expect.objectContaining({ guardian: expect.objectContaining({ firstName: "FATMA" }) }),
    ], { provisionAccounts: false });
  });

  it("veli adı olup TC veya telefonu olmayan satırı commit öncesinde reddeder", async () => {
    const { service, students } = createService();
    const fileBase64 = csv("ad;soyad;seviye;veli_ad;veli_soyad\nAda;Kaya;8. Sınıf;Fatma;Kaya");

    await expect(service.dryRun(context, { fileBase64 })).resolves.toMatchObject({
      totalRows: 1,
      validRows: [],
      errors: [{ row: 2, field: "guardian", code: "GUARDIAN_CONTACT_REQUIRED" }],
      wouldImport: false,
    });
    await expect(service.import(context, { fileBase64 }, "guardian-contact-required-a"))
      .rejects.toMatchObject({ response: { code: "STUDENT_IMPORT_INVALID" } });
    expect(students.createMany).not.toHaveBeenCalled();
  });

  it("registry v2 pilotunda öğrenci hesap e-postasını reddetmeye devam eder", async () => {
    const { service } = createService({ registryV2: true });
    const preview = await service.dryRun(context, {
      fileBase64: csv("ad;soyad;seviye;email\nAda;Kaya;8. Sınıf;ada@example.test"),
    });

    expect(preview).toMatchObject({
      wouldImport: false,
      errors: [{ row: 2, field: "email", code: "STUDENT_IMPORT_PILOT_CORE_ONLY" }],
    });
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

    await expect(service.import(context, { fileBase64 }, "registry-v2-contact-a"))
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
    })], { provisionAccounts: false });
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
      { provisionAccounts: false },
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
});

function createService(options: {
  registryV2?: boolean;
  classes?: Array<{ id: string; tenantId: string; campusId?: string; gradeLevelId?: string; name: string }>;
  gradeLevels?: Array<{ id: string; tenantId: string; code?: string; name: string }>;
  studentNos?: string[];
} = {}) {
  const students = {
    assertGuardianProvisioningAllowed: vi.fn(async () => undefined),
    createMany: vi.fn(async () => []),
    hasNationalId: vi.fn(async () => false),
    list: vi.fn(async () => []),
    listStudentNosForImport: vi.fn(async () => options.studentNos ?? []),
    previewQuota: vi.fn(async (_context, incoming: number) => ({ limit: 200, current: 0, incoming, wouldExceed: false })),
  };
  const school = {
    listClasses: vi.fn(async () => options.classes ?? [{ id: "class-main", tenantId: "tenant-a", campusId: "campus-main", gradeLevelId: "grade-8", name: "8-A" }]),
    listGradeLevels: vi.fn(async () => options.gradeLevels ?? [{ id: "grade-8", tenantId: "tenant-a", code: "8", name: "8. Sınıf" }]),
  };
  const featureRollouts = {
    resolve: vi.fn(async () => ({ enabledFeatureKeys: options.registryV2 ? ["web.student-registry-v2"] : [] })),
  };
  return {
    service: new StudentImportService(
      students as unknown as StudentService,
      school as unknown as SchoolService,
      undefined,
      undefined,
      featureRollouts as unknown as FeatureRolloutService,
    ),
    students,
  };
}

function csv(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
