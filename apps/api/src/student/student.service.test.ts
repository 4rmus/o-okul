import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryGuardianStore } from "../school/guardian-store.js";
import { InMemoryStudentStore } from "./student-store.js";
import { StudentService } from "./student.service.js";
import { hashTcIdentity, normalizeTcIdentity } from "./tc-identity.js";

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

  it("TC eslesirse mevcut veliyi telefon farkli olsa da yeniden kullanir", async () => {
    const setup = createService();
    const nationalId = "10000001372";
    const existingGuardian = await setup.guardianStore.create({
      tenantId: "tenant-a",
      firstName: "Tc",
      lastName: "Veli",
      phone: "5000000099",
      nationalIdHash: hashTcIdentity(normalizeTcIdentity(nationalId)),
    });

    const student = await setup.service.create(adminContext, {
      firstName: "Tc",
      lastName: "Ogrenci",
      guardian: {
        nationalId,
        phone: "0 500 000 00 98",
      },
    });

    await expect(setup.guardianStudentStore.listByStudent(student.id)).resolves.toEqual([
      expect.objectContaining({
        guardianId: existingGuardian.id,
        studentId: student.id,
      }),
    ]);
    await expect(setup.guardianStore.findById(existingGuardian.id)).resolves.toMatchObject({
      phone: "5000000099",
      nationalIdEncrypted: expect.any(String),
    });
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

  it("öğrenci PII temizliğinde önce report snapshot kimliğini temizler ve yalnız sayım auditler", async () => {
    const setup = createService();

    await expect(setup.service.purgePii(adminContext, "student-a")).resolves.toMatchObject({
      firstName: "Anonim",
      lastName: "Ogrenci",
    });

    expect(setup.reportSnapshotPurgeCalls).toEqual([{ tenantId: "tenant-a", studentId: "student-a" }]);
    expect(setup.auditRecords).toContainEqual(expect.objectContaining({
      action: "kvkk.student_pii_purged",
      diff: {
        fieldsPurged: [
          "firstName",
          "lastName",
          "nationalIdEncrypted",
          "nationalIdHash",
          "phone",
          "email",
          "photoKey",
          "ReportSnapshot.displayName",
          "ReportSnapshot.studentNo",
        ],
        reportSnapshotPurgeCount: 2,
      },
    }));
  });

  it("report snapshot kimliği temizlenemezse öğrenci PII temizliğini fail-closed durdurur", async () => {
    const setup = createService({ failReportSnapshotPurge: true });

    await expect(setup.service.purgePii(adminContext, "student-a")).rejects.toThrow("REPORT_SNAPSHOT_PURGE_FAILED");
    await expect(setup.studentStore.findById("student-a")).resolves.toMatchObject({
      firstName: "Ada",
      lastName: "A",
    });
    expect(setup.auditRecords).toEqual([]);
  });
});

function createService(options: { failReportSnapshotPurge?: boolean } = {}) {
  const studentStore = new InMemoryStudentStore();
  const guardianStudentStore = new InMemoryGuardianStudentStore();
  const guardianStore = new InMemoryGuardianStore();
  const invitations: unknown[] = [];
  const auditRecords: unknown[] = [];
  const provisionedSubjects: unknown[] = [];
  const reportSnapshotPurgeCalls: Array<{ tenantId: string; studentId: string }> = [];
  const identityInvitations = {
    create: async (_context: RequestContext, body: unknown) => {
      invitations.push(body);
      return { invitation: { id: "identity-invitation-test" }, activationToken: "activation-token-test" };
    },
  };
  const identityProvisioning = {
    provisionOrInvite: async (_context: RequestContext, input: { email?: string; nationalId?: string; phone?: string }) => {
      if (input.nationalId && input.phone) {
        provisionedSubjects.push(input);
        return { status: "PROVISIONED", userId: "guardian-user-test", initialPassword: "5550000013" };
      }
      if (input.email) {
        invitations.push(input);
        return { status: "INVITED", invitationId: "identity-invitation-test" };
      }
      return { status: "SKIPPED" };
    },
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
  const reportSnapshots = {
    purgeStudentIdentity: async (tenantId: string, studentId: string) => {
      reportSnapshotPurgeCalls.push({ tenantId, studentId });
      if (options.failReportSnapshotPurge) throw new Error("REPORT_SNAPSHOT_PURGE_FAILED");
      return 2;
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
      identityInvitations as never,
      reportSnapshots as never,
      auditLogs as never,
      undefined,
      identityProvisioning as never,
    ),
    guardianStore,
    guardianStudentStore,
    invitations,
    auditRecords,
    provisionedSubjects,
    reportSnapshotPurgeCalls,
    studentStore,
  };
}

const adminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  capabilities: ["student:*"],
  bypassRls: false,
};
