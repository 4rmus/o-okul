import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { authSessionStoreToken, type SessionStore } from "../auth/session-store.js";
import { verifyAdminMfaStepUpProof } from "../auth/totp-mfa.js";
import { withCursorListMeta } from "../listing/list-query.js";
import { requireTenantWideStaffContext } from "../tenant/tenant-access.js";
import {
  hasCapabilityForRoles,
  isTenantAssignableRoleName,
  type EmployeeAccessRecord,
  type EmployeeAccessListQuery,
  type EmployeeCreateRequest,
  type TenantAssignableRoleName,
  type TenantMembershipUpdateRequest,
  type TenantMembershipUpdateResult,
} from "@o-okul/shared-types";
import {
  type TenantUserRecord,
  type UserManagementStore,
  userManagementStoreToken,
} from "./user-management-store.js";

export interface SetTenantUserRolesBody {
  roles?: string[];
}

@Injectable()
export class UserManagementService {
  constructor(
    @Inject(userManagementStoreToken) private readonly store: UserManagementStore,
    @Inject(authSessionStoreToken) private readonly sessions: SessionStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext): Promise<TenantUserRecord[]> {
    const tenantId = this.requireTenantWideContext(context);
    return this.store.listTenantUsers(tenantId);
  }

  async listEmployees(context: RequestContext, query: EmployeeAccessListQuery): Promise<EmployeeAccessRecord[]> {
    try {
      const page = await this.store.listEmployeeAccessPage(this.requireTenantWideContext(context), query);
      return withCursorListMeta(page.records, page.meta);
    } catch (error) {
      if (error instanceof Error && error.message === "EMPLOYEE_CURSOR_INVALID") {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async createEmployee(context: RequestContext, input: EmployeeCreateRequest): Promise<EmployeeAccessRecord> {
    const tenantId = this.requireTenantWideContext(context);
    try {
      const employee = await this.store.createEmployee(tenantId, input);
      await this.auditLogs?.record({
        tenantId,
        actorUserId: context.userId,
        entityType: "Employee",
        entityId: employee.id,
        action: "employee.created",
        diff: { status: employee.status, employeeNoProvided: Boolean(employee.employeeNo), workEmailProvided: Boolean(employee.workEmail) },
      });
      return employee;
    } catch (error) {
      if (error instanceof Error && error.message === "EMPLOYEE_NO_CONFLICT") throw new ConflictException(error.message);
      if (isUniqueViolation(error)) throw new ConflictException("EMPLOYEE_UNIQUE_CONFLICT");
      throw error;
    }
  }

  async setRoles(context: RequestContext, userId: string, body: SetTenantUserRolesBody): Promise<TenantUserRecord> {
    const tenantId = this.requireTenantWideContext(context);
    const nextRoles = parseTenantRoles(body.roles);
    if (context.userId === userId && !nextRoles.includes("TENANT_ADMIN")) {
      throw new BadRequestException("SELF_TENANT_ADMIN_ROLE_REQUIRED");
    }

    const record = await this.store.setTenantRoles(tenantId, userId, nextRoles);
    if (!record) {
      throw new NotFoundException("USER_MEMBERSHIP_NOT_FOUND");
    }
    await this.sessions.revokeByUser(userId);
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "User",
      entityId: userId,
      action: "user.roles_updated",
      diff: { roles: record.roles },
    });
    return record;
  }

  async updateMembership(
    context: RequestContext,
    membershipId: string,
    input: TenantMembershipUpdateRequest,
    stepUpToken?: string,
  ): Promise<TenantMembershipUpdateResult> {
    const tenantId = this.requireTenantWideContext(context);
    const stepUpVerified = this.verifyOwnerAdminStepUp(context, stepUpToken);
    let result: TenantMembershipUpdateResult | undefined;
    try {
      result = await this.store.updateTenantMembership(tenantId, membershipId, {
        ...input,
        actorCanManageOwners: hasCapabilityForRoles(context.roles, "owner:manage", context.capabilities),
        stepUpVerified,
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "TENANT_OWNER_MANAGE_REQUIRED" || code === "STEP_UP_MFA_REQUIRED") throw new ForbiddenException(code);
      if (code === "TENANT_MEMBERSHIP_CAMPUS_NOT_FOUND") throw new BadRequestException(code);
      if (
        code === "TENANT_MEMBERSHIP_VERSION_CONFLICT" ||
        code === "TENANT_MEMBERSHIP_ENDED" ||
        code === "EMPLOYEE_PROFILE_NOT_ACTIVE" ||
        code === "LAST_ACTIVE_TENANT_OWNER_REQUIRED"
      ) {
        throw new ConflictException(code);
      }
      throw error;
    }
    if (!result) throw new NotFoundException("TENANT_MEMBERSHIP_NOT_FOUND");
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "TenantMembership",
      entityId: result.employee.access?.membershipId ?? membershipId,
      action: "tenant_membership.updated",
      diff: {
        staffRole: result.employee.access?.staffRole ?? null,
        hasTeacherPersona: result.employee.access?.hasTeacherPersona ?? false,
        status: result.employee.access?.status,
        scopeMode: result.employee.access?.scopeMode,
        campusCount: result.employee.access?.campusIds.length ?? 0,
        version: result.employee.access?.version,
        sessionsRevoked: result.sessionsRevoked,
      },
    });
    return result;
  }

  private requireTenantId(context: RequestContext): string {
    if (!context.tenantId || context.bypassRls) {
      throw new BadRequestException("TENANT_CONTEXT_REQUIRED");
    }
    return context.tenantId;
  }

  private requireTenantWideContext(context: RequestContext): string {
    this.requireTenantId(context);
    try {
      return requireTenantWideStaffContext(context, "EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
    } catch (error) {
      throw new ForbiddenException(error instanceof Error ? error.message : "EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
    }
  }

  private verifyOwnerAdminStepUp(context: RequestContext, stepUpToken?: string): boolean {
    if (!stepUpToken) return false;
    if (!context.sessionId || context.membershipVersion === undefined) {
      throw new ForbiddenException("STEP_UP_MFA_INVALID");
    }
    try {
      verifyAdminMfaStepUpProof(stepUpToken, {
        userId: context.userId,
        sessionId: context.sessionId,
        membershipVersion: context.membershipVersion,
        purpose: "OWNER_ADMIN_CHANGE",
      });
      return true;
    } catch {
      throw new ForbiddenException("STEP_UP_MFA_INVALID");
    }
  }

}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function parseTenantRoles(input: string[] | undefined): TenantAssignableRoleName[] {
  if (!input || input.length === 0) {
    throw new BadRequestException("ROLES_REQUIRED");
  }
  const normalized = [...new Set(input)];
  const parsedRoles: TenantAssignableRoleName[] = [];
  for (const role of normalized) {
    if (role === "SYSTEM_ADMIN") {
      throw new BadRequestException("SYSTEM_ADMIN_ROLE_FORBIDDEN");
    }
    if (!isTenantAssignableRoleName(role)) {
      throw new BadRequestException("ROLE_INVALID");
    }
    if (role === "TEACHER" || role === "STUDENT" || role === "GUARDIAN") {
      throw new BadRequestException("TENANT_USER_SUBJECT_ROLE_FORBIDDEN");
    }
    parsedRoles.push(role);
  }
  return parsedRoles;
}
