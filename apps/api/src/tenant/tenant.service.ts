import { runVerifiedTenantMutation } from "../context/tenant-mutation-activity.js";
import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional, UnauthorizedException } from "@nestjs/common";
import { resolveLicenseState, type LicenseTermListRecord, type TenantStatusUpdateRequest, type TenantCreateResponse, type TenantStatusUpdateResult } from "@o-okul/shared-types";
import { verifyAdminMfaStepUpProof } from "../auth/totp-mfa.js";
import { tenantStatusUpdateBodySchema } from "./tenant-validation.js";
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
import { normalizeTcIdentity } from "../student/tc-identity.js";
import { assertValidTenantSlug, TenantHostError } from "../http/tenant-host.js";
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
  institutionType?: string;
  contactEmail?: string;
  logoUrl?: string;
  firstOwner?: TenantFirstOwnerBody;
  campuses?: CreateTenantOnboardingInput["campuses"];
  licenseTerm?: LicenseTermCreateBody;
}

export interface TenantFirstOwnerBody {
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
    if (id.trim() === "system") throw new NotFoundException("TENANT_NOT_FOUND");
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
    assertMutableTenantId(body.id);
    const tenantInput = parseCreateTenant(body);
    const onboarding = parseTenantOnboarding(body, context.userId, idempotencyKey);
    const stored = await createTenantOrThrow(() => this.tenants.createOnboarding(tenantInput, onboarding));
    if (!stored.replayed && !stored.auditedAtomically) {
      await this.recordTenantCreated(context, stored.result.tenant);
      await this.recordFirstOwnerCreated(context, stored.result.tenant.id, stored.result.owner);
    }
    return stored.result;
  }

  async update(context: RequestContext, id: string, body: TenantWriteBody): Promise<TenantRecord> {
    this.assertSystemAdmin(context);
    assertMutableTenantId(id);
    const parsed = parseUpdateTenant(body);
    const captured = await this.tenants.findForAdmin(id);
    if (!captured) throw new NotFoundException("TENANT_NOT_FOUND");
    return this.adminMutation(context, id, captured.lifecycleVersion, async () => {
    const tenant = await this.tenants.update(id, parsed);
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
        name: tenant.name,
        institutionType: tenant.institutionType,
        contactEmail: tenant.contactEmail,
        logoUrl: tenant.logoUrl,
      },
    });
    return tenant;
    });
  }

  async updateStatus(context: RequestContext, id: string, body: TenantStatusUpdateRequest, idempotencyKey?: string, stepUpToken?: string): Promise<TenantStatusUpdateResult> {
    this.assertSystemAdmin(context);
    assertMutableTenantId(id);
    const parsed = tenantStatusUpdateBodySchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException("TENANT_LIFECYCLE_REQUEST_INVALID");
    const key = idempotencyKey?.trim();
    if (!key) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    if (key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) throw new BadRequestException("IDEMPOTENCY_KEY_INVALID");
    if (!stepUpToken || !context.sessionId || context.membershipVersion === undefined) {
      throw new UnauthorizedException("MFA_STEP_UP_REQUIRED");
    }
    try {
      verifyAdminMfaStepUpProof(stepUpToken, {
        userId: context.userId, sessionId: context.sessionId, membershipVersion: context.membershipVersion,
        purpose: "TENANT_LIFECYCLE_CHANGE",
        target: { tenantId: id, status: body.status, expectedLifecycleVersion: body.expectedLifecycleVersion },
      });
    } catch {
      throw new UnauthorizedException("MFA_STEP_UP_INVALID");
    }
    const captured = await this.tenants.findForAdmin(id);
    if (!captured) throw new NotFoundException("TENANT_NOT_FOUND");
    return this.adminMutation(context, id, captured.lifecycleVersion, async () => {
    try {
      const result = await this.tenants.transitionStatus(id, {
        ...parsed.data, actorUserId: context.userId, sessionId: context.sessionId!,
        membershipVersion: context.membershipVersion!, idempotencyKey: key,
        requestHash: hashIdempotencyRequest("tenant.lifecycle.change", { tenantId: id, ...parsed.data }),
      });
      if (!result) throw new NotFoundException("TENANT_NOT_FOUND");
      return result;
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "TENANT_NOT_FOUND") throw new NotFoundException(code);
      if (["TENANT_LIFECYCLE_VERSION_CONFLICT", "IDEMPOTENCY_KEY_BODY_MISMATCH", "IDEMPOTENCY_KEY_IN_PROGRESS", "RESET_OPERATION_IN_PROGRESS"].includes(code)) throw new ConflictException(code);
      if (["TENANT_CONFIRMATION_MISMATCH", "TENANT_STATUS_UNSUPPORTED"].includes(code)) throw new BadRequestException(code);
      if (code === "MFA_STEP_UP_CONTEXT_INVALID") throw new UnauthorizedException(code);
      throw error;
    }
    });
  }

  async updateCurrent(context: RequestContext, body: TenantWriteBody): Promise<TenantRecord> {
    const tenantId = requireTenantId(context);
    assertMutableTenantId(tenantId);
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

  async createLicenseTerm(context: RequestContext, tenantId: string, body: LicenseTermCreateBody): Promise<LicenseTermRecord> {
    this.assertSystemAdmin(context);
    assertMutableTenantId(tenantId);
    if (!this.licenseTerms) throw new BadRequestException("LICENSE_TERM_STORE_REQUIRED");
    const captured = await this.tenants.findForAdmin(tenantId);
    if (!captured) throw new NotFoundException("TENANT_NOT_FOUND");
    return this.adminMutation(context, tenantId, captured.lifecycleVersion, async () => {
    let term: LicenseTermRecord;
    try {
      term = await this.licenseTerms!.create({
        tenantId,
        planCode: body.planCode,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        activeStudentLimit: body.activeStudentLimit,
        createdByPlatformAccountId: context.userId,
        auditReference: createLicenseTrackingReference(),
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
    });
  }

  private adminMutation<T>(context: RequestContext, tenantId: string, lifecycleVersion: number, run: () => Promise<T>): Promise<T> {
    return runVerifiedTenantMutation({ tenantId, lifecycleVersion, kind: "ADMIN_MUTATION", actor: { platform: true, userId: context.userId, sessionId: context.sessionId!, membershipVersion: context.membershipVersion! } }, run);
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
    plan: "TRIAL",
    institutionType: optionalText(body.institutionType),
    contactEmail: optionalEmail(body.contactEmail, "TENANT_CONTACT_EMAIL_INVALID"),
    logoUrl: optionalUrl(body.logoUrl, "TENANT_LOGO_URL_INVALID"),
    status: "ACTIVE",
  };
}

function parseUpdateTenant(body: TenantWriteBody): UpdateTenantInput {
  return {
    name: optionalText(body.name),
    institutionType: optionalText(body.institutionType),
    contactEmail: optionalEmail(body.contactEmail, "TENANT_CONTACT_EMAIL_INVALID"),
    logoUrl: optionalUrl(body.logoUrl, "TENANT_LOGO_URL_INVALID"),
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

function parseTenantOnboarding(
  body: TenantWriteBody,
  platformAccountId: string,
  idempotencyKey: string | undefined,
): CreateTenantOnboardingInput {
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
      auditReference: createLicenseTrackingReference(),
    },
  };
}

function createLicenseTrackingReference(): string {
  return `license-${randomUUID()}`;
}

function parseFirstOwner(body: TenantFirstOwnerBody): CreateTenantOnboardingInput["firstOwner"] {
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

function assertMutableTenantId(id: string | undefined): void {
  if (id?.trim() === "system") throw new BadRequestException("SYSTEM_TENANT_IMMUTABLE");
}
