import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryGuardianStore } from "../school/guardian-store.js";
import { InMemoryStudentStore, type StudentStore } from "./student-store.js";
import { InMemoryStudentEnrollmentStore } from "./student-enrollment-store.js";
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

  it("veli TC ve telefonu olsa da e-posta daveti üretir", async () => {
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
      nationalIdHash: expect.any(String),
    });
    expect(guardian?.userId).toBeUndefined();
    await expect(setup.guardianStudentStore.listByStudent(student.id)).resolves.toEqual([
      expect.objectContaining({
        guardianId: guardian?.id,
        studentId: student.id,
      }),
    ]);
    expect(setup.invitations).toEqual([
      expect.objectContaining({
        tenantId: "tenant-a",
        subjectType: "GUARDIAN",
        subjectId: guardian?.id,
        nationalId: "10000000382",
        phone: "5550000013",
        email: "can@example.test",
      }),
    ]);
    expect(setup.provisionedSubjects).toEqual([]);
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

  it("öğrenci silmeyi atomik profil lifecycle sınırına yönlendirir", async () => {
    const setup = createService();

    await expect(setup.service.delete(adminContext, "student-a")).resolves.toBeUndefined();

    expect(setup.lifecycleCalls).toEqual([
      expect.objectContaining({ tenantId: "tenant-a", subjectType: "STUDENT", subjectId: "student-a" }),
    ]);
    await expect(setup.studentStore.findById("student-a")).resolves.toBeUndefined();
    expect(setup.auditRecords).toContainEqual(expect.objectContaining({
      action: "student.deleted",
      diff: expect.objectContaining({
        accountAccessClosed: true,
        roleRemoved: true,
        sessionsClosed: true,
      }),
    }));
  });

  it("aktif öğrenci kotasında yalnız tek açık ACTIVE enrollment bulunan öğrencileri sayar", async () => {
    const setup = createService({ activeStudentLimit: 1 });

    await expect(setup.service.previewQuota(adminContext, 1)).resolves.toEqual({
      limit: 1,
      current: 1,
      incoming: 1,
      wouldExceed: true,
    });
    await expect(setup.service.create(adminContext, {
      firstName: "Kotalı",
      lastName: "Öğrenci",
      classId: "class-a",
    })).rejects.toThrow("ACTIVE_STUDENT_LIMIT_REACHED");
  });

  it("sınıfsız öğrenci açık enrollment oluşmadığı için aktif lisans kotasını tüketmez", async () => {
    const setup = createService({ activeStudentLimit: 1 });
    await expect(setup.service.create(adminContext, {
      firstName: "Planlı",
      lastName: "Öğrenci",
    })).resolves.toMatchObject({ status: "ACTIVE", classId: undefined });
  });

  it("PASSIVE geçişinde kapasiteyi boşaltır ve ACTIVE dönüşünde açık enrollment oluşturur", async () => {
    const setup = createService({ activeStudentLimit: 1 });

    await setup.service.update(adminContext, "student-a", { status: "PASSIVE" });
    await expect(setup.service.previewQuota(adminContext, 1)).resolves.toMatchObject({ current: 0, wouldExceed: false });

    await setup.service.update(adminContext, "student-a", { status: "ACTIVE" });
    await expect(setup.service.previewQuota(adminContext, 1)).resolves.toMatchObject({ current: 1, wouldExceed: true });
    await expect(setup.enrollmentStore.listByStudent("student-a")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "ACTIVE", reason: "REACTIVATED" })]),
    );
  });

  it("ACTIVE öğrenciyi pasifleştirirken portal askısını atomik store geçişine ekler ve PII'siz auditler", async () => {
    const setup = createService();
    const transitions: unknown[] = [];
    const atomicStudentStore = setup.studentStore as InMemoryStudentStore & {
      updateWithEnrollmentTransition: NonNullable<StudentStore["updateWithEnrollmentTransition"]>;
    };
    atomicStudentStore.updateWithEnrollmentTransition = async (id, input, transition) => {
      transitions.push(transition);
      const student = await setup.studentStore.update(id, input);
      return student
        ? {
            student,
            portalAccess: {
              userId: student.userId,
              membershipSuspended: true,
              sessionsRevoked: 2,
              invitationsRevoked: 1,
            },
          }
        : undefined;
    };

    await setup.service.update(adminContext, "student-a", { status: "PASSIVE" });

    expect(transitions).toEqual([
      expect.objectContaining({
        closeActive: expect.objectContaining({ status: "PASSIVE" }),
        suspendPortalAccess: { reason: "STUDENT_STATUS_PASSIVE" },
      }),
    ]);
    expect(setup.auditRecords).toContainEqual(expect.objectContaining({
      action: "student.updated",
      diff: expect.objectContaining({
        portalAccessSuspended: true,
        membershipSuspended: true,
        sessionsRevoked: 2,
        invitationsRevoked: 1,
      }),
    }));
  });
});

function createService(options: { failReportSnapshotPurge?: boolean; activeStudentLimit?: number } = {}) {
  const studentStore = new InMemoryStudentStore();
  const enrollmentStore = new InMemoryStudentEnrollmentStore();
  const guardianStudentStore = new InMemoryGuardianStudentStore();
  const guardianStore = new InMemoryGuardianStore();
  const invitations: unknown[] = [];
  const auditRecords: unknown[] = [];
  const provisionedSubjects: unknown[] = [];
  const reportSnapshotPurgeCalls: Array<{ tenantId: string; studentId: string }> = [];
  const lifecycleCalls: unknown[] = [];
  const identityInvitations = {
    create: async (_context: RequestContext, body: unknown) => {
      invitations.push(body);
      return { invitation: { id: "identity-invitation-test" }, activationToken: "activation-token-test" };
    },
  };
  const identityProvisioning = {
    provisionOrInvite: async (_context: RequestContext, input: { email?: string; nationalId?: string; phone?: string }) => {
      if (input.email) {
        invitations.push(input);
        return { status: "INVITED", invitationId: "identity-invitation-test" };
      }
      return { status: "SKIPPED" };
    },
    deactivateProfile: async (input: { subjectId: string; deletedAt: string }) => {
      lifecycleCalls.push(input);
      const existing = await studentStore.findById(input.subjectId);
      if (!existing) return undefined;
      const userId = existing.userId;
      await studentStore.softDelete(input.subjectId, input.deletedAt);
      return {
        userId,
        roleRemoved: Boolean(userId),
        sessionsClosed: true,
        invitationsRevoked: 0,
      };
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
  const licenseTerms = options.activeStudentLimit === undefined ? undefined : {
    resolveForTenant: async (tenantId: string) => ({
      mirrorParity: true,
      state: "ACTIVE" as const,
      term: {
        id: "license-test",
        tenantId,
        planCode: "PRO",
        startsAt: "2026-01-01T00:00:00.000Z",
        endsAt: "2027-01-01T00:00:00.000Z",
        activeStudentLimit: options.activeStudentLimit!,
      },
    }),
    create: async () => { throw new Error("unexpected"); },
  };

  return {
    service: new StudentService(
      studentStore,
      guardianStudentStore,
      guardianStore,
      {} as never,
      enrollmentStore,
      { listYears: async () => [], listTerms: async () => [] } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      identityInvitations as never,
      reportSnapshots as never,
      auditLogs as never,
      undefined,
      identityProvisioning as never,
      licenseTerms,
    ),
    guardianStore,
    guardianStudentStore,
    invitations,
    auditRecords,
    provisionedSubjects,
    reportSnapshotPurgeCalls,
    lifecycleCalls,
    studentStore,
    enrollmentStore,
  };
}

const adminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  capabilities: ["student:*"],
  bypassRls: false,
};
