import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryGuardianStore } from "../school/guardian-store.js";
import { InMemoryStudentStore } from "./student-store.js";
import { StudentService } from "./student.service.js";

describe("StudentService", () => {
  it("ogrenci olustururken yeni veli, link ve davet uretir", async () => {
    const setup = createService();

    const student = await setup.service.create(adminContext, {
      firstName: "Yeni",
      lastName: "Ogrenci",
      guardian: {
        firstName: "Ayse",
        lastName: "Veli",
        phone: "5550000001",
        email: "AYSE@example.test",
        canViewFinance: false,
      },
    });

    const guardians = await setup.guardianStore.list();
    const guardian = guardians.find((record) => record.phone === "5550000001");
    expect(guardian).toMatchObject({
      tenantId: "tenant-a",
      firstName: "Ayse",
      lastName: "Veli",
    });
    await expect(setup.guardianStudentStore.listByStudent(student.id)).resolves.toEqual([
      expect.objectContaining({
        guardianId: guardian?.id,
        studentId: student.id,
        canViewFinance: false,
      }),
    ]);
    expect(setup.invitations).toEqual([
      expect.objectContaining({
        subjectType: "GUARDIAN",
        subjectId: guardian?.id,
        email: "ayse@example.test",
      }),
    ]);
    expect(setup.auditRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "guardian.auto_provisioned",
        entityType: "GuardianStudent",
      }),
    ]));
  });

  it("telefon eslesirse mevcut veliyi yeniden kullanir", async () => {
    const setup = createService();

    const student = await setup.service.create(adminContext, {
      firstName: "Kardes",
      lastName: "Ogrenci",
      guardian: {
        phone: "5000000001",
      },
    });

    await expect(setup.guardianStudentStore.listByStudent(student.id)).resolves.toEqual([
      expect.objectContaining({
        guardianId: "guardian-a",
        studentId: student.id,
      }),
    ]);
    expect(setup.invitations).toEqual([]);
  });

  it("veli TC ve telefonuyla tenant hesabi baglar", async () => {
    const setup = createService();

    const student = await setup.service.create(adminContext, {
      firstName: "Hesapli",
      lastName: "Ogrenci",
      guardian: {
        firstName: "Can",
        lastName: "Veli",
        nationalId: "10000000382",
        phone: "5550000013",
        email: "can@example.test",
      },
    });

    const guardians = await setup.guardianStore.list();
    const guardian = guardians.find((record) => record.phone === "5550000013");
    expect(guardian).toMatchObject({
      tenantId: "tenant-a",
      userId: "guardian-user-test",
      nationalIdHash: expect.any(String),
    });
    await expect(setup.guardianStudentStore.listByStudent(student.id)).resolves.toEqual([
      expect.objectContaining({
        guardianId: guardian?.id,
        studentId: student.id,
      }),
    ]);
    expect(setup.provisionedSubjects).toEqual([
      expect.objectContaining({
        tenantId: "tenant-a",
        subjectType: "GUARDIAN",
        subjectId: guardian?.id,
        nationalId: "10000000382",
        phone: "5550000013",
        email: "can@example.test",
      }),
    ]);
    expect(setup.invitations).toEqual([]);
  });
});

function createService() {
  const studentStore = new InMemoryStudentStore();
  const guardianStudentStore = new InMemoryGuardianStudentStore();
  const guardianStore = new InMemoryGuardianStore();
  const invitations: unknown[] = [];
  const auditRecords: unknown[] = [];
  const provisionedSubjects: unknown[] = [];
  const identityInvitations = {
    create: async (_context: RequestContext, body: unknown) => {
      invitations.push(body);
      return { invitation: { id: "identity-invitation-test" }, activationToken: "activation-token-test" };
    },
  };
  const identityProvisioning = {
    provisionTenantSubject: async (input: unknown) => {
      provisionedSubjects.push(input);
      return { userId: "guardian-user-test", initialPassword: "5550000013" };
    },
  };
  const auditLogs = {
    record: async (input: unknown) => {
      auditRecords.push(input);
    },
  };

  return {
    service: new StudentService(
      studentStore,
      guardianStudentStore,
      guardianStore,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      identityInvitations as never,
      auditLogs as never,
      undefined,
      identityProvisioning as never,
    ),
    guardianStore,
    guardianStudentStore,
    invitations,
    auditRecords,
    provisionedSubjects,
  };
}

const adminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  capabilities: ["student:*"],
  bypassRls: false,
};
