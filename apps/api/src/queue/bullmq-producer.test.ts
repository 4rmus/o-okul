import { describe, expect, it } from "vitest";
import { createBullTenantQueueProducer, type BullQueueFactory } from "./bullmq-producer.js";

describe("BullMQ tenant queue producer", () => {
  it("producer çıktısını BullMQ Queue.add(name, payload, options) çağrısına bağlar", async () => {
    const queues: FakeQueue[] = [];
    const createQueue: BullQueueFactory = (name, options) => {
      const queue = new FakeQueue(name, options);
      queues.push(queue);
      return queue;
    };
    const producer = createBullTenantQueueProducer({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "o-okul-test",
      createQueue,
    });

    const produced = await producer.enqueue({
      queueName: "exam-evaluation",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "raw-import-a",
      contentHash: "hash-a",
      participantId: "participant-a",
      rawImportId: "raw-import-a",
      answerKeyId: "answer-key-a",
    });

    expect(queues).toHaveLength(1);
    expect(queues[0]?.name).toBe("exam-evaluation");
    expect(queues[0]?.options).toEqual({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "o-okul-test",
    });
    expect(queues[0]?.adds).toEqual([{
      name: "exam-evaluation",
      data: produced.payload,
      options: produced.options,
    }]);
  });

  it("aynı queue için client'ı tekrar kullanır ve close eder", async () => {
    const queues: FakeQueue[] = [];
    const producer = createBullTenantQueueProducer({
      connection: { host: "127.0.0.1", port: 6379 },
      createQueue: (name, options) => {
        const queue = new FakeQueue(name, options);
        queues.push(queue);
        return queue;
      },
    });

    await producer.enqueue(createExcelImportInput("import-a"));
    await producer.enqueue(createExcelImportInput("import-b"));
    await producer.close();

    expect(queues).toHaveLength(1);
    expect(queues[0]?.adds).toHaveLength(2);
    expect(queues[0]?.closed).toBe(true);
  });

  it("excel-import job'unu BullMQ add çağrısına raw import referansıyla verir", async () => {
    const queues: FakeQueue[] = [];
    const producer = createBullTenantQueueProducer({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "o-okul-test",
      createQueue: (name, options) => {
        const queue = new FakeQueue(name, options);
        queues.push(queue);
        return queue;
      },
    });

    const produced = await producer.enqueue(createExcelImportInput("raw-import-a", "hash-a"));

    expect(queues).toHaveLength(1);
    expect(queues[0]?.name).toBe("excel-import");
    expect(queues[0]?.adds).toEqual([{
      name: "excel-import",
      data: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "raw-import-a",
        contentHash: "hash-a",
      },
      options: produced.options,
    }]);
  });

  it("report-generation job'unu BullMQ add çağrısına rapor tipiyle verir", async () => {
    const queues: FakeQueue[] = [];
    const producer = createBullTenantQueueProducer({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "o-okul-test",
      createQueue: (name, options) => {
        const queue = new FakeQueue(name, options);
        queues.push(queue);
        return queue;
      },
    });

    const produced = await producer.enqueue({
      queueName: "report-generation",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "exam-a",
      contentHash: "results-v1",
      reportType: "EXAM_RESULT_SUMMARY",
    });

    expect(queues).toHaveLength(1);
    expect(queues[0]?.name).toBe("report-generation");
    expect(queues[0]?.adds).toEqual([{
      name: "report-generation",
      data: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "exam-a",
        contentHash: "results-v1",
        reportType: "EXAM_RESULT_SUMMARY",
      },
      options: produced.options,
    }]);
  });

  it("failed kalmış report-generation job'unu yeniden dener", async () => {
    const queues: FakeQueue[] = [];
    const producer = createBullTenantQueueProducer({
      connection: { host: "127.0.0.1", port: 6379 },
      createQueue: (name, options) => {
        const queue = new FakeQueue(name, options, new FakeQueueJob("failed"));
        queues.push(queue);
        return queue;
      },
    });

    await producer.enqueue({
      queueName: "report-generation",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "exam-a",
      contentHash: "results-v1",
      reportType: "EXAM_RESULT_SUMMARY",
    });

    expect(queues[0]?.job?.retries).toEqual(["failed"]);
  });

  it("sms-batch job'unu BullMQ add çağrısına şablon ve alıcılarla verir", async () => {
    const queues: FakeQueue[] = [];
    const producer = createBullTenantQueueProducer({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "o-okul-test",
      createQueue: (name, options) => {
        const queue = new FakeQueue(name, options);
        queues.push(queue);
        return queue;
      },
    });

    const produced = await producer.enqueue({
      queueName: "sms-batch",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "message-template-a",
      contentHash: "sms-hash-a",
      templateId: "message-template-a",
      messageBody: "Sayın veli, deneme sınavı Pazartesi günü yapılacaktır.",
      recipients: [{ to: "5000000001" }],
    });

    expect(queues).toHaveLength(1);
    expect(queues[0]?.name).toBe("sms-batch");
    expect(queues[0]?.adds).toEqual([{
      name: "sms-batch",
      data: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "message-template-a",
        contentHash: "sms-hash-a",
        templateId: "message-template-a",
        messageBody: "Sayın veli, deneme sınavı Pazartesi günü yapılacaktır.",
        recipients: [{ to: "5000000001" }],
      },
      options: produced.options,
    }]);
  });

  it("announcement-delivery job'unu BullMQ add çağrısına teslim özetleriyle verir", async () => {
    const queues: FakeQueue[] = [];
    const producer = createBullTenantQueueProducer({
      connection: { host: "127.0.0.1", port: 6379 },
      prefix: "o-okul-test",
      createQueue: (name, options) => {
        const queue = new FakeQueue(name, options);
        queues.push(queue);
        return queue;
      },
    });

    const produced = await producer.enqueue({
      queueName: "announcement-delivery",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "announcement-a",
      contentHash: "email-report-v1",
      channel: "EMAIL",
      recipientCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      status: "completed",
      providerErrorCode: "EMAIL_PROVIDER_RETRY",
    });

    expect(queues).toHaveLength(1);
    expect(queues[0]?.name).toBe("announcement-delivery");
    expect(queues[0]?.adds).toEqual([{
      name: "announcement-delivery",
      data: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "announcement-a",
        contentHash: "email-report-v1",
        channel: "EMAIL",
        recipientCount: 3,
        deliveredCount: 2,
        failedCount: 1,
        status: "completed",
        providerErrorCode: "EMAIL_PROVIDER_RETRY",
      },
      options: produced.options,
    }]);
  });

});

function createExcelImportInput(entityId: string, contentHash = `${entityId}-hash`) {
  return {
    queueName: "excel-import" as const,
    tenantId: "tenant-a",
    userId: "user-a",
    entityId,
    contentHash,
  };
}

class FakeQueue {
  readonly adds: Array<{ name: string; data: unknown; options: unknown }> = [];
  closed = false;

  constructor(
    readonly name: string,
    readonly options: unknown,
    readonly job?: FakeQueueJob,
  ) {}

  async add(name: string, data: unknown, options: unknown): Promise<FakeQueueJob | undefined> {
    this.adds.push({ name, data, options });
    return this.job;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeQueueJob {
  readonly retries: string[] = [];

  constructor(private readonly state: string) {}

  async getState(): Promise<string> {
    return this.state;
  }

  async retry(state?: "failed"): Promise<void> {
    this.retries.push(state ?? "");
  }
}
