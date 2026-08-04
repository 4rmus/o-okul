import { describe, expect, it } from "vitest";
import {
  assertSessionTenantMatchesHost,
  assertValidTenantSlug,
  resolveTenantHostContext,
  resolveTenantSlugFromRequest,
} from "./tenant-host.js";

const env = { DOMAIN: "o-okul.com", LEGACY_TENANT_LOGIN_CUTOFF_AT: "2099-01-01T00:00:00.000Z" };

describe("tenant host", () => {
  it("tenant ve sistem hostunu çözer", () => {
    expect(resolveTenantHostContext(request("DNA-EGITIM.O-OKUL.COM:443"), env)).toEqual({ kind: "tenant", slug: "dna-egitim" });
    expect(resolveTenantSlugFromRequest(request("sistem.o-okul.com"), undefined, env)).toBe("system");
  });

  it.each(["a.b.o-okul.com", "admin.o-okul.com", "üni.o-okul.com", "xn--niversite-p9a.o-okul.com", "attacker.test"])("%s hostunu reddeder", (host) => {
    expect(() => resolveTenantHostContext(request(host), env)).toThrow(/TENANT_HOST_/);
  });

  it("body ve host tenantı ayrışırsa reddeder", () => {
    expect(() => resolveTenantSlugFromRequest(request("dna-egitim.o-okul.com"), "demo-kurum-b", env)).toThrow("TENANT_HOST_MISMATCH");
  });

  it("forwarded hostu yalnız güvenilir proxy adresinden kabul eder", () => {
    const trustedEnv = { ...env, TRUSTED_PROXY_CIDRS: "10.0.0.5/32" };
    expect(resolveTenantHostContext(request("edge.internal", "dna-egitim.o-okul.com", "10.0.0.5"), trustedEnv))
      .toEqual({ kind: "tenant", slug: "dna-egitim" });
    expect(() => resolveTenantHostContext(request("edge.internal", "dna-egitim.o-okul.com"), trustedEnv))
      .toThrow("TENANT_HOST_UNKNOWN");
  });

  it("domain ayarlıyken eksik hostu reddeder", () => {
    expect(() => resolveTenantHostContext(request(undefined), env)).toThrow("TENANT_HOST_UNKNOWN");
  });

  it("legacy root girişini kesim sonrasında emekliye ayırır", () => {
    expect(() => resolveTenantSlugFromRequest(
      request("o-okul.com"),
      "dna-egitim",
      { ...env, LEGACY_TENANT_LOGIN_CUTOFF_AT: "2020-01-01T00:00:00.000Z" },
    )).toThrow("LEGACY_TENANT_LOGIN_RETIRED");
  });

  it("tenant sessionını kardeş hostta reddeder", () => {
    expect(() => assertSessionTenantMatchesHost(
      request("demo-kurum-b.o-okul.com"),
      { tenantId: "tenant-a", tenantSlug: "dna-egitim" },
      env,
    )).toThrow("TENANT_HOST_MISMATCH");
  });

  it("yalnız DNS-safe ve ayrılmamış slug kabul eder", () => {
    expect(assertValidTenantSlug("dna-egitim")).toBe("dna-egitim");
    expect(() => assertValidTenantSlug("admin")).toThrow("TENANT_HOST_RESERVED");
    expect(() => assertValidTenantSlug("xn--niversite-p9a")).toThrow("TENANT_SLUG_INVALID");
    expect(() => assertValidTenantSlug("ab")).toThrow("TENANT_SLUG_INVALID");
  });
});

function request(host: string | undefined, forwardedHost?: string, remoteAddress = "203.0.113.10") {
  return {
    header(name: string) {
      if (name.toLowerCase() === "host") return host;
      if (name.toLowerCase() === "x-forwarded-host") return forwardedHost;
      return undefined;
    },
    socket: { remoteAddress },
  } as never;
}
