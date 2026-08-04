import { afterEach, describe, expect, it, vi } from "vitest";
import { getRequestContext } from "./request-context.js";
import { RequestContextMiddleware } from "./request-context.middleware.js";

describe("RequestContextMiddleware", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("does not enable RLS bypass for SYSTEM_ADMIN by default", async () => {
    const middleware = createMiddleware({ roles: ["SYSTEM_ADMIN"] });
    let captured;

    await middleware.use(createRequest({ authorization: "Bearer system-token" }), {} as never, () => {
      captured = getRequestContext();
    });

    expect(captured).toMatchObject({
      userId: "user-system",
      tenantId: null,
      roles: ["SYSTEM_ADMIN"],
      bypassRls: false,
    });
  });

  it("leaves explicit RLS bypass headers for the route metadata guard", async () => {
    const middleware = createMiddleware({ roles: ["SYSTEM_ADMIN"] });
    let captured;

    await middleware.use(
      createRequest({
        authorization: "Bearer system-token",
        rlsBypassReason: "tenant support investigation",
      }),
      {} as never,
      () => {
        captured = getRequestContext();
      },
    );

    expect(captured).toMatchObject({
      bypassRls: false,
    });
    expect(captured).not.toHaveProperty("rlsBypassReason");
  });

  it("keeps tenant scoped users on normal non-bypass context", async () => {
    const middleware = createMiddleware({ roles: ["TENANT_ADMIN"], tenantId: "tenant-a" });
    let captured;

    await middleware.use(createRequest({ authorization: "Bearer tenant-token" }), {} as never, () => {
      captured = getRequestContext();
    });

    expect(captured).toMatchObject({
      userId: "user-tenant",
      tenantId: "tenant-a",
      tenantAccessMode: "active",
      roles: ["TENANT_ADMIN"],
      bypassRls: false,
    });
  });

  it("token tenantı ile kurum hostu ayrışırsa reddeder", async () => {
    vi.stubEnv("DOMAIN", "o-okul.com");
    vi.stubEnv("LEGACY_TENANT_LOGIN_CUTOFF_AT", "2099-01-01T00:00:00.000Z");
    const middleware = createMiddleware({ roles: ["TENANT_ADMIN"], tenantId: "tenant-a", tenantSlug: "dna-egitim" });

    await expect(middleware.use(
      createRequest({ authorization: "Bearer tenant-token", host: "demo-kurum-b.o-okul.com" }),
      {} as never,
      vi.fn(),
    )).rejects.toThrow("TENANT_HOST_MISMATCH");
  });

  it("token tenantı doğru kurum hostunda request context kurar", async () => {
    vi.stubEnv("DOMAIN", "o-okul.com");
    const middleware = createMiddleware({ roles: ["TENANT_ADMIN"], tenantId: "tenant-a", tenantSlug: "dna-egitim" });
    let captured;

    await middleware.use(
      createRequest({ authorization: "Bearer tenant-token", host: "dna-egitim.o-okul.com" }),
      {} as never,
      () => { captured = getRequestContext(); },
    );

    expect(captured).toMatchObject({ tenantId: "tenant-a" });
  });

  it("kanonik kampüs scope'unu doğrulanmış tokendan request context'e taşır", async () => {
    const middleware = createMiddleware({
      roles: ["FINANCE_STAFF"],
      tenantId: "tenant-a",
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
    });
    let captured;

    await middleware.use(createRequest({ authorization: "Bearer finance-token" }), {} as never, () => {
      captured = getRequestContext();
    });

    expect(captured).toMatchObject({
      roles: ["FINANCE_STAFF"],
      campusScope: { scopeMode: "CAMPUSES", campusIds: ["campus-main"] },
    });
  });

  it.each(["TEACHER", "STUDENT", "GUARDIAN"])("rejects %s tokens without subject binding", async (role) => {
    const middleware = createMiddleware({ roles: [role], tenantId: "tenant-a" });

    await expect(
      middleware.use(createRequest({ authorization: "Bearer tenant-token" }), {} as never, vi.fn()),
    ).rejects.toThrow("SUBJECT_CONTEXT_MISSING");
  });

  it("keeps TENANT_ADMIN tokens valid without portal subject binding", async () => {
    const middleware = createMiddleware({ roles: ["TENANT_ADMIN"], tenantId: "tenant-a" });
    let captured;

    await middleware.use(createRequest({ authorization: "Bearer tenant-token" }), {} as never, () => {
      captured = getRequestContext();
    });

    expect(captured).toMatchObject({
      tenantId: "tenant-a",
      roles: ["TENANT_ADMIN"],
    });
  });

  it("keeps expired active tenants read-only on safe methods", async () => {
    const middleware = createMiddleware({
      roles: ["TENANT_ADMIN"],
      tenantId: "tenant-expired",
      licenseEndsAt: "2020-01-01T00:00:00.000Z",
    });
    let captured;

    await middleware.use(createRequest({ authorization: "Bearer tenant-token" }), {} as never, () => {
      captured = getRequestContext();
    });

    expect(captured).toMatchObject({
      tenantId: "tenant-expired",
      tenantAccessMode: "read_only",
      bypassRls: false,
    });
  });

  it("rejects expired active tenants on write methods", async () => {
    const middleware = createMiddleware({
      roles: ["TENANT_ADMIN"],
      tenantId: "tenant-expired",
      licenseEndsAt: "2020-01-01T00:00:00.000Z",
    });

    await expect(
      middleware.use(
        createRequest({
          authorization: "Bearer tenant-token",
          method: "POST",
        }),
        {} as never,
        vi.fn(),
      ),
    ).rejects.toThrow("TENANT_LICENSE_EXPIRED_READ_ONLY");
  });

  it("rejects tenants before their license start on read and write methods", async () => {
    const middleware = createMiddleware({
      roles: ["TENANT_ADMIN"],
      tenantId: "tenant-not-started",
      licenseStartsAt: "2099-01-01T00:00:00.000Z",
    });

    await expect(
      middleware.use(createRequest({ authorization: "Bearer tenant-token" }), {} as never, vi.fn()),
    ).rejects.toThrow("TENANT_LICENSE_NOT_STARTED");
  });

  it.each([
    ["FROZEN", "TENANT_LICENSE_FROZEN"],
    ["EXPIRED", "TENANT_LICENSE_EXPIRED"],
    ["CANCELLED", "TENANT_LICENSE_CANCELLED"],
  ] as const)("%s lisans durumunda okumayı da reddeder", async (licenseState, errorCode) => {
    const middleware = createMiddleware({ roles: ["TENANT_ADMIN"], tenantId: "tenant-closed", licenseState });
    await expect(
      middleware.use(createRequest({ authorization: "Bearer tenant-token" }), {} as never, vi.fn()),
    ).rejects.toThrow(errorCode);
  });

  it("kanonik lisans dönemi yoksa fail-closed reddeder", async () => {
    const middleware = createMiddleware({ roles: ["TENANT_ADMIN"], tenantId: "tenant-missing", licenseState: "MISSING" });
    await expect(
      middleware.use(createRequest({ authorization: "Bearer tenant-token" }), {} as never, vi.fn()),
    ).rejects.toThrow("TENANT_LICENSE_TERM_MISSING");
  });

  it("legacy lisans aynası kanonik dönemle ayrışırsa fail-closed reddeder", async () => {
    const middleware = createMiddleware({
      roles: ["TENANT_ADMIN"],
      tenantId: "tenant-drift",
      licenseState: "ACTIVE",
      mirrorParity: false,
    });
    await expect(
      middleware.use(createRequest({ authorization: "Bearer tenant-token" }), {} as never, vi.fn()),
    ).rejects.toThrow("TENANT_LICENSE_MIRROR_PARITY_MISMATCH");
  });
});

function createMiddleware(input: {
  roles: string[];
  tenantId?: string;
  licenseEndsAt?: string;
  licenseStartsAt?: string;
  licenseState?: "SCHEDULED" | "ACTIVE" | "READ_ONLY" | "FROZEN" | "EXPIRED" | "CANCELLED" | "MISSING";
  mirrorParity?: boolean;
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
  campusScope?: { scopeMode: "TENANT" | "CAMPUSES"; campusIds: string[] };
  tenantSlug?: string;
}) {
  return new RequestContextMiddleware(
    {
      verifyActiveAccessToken: () => ({
        sub: input.tenantId ? "user-tenant" : "user-system",
        tenantId: input.tenantId ?? "system",
        roles: input.roles,
        campusScope: input.campusScope,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      }),
    } as never,
    { verifyPreviewToken: vi.fn() } as never,
    {
      findForAdmin: async (tenantId: string) => ({
        id: tenantId,
        slug: input.tenantSlug ?? "dna-egitim",
        status: "ACTIVE",
        licenseEndsAt: input.licenseEndsAt,
        licenseStartsAt: input.licenseStartsAt,
      }),
    } as never,
    {
      resolveForTenant: async (tenantId: string) => input.licenseState === "MISSING" ? undefined : ({
        mirrorParity: input.mirrorParity ?? true,
        state: input.licenseState
          ?? (input.licenseStartsAt ? "SCHEDULED" : input.licenseEndsAt ? "READ_ONLY" : "ACTIVE"),
        term: {
          id: `license-${tenantId}`,
          tenantId,
          planCode: "PRO",
          startsAt: input.licenseStartsAt ?? "2020-01-01T00:00:00.000Z",
          endsAt: input.licenseEndsAt ?? "2099-01-01T00:00:00.000Z",
          activeStudentLimit: 100,
        },
      }),
    } as never,
  );
}

function createRequest(input: { authorization: string; rlsBypassReason?: string; method?: string; host?: string }) {
  return {
    header(name: string) {
      const normalized = name.toLowerCase();
      if (normalized === "authorization") return input.authorization;
      if (normalized === "x-rls-bypass-reason") return input.rlsBypassReason;
      if (normalized === "host") return input.host;
      return undefined;
    },
    method: input.method ?? "GET",
    socket: { remoteAddress: "203.0.113.10" },
    path: "/api/v1/students",
    url: "/api/v1/students",
  } as never;
}
