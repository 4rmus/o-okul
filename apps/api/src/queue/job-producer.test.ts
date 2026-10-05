import { describe, expect, it } from "vitest";
import { chunkAnnouncementPushDevices, createTenantQueueJob } from "./job-producer.js";

describe("createTenantQueueJob", () => {
  it("KV-8 veli bildirim işi: kaynak satır kimliğiyle jobId, yalnız id taşıyan payload ve sınırlı saklama", () => {
    const job = createTenantQueueJob({
      queueName: "announcement-delivery",
      mode: "GUARDIAN_NOTIFY",
      kind: "ABSENCE",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "attendance-1",
      contentHash: "lz3k9",
    });

    expect(job.options).toEqual({
      attempts: 5,
      backoff: { type: "exponential", delay: 1000 },
      jobId: "guardian-notify_ABSENCE_attendance-1_lz3k9",
      removeOnFail: { age: 2 * 24 * 60 * 60 },
      removeOnComplete: { age: 2 * 24 * 60 * 60 },
    });
    expect(job.payload).toEqual({ mode: "GUARDIAN_NOTIFY", kind: "ABSENCE", tenantId: "tenant-a", userId: "user-a", entityId: "attendance-1", contentHash: "lz3k9" });
    expect(() => createTenantQueueJob({
      queueName: "announcement-delivery",
      mode: "GUARDIAN_NOTIFY",
      kind: "SMS" as never,
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "attendance-1",
      contentHash: "lz3k9",
    })).toThrow("ANNOUNCEMENT_DELIVERY_JOB_PAYLOAD_INVALID");
  });

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
      targetReference: "file:///mnt/restore-drills/staging-drill-2026-06.json",
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
        targetReference: "file:///mnt/restore-drills/staging-drill-2026-06.json",
        reason: "Aylık restore kanıtı",
      },
      options: {
        jobId: "backup-restore-a_backup-hash-a",
      },
    });
  });

  it("backup-restore backup job payload'ına off-host hedefini ekler", () => {
    const job = createTenantQueueJob({
      queueName: "backup-restore",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "backup-restore-a",
      contentHash: "backup-hash-a",
      operationType: "BACKUP",
      targetReference: "s3://o-okul-prod-backups/tenant-a",
      reason: "Günlük off-host yedek",
    });

    expect(job).toMatchObject({
      queueName: "backup-restore",
      name: "backup-restore",
      payload: {
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "backup-hash-a",
        operationType: "BACKUP",
        targetReference: "s3://o-okul-prod-backups/tenant-a",
        reason: "Günlük off-host yedek",
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

  it("duyuru push'unu 25'lik chunk'lara böler ve gönderim başına deterministik jobId verir", () => {
    const deviceIds = Array.from({ length: 60 }, (_, index) => `device-${String(index).padStart(2, "0")}`);
    const chunks = chunkAnnouncementPushDevices(deviceIds);
    expect(chunks.map((chunk) => chunk.length)).toEqual([25, 25, 10]);

    const jobsFor = (sendKey: string) => chunks.map((chunk, chunkIndex) => createTenantQueueJob({
      queueName: "announcement-delivery",
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "announcement-a",
      contentHash: `push-${chunkIndex}`,
      channel: "PUSH",
      mode: "PUSH_SEND",
      sendKey,
      chunkIndex,
      deviceIds: chunk,
      title: "Veli toplantısı",
    }));
    const jobs = jobsFor("aaaaaaaaaaaaaaaaaaaaaaaa");

    expect(jobs.map((job) => job.options.jobId)).toEqual([
      "announcement_announcement-a_PUSH_aaaaaaaaaaaaaaaaaaaaaaaa_0",
      "announcement_announcement-a_PUSH_aaaaaaaaaaaaaaaaaaaaaaaa_1",
      "announcement_announcement-a_PUSH_aaaaaaaaaaaaaaaaaaaaaaaa_2",
    ]);
    // Same send request -> same jobIds (BullMQ no-op re-add); a new send -> a disjoint job set.
    expect(jobsFor("aaaaaaaaaaaaaaaaaaaaaaaa").map((job) => job.options.jobId)).toEqual(jobs.map((job) => job.options.jobId));
    const otherSend = jobsFor("bbbbbbbbbbbbbbbbbbbbbbbb").map((job) => job.options.jobId);
    expect(otherSend.some((id) => jobs.some((job) => job.options.jobId === id))).toBe(false);
    // Push jobs are retained 30 days: that is the dedupe window for a retried send.
    const thirtyDays = 30 * 24 * 60 * 60;
    expect(jobs.every((job) => JSON.stringify(job.options.removeOnComplete) === JSON.stringify({ age: thirtyDays }))).toBe(true);
    expect(jobs.every((job) => JSON.stringify(job.options.removeOnFail) === JSON.stringify({ age: thirtyDays }))).toBe(true);
    expect(jobs.every((job) => !job.options.jobId.includes(":"))).toBe(true);
  });

  it("duyuru push chunk'ı 25'i aşarsa veya başlık boşsa payload üretmez", () => {
    const base = {
      queueName: "announcement-delivery" as const,
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: "announcement-a",
      contentHash: "push-0",
      channel: "PUSH" as const,
      mode: "PUSH_SEND" as const,
      sendKey: "aaaaaaaaaaaaaaaaaaaaaaaa",
      chunkIndex: 0,
      title: "Veli toplantısı",
    };
    expect(() => createTenantQueueJob({ ...base, deviceIds: Array.from({ length: 26 }, (_, index) => `device-${index}`) }))
      .toThrow("ANNOUNCEMENT_DELIVERY_JOB_PAYLOAD_INVALID");
    expect(() => createTenantQueueJob({ ...base, deviceIds: ["device-1"], title: " " }))
      .toThrow("ANNOUNCEMENT_DELIVERY_JOB_PAYLOAD_INVALID");
    expect(() => createTenantQueueJob({ ...base, deviceIds: ["device-1"], sendKey: "raw:key" }))
      .toThrow("ANNOUNCEMENT_DELIVERY_JOB_PAYLOAD_INVALID");
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

  it("restore drill hedefi file URL değilse payload üretmez", () => {
    expect(() =>
      createTenantQueueJob({
        queueName: "backup-restore",
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "backup-hash-a",
        operationType: "RESTORE_DRILL",
        targetReference: "staging-drill-2026-06",
      }),
    ).toThrow("BACKUP_RESTORE_JOB_PAYLOAD_INVALID");
  });

  it("backup hedefi off-host URL değilse payload üretmez", () => {
    expect(() =>
      createTenantQueueJob({
        queueName: "backup-restore",
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "backup-hash-a",
        operationType: "BACKUP",
        targetReference: "offsite-backup",
      }),
    ).toThrow("BACKUP_RESTORE_JOB_PAYLOAD_INVALID");
  });

  it("backup hedefi lokal temp/root file URL ise payload üretmez", () => {
    expect(() =>
      createTenantQueueJob({
        queueName: "backup-restore",
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "backup-hash-a",
        operationType: "BACKUP",
        targetReference: "file:///tmp/tenant-a-backups",
      }),
    ).toThrow("BACKUP_RESTORE_JOB_PAYLOAD_INVALID");

    expect(() =>
      createTenantQueueJob({
        queueName: "backup-restore",
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "backup-hash-a",
        operationType: "BACKUP",
        targetReference: "file:///",
      }),
    ).toThrow("BACKUP_RESTORE_JOB_PAYLOAD_INVALID");
  });

  it("restore drill hedefi lokal temp file URL ise payload üretmez", () => {
    expect(() =>
      createTenantQueueJob({
        queueName: "backup-restore",
        tenantId: "tenant-a",
        userId: "user-a",
        entityId: "backup-restore-a",
        contentHash: "backup-hash-a",
        operationType: "RESTORE_DRILL",
        targetReference: "file:///tmp/staging-drill-2026-06.json",
      }),
    ).toThrow("BACKUP_RESTORE_JOB_PAYLOAD_INVALID");
  });
});
