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

  it("registry v2 pilotunda post-commit hesap/guardian yan etkisi doğuracak kolonları reddeder", async () => {
    const { service, students } = createService({ registryV2: true });
    const fileBase64 = csv([
      "ad;soyad;tc;telefon;veli_ad;veli_soyad;veli_telefon",
      "Ada;Kaya;10000000146;5551234567;Fatma;Kaya;5557654321",
    ].join("\n"));

    const preview = await service.dryRun(context, { fileBase64 });
    expect(preview.wouldImport).toBe(false);
    expect(preview.errors).toEqual(expect.arrayContaining([
      expect.objectContaining({ field: "nationalId", code: "STUDENT_IMPORT_PILOT_CORE_ONLY" }),
      expect.objectContaining({ field: "phone", code: "STUDENT_IMPORT_PILOT_CORE_ONLY" }),
      expect.objectContaining({ field: "guardian", code: "STUDENT_CONTACT_IMPORT_REQUIRED" }),
    ]));
    await expect(service.import(context, { fileBase64 }, "registry-v2-core-only-a"))
      .rejects.toMatchObject({ status: 400 });
    expect(students.createMany).not.toHaveBeenCalled();
  });

  it("registry v2 iletişim kişisini maskeli dry-run ve default-off izinlerle import girdisine taşır", async () => {
    const { service, students } = createService({ registryV2: true });
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
