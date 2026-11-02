import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryClassStore } from "../school/class-store.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryTeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import { InMemoryTeacherStore } from "../school/teacher-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { DevelopmentService } from "./development.service.js";
import { InMemoryDevelopmentStore } from "./development-store.js";

describe("DevelopmentService", () => {
  it("kriter ve skorlanmis gelisim degerlendirmesi olusturur", async () => {
    const setup = createService();

    const criterion = await setup.service.createCriterion(adminContext, {
      name: "Odaklanma",
      scaleMin: 1,
      scaleMax: 5,
    });
    const assessment = await setup.service.createAssessment(teacherContext, {
      studentId: "student-a",
      periodLabel: "2026 Haziran",
      mentorNote: "Dikkat suresi gucleniyor.",
      scores: [{ criterionId: criterion.id, score: 4 }],
    });

    expect(assessment).toMatchObject({
      tenantId: "tenant-a",
      studentId: "student-a",
      teacherId: "teacher-a",
      visibility: "GUARDIAN",
      scores: [expect.objectContaining({ criterionId: criterion.id, score: 4 })],
    });
    expect(setup.auditRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "development_assessment.created",
        entityType: "DevelopmentAssessment",
      }),
    ]));
  });

  it("skor kriter araligi disindaysa reddeder", async () => {
    const setup = createService();
    const criterion = await setup.service.createCriterion(adminContext, {
      name: "Sorumluluk",
      scaleMin: 1,
      scaleMax: 3,
    });

    await expect(setup.service.createAssessment(teacherContext, {
      studentId: "student-a",
      periodLabel: "2026 Haziran",
      scores: [{ criterionId: criterion.id, score: 5 }],
    })).rejects.toThrow(BadRequestException);
    expect(await setup.store.listAssessments("student-a")).toEqual([]);
  });

  it("ogrenci ve veli gorunumunde sadece GUARDIAN gorunurlukteki degerlendirmeleri dondurur", async () => {
    const setup = createService();
    const criterion = await setup.service.createCriterion(adminContext, {
      name: "Odak",
      scaleMin: 1,
      scaleMax: 5,
    });
    await setup.service.createAssessment(teacherContext, {
      studentId: "student-a",
      periodLabel: "2026 Haziran",
      visibility: "GUARDIAN",
      scores: [{ criterionId: criterion.id, score: 4 }],
    });
    await setup.service.createAssessment(teacherContext, {
      studentId: "student-a",
      periodLabel: "2026 Ic Not",
      visibility: "INTERNAL",
      scores: [{ criterionId: criterion.id, score: 2 }],
    });

    const studentTrend = await setup.service.listCurrentStudent(studentContext);
    expect(studentTrend).toEqual([
      expect.objectContaining({
        periodLabel: "2026 Haziran",
        visibility: "GUARDIAN",
        scores: [
          expect.objectContaining({
            criterionName: "Odak",
            score: 4,
            scaleMin: 1,
            scaleMax: 5,
          }),
        ],
      }),
    ]);
    expect(studentTrend[0]).not.toHaveProperty("tenantId");
    expect(studentTrend[0]).not.toHaveProperty("studentId");
    expect(studentTrend[0]).not.toHaveProperty("teacherId");

    const guardianTrend = await setup.service.listCurrentGuardianStudent(guardianContext, "student-a");
    expect(guardianTrend).toEqual([
      expect.objectContaining({
        periodLabel: "2026 Haziran",
        visibility: "GUARDIAN",
        scores: [
          expect.objectContaining({
            criterionName: "Odak",
            score: 4,
            scaleMin: 1,
            scaleMax: 5,
          }),
        ],
      }),
    ]);
    expect(guardianTrend[0]).not.toHaveProperty("tenantId");
    expect(guardianTrend[0]).not.toHaveProperty("studentId");
    expect(guardianTrend[0]).not.toHaveProperty("teacherId");
  });

  it("veli bağlı olmayan veya başka tenant öğrencinin gelişim trendini okuyamaz", async () => {
    const setup = createService();

    await expect(setup.service.listCurrentGuardianStudent(guardianContext, "student-unlinked")).rejects.toThrow(ForbiddenException);
    await expect(setup.service.listCurrentGuardianStudent(guardianContext, "student-b")).rejects.toThrow(ForbiddenException);
  });
});

describe("DevelopmentService kampüs kapsamı", () => {
  it("başka kampüs öğrencisinin değerlendirmesini listelemez, yenisini reddeder; kurum geneli okuma değişmez", async () => {
    const service = createCampusService(new InMemoryClassStore());
    const criterion = await service.createCriterion(adminContext, { name: "Odak" });
    const input = { studentId: "student-a", teacherId: "teacher-a", periodLabel: "2026 Kasım", scores: [{ criterionId: criterion.id, score: 3 }] };
    const assessment = await service.createAssessment(adminContext, input);

    expect((await service.listAssessments(adminContext)).map((record) => record.id)).toEqual([assessment.id]);
    expect((await service.listAssessments(campusContext("campus-main"))).map((record) => record.id)).toEqual([assessment.id]);
    await expect(service.listAssessments(campusContext("campus-other"))).resolves.toEqual([]);
    await expect(service.listAssessments(campusContext("campus-other"), "student-a")).resolves.toEqual([]);
    await expect(service.createAssessment(campusContext("campus-other"), input)).rejects.toThrow("DEVELOPMENT_CAMPUS_SCOPE_FORBIDDEN");
    await expect(service.createAssessment(campusContext("campus-main"), input)).resolves.toMatchObject({ studentId: "student-a" });
  });

  it("sınıf bilgisi çözülemeyen kayıtta kampüs kapsamlı kullanıcı için fail-closed davranır", async () => {
    const service = createCampusService(undefined);
    const criterion = await service.createCriterion(adminContext, { name: "Odak" });
    await service.createAssessment(adminContext, {
      studentId: "student-a",
      teacherId: "teacher-a",
      periodLabel: "2026 Kasım",
      scores: [{ criterionId: criterion.id, score: 3 }],
    });

    await expect(service.listAssessments(campusContext("campus-main"))).resolves.toEqual([]);
    await expect(service.listAssessments(adminContext)).resolves.toHaveLength(1);
    await expect(service.listAssessments({ ...adminContext, roles: ["OPERATIONS_STAFF"] })).rejects.toThrow("DEVELOPMENT_CAMPUS_SCOPE_MISSING");
  });
});

function createCampusService(classStore: InMemoryClassStore | undefined) {
  return new DevelopmentService(
    new InMemoryDevelopmentStore(),
    new InMemoryStudentStore(),
    new InMemoryTeacherStore(),
    new InMemoryTeacherAssignmentStore(),
    new InMemoryGuardianStudentStore(),
    undefined,
    undefined,
    classStore,
  );
}

function campusContext(campusId: string): RequestContext {
  return {
    userId: "assistant-tenant-a",
    tenantId: "tenant-a",
    roles: ["ASSISTANT_ADMIN"],
    bypassRls: false,
    campusScope: { scopeMode: "CAMPUSES", campusIds: [campusId] },
  };
}

function createService() {
  const auditRecords: unknown[] = [];
  const store = new InMemoryDevelopmentStore();
  const service = new DevelopmentService(
    store,
    {
      findById: async (id: string) => {
        if (id === "student-a") {
          return { id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "A", classId: "class-a", status: "ACTIVE" };
        }
        if (id === "student-unlinked") {
          return { id: "student-unlinked", tenantId: "tenant-a", firstName: "Unlinked", lastName: "A", status: "ACTIVE" };
        }
        if (id === "student-b") {
          return { id: "student-b", tenantId: "tenant-b", firstName: "Bora", lastName: "B", status: "ACTIVE" };
        }
        return undefined;
      },
    } as never,
    {
      findById: async (id: string) => id === "teacher-a"
        ? { id: "teacher-a", tenantId: "tenant-a", firstName: "Ogretmen", lastName: "A", branch: "Matematik" }
        : undefined,
    } as never,
    new InMemoryTeacherAssignmentStore(),
    {
      listByStudent: async (studentId: string) => studentId === "student-a"
        ? [{ tenantId: "tenant-a", guardianId: "guardian-a", studentId: "student-a" }]
        : [],
    } as never,
    {
      record: async (input: unknown) => {
        auditRecords.push(input);
      },
    } as never,
  );
  return { service, auditRecords, store };
}

const adminContext: RequestContext = {
  userId: "user-tenant-a",
  tenantId: "tenant-a",
  roles: ["TENANT_ADMIN"],
  bypassRls: false,
};

const teacherContext: RequestContext = {
  userId: "teacher-tenant-a",
  tenantId: "tenant-a",
  roles: ["TEACHER"],
  bypassRls: false,
  subjectType: "TEACHER",
  subjectId: "teacher-a",
};

const studentContext: RequestContext = {
  userId: "student-tenant-a",
  tenantId: "tenant-a",
  roles: ["STUDENT"],
  bypassRls: false,
  subjectType: "STUDENT",
  subjectId: "student-a",
};

const guardianContext: RequestContext = {
  userId: "guardian-tenant-a",
  tenantId: "tenant-a",
  roles: ["GUARDIAN"],
  bypassRls: false,
  subjectType: "GUARDIAN",
  subjectId: "guardian-a",
};
