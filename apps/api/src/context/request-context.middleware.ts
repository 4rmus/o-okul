import { ForbiddenException, Inject, Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthService } from "../auth/auth.service.js";
import { capabilitiesForRoles } from "../rbac/role-capabilities.js";
import { RolePreviewService } from "../role-preview/role-preview.service.js";
import { tenantStoreToken, type TenantStore } from "../tenant/tenant-store.js";
import { runWithRequestContext } from "./request-context.js";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService,
    private readonly rolePreviews: RolePreviewService,
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

    const previewToken = request.header("x-role-preview-token");
    if (previewToken) {
      const preview = this.rolePreviews.verifyPreviewToken(previewToken);
      if (!tenantId || preview.tenantId !== tenantId || preview.actorUserId !== payload.sub) {
        throw new ForbiddenException("ROLE_PREVIEW_CONTEXT_MISMATCH");
      }
      if (!isReadOnlyMethod(request.method)) {
        throw new ForbiddenException("ROLE_PREVIEW_READ_ONLY");
      }

      runWithRequestContext(
        {
          userId: payload.sub,
          tenantId,
          roles: [preview.targetRole],
          capabilities: capabilitiesForRoles([preview.targetRole]),
          bypassRls: false,
          subjectType: preview.targetSubjectType,
          subjectId: preview.targetSubjectId,
          rolePreview: {
            id: preview.id,
            actorUserId: preview.actorUserId,
            mode: preview.mode,
            expiresAt: preview.expiresAt,
          },
        },
        () => next(),
      );
      return;
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

function isReadOnlyMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}
