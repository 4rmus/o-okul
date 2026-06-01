import { ServiceUnavailableException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { HealthService, type ReadinessChecker } from "./health.service.js";

describe("HealthService", () => {
  it("ready bağımlılıklar cevap verirken hazır döner", async () => {
    const service = new HealthService(checker({ postgres: true, redis: true }));

    await expect(service.ready()).resolves.toEqual({
      status: "ready",
      dependencies: {
        postgres: "ok",
        redis: "ok",
      },
    });
  });

  it("ready bağımlılık durumlarını hata detayına yazar", async () => {
    const service = new HealthService(checker({ postgres: true, redis: false }));

    await expect(service.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);

    try {
      await service.ready();
    } catch (error) {
      expect((error as ServiceUnavailableException).getResponse()).toMatchObject({
        error: {
          code: "DEPENDENCY_NOT_READY",
          details: {
            postgres: "ok",
            redis: "down",
          },
        },
      });
    }
  });
});

function checker(states: { postgres: boolean; redis: boolean }): ReadinessChecker {
  return {
    postgres: async () => states.postgres,
    redis: async () => states.redis,
  };
}
