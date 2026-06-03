import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { isSystemAdmin } from "../rbac/roles.js";
import {
  type CreateTenantInput,
  type TenantRecord,
  type TenantStore,
  tenantStoreToken,
  type UpdateTenantInput,
} from "./tenant-store.js";

export interface TenantWriteBody {
  id?: string;
  name?: string;
  slug?: string;
  plan?: string;
  licenseStartsAt?: string;
  licenseEndsAt?: string;
  seatLimit?: number;
  status?: string;
}

@Injectable()
export class TenantService {
  constructor(
    @Inject(tenantStoreToken) private readonly tenants: TenantStore,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext): Promise<TenantRecord[]> {
    this.assertSystemAdmin(context);
    return this.tenants.list();
  }

  async findOne(context: RequestContext, id: string): Promise<TenantRecord> {
    this.assertSystemAdmin(context);
    const tenant = await this.tenants.findForAdmin(id);
    if (!tenant) {
      throw new NotFoundException("TENANT_NOT_FOUND");
    }
    return tenant;
  }

  async create(context: RequestContext, body: TenantWriteBody): Promise<TenantRecord> {
    this.assertSystemAdmin(context);
    const tenant = await this.tenants.create(parseCreateTenant(body));
    await this.auditLogs?.record({
      tenantId: tenant.id,
      actorUserId: context.userId,
      entityType: "Tenant",
      entityId: tenant.id,
      action: "tenant.created",
      diff: {
        name: tenant.name,
        slug: tenant.slug,
        plan: tenant.plan,
        licenseStartsAt: tenant.licenseStartsAt,
        licenseEndsAt: tenant.licenseEndsAt,
        seatLimit: tenant.seatLimit,
        status: tenant.status,
      },
    });
    return tenant;
  }

  async update(context: RequestContext, id: string, body: TenantWriteBody): Promise<TenantRecord> {
    this.assertSystemAdmin(context);
    const tenant = await this.tenants.update(id, parseUpdateTenant(body));
    if (!tenant) {
      throw new NotFoundException("TENANT_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: tenant.id,
      actorUserId: context.userId,
      entityType: "Tenant",
      entityId: tenant.id,
      action: "tenant.updated",
      diff: {
        plan: tenant.plan,
        licenseStartsAt: tenant.licenseStartsAt,
        licenseEndsAt: tenant.licenseEndsAt,
        seatLimit: tenant.seatLimit,
        status: tenant.status,
      },
    });
    return tenant;
  }

  private assertSystemAdmin(context: RequestContext): void {
    if (!context.bypassRls || !isSystemAdmin(context.roles)) {
      throw new BadRequestException("SYSTEM_ADMIN_CONTEXT_REQUIRED");
    }
  }
}

function parseCreateTenant(body: TenantWriteBody): CreateTenantInput {
  return {
    id: optionalText(body.id),
    name: requiredText(body.name, "TENANT_NAME_REQUIRED"),
    slug: requiredText(body.slug, "TENANT_SLUG_REQUIRED"),
    plan: optionalText(body.plan) ?? "TRIAL",
    licenseStartsAt: optionalDate(body.licenseStartsAt, "TENANT_LICENSE_START_INVALID"),
    licenseEndsAt: optionalDate(body.licenseEndsAt, "TENANT_LICENSE_END_INVALID"),
    seatLimit: optionalPositiveInt(body.seatLimit, "TENANT_SEAT_LIMIT_INVALID"),
    status: optionalText(body.status) ?? "ACTIVE",
  };
}

function parseUpdateTenant(body: TenantWriteBody): UpdateTenantInput {
  return {
    name: optionalText(body.name),
    slug: optionalText(body.slug),
    plan: optionalText(body.plan),
    licenseStartsAt: optionalDate(body.licenseStartsAt, "TENANT_LICENSE_START_INVALID"),
    licenseEndsAt: optionalDate(body.licenseEndsAt, "TENANT_LICENSE_END_INVALID"),
    seatLimit: optionalPositiveInt(body.seatLimit, "TENANT_SEAT_LIMIT_INVALID"),
    status: optionalText(body.status),
  };
}

function requiredText(value: string | undefined, errorCode: string): string {
  const text = optionalText(value);
  if (!text) {
    throw new BadRequestException(errorCode);
  }
  return text;
}

function optionalText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text || undefined;
}

function optionalDate(value: string | undefined, errorCode: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) {
    throw new BadRequestException(errorCode);
  }
  return new Date(timestamp).toISOString();
}

function optionalPositiveInt(value: number | undefined, errorCode: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(errorCode);
  }
  return value;
}
