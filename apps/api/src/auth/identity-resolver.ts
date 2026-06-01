import { Inject, Injectable } from "@nestjs/common";
import { type GuardianStore, guardianStoreToken } from "../school/guardian-store.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";

export interface SubjectIdentity {
  subjectType: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId: string;
}

@Injectable()
export class IdentityResolver {
  constructor(
    @Inject(studentStoreToken) private readonly students: StudentStore,
    @Inject(guardianStoreToken) private readonly guardians: GuardianStore,
    @Inject(teacherStoreToken) private readonly teachers: TeacherStore,
  ) {}

  async resolve(input: { userId: string; tenantId: string; roles: string[] }): Promise<SubjectIdentity | undefined> {
    if (input.roles.includes("STUDENT")) {
      const student = await this.students.findByUserId(input.tenantId, input.userId);
      if (student) return { subjectType: "STUDENT", subjectId: student.id };
    }

    if (input.roles.includes("GUARDIAN")) {
      const guardian = await this.guardians.findByUserId(input.tenantId, input.userId);
      if (guardian) return { subjectType: "GUARDIAN", subjectId: guardian.id };
    }

    if (input.roles.includes("TEACHER")) {
      const teacher = await this.teachers.findByUserId(input.tenantId, input.userId);
      if (teacher) return { subjectType: "TEACHER", subjectId: teacher.id };
    }

    return undefined;
  }
}
