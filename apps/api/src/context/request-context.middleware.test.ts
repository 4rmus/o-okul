import { describe, expect, it, vi } from "vitest";
import { getRequestContext } from "./request-context.js";
import { RequestContextMiddleware } from "./request-context.middleware.js";

describe("RequestContextMiddleware", () => {
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
});

function createMiddleware(input: {
  roles: string[];
  tenantId?: string;
  licenseEndsAt?: string;
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
}) {
  return new RequestContextMiddleware(
    {
      verifyActiveAccessToken: () => ({
        sub: input.tenantId ? "user-tenant" : "user-system",
        tenantId: input.tenantId ?? "system",
        roles: input.roles,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
      }),
    } as never,
    { verifyPreviewToken: vi.fn() } as never,
    {
      findForAdmin: async (tenantId: string) => ({ id: tenantId, status: "ACTIVE", licenseEndsAt: input.licenseEndsAt }),
    } as never,
  );
}

function createRequest(input: { authorization: string; rlsBypassReason?: string; method?: string }) {
  return {
    header(name: string) {
      const normalized = name.toLowerCase();
      if (normalized === "authorization") return input.authorization;
      if (normalized === "x-rls-bypass-reason") return input.rlsBypassReason;
      return undefined;
    },
    method: input.method ?? "GET",
    path: "/api/v1/students",
    url: "/api/v1/students",
  } as never;
}
