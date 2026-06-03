import { describe, expect, it } from "vitest";
import type { SmsAdapter, SmsMessage, SmsSendResult } from "@uzman-hocam/sms-adapter";
import { getJobContext } from "../context/job-context.js";
import {
  processSmsBatchJob,
  type SmsBatchDeliveryCompletedInput,
  type SmsBatchDeliveryFailedInput,
  type SmsBatchDeliveryReporter,
} from "./sms-batch-job.js";

describe("processSmsBatchJob", () => {
  it("SMS batch job'unu adapter'a mesaj listesi olarak verir", async () => {
    const deliveryReporter = new FakeDeliveryReporter();
    const adapter = new FakeSmsAdapter([
      {
        to: "5000000001",
        status: "sent",
        providerMessageId: "sms-1",
        segmentEstimate: {
          encoding: "GSM_7",
          characterCount: 64,
          messageUnits: 64,
          segments: 1,
          singleSegmentLimit: 160,
          multipartSegmentLimit: 153,
        },
      },
      {
        to: "5000000002",
        status: "failed",
        errorCode: "PROVIDER_REJECTED",
        segmentEstimate: {
          encoding: "GSM_7",
          characterCount: 64,
          messageUnits: 64,
          segments: 1,
          singleSegmentLimit: 160,
          multipartSegmentLimit: 153,
        },
      },
    ]);

    const result = await processSmsBatchJob(
      {
        id: "message-template-a_sms-hash-a",
        name: "sms-batch",
        payload: {
          tenantId: "tenant-a",
          userId: "user-a",
          entityId: "message-template-a",
          contentHash: "sms-hash-a",
          templateId: "message-template-a",
          messageBody: "Sayın veli, deneme sınavı Pazartesi günü yapılacaktır.",
          recipients: [{ to: "5000000001" }, { to: "5000000002" }],
        },
      },
      adapter,
      deliveryReporter,
    );

    expect(adapter.messages).toEqual([
      { to: "5000000001", body: "Sayın veli, deneme sınavı Pazartesi günü yapılacaktır." },
      { to: "5000000002", body: "Sayın veli, deneme sınavı Pazartesi günü yapılacaktır." },
    ]);
    expect(result).toEqual({
      tenantId: "tenant-a",
      templateId: "message-template-a",
      sentCount: 1,
      failedCount: 1,
      billableSegments: 2,
      status: "completed",
    });
    expect(deliveryReporter.completed).toEqual([{
      tenantId: "tenant-a",
      jobId: "message-template-a_sms-hash-a",
      templateId: "message-template-a",
      recipientCount: 2,
      sentCount: 1,
      failedCount: 1,
      billableSegments: 2,
    }]);
  });

  it("job context'i adapter çalışırken taşır", async () => {
    const contexts: unknown[] = [];
    const adapter: SmsAdapter = {
      async sendBatch() {
        contexts.push(getJobContext());
        return [{
          to: "5000000001",
          status: "sent",
          segmentEstimate: {
            encoding: "GSM_7",
            characterCount: 5,
            messageUnits: 5,
            segments: 1,
            singleSegmentLimit: 160,
            multipartSegmentLimit: 153,
          },
        }];
      },
    };

    await processSmsBatchJob(
      {
        id: "message-template-a_sms-hash-a",
        name: "sms-batch",
        payload: {
          tenantId: "tenant-a",
          userId: "user-a",
          entityId: "message-template-a",
          contentHash: "sms-hash-a",
          templateId: "message-template-a",
          messageBody: "Mesaj",
          recipients: [{ to: "5000000001" }],
        },
      },
      adapter,
    );

    expect(contexts).toEqual([{
      tenantId: "tenant-a",
      userId: "user-a",
      jobId: "message-template-a_sms-hash-a",
    }]);
  });

  it("yanlış job adı veya eksik alıcıda işi başlatmaz", async () => {
    const adapter = new FakeSmsAdapter([]);

    await expect(
      processSmsBatchJob(
        {
          id: "message-template-a_sms-hash-a",
          name: "report-generation",
          payload: {
            tenantId: "tenant-a",
            userId: "user-a",
            entityId: "message-template-a",
            contentHash: "sms-hash-a",
            templateId: "message-template-a",
            messageBody: "Mesaj",
            recipients: [{ to: "5000000001" }],
          },
        },
        adapter,
      ),
    ).rejects.toThrow("SMS_BATCH_JOB_NAME_INVALID");

    await expect(
      processSmsBatchJob(
        {
          id: "message-template-a_sms-hash-a",
          name: "sms-batch",
          payload: {
            tenantId: "tenant-a",
            userId: "user-a",
            entityId: "message-template-a",
            contentHash: "sms-hash-a",
            templateId: "message-template-a",
            messageBody: "Mesaj",
            recipients: [],
          },
        },
        adapter,
      ),
    ).rejects.toThrow("SMS_BATCH_PAYLOAD_INVALID");
  });

  it("adapter hata verirse teslim raporunu failed yapar", async () => {
    const deliveryReporter = new FakeDeliveryReporter();
    const adapter: SmsAdapter = {
      async sendBatch() {
        throw new Error("PROVIDER_DOWN");
      },
    };

    await expect(processSmsBatchJob(
      {
        id: "message-template-a_sms-hash-a",
        name: "sms-batch",
        payload: {
          tenantId: "tenant-a",
          userId: "user-a",
          entityId: "message-template-a",
          contentHash: "sms-hash-a",
          templateId: "message-template-a",
          messageBody: "Mesaj",
          recipients: [{ to: "5000000001" }, { to: "5000000002" }],
        },
      },
      adapter,
      deliveryReporter,
    )).rejects.toThrow("PROVIDER_DOWN");

    expect(deliveryReporter.failed).toEqual([{
      tenantId: "tenant-a",
      jobId: "message-template-a_sms-hash-a",
      templateId: "message-template-a",
      recipientCount: 2,
      providerErrorCode: "PROVIDER_DOWN",
    }]);
  });
});

class FakeSmsAdapter implements SmsAdapter {
  messages: SmsMessage[] = [];

  constructor(private readonly results: SmsSendResult[]) {}

  async sendBatch(messages: SmsMessage[]): Promise<SmsSendResult[]> {
    this.messages = messages;
    return this.results;
  }
}

class FakeDeliveryReporter implements SmsBatchDeliveryReporter {
  completed: SmsBatchDeliveryCompletedInput[] = [];
  failed: SmsBatchDeliveryFailedInput[] = [];

  async markCompleted(input: SmsBatchDeliveryCompletedInput): Promise<void> {
    this.completed.push(input);
  }

  async markFailed(input: SmsBatchDeliveryFailedInput): Promise<void> {
    this.failed.push(input);
  }
}
