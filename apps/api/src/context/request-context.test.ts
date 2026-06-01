import { describe, expect, it } from "vitest";
import { getRequestContext, requireTenantContext, runWithRequestContext } from "./request-context.js";

describe("request context", () => {
  it("AsyncLocalStorage ile request context taşır", () => {
    const result = runWithRequestContext(
      { userId: "user-1", tenantId: "tenant-a", roles: ["TENANT_ADMIN"], bypassRls: false },
      () => getRequestContext().tenantId,
    );

    expect(result).toBe("tenant-a");
  });

  it("tenant context olmadan tenant erişimini reddeder", () => {
    expect(() =>
      runWithRequestContext(
        { userId: "user-1", tenantId: null, roles: ["TEACHER"], bypassRls: false },
        () => requireTenantContext(),
      ),
    ).toThrow("TENANT_CONTEXT_MISSING");
  });
});
