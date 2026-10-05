import { describe, expect, it } from "vitest";
import type { AnnouncementDeliveryReportInput, AnnouncementDeliveryReporter } from "./announcement-delivery-job.js";
import { createAnnouncementDeliveryProcessor } from "./announcement-delivery-processor.js";

describe("createAnnouncementDeliveryProcessor", () => {
  it("KV-8: e-posta ayarı eksikse e-posta kanalı atlanır, push yine gider", async () => {
    const sent: string[] = [];
    const processor = createAnnouncementDeliveryProcessor({
      reporter: new FakeDeliveryReporter(),
      env: { NODE_ENV: "production", NOTIFICATION_PROVIDER: "noop" },
      pushSender: { send: async (_token, body) => { sent.push(body); return "sent"; } },
      guardianStore: {
        loadSettings: async () => ({ absenceEnabled: true, paymentDueEnabled: true, gradePublishEnabled: true, absenceThreshold: 10 }),
        claimAbsence: async () => ({ studentId: "student-a", notifiedDate: "2026-10-05", thresholdReached: false }),
        claimPaymentDue: async () => undefined,
        claimGradePublished: async () => [],
        listRecipients: async () => [{ userId: "user-guardian-a", email: "veli-a@example.test" }],
        listActiveDevices: async () => [{ id: "device-1", token: "token-1" }],
        disableDevices: async () => undefined,
      },
    });

    await expect(processor({
      id: "guardian-notify_ABSENCE_attendance-a_k1",
      name: "announcement-delivery",
      payload: { tenantId: "tenant-a", userId: "user-a", entityId: "attendance-a", contentHash: "k1", mode: "GUARDIAN_NOTIFY", kind: "ABSENCE" },
    })).resolves.toMatchObject({ pushSentCount: 1, emailSentCount: 0 });
    expect(sent).toHaveLength(1);
  });

  it("verilen reporter ile announcement-delivery job'unu işler", async () => {
    const reporter = new FakeDeliveryReporter();
    const processor = createAnnouncementDeliveryProcessor({ reporter });

    await expect(processor({
      id: "announcement-a_email-report-v1",
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
      },
    })).resolves.toMatchObject({
      tenantId: "tenant-a",
      announcementId: "announcement-a",
      channel: "EMAIL",
    });

    expect(reporter.inputs).toEqual([expect.objectContaining({
      tenantId: "tenant-a",
      announcementId: "announcement-a",
      channel: "EMAIL",
      recipientCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      status: "completed",
    })]);
  });
});

class FakeDeliveryReporter implements AnnouncementDeliveryReporter {
  inputs: AnnouncementDeliveryReportInput[] = [];

  async upsert(input: AnnouncementDeliveryReportInput): Promise<void> {
    this.inputs.push(input);
  }
}
