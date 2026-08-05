import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  SupportTicketAttachmentDownloadResult,
  SupportTicketAttachmentRecord as SharedSupportTicketAttachmentRecord,
  SupportTicketCommentRecord as SharedSupportTicketCommentRecord,
  SupportTicketRecord as SharedSupportTicketRecord,
  UploadContentType,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { requiredText } from "../shared/required-text.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import { type AcademicCalendarStore, academicCalendarStoreToken } from "../school/academic-calendar-store.js";
import { type CampusStore, campusStoreToken } from "../school/campus-store.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { type CourseStore, courseStoreToken } from "../school/course-store.js";
import { type GradeLevelStore, gradeLevelStoreToken } from "../school/grade-level-store.js";
import {
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { assertTenantResourceAccess, filterTenantResources } from "../tenant/tenant-access.js";
import { type UploadAvScanner, uploadAvScannerToken } from "../upload/upload-av-scanner.js";
import { assertUploadContentMatchesContentType } from "../upload/upload-validation.js";
import {
  supportTicketAttachmentStorageToken,
  type SupportTicketAttachmentStorage,
} from "./support-ticket-attachment-storage.js";
import { supportTicketStoreToken, type SupportTicketStore } from "./support-ticket-store.js";

export type SupportTicketPriority = SharedSupportTicketRecord["priority"];
export type SupportTicketStatus = SharedSupportTicketRecord["status"];

export interface SupportTicketRecord extends SharedSupportTicketRecord {
  deletedAt?: string;
}

export interface SupportTicketAttachmentRecord extends SharedSupportTicketAttachmentRecord {
  contentBase64?: string;
  storageKey?: string;
  deletedAt?: string;
}

export type SupportTicketAttachmentDownload = SupportTicketAttachmentDownloadResult;

export interface SupportTicketCommentRecord extends SharedSupportTicketCommentRecord {
  deletedAt?: string;
}

export type SupportTicketAttachmentContentType = UploadContentType;

export interface CreateSupportTicketAttachmentInput {
  fileName?: string;
  contentType?: string;
  fileBase64?: string;
}

export interface CreateSupportTicketCommentInput {
  body?: string;
}

export interface PortalSupportTicketCommentResult {
  ticket: SupportTicketRecord;
  comment: SupportTicketCommentRecord;
}

export interface PortalSupportTicketCommentsResult {
  ticket: SupportTicketRecord;
  comments: SupportTicketCommentRecord[];
}

type PortalCommentOperation =
  | "portal-support-ticket.student-comment.create"
  | "portal-support-ticket.teacher-comment.create";

export interface SupportTicketListFilters {
  campusId?: string;
  classId?: string;
  courseId?: string;
  gradeLevelId?: string;
  studentId?: string;
  termId?: string;
}

type SupportTicketContextFields = Pick<
  SupportTicketRecord,
  "campusId" | "classId" | "courseId" | "gradeLevelId" | "studentId" | "termId"
>;

const maxAttachmentBytes = 64 * 1024;

@Injectable()
export class SupportTicketService {
  constructor(
    @Inject(supportTicketStoreToken) private readonly store: SupportTicketStore,
    @Inject(academicCalendarStoreToken) private readonly academicCalendarStore: AcademicCalendarStore,
    @Inject(campusStoreToken) private readonly campusStore: CampusStore,
    @Inject(classStoreToken) private readonly classStore: ClassStore,
    @Inject(courseStoreToken) private readonly courseStore: CourseStore,
    @Inject(gradeLevelStoreToken) private readonly gradeLevelStore: GradeLevelStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignmentStore: TeacherAssignmentStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Inject(supportTicketAttachmentStorageToken)
    private readonly attachmentStorage: SupportTicketAttachmentStorage,
    @Inject(uploadAvScannerToken) private readonly uploadAvScanner: UploadAvScanner,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async list(context: RequestContext, filters: SupportTicketListFilters = {}): Promise<SupportTicketRecord[]> {
    return filterSupportTickets(
      filterTenantResources(context, await this.store.list()).filter((ticket) => !ticket.deletedAt),
      filters,
    );
  }

  async findOne(context: RequestContext, id: string): Promise<SupportTicketRecord> {
    const ticket = await this.store.findById(id);
    if (!ticket || ticket.deletedAt) {
      throw new NotFoundException("SUPPORT_TICKET_NOT_FOUND");
    }

    this.assertAccess(context, ticket);
    return ticket;
  }

  async create(
    context: RequestContext,
    input: Partial<SupportTicketRecord>,
  ): Promise<SupportTicketRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const ticketContext = await this.resolveTicketContext(tenantId, input);

    const record = await this.store.create({
      tenantId,
      requesterId: context.userId,
      ...ticketContext,
      subject: requiredText(input.subject, "SUPPORT_TICKET_SUBJECT_REQUIRED"),
      message: requiredText(input.message, "SUPPORT_TICKET_MESSAGE_REQUIRED"),
      priority: resolvePriority(input.priority),
      status: "OPEN",
      createdAt: new Date().toISOString(),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "SupportTicket",
      entityId: record.id,
      action: "support_ticket.created",
      diff: {
        priority: record.priority,
        status: record.status,
        subject: record.subject,
        campusId: record.campusId,
        classId: record.classId,
        courseId: record.courseId,
        gradeLevelId: record.gradeLevelId,
        studentId: record.studentId,
        termId: record.termId,
      },
    });
    return record;
  }

  async listCurrentStudent(context: RequestContext): Promise<SupportTicketRecord[]> {
    const student = await this.findCurrentStudent(context);
    return (await this.list(context)).filter((ticket) => ticket.requesterId === context.userId && ticket.studentId === student.id);
  }

  async createCurrentStudent(
    context: RequestContext,
    input: Partial<SupportTicketRecord>,
  ): Promise<SupportTicketRecord> {
    const student = await this.findCurrentStudent(context);
    return this.create(context, { ...input, tenantId: student.tenantId, studentId: student.id });
  }

  async listCurrentStudentComments(context: RequestContext, ticketId: string): Promise<PortalSupportTicketCommentsResult> {
    const student = await this.findCurrentStudent(context);
    return this.listPortalComments(context, ticketId, student.id);
  }

  async addCurrentStudentComment(
    context: RequestContext,
    ticketId: string,
    input: CreateSupportTicketCommentInput,
    idempotencyKey?: string,
  ): Promise<PortalSupportTicketCommentResult> {
    const student = await this.findCurrentStudent(context);
    return this.addPortalComment(context, ticketId, student.id, input, idempotencyKey, "portal-support-ticket.student-comment.create");
  }

  async listCurrentGuardianStudent(context: RequestContext, studentId: string): Promise<SupportTicketRecord[]> {
    const student = await this.findGuardianSupportStudent(context, studentId);
    return (await this.list(context)).filter((ticket) => ticket.requesterId === context.userId && ticket.studentId === student.id);
  }

  async createCurrentGuardianStudent(
    context: RequestContext,
    studentId: string,
    input: Partial<SupportTicketRecord>,
  ): Promise<SupportTicketRecord> {
    const student = await this.findGuardianSupportStudent(context, studentId);
    return this.create(context, { ...input, tenantId: student.tenantId, studentId: student.id });
  }

  async listCurrentTeacher(context: RequestContext): Promise<SupportTicketRecord[]> {
    this.assertTeacherContext(context);
    return (await this.list(context)).filter((ticket) => ticket.requesterId === context.userId);
  }

  async createCurrentTeacher(
    context: RequestContext,
    input: Partial<SupportTicketRecord>,
  ): Promise<SupportTicketRecord> {
    this.assertTeacherContext(context);
    await this.assertTeacherTicketScope(context, input);
    return this.create(context, input);
  }

  async listCurrentTeacherComments(context: RequestContext, ticketId: string): Promise<PortalSupportTicketCommentsResult> {
    this.assertTeacherContext(context);
    return this.listPortalComments(context, ticketId, undefined, true);
  }

  async addCurrentTeacherComment(
    context: RequestContext,
    ticketId: string,
    input: CreateSupportTicketCommentInput,
    idempotencyKey?: string,
  ): Promise<PortalSupportTicketCommentResult> {
    this.assertTeacherContext(context);
    return this.addPortalComment(context, ticketId, undefined, input, idempotencyKey, "portal-support-ticket.teacher-comment.create", true);
  }

  async update(
    context: RequestContext,
    id: string,
    input: Partial<Pick<SupportTicketRecord, "priority" | "status">>,
  ): Promise<SupportTicketRecord> {
    const ticket = await this.findOne(context, id);
    if (input.priority === undefined && input.status === undefined) {
      throw new BadRequestException("SUPPORT_TICKET_UPDATE_REQUIRED");
    }

    const previousState = { priority: ticket.priority, status: ticket.status };
    const record = await this.store.update(id, {
      priority: input.priority !== undefined ? resolvePriority(input.priority) : ticket.priority,
      status: input.status !== undefined ? resolveStatus(input.status) : ticket.status,
    });
    if (!record) {
      throw new NotFoundException("SUPPORT_TICKET_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "SupportTicket",
      entityId: record.id,
      action: "support_ticket.updated",
      diff: {
        before: previousState,
        after: { priority: record.priority, status: record.status },
      },
    });
    return record;
  }

  async listAttachments(context: RequestContext, ticketId: string): Promise<SupportTicketAttachmentRecord[]> {
    await this.findOne(context, ticketId);
    return filterTenantResources(context, await this.store.listAttachments(ticketId)).filter(
      (attachment) => !attachment.deletedAt,
    );
  }

  async downloadAttachment(
    context: RequestContext,
    ticketId: string,
    attachmentId: string,
  ): Promise<SupportTicketAttachmentDownload> {
    const ticket = await this.findOne(context, ticketId);
    const attachment = await this.store.findAttachmentById(attachmentId);
    if (!attachment || attachment.deletedAt || attachment.ticketId !== ticket.id) {
      throw new NotFoundException("SUPPORT_TICKET_ATTACHMENT_NOT_FOUND");
    }

    this.assertAccess(context, attachment);
    if (attachment.storageKey && this.attachmentStorage.createSignedDownloadUrl) {
      const signedDownload = await this.attachmentStorage.createSignedDownloadUrl(attachment.storageKey);
      return {
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
        sha256: attachment.sha256,
        downloadMode: "signed-url",
        downloadUrl: signedDownload.url,
        downloadUrlExpiresAt: signedDownload.expiresAt,
        downloadUrlExpiresInSeconds: signedDownload.expiresInSeconds,
      };
    }

    const fileBase64 = attachment.storageKey
      ? (await this.attachmentStorage.get(attachment.storageKey)).toString("base64")
      : attachment.contentBase64;
    if (!fileBase64) {
      throw new NotFoundException("SUPPORT_TICKET_ATTACHMENT_NOT_FOUND");
    }

    return {
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      byteSize: attachment.byteSize,
      sha256: attachment.sha256,
      downloadMode: "inline",
      fileBase64,
    };
  }

  async addAttachment(
    context: RequestContext,
    ticketId: string,
    input: CreateSupportTicketAttachmentInput,
    idempotencyKey?: string,
  ): Promise<SupportTicketAttachmentRecord> {
    const idempotencyRequest = {
      ticketId,
      fileName: input.fileName,
      contentType: input.contentType,
      fileSha256: input.fileBase64 ? createSha256(Buffer.from(input.fileBase64, "base64")) : undefined,
    };
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "support-ticket.attachment.create", request: idempotencyRequest },
        () => this.addAttachmentOnce(context, ticketId, input),
      );
    }

    return this.addAttachmentOnce(context, ticketId, input);
  }

  private async addAttachmentOnce(
    context: RequestContext,
    ticketId: string,
    input: CreateSupportTicketAttachmentInput,
  ): Promise<SupportTicketAttachmentRecord> {
    const ticket = await this.findOne(context, ticketId);
    const body = readAttachmentBytes(input.fileBase64);
    const contentType = resolveAttachmentContentType(input.contentType);
    assertUploadContentMatchesContentType(body, contentType, "SUPPORT_TICKET_ATTACHMENT_CONTENT_MISMATCH");
    const fileName = normalizeAttachmentFileName(input.fileName);
    const sha256 = createSha256(body);
    await this.uploadAvScanner.scan({
      surface: "support_ticket_attachment",
      tenantId: ticket.tenantId,
      fileName,
      contentType,
      body,
      sha256,
    });
    const storedAttachment = await this.attachmentStorage.put({
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      fileName,
      contentType,
      body,
      sha256,
    });

    const attachment = await this.store.createAttachment({
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      uploadedById: context.userId,
      fileName,
      contentType,
      byteSize: body.length,
      sha256,
      contentBase64: storedAttachment.contentBase64,
      storageKey: storedAttachment.storageKey,
      createdAt: new Date().toISOString(),
    });
    await this.auditLogs?.record({
      tenantId: attachment.tenantId,
      actorUserId: context.userId,
      entityType: "SupportTicketAttachment",
      entityId: attachment.id,
      action: "support_ticket_attachment.created",
      diff: {
        ticketId: ticket.id,
        contentType: attachment.contentType,
        byteSize: attachment.byteSize,
        sha256: attachment.sha256,
      },
    });
    return attachment;
  }

  async listComments(context: RequestContext, ticketId: string): Promise<SupportTicketCommentRecord[]> {
    await this.findOne(context, ticketId);
    return filterTenantResources(context, await this.store.listComments(ticketId)).filter((comment) => !comment.deletedAt);
  }

  async addComment(
    context: RequestContext,
    ticketId: string,
    input: CreateSupportTicketCommentInput,
    idempotencyKey?: string,
  ): Promise<SupportTicketCommentRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "support-ticket.comment.create", request: { ticketId, body: input.body } },
        () => this.addCommentOnce(context, ticketId, input),
      );
    }

    return this.addCommentOnce(context, ticketId, input);
  }

  private async addCommentOnce(
    context: RequestContext,
    ticketId: string,
    input: CreateSupportTicketCommentInput,
  ): Promise<SupportTicketCommentRecord> {
    const ticket = await this.findOne(context, ticketId);
    const body = requiredText(input.body, "SUPPORT_TICKET_COMMENT_BODY_REQUIRED");
    const comment = await this.store.createComment({
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      authorId: context.userId,
      body,
      createdAt: new Date().toISOString(),
    });
    await this.auditLogs?.record({
      tenantId: comment.tenantId,
      actorUserId: context.userId,
      entityType: "SupportTicketComment",
      entityId: comment.id,
      action: "support_ticket_comment.created",
      diff: { ticketId: ticket.id, bodyLength: body.length },
    });
    return comment;
  }

  private async listPortalComments(
    context: RequestContext,
    ticketId: string,
    studentId?: string,
    teacherScoped = false,
  ): Promise<PortalSupportTicketCommentsResult> {
    const ticket = await this.findPortalTicket(context, ticketId, studentId);
    if (teacherScoped) await this.assertTeacherTicketScope(context, ticket);
    const comments = filterTenantResources(context, await this.store.listComments(ticketId)).filter((comment) => !comment.deletedAt);
    return { ticket, comments };
  }

  private async addPortalComment(
    context: RequestContext,
    ticketId: string,
    studentId: string | undefined,
    input: CreateSupportTicketCommentInput,
    idempotencyKey: string | undefined,
    operation: PortalCommentOperation,
    teacherScoped = false,
  ): Promise<PortalSupportTicketCommentResult> {
    const key = requiredText(idempotencyKey, "IDEMPOTENCY_KEY_REQUIRED");
    const run = () => this.addPortalCommentOnce(context, ticketId, studentId, input, teacherScoped);
    const request = { ticketId, body: input.body };
    const descriptor = operation === "portal-support-ticket.student-comment.create"
      ? { key, operation: "portal-support-ticket.student-comment.create", request }
      : { key, operation: "portal-support-ticket.teacher-comment.create", request };
    return this.idempotency
      ? this.idempotency.run(context, descriptor, run)
      : run();
  }

  private async addPortalCommentOnce(
    context: RequestContext,
    ticketId: string,
    studentId: string | undefined,
    input: CreateSupportTicketCommentInput,
    teacherScoped: boolean,
  ): Promise<PortalSupportTicketCommentResult> {
    const ticket = await this.findPortalTicket(context, ticketId, studentId);
    if (teacherScoped) await this.assertTeacherTicketScope(context, ticket);
    if (ticket.status === "CLOSED") throw new ConflictException("SUPPORT_TICKET_CLOSED");
    const body = requiredText(input.body, "SUPPORT_TICKET_COMMENT_BODY_REQUIRED");
    const result = await this.store.createPortalComment({
      tenantId: ticket.tenantId,
      ticketId: ticket.id,
      authorId: context.userId,
      body,
      createdAt: new Date().toISOString(),
    });
    if (!result) throw new ConflictException("SUPPORT_TICKET_CLOSED");
    await this.auditLogs?.record({
      tenantId: result.comment.tenantId,
      actorUserId: context.userId,
      entityType: "SupportTicketComment",
      entityId: result.comment.id,
      action: "support_ticket_comment.created",
      diff: {
        ticketId: ticket.id,
        bodyLength: body.length,
        beforeStatus: ticket.status,
        afterStatus: result.ticket.status,
      },
    });
    return result;
  }

  private async findPortalTicket(
    context: RequestContext,
    ticketId: string,
    studentId?: string,
  ): Promise<SupportTicketRecord> {
    const ticket = await this.store.findById(ticketId);
    if (!ticket || ticket.deletedAt) throw new NotFoundException("SUPPORT_TICKET_NOT_FOUND");
    this.assertAccess(context, ticket);
    if (ticket.requesterId !== context.userId || (studentId !== undefined && ticket.studentId !== studentId)) {
      throw new NotFoundException("SUPPORT_TICKET_NOT_FOUND");
    }
    return ticket;
  }

  private resolveTenantId(context: RequestContext, tenantId: string | undefined): string {
    const resolvedTenantId = tenantId ?? context.tenantId;
    if (!resolvedTenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId: resolvedTenantId });
    return resolvedTenantId;
  }

  private async findCurrentStudent(context: RequestContext) {
    if (context.subjectType !== "STUDENT" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const student = await this.studentStore.findById(context.subjectId);
    if (!student || student.deletedAt) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    this.assertAccess(context, student);
    return student;
  }

  private async findGuardianSupportStudent(context: RequestContext, studentId: string) {
    if (context.subjectType !== "GUARDIAN" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const student = await this.studentStore.findById(studentId);
    if (!student || student.deletedAt) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    this.assertAccess(context, student);
    const link = (await this.guardianStudentStore.listByStudent(student.id)).find((candidate) => candidate.guardianId === context.subjectId);
    if (!link) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }
    if (!link.canOpenSupportTickets) {
      throw new ForbiddenException("FORBIDDEN_SUPPORT_PERMISSION");
    }
    return student;
  }

  private assertTeacherContext(context: RequestContext): void {
    if (context.subjectType !== "TEACHER" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }
  }

  private async assertTeacherTicketScope(
    context: RequestContext,
    input: Partial<SupportTicketContextFields>,
  ): Promise<void> {
    const studentId = optionalText(input.studentId);
    const classId = optionalText(input.classId);
    if (!studentId && !classId) {
      return;
    }

    const assignments = filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(context.subjectId ?? ""))
      .filter((assignment) => !assignment.endsAt || new Date(assignment.endsAt).getTime() >= Date.now());
    const student = studentId ? await this.studentStore.findById(studentId) : undefined;
    if (studentId && (!student || student.tenantId !== context.tenantId || student.deletedAt)) {
      throw new BadRequestException("SUPPORT_TICKET_STUDENT_NOT_FOUND");
    }
    if (student && classId && student.classId && student.classId !== classId) {
      throw new BadRequestException("SUPPORT_TICKET_CONTEXT_MISMATCH");
    }

    const inStudentScope = student
      ? student.responsibleTeacherId === context.subjectId ||
        assignments.some((assignment) =>
          assignment.studentId === student.id || Boolean(student.classId && assignment.classId === student.classId),
        )
      : false;
    const inClassScope = classId ? assignments.some((assignment) => assignment.classId === classId) : false;

    if (!inStudentScope && !inClassScope) {
      throw new ForbiddenException("FORBIDDEN_TEACHER_SUPPORT_SCOPE");
    }
  }

  private async resolveTicketContext(
    tenantId: string,
    input: Partial<SupportTicketContextFields>,
  ): Promise<SupportTicketContextFields> {
    const contextFields: SupportTicketContextFields = {
      campusId: optionalText(input.campusId),
      classId: optionalText(input.classId),
      courseId: optionalText(input.courseId),
      gradeLevelId: optionalText(input.gradeLevelId),
      studentId: optionalText(input.studentId),
      termId: optionalText(input.termId),
    };

    if (contextFields.campusId) {
      await this.assertTenantLookup(
        await this.campusStore.findById(contextFields.campusId),
        tenantId,
        "SUPPORT_TICKET_CAMPUS_NOT_FOUND",
      );
    }
    if (contextFields.gradeLevelId) {
      await this.assertTenantLookup(
        await this.gradeLevelStore.findById(contextFields.gradeLevelId),
        tenantId,
        "SUPPORT_TICKET_GRADE_LEVEL_NOT_FOUND",
      );
    }
    if (contextFields.classId) {
      await this.assertTenantLookup(
        await this.classStore.findById(contextFields.classId),
        tenantId,
        "SUPPORT_TICKET_CLASS_NOT_FOUND",
      );
    }
    if (contextFields.courseId) {
      await this.assertTenantLookup(
        await this.courseStore.findById(contextFields.courseId),
        tenantId,
        "SUPPORT_TICKET_COURSE_NOT_FOUND",
      );
    }
    if (contextFields.termId) {
      await this.assertTenantLookup(
        await this.academicCalendarStore.findTermById(contextFields.termId),
        tenantId,
        "SUPPORT_TICKET_TERM_NOT_FOUND",
      );
    }
    if (contextFields.studentId) {
      await this.assertTenantLookup(
        await this.studentStore.findById(contextFields.studentId),
        tenantId,
        "SUPPORT_TICKET_STUDENT_NOT_FOUND",
      );
    }

    return contextFields;
  }

  private async assertTenantLookup(
    record: { tenantId: string; deletedAt?: string } | undefined,
    tenantId: string,
    errorCode: string,
  ): Promise<void> {
    if (!record || record.tenantId !== tenantId || record.deletedAt) {
      throw new BadRequestException(errorCode);
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
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function filterSupportTickets(records: SupportTicketRecord[], filters: SupportTicketListFilters): SupportTicketRecord[] {
  return records
    .filter((ticket) => !filters.campusId || ticket.campusId === filters.campusId)
    .filter((ticket) => !filters.classId || ticket.classId === filters.classId)
    .filter((ticket) => !filters.courseId || ticket.courseId === filters.courseId)
    .filter((ticket) => !filters.gradeLevelId || ticket.gradeLevelId === filters.gradeLevelId)
    .filter((ticket) => !filters.studentId || ticket.studentId === filters.studentId)
    .filter((ticket) => !filters.termId || ticket.termId === filters.termId);
}

function resolvePriority(value: SupportTicketPriority | undefined): SupportTicketPriority {
  if (value === undefined) return "NORMAL";
  if (value !== "LOW" && value !== "NORMAL" && value !== "HIGH") {
    throw new BadRequestException("SUPPORT_TICKET_PRIORITY_INVALID");
  }
  return value;
}

function resolveStatus(value: SupportTicketStatus): SupportTicketStatus {
  if (value !== "OPEN" && value !== "IN_PROGRESS" && value !== "RESOLVED" && value !== "CLOSED") {
    throw new BadRequestException("SUPPORT_TICKET_STATUS_INVALID");
  }
  return value;
}

function normalizeAttachmentFileName(fileName: string | undefined): string {
  const value = requiredText(fileName, "SUPPORT_TICKET_ATTACHMENT_FILE_NAME_REQUIRED");
  const name = value.split(/[\\/]/).at(-1)?.trim();
  if (!name) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_NAME_REQUIRED");
  }
  if (name.length > 120 || /[\u0000-\u001f]/.test(name)) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_NAME_INVALID");
  }
  return name;
}

function resolveAttachmentContentType(value: string | undefined): SupportTicketAttachmentContentType {
  if (
    value === "application/pdf" ||
    value === "image/jpeg" ||
    value === "image/png" ||
    value === "text/plain"
  ) {
    return value;
  }
  throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_CONTENT_TYPE_INVALID");
}

function readAttachmentBytes(fileBase64: string | undefined): Buffer {
  const trimmed = fileBase64?.trim();
  if (!trimmed) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_REQUIRED");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(trimmed) || trimmed.length % 4 !== 0) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_INVALID");
  }

  const body = Buffer.from(trimmed, "base64");
  if (body.length === 0) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_REQUIRED");
  }
  if (body.length > maxAttachmentBytes) {
    throw new BadRequestException("SUPPORT_TICKET_ATTACHMENT_FILE_TOO_LARGE");
  }

  return body;
}

function createSha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
}
