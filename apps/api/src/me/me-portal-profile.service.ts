import { Inject, Injectable } from "@nestjs/common";
import type { PublicStudentProfileRecord, TeacherAssignmentRecord } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { type AcademicCalendarStore, academicCalendarStoreToken } from "../school/academic-calendar-store.js";
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
    @Inject(academicCalendarStoreToken) private readonly calendar: AcademicCalendarStore,
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
    // The active term only breaks a tie, so the calendar is read only when several assignments compete.
    const activeTermIds = responsibleCandidates(assignments, profile).length > 1
      ? new Set(filterTenantResources(context, await this.calendar.listTerms()).filter((term) => term.isActive && !term.deletedAt).map((term) => term.id))
      : undefined;
    const assignment = pickResponsibleAssignment(assignments, profile, activeTermIds);
    if (!assignment) return profile;
    const teacher = await this.teachers.findById(assignment.teacherId);
    if (!teacher || teacher.tenantId !== profile.tenantId || (teacher as { deletedAt?: string }).deletedAt) return profile;
    return { ...profile, responsibleTeacherName: `${teacher.firstName} ${teacher.lastName}` };
  }
}

type ProfileStudent = { id: string; classId?: string; tenantId: string };

/** The group the name comes from: the student's RESPONSIBLE_TEACHER assignments, else the class's CLASS_TEACHER ones. */
export function responsibleCandidates(
  assignments: readonly TeacherAssignmentRecord[],
  student: ProfileStudent,
): TeacherAssignmentRecord[] {
  const sameTenant = assignments.filter((assignment) => assignment.tenantId === student.tenantId);
  const responsible = sameTenant.filter((assignment) => assignment.role === "RESPONSIBLE_TEACHER" && assignment.studentId === student.id);
  if (responsible.length > 0) return responsible;
  return student.classId
    ? sameTenant.filter((assignment) => assignment.role === "CLASS_TEACHER" && assignment.classId === student.classId && !assignment.studentId)
    : [];
}

/**
 * Deterministic among several active candidates: the one bound to an active term first, then the most recent start
 * (an assignment without a start date counts as the oldest), then the most recent creation, then the id.
 */
export function pickResponsibleAssignment(
  assignments: readonly TeacherAssignmentRecord[],
  student: ProfileStudent,
  activeTermIds: ReadonlySet<string> = new Set(),
): TeacherAssignmentRecord | undefined {
  const inActiveTerm = (assignment: TeacherAssignmentRecord) => (assignment.termId && activeTermIds.has(assignment.termId) ? 1 : 0);
  return [...responsibleCandidates(assignments, student)].sort((left, right) =>
    inActiveTerm(right) - inActiveTerm(left)
    || compareDesc(left.startsAt, right.startsAt)
    || compareDesc(left.createdAt, right.createdAt)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))[0];
}

/** Later ISO date first; a missing value sorts last. */
function compareDesc(left: string | undefined, right: string | undefined): number {
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left < right ? 1 : -1;
}
