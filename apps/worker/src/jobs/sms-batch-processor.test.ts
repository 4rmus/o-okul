import { describe, expect, it } from "vitest";
import { createSmsBatchProcessor } from "./sms-batch-processor.js";

describe("createSmsBatchProcessor", () => {
  it("prod ortamında gerçek SMS sağlayıcısı yoksa no-op ile başlamaz", () => {
    expect(() => createSmsBatchProcessor({
      env: {
        NODE_ENV: "production",
        SMS_PROVIDER: "noop",
      },
    })).toThrow("SMS_PROVIDER_REQUIRED");
  });

  it("lokalde açıkça no-op adapter ile çalışabilir", async () => {
    const processor = createSmsBatchProcessor({
      env: {
        NODE_ENV: "development",
        SMS_PROVIDER: "noop",
      },
    });

    await expect(processor({
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
    })).resolves.toMatchObject({
      sentCount: 1,
      status: "completed",
    });
  });
});
