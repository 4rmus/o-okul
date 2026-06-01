import type { SmsAdapter, SmsMessage } from "@uzman-hocam/sms-adapter";
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

export async function processSmsBatchJob(
  job: QueueJob<SmsBatchJobPayload>,
  adapter: SmsAdapter,
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
      const results = await adapter.sendBatch(createMessages(job.payload));
      return {
        tenantId: job.payload.tenantId,
        templateId: job.payload.templateId,
        sentCount: results.filter((result) => result.status === "sent").length,
        failedCount: results.filter((result) => result.status === "failed").length,
        billableSegments: results.reduce(
          (total, result) => total + (result.segmentEstimate?.segments ?? 0),
          0,
        ),
        status: "completed",
      };
    },
  );
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
