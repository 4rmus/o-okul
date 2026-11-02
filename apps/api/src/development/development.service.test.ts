import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { developmentMentorNoteMaxLength } from "@o-okul/shared-types";
import { describe, expect, it } from "vitest";
import { runWithRequestContext, type RequestContext } from "../context/request-context.js";
import { type IdempotencyStartInput, IdempotencyService, InMemoryIdempotencyStore } from "../http/idempotency.js";
import { InMemoryClassStore } from "../school/class-store.js";
import { InMemoryGuardianStudentStore } from "../school/guardian-student-store.js";
import { InMemoryTeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import { InMemoryTeacherStore } from "../school/teacher-store.js";
import { InMemoryStudentStore } from "../student/student-store.js";
import { DevelopmentService } from "./development.service.js";
import { InMemoryDevelopmentStore, PostgresDevelopmentStore } from "./development-store.js";

describe("DevelopmentService", () => {
  it("kriter ve skorlanmis gelisim degerlendirmesi olusturur; gorunurluk verilmezse INTERNAL yazar", async () => {
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
      visibility: "INTERNAL",
      scores: [expect.objectContaining({ criterionId: criterion.id, score: 4 })],
    });
    expect(setup.auditRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "development_assessment.created",
        entityType: "DevelopmentAssessment",
      }),
    ]));
    expect(JSON.stringify(setup.auditRecords)).not.toContain("Dikkat suresi");
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
    await setup.service.createAssessment(teacherContext, {
      studentId: "student-a",
      periodLabel: "2026 Varsayilan",
      scores: [{ criterionId: criterion.id, score: 3 }],
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

  it("aynı kriter iki kez gelirse hiçbir satır yazmadan 400 döner", async () => {
    const setup = createService();
    const criterion = await setup.service.createCriterion(adminContext, { name: "Odak" });

    await expect(setup.service.createAssessment(teacherContext, {
      studentId: "student-a",
      periodLabel: "2026 Kasım",
      scores: [{ criterionId: criterion.id, score: 3 }, { criterionId: criterion.id, score: 4 }],
    })).rejects.toThrow("DEVELOPMENT_SCORE_CRITERION_DUPLICATE");
    expect(await setup.store.listAssessments()).toEqual([]);
  });

  it("mentör notu sınırı aşarsa reddeder, sınırda kabul eder", async () => {
    const setup = createService();
    const criterion = await setup.service.createCriterion(adminContext, { name: "Odak" });
    const input = { studentId: "student-a", periodLabel: "2026 Kasım", scores: [{ criterionId: criterion.id, score: 3 }] };

    await expect(setup.service.createAssessment(teacherContext, {
      ...input,
      mentorNote: "a".repeat(developmentMentorNoteMaxLength + 1),
    })).rejects.toThrow("DEVELOPMENT_MENTOR_NOTE_TOO_LONG");
    expect(await setup.store.listAssessments()).toEqual([]);
    await expect(setup.service.createAssessment(teacherContext, {
      ...input,
      mentorNote: "a".repeat(developmentMentorNoteMaxLength),
    })).resolves.toMatchObject({ visibility: "INTERNAL" });
  });

  it("kayıtlar yalnız eklenir: serviste ve depoda güncelleme ya da silme yolu yoktur", () => {
    const setup = createService();
    const serviceMethods = Object.getOwnPropertyNames(DevelopmentService.prototype);
    const storeMethods = Object.getOwnPropertyNames(InMemoryDevelopmentStore.prototype);
    for (const name of [...serviceMethods, ...storeMethods]) {
      expect(name).not.toMatch(/^(update|delete|remove|edit|patch)/i);
    }
    expect(setup.service).not.toHaveProperty("updateAssessment");
  });
});

describe("DevelopmentService yazma rol matrisi (DEC-20261102-05)", () => {
  it("sınıf öğretmeni ve rehber öğretmen yazar; branş ve sorumlu öğretmen 403 alır", async () => {
    const setup = await createMatrixService();
    const input = { studentId: "student-a", periodLabel: "2026 Kasım", scores: [{ criterionId: setup.criterionId, score: 3 }] };

    await expect(setup.service.createAssessment(teacherContext, input)).resolves.toMatchObject({ teacherId: "teacher-a" });
    await expect(setup.service.createAssessment(teacherSubject(setup.guidanceId), input)).resolves.toMatchObject({ teacherId: setup.guidanceId });
    await expect(setup.service.createAssessment(teacherSubject(setup.branchId), input)).rejects.toThrow("FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE");
    await expect(setup.service.createAssessment(teacherSubject(setup.responsibleId), input)).rejects.toThrow("FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE");
    await expect(setup.service.createAssessment(teacherSubject(setup.expiredId), input)).rejects.toThrow("FORBIDDEN_TEACHER_ASSIGNMENT_SCOPE");
  });

  it("kurum sahibi, kurum yöneticisi ve yardımcı yönetici atamalı öğretmen adına yazar; operasyon çalışanı yazamaz", async () => {
    const setup = await createMatrixService();
    const input = { studentId: "student-a", teacherId: "teacher-a", periodLabel: "2026 Kasım", scores: [{ criterionId: setup.criterionId, score: 3 }] };

    for (const role of ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN"]) {
      await expect(setup.service.createAssessment(staffContext(role), input)).resolves.toMatchObject({ teacherId: "teacher-a", visibility: "INTERNAL" });
    }
    await expect(setup.service.createAssessment(staffContext("OPERATIONS_STAFF"), input)).rejects.toThrow("DEVELOPMENT_ASSESSMENT_WRITER_FORBIDDEN");
    await expect(setup.service.createAssessment(staffContext("FINANCE_STAFF"), input)).rejects.toThrow("DEVELOPMENT_ASSESSMENT_WRITER_FORBIDDEN");
  });

  it("yönetici yalnız öğrencinin sınıfında etkin sınıf ya da rehber ataması olan öğretmeni yazar olarak seçer", async () => {
    const setup = await createMatrixService();
    const base = { studentId: "student-a", periodLabel: "2026 Kasım", scores: [{ criterionId: setup.criterionId, score: 3 }] };

    await expect(setup.service.createAssessment(adminContext, base)).rejects.toThrow("DEVELOPMENT_ASSESSMENT_TEACHER_REQUIRED");
    await expect(setup.service.createAssessment(adminContext, { ...base, teacherId: setup.guidanceId })).resolves.toMatchObject({ teacherId: setup.guidanceId });
    await expect(setup.service.createAssessment(adminContext, { ...base, teacherId: setup.branchId })).rejects.toThrow("DEVELOPMENT_ASSESSMENT_AUTHOR_NOT_ASSIGNED");
    await expect(setup.service.createAssessment(adminContext, { ...base, teacherId: setup.responsibleId })).rejects.toThrow("DEVELOPMENT_ASSESSMENT_AUTHOR_NOT_ASSIGNED");
    await expect(setup.service.createAssessment(adminContext, { ...base, teacherId: setup.expiredId })).rejects.toThrow("DEVELOPMENT_ASSESSMENT_AUTHOR_NOT_ASSIGNED");
    await expect(setup.service.createAssessment(adminContext, { ...base, teacherId: "teacher-b" })).rejects.toThrow("TEACHER_NOT_FOUND");
  });

  it("öğretmenin yazabileceği öğrencileri yalnız sınıf ve rehber atamasından döndürür", async () => {
    const setup = await createMatrixService();

    await expect(setup.service.getAuthoringScope(teacherContext)).resolves.toEqual({ studentIds: ["student-a"] });
    await expect(setup.service.getAuthoringScope(teacherSubject(setup.guidanceId))).resolves.toEqual({ studentIds: ["student-a"] });
    await expect(setup.service.getAuthoringScope(teacherSubject(setup.branchId))).resolves.toEqual({ studentIds: [] });
    await expect(setup.service.getAuthoringScope(teacherSubject(setup.responsibleId))).resolves.toEqual({ studentIds: [] });
    await expect(setup.service.getAuthoringScope(adminContext)).rejects.toThrow("TEACHER_CONTEXT_REQUIRED");
  });
});

describe("DevelopmentService INTERNAL okuma kısıtı (RK-6)", () => {
  it("INTERNAL kaydı yazar, rehber öğretmen ve yöneticiler okur; diğer öğretmen ve operasyon çalışanı okumaz", async () => {
    const setup = await createMatrixService();
    const scores = [{ criterionId: setup.criterionId, score: 3 }];
    const internal = await setup.service.createAssessment(teacherContext, { studentId: "student-a", periodLabel: "İç", scores });
    const shared = await setup.service.createAssessment(teacherContext, { studentId: "student-a", periodLabel: "Veli", visibility: "GUARDIAN", scores });
    const ids = async (context: RequestContext) => (await setup.service.listAssessments(context, "student-a")).map((record) => record.id).sort();

    expect(await ids(teacherContext)).toEqual([internal.id, shared.id].sort());
    expect(await ids(teacherSubject(setup.guidanceId))).toEqual([internal.id, shared.id].sort());
    for (const role of ["TENANT_OWNER", "TENANT_ADMIN", "ASSISTANT_ADMIN"]) {
      expect(await ids(staffContext(role))).toEqual([internal.id, shared.id].sort());
    }
    expect(await ids(teacherSubject(setup.branchId))).toEqual([]);
    expect(await ids(staffContext("OPERATIONS_STAFF"))).toEqual([shared.id]);
  });
});

describe("DevelopmentService idempotency kaydı", () => {
  it("idempotency deposuna mentör notunu yazmaz; tekrar isteği kaydı yeniden okur", async () => {
    const setup = createService();
    const completed: Array<IdempotencyStartInput & { responseBody: unknown }> = [];
    class RecordingIdempotencyStore extends InMemoryIdempotencyStore {
      override async complete(input: IdempotencyStartInput & { responseBody: unknown }): Promise<void> {
        completed.push(input);
        await super.complete(input);
      }
    }
    const service = new DevelopmentService(
      setup.store,
      setup.students,
      setup.teachers,
      new InMemoryTeacherAssignmentStore(),
      setup.guardianStudents,
      undefined,
      new IdempotencyService(new RecordingIdempotencyStore()),
    );
    const criterion = await service.createCriterion(adminContext, { name: "Odak" });
    const input = { studentId: "student-a", periodLabel: "2026 Kasım", mentorNote: "Gizli gözlem notu", scores: [{ criterionId: criterion.id, score: 4 }] };

    const first = await service.createAssessment(teacherContext, input, "development-redaction-key");
    expect(first).toMatchObject({ mentorNote: "Gizli gözlem notu" });
    const stored = completed.find((record) => record.operation === "development.assessment.create");
    expect(stored?.responseBody).toEqual({ assessmentId: first.id });
    expect(JSON.stringify(completed)).not.toContain("Gizli gözlem notu");

    const replay = await service.createAssessment(teacherContext, input, "development-redaction-key");
    expect(replay).toEqual(first);
    expect(await setup.store.listAssessments("student-a")).toHaveLength(1);

    await setup.store.purgeMentorNotesByStudent("tenant-a", "student-a");
    const afterPurge = await service.createAssessment(teacherContext, input, "development-redaction-key");
    expect(afterPurge.id).toBe(first.id);
    expect(afterPurge).not.toHaveProperty("mentorNote");
  });
});

describe("PostgresDevelopmentStore atomik yazma", () => {
  it("bir skor yazılamazsa değerlendirme dahil tüm işlem geri alınır", async () => {
    const statements: string[] = [];
    let scoreInserts = 0;
    const pool = {
      query: async <T>(sql: string): Promise<{ rows: T[] }> => {
        statements.push(sql.trim().split(/\s+/).slice(0, 3).join(" "));
        if (sql.includes(`INSERT INTO "DevelopmentAssessment"`)) {
          return { rows: [{ id: "a-1", tenantId: "tenant-a", studentId: "student-a", teacherId: "teacher-a", termId: null, periodLabel: "P", mentorNote: null, visibility: "INTERNAL", createdAt: new Date() } as T] };
        }
        if (sql.includes(`INSERT INTO "DevelopmentScore"`)) {
          scoreInserts += 1;
          if (scoreInserts === 2) throw new Error("duplicate key value violates unique constraint");
          return { rows: [{ id: "s-1", tenantId: "tenant-a", assessmentId: "a-1", criterionId: "c-1", score: 3 } as T] };
        }
        return { rows: [] };
      },
    };
    const store = new PostgresDevelopmentStore(pool);

    await expect(runWithRequestContext(adminContext, () => store.createAssessmentWithScores(
      { tenantId: "tenant-a", studentId: "student-a", teacherId: "teacher-a", periodLabel: "P", visibility: "INTERNAL" },
      [{ criterionId: "c-1", score: 3 }, { criterionId: "c-2", score: 4 }],
    ))).rejects.toThrow("duplicate key");
    expect(statements[0]).toBe("BEGIN");
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
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

/**
 * teacher-a: CLASS_TEACHER of class-a (demo). Added teachers in tenant-a: a GUIDANCE_COUNSELOR of student-a, a
 * BRANCH_TEACHER of class-a, a RESPONSIBLE_TEACHER of student-a and a CLASS_TEACHER of class-a whose assignment ended.
 */
async function createMatrixService() {
  const store = new InMemoryDevelopmentStore();
  const teachers = new InMemoryTeacherStore();
  const assignments = new InMemoryTeacherAssignmentStore();
  const addTeacher = async (firstName: string) => (await teachers.create({ tenantId: "tenant-a", firstName, lastName: "Ogretmen" })).id;
  const guidanceId = await addTeacher("Rehber");
  const branchId = await addTeacher("Brans");
  const responsibleId = await addTeacher("Sorumlu");
  const expiredId = await addTeacher("Eski");
  await assignments.create({ tenantId: "tenant-a", teacherId: guidanceId, studentId: "student-a", role: "GUIDANCE_COUNSELOR" });
  await assignments.create({ tenantId: "tenant-a", teacherId: branchId, classId: "class-a", courseId: "course-math", role: "BRANCH_TEACHER" });
  await assignments.create({ tenantId: "tenant-a", teacherId: responsibleId, studentId: "student-a", role: "RESPONSIBLE_TEACHER" });
  await assignments.create({ tenantId: "tenant-a", teacherId: expiredId, classId: "class-a", role: "CLASS_TEACHER", endsAt: "2020-06-30" });
  const service = new DevelopmentService(
    store,
    new InMemoryStudentStore(),
    teachers,
    assignments,
    new InMemoryGuardianStudentStore(),
  );
  const criterion = await service.createCriterion(adminContext, { name: "Odak" });
  return { service, store, criterionId: criterion.id, guidanceId, branchId, responsibleId, expiredId };
}

function teacherSubject(teacherId: string): RequestContext {
  return { ...teacherContext, userId: `user-${teacherId}`, subjectId: teacherId };
}

function staffContext(role: string): RequestContext {
  return {
    userId: `user-${role.toLowerCase()}`,
    tenantId: "tenant-a",
    roles: [role],
    bypassRls: false,
    activePersona: "STAFF",
    campusScope: { scopeMode: "TENANT", campusIds: [] },
  };
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
  const students = {
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
  } as never;
  const teachers = {
    findById: async (id: string) => id === "teacher-a"
      ? { id: "teacher-a", tenantId: "tenant-a", firstName: "Ogretmen", lastName: "A", branch: "Matematik" }
      : undefined,
  } as never;
  const guardianStudents = {
    listByStudent: async (studentId: string) => studentId === "student-a"
      ? [{ tenantId: "tenant-a", guardianId: "guardian-a", studentId: "student-a" }]
      : [],
  } as never;
  const service = new DevelopmentService(
    store,
    students,
    teachers,
    new InMemoryTeacherAssignmentStore(),
    guardianStudents,
    {
      record: async (input: unknown) => {
        auditRecords.push(input);
      },
    } as never,
  );
  return { service, auditRecords, store, students, teachers, guardianStudents };
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
