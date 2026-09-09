import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import type { SchoolService } from "../school/school.service.js";
import type { StudentService } from "../student/student.service.js";
import type { TeacherService } from "../teacher/teacher.service.js";
import type { TenantService } from "../tenant/tenant.service.js";
import { SetupReadinessService } from "./setup-readiness.service.js";

describe("SetupReadinessService", () => {
  it("tenant-geneli STAFF bağlamında sunucu kayıtlarından READY üretir", async () => {
    const fixtures = createFixtures();
    const service = createService(fixtures);

    await expect(service.read(tenantWideContext())).resolves.toEqual({
      status: "READY",
      completedCount: 9,
      totalCount: 9,
      steps: [
        { key: "institution", count: 1, ready: true, required: true },
        { key: "campus", count: 1, ready: true, required: true },
        { key: "academic-year", count: 1, ready: true, required: true },
        { key: "academic-term", count: 1, ready: true, required: true },
        { key: "grade-level", count: 1, ready: true, required: true },
        { key: "class", count: 1, ready: true, required: true },
        { key: "course", count: 1, ready: true, required: true },
        { key: "teacher", count: 1, ready: true, required: false },
        { key: "student", count: 1, ready: true, required: false },
      ],
    });
  });

  it("öğretmen ve öğrenci olmadan çekirdek kurulumu READY sayar", async () => {
    const fixtures = createFixtures();
    fixtures.teachers.listTeachers.mockResolvedValue([]);
    fixtures.students.list.mockResolvedValue([]);

    await expect(createService(fixtures).read(tenantWideContext())).resolves.toMatchObject({
      status: "READY",
      completedCount: 7,
      totalCount: 9,
      steps: expect.arrayContaining([
        { key: "teacher", count: 0, ready: false, required: false },
        { key: "student", count: 0, ready: false, required: false },
      ]),
    });
  });

  it("kampüs ve seviye bağı olmayan sınıfı veya seviyeye bağlanmayan dersi hazır saymaz", async () => {
    const fixtures = createFixtures();
    fixtures.school.listClasses.mockResolvedValue([{ id: "class-a", tenantId: "tenant-a", name: "8-A" }]);
    fixtures.school.listGradeLevelCourses.mockResolvedValue([]);
    const result = await createService(fixtures).read(tenantWideContext());

    expect(result).toMatchObject({ status: "ACTION_REQUIRED", completedCount: 7, totalCount: 9 });
    expect(result.steps.find((step) => step.key === "class")).toEqual({
      key: "class",
      count: 0,
      ready: false,
      required: true,
    });
    expect(result.steps.find((step) => step.key === "course")).toEqual({
      key: "course",
      count: 0,
      ready: false,
      required: true,
    });
  });

  it("ders bağlantısı sınıfın kullandığı seviyede değilse çekirdek kurulumu hazır saymaz", async () => {
    const fixtures = createFixtures();
    fixtures.school.listGradeLevels.mockResolvedValue([
      { id: "grade-a", tenantId: "tenant-a", name: "8" },
      { id: "grade-b", tenantId: "tenant-a", name: "9" },
    ]);
    fixtures.school.listClasses.mockResolvedValue([{
      id: "class-b",
      tenantId: "tenant-a",
      campusId: "campus-a",
      gradeLevelId: "grade-b",
      name: "9-A",
    }]);
    fixtures.school.listGradeLevelCourses.mockImplementation(async (gradeLevelId: string) => gradeLevelId === "grade-a"
      ? [{
        id: "grade-course-a",
        tenantId: "tenant-a",
        gradeLevelId: "grade-a",
        courseId: "course-a",
        courseName: "Matematik",
        isDefault: true,
        sortOrder: 0,
      }]
      : []);
    const result = await createService(fixtures).read(tenantWideContext());

    expect(result.status).toBe("ACTION_REQUIRED");
    expect(result.steps.find((step) => step.key === "class")?.ready).toBe(false);
    expect(result.steps.find((step) => step.key === "course")?.ready).toBe(false);
  });

  it("sınıf aktif kampüs listesinde olmayan bir kampüse bağlıysa hazır saymaz", async () => {
    const fixtures = createFixtures();
    fixtures.school.listCampuses.mockResolvedValue([{ id: "campus-active", tenantId: "tenant-a", name: "Aktif" }]);
    fixtures.school.listClasses.mockResolvedValue([{
      id: "class-a",
      tenantId: "tenant-a",
      campusId: "campus-deleted",
      gradeLevelId: "grade-a",
      name: "8-A",
    }]);
    const result = await createService(fixtures).read(tenantWideContext());

    expect(result.status).toBe("ACTION_REQUIRED");
    expect(result.steps.find((step) => step.key === "class")?.ready).toBe(false);
    expect(result.steps.find((step) => step.key === "course")?.ready).toBe(false);
  });

  it("aktif dönem eksikse PII taşımadan ACTION_REQUIRED üretir", async () => {
    const fixtures = createFixtures();
    fixtures.school.listAcademicTerms.mockResolvedValue([{ id: "term-a", tenantId: "tenant-a", academicYearId: "year-a", name: "Eski dönem", startsAt: "2025-09-01", endsAt: "2026-01-31", isActive: false }]);
    const result = await createService(fixtures).read(tenantWideContext());

    expect(result).toMatchObject({ status: "ACTION_REQUIRED", completedCount: 8, totalCount: 9 });
    expect(result.steps.find((step) => step.key === "academic-term")).toEqual({
      key: "academic-term",
      count: 0,
      ready: false,
      required: true,
    });
    expect(JSON.stringify(result)).not.toContain("Ada");
    expect(JSON.stringify(result)).not.toContain("100");
  });

  it.each([
    ["kampüs kapsamı", { campusScope: { scopeMode: "CAMPUSES" as const, campusIds: ["campus-a"] } }],
    ["eksik STAFF kapsamı", { campusScope: undefined }],
    ["RLS bypass", { bypassRls: true }],
  ])("%s için hiçbir tenant-geneli kaydı okumadan reddeder", async (_label, override) => {
    const fixtures = createFixtures();
    const service = createService(fixtures);

    await expect(service.read({ ...tenantWideContext(), ...override })).rejects.toMatchObject({ status: 403 });
    expect(fixtures.tenants.findCurrent).not.toHaveBeenCalled();
    expect(fixtures.students.list).not.toHaveBeenCalled();
  });
});

function tenantWideContext(): RequestContext {
  return {
    userId: "admin-a",
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    activePersona: "STAFF",
    capabilities: ["setup:manage"],
    campusScope: { scopeMode: "TENANT", campusIds: [] },
    bypassRls: false,
  };
}

function createFixtures() {
  return {
    tenants: {
      findCurrent: vi.fn().mockResolvedValue({ id: "tenant-a", name: "Kurum A" }),
    },
    school: {
      listCampuses: vi.fn().mockResolvedValue([{ id: "campus-a", tenantId: "tenant-a", name: "Merkez" }]),
      listAcademicYears: vi.fn().mockResolvedValue([{ id: "year-a", tenantId: "tenant-a", name: "2026-2027", startsAt: "2026-09-01", endsAt: "2027-06-30", isActive: true }]),
      listAcademicTerms: vi.fn().mockResolvedValue([{ id: "term-a", tenantId: "tenant-a", academicYearId: "year-a", name: "1. dönem", startsAt: "2026-09-01", endsAt: "2027-01-31", isActive: true }]),
      listGradeLevels: vi.fn().mockResolvedValue([{ id: "grade-a", tenantId: "tenant-a", name: "8" }]),
      listClasses: vi.fn().mockResolvedValue([{
        id: "class-a",
        tenantId: "tenant-a",
        campusId: "campus-a",
        gradeLevelId: "grade-a",
        name: "8-A",
      }]),
      listCourses: vi.fn().mockResolvedValue([{ id: "course-a", tenantId: "tenant-a", name: "Matematik" }]),
      listGradeLevelCourses: vi.fn().mockResolvedValue([{
        id: "grade-course-a",
        tenantId: "tenant-a",
        gradeLevelId: "grade-a",
        courseId: "course-a",
        courseName: "Matematik",
        isDefault: true,
        sortOrder: 0,
      }]),
    },
    teachers: {
      listTeachers: vi.fn().mockResolvedValue([{ id: "teacher-a", tenantId: "tenant-a", firstName: "Ayşe", lastName: "Öğretmen" }]),
    },
    students: {
      list: vi.fn().mockResolvedValue([{ id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "Kaya", studentNo: "100" }]),
    },
  };
}

function createService(fixtures: ReturnType<typeof createFixtures>) {
  return new SetupReadinessService(
    fixtures.tenants as unknown as TenantService,
    fixtures.school as unknown as SchoolService,
    fixtures.teachers as unknown as TeacherService,
    fixtures.students as unknown as StudentService,
  );
}
