import { describe, expect, it } from "vitest";
import type { SmsAdapter, SmsMessage, SmsSendResult } from "@uzman-hocam/sms-adapter";
import { getJobContext } from "../context/job-context.js";
import { processSmsBatchJob } from "./sms-batch-job.js";

describe("processSmsBatchJob", () => {
  it("SMS batch job'unu adapter'a mesaj listesi olarak verir", async () => {
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
});

class FakeSmsAdapter implements SmsAdapter {
  messages: SmsMessage[] = [];

  constructor(private readonly results: SmsSendResult[]) {}

  async sendBatch(messages: SmsMessage[]): Promise<SmsSendResult[]> {
    this.messages = messages;
    return this.results;
  }
}
