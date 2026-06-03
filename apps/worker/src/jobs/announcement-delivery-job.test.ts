import { describe, expect, it } from "vitest";
import { getJobContext } from "../context/job-context.js";
import {
  processAnnouncementDeliveryJob,
  type AnnouncementDeliveryReportInput,
  type AnnouncementDeliveryReporter,
} from "./announcement-delivery-job.js";

describe("processAnnouncementDeliveryJob", () => {
  it("duyuru teslim sonucunu raporlayıcıya yazar", async () => {
    const reporter = new FakeDeliveryReporter();

    const result = await processAnnouncementDeliveryJob(
      {
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
          providerErrorCode: "EMAIL_PROVIDER_RETRY",
        },
      },
      reporter,
    );

    expect(result).toEqual({
      tenantId: "tenant-a",
      announcementId: "announcement-a",
      channel: "EMAIL",
      recipientCount: 3,
      deliveredCount: 2,
      failedCount: 1,
      status: "completed",
    });
    expect(reporter.inputs).toEqual([{
      ...result,
      providerErrorCode: "EMAIL_PROVIDER_RETRY",
    }]);
  });

  it("job context'i raporlayıcı çalışırken taşır", async () => {
    const contexts: unknown[] = [];
    const reporter: AnnouncementDeliveryReporter = {
      async upsert() {
        contexts.push(getJobContext());
      },
    };

    await processAnnouncementDeliveryJob(
      {
        id: "announcement-a_push-report-v1",
        name: "announcement-delivery",
        payload: {
          tenantId: "tenant-a",
          userId: "user-a",
          entityId: "announcement-a",
          contentHash: "push-report-v1",
          channel: "PUSH",
          recipientCount: 3,
          deliveredCount: 0,
          failedCount: 3,
          status: "failed",
          providerErrorCode: "PUSH_PROVIDER_DOWN",
        },
      },
      reporter,
    );

    expect(contexts).toEqual([{
      tenantId: "tenant-a",
      userId: "user-a",
      jobId: "announcement-a_push-report-v1",
    }]);
  });

  it("yanlış job adı veya tutarsız sayılarda işi başlatmaz", async () => {
    const reporter = new FakeDeliveryReporter();

    await expect(
      processAnnouncementDeliveryJob(
        {
          id: "announcement-a_email-report-v1",
          name: "sms-batch",
          payload: createPayload(),
        },
        reporter,
      ),
    ).rejects.toThrow("ANNOUNCEMENT_DELIVERY_JOB_NAME_INVALID");

    await expect(
      processAnnouncementDeliveryJob(
        {
          id: "announcement-a_email-report-v1",
          name: "announcement-delivery",
          payload: {
            ...createPayload(),
            deliveredCount: 3,
            failedCount: 1,
          },
        },
        reporter,
      ),
    ).rejects.toThrow("ANNOUNCEMENT_DELIVERY_COUNTS_INVALID");
  });
});

function createPayload() {
  return {
    tenantId: "tenant-a",
    userId: "user-a",
    entityId: "announcement-a",
    contentHash: "email-report-v1",
    channel: "EMAIL" as const,
    recipientCount: 3,
    deliveredCount: 2,
    failedCount: 1,
    status: "completed" as const,
  };
}

class FakeDeliveryReporter implements AnnouncementDeliveryReporter {
  inputs: AnnouncementDeliveryReportInput[] = [];

  async upsert(input: AnnouncementDeliveryReportInput): Promise<void> {
    this.inputs.push(input);
  }
}
