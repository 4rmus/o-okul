import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  AttendanceAggregateRecord,
  AttendanceDailyRosterResponse,
  AttendanceDailyUpsertRequest,
  AttendanceDailyUpsertResponse,
  AttendanceRecord,
  AttendanceStatus,
  AttendanceSummaryRecord,
  StudentEnrollmentRecord,
} from "@o-okul/shared-types";
import { AnnouncementService } from "../announcement/announcement.service.js";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { requiredText } from "../shared/required-text.js";
import { type AcademicCalendarStore, academicCalendarStoreToken } from "../school/academic-calendar-store.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import {
  assertTeacherAssigned,
  assertTeacherAssignedFromRecords,
  hasTeacherAssignmentForScope,
} from "../school/assert-teacher-assigned.js";
import {
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import {
  type StudentEnrollmentStore,
  studentEnrollmentStoreToken,
} from "../student/student-enrollment-store.js";
import {
  assertSubjectResourceAccess,
  assertTenantResourceAccess,
  filterTenantResources,
  isTeacherSubjectContext,
} from "../tenant/tenant-access.js";
import { type AttendanceStore, attendanceStoreToken } from "./attendance-store.js";

export interface AttendanceListFilters {
  classId?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  studentId?: string;
}

const attendanceStatuses: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];
const absenceWarningThreshold = Number.parseInt(process.env.ATTENDANCE_ABSENCE_WARNING_THRESHOLD ?? "", 10) || 5;

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(attendanceStoreToken) private readonly store: AttendanceStore,
    @Inject(academicCalendarStoreToken) private readonly academicCalendarStore: AcademicCalendarStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(studentEnrollmentStoreToken) private readonly studentEnrollmentStore: StudentEnrollmentStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignmentStore: TeacherAssignmentStore,
    private readonly announcements: AnnouncementService,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext, filters: AttendanceListFilters = {}): Promise<AttendanceRecord[]> {
    const records = filters.studentId
      ? await this.listRawForTenantStudent(context, filters.studentId)
      : filterTenantResources(context, await this.store.list()).filter((record) => !record.deletedAt);
    const date = optionalDate(filters.date);
    const dateFrom = optionalDate(filters.dateFrom);
    const dateTo = optionalDate(filters.dateTo);
    if (dateFrom && dateTo && dateFrom > dateTo) throw new BadRequestException("ATTENDANCE_DATE_RANGE_INVALID");
    const enrollments = await this.listEnrollmentsForRecords(context, records);
    const scopedRecords = await this.filterForTeacherScope(context, records, enrollments);
    if (filters.studentId && isTeacherSubjectContext(context) && scopedRecords.length === 0) {
      const today = new Date().toISOString().slice(0, 10);
      const studentEnrollments = filterTenantResources(context, await this.studentEnrollmentStore.listByStudent(filters.studentId));
      const enrollment = findEnrollmentAtDate(studentEnrollments, filters.studentId, today);
      if (!enrollment?.classId) throw new ForbiddenException("ATTENDANCE_STUDENT_ENROLLMENT_NOT_FOUND");
      await assertTeacherAssigned(context, this.teacherAssignmentStore, {
        tenantId: enrollment.tenantId,
        studentId: filters.studentId,
        classId: enrollment.classId,
      }, today);
    }
    const classRecords = this.filterByStudentClass(scopedRecords, filters.classId, enrollments);
    return classRecords
      .filter((record) => !date || record.date === date)
      .filter((record) => !dateFrom || record.date >= dateFrom)
      .filter((record) => !dateTo || record.date <= dateTo)
      .map((record) => {
        const classId = findEnrollmentAtDate(enrollments, record.studentId, record.date)?.classId;
        return classId ? { ...record, classId } : record;
      });
  }

  async aggregate(context: RequestContext, filters: AttendanceListFilters = {}): Promise<AttendanceAggregateRecord> {
    return summarizeRecords(await this.list(context, filters));
  }

  async getDailyRoster(
    context: RequestContext,
    classIdInput: string | undefined,
    dateInput: string | undefined,
  ): Promise<AttendanceDailyRosterResponse> {
    const classId = requiredText(classIdInput, "ATTENDANCE_CLASS_REQUIRED");
    const date = requiredDate(dateInput);
    if (!context.tenantId && !context.bypassRls) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const [allStudents, teacherAssignments] = await Promise.all([
      this.studentStore.list(),
      isTeacherSubjectContext(context)
        ? this.teacherAssignmentStore.listByTeacher(context.subjectId)
        : Promise.resolve([]),
    ]);
    const assignments = filterTenantResources(context, teacherAssignments);
    assertTeacherAssignedFromRecords(context, assignments, {
      tenantId: context.tenantId ?? "",
      classId,
    }, date);

    const tenantStudents = filterTenantResources(context, allStudents)
      .filter((student) => !student.deletedAt && isStudentEligibleForAttendanceDate(student.status, date));
    const enrollments = filterTenantResources(
      context,
      await this.studentEnrollmentStore.listByStudents(tenantStudents.map((student) => student.id)),
    );
    const rosterStudentIds = new Set(
      enrollments
        .filter((enrollment) => enrollment.classId === classId && enrollmentContainsDate(enrollment, date))
        .map((enrollment) => enrollment.studentId),
    );
    const students = tenantStudents
      .filter((student) => rosterStudentIds.has(student.id))
      .map((student) => ({
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        ...(student.studentNo ? { studentNo: student.studentNo } : {}),
        classId,
      }))
      .sort((left, right) =>
        left.firstName.localeCompare(right.firstName) ||
        left.lastName.localeCompare(right.lastName) ||
        left.id.localeCompare(right.id),
      );
    const records = filterTenantResources(
      context,
      await this.store.listByStudentsDate(students.map((student) => student.id), date),
    ).filter((record) => rosterStudentIds.has(record.studentId) && record.date === date && !record.deletedAt);
    const markedSummary = summarizeRecords(records);

    return {
      classId,
      date,
      students,
      records,
      summary: {
        ...markedSummary,
        total: students.length,
        unmarked: Math.max(0, students.length - markedSummary.total),
      },
    };
  }

  async upsertDaily(context: RequestContext, input: AttendanceDailyUpsertRequest): Promise<AttendanceDailyUpsertResponse> {
    const classId = requiredText(input.classId, "ATTENDANCE_CLASS_REQUIRED");
    const date = requiredDate(input.date);
    const uniqueStudentIds = new Set(input.entries.map((entry) => entry.studentId));
    if (uniqueStudentIds.size !== input.entries.length) {
      throw new BadRequestException("ATTENDANCE_DAILY_STUDENT_DUPLICATE");
    }

    const [allStudents, allTerms, allAttendance, teacherAssignments] = await Promise.all([
      this.studentStore.list(),
      this.academicCalendarStore.listTerms(),
      this.store.list(),
      isTeacherSubjectContext(context)
        ? this.teacherAssignmentStore.listByTeacher(context.subjectId)
        : Promise.resolve([]),
    ]);
    const tenantStudents = filterTenantResources(context, allStudents).filter((student) => !student.deletedAt);
    const studentById = new Map(tenantStudents.map((student) => [student.id, student]));
    if ([...uniqueStudentIds].some((studentId) => !studentById.has(studentId))) {
      throw new ForbiddenException("ATTENDANCE_DAILY_STUDENT_SCOPE_INVALID");
    }
    const enrollments = filterTenantResources(
      context,
      await this.studentEnrollmentStore.listByStudents(tenantStudents.map((student) => student.id)),
    );
    const rosterStudentIds = new Set(
      tenantStudents
        .filter((student) => isStudentEligibleForAttendanceDate(student.status, date))
        .filter((student) => enrollments.some((enrollment) =>
          enrollment.studentId === student.id &&
          enrollment.classId === classId &&
          enrollmentContainsDate(enrollment, date),
        ))
        .map((student) => student.id),
    );
    if (
      rosterStudentIds.size !== uniqueStudentIds.size ||
      [...rosterStudentIds].some((studentId) => !uniqueStudentIds.has(studentId))
    ) {
      throw new BadRequestException("ATTENDANCE_DAILY_FULL_ROSTER_REQUIRED");
    }
    const assignments = filterTenantResources(context, teacherAssignments);
    const students = input.entries.map((entry) => {
      const studentId = requiredText(entry.studentId, "ATTENDANCE_STUDENT_REQUIRED");
      const student = studentById.get(studentId);
      if (!student) throw new ForbiddenException("ATTENDANCE_DAILY_STUDENT_SCOPE_INVALID");
      const enrolledInClass = enrollments.some((enrollment) =>
        enrollment.studentId === student.id && enrollment.classId === classId && enrollmentContainsDate(enrollment, date),
      );
      if (!isStudentEligibleForAttendanceDate(student.status, date) || !enrolledInClass) {
        throw new BadRequestException("ATTENDANCE_DAILY_STUDENT_NOT_ACTIVE_CLASS_MEMBER");
      }
      assertTeacherAssignedFromRecords(context, assignments, {
        tenantId: student.tenantId,
        studentId: student.id,
        classId,
      }, date);
      return student;
    });

    const terms = filterTenantResources(context, allTerms).filter((term) => !term.deletedAt);
    const term = terms.find((candidate) => candidate.startsAt <= date && candidate.endsAt >= date);
    if (!term) throw new BadRequestException("ATTENDANCE_ACTIVE_TERM_NOT_FOUND");

    const attendance = filterTenantResources(context, allAttendance)
      .filter((record) => uniqueStudentIds.has(record.studentId) && !record.deletedAt);
    const existingByStudentId = new Map(
      attendance.filter((record) => record.date === date).map((record) => [record.studentId, { ...record }]),
    );
    const previousAbsenceCounts = new Map(students.map((student) => [
      student.id,
      countAbsences(attendance.filter((record) => record.studentId === student.id)),
    ]));
    const studentByEntryId = new Map(students.map((student) => [student.id, student]));
    const records = await this.store.upsertDaily(input.entries.map((entry) => {
      const student = studentByEntryId.get(entry.studentId)!;
      return {
        tenantId: student.tenantId,
        studentId: student.id,
        termId: term.id,
        date,
        status: resolveStatus(entry.status),
      };
    }));

    for (const record of records) {
      const previous = existingByStudentId.get(record.studentId);
      await this.auditLogs?.record({
        tenantId: record.tenantId,
        actorUserId: context.userId,
        entityType: "Attendance",
        entityId: record.id,
        action: previous ? "attendance.updated" : "attendance.created",
        diff: previous
          ? { before: { status: previous.status }, after: { status: record.status }, classId, date }
          : { studentId: record.studentId, classId, termId: term.id, date, status: record.status },
      });
      const student = studentByEntryId.get(record.studentId)!;
      await this.warnIfAbsenceThresholdCrossed(
        context,
        { ...student, classId },
        previousAbsenceCounts.get(student.id) ?? 0,
        nextAbsenceCount(previousAbsenceCounts.get(student.id) ?? 0, existingByStudentId.get(student.id)?.status, record.status),
      );
    }

    return { records, summary: summarizeRecords(records) };
  }

  async listForTenantStudent(context: RequestContext, studentId: string): Promise<AttendanceRecord[]> {
    return this.list(context, { studentId });
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

  private async listForSubjectStudent(context: RequestContext, studentId: string): Promise<AttendanceRecord[]> {
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    const guardianIds = (await this.guardianStudentStore.listByStudent(student.id)).map((link) => link.guardianId);
    this.assertSubjectAccess(context, { ...student, guardianIds });
    return filterTenantResources(context, await this.store.listByStudent(student.id)).filter((record) => !record.deletedAt);
  }

  private async listRawForTenantStudent(context: RequestContext, studentId: string): Promise<AttendanceRecord[]> {
    const student = await this.findStudentForTenant(context, studentId);
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

  private assertTenantAccess(context: RequestContext, resource: { tenantId: string }): void {
    try {
      assertTenantResourceAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }
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

  private async filterForTeacherScope(
    context: RequestContext,
    records: AttendanceRecord[],
    enrollments: StudentEnrollmentRecord[],
  ): Promise<AttendanceRecord[]> {
    if (!isTeacherSubjectContext(context)) {
      return records;
    }

    const assignments = filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(context.subjectId));
    return records.filter((record) => {
      const enrollment = findEnrollmentAtDate(enrollments, record.studentId, record.date);
      return Boolean(enrollment?.classId && hasTeacherAssignmentForScope(assignments, {
        tenantId: record.tenantId,
        studentId: record.studentId,
        classId: enrollment.classId,
        courseId: record.courseId,
        termId: record.termId,
      }, record.date));
    });
  }

  private filterByStudentClass(
    records: AttendanceRecord[],
    classId: string | undefined,
    enrollments: StudentEnrollmentRecord[],
  ): AttendanceRecord[] {
    const normalizedClassId = optionalText(classId);
    if (!normalizedClassId) return records;

    return records.filter((record) =>
      findEnrollmentAtDate(enrollments, record.studentId, record.date)?.classId === normalizedClassId,
    );
  }

  private async listEnrollmentsForRecords(
    context: RequestContext,
    records: AttendanceRecord[],
  ): Promise<StudentEnrollmentRecord[]> {
    const studentIds = [...new Set(records.map((record) => record.studentId))];
    return filterTenantResources(context, await this.studentEnrollmentStore.listByStudents(studentIds));
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

    const announcement = await this.announcements.createStudentGuardianAlert(context, {
      tenantId: student.tenantId,
      studentId: student.id,
      title: "Devamsızlık eşiği uyarısı",
      body: "Öğrenciniz devamsızlık eşiğine ulaşmıştır. Lütfen veli panelinizden devamsızlık özetini kontrol edin.",
    });
    const announcementId = announcement?.id;

    await this.auditLogs?.record({
      tenantId: student.tenantId,
      actorUserId: context.userId,
      entityType: "Attendance",
      entityId: student.id,
      action: announcementId ? "attendance.threshold_warned" : "attendance.threshold_reached",
      diff: {
        studentId: student.id,
        classId: student.classId,
        previousAbsenceCount,
        currentAbsenceCount,
        threshold: absenceWarningThreshold,
        ...(announcementId ? { announcementId } : {}),
      },
    });
  }
}

function summarize(studentId: string, records: AttendanceRecord[]): AttendanceSummaryRecord {
  return { studentId, ...summarizeRecords(records) };
}

function summarizeRecords(records: AttendanceRecord[]): AttendanceAggregateRecord {
  return records.reduce<AttendanceAggregateRecord>(
    (summary, record) => {
      if (record.status === "PRESENT") summary.present += 1;
      if (record.status === "ABSENT") summary.absent += 1;
      if (record.status === "LATE") summary.late += 1;
      if (record.status === "EXCUSED") summary.excused += 1;
      summary.total += 1;
      return summary;
    },
    { total: 0, present: 0, absent: 0, late: 0, excused: 0 },
  );
}

function countAbsences(records: AttendanceRecord[]): number {
  return records.filter((record) => !record.deletedAt && record.status === "ABSENT").length;
}

function nextAbsenceCount(
  previousCount: number,
  previousStatus: AttendanceStatus | undefined,
  nextStatus: AttendanceStatus,
): number {
  return previousCount - (previousStatus === "ABSENT" ? 1 : 0) + (nextStatus === "ABSENT" ? 1 : 0);
}

function enrollmentContainsDate(enrollment: StudentEnrollmentRecord, date: string): boolean {
  return enrollment.startsAt <= date && (!enrollment.endsAt || enrollment.endsAt >= date);
}

function isStudentEligibleForAttendanceDate(status: string, date: string): boolean {
  return date < new Date().toISOString().slice(0, 10) || status === "ACTIVE";
}

function findEnrollmentAtDate(
  enrollments: StudentEnrollmentRecord[],
  studentId: string,
  date: string,
): StudentEnrollmentRecord | undefined {
  for (let index = enrollments.length - 1; index >= 0; index -= 1) {
    const enrollment = enrollments[index]!;
    if (enrollment.studentId === studentId && enrollmentContainsDate(enrollment, date)) return enrollment;
  }
  return undefined;
}

function requiredDate(value: string | undefined): string {
  const trimmed = requiredText(value, "ATTENDANCE_DATE_REQUIRED");
  if (!isCalendarDateString(trimmed)) {
    throw new BadRequestException("ATTENDANCE_DATE_INVALID");
  }
  return trimmed;
}

function optionalDate(value: string | undefined): string | undefined {
  return value === undefined ? undefined : requiredDate(value);
}

function isCalendarDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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
