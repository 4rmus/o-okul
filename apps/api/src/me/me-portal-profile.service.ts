import { Inject, Injectable } from "@nestjs/common";
import type { PublicStudentProfileRecord, TeacherAssignmentRecord } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { type TeacherAssignmentStore, teacherAssignmentStoreToken } from "../school/teacher-assignment-store.js";
import { isAssignmentActive } from "../school/teacher-scope.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";
import { StudentService } from "../student/student.service.js";
import { filterTenantResources } from "../tenant/tenant-access.js";

/**
 * UAT U20 (2026-11-03): the portal profile shows "Sorumlu öğretmen". The stored `responsibleTeacherId` is often empty
 * while the class has a class teacher, so the portal fell back to "Öğretmen bilgisi yok". The fallback follows the
 * staff list read model (UAT F-22): the student's active RESPONSIBLE_TEACHER assignment first, then the active
 * CLASS_TEACHER assignment of the student's class. Only the teacher's display name is added; no teacher contact,
 * id or assignment row leaves this service. The student read itself (link, tenant and campus scope) is unchanged.
 */
@Injectable()
export class MePortalProfileService {
  constructor(
    private readonly students: StudentService,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignments: TeacherAssignmentStore,
    @Inject(teacherStoreToken) private readonly teachers: TeacherStore,
  ) {}

  async getCurrentStudentProfile(context: RequestContext): Promise<PublicStudentProfileRecord> {
    return this.withResponsibleTeacherName(context, await this.students.findCurrentStudentProfile(context));
  }

  async getGuardianStudentProfile(context: RequestContext, studentId: string): Promise<PublicStudentProfileRecord> {
    return this.withResponsibleTeacherName(context, await this.students.findProfileForViewer(context, studentId));
  }

  private async withResponsibleTeacherName(
    context: RequestContext,
    profile: PublicStudentProfileRecord,
  ): Promise<PublicStudentProfileRecord> {
    if (profile.responsibleTeacherName) return profile;
    const assignments = filterTenantResources(context, await this.teacherAssignments.list()).filter(isAssignmentActive);
    const assignment = pickResponsibleAssignment(assignments, profile);
    if (!assignment) return profile;
    const teacher = await this.teachers.findById(assignment.teacherId);
    if (!teacher || teacher.tenantId !== profile.tenantId || (teacher as { deletedAt?: string }).deletedAt) return profile;
    return { ...profile, responsibleTeacherName: `${teacher.firstName} ${teacher.lastName}` };
  }
}

export function pickResponsibleAssignment(
  assignments: readonly TeacherAssignmentRecord[],
  student: { id: string; classId?: string; tenantId: string },
): TeacherAssignmentRecord | undefined {
  const sameTenant = assignments.filter((assignment) => assignment.tenantId === student.tenantId);
  return sameTenant.find((assignment) => assignment.role === "RESPONSIBLE_TEACHER" && assignment.studentId === student.id)
    ?? (student.classId
      ? sameTenant.find((assignment) =>
          assignment.role === "CLASS_TEACHER" && assignment.classId === student.classId && !assignment.studentId)
      : undefined);
}
