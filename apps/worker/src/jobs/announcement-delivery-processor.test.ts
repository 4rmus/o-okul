import { describe, expect, it } from "vitest";
import type { AnnouncementDeliveryReportInput, AnnouncementDeliveryReporter } from "./announcement-delivery-job.js";
import { createAnnouncementDeliveryProcessor } from "./announcement-delivery-processor.js";

describe("createAnnouncementDeliveryProcessor", () => {
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
