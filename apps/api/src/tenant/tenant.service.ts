import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { LicenseTermListRecord, TenantCreateResponse } from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { hashIdempotencyRequest } from "../http/idempotency.js";
import type { RequestContext } from "../context/request-context.js";
import { isSystemAdmin } from "../rbac/roles.js";
import { requiredText } from "../shared/required-text.js";
import {
  type LicenseTermRecord,
  type LicenseTermStore,
  licenseTermStoreToken,
} from "../license/license-term-store.js";
import { licenseTermCreateBodySchema, type LicenseTermCreateBody } from "../license/license-validation.js";
import { resolveLicenseState } from "../license/license-state.js";
import { normalizeTcIdentity } from "../student/tc-identity.js";
import { assertValidTenantSlug, TenantHostError } from "../http/tenant-host.js";
import type { TenantUserRecord } from "../user-management/user-management-store.js";
import {
  type CreateTenantInput,
  type CreateTenantOnboardingInput,
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
  firstOwner?: TenantFirstAdminBody;
  campuses?: CreateTenantOnboardingInput["campuses"];
  licenseTerm?: LicenseTermCreateBody;
}

export interface TenantFirstAdminBody {
  name?: string;
  email?: string;
  nationalId?: string;
}

export type { TenantCreateResponse };

@Injectable()
export class TenantService {
  constructor(
    @Inject(tenantStoreToken) private readonly tenants: TenantStore,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() @Inject(licenseTermStoreToken) private readonly licenseTerms?: LicenseTermStore,
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

  async listCurrentLicenseTerms(context: RequestContext): Promise<LicenseTermListRecord[]> {
    const tenantId = requireTenantId(context);
    if (!this.licenseTerms?.listForTenant) throw new BadRequestException("LICENSE_TERM_STORE_REQUIRED");
    return (await this.licenseTerms.listForTenant(tenantId)).map((term) => ({
      ...term,
      state: resolveLicenseState(term),
    }));
  }

  async create(context: RequestContext, body: TenantWriteBody, idempotencyKey?: string): Promise<TenantCreateResponse> {
    this.assertSystemAdmin(context);
    const tenantInput = parseCreateTenant(body);
    const onboarding = parseTenantOnboarding(body, context.userId, idempotencyKey);
    if (onboarding) {
      if (!this.tenants.createOnboarding) throw new BadRequestException("TENANT_ATOMIC_ONBOARDING_REQUIRED");
      const stored = await createTenantOrThrow(() => this.tenants.createOnboarding!(tenantInput, onboarding));
      if (!stored.replayed) {
        await this.recordTenantCreated(context, stored.result.tenant);
        await this.recordFirstOwnerCreated(context, stored.result.tenant.id, stored.result.owner);
      }
      return stored.result;
    }
    const firstAdmin = parseFirstAdmin(body.firstAdmin);
    if (firstAdmin) {
      if (!this.tenants.createWithFirstAdmin) throw new BadRequestException("TENANT_ATOMIC_ONBOARDING_REQUIRED");
      const result = await createTenantOrThrow(() => this.tenants.createWithFirstAdmin!(tenantInput, firstAdmin));
      await this.recordTenantCreated(context, result.tenant);
      await this.recordFirstAdminCreated(context, result.tenant.id, result.admin);
      return result;
    }
    const tenant = await createTenantOrThrow(() => this.tenants.create(tenantInput));
    await this.recordTenantCreated(context, tenant);
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
    const tenant = await this.tenants.findForAdmin(id);
    if (!tenant || tenant.id === "system") {
      throw new NotFoundException("TENANT_NOT_FOUND");
    }
    const deletedTenant = { ...tenant, status: "DELETED" };
    await this.auditLogs?.record({
      tenantId: tenant.id,
      actorUserId: context.userId,
      entityType: "Tenant",
      entityId: tenant.id,
      action: "tenant.deleted",
      diff: { status: deletedTenant.status },
    });
    const removedTenant = await this.tenants.delete(id);
    if (!removedTenant) {
      throw new NotFoundException("TENANT_NOT_FOUND");
    }
    return deletedTenant;
  }

  async createLicenseTerm(context: RequestContext, tenantId: string, body: LicenseTermCreateBody): Promise<LicenseTermRecord> {
    this.assertSystemAdmin(context);
    if (!this.licenseTerms) throw new BadRequestException("LICENSE_TERM_STORE_REQUIRED");
    if (!await this.tenants.findForAdmin(tenantId)) throw new NotFoundException("TENANT_NOT_FOUND");
    let term: LicenseTermRecord;
    try {
      term = await this.licenseTerms.create({
        tenantId,
        planCode: body.planCode,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        activeStudentLimit: body.activeStudentLimit,
        createdByPlatformAccountId: context.userId,
        auditReference: body.auditReference,
      });
    } catch (error) {
      if (isPostgresConstraintError(error, "23P01") || (error instanceof Error && error.message === "LICENSE_TERM_OVERLAP")) {
        throw new BadRequestException("LICENSE_TERM_OVERLAP");
      }
      if (isPostgresConstraintError(error, "23503")) throw new BadRequestException("LICENSE_TERM_PLATFORM_ACCOUNT_REQUIRED");
      throw error;
    }
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "LicenseTerm",
      entityId: term.id,
      action: "license_term.created",
      diff: {
        planCode: term.planCode,
        startsAt: term.startsAt,
        endsAt: term.endsAt,
        activeStudentLimit: term.activeStudentLimit,
        auditReference: term.auditReference,
      },
    });
    return term;
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

  private async recordFirstOwnerCreated(
    context: RequestContext,
    tenantId: string,
    owner: { id: string; employeeId: string; roles: ["TENANT_OWNER"] },
  ): Promise<void> {
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "Employee",
      entityId: owner.employeeId,
      action: "tenant.first_owner_invited",
      diff: { accountId: owner.id, emailProvided: true, roles: owner.roles },
    });
  }

}

function isPostgresConstraintError(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function parseCreateTenant(body: TenantWriteBody): CreateTenantInput {
  return {
    id: optionalText(body.id),
    name: requiredText(body.name, "TENANT_NAME_REQUIRED"),
    slug: validTenantSlug(requiredText(body.slug, "TENANT_SLUG_REQUIRED")),
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
    institutionType: optionalText(body.institutionType),
    contactEmail: optionalEmail(body.contactEmail, "TENANT_CONTACT_EMAIL_INVALID"),
    logoUrl: optionalUrl(body.logoUrl, "TENANT_LOGO_URL_INVALID"),
    status: optionalText(body.status),
  };
}

function validTenantSlug(slug: string): string {
  try {
    return assertValidTenantSlug(slug);
  } catch (error) {
    if (error instanceof TenantHostError) throw new BadRequestException(error.message);
    throw error;
  }
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
      nationalId: string;
    }
  | undefined {
  if (!body) return undefined;
  const nationalId = normalizeTcIdentity(
    requiredText(body.nationalId, "TENANT_FIRST_ADMIN_NATIONAL_ID_REQUIRED"),
    "TENANT_FIRST_ADMIN_NATIONAL_ID_INVALID",
  );
  return {
    name: requiredText(body.name, "TENANT_FIRST_ADMIN_NAME_REQUIRED"),
    email: requiredEmail(body.email, "TENANT_FIRST_ADMIN_EMAIL_REQUIRED"),
    nationalId,
  };
}

function parseTenantOnboarding(
  body: TenantWriteBody,
  platformAccountId: string,
  idempotencyKey: string | undefined,
): CreateTenantOnboardingInput | undefined {
  const hasAny = Boolean(body.firstOwner || body.campuses || body.licenseTerm);
  if (!hasAny) return undefined;
  if (!body.firstOwner || !body.campuses?.length || !body.licenseTerm) {
    throw new BadRequestException("TENANT_ONBOARDING_FIELDS_REQUIRED");
  }
  const parsedTerm = licenseTermCreateBodySchema.safeParse(body.licenseTerm);
  if (!parsedTerm.success) throw new BadRequestException("TENANT_LICENSE_TERM_INVALID");
  const normalizedIdempotencyKey = idempotencyKey?.trim();
  if (!normalizedIdempotencyKey) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
  if (normalizedIdempotencyKey.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(normalizedIdempotencyKey)) {
    throw new BadRequestException("IDEMPOTENCY_KEY_INVALID");
  }
  const owner = parseFirstOwner(body.firstOwner);
  return {
    campuses: body.campuses.map((campus) => ({
      name: requiredText(campus.name, "TENANT_CAMPUS_NAME_REQUIRED"),
      code: optionalText(campus.code),
      unitType: campus.unitType,
    })),
    firstOwner: owner,
    idempotencyKey: normalizedIdempotencyKey,
    requestHash: hashIdempotencyRequest("tenant.onboarding.create", body),
    licenseTerm: {
      ...parsedTerm.data,
      createdByPlatformAccountId: platformAccountId,
    },
  };
}

function parseFirstOwner(body: TenantFirstAdminBody): CreateTenantOnboardingInput["firstOwner"] {
  const nationalId = optionalText(body.nationalId);
  return {
    name: requiredText(body.name, "TENANT_FIRST_OWNER_NAME_REQUIRED"),
    email: requiredEmail(body.email, "TENANT_FIRST_OWNER_EMAIL_REQUIRED"),
    nationalId: nationalId
      ? normalizeTcIdentity(nationalId, "TENANT_FIRST_OWNER_NATIONAL_ID_INVALID")
      : undefined,
  };
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

async function createTenantOrThrow<T>(createTenant: () => Promise<T>): Promise<T> {
  try {
    return await createTenant();
  } catch (error) {
    if (isUniqueConstraintError(error, "Tenant_slug_key")) {
      throw new BadRequestException("TENANT_SLUG_ALREADY_EXISTS");
    }
    if (error instanceof Error && ["IDEMPOTENCY_KEY_BODY_MISMATCH", "IDEMPOTENCY_KEY_IN_PROGRESS"].includes(error.message)) {
      throw new ConflictException(error.message);
    }
    throw error;
  }
}

function isUniqueConstraintError(error: unknown, constraint: string): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === "23505" && candidate.constraint === constraint;
}

function requireTenantId(context: RequestContext): string {
  if (!context.tenantId) {
    throw new BadRequestException("TENANT_CONTEXT_REQUIRED");
  }
  return context.tenantId;
}
