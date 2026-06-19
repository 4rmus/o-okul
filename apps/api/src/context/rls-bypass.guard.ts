import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { isSystemAdmin } from "../rbac/roles.js";
import { getRequestContext } from "./request-context.js";
import { allowBreakGlassRlsBypassKey } from "./rls-bypass.decorator.js";

@Injectable()
export class RlsBypassGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogs: AuditLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const reason = request.header("x-rls-bypass-reason")?.trim();
    if (!reason) return true;

    let requestContext;
    try {
      requestContext = getRequestContext();
    } catch {
      throw new UnauthorizedException("REQUEST_CONTEXT_MISSING");
    }

    if (!isSystemAdmin(requestContext.roles)) {
      throw new ForbiddenException("RLS_BYPASS_SYSTEM_ADMIN_REQUIRED");
    }
    if (requestContext.tenantId !== null) {
      throw new ForbiddenException("RLS_BYPASS_SYSTEM_SCOPE_REQUIRED");
    }

    const routeAllowsBypass =
      this.reflector.getAllAndOverride<boolean>(allowBreakGlassRlsBypassKey, [context.getHandler(), context.getClass()]) === true;
    if (!routeAllowsBypass) {
      throw new ForbiddenException("RLS_BYPASS_ROUTE_NOT_ALLOWED");
    }

    requestContext.bypassRls = true;
    requestContext.rlsBypassReason = reason;
    await this.auditLogs.record({
      actorUserId: requestContext.userId,
      entityType: "RequestContext",
      entityId: request.path || request.url,
      action: "system.rls_bypass_requested",
      diff: {
        method: request.method,
        path: request.path || request.url,
        reason,
      },
    });

    return true;
  }
}
