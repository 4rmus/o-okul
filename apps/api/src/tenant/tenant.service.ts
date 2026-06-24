import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { TenantCreateResponse } from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { createResetToken, hashResetToken } from "../auth/auth.service.js";
import { type PasswordResetStore, passwordResetStoreToken } from "../auth/password-reset-store.js";
import type { RequestContext } from "../context/request-context.js";
import { isSystemAdmin } from "../rbac/roles.js";
import {
  type TenantUserRecord,
  type UserManagementStore,
  userManagementStoreToken,
} from "../user-management/user-management-store.js";
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
  institutionType?: string;
  contactEmail?: string;
  logoUrl?: string;
  seatLimit?: number;
  status?: string;
  firstAdmin?: TenantFirstAdminBody;
}

export interface TenantFirstAdminBody {
  mode?: string;
  name?: string;
  email?: string;
  password?: string;
}

export type { TenantCreateResponse };

@Injectable()
export class TenantService {
  constructor(
    @Inject(tenantStoreToken) private readonly tenants: TenantStore,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() @Inject(userManagementStoreToken) private readonly users?: UserManagementStore,
    @Optional() @Inject(passwordResetStoreToken) private readonly passwordResets?: PasswordResetStore,
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

  async findCurrent(context: RequestContext): Promise<TenantRecord> {
    const tenantId = requireTenantId(context);
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) {
      throw new NotFoundException("TENANT_NOT_FOUND");
    }
    return tenant;
  }

  async create(context: RequestContext, body: TenantWriteBody): Promise<TenantCreateResponse> {
    this.assertSystemAdmin(context);
    const tenantInput = parseCreateTenant(body);
    const firstAdmin = parseFirstAdmin(body.firstAdmin);
    const users = this.users;
    if (firstAdmin && this.tenants.createWithFirstAdmin) {
      const result = await createTenantOrThrow(() => this.tenants.createWithFirstAdmin!(tenantInput, firstAdmin));
      await this.recordTenantCreated(context, result.tenant);
      await this.recordFirstAdminCreated(context, result.tenant.id, result.admin);
      const activation = await this.issueFirstAdminActivationToken(result.admin, firstAdmin.mode);
      return {
        tenant: result.tenant,
        admin: {
          ...result.admin,
          ...(activation ? { activationTokenIssued: true, activationTokenExpiresAt: activation.expiresAt } : {}),
        },
      };
    }
    if (firstAdmin?.mode === "invitation") {
      throw new BadRequestException("TENANT_FIRST_ADMIN_INVITATION_REQUIRES_ATOMIC_STORE");
    }
    if (firstAdmin && !users) {
      throw new BadRequestException("TENANT_USER_STORE_REQUIRED");
    }
    const tenant = await createTenantOrThrow(() => this.tenants.create(tenantInput));
    await this.recordTenantCreated(context, tenant);
    if (!firstAdmin) return tenant;
    if (!users) {
      throw new BadRequestException("TENANT_USER_STORE_REQUIRED");
    }
    const admin = await users.createOrAttachTenantUser({
      tenantId: tenant.id,
      email: firstAdmin.email,
      name: firstAdmin.name,
      password: firstAdmin.password ?? "",
      roles: ["TENANT_ADMIN"],
    });
    await this.recordFirstAdminCreated(context, tenant.id, admin);
    return { tenant, admin };
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

  async updateCurrent(context: RequestContext, body: TenantWriteBody): Promise<TenantRecord> {
    const tenantId = requireTenantId(context);
    const tenant = await this.tenants.update(tenantId, parseCurrentTenantProfileUpdate(body));
    if (!tenant) {
      throw new NotFoundException("TENANT_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: tenant.id,
      actorUserId: context.userId,
      entityType: "Tenant",
      entityId: tenant.id,
      action: "tenant.profile_updated",
      diff: {
        name: tenant.name,
        institutionType: tenant.institutionType,
        contactEmail: tenant.contactEmail,
        logoUrl: tenant.logoUrl,
      },
    });
    return tenant;
  }

  async delete(context: RequestContext, id: string): Promise<TenantRecord> {
    this.assertSystemAdmin(context);
    const tenant = await this.tenants.delete(id);
    if (!tenant) {
      throw new NotFoundException("TENANT_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId: tenant.id,
      actorUserId: context.userId,
      entityType: "Tenant",
      entityId: tenant.id,
      action: "tenant.deleted",
      diff: { status: tenant.status },
    });
    return tenant;
  }

  private assertSystemAdmin(context: RequestContext): void {
    if (!isSystemAdmin(context.roles)) {
      throw new BadRequestException("SYSTEM_ADMIN_CONTEXT_REQUIRED");
    }
  }

  private async recordTenantCreated(context: RequestContext, tenant: TenantRecord): Promise<void> {
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
  }

  private async recordFirstAdminCreated(context: RequestContext, tenantId: string, admin: TenantUserRecord): Promise<void> {
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "User",
      entityId: admin.id,
      action: "tenant.first_admin_created",
      diff: { emailProvided: true, roles: admin.roles },
    });
  }

  private async issueFirstAdminActivationToken(
    admin: TenantUserRecord,
    mode: "password" | "invitation",
  ): Promise<{ expiresAt: string } | undefined> {
    if (mode !== "invitation") return undefined;
    if (!this.passwordResets) {
      throw new BadRequestException("TENANT_FIRST_ADMIN_INVITATION_TOKEN_STORE_REQUIRED");
    }

    await this.passwordResets.revokePendingForUser(admin.id);
    const activationToken = createResetToken();
    const expiresAt = nextActivationExpiry();
    await this.passwordResets.create({
      userId: admin.id,
      tokenHash: hashResetToken(activationToken),
      expiresAt,
    });
    return { expiresAt };
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
    institutionType: optionalText(body.institutionType),
    contactEmail: optionalEmail(body.contactEmail, "TENANT_CONTACT_EMAIL_INVALID"),
    logoUrl: optionalUrl(body.logoUrl, "TENANT_LOGO_URL_INVALID"),
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
    institutionType: optionalText(body.institutionType),
    contactEmail: optionalEmail(body.contactEmail, "TENANT_CONTACT_EMAIL_INVALID"),
    logoUrl: optionalUrl(body.logoUrl, "TENANT_LOGO_URL_INVALID"),
    seatLimit: optionalPositiveInt(body.seatLimit, "TENANT_SEAT_LIMIT_INVALID"),
    status: optionalText(body.status),
  };
}

function parseCurrentTenantProfileUpdate(body: TenantWriteBody): UpdateTenantInput {
  return {
    name: optionalText(body.name),
    institutionType: optionalText(body.institutionType),
    contactEmail: optionalEmail(body.contactEmail, "TENANT_CONTACT_EMAIL_INVALID"),
    logoUrl: optionalUrl(body.logoUrl, "TENANT_LOGO_URL_INVALID"),
  };
}

function parseFirstAdmin(body: TenantFirstAdminBody | undefined):
  | {
      name: string;
      email: string;
      mode: "password" | "invitation";
      password?: string;
    }
  | undefined {
  if (!body) return undefined;
  const mode = body.mode === "invitation" ? "invitation" : "password";
  const password = body.password;
  if (mode === "password" && (!password || password.length < 8)) {
    throw new BadRequestException("TENANT_FIRST_ADMIN_PASSWORD_MIN_8_REQUIRED");
  }
  return {
    name: requiredText(body.name, "TENANT_FIRST_ADMIN_NAME_REQUIRED"),
    email: requiredEmail(body.email, "TENANT_FIRST_ADMIN_EMAIL_REQUIRED"),
    mode,
    ...(mode === "password" ? { password } : {}),
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

function requiredEmail(value: string | undefined, errorCode: string): string {
  const email = requiredText(value, errorCode).toLowerCase();
  if (!email.includes("@")) {
    throw new BadRequestException(errorCode);
  }
  return email;
}

function optionalEmail(value: string | undefined, errorCode: string): string | undefined {
  const email = optionalText(value);
  if (!email) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException(errorCode);
  }
  return email.toLowerCase();
}

function optionalUrl(value: string | undefined, errorCode: string): string | undefined {
  const text = optionalText(value);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("INVALID_PROTOCOL");
    }
    return text;
  } catch {
    throw new BadRequestException(errorCode);
  }
}

function optionalDate(value: string | undefined, errorCode: string): string | undefined {
  if (value === undefined || value === "") return undefined;
  const trimmed = value.trim();
  if (!isIsoDateTimeString(trimmed)) {
    throw new BadRequestException(errorCode);
  }
  return new Date(Date.parse(trimmed)).toISOString();
}

function isIsoDateTimeString(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  return Boolean(match?.[1] && isCalendarDateString(match[1]) && !Number.isNaN(Date.parse(value)));
}

function isCalendarDateString(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function optionalPositiveInt(value: number | undefined, errorCode: string): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(errorCode);
  }
  return value;
}

function nextActivationExpiry(): string {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 1);
  return expiresAt.toISOString();
}

async function createTenantOrThrow<T>(createTenant: () => Promise<T>): Promise<T> {
  try {
    return await createTenant();
  } catch (error) {
    if (isUniqueConstraintError(error, "Tenant_slug_key")) {
      throw new BadRequestException("TENANT_SLUG_ALREADY_EXISTS");
    }
    if (isTenantFirstAdminEmailAlreadyExists(error)) {
      throw new BadRequestException("TENANT_FIRST_ADMIN_EMAIL_ALREADY_EXISTS");
    }
    throw error;
  }
}

function isUniqueConstraintError(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === "23505" && candidate.constraint === constraint;
}

function isTenantFirstAdminEmailAlreadyExists(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return candidate.code === "TENANT_FIRST_ADMIN_EMAIL_ALREADY_EXISTS" ||
    candidate.message === "TENANT_FIRST_ADMIN_EMAIL_ALREADY_EXISTS";
}

function requireTenantId(context: RequestContext): string {
  if (!context.tenantId) {
    throw new BadRequestException("TENANT_CONTEXT_REQUIRED");
  }
  return context.tenantId;
}
