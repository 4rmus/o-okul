import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { AttendanceRecord, AttendanceStatus, AttendanceSummaryRecord } from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import {
  assertSubjectResourceAccess,
  assertTenantResourceAccess,
  filterTeacherScopedStudents,
  filterTenantResources,
  isTeacherSubjectContext,
} from "../tenant/tenant-access.js";
import { type AttendanceStore, attendanceStoreToken } from "./attendance-store.js";

export type AttendanceInput = Pick<AttendanceRecord, "studentId" | "date" | "status">;

const attendanceStatuses: AttendanceStatus[] = ["PRESENT", "ABSENT", "LATE", "EXCUSED"];

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(attendanceStoreToken) private readonly store: AttendanceStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext): Promise<AttendanceRecord[]> {
    return this.filterForTeacherScope(context, filterTenantResources(context, await this.store.list()).filter((record) => !record.deletedAt));
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
    const date = requiredDate(input.date);
    const status = resolveStatus(input.status);
    const existing = await this.store.findByStudentDate(student.id, date);
    if (existing) {
      throw new ConflictException("ATTENDANCE_ALREADY_EXISTS");
    }

    const record = await this.store.create({
      tenantId: student.tenantId,
      studentId: student.id,
      date,
      status,
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Attendance",
      entityId: record.id,
      action: "attendance.created",
      diff: { studentId: record.studentId, date: record.date, status: record.status },
    });
    return record;
  }

  async update(context: RequestContext, id: string, input: Partial<Pick<AttendanceRecord, "status">>): Promise<AttendanceRecord> {
    const existing = await this.findOneForTenant(context, id);
    const status = resolveStatus(input.status);
    const record = await this.store.update(id, { status });
    if (!record) {
      throw new NotFoundException("ATTENDANCE_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Attendance",
      entityId: record.id,
      action: "attendance.updated",
      diff: { before: { status: existing.status }, after: { status: record.status } },
    });
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
    this.assertTeacherScope(context, student);
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

  private assertTeacherScope(context: RequestContext, resource: { tenantId: string; responsibleTeacherId?: string }): void {
    const scoped = filterTeacherScopedStudents(context, [resource]);
    if (scoped.length === 0) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }
  }

  private async filterForTeacherScope(context: RequestContext, records: AttendanceRecord[]): Promise<AttendanceRecord[]> {
    if (!isTeacherSubjectContext(context)) {
      return records;
    }

    const scopedStudentIds = new Set(filterTeacherScopedStudents(context, await this.studentStore.list()).map((student) => student.id));
    return records.filter((record) => scopedStudentIds.has(record.studentId));
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

function resolveStatus(value: AttendanceStatus | undefined): AttendanceStatus {
  if (!value || !attendanceStatuses.includes(value)) {
    throw new BadRequestException("ATTENDANCE_STATUS_INVALID");
  }
  return value;
}
