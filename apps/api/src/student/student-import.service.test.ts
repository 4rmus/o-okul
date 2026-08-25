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
      "ad;soyad;tc;telefon;veli_ad;veli_soyad;veli_tc;veli_telefon",
      "Tc;Ogrenci;10000000146;;;;;",
      "Telefon;Ogrenci;;05551234567;;;;",
      "VeliTc;Ogrenci;;;Fatma;Kaya;10000001372;",
      "VeliTelefon;Ogrenci;;;Ayse;Kaya;;05557654321",
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
    ]);
  });

  it("registry v2 pilotunda öğrenci hesap e-postasını reddetmeye devam eder", async () => {
    const { service } = createService({ registryV2: true });
    const preview = await service.dryRun(context, {
      fileBase64: csv("ad;soyad;email\nAda;Kaya;ada@example.test"),
    });

    expect(preview).toMatchObject({
      wouldImport: false,
      errors: [{ row: 2, field: "email", code: "STUDENT_IMPORT_PILOT_CORE_ONLY" }],
    });
  });

  it("iletişim kişisini maskeli dry-run ve default-off izinlerle import girdisine taşır", async () => {
    const { service, students } = createService();
    const fileBase64 = csv([
      "ad;soyad;contactFirstName;contactLastName;contactRelation;contactPhone;contactEmail",
      "Ada;Kaya;Fatma;Kaya;ANNE;5551234567;fatma@example.test",
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
    })]);
  });

  it("dry-run sınıf ve okul no kontrolünü kampüs kapsamı ile tenant benzersizliğinde yapar", async () => {
    const { service } = createService({
      classes: [{ id: "class-main", tenantId: "tenant-a", campusId: "campus-main", name: "8-A" }],
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
});

function createService(options: {
  registryV2?: boolean;
  classes?: Array<{ id: string; tenantId: string; campusId?: string; name: string }>;
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
    listClasses: vi.fn(async () => options.classes ?? [{ id: "class-main", tenantId: "tenant-a", campusId: "campus-main", name: "8-A" }]),
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
