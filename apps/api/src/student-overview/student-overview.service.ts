import { Injectable } from "@nestjs/common";
import type {
  AcademicTermRecord,
  ClassRecord,
  CourseRecord,
  StudentEnrollmentRecord,
  StudentOverviewRecord,
} from "@o-okul/shared-types";
import { AttendanceService } from "../attendance/attendance.service.js";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { FeatureRolloutService } from "../feature-rollout/feature-rollout.service.js";
import { GuardianService } from "../guardian/guardian.service.js";
import { toGuardianResponse } from "../guardian/guardian-response.js";
import { HomeworkService } from "../homework/homework.service.js";
import { hasCapability } from "../rbac/role-capabilities.js";
import { ReportGenerationService } from "../report/report-generation.service.js";
import { SchoolService } from "../school/school.service.js";
import { StudentContactService } from "../student/student-contact.service.js";
import { StudentService } from "../student/student.service.js";
import { TeacherNoteService } from "../teacher-note/teacher-note.service.js";
import { TeacherService } from "../teacher/teacher.service.js";

@Injectable()
export class StudentOverviewService {
  constructor(
    private readonly students: StudentService,
    private readonly contacts: StudentContactService,
    private readonly attendance: AttendanceService,
    private readonly homework: HomeworkService,
    private readonly teacherNotes: TeacherNoteService,
    private readonly guardians: GuardianService,
    private readonly teachers: TeacherService,
    private readonly school: SchoolService,
    private readonly reports: ReportGenerationService,
    private readonly auditLogs: AuditLogService,
    private readonly featureRollouts: FeatureRolloutService,
  ) {}

  async get(context: RequestContext, studentId: string): Promise<StudentOverviewRecord> {
    await this.featureRollouts.assertEnabled(context, "web.student-registry-v2");
    const profile = await this.students.findProfileForViewer(context, studentId);
    const canReadAudit = context.activePersona === "STAFF" && hasCapability(context, "tenant-audit:read");
    const canReadContacts = hasCapability(context, "privacy:manage")
      || (context.subjectType === "STUDENT" && context.subjectId === studentId);
    const hasRestrictedCampusScope = context.campusScope?.scopeMode === "CAMPUSES";
    const canReadReports = hasCapability(context, "academic:read") && !hasRestrictedCampusScope;
    const [
      enrollments,
      attendance,
      homeworkAssignments,
      teacherNotes,
      contacts,
      guardianLinks,
      guardians,
      teacherAssignments,
      teachers,
      classes,
      courses,
      terms,
      activity,
      latestExam,
    ] = await Promise.all([
      this.students.listEnrollments(context, studentId),
      this.attendance.summarizeForTenantStudent(context, studentId),
      this.homework.listMaterialAssignmentsByStudent(context, studentId),
      hasRestrictedCampusScope ? Promise.resolve([]) : this.teacherNotes.list(context, { studentId }),
      canReadContacts ? this.contacts.list(context, studentId) : Promise.resolve([]),
      hasRestrictedCampusScope ? Promise.resolve([]) : this.guardians.listStudentGuardianLinks(context, studentId),
      hasRestrictedCampusScope ? Promise.resolve([]) : this.guardians.listStudentGuardians(context, studentId),
      hasRestrictedCampusScope ? Promise.resolve([]) : this.teachers.listStudentTeacherAssignments(context, studentId),
      hasRestrictedCampusScope ? Promise.resolve([]) : this.teachers.listTeachers(context),
      this.school.listClasses(context),
      this.school.listCourses(context),
      this.school.listAcademicTerms(context),
      canReadAudit ? this.auditLogs.studentSummary(context, studentId, 5) : Promise.resolve([]),
      canReadReports ? this.reports.getLatestStudentOverview(context, studentId) : Promise.resolve(undefined),
    ]);

    const classIds = new Set([
      profile.classId,
      ...enrollments.map((record) => record.classId),
      ...teacherAssignments.map((record) => record.classId),
    ].filter((id): id is string => Boolean(id)));
    const courseIds = new Set([
      ...homeworkAssignments.map((record) => record.courseId),
      ...teacherNotes.map((record) => record.courseId),
      ...teacherAssignments.map((record) => record.courseId),
    ].filter((id): id is string => Boolean(id)));
    const termIds = new Set([
      ...enrollments.map((record) => record.termId),
      ...homeworkAssignments.map((record) => record.termId),
      ...teacherNotes.map((record) => record.termId),
      ...teacherAssignments.map((record) => record.termId),
    ].filter((id): id is string => Boolean(id)));
    const teacherIds = new Set([
      profile.responsibleTeacherId,
      ...teacherAssignments.map((record) => record.teacherId),
    ].filter((id): id is string => Boolean(id)));

    return {
      profile,
      activeEnrollment: activeEnrollment(enrollments),
      enrollments,
      attendance,
      latestExam,
      openHomeworkCount: homeworkAssignments.length,
      homeworkAssignments: homeworkAssignments.slice(0, 20),
      teacherNoteCount: teacherNotes.length,
      teacherNotes: teacherNotes.slice(0, 20),
      contacts,
      guardians: guardians.map((record) => toGuardianResponse(record, context)),
      guardianLinks,
      teacherAssignments,
      teachers: teachers.filter((record) => teacherIds.has(record.id)),
      classes: filterReferences(classes, classIds),
      courses: filterReferences(courses, courseIds),
      terms: filterReferences(terms, termIds),
      canViewFinance: hasCapability(context, "finance:manage"),
      activity,
    };
  }
}

function activeEnrollment(records: StudentEnrollmentRecord[]): StudentEnrollmentRecord | undefined {
  const today = new Date().toISOString().slice(0, 10);
  return [...records]
    .filter((record) => record.status === "ACTIVE" && record.startsAt <= today && (!record.endsAt || record.endsAt >= today))
    .sort((left, right) => right.startsAt.localeCompare(left.startsAt))[0];
}

function filterReferences<TRecord extends ClassRecord | CourseRecord | AcademicTermRecord>(
  records: TRecord[],
  ids: ReadonlySet<string>,
): TRecord[] {
  return records.filter((record) => ids.has(record.id));
}
