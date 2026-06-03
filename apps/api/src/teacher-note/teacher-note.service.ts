import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { TeacherNoteRecord, TeacherNoteVisibility } from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { type AcademicCalendarStore, academicCalendarStoreToken } from "../school/academic-calendar-store.js";
import { type CourseStore, courseStoreToken } from "../school/course-store.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import {
  assertSubjectResourceAccess,
  assertTeacherScopedStudentAccess,
  assertTenantResourceAccess,
  filterTeacherScopedStudents,
  filterTenantResources,
  isTeacherSubjectContext,
} from "../tenant/tenant-access.js";
import { type TeacherNoteStore, teacherNoteStoreToken } from "./teacher-note-store.js";

export type TeacherNoteInput = Pick<TeacherNoteRecord, "studentId" | "body" | "visibility"> &
  Pick<Partial<TeacherNoteRecord>, "teacherId" | "courseId" | "termId" | "developmentStatus">;

export interface TeacherNoteListFilters {
  classId?: string;
  studentId?: string;
}

const noteVisibilities: TeacherNoteVisibility[] = ["INTERNAL", "GUARDIAN_STUDENT"];

@Injectable()
export class TeacherNoteService {
  constructor(
    @Inject(teacherNoteStoreToken) private readonly store: TeacherNoteStore,
    @Inject(academicCalendarStoreToken) private readonly academicCalendarStore: AcademicCalendarStore,
    @Inject(courseStoreToken) private readonly courseStore: CourseStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(teacherStoreToken) private readonly teacherStore: TeacherStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext, filters: TeacherNoteListFilters = {}): Promise<TeacherNoteRecord[]> {
    const notes = filters.studentId
      ? await this.listForTenantStudent(context, filters.studentId)
      : await this.filterForTeacherScope(context, filterTenantResources(context, await this.store.list()).filter((note) => !note.deletedAt));
    return this.filterByStudentClass(context, notes, filters.classId);
  }

  async listCurrentStudent(context: RequestContext): Promise<TeacherNoteRecord[]> {
    if (context.subjectType !== "STUDENT" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return this.listVisibleForSubjectStudent(context, context.subjectId);
  }

  async listCurrentGuardianStudent(context: RequestContext, studentId: string): Promise<TeacherNoteRecord[]> {
    if (context.subjectType !== "GUARDIAN" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    return this.listVisibleForSubjectStudent(context, studentId);
  }

  async create(context: RequestContext, input: Partial<TeacherNoteInput>): Promise<TeacherNoteRecord> {
    const student = await this.findStudentForTeacherScope(context, requiredText(input.studentId, "TEACHER_NOTE_STUDENT_REQUIRED"));
    const teacher = await this.findTeacherForTenant(context, await this.resolveTeacherId(context, input.teacherId));
    const academicContext = await this.resolveAcademicContext(context, student.tenantId, input);
    const record = await this.store.create({
      tenantId: student.tenantId,
      studentId: student.id,
      teacherId: teacher.id,
      ...academicContext,
      visibility: resolveVisibility(input.visibility),
      body: requiredText(input.body, "TEACHER_NOTE_BODY_REQUIRED"),
      developmentStatus: optionalText(input.developmentStatus),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "TeacherNote",
      entityId: record.id,
      action: "teacher_note.created",
      diff: {
        studentId: record.studentId,
        teacherId: record.teacherId,
        courseId: record.courseId,
        termId: record.termId,
        visibility: record.visibility,
        developmentStatus: record.developmentStatus,
      },
    });
    return record;
  }

  async update(
    context: RequestContext,
    id: string,
    input: Partial<Pick<TeacherNoteRecord, "body" | "visibility" | "courseId" | "termId" | "developmentStatus">>,
  ): Promise<TeacherNoteRecord> {
    const existing = await this.findOneForTenant(context, id);
    const academicContext = await this.resolveAcademicContext(context, existing.tenantId, input);
    const record = await this.store.update(id, {
      body: input.body !== undefined ? requiredText(input.body, "TEACHER_NOTE_BODY_REQUIRED") : existing.body,
      visibility: input.visibility !== undefined ? resolveVisibility(input.visibility) : existing.visibility,
      ...academicContext,
      developmentStatus:
        input.developmentStatus !== undefined ? optionalText(input.developmentStatus) : existing.developmentStatus,
    });
    if (!record) {
      throw new NotFoundException("TEACHER_NOTE_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "TeacherNote",
      entityId: record.id,
      action: "teacher_note.updated",
      diff: {
        before: { courseId: existing.courseId, termId: existing.termId, visibility: existing.visibility, developmentStatus: existing.developmentStatus },
        after: { courseId: record.courseId, termId: record.termId, visibility: record.visibility, developmentStatus: record.developmentStatus },
      },
    });
    return record;
  }

  async delete(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findOneForTenant(context, id);
    const record = await this.store.softDelete(id, new Date().toISOString());
    if (!record) {
      throw new NotFoundException("TEACHER_NOTE_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "TeacherNote",
      entityId: record.id,
      action: "teacher_note.deleted",
      diff: { studentId: existing.studentId, teacherId: existing.teacherId, deletedAt: record.deletedAt },
    });
  }

  private async listVisibleForSubjectStudent(context: RequestContext, studentId: string): Promise<TeacherNoteRecord[]> {
    const student = await this.studentStore.findById(studentId);
    if (!student) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }

    const guardianIds = (await this.guardianStudentStore.listByStudent(student.id)).map((link) => link.guardianId);
    this.assertSubjectAccess(context, { ...student, guardianIds });
    return filterTenantResources(context, await this.store.listByStudent(student.id)).filter(
      (note) => !note.deletedAt && note.visibility === "GUARDIAN_STUDENT",
    );
  }

  private async listForTenantStudent(context: RequestContext, studentId: string): Promise<TeacherNoteRecord[]> {
    const student = await this.findStudentForTeacherScope(context, studentId);
    return filterTenantResources(context, await this.store.listByStudent(student.id)).filter((note) => !note.deletedAt);
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

  private async findTeacherForTenant(context: RequestContext, teacherId: string) {
    const teacher = await this.teacherStore.findById(teacherId);
    if (!teacher) {
      throw new NotFoundException("TEACHER_NOT_FOUND");
    }

    this.assertTenantAccess(context, teacher);
    return teacher;
  }

  private async findOneForTenant(context: RequestContext, id: string): Promise<TeacherNoteRecord> {
    const record = await this.store.findById(id);
    if (!record) {
      throw new NotFoundException("TEACHER_NOTE_NOT_FOUND");
    }

    this.assertTenantAccess(context, record);
    await this.assertNoteTeacherScope(context, record);
    return record;
  }

  private async resolveTeacherId(context: RequestContext, teacherId: string | undefined): Promise<string> {
    if (context.subjectType === "TEACHER" && context.subjectId) {
      return context.subjectId;
    }

    return requiredText(teacherId, "TEACHER_NOTE_TEACHER_REQUIRED");
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
    input: Partial<Pick<TeacherNoteRecord, "courseId" | "termId">>,
  ): Promise<Pick<Partial<TeacherNoteRecord>, "courseId" | "termId">> {
    const result: Pick<Partial<TeacherNoteRecord>, "courseId" | "termId"> = {};
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

  private assertTeacherScope(context: RequestContext, resource: { tenantId: string; responsibleTeacherId?: string }): void {
    try {
      assertTeacherScopedStudentAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_SUBJECT";
      throw new ForbiddenException(message);
    }
  }

  private async assertNoteTeacherScope(context: RequestContext, note: TeacherNoteRecord): Promise<void> {
    if (!isTeacherSubjectContext(context)) {
      return;
    }

    if (note.teacherId !== context.subjectId) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }

    await this.findStudentForTeacherScope(context, note.studentId);
  }

  private async filterForTeacherScope(context: RequestContext, notes: TeacherNoteRecord[]): Promise<TeacherNoteRecord[]> {
    if (!isTeacherSubjectContext(context)) {
      return notes;
    }

    const scopedStudentIds = new Set(filterTeacherScopedStudents(context, await this.studentStore.list()).map((student) => student.id));
    return notes.filter((note) => note.teacherId === context.subjectId && scopedStudentIds.has(note.studentId));
  }

  private async filterByStudentClass(context: RequestContext, notes: TeacherNoteRecord[], classId: string | undefined): Promise<TeacherNoteRecord[]> {
    const normalizedClassId = optionalText(classId);
    if (!normalizedClassId) return notes;

    const studentIds = new Set(
      filterTenantResources(context, await this.studentStore.list())
        .filter((student) => student.classId === normalizedClassId)
        .map((student) => student.id),
    );
    return notes.filter((note) => studentIds.has(note.studentId));
  }
}

function requiredText(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function resolveVisibility(value: TeacherNoteVisibility | undefined): TeacherNoteVisibility {
  if (!value || !noteVisibilities.includes(value)) {
    throw new BadRequestException("TEACHER_NOTE_VISIBILITY_INVALID");
  }
  return value;
}
