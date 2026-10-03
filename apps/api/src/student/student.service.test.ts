import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService, InMemoryIdempotencyStore } from "../http/idempotency.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryGuardianStore } from "../school/guardian-store.js";
import { InMemoryClassStore } from "../school/class-store.js";
import { InMemoryGradeLevelStore } from "../school/grade-level-store.js";
import { InMemoryStudentStore, type StudentStore } from "./student-store.js";
import { InMemoryStudentEnrollmentStore } from "./student-enrollment-store.js";
import { InMemoryStudentContactStore } from "./student-contact-store.js";
import { StudentService } from "./student.service.js";
import { hashTcIdentity, normalizeTcIdentity } from "./tc-identity.js";

describe("StudentService", () => {
  it("toplu kayıtta iletişim kişisi yazar, veli hesabı veya davet üretmez", async () => {
    const setup = createService();
    const guardiansBefore = await setup.guardianStore.list();

    const students = await setup.service.createMany(adminContext, [{
      firstName: "Ada",
      lastName: "Kaya",
      gradeLevelId: "grade-8",
      nationalId: "10000000146",
      phone: "5551234567",
      contact: {
        firstName: "FATMA",
        lastName: "KAYA",
        relationType: "LEGAL_GUARDIAN",
        phone: "5557654321",
        canReceiveSms: false,
        canReceiveAnnouncements: false,
        canReceiveFinance: false,
      },
    }]);

    expect(students).toHaveLength(1);
    expect(setup.provisionOrInvite).not.toHaveBeenCalled();
    await expect(setup.guardianStore.list()).resolves.toEqual(guardiansBefore);
    await expect(setup.guardianStudentStore.listByStudent(students[0]!.id)).resolves.toEqual([]);
    await expect(setup.studentContactStore.listByStudent("tenant-a", students[0]!.id)).resolves.toEqual([
      expect.objectContaining({ relationType: "LEGAL_GUARDIAN", canReceiveSms: false }),
    ]);
  });

  it("öğrenci TC kimlik ve telefon alanlarını birbirinden bağımsız saklar", async () => {
    const setup = createService();

    const tcStudent = await setup.service.create(adminContext, {
      firstName: "Tc",
      lastName: "Ogrenci",
      gradeLevelId: "grade-8",
      nationalId: "10000000146",
    });
    const phoneStudent = await setup.service.create(adminContext, {
      firstName: "Telefon",
      lastName: "Ogrenci",
      gradeLevelId: "grade-8",
      phone: "5551234567",
    });

    const tcProfile = await setup.studentStore.findProfileById(tcStudent.id);
    expect(tcProfile).toMatchObject({ nationalIdHash: hashTcIdentity("10000000146") });
    expect(tcProfile).not.toHaveProperty("phone");

    const phoneProfile = await setup.studentStore.findProfileById(phoneStudent.id);
    expect(phoneProfile).toMatchObject({ phone: "5551234567" });
    expect(phoneProfile).not.toHaveProperty("nationalIdHash");
  });

  it("öğrenci PII temizliğinde önce report snapshot kimliğini temizler ve yalnız sayım auditler", async () => {
    const setup = createService();
    await setup.studentContactStore.create({
      tenantId: "tenant-a",
      studentId: "student-a",
      firstName: "Fatma",
      lastName: "Veli",
      relationType: "MOTHER",
      phoneEncrypted: "encrypted-phone",
      phoneHash: "phone-hash",
      emailEncrypted: "encrypted-email",
      emailHash: "email-hash",
      canReceiveSms: false,
      canReceiveAnnouncements: false,
      canReceiveFinance: false,
    });

    await expect(setup.service.purgePii(adminContext, "student-a")).resolves.toMatchObject({
      firstName: "Anonim",
      lastName: "Ogrenci",
    });

    expect(setup.reportSnapshotPurgeCalls).toEqual([{ tenantId: "tenant-a", studentId: "student-a" }]);
    await expect(setup.studentContactStore.listByStudent("tenant-a", "student-a")).resolves.toEqual([]);
    expect(setup.auditRecords).toContainEqual(expect.objectContaining({
      action: "kvkk.student_contact_pii_purged",
      diff: { studentId: "student-a", recordCount: 1 },
    }));
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
          "StudentContact.firstName",
          "StudentContact.lastName",
          "StudentContact.relationType",
          "StudentContact.phoneEncrypted",
          "StudentContact.phoneHash",
          "StudentContact.emailEncrypted",
          "StudentContact.emailHash",
          "StudentContact.canReceiveSms",
          "StudentContact.canReceiveAnnouncements",
          "StudentContact.canReceiveFinance",
          "StudentContact.consentSource",
          "StudentContact.consentRecordedAt",
        ],
        reportSnapshotPurgeCount: 2,
        studentContactPurgeCount: 1,
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

  it("seviye zorunluluğunu ve sınıf-seviye uyumunu fail-closed doğrular", async () => {
    const setup = createService();

    await expect(setup.service.create(adminContext, {
      firstName: "Seviyesiz",
      lastName: "Öğrenci",
    })).rejects.toThrow("STUDENT_GRADE_LEVEL_REQUIRED");
    await expect(setup.service.create(adminContext, {
      firstName: "Uyumsuz",
      lastName: "Öğrenci",
      gradeLevelId: "grade-7",
      classId: "class-a",
    })).rejects.toThrow("STUDENT_CLASS_GRADE_LEVEL_MISMATCH");
    await expect(setup.service.create(adminContext, {
      firstName: "Başka",
      lastName: "Tenant",
      gradeLevelId: "grade-7",
    })).rejects.toThrow();
  });

  it("yalnız sınıf değiştiğinde yeni seviyeyi sınıftan türetir", async () => {
    const setup = createService();
    const gradeLevel = await setup.gradeLevelStore.create({ tenantId: "tenant-a", name: "9. Sınıf", code: "9" });
    const schoolClass = await setup.classStore.create({
      tenantId: "tenant-a",
      name: "9-A",
      gradeLevelId: gradeLevel.id,
    });

    await expect(setup.service.update(adminContext, "student-a", { classId: schoolClass.id })).resolves.toMatchObject({
      gradeLevelId: gradeLevel.id,
      classId: schoolClass.id,
    });
    await expect(setup.enrollmentStore.listByStudent("student-a")).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ gradeLevelId: gradeLevel.id, classId: schoolClass.id, reason: "CLASS_CHANGED" }),
    ]));
  });

  it("sınıfı boşaltırken güncelleme ve yenilemede öğrenci ile açık enrollmentı birlikte sınıfsız yapar", async () => {
    const updateSetup = createService();
    const updated = await updateSetup.service.update(adminContext, "student-a", { classId: "" });
    const updatedEnrollments = await updateSetup.enrollmentStore.listByStudent("student-a");

    expect(updated.classId).toBeUndefined();
    expect(updatedEnrollments.find((enrollment) => !enrollment.endsAt)).toMatchObject({
      gradeLevelId: "grade-8",
      classId: undefined,
      reason: "CLASS_CHANGED",
    });

    const renewalSetup = createService();
    const renewed = await renewalSetup.service.renewEnrollment(adminContext, "student-a", {
      gradeLevelId: "grade-8",
      classId: "",
      startsAt: "2026-06-02",
    });

    expect(renewed.classId).toBeUndefined();
    expect((await renewalSetup.studentStore.findById("student-a"))?.classId).toBeUndefined();
  });

  it("toplu yenilemeyi ara hata sonrası aynı idempotency anahtarıyla kaldığı yerden sürdürür", async () => {
    const setup = createService({ idempotency: new IdempotencyService(new InMemoryIdempotencyStore()) });
    const gradeLevel9 = await setup.gradeLevelStore.create({ tenantId: "tenant-a", name: "9. Sınıf", code: "9" });
    const gradeLevel10 = await setup.gradeLevelStore.create({ tenantId: "tenant-a", name: "10. Sınıf", code: "10" });
    const class9 = await setup.classStore.create({
      tenantId: "tenant-a",
      name: "9-A",
      campusId: "campus-main",
      gradeLevelId: gradeLevel9.id,
      section: "A",
    });
    await setup.classStore.create({
      tenantId: "tenant-a",
      name: "10-A",
      campusId: "campus-main",
      gradeLevelId: gradeLevel10.id,
      section: "A",
    });
    const secondStudent = await setup.service.create(adminContext, {
      firstName: "İkinci",
      lastName: "Öğrenci",
      gradeLevelId: "grade-8",
      classId: "class-a",
    });
    const updateStudent = setup.studentStore.update.bind(setup.studentStore);
    let failSecondStudentOnce = true;
    setup.studentStore.update = async (id, input) => {
      if (id === secondStudent.id && failSecondStudentOnce) {
        failSecondStudentOnce = false;
        throw new Error("SECOND_STUDENT_UPDATE_FAILED");
      }
      return updateStudent(id, input);
    };
    const input = {
      studentIds: ["student-a", secondStudent.id],
      useAutomaticClassMapping: true,
      startsAt: "2026-06-03",
    };

    await expect(setup.service.bulkRenewEnrollments(adminContext, input, "bulk-retry-test"))
      .rejects.toThrow("SECOND_STUDENT_UPDATE_FAILED");
    await expect(setup.service.bulkRenewEnrollments(adminContext, input, "bulk-retry-test"))
      .resolves.toMatchObject({ updatedCount: 2 });

    const firstRenewals = (await setup.enrollmentStore.listByStudent("student-a"))
      .filter((enrollment) => enrollment.reason === "RENEWED" && enrollment.startsAt === input.startsAt);
    const secondRenewals = (await setup.enrollmentStore.listByStudent(secondStudent.id))
      .filter((enrollment) => enrollment.reason === "RENEWED" && enrollment.startsAt === input.startsAt);
    const renewalAudits = setup.auditRecords.filter((record) =>
      (record as { action?: string }).action === "student.enrollment_renewed");

    expect(firstRenewals).toHaveLength(1);
    expect(secondRenewals).toHaveLength(1);
    expect(renewalAudits).toHaveLength(2);
    expect((await setup.studentStore.findById("student-a"))?.classId).toBe(class9.id);
    expect((await setup.studentStore.findById(secondStudent.id))?.classId).toBe(class9.id);
  });

  it("sınıfsız seviyeli öğrenci açık enrollment oluşturarak aktif lisans kotasını tüketir", async () => {
    const setup = createService({ activeStudentLimit: 2 });
    const student = await setup.service.create(adminContext, {
      firstName: "Planlı",
      lastName: "Öğrenci",
      gradeLevelId: "grade-8",
    });

    expect(student).toMatchObject({ status: "ACTIVE", gradeLevelId: "grade-8", classId: undefined });
    await expect(setup.enrollmentStore.listByStudent(student.id)).resolves.toEqual([
      expect.objectContaining({ status: "ACTIVE", gradeLevelId: "grade-8", classId: undefined }),
    ]);
    await expect(setup.service.previewQuota(adminContext, 1)).resolves.toMatchObject({ current: 2, wouldExceed: true });
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

  it("kampüs kapsamlı operasyon çalışanına yalnız izinli kampüs öğrencilerini gösterir", async () => {
    const setup = createService();
    const secondaryClass = await setup.classStore.create({
      tenantId: "tenant-a",
      name: "8-B",
      campusId: "campus-secondary",
    });
    const secondaryStudent = await setup.studentStore.create({
      tenantId: "tenant-a",
      firstName: "Bora",
      lastName: "B",
      classId: secondaryClass.id,
      status: "ACTIVE",
    });

    await expect(setup.service.list(campusOperationsContext)).resolves.toEqual([
      expect.objectContaining({ id: "student-a", classId: "class-a" }),
    ]);
    await expect(setup.service.findOneForViewer(campusOperationsContext, "student-a"))
      .resolves.toMatchObject({ id: "student-a", classId: "class-a" });
    await expect(setup.service.findOne(campusOperationsContext, secondaryStudent.id))
      .rejects.toThrow("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
    await expect(setup.service.update(campusOperationsContext, secondaryStudent.id, { firstName: "Yetkisiz" }))
      .rejects.toThrow("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
    await expect(setup.service.list(adminContext)).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "student-a" }),
      expect.objectContaining({ id: secondaryStudent.id }),
    ]));
  });

  it("kampüs kapsamlı operasyon çalışanının kapsam dışı veya sınıfsız öğrenci oluşturmasını reddeder", async () => {
    const setup = createService();
    const secondaryClass = await setup.classStore.create({
      tenantId: "tenant-a",
      name: "8-B",
      campusId: "campus-secondary",
    });

    await expect(setup.service.create(campusOperationsContext, {
      firstName: "Kapsam",
      lastName: "Dışı",
      classId: secondaryClass.id,
    })).rejects.toThrow("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
    await expect(setup.service.create(campusOperationsContext, {
      firstName: "Sınıfsız",
      lastName: "Kayıt",
    })).rejects.toThrow("STUDENT_CAMPUS_SCOPE_FORBIDDEN");
  });

  it("operasyon çalışanında kampüs scope yoksa fail-closed davranır", async () => {
    const setup = createService();

    await expect(setup.service.list({
      ...campusOperationsContext,
      campusScope: undefined,
    })).rejects.toThrow("STUDENT_CAMPUS_SCOPE_MISSING");
  });

  it("öğrenci ve veli subject context'i tenant-genel öğrenci listesini alamaz", async () => {
    const setup = createService();

    await expect(setup.service.list({
      ...adminContext,
      roles: ["STUDENT"],
      subjectType: "STUDENT",
      subjectId: "student-a",
    })).rejects.toThrow("STUDENT_LIST_SCOPE_FORBIDDEN");
    await expect(setup.service.list({
      ...adminContext,
      roles: ["GUARDIAN"],
      subjectType: "GUARDIAN",
      subjectId: "guardian-a",
    })).rejects.toThrow("STUDENT_LIST_SCOPE_FORBIDDEN");
  });

  it("portal erişim listesini izinli kampüs öğrenci kimlikleriyle sınırlar", async () => {
    const setup = createService();
    const secondaryClass = await setup.classStore.create({
      tenantId: "tenant-a",
      name: "8-B",
      campusId: "campus-secondary",
    });
    await setup.studentStore.create({
      tenantId: "tenant-a",
      firstName: "Bora",
      lastName: "B",
      classId: secondaryClass.id,
      status: "ACTIVE",
    });

    await expect(setup.service.listPortalAccess(campusOperationsContext, {
      direction: "next",
      limit: 20,
    })).resolves.toEqual([
      expect.objectContaining({ studentId: "student-a" }),
    ]);
  });
});

function createService(options: {
  failReportSnapshotPurge?: boolean;
  activeStudentLimit?: number;
  idempotency?: IdempotencyService;
} = {}) {
  const studentStore = new InMemoryStudentStore();
  const enrollmentStore = new InMemoryStudentEnrollmentStore();
  const classStore = new InMemoryClassStore();
  const gradeLevelStore = new InMemoryGradeLevelStore();
  const guardianStudentStore = new InMemoryGuardianStudentStore();
  const guardianStore = new InMemoryGuardianStore();
  const studentContactStore = new InMemoryStudentContactStore();
  const invitations: unknown[] = [];
  const auditRecords: unknown[] = [];
  const provisionedSubjects: unknown[] = [];
  const reportSnapshotPurgeCalls: Array<{ tenantId: string; studentId: string }> = [];
  const lifecycleCalls: unknown[] = [];
  const provisionOrInvite = vi.fn(async (_context: RequestContext, input: { email?: string; nationalId?: string; phone?: string }) => {
      if (input.email) {
        invitations.push(input);
        return { status: "INVITED", invitationId: "identity-invitation-test" };
      }
      return { status: "SKIPPED" };
    });
  const identityProvisioning = {
    provisionOrInvite,
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
      {} as never,
      enrollmentStore,
      { listYears: async () => [], listTerms: async () => [] } as never,
      {} as never,
      classStore,
      gradeLevelStore,
      {} as never,
      reportSnapshots as never,
      auditLogs as never,
      options.idempotency,
      identityProvisioning as never,
      licenseTerms,
      undefined,
      studentContactStore,
    ),
    guardianStore,
    guardianStudentStore,
    provisionOrInvite,
    invitations,
    auditRecords,
    provisionedSubjects,
    reportSnapshotPurgeCalls,
    lifecycleCalls,
    studentStore,
    enrollmentStore,
    classStore,
    gradeLevelStore,
    studentContactStore,
  };
}

const adminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  capabilities: ["student:*"],
  bypassRls: false,
};

const campusOperationsContext: RequestContext = {
  userId: "user-operations-a",
  tenantId: "tenant-a",
  roles: ["OPERATIONS_STAFF"],
  capabilities: ["student:*"],
  campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
  bypassRls: false,
};
