import { ForbiddenException, Inject, Injectable, NestMiddleware, Optional } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { AuthService } from "../auth/auth.service.js";
import { setApiLogContext } from "../observability/log-context.js";
import { capabilitiesForRoles } from "../rbac/role-capabilities.js";
import { isSystemAdmin } from "../rbac/roles.js";
import { RolePreviewService } from "../role-preview/role-preview.service.js";
import { tenantStoreToken, type TenantRecord, type TenantStore } from "../tenant/tenant-store.js";
import { runWithRequestContext } from "./request-context.js";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService,
    private readonly rolePreviews: RolePreviewService,
    @Inject(tenantStoreToken) private readonly tenants: TenantStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const authHeader = request.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      next();
      return;
    }

    const payload = await this.auth.verifyActiveAccessToken(authHeader.slice("Bearer ".length));
    const tenantId = payload.tenantId === "system" ? null : payload.tenantId;
    const tenantAccessMode = tenantId ? await this.resolveTenantAccessMode(tenantId, request.method) : "active";

    const previewToken = request.header("x-role-preview-token");
    if (previewToken) {
      const preview = this.rolePreviews.verifyPreviewToken(previewToken);
      if (!tenantId || preview.tenantId !== tenantId || preview.actorUserId !== payload.sub) {
        throw new ForbiddenException("ROLE_PREVIEW_CONTEXT_MISMATCH");
      }
      if (!isReadOnlyMethod(request.method)) {
        throw new ForbiddenException("ROLE_PREVIEW_READ_ONLY");
      }

      setApiLogContext({ tenantId, userId: payload.sub });
      runWithRequestContext(
        {
          userId: payload.sub,
          tenantId,
          tenantAccessMode,
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

    setApiLogContext({ tenantId, userId: payload.sub });
    const rlsBypass = resolveRlsBypass(request, payload.roles);
    if (rlsBypass.enabled) {
      await this.auditLogs?.record({
        actorUserId: payload.sub,
        entityType: "RequestContext",
        entityId: request.path || request.url,
        action: "system.rls_bypass_requested",
        diff: {
          method: request.method,
          path: request.path || request.url,
          reason: rlsBypass.reason,
        },
      });
    }

    runWithRequestContext(
      {
        userId: payload.sub,
        tenantId,
        tenantAccessMode,
        roles: payload.roles,
        capabilities: capabilitiesForRoles(payload.roles),
        bypassRls: rlsBypass.enabled,
        rlsBypassReason: rlsBypass.reason,
        subjectType: payload.subjectType,
        subjectId: payload.subjectId,
      },
      () => next(),
    );
  }

  private async resolveTenantAccessMode(tenantId: string, method: string): Promise<"active" | "read_only"> {
    const tenant = await this.tenants.findForAdmin(tenantId);
    if (!tenant || tenant.status !== "ACTIVE") {
      throw new ForbiddenException("TENANT_INACTIVE_OR_EXPIRED");
    }

    if (!isTenantLicenseExpired(tenant)) {
      return "active";
    }

    if (!isReadOnlyMethod(method)) {
      throw new ForbiddenException("TENANT_LICENSE_EXPIRED_READ_ONLY");
    }

    return "read_only";
  }
}

function isReadOnlyMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS";
}

function isTenantLicenseExpired(tenant: Pick<TenantRecord, "licenseEndsAt">): boolean {
  if (!tenant.licenseEndsAt) return false;
  const licenseEndsAt = Date.parse(tenant.licenseEndsAt);
  return !Number.isFinite(licenseEndsAt) || licenseEndsAt < Date.now();
}

function resolveRlsBypass(request: Request, roles: string[]): { enabled: boolean; reason?: string } {
  const reason = request.header("x-rls-bypass-reason")?.trim();
  if (!reason) return { enabled: false };

  if (!isSystemAdmin(roles)) {
    throw new ForbiddenException("RLS_BYPASS_SYSTEM_ADMIN_REQUIRED");
  }

  return { enabled: true, reason };
}
