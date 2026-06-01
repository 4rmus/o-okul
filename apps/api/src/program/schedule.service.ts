import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { ScheduleLessonRecord as SharedScheduleLessonRecord } from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { SchoolService } from "../school/school.service.js";
import { assertTenantResourceAccess, filterTenantResources } from "../tenant/tenant-access.js";
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
    return filterTenantResources(context, await this.store.list()).filter((lesson) => !lesson.deletedAt);
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

    this.assertAccess(context, lesson);
    return lesson;
  }

  async create(context: RequestContext, input: Partial<ScheduleLessonRecord>): Promise<ScheduleLessonRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    await this.assertClassAndTeacher(context, input.classId, input.teacherId);
    const timeRange = this.resolveTimeRange(input.startsAt, input.endsAt);
    await this.assertTeacherAvailable(context, input.teacherId ?? "", timeRange.startsAt, timeRange.endsAt);

    const record = await this.writeSchedule(() =>
      this.store.create({
        tenantId,
        classId: input.classId ?? "",
        teacherId: input.teacherId ?? "",
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
    const changedFields = changedInputFields(input, ["classId", "teacherId", "title", "startsAt", "endsAt"]);
    const classId = input.classId ?? lesson.classId;
    const teacherId = input.teacherId ?? lesson.teacherId;
    await this.assertClassAndTeacher(context, classId, teacherId);
    const timeRange = this.resolveTimeRange(input.startsAt ?? lesson.startsAt, input.endsAt ?? lesson.endsAt);
    await this.assertTeacherAvailable(context, teacherId, timeRange.startsAt, timeRange.endsAt, id);

    const record = await this.writeSchedule(() =>
      this.store.update(id, {
        classId,
        teacherId,
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

  private resolveTimeRange(startsAt: string | undefined, endsAt: string | undefined): { startsAt: string; endsAt: string } {
    const startTime = Date.parse(startsAt ?? "");
    const endTime = Date.parse(endsAt ?? "");
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime >= endTime) {
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

function presentFields<TRecord extends object>(record: TRecord, fields: Array<keyof TRecord>): string[] {
  return fields.filter((field) => record[field] !== undefined && record[field] !== "").map(String);
}

function changedInputFields<TRecord extends object>(
  input: Partial<TRecord>,
  fields: Array<keyof TRecord>,
): string[] {
  return fields.filter((field) => input[field] !== undefined).map(String);
}
