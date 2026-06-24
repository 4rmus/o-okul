import type { SmsAdapter, SmsMessage, SmsSendResult } from "@o-okul/sms-adapter";
import { runWithJobContext } from "../context/job-context.js";
import { assertTenantJobPayload, type QueueJob, type TenantJobPayload } from "../queue/queues.js";

export interface SmsBatchJobPayload extends TenantJobPayload {
  templateId: string;
  messageBody: string;
  recipients: Array<{ to: string }>;
}

export interface SmsBatchJobResult {
  tenantId: string;
  templateId: string;
  sentCount: number;
  failedCount: number;
  billableSegments: number;
  status: "completed";
}

export interface SmsBatchDeliveryCompletedInput {
  tenantId: string;
  jobId: string;
  templateId: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  billableSegments: number;
}

export interface SmsBatchDeliveryFailedInput {
  tenantId: string;
  jobId: string;
  templateId: string;
  recipientCount: number;
  providerErrorCode: string;
}

export interface SmsBatchDeliveryReporter {
  markCompleted(input: SmsBatchDeliveryCompletedInput): Promise<void>;
  markFailed(input: SmsBatchDeliveryFailedInput): Promise<void>;
}

export async function processSmsBatchJob(
  job: QueueJob<SmsBatchJobPayload>,
  adapter: SmsAdapter,
  deliveryReporter?: SmsBatchDeliveryReporter,
): Promise<SmsBatchJobResult> {
  if (job.name !== "sms-batch") {
    throw new Error("SMS_BATCH_JOB_NAME_INVALID");
  }
  assertTenantJobPayload(job.payload);
  assertSmsBatchPayload(job.payload);

  return runWithJobContext(
    {
      tenantId: job.payload.tenantId,
      userId: job.payload.userId,
      jobId: job.id,
    },
    async () => {
      let results: SmsSendResult[];
      try {
        results = await adapter.sendBatch(createMessages(job.payload));
      } catch (error) {
        await deliveryReporter?.markFailed({
          tenantId: job.payload.tenantId,
          jobId: job.id,
          templateId: job.payload.templateId,
          recipientCount: job.payload.recipients.length,
          providerErrorCode: resolveProviderErrorCode(error),
        });
        throw error;
      }

      const result = {
        tenantId: job.payload.tenantId,
        templateId: job.payload.templateId,
        sentCount: results.filter((item) => item.status === "sent").length,
        failedCount: results.filter((item) => item.status === "failed").length,
        billableSegments: results.reduce(
          (total, item) => total + (item.segmentEstimate?.segments ?? 0),
          0,
        ),
        status: "completed" as const,
      };
      await deliveryReporter?.markCompleted({
        tenantId: job.payload.tenantId,
        jobId: job.id,
        templateId: job.payload.templateId,
        recipientCount: job.payload.recipients.length,
        sentCount: result.sentCount,
        failedCount: result.failedCount,
        billableSegments: result.billableSegments,
      });
      return result;
    },
  );
}

function resolveProviderErrorCode(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "SMS_BATCH_FAILED";
}

function assertSmsBatchPayload(payload: SmsBatchJobPayload): void {
  if (!payload.templateId || !payload.messageBody || payload.recipients.length === 0) {
    throw new Error("SMS_BATCH_PAYLOAD_INVALID");
  }
  if (payload.recipients.some((recipient) => !recipient.to)) {
    throw new Error("SMS_BATCH_RECIPIENT_INVALID");
  }
}

function createMessages(payload: SmsBatchJobPayload): SmsMessage[] {
  return payload.recipients.map((recipient) => ({
    to: recipient.to,
    body: payload.messageBody,
  }));
}
