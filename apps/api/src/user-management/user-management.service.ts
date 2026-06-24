import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { authSessionStoreToken, type SessionStore } from "../auth/session-store.js";
import { isTenantAssignableRoleName, type TenantAssignableRoleName } from "@o-okul/shared-types";
import {
  assertTenantSeatCapacity,
  isTenantSeatLimitExceededError,
  tenantSeatLimitExceededCode,
} from "../tenant/tenant-seat-limit.js";
import { type TenantStore, tenantStoreToken } from "../tenant/tenant-store.js";
import {
  type CreateTenantUserInput,
  type TenantUserRecord,
  type UserManagementStore,
  userManagementStoreToken,
} from "./user-management-store.js";

export interface CreateTenantUserBody {
  email?: string;
  name?: string;
  password?: string;
  roles?: string[];
}

export interface SetTenantUserRolesBody {
  roles?: string[];
}

@Injectable()
export class UserManagementService {
  constructor(
    @Inject(userManagementStoreToken) private readonly store: UserManagementStore,
    @Inject(authSessionStoreToken) private readonly sessions: SessionStore,
    @Inject(tenantStoreToken) private readonly tenants: TenantStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext): Promise<TenantUserRecord[]> {
    const tenantId = this.requireTenantId(context);
    return this.store.listTenantUsers(tenantId);
  }

  async create(context: RequestContext, body: CreateTenantUserBody): Promise<TenantUserRecord> {
    const tenantId = this.requireTenantId(context);
    const input = this.parseCreateInput(tenantId, body);
    const existingUsers = await this.store.listTenantUsers(tenantId);
    if (!existingUsers.some((user) => user.email.toLowerCase() === input.email)) {
      await this.assertTenantSeatAvailable(tenantId);
    }

    let record: TenantUserRecord;
    try {
      record = await this.store.createOrAttachTenantUser(input);
    } catch (error) {
      throwTenantSeatLimitBadRequest(error);
    }
    await this.sessions.revokeByUser(record.id);
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "User",
      entityId: record.id,
      action: "user.membership_created",
      diff: { emailProvided: true, roles: record.roles },
    });
    return record;
  }

  async setRoles(context: RequestContext, userId: string, body: SetTenantUserRolesBody): Promise<TenantUserRecord> {
    const tenantId = this.requireTenantId(context);
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

  private requireTenantId(context: RequestContext): string {
    if (!context.tenantId || context.bypassRls) {
      throw new BadRequestException("TENANT_CONTEXT_REQUIRED");
    }
    return context.tenantId;
  }

  private async assertTenantSeatAvailable(tenantId: string): Promise<void> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw new NotFoundException("TENANT_NOT_FOUND");
    }
    try {
      assertTenantSeatCapacity(tenant);
    } catch (error) {
      throwTenantSeatLimitBadRequest(error);
    }
  }

  private parseCreateInput(tenantId: string, body: CreateTenantUserBody): CreateTenantUserInput {
    const email = body.email?.trim().toLowerCase();
    const name = body.name?.trim();
    const password = body.password;
    if (!email || !email.includes("@")) {
      throw new BadRequestException("EMAIL_REQUIRED");
    }
    if (!name) {
      throw new BadRequestException("NAME_REQUIRED");
    }
    if (!password || password.length < 8) {
      throw new BadRequestException("PASSWORD_MIN_8_REQUIRED");
    }
    return {
      tenantId,
      email,
      name,
      password,
      roles: parseTenantRoles(body.roles),
    };
  }
}

function throwTenantSeatLimitBadRequest(error: unknown): never {
  if (isTenantSeatLimitExceededError(error)) {
    throw new BadRequestException(tenantSeatLimitExceededCode);
  }
  throw error;
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
    parsedRoles.push(role);
  }
  return parsedRoles;
}
