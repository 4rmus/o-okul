import { describe, expect, it, vi } from "vitest";
import { MeSetupReadinessService, buildSetupReadiness } from "./me-setup-readiness.service.js";

describe("MeSetupReadinessService", () => {
  it("yedi bounded listeyi tenant context ile birer kez sayar", async () => {
    const school = {
      listCampuses: vi.fn().mockResolvedValue([{}]),
      listGradeLevels: vi.fn().mockResolvedValue([{}, {}]),
      listClasses: vi.fn().mockResolvedValue([]),
      listCourses: vi.fn().mockResolvedValue([{}]),
      listLearningOutcomes: vi.fn().mockResolvedValue([]),
    };
    const students = { listForViewer: vi.fn().mockResolvedValue([{}]) };
    const teachers = { listTeachers: vi.fn().mockResolvedValue([]) };
    const context = { tenantId: "tenant-a", roles: ["TENANT_ADMIN"], userId: "admin-a" };
    const service = new MeSetupReadinessService(school as never, students as never, teachers as never);

    await expect(service.get(context as never)).resolves.toEqual(buildSetupReadiness([1, 2, 0, 1, 0, 1, 0]));
    for (const method of [...Object.values(school), students.listForViewer, teachers.listTeachers]) {
      expect(method).toHaveBeenCalledOnce();
      expect(method).toHaveBeenCalledWith(context);
    }
  });

  it("boş ve tamamlanmış adımları deterministik yüzdeye çevirir", () => {
    expect(buildSetupReadiness([1, 1, 1, 1, 1, 1, 1])).toMatchObject({ completedCount: 7, percent: 100, totalCount: 7 });
    expect(buildSetupReadiness([])).toMatchObject({ completedCount: 0, percent: 0, totalCount: 7 });
  });

  it("kampüs-kapsamlı operasyon kullanıcısını tenant özetinden fail-closed reddeder", async () => {
    const school = {
      listCampuses: vi.fn(),
      listGradeLevels: vi.fn(),
      listClasses: vi.fn(),
      listCourses: vi.fn(),
      listLearningOutcomes: vi.fn(),
    };
    const students = { listForViewer: vi.fn() };
    const teachers = { listTeachers: vi.fn() };
    const service = new MeSetupReadinessService(school as never, students as never, teachers as never);

    await expect(service.get({
      tenantId: "tenant-a",
      roles: ["OPERATIONS_STAFF"],
      userId: "operations-a",
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
    } as never)).rejects.toMatchObject({ message: "SETUP_TENANT_SCOPE_REQUIRED" });
    expect(school.listCampuses).not.toHaveBeenCalled();
    expect(students.listForViewer).not.toHaveBeenCalled();
    expect(teachers.listTeachers).not.toHaveBeenCalled();
  });
});
