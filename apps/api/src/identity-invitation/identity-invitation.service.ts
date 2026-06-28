import { BadRequestException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import {
  isPortalSubjectRoleName,
  type IdentityInvitationAcceptRequest,
  type IdentityInvitationCreateRequest,
} from "@o-okul/shared-types";
import { createHash, randomBytes } from "node:crypto";
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
    if (subject.userId) throw new BadRequestException("SUBJECT_ALREADY_LINKED");

    const token = createActivationToken();
    const invitation = await this.invitations.create({
      tenantId,
      subjectType,
      subjectId,
      email,
      name: body.name?.trim() || `${subject.firstName} ${subject.lastName}`,
      role: subjectType,
      tokenHash: hashActivationToken(token),
      expiresAt: nextExpiry(),
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

  async resend(context: RequestContext, id: string): Promise<IdentityInvitationIssueResult> {
    const tenantId = this.requireTenantId(context);
    const existing = await this.invitations.findById(tenantId, id);
    if (!existing) throw new NotFoundException("IDENTITY_INVITATION_NOT_FOUND");
    if (existing.status === "ACCEPTED") throw new BadRequestException("IDENTITY_INVITATION_ACCEPTED");

    const token = createActivationToken();
    const invitation = await this.invitations.resend(tenantId, id, {
      tokenHash: hashActivationToken(token),
      expiresAt: nextExpiry(),
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
    if (!password || password.length < 8) throw new BadRequestException("PASSWORD_MIN_8_REQUIRED");

    const invitation = await this.invitations.findByTokenHash(hashActivationToken(token));
    if (!invitation) throw new NotFoundException("IDENTITY_INVITATION_NOT_FOUND");
    if (invitation.status !== "PENDING") throw new BadRequestException("IDENTITY_INVITATION_NOT_PENDING");
    if (Date.parse(invitation.expiresAt) <= Date.now()) throw new BadRequestException("IDENTITY_INVITATION_EXPIRED");
    const subject = await this.findSubject(invitation.tenantId, invitation.subjectType, invitation.subjectId);
    if (!subject) throw new NotFoundException("SUBJECT_NOT_FOUND");
    if (!subject.nationalIdEncrypted || !subject.nationalIdHash) throw new BadRequestException("SUBJECT_NATIONAL_ID_REQUIRED");

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
        nationalIdEncrypted: subject.nationalIdEncrypted,
        nationalIdHash: subject.nationalIdHash,
        password,
        roles: [invitation.role],
      });
    } catch (error) {
      throwTenantSeatLimitBadRequest(error);
    }
    const boundSubject = await this.bindSubject(invitation.tenantId, invitation.subjectType, invitation.subjectId, user.id);
    if (!boundSubject) throw new NotFoundException("SUBJECT_NOT_FOUND");

    const accepted = await this.invitations.markAccepted(invitation.id, user.id, new Date().toISOString());
    if (!accepted) throw new NotFoundException("IDENTITY_INVITATION_NOT_FOUND");
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
      subjectType === "STUDENT"
        ? await this.students.findProfileById(subjectId)
        : subjectType === "GUARDIAN"
          ? await this.guardians.findById(subjectId)
          : await this.teachers.findById(subjectId);
    return subject?.tenantId === tenantId ? subject : undefined;
  }

  private bindSubject(tenantId: string, subjectType: InvitationSubjectType, subjectId: string, userId: string) {
    if (subjectType === "STUDENT") return this.students.bindUser(tenantId, subjectId, userId);
    if (subjectType === "GUARDIAN") return this.guardians.bindUser(tenantId, subjectId, userId);
    return this.teachers.bindUser(tenantId, subjectId, userId);
  }
}

function throwTenantSeatLimitBadRequest(error: unknown): never {
  if (isTenantSeatLimitExceededError(error)) {
    throw new BadRequestException(tenantSeatLimitExceededCode);
  }
  throw error;
}

function parseSubjectType(input: string | undefined): InvitationSubjectType {
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
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt.toISOString();
}
