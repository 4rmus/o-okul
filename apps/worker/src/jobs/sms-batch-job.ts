import type { SmsAdapter, SmsMessage, SmsSendResult } from "@o-okul/sms-adapter";
import { runWithJobContext } from "../context/job-context.js";
import { workerLogger } from "../observability/logging.js";
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

export interface SmsBatchDeliveryLookupInput {
  tenantId: string;
  jobId: string;
}

export interface SmsBatchDeliveryCompletedSnapshot {
  tenantId: string;
  jobId: string;
  templateId: string;
  sentCount: number;
  failedCount: number;
  billableSegments: number;
}

export interface SmsBatchDeliveryReporter {
  findCompleted(input: SmsBatchDeliveryLookupInput): Promise<SmsBatchDeliveryCompletedSnapshot | undefined>;
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
      const completed = await deliveryReporter?.findCompleted({
        tenantId: job.payload.tenantId,
        jobId: job.id,
      });
      if (completed) {
        return {
          tenantId: completed.tenantId,
          templateId: completed.templateId,
          sentCount: completed.sentCount,
          failedCount: completed.failedCount,
          billableSegments: completed.billableSegments,
          status: "completed" as const,
        };
      }

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
      await markCompletedWithoutRetry(deliveryReporter, {
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

async function markCompletedWithoutRetry(
  deliveryReporter: SmsBatchDeliveryReporter | undefined,
  input: SmsBatchDeliveryCompletedInput,
): Promise<void> {
  if (!deliveryReporter) return;
  try {
    await deliveryReporter.markCompleted(input);
  } catch (error) {
    workerLogger.warn({
      err: error,
      jobId: input.jobId,
      tenantId: input.tenantId,
      templateId: input.templateId,
    }, "sms_batch_delivery_report_write_failed_after_provider_success");
  }
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
