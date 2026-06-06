import { describe, expect, it } from "vitest";
import { createTenantQueueJob } from "./job-producer.js";

describe("createTenantQueueJob", () => {
  it("planlanan BullMQ defaultlarını üretir", () => {
    const job = createTenantQueueJob({
      queueName: "excel-import",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "import-1",
      contentHash: "hash-1",
    });

    expect(job.options).toEqual({
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      jobId: "import-1_hash-1",
      removeOnFail: false,
      removeOnComplete: true,
    });
  });

  it("exam-evaluation job payload'ına kalıcı referansları ekler", () => {
    const job = createTenantQueueJob({
      queueName: "exam-evaluation",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "raw-import-a",
      contentHash: "hash-a",
      participantId: "participant-a",
      rawImportId: "raw-import-a",
      answerKeyId: "answer-key-a",
    });

    expect(job).toMatchObject({
      queueName: "exam-evaluation",
      name: "exam-evaluation",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "raw-import-a",
        contentHash: "hash-a",
        participantId: "participant-a",
        rawImportId: "raw-import-a",
        answerKeyId: "answer-key-a",
      },
      options: {
        jobId: "raw-import-a_hash-a",
      },
    });
  });

  it("report-generation job payload'ına rapor tipini ekler", () => {
    const job = createTenantQueueJob({
      queueName: "report-generation",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "exam-a",
      contentHash: "results-v1",
      reportType: "EXAM_RESULT_SUMMARY",
    });

    expect(job).toMatchObject({
      queueName: "report-generation",
      name: "report-generation",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "exam-a",
        contentHash: "results-v1",
        reportType: "EXAM_RESULT_SUMMARY",
      },
      options: {
        jobId: "exam-a_results-v1",
      },
    });
  });

  it("sms-batch job payload'ına şablon ve alıcıları ekler", () => {
    const job = createTenantQueueJob({
      queueName: "sms-batch",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "message-template-a",
      contentHash: "sms-hash-a",
      templateId: "message-template-a",
      messageBody: "Sayın veli, deneme sınavı Pazartesi günü yapılacaktır.",
      recipients: [{ to: "5000000001" }, { to: "5000000002" }],
    });

    expect(job).toMatchObject({
      queueName: "sms-batch",
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
      options: {
        jobId: "message-template-a_sms-hash-a",
      },
    });
  });

  it("announcement-delivery job payload'ına kanal ve teslim sayılarını ekler", () => {
    const job = createTenantQueueJob({
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

    expect(job).toMatchObject({
      queueName: "announcement-delivery",
      name: "announcement-delivery",
      payload: {
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
      options: {
        jobId: "announcement-a_email-report-v1",
      },
    });
  });

  it("backup-restore job payload'ına operasyon hedefini ekler", () => {
    const job = createTenantQueueJob({
      queueName: "backup-restore",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "backup-restore-a",
      contentHash: "backup-hash-a",
      operationType: "RESTORE_DRILL",
      targetReference: "staging-drill-2026-06",
      reason: "Aylık restore kanıtı",
    });

    expect(job).toMatchObject({
      queueName: "backup-restore",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "backup-hash-a",
        operationType: "RESTORE_DRILL",
        targetReference: "staging-drill-2026-06",
        reason: "Aylık restore kanıtı",
      },
      options: {
        jobId: "backup-restore-a_backup-hash-a",
      },
    });
  });

  it("tenant/user bilgisi eksik payload üretmez", () => {
    expect(() =>
      createTenantQueueJob({
        queueName: "excel-import",
        tenantId: "",
        userId: "user-a",
        entityId: "import-1",
        contentHash: "hash-1",
      }),
    ).toThrow("TENANT_JOB_PAYLOAD_INVALID");
  });

  it("exam-evaluation referansları eksikse payload üretmez", () => {
    expect(() =>
      createTenantQueueJob({
        queueName: "exam-evaluation",
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "raw-import-a",
        contentHash: "hash-a",
        participantId: "participant-a",
        rawImportId: "",
        answerKeyId: "answer-key-a",
      }),
    ).toThrow("EXAM_EVALUATION_JOB_PAYLOAD_INVALID");
  });

  it("report-generation rapor tipi eksikse payload üretmez", () => {
    expect(() =>
      createTenantQueueJob({
        queueName: "report-generation",
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "exam-a",
        contentHash: "results-v1",
        reportType: "" as "EXAM_RESULT_SUMMARY",
      }),
    ).toThrow("REPORT_GENERATION_JOB_PAYLOAD_INVALID");
  });

  it("sms-batch alıcıları eksikse payload üretmez", () => {
    expect(() =>
      createTenantQueueJob({
        queueName: "sms-batch",
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "message-template-a",
        contentHash: "sms-hash-a",
        templateId: "message-template-a",
        messageBody: "Mesaj",
        recipients: [],
      }),
    ).toThrow("SMS_BATCH_JOB_PAYLOAD_INVALID");
  });

  it("announcement-delivery sayıları tutarsızsa payload üretmez", () => {
    expect(() =>
      createTenantQueueJob({
        queueName: "announcement-delivery",
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "announcement-a",
        contentHash: "email-report-v1",
        channel: "EMAIL",
        recipientCount: 3,
        deliveredCount: 3,
        failedCount: 1,
        status: "completed",
      }),
    ).toThrow("ANNOUNCEMENT_DELIVERY_JOB_PAYLOAD_INVALID");
  });

  it("backup-restore hedefi eksikse payload üretmez", () => {
    expect(() =>
      createTenantQueueJob({
        queueName: "backup-restore",
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "backup-hash-a",
        operationType: "BACKUP",
        targetReference: "",
      }),
    ).toThrow("BACKUP_RESTORE_JOB_PAYLOAD_INVALID");
  });
});
