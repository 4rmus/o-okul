import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AuditLogService, CreateAuditLogInput } from "../audit-log/audit-log.service.js";
import type { AnnouncementStore } from "../announcement/announcement-store.js";
import type { MessageTemplateRecord, MessageTemplateService } from "../message-template/message-template.service.js";
import type { ScheduleStore } from "../program/schedule-store.js";
import type { ProducedJob } from "../queue/job-producer.js";
import type { ClassStore } from "../school/class-store.js";
import type { GuardianStore } from "../school/guardian-store.js";
import type { GuardianStudentStore } from "../school/guardian-student-store.js";
import type { StudentStore } from "../student/student-store.js";
import type {
  SmsBatchDeliveryReportRecord,
  SmsBatchDeliveryReportStore,
  SmsBatchQueuedReportInput,
} from "./sms-batch-delivery-report-store.js";
import { SmsBatchService, type SmsBatchQueueProducer } from "./sms-batch.service.js";

describe("SmsBatchService", () => {
  const originalSmsEnabled = process.env.SMS_ENABLED;

  beforeEach(() => {
    process.env.SMS_ENABLED = "true";
  });

  afterEach(() => {
    if (originalSmsEnabled === undefined) {
      delete process.env.SMS_ENABLED;
      return;
    }
    process.env.SMS_ENABLED = originalSmsEnabled;
  });

  it("SMS batch isteğini sms-batch queue job'una çevirir", async () => {
    const templates = new FakeMessageTemplateService();
    const deliveryReports = new FakeSmsBatchDeliveryReportStore();
    const producer = new FakeProducer();
    const auditLogs = new FakeAuditLogService();
    const service = new SmsBatchService(
      templates as unknown as MessageTemplateService,
      new FakeAnnouncementStore() as unknown as AnnouncementStore,
      new FakeClassStore() as unknown as ClassStore,
      deliveryReports,
      new FakeGuardianStore() as unknown as GuardianStore,
      new FakeGuardianStudentStore() as unknown as GuardianStudentStore,
      producer,
      new FakeScheduleStore() as unknown as ScheduleStore,
      new FakeStudentStore() as unknown as StudentStore,
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
    expect(deliveryReports.reports).toEqual([expect.objectContaining({
      tenantId: "tenant-a",
      templateId: "message-template-a",
      recipientCount: 2,
      jobId: `${producer.inputs[0]?.entityId}_${producer.inputs[0]?.contentHash}`,
      status: "queued",
    })]);
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
    const service = new SmsBatchService(
      new FakeMessageTemplateService() as unknown as MessageTemplateService,
      new FakeAnnouncementStore() as unknown as AnnouncementStore,
      new FakeClassStore() as unknown as ClassStore,
      new FakeSmsBatchDeliveryReportStore(),
      new FakeGuardianStore() as unknown as GuardianStore,
      new FakeGuardianStudentStore() as unknown as GuardianStudentStore,
      producer,
      new FakeScheduleStore() as unknown as ScheduleStore,
      new FakeStudentStore() as unknown as StudentStore,
    );

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

  it("SMS_ENABLED açık değilse queue'ya iş göndermez", async () => {
    delete process.env.SMS_ENABLED;
    const producer = new FakeProducer();
    const service = new SmsBatchService(
      new FakeMessageTemplateService() as unknown as MessageTemplateService,
      new FakeAnnouncementStore() as unknown as AnnouncementStore,
      new FakeClassStore() as unknown as ClassStore,
      new FakeSmsBatchDeliveryReportStore(),
      new FakeGuardianStore() as unknown as GuardianStore,
      new FakeGuardianStudentStore() as unknown as GuardianStudentStore,
      producer,
      new FakeScheduleStore() as unknown as ScheduleStore,
      new FakeStudentStore() as unknown as StudentStore,
    );

    await expect(service.enqueue(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      {
        templateId: "message-template-a",
        recipients: [{ to: "5000000001" }],
      },
    )).rejects.toThrow("SMS_DISABLED");
    expect(producer.inputs).toHaveLength(0);
  });

  it("alıcı yoksa queue'ya iş göndermez", async () => {
    const producer = new FakeProducer();
    const service = new SmsBatchService(
      new FakeMessageTemplateService() as unknown as MessageTemplateService,
      new FakeAnnouncementStore() as unknown as AnnouncementStore,
      new FakeClassStore() as unknown as ClassStore,
      new FakeSmsBatchDeliveryReportStore(),
      new FakeGuardianStore() as unknown as GuardianStore,
      new FakeGuardianStudentStore() as unknown as GuardianStudentStore,
      producer,
      new FakeScheduleStore() as unknown as ScheduleStore,
      new FakeStudentStore() as unknown as StudentStore,
    );

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

  it("SMS alıcı önizlemesini sınıf ve veli SMS iznine göre üretir", async () => {
    const service = new SmsBatchService(
      new FakeMessageTemplateService() as unknown as MessageTemplateService,
      new FakeAnnouncementStore() as unknown as AnnouncementStore,
      new FakeClassStore() as unknown as ClassStore,
      new FakeSmsBatchDeliveryReportStore(),
      new FakeGuardianStore() as unknown as GuardianStore,
      new FakeGuardianStudentStore() as unknown as GuardianStudentStore,
      new FakeProducer(),
      new FakeScheduleStore() as unknown as ScheduleStore,
      new FakeStudentStore() as unknown as StudentStore,
    );

    await expect(service.previewRecipients(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      { announcementId: "announcement-a", studentStatus: "ACTIVE" },
    )).resolves.toEqual({
      recipientCount: 1,
      recipients: [{
        to: "5000000001",
        guardianId: "guardian-a",
        guardianName: "Ali Veli",
        studentIds: ["student-a"],
        studentNames: ["Ada A"],
      }],
    });
  });

  it("SMS_ENABLED açık değilse önizleme üretmez", async () => {
    process.env.SMS_ENABLED = "false";
    const service = new SmsBatchService(
      new FakeMessageTemplateService() as unknown as MessageTemplateService,
      new FakeAnnouncementStore() as unknown as AnnouncementStore,
      new FakeClassStore() as unknown as ClassStore,
      new FakeSmsBatchDeliveryReportStore(),
      new FakeGuardianStore() as unknown as GuardianStore,
      new FakeGuardianStudentStore() as unknown as GuardianStudentStore,
      new FakeProducer(),
      new FakeScheduleStore() as unknown as ScheduleStore,
      new FakeStudentStore() as unknown as StudentStore,
    );

    await expect(service.previewRecipients(
      {
        tenantId: "tenant-a",
        userId: "user-a",
        roles: ["TENANT_ADMIN"],
        bypassRls: false,
      },
      { announcementId: "announcement-a", studentStatus: "ACTIVE" },
    )).rejects.toThrow("SMS_DISABLED");
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

class FakeAnnouncementStore {
  async findById(id: string) {
    if (id !== "announcement-a") return undefined;
    return {
      id,
      tenantId: "tenant-a",
      title: "Veli toplantısı",
      body: "Cuma günü 8-A sınıfı için veli toplantısı yapılacaktır.",
      audience: "GUARDIANS",
      campusId: "campus-main",
      gradeLevelId: "grade-8",
      classId: "class-a",
      courseId: "course-math",
      termId: "term-2026-spring",
      publishedAt: "2026-06-08T09:00:00.000Z",
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

class FakeSmsBatchDeliveryReportStore implements SmsBatchDeliveryReportStore {
  reports: SmsBatchDeliveryReportRecord[] = [];

  async findByJobId(jobId: string): Promise<SmsBatchDeliveryReportRecord | undefined> {
    return this.reports.find((candidate) => candidate.jobId === jobId);
  }

  async upsertQueued(input: SmsBatchQueuedReportInput): Promise<SmsBatchDeliveryReportRecord> {
    const record: SmsBatchDeliveryReportRecord = {
      id: `sms-report-${this.reports.length + 1}`,
      ...input,
      sentCount: 0,
      failedCount: 0,
      billableSegments: 0,
      status: "queued",
    };
    this.reports.push(record);
    return record;
  }
}

class FakeClassStore {
  async list() {
    return [
      { id: "class-a", tenantId: "tenant-a", name: "8-A", campusId: "campus-main", gradeLevelId: "grade-8" },
      { id: "class-b", tenantId: "tenant-a", name: "7-B", campusId: "campus-main", gradeLevelId: "grade-7" },
    ];
  }
}

class FakeStudentStore {
  async list() {
    return [
      { id: "student-a", tenantId: "tenant-a", firstName: "Ada", lastName: "A", classId: "class-a", status: "ACTIVE" },
      { id: "student-passive", tenantId: "tenant-a", firstName: "Pasif", lastName: "A", classId: "class-a", status: "PASSIVE" },
      { id: "student-b", tenantId: "tenant-a", firstName: "Bora", lastName: "A", classId: "class-b", status: "ACTIVE" },
      { id: "student-other", tenantId: "tenant-b", firstName: "Başka", lastName: "Tenant", status: "ACTIVE" },
    ];
  }
}

class FakeScheduleStore {
  async list() {
    return [
      {
        id: "lesson-a",
        tenantId: "tenant-a",
        classId: "class-a",
        teacherId: "teacher-a",
        courseId: "course-math",
        termId: "term-2026-spring",
        title: "Matematik",
        startsAt: "2026-06-01T09:00:00.000Z",
        endsAt: "2026-06-01T10:00:00.000Z",
      },
      {
        id: "lesson-b",
        tenantId: "tenant-a",
        classId: "class-b",
        teacherId: "teacher-a",
        courseId: "course-turkish",
        termId: "term-2026-spring",
        title: "Turkce",
        startsAt: "2026-06-01T10:00:00.000Z",
        endsAt: "2026-06-01T11:00:00.000Z",
      },
    ];
  }
}

class FakeGuardianStore {
  async findById(id: string) {
    const guardians = [
      { id: "guardian-a", tenantId: "tenant-a", firstName: "Ali", lastName: "Veli", phone: "5000000001" },
      { id: "guardian-no-phone", tenantId: "tenant-a", firstName: "Telefonsuz", lastName: "Veli" },
      { id: "guardian-b", tenantId: "tenant-a", firstName: "Banu", lastName: "Veli", phone: "5000000002" },
    ];
    return guardians.find((guardian) => guardian.id === id);
  }
}

class FakeGuardianStudentStore {
  async listByStudent(studentId: string) {
    const links = [
      {
        id: "guardian-student-a",
        tenantId: "tenant-a",
        guardianId: "guardian-a",
        studentId: "student-a",
        canViewFinance: true,
        canReceiveSms: true,
        canReceiveAnnouncements: true,
        canOpenSupportTickets: true,
      },
      {
        id: "guardian-student-no-phone",
        tenantId: "tenant-a",
        guardianId: "guardian-no-phone",
        studentId: "student-a",
        canViewFinance: true,
        canReceiveSms: true,
        canReceiveAnnouncements: true,
        canOpenSupportTickets: true,
      },
      {
        id: "guardian-student-b",
        tenantId: "tenant-a",
        guardianId: "guardian-b",
        studentId: "student-b",
        canViewFinance: true,
        canReceiveSms: false,
        canReceiveAnnouncements: true,
        canOpenSupportTickets: true,
      },
    ];
    return links.filter((link) => link.studentId === studentId);
  }
}

class FakeAuditLogService {
  readonly records: CreateAuditLogInput[] = [];

  async record(input: CreateAuditLogInput) {
    this.records.push(input);
    return { id: "audit-a", createdAt: "2026-06-06T09:00:00.000Z", ...input };
  }
}
