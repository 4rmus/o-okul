import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  HomeworkMaterialAssignmentRecord as SharedHomeworkMaterialAssignmentRecord,
  HomeworkMaterialFileRecord as SharedHomeworkMaterialFileRecord,
  HomeworkMaterialRecord as SharedHomeworkMaterialRecord,
  HomeworkRecord as SharedHomeworkRecord,
  UploadContentType,
} from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { type ScheduleStore, scheduleStoreToken } from "../program/schedule-store.js";
import { SchoolService } from "../school/school.service.js";
import { StudentService } from "../student/student.service.js";
import { assertTenantResourceAccess, filterTenantResources, isTeacherSubjectContext } from "../tenant/tenant-access.js";
import { assertUploadContentMatchesContentType } from "../upload/upload-validation.js";
import { type HomeworkStore, homeworkStoreToken } from "./homework-store.js";

export interface HomeworkRecord extends SharedHomeworkRecord {
  deletedAt?: string;
}

export interface HomeworkMaterialRecord extends SharedHomeworkMaterialRecord {
  deletedAt?: string;
}

export interface HomeworkMaterialFileRecord extends SharedHomeworkMaterialFileRecord {
  contentBase64?: string;
  deletedAt?: string;
}

export interface HomeworkMaterialAssignmentRecord extends SharedHomeworkMaterialAssignmentRecord {
  deletedAt?: string;
}

export type HomeworkMaterialFileContentType = UploadContentType;

export interface CreateHomeworkMaterialFileInput {
  fileName?: string;
  contentType?: string;
  fileBase64?: string;
}

export interface CreateHomeworkMaterialAssignmentInput {
  studentId?: string;
  note?: string;
  dueAt?: string;
}

const maxMaterialFileBytes = 64 * 1024;

@Injectable()
export class HomeworkService {
  constructor(
    private readonly school: SchoolService,
    private readonly students: StudentService,
    @Inject(homeworkStoreToken) private readonly store: HomeworkStore,
    @Inject(scheduleStoreToken) private readonly scheduleStore: ScheduleStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async listMaterials(context: RequestContext): Promise<HomeworkMaterialRecord[]> {
    return filterTenantResources(context, await this.store.listMaterials()).filter((material) => !material.deletedAt);
  }

  async findMaterial(context: RequestContext, id: string | undefined): Promise<HomeworkMaterialRecord> {
    if (!id) {
      throw new BadRequestException("HOMEWORK_MATERIAL_REQUIRED");
    }

    const material = await this.store.findMaterialById(id);
    if (!material) {
      throw new NotFoundException("HOMEWORK_MATERIAL_NOT_FOUND");
    }
    if (material.deletedAt) {
      throw new NotFoundException("HOMEWORK_MATERIAL_NOT_FOUND");
    }

    this.assertAccess(context, material);
    return material;
  }

  async createMaterial(
    context: RequestContext,
    input: Partial<HomeworkMaterialRecord>,
  ): Promise<HomeworkMaterialRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);

    const record = await this.store.createMaterial({
      tenantId,
      title: requiredText(input.title, "HOMEWORK_MATERIAL_TITLE_REQUIRED"),
      description: optionalText(input.description),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "HomeworkMaterial",
      entityId: record.id,
      action: "homework_material.created",
      diff: { fieldsSet: presentFields(record, ["title", "description"]) },
    });
    return record;
  }

  async updateMaterial(
    context: RequestContext,
    id: string,
    input: Partial<HomeworkMaterialRecord>,
  ): Promise<HomeworkMaterialRecord> {
    const material = await this.findMaterial(context, id);
    const record = await this.store.updateMaterial(id, {
      title: input.title !== undefined ? requiredText(input.title, "HOMEWORK_MATERIAL_TITLE_REQUIRED") : material.title,
      description: input.description !== undefined ? optionalText(input.description) : material.description,
    });
    if (!record) {
      throw new NotFoundException("HOMEWORK_MATERIAL_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "HomeworkMaterial",
      entityId: record.id,
      action: "homework_material.updated",
      diff: { fieldsChanged: changedInputFields(input, ["title", "description"]) },
    });
    return record;
  }

  async deleteMaterial(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findMaterial(context, id);
    const material = await this.store.softDeleteMaterial(id, new Date().toISOString());
    if (!material) {
      throw new NotFoundException("HOMEWORK_MATERIAL_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: material.tenantId,
      actorUserId: context.userId,
      entityType: "HomeworkMaterial",
      entityId: material.id,
      action: "homework_material.deleted",
      diff: { fieldsPresent: presentFields(existing, ["title", "description"]), deletedAt: material.deletedAt },
    });
  }

  async listMaterialFiles(context: RequestContext, materialId: string): Promise<HomeworkMaterialFileRecord[]> {
    await this.findMaterial(context, materialId);
    return filterTenantResources(context, await this.store.listMaterialFiles(materialId)).filter((file) => !file.deletedAt);
  }

  async addMaterialFile(
    context: RequestContext,
    materialId: string,
    input: CreateHomeworkMaterialFileInput,
  ): Promise<HomeworkMaterialFileRecord> {
    const material = await this.findMaterial(context, materialId);
    const body = readMaterialFileBytes(input.fileBase64);
    const contentType = resolveMaterialFileContentType(input.contentType);
    assertUploadContentMatchesContentType(body, contentType, "HOMEWORK_MATERIAL_FILE_CONTENT_MISMATCH");

    const record = await this.store.createMaterialFile({
      tenantId: material.tenantId,
      materialId: material.id,
      uploadedById: context.userId,
      fileName: normalizeMaterialFileName(input.fileName),
      contentType,
      byteSize: body.length,
      sha256: createSha256(body),
      contentBase64: body.toString("base64"),
      createdAt: new Date().toISOString(),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "HomeworkMaterialFile",
      entityId: record.id,
      action: "homework_material_file.created",
      diff: {
        materialId: record.materialId,
        contentType: record.contentType,
        byteSize: record.byteSize,
        sha256: record.sha256,
      },
    });
    return record;
  }

  async listMaterialAssignments(
    context: RequestContext,
    materialId: string,
  ): Promise<HomeworkMaterialAssignmentRecord[]> {
    await this.findMaterial(context, materialId);
    const assignments = filterTenantResources(context, await this.store.listMaterialAssignments(materialId)).filter(
      (assignment) => !assignment.deletedAt,
    );
    return this.filterMaterialAssignmentsForTeacherScope(context, assignments);
  }

  async listCurrentStudentMaterialAssignments(context: RequestContext): Promise<HomeworkMaterialAssignmentRecord[]> {
    const student = await this.students.findCurrentStudent(context);
    return this.listStudentMaterialAssignments(context, [student.id]);
  }

  async listCurrentGuardianMaterialAssignments(context: RequestContext): Promise<HomeworkMaterialAssignmentRecord[]> {
    const students = await this.students.listCurrentGuardianStudents(context);
    return this.listStudentMaterialAssignments(context, students.map((student) => student.id));
  }

  async assignMaterial(
    context: RequestContext,
    materialId: string,
    input: CreateHomeworkMaterialAssignmentInput,
  ): Promise<HomeworkMaterialAssignmentRecord> {
    const material = await this.findMaterial(context, materialId);
    if (!input.studentId) {
      throw new BadRequestException("HOMEWORK_MATERIAL_ASSIGNMENT_STUDENT_REQUIRED");
    }

    await this.students.findOne(context, input.studentId);

    const record = await this.store.createMaterialAssignment({
      tenantId: material.tenantId,
      materialId: material.id,
      studentId: input.studentId,
      assignedById: context.userId,
      note: optionalText(input.note),
      dueAt: this.resolveOptionalDate(input.dueAt),
      createdAt: new Date().toISOString(),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "HomeworkMaterialAssignment",
      entityId: record.id,
      action: "homework_material_assignment.created",
      diff: {
        materialId: record.materialId,
        studentId: record.studentId,
        fieldsSet: presentFields(record, ["note", "dueAt"]),
      },
    });
    return record;
  }

  async list(context: RequestContext): Promise<HomeworkRecord[]> {
    return this.filterHomeworkForTeacherScope(context, filterTenantResources(context, await this.store.list()).filter((homework) => !homework.deletedAt));
  }

  async findOne(context: RequestContext, id: string): Promise<HomeworkRecord> {
    const homework = await this.store.findById(id);
    if (!homework) {
      throw new NotFoundException("HOMEWORK_NOT_FOUND");
    }
    if (homework.deletedAt) {
      throw new NotFoundException("HOMEWORK_NOT_FOUND");
    }

    this.assertAccess(context, homework);
    await this.assertHomeworkTeacherScope(context, homework);
    return homework;
  }

  async create(context: RequestContext, input: Partial<HomeworkRecord>): Promise<HomeworkRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    await this.assertClassAccess(context, input.classId);
    const dueAt = this.resolveOptionalDate(input.dueAt);

    const record = await this.store.create({
      tenantId,
      classId: input.classId ?? "",
      title: input.title ?? "",
      description: input.description,
      dueAt,
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Homework",
      entityId: record.id,
      action: "homework.created",
      diff: { classId: record.classId, fieldsSet: presentFields(record, ["title", "description", "dueAt"]) },
    });
    return record;
  }

  async createFromMaterial(
    context: RequestContext,
    input: { tenantId?: string; classId?: string; materialId?: string; dueAt?: string },
  ): Promise<HomeworkRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    await this.assertClassAccess(context, input.classId);
    const material = await this.findMaterial(context, input.materialId);
    const dueAt = this.resolveOptionalDate(input.dueAt);

    const record = await this.store.create({
      tenantId,
      classId: input.classId ?? "",
      sourceMaterialId: material.id,
      sourceMaterialTitle: material.title,
      title: material.title,
      description: material.description,
      dueAt,
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Homework",
      entityId: record.id,
      action: "homework.created_from_material",
      diff: { classId: record.classId, sourceMaterialId: material.id, fieldsSet: presentFields(record, ["dueAt"]) },
    });
    return record;
  }

  async update(context: RequestContext, id: string, input: Partial<HomeworkRecord>): Promise<HomeworkRecord> {
    const homework = await this.findOne(context, id);
    const classId = input.classId ?? homework.classId;
    await this.assertClassAccess(context, classId);

    const record = await this.store.update(id, {
      classId,
      title: input.title ?? homework.title,
      description: input.description,
      dueAt: input.dueAt !== undefined ? this.resolveOptionalDate(input.dueAt) : undefined,
    });
    if (!record) {
      throw new NotFoundException("HOMEWORK_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Homework",
      entityId: record.id,
      action: "homework.updated",
      diff: { fieldsChanged: changedInputFields(input, ["classId", "title", "description", "dueAt"]) },
    });
    return record;
  }

  async delete(context: RequestContext, id: string): Promise<void> {
    const existing = await this.findOne(context, id);
    const homework = await this.store.softDelete(id, new Date().toISOString());
    if (!homework) {
      throw new NotFoundException("HOMEWORK_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: homework.tenantId,
      actorUserId: context.userId,
      entityType: "Homework",
      entityId: homework.id,
      action: "homework.deleted",
      diff: { classId: existing.classId, deletedAt: homework.deletedAt },
    });
  }

  async updateCheckStatus(context: RequestContext, id: string, checked: boolean | undefined): Promise<HomeworkRecord> {
    if (checked === undefined) {
      throw new BadRequestException("HOMEWORK_CHECK_STATUS_REQUIRED");
    }

    await this.findOne(context, id);
    const homework = await this.store.updateCheckStatus(
      id,
      checked ? new Date().toISOString() : undefined,
      checked ? context.userId : undefined,
    );
    if (!homework) {
      throw new NotFoundException("HOMEWORK_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: homework.tenantId,
      actorUserId: context.userId,
      entityType: "Homework",
      entityId: homework.id,
      action: "homework.check_status_updated",
      diff: { checked },
    });
    return homework;
  }

  private resolveTenantId(context: RequestContext, tenantId: string | undefined): string {
    const resolvedTenantId = tenantId ?? context.tenantId;
    if (!resolvedTenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId: resolvedTenantId });
    return resolvedTenantId;
  }

  private async assertClassAccess(context: RequestContext, classId: string | undefined): Promise<void> {
    if (!classId) {
      throw new BadRequestException("HOMEWORK_CLASS_REQUIRED");
    }

    await this.school.findClass(context, classId);
  }

  private async listStudentMaterialAssignments(
    context: RequestContext,
    studentIds: string[],
  ): Promise<HomeworkMaterialAssignmentRecord[]> {
    const studentIdSet = new Set(studentIds);
    const assignments = await Promise.all(
      (await this.listMaterials(context)).map((material) => this.listMaterialAssignments(context, material.id)),
    );
    return assignments.flat().filter((assignment) => studentIdSet.has(assignment.studentId));
  }

  private async filterHomeworkForTeacherScope(context: RequestContext, homeworks: HomeworkRecord[]): Promise<HomeworkRecord[]> {
    if (!isTeacherSubjectContext(context)) {
      return homeworks;
    }

    const classIds = await this.listTeacherClassIds(context);
    return homeworks.filter((homework) => classIds.has(homework.classId));
  }

  private async assertHomeworkTeacherScope(context: RequestContext, homework: HomeworkRecord): Promise<void> {
    if (!isTeacherSubjectContext(context)) {
      return;
    }

    const classIds = await this.listTeacherClassIds(context);
    if (!classIds.has(homework.classId)) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }
  }

  private async filterMaterialAssignmentsForTeacherScope(
    context: RequestContext,
    assignments: HomeworkMaterialAssignmentRecord[],
  ): Promise<HomeworkMaterialAssignmentRecord[]> {
    if (!isTeacherSubjectContext(context)) {
      return assignments;
    }

    const studentIds = new Set((await this.students.list(context)).map((student) => student.id));
    return assignments.filter((assignment) => studentIds.has(assignment.studentId));
  }

  private async listTeacherClassIds(context: RequestContext): Promise<Set<string>> {
    const lessons = filterTenantResources(context, await this.scheduleStore.list()).filter(
      (lesson) => !lesson.deletedAt && lesson.teacherId === context.subjectId,
    );
    return new Set(lessons.map((lesson) => lesson.classId));
  }

  private resolveOptionalDate(value: string | undefined): string | undefined {
    if (!value) {
      return undefined;
    }

    const time = Date.parse(value);
    if (!Number.isFinite(time)) {
      throw new BadRequestException("HOMEWORK_DUE_DATE_INVALID");
    }

    return new Date(time).toISOString();
  }

  private assertAccess(context: RequestContext, resource: { tenantId: string }): void {
    try {
      assertTenantResourceAccess(context, resource);
    } catch (error) {
      const message = error instanceof Error ? error.message : "FORBIDDEN_TENANT";
      throw new ForbiddenException(message);
    }
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

function normalizeMaterialFileName(fileName: string | undefined): string {
  const value = requiredText(fileName, "HOMEWORK_MATERIAL_FILE_NAME_REQUIRED");
  const name = value.split(/[\\/]/).at(-1)?.trim();
  if (!name) {
    throw new BadRequestException("HOMEWORK_MATERIAL_FILE_NAME_REQUIRED");
  }
  if (name.length > 120 || /[\u0000-\u001f]/.test(name)) {
    throw new BadRequestException("HOMEWORK_MATERIAL_FILE_NAME_INVALID");
  }
  return name;
}

function resolveMaterialFileContentType(value: string | undefined): HomeworkMaterialFileContentType {
  if (
    value === "application/pdf" ||
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "text/plain"
  ) {
    return value;
  }
  throw new BadRequestException("HOMEWORK_MATERIAL_FILE_CONTENT_TYPE_INVALID");
}

function readMaterialFileBytes(fileBase64: string | undefined): Buffer {
  const trimmed = fileBase64?.trim();
  if (!trimmed) {
    throw new BadRequestException("HOMEWORK_MATERIAL_FILE_REQUIRED");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    throw new BadRequestException("HOMEWORK_MATERIAL_FILE_INVALID");
  }

  const body = Buffer.from(trimmed, "base64");
  if (body.length === 0) {
    throw new BadRequestException("HOMEWORK_MATERIAL_FILE_REQUIRED");
  }
  if (body.length > maxMaterialFileBytes) {
    throw new BadRequestException("HOMEWORK_MATERIAL_FILE_TOO_LARGE");
  }
  return body;
}

function createSha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}

function presentFields<TRecord extends object>(record: TRecord, fields: Array<keyof TRecord>): string[] {
  return fields.filter((field) => record[field] !== undefined && record[field] !== "").map(String);
}

function changedInputFields<TRecord extends object>(input: Partial<TRecord>, fields: Array<keyof TRecord>): string[] {
  return fields.filter((field) => input[field] !== undefined).map(String);
}
