import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import type { AuditLogService, CreateAuditLogInput } from "../audit-log/audit-log.service.js";
import type { MessageTemplateRecord, MessageTemplateService } from "../message-template/message-template.service.js";
import type { ProducedJob } from "../queue/job-producer.js";
import { SmsBatchService, type SmsBatchQueueProducer } from "./sms-batch.service.js";

describe("SmsBatchService", () => {
  it("SMS batch isteğini sms-batch queue job'una çevirir", async () => {
    const templates = new FakeMessageTemplateService();
    const producer = new FakeProducer();
    const auditLogs = new FakeAuditLogService();
    const service = new SmsBatchService(
      templates as unknown as MessageTemplateService,
      producer,
      auditLogs as unknown as AuditLogService,
    );

    const result = await service.enqueue(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      {
        templateId: "message-template-a",
        recipients: [{ to: " 5000000001 " }, { to: "5000000002" }],
      },
    );

    expect(templates.inputs).toEqual([{ tenantId: "tenant-a", templateId: "message-template-a" }]);
    expect(producer.inputs).toHaveLength(1);
    expect(producer.inputs[0]).toMatchObject({
      queueName: "sms-batch",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "message-template-a",
      templateId: "message-template-a",
      messageBody: "Sayın veli, öğrencimizin deneme sınavı Pazartesi günü yapılacaktır.",
      recipients: [{ to: "5000000001" }, { to: "5000000002" }],
    });
    expect(result).toEqual({
      tenantId: "tenant-a",
      templateId: "message-template-a",
      recipientCount: 2,
      queueName: "sms-batch",
      jobId: `${producer.inputs[0]?.entityId}_${producer.inputs[0]?.contentHash}`,
      status: "queued",
    });
    expect(auditLogs.records).toEqual([{
      tenantId: "tenant-a",
      actorUserId: "user-a",
      entityType: "SmsBatch",
      entityId: `${producer.inputs[0]?.entityId}_${producer.inputs[0]?.contentHash}`,
      action: "sms_batch.queued",
      diff: {
        templateId: "message-template-a",
        recipientCount: 2,
        contentHash: producer.inputs[0]?.contentHash,
        jobId: `${producer.inputs[0]?.entityId}_${producer.inputs[0]?.contentHash}`,
      },
    }]);
  });

  it("tenant context yoksa queue'ya iş göndermez", async () => {
    const producer = new FakeProducer();
    const service = new SmsBatchService(new FakeMessageTemplateService() as unknown as MessageTemplateService, producer);

    await expect(service.enqueue(
      {
        tenantId: null,
        userId: "user-a",
        roles: ["SYSTEM_ADMIN"],
        bypassRls: true,
      },
      {
        templateId: "message-template-a",
        recipients: [{ to: "5000000001" }],
      },
    )).rejects.toThrow(ForbiddenException);
    expect(producer.inputs).toHaveLength(0);
  });

  it("alıcı yoksa queue'ya iş göndermez", async () => {
    const producer = new FakeProducer();
    const service = new SmsBatchService(new FakeMessageTemplateService() as unknown as MessageTemplateService, producer);

    await expect(service.enqueue(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      {
        templateId: "message-template-a",
        recipients: [{ to: " " }],
      },
    )).rejects.toThrow(BadRequestException);
    expect(producer.inputs).toHaveLength(0);
  });
});

class FakeMessageTemplateService {
  readonly inputs: Array<{ tenantId: string | null; templateId: string }> = [];

  async findOne(context: { tenantId: string | null }, id: string): Promise<MessageTemplateRecord> {
    this.inputs.push({ tenantId: context.tenantId, templateId: id });
    return {
      id,
      tenantId: "tenant-a",
      name: "Deneme sınavı hatırlatma",
      channel: "SMS",
      body: "Sayın veli, öğrencimizin deneme sınavı Pazartesi günü yapılacaktır.",
    };
  }
}

class FakeProducer implements SmsBatchQueueProducer {
  inputs: Parameters<SmsBatchQueueProducer["enqueue"]>[0][] = [];

  async enqueue(input: Parameters<SmsBatchQueueProducer["enqueue"]>[0]): Promise<ProducedJob> {
    this.inputs.push(input);
    const { queueName: _queueName, ...payload } = input;
    return {
      queueName: input.queueName,
      name: input.queueName,
      payload,
      options: {
        attempts: 5,
        backoff: { type: "exponential", delay: 1000 },
        jobId: `${input.entityId}_${input.contentHash}`,
        removeOnFail: false,
      },
    };
  }
}

class FakeAuditLogService {
  readonly records: CreateAuditLogInput[] = [];

  async record(input: CreateAuditLogInput) {
    this.records.push(input);
    return { id: "audit-a", createdAt: "2026-06-06T09:00:00.000Z", ...input };
  }
}
