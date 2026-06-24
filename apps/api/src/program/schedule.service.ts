import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { ScheduleLessonRecord as SharedScheduleLessonRecord } from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { SchoolService } from "../school/school.service.js";
import { assertTenantResourceAccess, filterTenantResources, isTeacherSubjectContext } from "../tenant/tenant-access.js";
import { type ScheduleStore, scheduleStoreToken } from "./schedule-store.js";

export interface ScheduleLessonRecord extends SharedScheduleLessonRecord {
  deletedAt?: string;
}

@Injectable()
export class ScheduleService {
  constructor(
    private readonly school: SchoolService,
    @Inject(scheduleStoreToken) private readonly store: ScheduleStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext): Promise<ScheduleLessonRecord[]> {
    return this.filterReadableLessons(context, filterTenantResources(context, await this.store.list()).filter((lesson) => !lesson.deletedAt));
  }

  async listCurrentTeacherLessons(context: RequestContext): Promise<ScheduleLessonRecord[]> {
    if (context.subjectType !== "TEACHER" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return (await this.list(context)).filter((lesson) => lesson.teacherId === context.subjectId);
  }

  async findOne(context: RequestContext, id: string): Promise<ScheduleLessonRecord> {
    const lesson = await this.store.findById(id);
    if (!lesson) {
      throw new NotFoundException("SCHEDULE_LESSON_NOT_FOUND");
    }
    if (lesson.deletedAt) {
      throw new NotFoundException("SCHEDULE_LESSON_NOT_FOUND");
    }

    this.assertReadAccess(context, lesson);
    return lesson;
  }

  async create(context: RequestContext, input: Partial<ScheduleLessonRecord>): Promise<ScheduleLessonRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    await this.assertClassAndTeacher(context, input.classId, input.teacherId);
    await this.assertCourse(context, input.courseId);
    await this.assertTerm(context, input.termId);
    const timeRange = this.resolveTimeRange(input.startsAt, input.endsAt);
    await this.assertTeacherAvailable(context, input.teacherId ?? "", timeRange.startsAt, timeRange.endsAt);

    const record = await this.writeSchedule(() =>
      this.store.create({
        tenantId,
        classId: input.classId ?? "",
        teacherId: input.teacherId ?? "",
        courseId: input.courseId,
        termId: input.termId,
        title: input.title ?? "",
        startsAt: timeRange.startsAt,
        endsAt: timeRange.endsAt,
      }),
    );
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "ScheduleLesson",
      entityId: record.id,
      action: "schedule_lesson.created",
      diff: {
        classId: record.classId,
        teacherId: record.teacherId,
        fieldsSet: presentFields(record, ["title", "startsAt", "endsAt"]),
      },
    });
    return record;
  }

  async update(context: RequestContext, id: string, input: Partial<ScheduleLessonRecord>): Promise<ScheduleLessonRecord> {
    const lesson = await this.findOne(context, id);
    const changedFields = changedInputFields(input, ["classId", "teacherId", "courseId", "termId", "title", "startsAt", "endsAt"]);
    const classId = input.classId ?? lesson.classId;
    const teacherId = input.teacherId ?? lesson.teacherId;
    const courseId = input.courseId ?? lesson.courseId;
    const termId = input.termId ?? lesson.termId;
    await this.assertClassAndTeacher(context, classId, teacherId);
    await this.assertCourse(context, courseId);
    await this.assertTerm(context, termId);
    const timeRange = this.resolveTimeRange(input.startsAt ?? lesson.startsAt, input.endsAt ?? lesson.endsAt);
    await this.assertTeacherAvailable(context, teacherId, timeRange.startsAt, timeRange.endsAt, id);

    const record = await this.writeSchedule(() =>
      this.store.update(id, {
        classId,
        teacherId,
        courseId,
        termId,
        title: input.title ?? lesson.title,
        startsAt: timeRange.startsAt,
        endsAt: timeRange.endsAt,
      }),
    );
    if (!record) {
      throw new NotFoundException("SCHEDULE_LESSON_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "ScheduleLesson",
      entityId: record.id,
      action: "schedule_lesson.updated",
      diff: { fieldsChanged: changedFields },
    });
    return record;
  }

  async delete(context: RequestContext, id: string): Promise<void> {
    await this.findOne(context, id);
    const lesson = await this.store.softDelete(id, new Date().toISOString());
    if (!lesson) {
      throw new NotFoundException("SCHEDULE_LESSON_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: lesson.tenantId,
      actorUserId: context.userId,
      entityType: "ScheduleLesson",
      entityId: lesson.id,
      action: "schedule_lesson.deleted",
      diff: { deletedAt: lesson.deletedAt },
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

  private async assertClassAndTeacher(context: RequestContext, classId: string | undefined, teacherId: string | undefined) {
    if (!classId || !teacherId) {
      throw new BadRequestException("SCHEDULE_LESSON_LINK_REQUIRED");
    }

    await this.school.findClass(context, classId);
    await this.school.findTeacher(context, teacherId);
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

  private resolveTimeRange(startsAt: string | undefined, endsAt: string | undefined): { startsAt: string; endsAt: string } {
    const startTime = parseIsoDateTime(startsAt, "SCHEDULE_LESSON_TIME_INVALID");
    const endTime = parseIsoDateTime(endsAt, "SCHEDULE_LESSON_TIME_INVALID");
    if (startTime >= endTime) {
      throw new BadRequestException("SCHEDULE_LESSON_TIME_INVALID");
    }

    return {
      startsAt: new Date(startTime).toISOString(),
      endsAt: new Date(endTime).toISOString(),
    };
  }

  private async assertTeacherAvailable(
    context: RequestContext,
    teacherId: string,
    startsAt: string,
    endsAt: string,
    excludedLessonId?: string,
  ): Promise<void> {
    const startTime = Date.parse(startsAt);
    const endTime = Date.parse(endsAt);
    const conflictingLesson = (await this.list(context)).find(
      (lesson) =>
        lesson.id !== excludedLessonId &&
        lesson.teacherId === teacherId &&
        startTime < Date.parse(lesson.endsAt) &&
        endTime > Date.parse(lesson.startsAt),
    );

    if (conflictingLesson) {
      throw new ConflictException("SCHEDULE_TEACHER_CONFLICT");
    }
  }

  private assertAccess(context: RequestContext, resource: { tenantId: string }): void {
    try {
      assertTenantResourceAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }
  }

  private assertReadAccess(context: RequestContext, lesson: ScheduleLessonRecord): void {
    this.assertAccess(context, lesson);
    if (isTeacherSubjectContext(context) && lesson.teacherId !== context.subjectId) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }
  }

  private filterReadableLessons(context: RequestContext, lessons: ScheduleLessonRecord[]): ScheduleLessonRecord[] {
    if (!isTeacherSubjectContext(context)) {
      return lessons;
    }

    return lessons.filter((lesson) => lesson.teacherId === context.subjectId);
  }

  private async writeSchedule<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof Error && error.message === "SCHEDULE_TEACHER_CONFLICT") {
        throw new ConflictException("SCHEDULE_TEACHER_CONFLICT");
      }
      throw error;
    }
  }
}

function parseIsoDateTime(value: string | undefined, errorCode: string): number {
  const trimmed = value?.trim();
  if (!trimmed || !isIsoDateTimeString(trimmed)) {
    throw new BadRequestException(errorCode);
  }
  return Date.parse(trimmed);
}

function isIsoDateTimeString(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  return Boolean(match?.[1] && isCalendarDateString(match[1]) && !Number.isNaN(Date.parse(value)));
}

function isCalendarDateString(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
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
