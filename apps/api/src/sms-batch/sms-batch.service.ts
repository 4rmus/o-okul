import { BadRequestException, ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import { createHash } from "node:crypto";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { MessageTemplateService } from "../message-template/message-template.service.js";
import type { ProducedJob, TenantQueueJobInput } from "../queue/job-producer.js";

export const smsBatchQueueProducerToken = Symbol("smsBatchQueueProducer");

export interface SmsBatchQueueProducer {
  enqueue(input: TenantQueueJobInput): Promise<ProducedJob>;
}

export interface SmsBatchRecipientInput {
  to?: string;
}

export interface CreateSmsBatchInput {
  templateId?: string;
  recipients?: SmsBatchRecipientInput[];
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
    @Inject(smsBatchQueueProducerToken)
    private readonly producer: SmsBatchQueueProducer,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async enqueue(context: RequestContext, input: CreateSmsBatchInput): Promise<SmsBatchQueueResult> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const templateId = required(input.templateId, "SMS_BATCH_TEMPLATE_REQUIRED");
    const recipients = parseRecipients(input.recipients);
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
