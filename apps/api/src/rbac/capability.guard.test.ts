import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { runWithRequestContext } from "../context/request-context.js";
import { CapabilityGuard } from "./capability.guard.js";
import { capabilitiesForRoles } from "./role-capabilities.js";

describe("CapabilityGuard", () => {
  it("gerekli capability varsa geçiş verir", () => {
    const guard = createGuard(["finance:manage"]);

    const allowed = runWithRequestContext(
      createContext("TENANT_ADMIN"),
      () => guard.canActivate(createExecutionContext()),
    );

    expect(allowed).toBe(true);
  });

  it("ASSISTANT_ADMIN finans capability'si yoksa 403 döner", () => {
    const guard = createGuard(["finance:manage"]);

    expect(() =>
      runWithRequestContext(
        createContext("ASSISTANT_ADMIN"),
        () => guard.canActivate(createExecutionContext()),
      ),
    ).toThrow(ForbiddenException);
  });

  it("ASSISTANT_ADMIN akademik capability ile geçer", () => {
    const guard = createGuard(["academic:manage"]);

    const allowed = runWithRequestContext(
      createContext("ASSISTANT_ADMIN"),
      () => guard.canActivate(createExecutionContext()),
    );

    expect(allowed).toBe(true);
  });
});

function createGuard(capabilities: string[]): CapabilityGuard {
  return new CapabilityGuard({
    getAllAndOverride: () => capabilities,
  } as never);
}

function createExecutionContext() {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
  } as never;
}

function createContext(role: string) {
  return {
    userId: `user-${role.toLowerCase()}`,
    tenantId: "tenant-a",
    roles: [role],
    capabilities: capabilitiesForRoles([role]),
    bypassRls: false,
  };
}
