import "reflect-metadata";
import type { PublicStudentProfileRecord, TeacherAssignmentRecord, TeacherRecord } from "@o-okul/shared-types";
import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import type { TeacherAssignmentStore } from "../school/teacher-assignment-store.js";
import type { TeacherStore } from "../school/teacher-store.js";
import type { StudentService } from "../student/student.service.js";
import { MePortalProfileService, pickResponsibleAssignment } from "./me-portal-profile.service.js";

const guardianContext = {
  tenantId: "tenant-a",
  userId: "guardian-user-a",
  roles: ["GUARDIAN"],
  subjectType: "GUARDIAN",
  subjectId: "guardian-a",
} as unknown as RequestContext;

const baseProfile: PublicStudentProfileRecord = {
  id: "student-a",
  tenantId: "tenant-a",
  firstName: "Ada",
  lastName: "Ak",
  classId: "class-a",
  status: "ACTIVE",
};

const teachers: TeacherRecord[] = [
  { id: "teacher-class", tenantId: "tenant-a", firstName: "Sınıf", lastName: "Öğretmeni", phone: "05550000000" },
  { id: "teacher-responsible", tenantId: "tenant-a", firstName: "Sorumlu", lastName: "Öğretmen" },
  { id: "teacher-other-tenant", tenantId: "tenant-b", firstName: "Başka", lastName: "Kurum" },
];

function createService(profile: PublicStudentProfileRecord, assignments: TeacherAssignmentRecord[]) {
  const students = {
    findProfileForViewer: async (_context: RequestContext, id: string) => {
      if (id !== profile.id) throw new Error("STUDENT_NOT_FOUND");
      return profile;
    },
    findCurrentStudentProfile: async () => profile,
  } as unknown as StudentService;
  const assignmentStore = { list: async () => assignments } as unknown as TeacherAssignmentStore;
  const teacherStore = { findById: async (id: string) => teachers.find((teacher) => teacher.id === id) } as unknown as TeacherStore;
  return new MePortalProfileService(students, assignmentStore, teacherStore);
}

describe("MePortalProfileService (UAT U20)", () => {
  it("sorumlu öğretmen boşsa sınıfın sınıf öğretmeninin adını ekler; iletişim bilgisi eklemez", async () => {
    const service = createService(baseProfile, [
      { id: "a-1", tenantId: "tenant-a", teacherId: "teacher-class", classId: "class-a", role: "CLASS_TEACHER" },
      { id: "a-2", tenantId: "tenant-a", teacherId: "teacher-responsible", classId: "class-a", role: "BRANCH_TEACHER" },
    ]);

    const profile = await service.getGuardianStudentProfile(guardianContext, "student-a");

    expect(profile.responsibleTeacherName).toBe("Sınıf Öğretmeni");
    expect(JSON.stringify(profile)).not.toContain("0555");
    expect(JSON.stringify(profile)).not.toContain("teacher-class");
  });

  it("öğrenciye özel aktif sorumlu öğretmen ataması sınıf öğretmeninden önce gelir", async () => {
    const service = createService(baseProfile, [
      { id: "a-1", tenantId: "tenant-a", teacherId: "teacher-class", classId: "class-a", role: "CLASS_TEACHER" },
      { id: "a-2", tenantId: "tenant-a", teacherId: "teacher-responsible", studentId: "student-a", role: "RESPONSIBLE_TEACHER" },
    ]);

    const profile = await service.getCurrentStudentProfile({ ...guardianContext, subjectType: "STUDENT", subjectId: "student-a" } as RequestContext);

    expect(profile.responsibleTeacherName).toBe("Sorumlu Öğretmen");
  });

  it("kayıtlı sorumlu öğretmen adı varsa değiştirmez", async () => {
    const service = createService({ ...baseProfile, responsibleTeacherName: "Kayıtlı Öğretmen" }, [
      { id: "a-1", tenantId: "tenant-a", teacherId: "teacher-class", classId: "class-a", role: "CLASS_TEACHER" },
    ]);

    expect((await service.getGuardianStudentProfile(guardianContext, "student-a")).responsibleTeacherName).toBe("Kayıtlı Öğretmen");
  });

  it("süresi bitmiş, başka sınıfa veya başka tenanta ait atamayı kullanmaz", async () => {
    const service = createService(baseProfile, [
      { id: "a-1", tenantId: "tenant-a", teacherId: "teacher-class", classId: "class-a", role: "CLASS_TEACHER", endsAt: "2020-01-01" },
      { id: "a-2", tenantId: "tenant-a", teacherId: "teacher-responsible", classId: "class-b", role: "CLASS_TEACHER" },
      { id: "a-3", tenantId: "tenant-b", teacherId: "teacher-other-tenant", classId: "class-a", role: "CLASS_TEACHER" },
    ]);

    expect((await service.getGuardianStudentProfile(guardianContext, "student-a")).responsibleTeacherName).toBeUndefined();
  });

  it("öğrenciye özel atama sınıf öğretmeni seçiminde sayılmaz", () => {
    expect(pickResponsibleAssignment([
      { id: "a-1", tenantId: "tenant-a", teacherId: "teacher-class", classId: "class-a", studentId: "student-x", role: "CLASS_TEACHER" },
    ], baseProfile)).toBeUndefined();
  });
});
