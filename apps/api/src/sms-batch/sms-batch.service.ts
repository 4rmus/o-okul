import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { announcementStoreToken, type AnnouncementStore } from "../announcement/announcement-store.js";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { isSmsEnabled } from "../config/env.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { MessageTemplateService } from "../message-template/message-template.service.js";
import { type ScheduleStore, scheduleStoreToken } from "../program/schedule-store.js";
import type { ProducedJob, TenantQueueJobInput } from "../queue/job-producer.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { type GuardianStore, guardianStoreToken } from "../school/guardian-store.js";
import { type GuardianStudentStore, guardianStudentStoreToken } from "../school/guardian-student-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import type { StudentStatus } from "@o-okul/shared-types";
import {
  smsBatchDeliveryReportStoreToken,
  type SmsBatchDeliveryReportRecord,
  type SmsBatchDeliveryReportStore,
} from "./sms-batch-delivery-report-store.js";

export const smsBatchQueueProducerToken = Symbol("smsBatchQueueProducer");

export interface SmsBatchQueueProducer {
  enqueue(input: TenantQueueJobInput): Promise<ProducedJob>;
}

export interface SmsBatchRecipientInput {
  to?: string;
}

export interface CreateSmsBatchInput {
  recipientScope: SmsBatchRecipientPreviewInput;
  templateId?: string;
  recipients?: SmsBatchRecipientInput[];
}

export interface SmsBatchRecipientPreviewInput {
  announcementId?: string;
  campusId?: string;
  classId?: string;
  courseId?: string;
  gradeLevelId?: string;
  studentStatus?: StudentStatus;
  termId?: string;
}

export interface SmsBatchRecipientPreviewRecord {
  to: string;
  guardianId: string;
  guardianName: string;
  studentIds: string[];
  studentNames: string[];
}

export interface SmsBatchRecipientPreviewResult {
  recipients: SmsBatchRecipientPreviewRecord[];
  recipientCount: number;
}

export interface SmsBatchQueueResult {
  tenantId: string;
  templateId: string;
  recipientCount: number;
  queueName: "sms-batch";
  jobId: string;
  status: "queued";
}

@Injectable()
export class SmsBatchService {
  constructor(
    private readonly templates: MessageTemplateService,
    @Inject(announcementStoreToken)
    private readonly announcementStore: AnnouncementStore,
    @Inject(classStoreToken)
    private readonly classStore: ClassStore,
    @Inject(smsBatchDeliveryReportStoreToken)
    private readonly deliveryReports: SmsBatchDeliveryReportStore,
    @Inject(guardianStoreToken)
    private readonly guardianStore: GuardianStore,
    @Inject(guardianStudentStoreToken)
    private readonly guardianStudentStore: GuardianStudentStore,
    @Inject(smsBatchQueueProducerToken)
    private readonly producer: SmsBatchQueueProducer,
    @Inject(scheduleStoreToken)
    private readonly scheduleStore: ScheduleStore,
    @Inject(studentStoreToken)
    private readonly studentStore: StudentStore,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async previewRecipients(
    context: RequestContext,
    input: SmsBatchRecipientPreviewInput,
  ): Promise<SmsBatchRecipientPreviewResult> {
    assertSmsEnabled();
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const effectiveInput = await this.resolveRecipientPreviewInput(context.tenantId, input);
    const classes = (await this.classStore.list()).filter((record) => record.tenantId === context.tenantId && !record.deletedAt);
    const classesById = new Map(classes.map((record) => [record.id, record]));
    const scheduledClassIds = await this.resolveScheduledClassIds(context.tenantId, effectiveInput);
    const students = (await this.studentStore.list())
      .filter((student) => student.tenantId === context.tenantId)
      .filter((student) => !effectiveInput.studentStatus || student.status === effectiveInput.studentStatus)
      .filter((student) => !effectiveInput.classId || student.classId === effectiveInput.classId)
      .filter((student) => scheduledClassIds === undefined || Boolean(student.classId && scheduledClassIds.has(student.classId)))
      .filter((student) => {
        if (!effectiveInput.campusId && !effectiveInput.gradeLevelId) return true;
        const schoolClass = student.classId ? classesById.get(student.classId) : undefined;
        if (effectiveInput.campusId && schoolClass?.campusId !== effectiveInput.campusId) return false;
        if (effectiveInput.gradeLevelId && schoolClass?.gradeLevelId !== effectiveInput.gradeLevelId) return false;
        return true;
      });
    const recipients = new Map<string, SmsBatchRecipientPreviewRecord>();

    for (const student of students) {
      const links = (await this.guardianStudentStore.listByStudent(student.id))
        .filter((link) => link.tenantId === context.tenantId && link.canReceiveSms);
      for (const link of links) {
        const guardian = await this.guardianStore.findById(link.guardianId);
        const phone = guardian?.phone?.trim();
        if (!guardian || guardian.tenantId !== context.tenantId || guardian.deletedAt || !phone) {
          continue;
        }

        const existing = recipients.get(phone);
        if (existing) {
          if (!existing.studentIds.includes(student.id)) {
            existing.studentIds.push(student.id);
            existing.studentNames.push(`${student.firstName} ${student.lastName}`);
          }
          continue;
        }

        recipients.set(phone, {
          to: phone,
          guardianId: guardian.id,
          guardianName: `${guardian.firstName} ${guardian.lastName}`,
          studentIds: [student.id],
          studentNames: [`${student.firstName} ${student.lastName}`],
        });
      }
    }

    const records = Array.from(recipients.values()).sort((left, right) => left.guardianName.localeCompare(right.guardianName, "tr"));
    return {
      recipients: records,
      recipientCount: records.length,
    };
  }

  private async resolveRecipientPreviewInput(
    tenantId: string,
    input: SmsBatchRecipientPreviewInput,
  ): Promise<SmsBatchRecipientPreviewInput> {
    if (!input.announcementId) {
      return input;
    }

    const announcement = await this.announcementStore.findById(input.announcementId);
    if (!announcement || announcement.tenantId !== tenantId || announcement.deletedAt) {
      throw new NotFoundException("ANNOUNCEMENT_NOT_FOUND");
    }

    return {
      ...input,
      campusId: input.campusId || announcement.campusId,
      classId: input.classId || announcement.classId,
      courseId: input.courseId || announcement.courseId,
      gradeLevelId: input.gradeLevelId || announcement.gradeLevelId,
      termId: input.termId || announcement.termId,
    };
  }

  private async resolveScheduledClassIds(
    tenantId: string,
    input: SmsBatchRecipientPreviewInput,
  ): Promise<Set<string> | undefined> {
    if (!input.courseId && !input.termId) {
      return undefined;
    }

    const lessons = (await this.scheduleStore.list())
      .filter((lesson) => lesson.tenantId === tenantId && !lesson.deletedAt)
      .filter((lesson) => !input.courseId || lesson.courseId === input.courseId)
      .filter((lesson) => !input.termId || lesson.termId === input.termId);
    return new Set(lessons.map((lesson) => lesson.classId));
  }

  async findDeliveryReport(context: RequestContext, jobId: string): Promise<SmsBatchDeliveryReportRecord> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const report = await this.deliveryReports.findByJobId(jobId);
    if (!report) {
      throw new NotFoundException("SMS_BATCH_DELIVERY_REPORT_NOT_FOUND");
    }
    if (report.tenantId !== context.tenantId) {
      throw new ForbiddenException("SMS_BATCH_DELIVERY_REPORT_FORBIDDEN");
    }
    return report;
  }

  async enqueue(
    context: RequestContext,
    input: CreateSmsBatchInput,
    idempotencyKey?: string,
  ): Promise<SmsBatchQueueResult> {
    assertSmsEnabled();
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "sms.batch.enqueue", request: input },
        () => this.enqueueBatch(context, input),
      );
    }

    return this.enqueueBatch(context, input);
  }

  private async enqueueBatch(context: RequestContext, input: CreateSmsBatchInput): Promise<SmsBatchQueueResult> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const templateId = required(input.templateId, "SMS_BATCH_TEMPLATE_REQUIRED");
    const recipients = parseRecipients(input.recipients);
    const eligibleRecipients = await this.previewRecipients(context, input.recipientScope);
    const eligibleNumbers = new Set(eligibleRecipients.recipients.map((recipient) => recipient.to));
    if (recipients.some((recipient) => !eligibleNumbers.has(recipient.to))) {
      throw new BadRequestException("SMS_BATCH_RECIPIENT_NOT_ELIGIBLE");
    }
    const template = await this.templates.findOne(context, templateId);
    const contentHash = createSmsBatchContentHash(template.body, recipients);
    const job = await this.producer.enqueue({
      queueName: "sms-batch",
      tenantId: context.tenantId,
      userId: context.userId,
      entityId: template.id,
      contentHash,
      templateId: template.id,
      messageBody: template.body,
      recipients,
    });
    await this.deliveryReports.upsertQueued({
      tenantId: context.tenantId,
      jobId: job.options.jobId,
      templateId: template.id,
      recipientCount: recipients.length,
    });
    await this.auditLogs?.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      entityType: "SmsBatch",
      entityId: job.options.jobId,
      action: "sms_batch.queued",
      diff: {
        templateId: template.id,
        recipientCount: recipients.length,
        contentHash,
        jobId: job.options.jobId,
      },
    });

    return {
      tenantId: context.tenantId,
      templateId: template.id,
      recipientCount: recipients.length,
      queueName: "sms-batch",
      jobId: job.options.jobId,
      status: "queued",
    };
  }
}

function assertSmsEnabled(): void {
  if (!isSmsEnabled()) {
    throw new BadRequestException("SMS_DISABLED");
  }
}

function required(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

function parseRecipients(value: SmsBatchRecipientInput[] | undefined): Array<{ to: string }> {
  const recipients = (value ?? []).map((recipient) => ({ to: recipient.to?.trim() ?? "" }));
  if (recipients.length === 0) {
    throw new BadRequestException("SMS_BATCH_RECIPIENTS_REQUIRED");
  }
  if (recipients.some((recipient) => !recipient.to)) {
    throw new BadRequestException("SMS_BATCH_RECIPIENT_INVALID");
  }
  return recipients;
}

function createSmsBatchContentHash(messageBody: string, recipients: Array<{ to: string }>): string {
  return createHash("sha256")
    .update(JSON.stringify({ messageBody, recipients }))
    .digest("hex");
}
