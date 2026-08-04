import { ForbiddenException, HttpException, Inject, Injectable, NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { AuthService } from "../auth/auth.service.js";
import { missingBoundSubjectRole } from "../auth/subject-binding.js";
import { licenseTermStoreToken, type LicenseTermStore } from "../license/license-term-store.js";
import { setApiLogContext } from "../observability/log-context.js";
import { capabilitiesForRoles } from "../rbac/role-capabilities.js";
import { isSystemAdmin } from "../rbac/roles.js";
import { RolePreviewService } from "../role-preview/role-preview.service.js";
import { tenantStoreToken, type TenantStore } from "../tenant/tenant-store.js";
import { assertSessionTenantMatchesHost, TenantHostError } from "../http/tenant-host.js";
import { runWithRequestContext } from "./request-context.js";

@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly auth: AuthService,
    private readonly rolePreviews: RolePreviewService,
    @Inject(tenantStoreToken) private readonly tenants: TenantStore,
    @Inject(licenseTermStoreToken) private readonly licenseTerms: LicenseTermStore,
  ) {}

  async use(request: Request, _response: Response, next: NextFunction): Promise<void> {
    const authHeader = request.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      next();
      return;
    }

    const payload = await this.auth.verifyActiveAccessToken(authHeader.slice("Bearer ".length));
    if (payload.mustChangePassword && !isPasswordChangeAllowed(request)) {
      throw new HttpException("PASSWORD_CHANGE_REQUIRED", 423);
    }
    if (missingBoundSubjectRole(payload)) {
      throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
    }
    const tenantId = payload.tenantId === "system" ? null : payload.tenantId;
    const tenant = tenantId ? await this.requireActiveTenant(tenantId) : undefined;
    try {
      assertSessionTenantMatchesHost(request, { tenantId: payload.tenantId, tenantSlug: tenant?.slug });
    } catch (error) {
      if (error instanceof TenantHostError) throw new HttpException(error.message, error.status);
      throw error;
    }
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
          sessionId: payload.sessionId,
          tenantId,
          membershipId: payload.membershipId,
          activePersona: payload.activePersona,
          membershipVersion: payload.membershipVersion,
          tenantAccessMode,
          campusScope: payload.campusScope,
          roles: [preview.targetRole],
          capabilities: capabilitiesForRoles([preview.targetRole]),
          bypassRls: false,
          mustChangePassword: payload.mustChangePassword,
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
    runWithRequestContext(
      {
        userId: payload.sub,
        sessionId: payload.sessionId,
        tenantId,
        membershipId: payload.membershipId,
        activePersona: payload.activePersona,
        membershipVersion: payload.membershipVersion,
        tenantAccessMode,
        campusScope: payload.campusScope,
        roles: payload.roles,
        capabilities: capabilitiesForRoles(payload.roles),
        bypassRls: false,
        mustChangePassword: payload.mustChangePassword,
        subjectType: payload.subjectType,
        subjectId: payload.subjectId,
      },
      () => next(),
    );
  }

  private async requireActiveTenant(tenantId: string) {
    const tenant = await this.tenants.findForAdmin(tenantId);
    if (!tenant || tenant.status !== "ACTIVE") {
      throw new ForbiddenException("TENANT_INACTIVE_OR_EXPIRED");
    }
    return tenant;
  }

  private async resolveTenantAccessMode(tenantId: string, method: string): Promise<"active" | "read_only"> {
    const license = await this.licenseTerms.resolveForTenant(tenantId);
    if (!license) throw new ForbiddenException("TENANT_LICENSE_TERM_MISSING");
    if (!license.mirrorParity) throw new ForbiddenException("TENANT_LICENSE_MIRROR_PARITY_MISMATCH");
    if (license.state === "ACTIVE") return "active";
    if (license.state === "SCHEDULED") throw new ForbiddenException("TENANT_LICENSE_NOT_STARTED");
    if (license.state === "READ_ONLY") {
      if (!isReadOnlyMethod(method)) throw new ForbiddenException("TENANT_LICENSE_EXPIRED_READ_ONLY");
      return "read_only";
    }
    if (license.state === "FROZEN") throw new ForbiddenException("TENANT_LICENSE_FROZEN");
    if (license.state === "CANCELLED") throw new ForbiddenException("TENANT_LICENSE_CANCELLED");
    throw new ForbiddenException("TENANT_LICENSE_EXPIRED");
  }
}

function isPasswordChangeAllowed(request: Request): boolean {
  const method = request.method.toUpperCase();
  const paths = [request.originalUrl, `${request.baseUrl ?? ""}${request.path ?? ""}`, request.path].filter(Boolean);
  if (method === "POST" && paths.some((path) => path.split("?")[0]?.endsWith("/me/password"))) return true;
  if (method === "POST" && paths.some((path) => path.split("?")[0]?.endsWith("/auth/logout"))) return true;
  return false;
}

function isReadOnlyMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return normalized === "GET" || normalized === "HEAD" || normalized === "OPTIONS";
}
