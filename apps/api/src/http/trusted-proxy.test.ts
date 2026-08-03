import type { Request } from "express";
import { describe, expect, it } from "vitest";
import { createTrustedProxyPredicate, resolveClientIp } from "./trusted-proxy.js";

describe("trusted proxy", () => {
  it("yalnız açıkça izin verilen proxy adreslerini kabul eder", () => {
    const trusted = createTrustedProxyPredicate({ TRUSTED_PROXY_CIDRS: "172.30.0.2/32,2001:db8:1::42/128" });

    expect(trusted("172.30.0.2")).toBe(true);
    expect(trusted("172.30.0.3")).toBe(false);
    expect(trusted("2001:db8:1::42")).toBe(true);
    expect(trusted("2001:db8:2::42")).toBe(false);
  });

  it("production'da proxy allowlist'i olmadan açılmaz", () => {
    expect(() => createTrustedProxyPredicate({ NODE_ENV: "production" })).toThrow("TRUSTED_PROXY_CIDRS_REQUIRED");
    expect(() => createTrustedProxyPredicate({ TRUSTED_PROXY_CIDRS: "172.30.0.2/31" })).toThrow("TRUSTED_PROXY_CIDRS_MUST_USE_EXACT_IPS");
    expect(() => createTrustedProxyPredicate({ TRUSTED_PROXY_CIDRS: "2001:db8:1::/64" })).toThrow("TRUSTED_PROXY_CIDRS_MUST_USE_EXACT_IPS");
  });

  it("istemci IP'sini Express'in güvenli olarak çözdüğü değerden alır", () => {
    const request = {
      headers: { "x-forwarded-for": "198.51.100.77", "x-real-ip": "198.51.100.77" },
      ip: "10.0.0.9",
      socket: { remoteAddress: "10.0.0.9" },
    } as unknown as Request;

    expect(resolveClientIp(request)).toBe("10.0.0.9");
  });
});
