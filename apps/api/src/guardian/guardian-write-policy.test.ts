import { describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import type { FeatureRolloutService } from "../feature-rollout/feature-rollout.service.js";
import { GuardianWritePolicy } from "./guardian-write-policy.js";

describe("GuardianWritePolicy", () => {
  it("read-only rollout açıkken yeni guardian yazısını 410 ile kapatır", async () => {
    const resolve = vi.fn().mockResolvedValue({ enabledFeatureKeys: ["product.guardian-read-only"] });
    const policy = new GuardianWritePolicy({ resolve } as unknown as FeatureRolloutService);

    await expect(policy.assertWritable(context())).rejects.toMatchObject({
      status: 410,
      response: { message: "GUARDIAN_WRITE_READ_ONLY" },
    });
    expect(resolve).toHaveBeenCalledWith(context());
  });

  it("rollout kapalıyken legacy yazı geçişini değiştirmez", async () => {
    const resolve = vi.fn().mockResolvedValue({ enabledFeatureKeys: [] });
    const policy = new GuardianWritePolicy({ resolve } as unknown as FeatureRolloutService);

    await expect(policy.assertWritable(context())).resolves.toBeUndefined();
  });

  it("rollout çözümleme hatasını yutup fail-open olmaz", async () => {
    const resolve = vi.fn().mockRejectedValue(new Error("FEATURE_ROLLOUT_AUDIT_FAILED"));
    const policy = new GuardianWritePolicy({ resolve } as unknown as FeatureRolloutService);

    await expect(policy.assertWritable(context())).rejects.toThrow("FEATURE_ROLLOUT_AUDIT_FAILED");
  });
});

function context(): RequestContext {
  return {
    userId: "admin-a",
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    activePersona: "STAFF",
    bypassRls: false,
  };
}
