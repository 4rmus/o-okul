import { ForbiddenException, Inject, Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthService } from "../auth/auth.service.js";
import { capabilitiesForRoles } from "../rbac/role-capabilities.js";
import { tenantStoreToken, type TenantStore } from "../tenant/tenant-store.js";
import { runWithRequestContext } from "./request-context.js";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService,
    @Inject(tenantStoreToken) private readonly tenants: TenantStore,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const authHeader = request.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      next();
      return;
    }

    const payload = this.auth.verifyAccessToken(authHeader.slice("Bearer ".length));
    const tenantId = payload.tenantId === "system" ? null : payload.tenantId;
    if (tenantId && !(await this.tenants.findById(tenantId))) {
      throw new ForbiddenException("TENANT_INACTIVE_OR_EXPIRED");
    }

    runWithRequestContext(
      {
        userId: payload.sub,
        tenantId,
        roles: payload.roles,
        capabilities: capabilitiesForRoles(payload.roles),
        bypassRls: payload.roles.includes("SYSTEM_ADMIN"),
        subjectType: payload.subjectType,
        subjectId: payload.subjectId,
      },
      () => next(),
    );
  }
}
