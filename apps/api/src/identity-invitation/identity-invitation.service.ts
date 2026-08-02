import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import {
  hasCapabilityForRoles,
  isPortalSubjectRoleName,
  type EmployeeInvitationRole,
  type PortalSubjectRoleName,
  type IdentityInvitationAcceptRequest,
  type IdentityInvitationCreateRequest,
} from "@o-okul/shared-types";
import { createHash, randomBytes } from "node:crypto";
import { encryptSecretDeliveryPayload, type SecretDeliveryOutboxInput } from "@o-okul/db";
import { passwordPolicyViolation } from "../auth/password-policy.js";
import { hashPasswordAsync } from "../auth/auth-user-store.js";
import { verifyAdminMfaStepUpProof } from "../auth/totp-mfa.js";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { type GuardianStore, guardianStoreToken } from "../school/guardian-store.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import {
  assertTenantSeatCapacity,
  isTenantSeatLimitExceededError,
  tenantSeatLimitExceededCode,
} from "../tenant/tenant-seat-limit.js";
import { type TenantStore, tenantStoreToken } from "../tenant/tenant-store.js";
import {
  type TenantUserRecord,
  type UserManagementStore,
  userManagementStoreToken,
} from "../user-management/user-management-store.js";
import {
  type IdentityInvitationRecord,
  type IdentityInvitationStore,
  type InvitationSubjectType,
  identityInvitationStoreToken,
} from "./identity-invitation-store.js";
import {
  type EmployeeAccountActivationOutcome,
  type EmployeeAccountActivationStore,
  employeeAccountActivationStoreToken,
} from "./employee-account-activation-store.js";

export type CreateIdentityInvitationBody = IdentityInvitationCreateRequest;
export type AcceptIdentityInvitationBody = IdentityInvitationAcceptRequest;

export interface IdentityInvitationIssueResult {
  invitation: IdentityInvitationRecord;
  activationToken: string;
}

@Injectable()
export class IdentityInvitationService {
  constructor(
    @Inject(identityInvitationStoreToken) private readonly invitations: IdentityInvitationStore,
    @Inject(userManagementStoreToken) private readonly users: UserManagementStore,
    @Inject(studentStoreToken) private readonly students: StudentStore,
    @Inject(guardianStoreToken) private readonly guardians: GuardianStore,
    @Inject(teacherStoreToken) private readonly teachers: TeacherStore,
    @Inject(tenantStoreToken) private readonly tenants: TenantStore,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional()
    @Inject(employeeAccountActivationStoreToken)
    private readonly employeeActivations?: EmployeeAccountActivationStore,
  ) {}

  async list(context: RequestContext): Promise<IdentityInvitationRecord[]> {
    const tenantId = this.requireTenantId(context);
    return this.invitations.list(tenantId);
  }

  async create(context: RequestContext, body: CreateIdentityInvitationBody): Promise<IdentityInvitationIssueResult> {
    const tenantId = this.requireTenantId(context);
    const subjectType = parseSubjectType(body.subjectType);
    const subjectId = body.subjectId?.trim();
    const email = body.email?.trim().toLowerCase();
    if (!subjectId) throw new BadRequestException("SUBJECT_ID_REQUIRED");
    if (!email || !email.includes("@")) throw new BadRequestException("EMAIL_REQUIRED");

    const subject = await this.findSubject(tenantId, subjectType, subjectId);
    if (!subject) throw new NotFoundException("SUBJECT_NOT_FOUND");
    this.assertStudentPortalEligible(subjectType, subject);
    if (subject.userId) throw new BadRequestException("SUBJECT_ALREADY_LINKED");

    const token = createActivationToken();
    const expiresAt = nextExpiry();
    const invitation = await this.invitations.create({
      tenantId,
      subjectType,
      subjectId,
      email,
      name: body.name?.trim() || `${subject.firstName} ${subject.lastName}`,
      role: subjectType,
      tokenHash: hashActivationToken(token),
      expiresAt,
      delivery: createInvitationDelivery(tenantId, email, token, expiresAt),
    });
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "IdentityInvitation",
      entityId: invitation.id,
      action: "identity_invitation.created",
      diff: { subjectType, subjectId, emailProvided: true, role: invitation.role },
    });
    return { invitation, activationToken: token };
  }

  async createEmployeeInvitation(
    context: RequestContext,
    employeeId: string,
    input: { email: string; role: EmployeeInvitationRole },
    stepUpToken?: string,
  ): Promise<IdentityInvitationIssueResult> {
    const tenantId = this.requireTenantId(context);
    this.assertElevatedEmployeeInvitationAllowed(context, input.role, stepUpToken);
    const employee = await this.users.findEmployee(tenantId, employeeId);
    if (!employee) throw new NotFoundException("EMPLOYEE_NOT_FOUND");
    if (employee.status !== "ACTIVE") throw new BadRequestException("EMPLOYEE_INVITATION_REQUIRES_ACTIVE_PROFILE");
    if (employee.userId) throw new BadRequestException("EMPLOYEE_ALREADY_LINKED");
    const pending = (await this.invitations.list(tenantId)).some((invitation) => (
      invitation.subjectType === "EMPLOYEE" && invitation.subjectId === employeeId && invitation.status === "PENDING"
    ));
    if (pending) throw new BadRequestException("EMPLOYEE_INVITATION_ALREADY_PENDING");

    const email = input.email.trim().toLowerCase();
    const token = createActivationToken();
    const expiresAt = nextExpiry();
    const invitation = await this.invitations.create({
      tenantId,
      subjectType: "EMPLOYEE",
      subjectId: employee.id,
      email,
      name: `${employee.firstName} ${employee.lastName}`,
      role: input.role,
      tokenHash: hashActivationToken(token),
      expiresAt,
      delivery: createInvitationDelivery(tenantId, email, token, expiresAt),
    });
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "IdentityInvitation",
      entityId: invitation.id,
      action: "employee.account_invitation_created",
      diff: { employeeId, role: input.role, emailProvided: true },
    });
    return { invitation, activationToken: token };
  }

  private assertElevatedEmployeeInvitationAllowed(
    context: RequestContext,
    role: EmployeeInvitationRole,
    stepUpToken?: string,
  ): void {
    if (role !== "TENANT_OWNER" && role !== "TENANT_ADMIN") return;
    if (role === "TENANT_OWNER" && !hasCapabilityForRoles(context.roles, "owner:manage", context.capabilities)) {
      throw new ForbiddenException("TENANT_OWNER_MANAGE_REQUIRED");
    }
    if (!stepUpToken) throw new ForbiddenException("STEP_UP_MFA_REQUIRED");
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
    } catch {
      throw new ForbiddenException("STEP_UP_MFA_INVALID");
    }
  }

  async resend(context: RequestContext, id: string): Promise<IdentityInvitationIssueResult> {
    const tenantId = this.requireTenantId(context);
    const existing = await this.invitations.findById(tenantId, id);
    if (!existing) throw new NotFoundException("IDENTITY_INVITATION_NOT_FOUND");
    if (existing.status !== "PENDING") throw new BadRequestException("IDENTITY_INVITATION_NOT_PENDING");
    if (existing.kind !== "EMAIL_LINK" || !existing.email) throw new BadRequestException("IDENTITY_INVITATION_RESEND_UNSUPPORTED");

    const token = createActivationToken();
    const expiresAt = nextExpiry();
    const invitation = await this.invitations.resend(tenantId, id, {
      tokenHash: hashActivationToken(token),
      expiresAt,
      delivery: createInvitationDelivery(tenantId, existing.email, token, expiresAt),
    });
    if (!invitation) throw new NotFoundException("IDENTITY_INVITATION_NOT_FOUND");
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "IdentityInvitation",
      entityId: invitation.id,
      action: "identity_invitation.resent",
      diff: { expiresAt: invitation.expiresAt },
    });
    return { invitation, activationToken: token };
  }

  async accept(body: AcceptIdentityInvitationBody): Promise<IdentityInvitationRecord> {
    const token = body.token?.trim();
    const password = body.password;
    if (!token) throw new BadRequestException("TOKEN_REQUIRED");
    const passwordViolation = passwordPolicyViolation(password);
    if (passwordViolation) throw new BadRequestException(passwordViolation);

    const invitation = await this.invitations.findByTokenHash(hashActivationToken(token));
    if (!invitation) throw new NotFoundException("IDENTITY_INVITATION_NOT_FOUND");
    if (invitation.subjectType === "EMPLOYEE" && this.employeeActivations) {
      const outcome = await this.employeeActivations.accept({
        tokenHash: hashActivationToken(token),
        passwordHash: await hashPasswordAsync(password),
        name: body.name?.trim(),
        acceptedAt: new Date().toISOString(),
      });
      const accepted = requireAcceptedEmployeeActivation(outcome);
      await this.auditLogs?.record({
        tenantId: accepted.tenantId,
        actorUserId: accepted.acceptedUserId,
        entityType: "IdentityInvitation",
        entityId: accepted.id,
        action: "identity_invitation.accepted",
        diff: { subjectType: accepted.subjectType, subjectId: accepted.subjectId, userId: accepted.acceptedUserId },
      });
      return accepted;
    }
    if (invitation.kind !== "EMAIL_LINK" || !invitation.email) throw new BadRequestException("IDENTITY_INVITATION_KIND_INVALID");
    if (invitation.status !== "PENDING") throw new BadRequestException("IDENTITY_INVITATION_NOT_PENDING");
    if (Date.parse(invitation.expiresAt) <= Date.now()) throw new BadRequestException("IDENTITY_INVITATION_EXPIRED");
    const subject = await this.findSubject(invitation.tenantId, invitation.subjectType, invitation.subjectId);
    if (!subject) throw new NotFoundException("SUBJECT_NOT_FOUND");
    this.assertStudentPortalEligible(invitation.subjectType, subject);
    const nationalIdEncrypted = "nationalIdEncrypted" in subject ? subject.nationalIdEncrypted : undefined;
    const nationalIdHash = "nationalIdHash" in subject ? subject.nationalIdHash : undefined;
    if (invitation.subjectType !== "EMPLOYEE" && (!nationalIdEncrypted || !nationalIdHash)) {
      throw new BadRequestException("SUBJECT_NATIONAL_ID_REQUIRED");
    }

    const existingUsers = await this.users.listTenantUsers(invitation.tenantId);
    if (!existingUsers.some((user) => user.email?.toLowerCase() === invitation.email)) {
      await this.assertTenantSeatAvailable(invitation.tenantId);
    }

    let user: TenantUserRecord;
    try {
      user = await this.users.createOrAttachTenantUser({
        tenantId: invitation.tenantId,
        email: invitation.email,
        name: body.name?.trim() || invitation.name,
        nationalIdEncrypted,
        nationalIdHash,
        passwordHash: await hashPasswordAsync(password),
        roles: [invitation.role],
      });
    } catch (error) {
      throwTenantSeatLimitBadRequest(error);
    }
    const boundSubject = await this.bindSubject(invitation.tenantId, invitation.subjectType, invitation.subjectId, user.id);
    if (!boundSubject) {
      await this.users.removeTenantRole(invitation.tenantId, user.id, invitation.role);
      throw new NotFoundException("SUBJECT_NOT_FOUND");
    }

    const accepted = await this.invitations.markAccepted(invitation.id, user.id, new Date().toISOString());
    if (!accepted) {
      await this.users.removeTenantRole(invitation.tenantId, user.id, invitation.role);
      throw new BadRequestException("IDENTITY_INVITATION_NOT_PENDING");
    }
    await this.auditLogs?.record({
      tenantId: invitation.tenantId,
      actorUserId: user.id,
      entityType: "IdentityInvitation",
      entityId: invitation.id,
      action: "identity_invitation.accepted",
      diff: { subjectType: invitation.subjectType, subjectId: invitation.subjectId, userId: user.id },
    });
    return accepted;
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

  private async findSubject(tenantId: string, subjectType: InvitationSubjectType, subjectId: string) {
    const subject =
      subjectType === "EMPLOYEE"
        ? await this.users.findEmployee(tenantId, subjectId)
        : subjectType === "STUDENT"
        ? await this.students.findProfileById(subjectId)
        : subjectType === "GUARDIAN"
          ? await this.guardians.findById(subjectId)
          : await this.teachers.findById(subjectId);
    return subject?.tenantId === tenantId ? subject : undefined;
  }

  private bindSubject(tenantId: string, subjectType: InvitationSubjectType, subjectId: string, userId: string) {
    if (subjectType === "EMPLOYEE") return this.users.bindEmployeeUser(tenantId, subjectId, userId);
    if (subjectType === "STUDENT") return this.students.bindUser(tenantId, subjectId, userId);
    if (subjectType === "GUARDIAN") return this.guardians.bindUser(tenantId, subjectId, userId);
    return this.teachers.bindUser(tenantId, subjectId, userId);
  }

  private assertStudentPortalEligible(subjectType: InvitationSubjectType, subject: unknown): void {
    if (
      subjectType === "STUDENT" &&
      (typeof subject !== "object" || subject === null || !("status" in subject) || subject.status !== "ACTIVE")
    ) {
      throw new BadRequestException("STUDENT_PORTAL_ACCESS_REQUIRES_ACTIVE_PROFILE");
    }
  }
}

function requireAcceptedEmployeeActivation(outcome: EmployeeAccountActivationOutcome): IdentityInvitationRecord {
  if (outcome.status === "ACCEPTED") return outcome.invitation;
  if (outcome.status === "INVALID") throw new NotFoundException("IDENTITY_INVITATION_NOT_FOUND");
  if (outcome.status === "EXPIRED") throw new BadRequestException("IDENTITY_INVITATION_EXPIRED");
  if (outcome.status === "NOT_PENDING") throw new BadRequestException("IDENTITY_INVITATION_NOT_PENDING");
  if (outcome.status === "PROFILE_NOT_ACTIVE") {
    throw new BadRequestException("EMPLOYEE_INVITATION_REQUIRES_ACTIVE_PROFILE");
  }
  if (outcome.status === "ALREADY_LINKED") throw new BadRequestException("EMPLOYEE_ALREADY_LINKED");
  if (outcome.status === "EMAIL_ACCOUNT_ALREADY_BOUND") {
    throw new BadRequestException("EMPLOYEE_EMAIL_ACCOUNT_ALREADY_BOUND");
  }
  if (outcome.status === "EMAIL_ACCOUNT_INCOMPATIBLE") {
    throw new BadRequestException("EMPLOYEE_EMAIL_ACCOUNT_INCOMPATIBLE");
  }
  if (outcome.status === "LICENSE_INACTIVE") throw new BadRequestException("TENANT_LICENSE_INACTIVE");
  throw new BadRequestException("EMPLOYEE_ACCOUNT_LIMIT_EXCEEDED");
}

function throwTenantSeatLimitBadRequest(error: unknown): never {
  if (isTenantSeatLimitExceededError(error)) {
    throw new BadRequestException(tenantSeatLimitExceededCode);
  }
  throw error;
}

function parseSubjectType(input: string | undefined): PortalSubjectRoleName {
  if (input && isPortalSubjectRoleName(input)) return input;
  throw new BadRequestException("SUBJECT_TYPE_INVALID");
}

function createActivationToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashActivationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function nextExpiry(): string {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 24);
  return expiresAt.toISOString();
}

function createInvitationDelivery(tenantId: string, email: string, token: string, expiresAt: string): SecretDeliveryOutboxInput {
  const url = createInvitationDeliveryUrl(token);
  return {
    tenantId,
    purpose: "IDENTITY_INVITATION",
    payloadEncrypted: encryptSecretDeliveryPayload({
      channel: "EMAIL",
      to: email,
      subject: "O-Okul hesap aktivasyonu",
      body: `Hesabınızı 24 saat içinde etkinleştirmek için bağlantıyı açın: ${url.toString()}`,
    }),
    expiresAt,
  };
}

export function createInvitationDeliveryUrl(token: string): URL {
  const url = new URL("/aktivasyon", process.env.WEB_URL ?? "http://localhost:3000");
  url.hash = new URLSearchParams({ token }).toString();
  return url;
}
