import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { AttendanceRecord, AttendanceStatus, AttendanceSummaryRecord } from "@uzman-hocam/shared-types";
import { AnnouncementService } from "../announcement/announcement.service.js";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { type AcademicCalendarStore, academicCalendarStoreToken } from "../school/academic-calendar-store.js";
import { type CourseStore, courseStoreToken } from "../school/course-store.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import { assertTeacherAssigned } from "../school/assert-teacher-assigned.js";
import {
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import {
  assertSubjectResourceAccess,
  assertTenantResourceAccess,
  filterTeacherScopedStudents,
  filterTenantResources,
  isTeacherSubjectContext,
} from "../tenant/tenant-access.js";
import { type AttendanceStore, attendanceStoreToken } from "./attendance-store.js";

export type AttendanceInput = Pick<AttendanceRecord, "studentId" | "date" | "status"> &
  Pick<Partial<AttendanceRecord>, "courseId" | "termId">;

export interface AttendanceListFilters {
  classId?: string;
  studentId?: string;
}

const attendanceStatuses: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
const absenceWarningThreshold = Number.parseInt(process.env.ATTENDANCE_ABSENCE_WARNING_THRESHOLD ?? "", 10) || 5;

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(attendanceStoreToken) private readonly store: AttendanceStore,
    @Inject(academicCalendarStoreToken) private readonly academicCalendarStore: AcademicCalendarStore,
    @Inject(courseStoreToken) private readonly courseStore: CourseStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignmentStore: TeacherAssignmentStore,
    private readonly announcements: AnnouncementService,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext, filters: AttendanceListFilters = {}): Promise<AttendanceRecord[]> {
    const records = filters.studentId
      ? await this.listForTenantStudent(context, filters.studentId)
      : await this.filterForTeacherScope(context, filterTenantResources(context, await this.store.list()).filter((record) => !record.deletedAt));
    return this.filterByStudentClass(context, records, filters.classId);
  }

  async listForTenantStudent(context: RequestContext, studentId: string): Promise<AttendanceRecord[]> {
    const student = await this.findStudentForTeacherScope(context, studentId);
    return filterTenantResources(context, await this.store.listByStudent(student.id)).filter((record) => !record.deletedAt);
  }

  async listCurrentStudent(context: RequestContext): Promise<AttendanceRecord[]> {
    if (context.subjectType !== "STUDENT" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return this.listForSubjectStudent(context, context.subjectId);
  }

  async listCurrentGuardianStudent(context: RequestContext, studentId: string): Promise<AttendanceRecord[]> {
    if (context.subjectType !== "GUARDIAN" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return this.listForSubjectStudent(context, studentId);
  }

  async summarizeForTenantStudent(context: RequestContext, studentId: string): Promise<AttendanceSummaryRecord> {
    return summarize(studentId, await this.listForTenantStudent(context, studentId));
  }

  async summarizeCurrentStudent(context: RequestContext): Promise<AttendanceSummaryRecord> {
    if (context.subjectType !== "STUDENT" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return summarize(context.subjectId, await this.listCurrentStudent(context));
  }

  async summarizeCurrentGuardianStudent(context: RequestContext, studentId: string): Promise<AttendanceSummaryRecord> {
    return summarize(studentId, await this.listCurrentGuardianStudent(context, studentId));
  }

  async create(context: RequestContext, input: Partial<AttendanceInput>): Promise<AttendanceRecord> {
    const student = await this.findStudentForTeacherScope(context, requiredText(input.studentId, "ATTENDANCE_STUDENT_REQUIRED"));
    const contextInput = await this.resolveAcademicContext(context, student.tenantId, input);
    await assertTeacherAssigned(context, this.teacherAssignmentStore, {
      tenantId: student.tenantId,
      studentId: student.id,
      classId: student.classId,
      courseId: contextInput.courseId,
      termId: contextInput.termId,
    });
    const date = requiredDate(input.date);
    const status = resolveStatus(input.status);
    const existing = await this.store.findByStudentDate(student.id, date);
    if (existing) {
      throw new ConflictException("ATTENDANCE_ALREADY_EXISTS");
    }
    const previousAbsenceCount = countAbsences(await this.store.listByStudent(student.id));

    const record = await this.store.create({
      tenantId: student.tenantId,
      studentId: student.id,
      ...contextInput,
      date,
      status,
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Attendance",
      entityId: record.id,
      action: "attendance.created",
      diff: { studentId: record.studentId, courseId: record.courseId, termId: record.termId, date: record.date, status: record.status },
    });
    await this.warnIfAbsenceThresholdCrossed(context, student, previousAbsenceCount, countAbsences(await this.store.listByStudent(student.id)));
    return record;
  }

  async update(context: RequestContext, id: string, input: Partial<Pick<AttendanceRecord, "status" | "courseId" | "termId">>): Promise<AttendanceRecord> {
    const existing = await this.findOneForTenant(context, id);
    const contextInput = await this.resolveAcademicContext(context, existing.tenantId, input);
    const student = await this.findStudentForTenant(context, existing.studentId);
    await assertTeacherAssigned(context, this.teacherAssignmentStore, {
      tenantId: existing.tenantId,
      studentId: existing.studentId,
      classId: student.classId,
      courseId: contextInput.courseId ?? existing.courseId,
      termId: contextInput.termId ?? existing.termId,
    });
    const status = resolveStatus(input.status);
    const previousAbsenceCount = countAbsences(await this.store.listByStudent(existing.studentId));
    const record = await this.store.update(id, { status, ...contextInput });
    if (!record) {
      throw new NotFoundException("ATTENDANCE_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Attendance",
      entityId: record.id,
      action: "attendance.updated",
      diff: {
        before: { courseId: existing.courseId, termId: existing.termId, status: existing.status },
        after: { courseId: record.courseId, termId: record.termId, status: record.status },
      },
    });
    await this.warnIfAbsenceThresholdCrossed(context, student, previousAbsenceCount, countAbsences(await this.store.listByStudent(existing.studentId)));
    return record;
  }

  async delete(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findOneForTenant(context, id);
    const record = await this.store.softDelete(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("ATTENDANCE_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Attendance",
      entityId: record.id,
      action: "attendance.deleted",
      diff: { studentId: existing.studentId, date: existing.date, deletedAt: record.deletedAt },
    });
  }

  private async listForSubjectStudent(context: RequestContext, studentId: string): Promise<AttendanceRecord[]> {
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    const guardianIds = (await this.guardianStudentStore.listByStudent(student.id)).map((link) => link.guardianId);
    this.assertSubjectAccess(context, { ...student, guardianIds });
    return filterTenantResources(context, await this.store.listByStudent(student.id)).filter((record) => !record.deletedAt);
  }

  private async findStudentForTenant(context: RequestContext, studentId: string) {
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    this.assertTenantAccess(context, student);
    return student;
  }

  private async findStudentForTeacherScope(context: RequestContext, studentId: string) {
    const student = await this.findStudentForTenant(context, studentId);
    await assertTeacherAssigned(context, this.teacherAssignmentStore, {
      tenantId: student.tenantId,
      studentId: student.id,
      classId: student.classId,
    });
    return student;
  }

  private async findOneForTenant(context: RequestContext, id: string): Promise<AttendanceRecord> {
    const record = await this.store.findById(id);
    if (!record) {
      throw new NotFoundException("ATTENDANCE_NOT_FOUND");
    }

    this.assertTenantAccess(context, record);
    if (isTeacherSubjectContext(context)) {
      await this.findStudentForTeacherScope(context, record.studentId);
    }
    return record;
  }

  private assertTenantAccess(context: RequestContext, resource: { tenantId: string }): void {
    try {
      assertTenantResourceAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }
  }

  private async resolveAcademicContext(
    context: RequestContext,
    tenantId: string,
    input: Partial<Pick<AttendanceRecord, "courseId" | "termId">>,
  ): Promise<Pick<Partial<AttendanceRecord>, "courseId" | "termId">> {
    const result: Pick<Partial<AttendanceRecord>, "courseId" | "termId"> = {};
    if (input.courseId !== undefined) {
      const courseId = optionalText(input.courseId);
      if (courseId) {
        const course = await this.courseStore.findById(courseId);
        if (!course) throw new NotFoundException("COURSE_NOT_FOUND");
        this.assertTenantAccess(context, course);
        if (course.tenantId !== tenantId) throw new ForbiddenException("FORBIDDEN_TENANT");
      }
      result.courseId = courseId;
    }
    if (input.termId !== undefined) {
      const termId = optionalText(input.termId);
      if (termId) {
        const term = await this.academicCalendarStore.findTermById(termId);
        if (!term) throw new NotFoundException("ACADEMIC_TERM_NOT_FOUND");
        this.assertTenantAccess(context, term);
        if (term.tenantId !== tenantId) throw new ForbiddenException("FORBIDDEN_TENANT");
      }
      result.termId = termId;
    }
    return result;
  }

  private assertSubjectAccess(
    context: RequestContext,
    resource: { tenantId: string; id?: string; guardianIds?: string[] },
  ): void {
    try {
      assertSubjectResourceAccess(context, {
        tenantId: resource.tenantId,
        studentId: resource.id,
        guardianIds: resource.guardianIds,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_SUBJECT";
      throw new ForbiddenException(message);
    }
  }

  private async filterForTeacherScope(context: RequestContext, records: AttendanceRecord[]): Promise<AttendanceRecord[]> {
    if (!isTeacherSubjectContext(context)) {
      return records;
    }

    const scopedStudentIds = new Set(filterTeacherScopedStudents(context, await this.studentStore.list()).map((student) => student.id));
    return records.filter((record) => scopedStudentIds.has(record.studentId));
  }

  private async filterByStudentClass(context: RequestContext, records: AttendanceRecord[], classId: string | undefined): Promise<AttendanceRecord[]> {
    const normalizedClassId = optionalText(classId);
    if (!normalizedClassId) return records;

    const studentIds = new Set(
      filterTenantResources(context, await this.studentStore.list())
        .filter((student) => student.classId === normalizedClassId)
        .map((student) => student.id),
    );
    return records.filter((record) => studentIds.has(record.studentId));
  }

  private async warnIfAbsenceThresholdCrossed(
    context: RequestContext,
    student: { tenantId: string; id: string; firstName?: string; lastName?: string; classId?: string },
    previousAbsenceCount: number,
    currentAbsenceCount: number,
  ): Promise<void> {
    if (absenceWarningThreshold <= 0 || previousAbsenceCount >= absenceWarningThreshold || currentAbsenceCount < absenceWarningThreshold) {
      return;
    }

    let announcementId: string | undefined;
    if (student.classId) {
      const announcement = await this.announcements.create(context, {
        tenantId: student.tenantId,
        audience: "GUARDIANS",
        classId: student.classId,
        title: "Devamsızlık eşiği uyarısı",
        body: "Sınıfınızda devamsızlık eşiğine ulaşan öğrenci bulunmaktadır. Lütfen veli panelinizden öğrencinizin devamsızlık özetini kontrol edin.",
      });
      announcementId = announcement.id;
    }

    await this.auditLogs?.record({
      tenantId: student.tenantId,
      actorUserId: context.userId,
      entityType: "Attendance",
      entityId: student.id,
      action: "attendance.threshold_warned",
      diff: {
        studentId: student.id,
        classId: student.classId,
        previousAbsenceCount,
        currentAbsenceCount,
        threshold: absenceWarningThreshold,
        announcementId,
      },
    });
  }
}

function summarize(studentId: string, records: AttendanceRecord[]): AttendanceSummaryRecord {
  return records.reduce<AttendanceSummaryRecord>(
    (summary, record) => {
      if (record.status === "PRESENT") summary.present += 1;
      if (record.status === "ABSENT") summary.absent += 1;
      if (record.status === "LATE") summary.late += 1;
      if (record.status === "EXCUSED") summary.excused += 1;
      summary.total += 1;
      return summary;
    },
    { studentId, total: 0, present: 0, absent: 0, late: 0, excused: 0 },
  );
}

function countAbsences(records: AttendanceRecord[]): number {
  return records.filter((record) => !record.deletedAt && record.status === "ABSENT").length;
}

function requiredText(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function requiredDate(value: string | undefined): string {
  const trimmed = requiredText(value, "ATTENDANCE_DATE_REQUIRED");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new BadRequestException("ATTENDANCE_DATE_INVALID");
  }
  return trimmed;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolveStatus(value: AttendanceStatus | undefined): AttendanceStatus {
  if (!value || !attendanceStatuses.includes(value)) {
    throw new BadRequestException("ATTENDANCE_STATUS_INVALID");
  }
  return value;
}
