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
        { key: "institution", count: 1, ready: true },
        { key: "campus", count: 1, ready: true },
        { key: "academic-year", count: 1, ready: true },
        { key: "academic-term", count: 1, ready: true },
        { key: "grade-level", count: 1, ready: true },
        { key: "class", count: 1, ready: true },
        { key: "course", count: 1, ready: true },
        { key: "teacher", count: 1, ready: true },
        { key: "student", count: 1, ready: true },
      ],
    });
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
      listClasses: vi.fn().mockResolvedValue([{ id: "class-a", tenantId: "tenant-a", name: "8-A" }]),
      listCourses: vi.fn().mockResolvedValue([{ id: "course-a", tenantId: "tenant-a", name: "Matematik" }]),
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
