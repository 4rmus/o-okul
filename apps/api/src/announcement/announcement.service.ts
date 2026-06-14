import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import {
  createNotificationAdapterFromEnv,
  type NotificationAdapter,
  type NotificationMessage,
  type NotificationSendResult,
} from "@uzman-hocam/notification-adapter";
import type {
  AnnouncementDeliveryChannel,
  AnnouncementDeliveryReportRecord,
  AnnouncementDeliveryStatus,
  AnnouncementRecipientRecord,
  AnnouncementRecipientReport,
  ClassRecord,
  StudentRecord,
  TeacherAssignmentRecord,
} from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { NotificationDeviceService } from "../notification-device/notification-device.service.js";
import type { ProducedJob, TenantQueueJobInput } from "../queue/job-producer.js";
import { assertTenantResourceAccess, filterTenantResources } from "../tenant/tenant-access.js";
import { type AcademicCalendarStore, academicCalendarStoreToken } from "../school/academic-calendar-store.js";
import { type CampusStore, campusStoreToken } from "../school/campus-store.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { type CourseStore, courseStoreToken } from "../school/course-store.js";
import { type GradeLevelStore, gradeLevelStoreToken } from "../school/grade-level-store.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import { type GuardianStore, guardianStoreToken } from "../school/guardian-store.js";
import { type TeacherAssignmentStore, teacherAssignmentStoreToken } from "../school/teacher-assignment-store.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { type UserManagementStore, userManagementStoreToken } from "../user-management/user-management-store.js";
import {
  announcementReceiptStoreToken,
  type AnnouncementReceiptStore,
  type AnnouncementReceiptViewer,
} from "./announcement-receipt-store.js";
import {
  announcementDeliveryReportStoreToken,
  type AnnouncementDeliveryReportStore,
} from "./announcement-delivery-report-store.js";
import { announcementStoreToken, type AnnouncementStore } from "./announcement-store.js";

export type AnnouncementAudience = "SCHOOL" | "TEACHERS" | "STUDENTS" | "GUARDIANS";

export interface AnnouncementRecord {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  publishedAt: string;
  readAt?: string;
  deletedAt?: string;
}

export interface AnnouncementDeliveryResultInput {
  channel?: AnnouncementDeliveryChannel;
  recipientCount?: number;
  deliveredCount?: number;
  failedCount?: number;
  status?: Exclude<AnnouncementDeliveryStatus, "queued">;
  providerErrorCode?: string;
}

export interface AnnouncementDeliverySendInput {
  channel?: AnnouncementDeliveryChannel;
}

export interface AnnouncementDeliveryQueueProducer {
  enqueue(input: TenantQueueJobInput): Promise<ProducedJob>;
}

export interface AnnouncementDeliveryQueueResult {
  tenantId: string;
  announcementId: string;
  channel: AnnouncementDeliveryChannel;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  queueName: "announcement-delivery";
  jobId: string;
  status: "queued";
}

export const announcementDeliveryQueueProducerToken = Symbol("AnnouncementDeliveryQueueProducer");
export const notificationAdapterToken = Symbol("NotificationAdapter");

@Injectable()
export class AnnouncementService {
  constructor(
    @Inject(announcementStoreToken) private readonly store: AnnouncementStore,
    @Inject(academicCalendarStoreToken) private readonly academicCalendarStore: AcademicCalendarStore,
    @Inject(campusStoreToken) private readonly campusStore: CampusStore,
    @Inject(classStoreToken) private readonly classStore: ClassStore,
    @Inject(courseStoreToken) private readonly courseStore: CourseStore,
    @Inject(gradeLevelStoreToken) private readonly gradeLevelStore: GradeLevelStore,
    @Inject(guardianStoreToken) private readonly guardianStore: GuardianStore,
    @Inject(guardianStudentStoreToken) private readonly guardianStudentStore: GuardianStudentStore,
    @Inject(studentStoreToken) private readonly studentStore: StudentStore,
    @Inject(teacherStoreToken) private readonly teacherStore: TeacherStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignmentStore: TeacherAssignmentStore,
    @Inject(userManagementStoreToken) private readonly users: UserManagementStore,
    @Inject(announcementReceiptStoreToken) private readonly receiptStore: AnnouncementReceiptStore,
    @Inject(announcementDeliveryReportStoreToken) private readonly deliveryReportStore: AnnouncementDeliveryReportStore,
    @Inject(announcementDeliveryQueueProducerToken) private readonly deliveryProducer: AnnouncementDeliveryQueueProducer,
    @Inject(notificationAdapterToken) private readonly notificationAdapter: NotificationAdapter,
    private readonly notificationDevices: NotificationDeviceService,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async list(context: RequestContext): Promise<AnnouncementRecord[]> {
    return filterTenantResources(context, await this.store.list()).filter((announcement) => !announcement.deletedAt);
  }

  async findOne(context: RequestContext, id: string): Promise<AnnouncementRecord> {
    const announcement = await this.store.findById(id);
    if (!announcement || announcement.deletedAt) {
      throw new NotFoundException("ANNOUNCEMENT_NOT_FOUND");
    }

    this.assertAccess(context, announcement);
    return announcement;
  }

  async recipientReport(context: RequestContext, id: string): Promise<AnnouncementRecipientReport> {
    const announcement = await this.findOne(context, id);
    const recipients = await this.resolveRecipients(context, announcement);
    const receipts = await this.receiptStore.listByAnnouncement(announcement.tenantId, announcement.id);
    const readAtBySubject = new Map<string, string>();
    for (const receipt of receipts) {
      const key = receiptKey(receipt.subjectType, receipt.subjectId);
      const current = readAtBySubject.get(key);
      if (!current || receipt.readAt > current) {
        readAtBySubject.set(key, receipt.readAt);
      }
    }

    const rows = recipients.map((recipient) => ({
      ...recipient,
      readAt: readAtBySubject.get(receiptKey(recipient.recipientType, recipient.subjectId)),
    }));
    const read = rows.filter((recipient) => Boolean(recipient.readAt)).length;
    return {
      announcementId: announcement.id,
      total: rows.length,
      read,
      unread: rows.length - read,
      recipients: rows,
    };
  }

  async deliveryReports(context: RequestContext, id: string): Promise<AnnouncementDeliveryReportRecord[]> {
    const announcement = await this.findOne(context, id);
    return this.deliveryReportStore.listByAnnouncement(announcement.tenantId, announcement.id);
  }

  async enqueueDeliveryResult(
    context: RequestContext,
    id: string,
    input: AnnouncementDeliveryResultInput,
    idempotencyKey?: string,
  ): Promise<AnnouncementDeliveryQueueResult> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        {
          key: idempotencyKey,
          operation: "announcement.delivery-result.enqueue",
          request: { announcementId: id, ...input },
        },
        () => this.enqueueDeliveryResultOnce(context, id, input),
      );
    }

    return this.enqueueDeliveryResultOnce(context, id, input);
  }

  private async enqueueDeliveryResultOnce(
    context: RequestContext,
    id: string,
    input: AnnouncementDeliveryResultInput,
  ): Promise<AnnouncementDeliveryQueueResult> {
    const announcement = await this.findOne(context, id);
    const result = parseDeliveryResultInput(input);
    return this.enqueueDeliveryReport(context, announcement, result);
  }

  async sendExternalDelivery(
    context: RequestContext,
    id: string,
    input: AnnouncementDeliverySendInput,
    idempotencyKey?: string,
  ): Promise<AnnouncementDeliveryQueueResult> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        {
          key: idempotencyKey,
          operation: "announcement.delivery.send",
          request: { announcementId: id, ...input },
        },
        () => this.sendExternalDeliveryOnce(context, id, input),
      );
    }

    return this.sendExternalDeliveryOnce(context, id, input);
  }

  private async sendExternalDeliveryOnce(
    context: RequestContext,
    id: string,
    input: AnnouncementDeliverySendInput,
  ): Promise<AnnouncementDeliveryQueueResult> {
    const announcement = await this.findOne(context, id);
    const channel = resolveDeliveryChannel(input.channel);
    const messages = await this.resolveNotificationMessages(context, announcement, channel);
    const results = await this.notificationAdapter.sendBatch(messages);
    if (results.length !== messages.length) {
      throw new BadRequestException("ANNOUNCEMENT_DELIVERY_RESULT_COUNT_INVALID");
    }

    return this.enqueueDeliveryReport(context, announcement, summarizeNotificationResults(channel, results));
  }

  private async enqueueDeliveryReport(
    context: RequestContext,
    announcement: AnnouncementRecord,
    result: Required<Omit<AnnouncementDeliveryResultInput, "providerErrorCode">> & Pick<AnnouncementDeliveryResultInput, "providerErrorCode">,
  ): Promise<AnnouncementDeliveryQueueResult> {
    const contentHash = createAnnouncementDeliveryContentHash(result);
    const job = await this.deliveryProducer.enqueue({
      queueName: "announcement-delivery",
      tenantId: announcement.tenantId,
      userId: context.userId,
      entityId: announcement.id,
      contentHash,
      ...result,
    });
    await this.auditLogs?.record({
      tenantId: announcement.tenantId,
      actorUserId: context.userId,
      entityType: "AnnouncementDeliveryReport",
      entityId: job.options.jobId,
      action: "announcement_delivery.queued",
      diff: {
        announcementId: announcement.id,
        channel: result.channel,
        recipientCount: result.recipientCount,
        deliveredCount: result.deliveredCount,
        failedCount: result.failedCount,
        status: result.status,
        providerErrorCode: result.providerErrorCode,
        jobId: job.options.jobId,
      },
    });
    return {
      tenantId: announcement.tenantId,
      announcementId: announcement.id,
      channel: result.channel,
      recipientCount: result.recipientCount,
      deliveredCount: result.deliveredCount,
      failedCount: result.failedCount,
      queueName: "announcement-delivery",
      jobId: job.options.jobId,
      status: "queued",
    };
  }

  async listCurrentStudent(context: RequestContext): Promise<AnnouncementRecord[]> {
    if (context.subjectType !== "STUDENT" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const student = await this.findStudent(context.subjectId);
    this.assertAccess(context, student);
    return this.withReadStatus(context, await this.filterForStudent(context, student, ["SCHOOL", "STUDENTS"]));
  }

  async listCurrentGuardianStudent(context: RequestContext, studentId: string): Promise<AnnouncementRecord[]> {
    if (context.subjectType !== "GUARDIAN" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const student = await this.findStudent(studentId);
    const link = (await this.guardianStudentStore.listByStudent(student.id)).find(
      (candidate) => candidate.guardianId === context.subjectId,
    );
    if (!link) {
      throw new ForbiddenException("FORBIDDEN_SUBJECT");
    }
    if (!link.canReceiveAnnouncements) {
      return [];
    }

    this.assertAccess(context, student);
    return this.withReadStatus(context, await this.filterForStudent(context, student, ["SCHOOL", "GUARDIANS"]));
  }

  async listCurrentTeacher(context: RequestContext): Promise<AnnouncementRecord[]> {
    if (context.subjectType !== "TEACHER" || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }

    const assignments = filterTenantResources(context, await this.teacherAssignmentStore.listByTeacher(context.subjectId));
    const announcements = (await this.list(context)).filter((announcement) =>
      announcement.audience === "SCHOOL" || announcement.audience === "TEACHERS",
    );
    return this.withReadStatus(context, announcements.filter((announcement) => this.matchesTeacherScope(announcement, assignments)));
  }

  async markCurrentStudentRead(context: RequestContext, id: string): Promise<AnnouncementRecord> {
    const announcement = await this.findVisibleAnnouncement(await this.listCurrentStudent(context), id);
    return this.markRead(context, announcement);
  }

  async markCurrentGuardianStudentRead(context: RequestContext, studentId: string, id: string): Promise<AnnouncementRecord> {
    const announcement = await this.findVisibleAnnouncement(await this.listCurrentGuardianStudent(context, studentId), id);
    return this.markRead(context, announcement);
  }

  async markCurrentTeacherRead(context: RequestContext, id: string): Promise<AnnouncementRecord> {
    const announcement = await this.findVisibleAnnouncement(await this.listCurrentTeacher(context), id);
    return this.markRead(context, announcement);
  }

  async create(context: RequestContext, input: Partial<AnnouncementRecord>): Promise<AnnouncementRecord> {
    const tenantId = this.resolveTenantId(context, input.tenantId);
    const title = requiredText(input.title, "ANNOUNCEMENT_TITLE_REQUIRED");
    const body = requiredText(input.body, "ANNOUNCEMENT_BODY_REQUIRED");
    const audience = resolveAudience(input.audience);
    const targets = await this.resolveTargets(tenantId, input);

    const record = await this.store.create({
      tenantId,
      title,
      body,
      audience,
      ...targets,
      publishedAt: new Date().toISOString(),
    });
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "Announcement",
      entityId: record.id,
      action: "announcement.created",
      diff: { audience: record.audience, title: record.title, ...targets },
    });
    return record;
  }

  private async resolveTargets(
    tenantId: string,
    input: Partial<Pick<AnnouncementRecord, "campusId" | "gradeLevelId" | "classId" | "courseId" | "termId">>,
  ): Promise<Pick<Partial<AnnouncementRecord>, "campusId" | "gradeLevelId" | "classId" | "courseId" | "termId">> {
    const targets: Pick<Partial<AnnouncementRecord>, "campusId" | "gradeLevelId" | "classId" | "courseId" | "termId"> = {};
    const campusId = optionalText(input.campusId);
    if (campusId) {
      const campus = await this.campusStore.findById(campusId);
      if (!campus || campus.tenantId !== tenantId || campus.deletedAt) throw new BadRequestException("ANNOUNCEMENT_CAMPUS_INVALID");
      targets.campusId = campusId;
    }

    const gradeLevelId = optionalText(input.gradeLevelId);
    if (gradeLevelId) {
      const gradeLevel = await this.gradeLevelStore.findById(gradeLevelId);
      if (!gradeLevel || gradeLevel.tenantId !== tenantId || gradeLevel.deletedAt) throw new BadRequestException("ANNOUNCEMENT_GRADE_LEVEL_INVALID");
      targets.gradeLevelId = gradeLevelId;
    }

    const classId = optionalText(input.classId);
    if (classId) {
      const schoolClass = await this.classStore.findById(classId);
      if (!schoolClass || schoolClass.tenantId !== tenantId || schoolClass.deletedAt) throw new BadRequestException("ANNOUNCEMENT_CLASS_INVALID");
      targets.classId = classId;
    }

    const courseId = optionalText(input.courseId);
    if (courseId) {
      const course = await this.courseStore.findById(courseId);
      if (!course || course.tenantId !== tenantId || course.deletedAt) throw new BadRequestException("ANNOUNCEMENT_COURSE_INVALID");
      targets.courseId = courseId;
    }

    const termId = optionalText(input.termId);
    if (termId) {
      const term = await this.academicCalendarStore.findTermById(termId);
      if (!term || term.tenantId !== tenantId || term.deletedAt) throw new BadRequestException("ANNOUNCEMENT_TERM_INVALID");
      targets.termId = termId;
    }

    return targets;
  }

  private async filterForStudent(
    context: RequestContext,
    student: StudentRecord,
    audiences: AnnouncementAudience[],
  ): Promise<AnnouncementRecord[]> {
    const schoolClass = student.classId ? await this.classStore.findById(student.classId) : undefined;
    return (await this.list(context)).filter((announcement) =>
      audiences.includes(announcement.audience) && this.matchesStudentScope(announcement, student, schoolClass),
    );
  }

  private async resolveRecipients(context: RequestContext, announcement: AnnouncementRecord): Promise<AnnouncementRecipientRecord[]> {
    const rows: AnnouncementRecipientRecord[] = [];
    if (announcement.audience === "SCHOOL" || announcement.audience === "STUDENTS" || announcement.audience === "GUARDIANS") {
      const students = await this.targetStudents(context, announcement);
      if (announcement.audience === "SCHOOL" || announcement.audience === "STUDENTS") {
        rows.push(...students.map((student) => ({
          announcementId: announcement.id,
          recipientType: "STUDENT" as const,
          subjectId: student.id,
          userId: student.userId,
          displayName: fullName(student.firstName, student.lastName),
        })));
      }
      if (announcement.audience === "SCHOOL" || announcement.audience === "GUARDIANS") {
        rows.push(...await this.guardianRecipients(announcement, students));
      }
    }

    if (announcement.audience === "SCHOOL" || announcement.audience === "TEACHERS") {
      rows.push(...await this.teacherRecipients(context, announcement));
    }

    return rows.sort((left, right) =>
      `${left.recipientType}:${left.displayName}:${left.relatedStudentName ?? ""}`.localeCompare(
        `${right.recipientType}:${right.displayName}:${right.relatedStudentName ?? ""}`,
        "tr",
      ),
    );
  }

  private async targetStudents(context: RequestContext, announcement: AnnouncementRecord): Promise<StudentRecord[]> {
    const classes = new Map(filterTenantResources(context, await this.classStore.list()).map((record) => [record.id, record]));
    return filterTenantResources(context, await this.studentStore.list()).filter((student) =>
      student.status === "ACTIVE" &&
      this.matchesStudentScope(announcement, student, student.classId ? classes.get(student.classId) : undefined),
    );
  }

  private async guardianRecipients(
    announcement: AnnouncementRecord,
    students: StudentRecord[],
  ): Promise<AnnouncementRecipientRecord[]> {
    const recipients: AnnouncementRecipientRecord[] = [];
    for (const student of students) {
      const links = await this.guardianStudentStore.listByStudent(student.id);
      for (const link of links) {
        if (!link.canReceiveAnnouncements) continue;
        const guardian = await this.guardianStore.findById(link.guardianId);
        if (!guardian || guardian.tenantId !== announcement.tenantId || guardian.deletedAt) continue;
        recipients.push({
          announcementId: announcement.id,
          recipientType: "GUARDIAN",
          subjectId: guardian.id,
          userId: guardian.userId,
          displayName: fullName(guardian.firstName, guardian.lastName),
          relatedStudentId: student.id,
          relatedStudentName: fullName(student.firstName, student.lastName),
        });
      }
    }
    return recipients;
  }

  private async teacherRecipients(context: RequestContext, announcement: AnnouncementRecord): Promise<AnnouncementRecipientRecord[]> {
    const assignments = filterTenantResources(context, await this.teacherAssignmentStore.list());
    return filterTenantResources(context, await this.teacherStore.list())
      .filter((teacher) =>
        this.matchesTeacherScope(announcement, assignments.filter((assignment) => assignment.teacherId === teacher.id)),
      )
      .map((teacher) => ({
        announcementId: announcement.id,
        recipientType: "TEACHER" as const,
        subjectId: teacher.id,
        userId: teacher.userId,
        displayName: fullName(teacher.firstName, teacher.lastName),
      }));
  }

  private async resolveNotificationMessages(
    context: RequestContext,
    announcement: AnnouncementRecord,
    channel: AnnouncementDeliveryChannel,
  ): Promise<NotificationMessage[]> {
    const recipients = await this.resolveRecipients(context, announcement);
    if (channel === "PUSH") {
      return this.resolvePushMessages(announcement, recipients);
    }

    const messages = new Map<string, NotificationMessage>();
    for (const recipient of recipients) {
      const to = await this.resolveRecipientEmail(announcement.tenantId, recipient);
      if (!to) continue;
      messages.set(to, {
        channel,
        to,
        subject: announcement.title,
        body: announcement.body,
      });
    }
    return [...messages.values()];
  }

  private async resolvePushMessages(
    announcement: AnnouncementRecord,
    recipients: AnnouncementRecipientRecord[],
  ): Promise<NotificationMessage[]> {
    const userIds = [...new Set(recipients.map((recipient) => recipient.userId).filter((userId): userId is string => Boolean(userId)))];
    const devices = await this.notificationDevices.listActiveByUsers(announcement.tenantId, userIds);
    const messages = new Map<string, NotificationMessage>();
    for (const device of devices) {
      messages.set(device.token, {
        channel: "PUSH",
        to: device.token,
        subject: announcement.title,
        body: announcement.body,
      });
    }
    return [...messages.values()];
  }

  private async resolveRecipientEmail(tenantId: string, recipient: AnnouncementRecipientRecord): Promise<string | undefined> {
    if (recipient.userId) {
      const user = await this.users.findTenantUser(tenantId, recipient.userId);
      const userEmail = optionalText(user?.email);
      if (userEmail) return userEmail;
    }

    if (recipient.recipientType === "STUDENT") {
      const profile = await this.studentStore.findProfileById(recipient.subjectId);
      return optionalText(profile?.email);
    }

    return undefined;
  }

  private async withReadStatus(context: RequestContext, announcements: AnnouncementRecord[]): Promise<AnnouncementRecord[]> {
    const viewer = this.resolveReceiptViewer(context);
    const receipts = await this.receiptStore.listByViewer(viewer);
    const readAtByAnnouncementId = new Map(receipts.map((receipt) => [receipt.announcementId, receipt.readAt]));
    return announcements.map((announcement) => ({
      ...announcement,
      readAt: readAtByAnnouncementId.get(announcement.id),
    }));
  }

  private async markRead(context: RequestContext, announcement: AnnouncementRecord): Promise<AnnouncementRecord> {
    const viewer = this.resolveReceiptViewer(context);
    const receipt = await this.receiptStore.markRead({
      ...viewer,
      announcementId: announcement.id,
      readAt: new Date().toISOString(),
    });
    return { ...announcement, readAt: receipt.readAt };
  }

  private async findVisibleAnnouncement(announcements: AnnouncementRecord[], id: string): Promise<AnnouncementRecord> {
    const announcement = announcements.find((candidate) => candidate.id === id);
    if (!announcement) {
      throw new NotFoundException("ANNOUNCEMENT_NOT_FOUND");
    }
    return announcement;
  }

  private resolveReceiptViewer(context: RequestContext): AnnouncementReceiptViewer {
    if (!context.tenantId || !context.subjectType || !context.subjectId) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }
    return {
      tenantId: context.tenantId,
      userId: context.userId,
      subjectType: context.subjectType,
      subjectId: context.subjectId,
    };
  }

  private matchesStudentScope(
    announcement: AnnouncementRecord,
    student: StudentRecord,
    schoolClass: (ClassRecord & { deletedAt?: string }) | undefined,
  ): boolean {
    if (announcement.classId && announcement.classId !== student.classId) return false;
    if (announcement.campusId && announcement.campusId !== schoolClass?.campusId) return false;
    if (announcement.gradeLevelId && announcement.gradeLevelId !== schoolClass?.gradeLevelId) return false;
    return true;
  }

  private matchesTeacherScope(
    announcement: AnnouncementRecord,
    assignments: TeacherAssignmentRecord[],
  ): boolean {
    if (!announcement.classId && !announcement.courseId && !announcement.termId) {
      return true;
    }

    return assignments.some((assignment) => {
      if (announcement.classId && announcement.classId !== assignment.classId) return false;
      if (announcement.courseId && announcement.courseId !== assignment.courseId) return false;
      if (announcement.termId && assignment.termId && announcement.termId !== assignment.termId) return false;
      return true;
    });
  }

  private async findStudent(id: string): Promise<StudentRecord> {
    const student = await this.studentStore.findById(id);
    if (!student || student.deletedAt) {
      throw new NotFoundException("STUDENT_NOT_FOUND");
    }
    return student;
  }

  private resolveTenantId(context: RequestContext, tenantId: string | undefined): string {
    const resolvedTenantId = tenantId ?? context.tenantId;
    if (!resolvedTenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    this.assertAccess(context, { tenantId: resolvedTenantId });
    return resolvedTenantId;
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

function fullName(firstName: string, lastName: string): string {
  return `${firstName} ${lastName}`.trim();
}

function receiptKey(subjectType: string, subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

function parseDeliveryResultInput(
  input: AnnouncementDeliveryResultInput,
): Required<Omit<AnnouncementDeliveryResultInput, "providerErrorCode">> & Pick<AnnouncementDeliveryResultInput, "providerErrorCode"> {
  const channel = resolveDeliveryChannel(input.channel);
  const status = resolveDeliveryStatus(input.status);
  const recipientCount = resolveCount(input.recipientCount, "ANNOUNCEMENT_DELIVERY_RECIPIENT_COUNT_INVALID");
  const deliveredCount = resolveCount(input.deliveredCount, "ANNOUNCEMENT_DELIVERY_DELIVERED_COUNT_INVALID");
  const failedCount = resolveCount(input.failedCount, "ANNOUNCEMENT_DELIVERY_FAILED_COUNT_INVALID");
  if (deliveredCount + failedCount > recipientCount) {
    throw new BadRequestException("ANNOUNCEMENT_DELIVERY_COUNTS_INVALID");
  }
  return {
    channel,
    recipientCount,
    deliveredCount,
    failedCount,
    status,
    providerErrorCode: optionalText(input.providerErrorCode),
  };
}

function resolveDeliveryChannel(value: AnnouncementDeliveryChannel | undefined): AnnouncementDeliveryChannel {
  if (value !== "EMAIL" && value !== "PUSH") {
    throw new BadRequestException("ANNOUNCEMENT_DELIVERY_CHANNEL_INVALID");
  }
  return value;
}

function resolveDeliveryStatus(value: Exclude<AnnouncementDeliveryStatus, "queued"> | undefined): Exclude<AnnouncementDeliveryStatus, "queued"> {
  if (value !== "completed" && value !== "failed") {
    throw new BadRequestException("ANNOUNCEMENT_DELIVERY_STATUS_INVALID");
  }
  return value;
}

function resolveCount(value: number | undefined, errorCode: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException(errorCode);
  }
  return value;
}

function createAnnouncementDeliveryContentHash(input: {
  channel: AnnouncementDeliveryChannel;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  status: Exclude<AnnouncementDeliveryStatus, "queued">;
  providerErrorCode?: string;
}): string {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex")
    .slice(0, 16);
}

function summarizeNotificationResults(
  channel: AnnouncementDeliveryChannel,
  results: NotificationSendResult[],
): Required<Omit<AnnouncementDeliveryResultInput, "providerErrorCode">> & Pick<AnnouncementDeliveryResultInput, "providerErrorCode"> {
  const deliveredCount = results.filter((result) => result.status === "sent").length;
  const failedResults = results.filter((result) => result.status === "failed");
  return {
    channel,
    recipientCount: results.length,
    deliveredCount,
    failedCount: failedResults.length,
    status: deliveredCount > 0 || failedResults.length === 0 ? "completed" : "failed",
    providerErrorCode: failedResults[0]?.errorCode,
  };
}

function resolveAudience(value: AnnouncementAudience | undefined): AnnouncementAudience {
  if (value === undefined) return "SCHOOL";
  if (value !== "SCHOOL" && value !== "TEACHERS" && value !== "STUDENTS" && value !== "GUARDIANS") {
    throw new BadRequestException("ANNOUNCEMENT_AUDIENCE_INVALID");
  }
  return value;
}
