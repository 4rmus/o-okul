import { ForbiddenException } from "@nestjs/common";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { featureRolloutCatalog, FeatureRolloutService, parseFeatureRolloutConfig } from "./feature-rollout.service.js";

const originalConfig = process.env.FEATURE_ROLLOUTS_JSON;

afterEach(() => {
  if (originalConfig === undefined) delete process.env.FEATURE_ROLLOUTS_JSON;
  else process.env.FEATURE_ROLLOUTS_JSON = originalConfig;
});

describe("FeatureRolloutService", () => {
  it("katalogdaki tüm flagleri metadata ile default-off tanımlar", () => {
    expect(featureRolloutCatalog).toHaveLength(9);
    expect(featureRolloutCatalog.every((item) => (
      item.defaultEnabled === false && Boolean(item.owner) && Boolean(item.expiresAt) && Boolean(item.removalIssue)
    ))).toBe(true);
  });

  it("eksik configte tüm flagleri kapalı çözer", async () => {
    delete process.env.FEATURE_ROLLOUTS_JSON;
    const audit = { record: vi.fn() };
    const service = new FeatureRolloutService(audit as never);

    await expect(service.resolve(tenantContext, new Date("2026-08-10T00:00:00.000Z")))
      .resolves.toEqual({ enabledFeatureKeys: [] });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it("malformed env varsa servis startupında fail eder", () => {
    process.env.FEATURE_ROLLOUTS_JSON = JSON.stringify({ "web.unknown": [] });
    expect(() => new FeatureRolloutService({ record: vi.fn() } as never))
      .toThrow("FEATURE_ROLLOUTS_CONFIG_INVALID:UNKNOWN_KEY");
  });

  it("yalnız aktif tenant allowlistini döndürür ve enabled exposure auditini bekler", async () => {
    process.env.FEATURE_ROLLOUTS_JSON = validConfig();
    const audit = { record: vi.fn().mockResolvedValue({}) };
    const service = new FeatureRolloutService(audit as never);

    await expect(service.resolve(tenantContext, new Date("2026-08-10T00:00:00.000Z"))).resolves.toEqual({
      enabledFeatureKeys: ["web.shell-v2"],
    });
    await expect(service.resolve({ ...tenantContext, tenantId: "tenant-b" }, new Date("2026-08-10T00:00:00.000Z")))
      .resolves.toEqual({ enabledFeatureKeys: [] });
    expect(audit.record).toHaveBeenCalledWith({
      tenantId: "tenant-a",
      actorUserId: "user-a",
      entityType: "FeatureRollout",
      action: "feature_rollout.exposed",
      diff: { featureKeys: ["web.shell-v2"] },
    });
  });

  it("runtime başlangıç ve expiry sınırlarında flagi kapatır", async () => {
    process.env.FEATURE_ROLLOUTS_JSON = validConfig();
    const service = new FeatureRolloutService({ record: vi.fn() } as never);
    await expect(service.resolve(tenantContext, new Date("2026-07-31T23:59:59.999Z")))
      .resolves.toEqual({ enabledFeatureKeys: [] });
    await expect(service.resolve(tenantContext, new Date("2026-09-02T00:00:00.000Z")))
      .resolves.toEqual({ enabledFeatureKeys: [] });
  });

  it("tenant dışı ve RLS bypass contextlerini fail-closed reddeder", async () => {
    const service = new FeatureRolloutService({ record: vi.fn() } as never);
    await expect(service.resolve({ ...tenantContext, tenantId: null, roles: ["SYSTEM_ADMIN"] })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.resolve({ ...tenantContext, bypassRls: true })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("audit başarısızsa enabled sonucu açmaz", async () => {
    process.env.FEATURE_ROLLOUTS_JSON = validConfig();
    const service = new FeatureRolloutService({ record: vi.fn().mockRejectedValue(new Error("AUDIT_DOWN")) } as never);
    await expect(service.resolve(tenantContext, new Date("2026-08-10T00:00:00.000Z"))).rejects.toThrow("AUDIT_DOWN");
  });

  it("assertEnabled kapalı flagte erişimi reddeder", async () => {
    const service = new FeatureRolloutService({ record: vi.fn() } as never);
    await expect(service.assertEnabled(tenantContext, "web.shell-v2")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it.each([
    ["bozuk JSON", "{"],
    ["bilinmeyen key", JSON.stringify({ "web.unknown": [] })],
    ["bilinmeyen alan", JSON.stringify({ "web.shell-v2": [{ ...entry(), extra: true }] })],
    ["duplicate tenant", JSON.stringify({ "web.shell-v2": [entry(), entry()] })],
    ["ters tarih", JSON.stringify({ "web.shell-v2": [{ ...entry(), startsAt: "2026-09-01T00:00:00.000Z" }] })],
    ["90 günden uzun", JSON.stringify({ "web.shell-v2": [{ ...entry(), expiresAt: "2026-12-01T00:00:00.000Z" }] })],
    ["eksik expiry", JSON.stringify({ "web.shell-v2": [{ tenantId: "tenant-a", startsAt: "2026-08-01T00:00:00.000Z", reference: "DEC-20260809-01" }] })],
    ["PII reference", JSON.stringify({ "web.shell-v2": [{ ...entry(), reference: "veli@example.test" }] })],
  ])("%s configini startup parserda reddeder", (_name, raw) => {
    expect(() => parseFeatureRolloutConfig(raw)).toThrow(/^FEATURE_ROLLOUTS_CONFIG_INVALID:/);
  });
});

function validConfig() {
  return JSON.stringify({ "web.shell-v2": [entry()] });
}

function entry() {
  return {
    tenantId: "tenant-a",
    startsAt: "2026-08-01T00:00:00.000Z",
    expiresAt: "2026-09-01T00:00:00.000Z",
    reference: "DEC-20260809-01",
  };
}

const tenantContext: RequestContext = {
  bypassRls: false,
  roles: ["TENANT_ADMIN"],
  tenantId: "tenant-a",
  userId: "user-a",
};
