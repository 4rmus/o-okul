import "reflect-metadata";
import { ForbiddenException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { runWithRequestContext, type RequestContext } from "./request-context.js";
import { AllowBreakGlassRlsBypass } from "./rls-bypass.decorator.js";
import { RlsBypassGuard } from "./rls-bypass.guard.js";

class TestController {
  blocked() {
    return undefined;
  }

  @AllowBreakGlassRlsBypass()
  allowed() {
    return undefined;
  }
}

describe("RlsBypassGuard", () => {
  it("keeps normal requests non-bypass", async () => {
    const auditLogs = { record: vi.fn() };
    const guard = new RlsBypassGuard(new Reflector(), auditLogs as never);
    const context = systemContext();

    await runWithRequestContext(context, () => guard.canActivate(executionContext("blocked", createRequest({}))));

    expect(context.bypassRls).toBe(false);
    expect(context.rlsBypassReason).toBeUndefined();
    expect(auditLogs.record).not.toHaveBeenCalled();
  });

  it("rejects bypass header on routes without break-glass metadata", async () => {
    const guard = new RlsBypassGuard(new Reflector(), { record: vi.fn() } as never);
    const context = systemContext();

    await expect(
      runWithRequestContext(context, () =>
        guard.canActivate(executionContext("blocked", createRequest({ rlsBypassReason: "support investigation" }))),
      ),
    ).rejects.toThrow("RLS_BYPASS_ROUTE_NOT_ALLOWED");
    expect(context.bypassRls).toBe(false);
  });

  it("enables audited bypass only on break-glass routes for SYSTEM_ADMIN", async () => {
    const auditLogs = { record: vi.fn() };
    const guard = new RlsBypassGuard(new Reflector(), auditLogs as never);
    const context = systemContext();

    await runWithRequestContext(context, () =>
      guard.canActivate(executionContext("allowed", createRequest({ rlsBypassReason: "support investigation" }))),
    );

    expect(context.bypassRls).toBe(true);
    expect(context.rlsBypassReason).toBe("support investigation");
    expect(auditLogs.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-system",
        entityType: "RequestContext",
        action: "system.rls_bypass_requested",
        diff: expect.objectContaining({
          method: "GET",
          path: "/api/v1/students",
          reason: "support investigation",
        }),
      }),
    );
  });

  it("rejects bypass metadata for non-system roles", async () => {
    const guard = new RlsBypassGuard(new Reflector(), { record: vi.fn() } as never);
    const context = tenantContext();

    await expect(
      runWithRequestContext(context, () =>
        guard.canActivate(executionContext("allowed", createRequest({ rlsBypassReason: "not allowed" }))),
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(context.bypassRls).toBe(false);
  });

  it("rejects tenant-scoped system roles", async () => {
    const guard = new RlsBypassGuard(new Reflector(), { record: vi.fn() } as never);
    const context = {
      userId: "user-system-tenant",
      tenantId: "tenant-a",
      roles: ["SYSTEM_ADMIN"],
      bypassRls: false,
    };

    await expect(
      runWithRequestContext(context, () =>
        guard.canActivate(executionContext("allowed", createRequest({ rlsBypassReason: "tenant scoped" }))),
      ),
    ).rejects.toThrow("RLS_BYPASS_SYSTEM_SCOPE_REQUIRED");
    expect(context.bypassRls).toBe(false);
  });
});

function systemContext(): RequestContext {
  return {
    userId: "user-system",
    tenantId: null,
    roles: ["SYSTEM_ADMIN"],
    bypassRls: false,
  };
}

function tenantContext(): RequestContext {
  return {
    userId: "user-tenant",
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    bypassRls: false,
  };
}

function executionContext(methodName: "allowed" | "blocked", request: unknown): ExecutionContext {
  const controller = new TestController();
  return {
    getClass: () => TestController,
    getHandler: () => controller[methodName],
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function createRequest(input: { rlsBypassReason?: string }) {
  return {
    header(name: string) {
      return name.toLowerCase() === "x-rls-bypass-reason" ? input.rlsBypassReason : undefined;
    },
    method: "GET",
    path: "/api/v1/students",
    url: "/api/v1/students",
  };
}
