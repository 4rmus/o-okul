import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import {
  RawImportQueueService,
  type RawImportQueueProducer,
} from "./raw-import-queue.service.js";
import type { ProducedJob } from "../queue/job-producer.js";

describe("RawImportQueueService", () => {
  it("RawImport parse isteğini excel-import queue job'una çevirir", async () => {
    const producer = new FakeProducer();
    const service = new RawImportQueueService(producer);

    const result = await service.enqueueParse(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      {
        examId: "exam-a",
        rawImportId: "raw-import-a",
        sha256: "hash-a",
      },
    );

    expect(producer.inputs).toEqual([{
      queueName: "excel-import",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "raw-import-a",
      contentHash: "hash-a",
    }]);
    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      rawImportId: "raw-import-a",
      queueName: "excel-import",
      jobId: "raw-import-a_hash-a",
      status: "queued",
    });
  });

  it("tenant context yoksa queue'ya iş göndermez", async () => {
    const producer = new FakeProducer();
    const service = new RawImportQueueService(producer);

    await expect(service.enqueueParse(
      {
        tenantId: null,
        userId: "user-a",
        roles: ["SYSTEM_ADMIN"],
        bypassRls: true,
      },
      {
        examId: "exam-a",
        rawImportId: "raw-import-a",
        sha256: "hash-a",
      },
    )).rejects.toThrow(ForbiddenException);
    expect(producer.inputs).toHaveLength(0);
  });

  it("sha256 yoksa queue'ya iş göndermez", async () => {
    const producer = new FakeProducer();
    const service = new RawImportQueueService(producer);

    await expect(service.enqueueParse(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      {
        examId: "exam-a",
        rawImportId: "raw-import-a",
        sha256: " ",
      },
    )).rejects.toThrow(BadRequestException);
    expect(producer.inputs).toHaveLength(0);
  });
});

class FakeProducer implements RawImportQueueProducer {
  readonly inputs: unknown[] = [];

  async enqueue(input: Parameters<RawImportQueueProducer["enqueue"]>[0]): Promise<ProducedJob> {
    this.inputs.push(input);
    return {
      queueName: input.queueName,
      name: input.queueName,
      payload: {
        tenantId: input.tenantId,
        userId: input.userId,
        entityId: input.entityId,
        contentHash: input.contentHash,
      },
      options: {
        attempts: 5 as const,
        backoff: { type: "exponential" as const, delay: 1000 },
        jobId: `${input.entityId}_${input.contentHash}`,
        removeOnFail: false as const,
      },
    };
  }
}
