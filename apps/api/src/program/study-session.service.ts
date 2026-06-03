import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { StudySessionRecord as SharedStudySessionRecord } from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { SchoolService } from "../school/school.service.js";
import { StudentService } from "../student/student.service.js";
import { assertTenantResourceAccess, filterTenantResources, isTeacherSubjectContext } from "../tenant/tenant-access.js";
import { type StudySessionStore, studySessionStoreToken } from "./study-session-store.js";

export interface StudySessionRecord extends SharedStudySessionRecord {
  deletedAt?: string;
}

@Injectable()
export class StudySessionService {
  constructor(
    private readonly school: SchoolService,
    private readonly students: StudentService,
    @Inject(studySessionStoreToken) private readonly store: StudySessionStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext): Promise<StudySessionRecord[]> {
    return this.filterReadableSessions(context, filterTenantResources(context, await this.store.list()).filter((session) => !session.deletedAt));
  }

  async findOne(context: RequestContext, id: string): Promise<StudySessionRecord> {
    const session = await this.store.findById(id);
    if (!session) {
      throw new NotFoundException("STUDY_SESSION_NOT_FOUND");
    }
    if (session.deletedAt) {
      throw new NotFoundException("STUDY_SESSION_NOT_FOUND");
    }

    this.assertReadAccess(context, session);
    return session;
  }

  async create(context: RequestContext, input: Partial<StudySessionRecord>): Promise<StudySessionRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    await this.assertLinks(context, input.classId, input.teacherId, input.studentIds);
    await this.assertCourse(context, input.courseId);
    await this.assertTerm(context, input.termId);
    const capacity = this.resolveCapacity(input.capacity, input.studentIds);
    const timeRange = this.resolveTimeRange(input.startsAt, input.endsAt);
    await this.assertAvailable(context, input.teacherId ?? "", input.studentIds ?? [], timeRange.startsAt, timeRange.endsAt);

    const record = await this.writeStudySession(() =>
      this.store.create({
        tenantId,
        classId: input.classId ?? "",
        teacherId: input.teacherId ?? "",
        courseId: input.courseId,
        termId: input.termId,
        studentIds: input.studentIds ?? [],
        title: input.title ?? "",
        capacity,
        startsAt: timeRange.startsAt,
        endsAt: timeRange.endsAt,
      }),
    );
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "StudySession",
      entityId: record.id,
      action: "study_session.created",
      diff: {
        classId: record.classId,
        teacherId: record.teacherId,
        studentCount: record.studentIds.length,
        capacity: record.capacity,
        fieldsSet: presentFields(record, ["title", "startsAt", "endsAt"]),
      },
    });
    return record;
  }

  async update(context: RequestContext, id: string, input: Partial<StudySessionRecord>): Promise<StudySessionRecord> {
    const session = await this.findOne(context, id);
    const changedFields = changedInputFields(input, ["classId", "teacherId", "courseId", "termId", "studentIds", "title", "capacity", "startsAt", "endsAt"]);
    const classId = input.classId ?? session.classId;
    const teacherId = input.teacherId ?? session.teacherId;
    const courseId = input.courseId ?? session.courseId;
    const termId = input.termId ?? session.termId;
    const studentIds = input.studentIds ?? session.studentIds;
    await this.assertLinks(context, classId, teacherId, studentIds);
    await this.assertCourse(context, courseId);
    await this.assertTerm(context, termId);
    const capacity = this.resolveCapacity(input.capacity ?? session.capacity, studentIds);
    const timeRange = this.resolveTimeRange(input.startsAt ?? session.startsAt, input.endsAt ?? session.endsAt);
    await this.assertAvailable(context, teacherId, studentIds, timeRange.startsAt, timeRange.endsAt, id);

    const record = await this.writeStudySession(() =>
      this.store.update(id, {
        classId,
        teacherId,
        courseId,
        termId,
        studentIds,
        title: input.title ?? session.title,
        capacity,
        startsAt: timeRange.startsAt,
        endsAt: timeRange.endsAt,
      }),
    );
    if (!record) {
      throw new NotFoundException("STUDY_SESSION_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "StudySession",
      entityId: record.id,
      action: "study_session.updated",
      diff: { fieldsChanged: changedFields },
    });
    return record;
  }

  async delete(context: RequestContext, id: string): Promise<void> {
    await this.findOne(context, id);
    const session = await this.store.softDelete(id, new Date().toISOString());
    if (!session) {
      throw new NotFoundException("STUDY_SESSION_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: session.tenantId,
      actorUserId: context.userId,
      entityType: "StudySession",
      entityId: session.id,
      action: "study_session.deleted",
      diff: { deletedAt: session.deletedAt },
    });
  }

  private resolveTenantId(context: RequestContext, tenantId: string | undefined): string {
    const resolvedTenantId = tenantId ?? context.tenantId;
    if (!resolvedTenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId: resolvedTenantId });
    return resolvedTenantId;
  }

  private async assertLinks(
    context: RequestContext,
    classId: string | undefined,
    teacherId: string | undefined,
    studentIds: string[] | undefined,
  ): Promise<void> {
    if (!classId || !teacherId || !studentIds?.length) {
      throw new BadRequestException("STUDY_SESSION_LINK_REQUIRED");
    }

    await this.school.findClass(context, classId);
    await this.school.findTeacher(context, teacherId);
    await Promise.all(studentIds.map((studentId) => this.students.findOne(context, studentId)));
  }

  private async assertCourse(context: RequestContext, courseId: string | undefined) {
    if (!courseId) {
      return;
    }

    await this.school.findCourse(context, courseId);
  }

  private async assertTerm(context: RequestContext, termId: string | undefined) {
    if (!termId) {
      return;
    }

    await this.school.findAcademicTerm(context, termId);
  }

  private resolveCapacity(capacity: number | undefined, studentIds: string[] | undefined): number {
    if (typeof capacity !== "number" || !Number.isInteger(capacity) || capacity < 1) {
      throw new BadRequestException("STUDY_SESSION_CAPACITY_INVALID");
    }

    if ((studentIds?.length ?? 0) > capacity) {
      throw new BadRequestException("STUDY_SESSION_CAPACITY_EXCEEDED");
    }

    return capacity;
  }

  private resolveTimeRange(startsAt: string | undefined, endsAt: string | undefined): { startsAt: string; endsAt: string } {
    const startTime = Date.parse(startsAt ?? "");
    const endTime = Date.parse(endsAt ?? "");
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
      throw new BadRequestException("STUDY_SESSION_TIME_INVALID");
    }

    return {
      startsAt: new Date(startTime).toISOString(),
      endsAt: new Date(endTime).toISOString(),
    };
  }

  private async assertAvailable(
    context: RequestContext,
    teacherId: string,
    studentIds: string[],
    startsAt: string,
    endsAt: string,
    excludedSessionId?: string,
  ): Promise<void> {
    const startTime = Date.parse(startsAt);
    const endTime = Date.parse(endsAt);
    const conflictingSession = (await this.list(context)).find(
      (session) =>
        session.id !== excludedSessionId &&
        startTime < Date.parse(session.endsAt) &&
        endTime > Date.parse(session.startsAt) &&
        (session.teacherId === teacherId || session.studentIds.some((studentId) => studentIds.includes(studentId))),
    );

    if (!conflictingSession) {
      return;
    }

    if (conflictingSession.teacherId === teacherId) {
      throw new ConflictException("STUDY_SESSION_TEACHER_CONFLICT");
    }

    throw new ConflictException("STUDY_SESSION_STUDENT_CONFLICT");
  }

  private assertAccess(context: RequestContext, resource: { tenantId: string }): void {
    try {
      assertTenantResourceAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }
  }

  private assertReadAccess(context: RequestContext, session: StudySessionRecord): void {
    this.assertAccess(context, session);
    if (isTeacherSubjectContext(context) && session.teacherId !== context.subjectId) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }
  }

  private filterReadableSessions(context: RequestContext, sessions: StudySessionRecord[]): StudySessionRecord[] {
    if (!isTeacherSubjectContext(context)) {
      return sessions;
    }

    return sessions.filter((session) => session.teacherId === context.subjectId);
  }

  private async writeStudySession<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Error && error.message === "STUDY_SESSION_TEACHER_CONFLICT") {
        throw new ConflictException("STUDY_SESSION_TEACHER_CONFLICT");
      }
      if (error instanceof Error && error.message === "STUDY_SESSION_STUDENT_CONFLICT") {
        throw new ConflictException("STUDY_SESSION_STUDENT_CONFLICT");
      }
      throw error;
    }
  }
}

function presentFields<TRecord extends object>(record: TRecord, fields: Array<keyof TRecord>): string[] {
  return fields.filter((field) => record[field] !== undefined && record[field] !== "").map(String);
}

function changedInputFields<TRecord extends object>(
  input: Partial<TRecord>,
  fields: Array<keyof TRecord>,
): string[] {
  return fields.filter((field) => input[field] !== undefined).map(String);
}
