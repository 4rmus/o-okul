import { BadRequestException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { InMemoryTeacherAssignmentStore } from "../school/teacher-assignment-store.js";
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
});

function createService() {
  const auditRecords: unknown[] = [];
  const service = new DevelopmentService(
    new InMemoryDevelopmentStore(),
    {
      findById: async (id: string) => id === "student-a"
        ? { id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "A", classId: "class-a", status: "ACTIVE" }
        : undefined,
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
  return { service, auditRecords };
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
