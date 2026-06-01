export type TenantQueueName = "exam-evaluation" | "excel-import" | "report-generation" | "sms-batch";

interface BaseTenantQueueJobInput {
  queueName: TenantQueueName;
  tenantId: string;
  userId: string;
  entityId: string;
  contentHash: string;
}

export interface ExamEvaluationQueueJobInput extends BaseTenantQueueJobInput {
  queueName: "exam-evaluation";
  participantId: string;
  rawImportId: string;
  answerKeyId: string;
}

export interface ReportGenerationQueueJobInput extends BaseTenantQueueJobInput {
  queueName: "report-generation";
  reportType: "EXAM_RESULT_SUMMARY";
}

export interface SmsBatchQueueJobInput extends BaseTenantQueueJobInput {
  queueName: "sms-batch";
  templateId: string;
  messageBody: string;
  recipients: Array<{ to: string }>;
}

export type TenantQueueJobInput =
  | ExamEvaluationQueueJobInput
  | ReportGenerationQueueJobInput
  | SmsBatchQueueJobInput
  | (BaseTenantQueueJobInput & { queueName: Exclude<TenantQueueName, "exam-evaluation" | "report-generation" | "sms-batch"> });

export interface ProducedJob<TInput extends TenantQueueJobInput = TenantQueueJobInput> {
  queueName: TInput["queueName"];
  name: TInput["queueName"];
  payload: Omit<TInput, "queueName">;
  options: {
    attempts: 5;
    backoff: {
      type: "exponential";
      delay: 1000;
    };
    jobId: string;
    removeOnFail: false;
  };
}

export function createTenantQueueJob(input: TenantQueueJobInput): ProducedJob {
  if (!input.tenantId || !input.userId || !input.entityId || !input.contentHash) {
    throw new Error("TENANT_JOB_PAYLOAD_INVALID");
  }
  if (
    input.queueName === "exam-evaluation" &&
    (!input.participantId || !input.rawImportId || !input.answerKeyId)
  ) {
    throw new Error("EXAM_EVALUATION_JOB_PAYLOAD_INVALID");
  }
  if (input.queueName === "report-generation" && input.reportType !== "EXAM_RESULT_SUMMARY") {
    throw new Error("REPORT_GENERATION_JOB_PAYLOAD_INVALID");
  }
  if (
    input.queueName === "sms-batch" &&
    (!input.templateId || !input.messageBody || input.recipients.length === 0)
  ) {
    throw new Error("SMS_BATCH_JOB_PAYLOAD_INVALID");
  }

  return {
    queueName: input.queueName,
    name: input.queueName,
    payload: createPayload(input),
    options: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 1000,
      },
      jobId: `${input.entityId}_${input.contentHash}`,
      removeOnFail: false,
    },
  };
}

function createPayload<TInput extends TenantQueueJobInput>(input: TInput): Omit<TInput, "queueName"> {
  const { queueName: _queueName, ...payload } = input;
  return payload;
}
