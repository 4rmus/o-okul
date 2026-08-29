import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import type { CourseStore } from "../school/course-store.js";
import type { SchoolService } from "../school/school.service.js";
import type { TeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import type { TeacherStore } from "../school/teacher-store.js";
import { TeacherImportService } from "./teacher-import.service.js";
import type { TeacherService } from "./teacher.service.js";

const context: RequestContext = {
  userId: "operations-a",
  tenantId: "tenant-a",
  roles: ["OPERATIONS_STAFF"],
  activePersona: "STAFF",
  campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
  bypassRls: false,
};

describe("TeacherImportService class matching", () => {
  it("özel sınıf adını SchoolService kampüs kapsamı içinden eşleştirir", async () => {
    const school = {
      listClasses: vi.fn(async () => [
        { id: "class-custom", tenantId: "tenant-a", campusId: "campus-main", name: "Bilim Atölyesi" },
      ]),
    };
    const service = new TeacherImportService(
      {} as TeacherService,
      school as unknown as SchoolService,
      { list: vi.fn(async () => []) } as unknown as CourseStore,
      {} as TeacherStore,
      {} as TeacherAssignmentStore,
    );

    await expect(service.dryRun(context, {
      fileBase64: csv("ad;soyad;atanacak_sinif\nMerve;Import; bİLİMAtölyesi "),
    })).resolves.toMatchObject({
      errors: [],
      validRows: [expect.objectContaining({ classId: "class-custom", className: "bİLİMAtölyesi" })],
      wouldImport: true,
    });
    expect(school.listClasses).toHaveBeenCalledWith(context);
  });

  it("SchoolService kapsam dışında bıraktığı özel sınıf adını eşleştirmez", async () => {
    const school = { listClasses: vi.fn(async () => []) };
    const service = new TeacherImportService(
      {} as TeacherService,
      school as unknown as SchoolService,
      { list: vi.fn(async () => []) } as unknown as CourseStore,
      {} as TeacherStore,
      {} as TeacherAssignmentStore,
    );

    await expect(service.dryRun(context, {
      fileBase64: csv("ad;soyad;atanacak_sinif\nMerve;Import;Bilim Atölyesi"),
    })).resolves.toMatchObject({
      errors: [expect.objectContaining({ code: "CLASS_NOT_FOUND", field: "className" })],
      validRows: [],
      wouldImport: false,
    });
  });
});

function csv(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}
