import { runVerifiedTenantMutation } from "../context/tenant-mutation-activity.js";
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import { IdempotencyService } from "../http/idempotency.js";
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
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { type GuardianStore, guardianStoreToken } from "../school/guardian-store.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { type TenantStore, tenantStoreToken } from "../tenant/tenant-store.js";
import { tenantWebUrl } from "../http/tenant-origin.js";
import { requireTenantWideStaffContext } from "../tenant/tenant-access.js";
import { buildTenantMembershipDualWriteRows } from "../identity-provisioning/tenant-membership-dual-write.js";
import {
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
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async list(context: RequestContext): Promise<IdentityInvitationRecord[]> {
    const tenantId = this.requireTenantWideContext(context);
    return this.invitations.list(tenantId);
  }

  async create(context: RequestContext, body: CreateIdentityInvitationBody): Promise<IdentityInvitationIssueResult> {
    const tenantId = this.requireTenantWideContext(context);
    const subjectType = parseSubjectType(body.subjectType);
    const subjectId = body.subjectId?.trim();
    const email = body.email?.trim().toLowerCase();
    if (!subjectId) throw new BadRequestException("SUBJECT_ID_REQUIRED");
    if (!email || !email.includes("@")) throw new BadRequestException("EMAIL_REQUIRED");

    const subject = await this.findSubject(tenantId, subjectType, subjectId);
    if (!subject) throw new NotFoundException("SUBJECT_NOT_FOUND");
    this.assertStudentPortalEligible(subjectType, subject);
    if (subject.userId) throw new BadRequestException("SUBJECT_ALREADY_LINKED");

    // One pending email invitation per subject (IdentityInvitation_one_pending_email_link_key). A live one
    // for the same address is a duplicate request; a new address or an expired link replaces it.
    const pending = await this.findPendingEmailInvitation(tenantId, subjectType, subjectId);
    if (pending && pending.email === email && Date.parse(pending.expiresAt) > Date.now()) {
      throw new BadRequestException("IDENTITY_INVITATION_ALREADY_PENDING");
    }
    if (pending) await this.invitations.revokePendingForSubject(tenantId, subjectType, subjectId, "EMAIL_LINK");

    const token = createActivationToken();
    const expiresAt = nextExpiry();
    const tenantSlug = await this.requireTenantSlug(tenantId);
    let invitation: IdentityInvitationRecord;
    try {
      invitation = await this.invitations.create({
        tenantId,
        subjectType,
        subjectId,
        email,
        name: body.name?.trim() || `${subject.firstName} ${subject.lastName}`,
        role: subjectType,
        tokenHash: hashActivationToken(token),
        expiresAt,
        delivery: createInvitationDelivery(tenantId, tenantSlug, email, token, expiresAt, context.tenantLifecycleVersion),
      });
    } catch (error) {
      // A concurrent request created the pending invitation first.
      if (isUniqueViolation(error)) throw new BadRequestException("IDENTITY_INVITATION_ALREADY_PENDING");
      throw error;
    }
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

  // Automatic invitations from saving a teacher, student or guardian: reuse a live pending invitation for the
  // same address instead of sending another e-mail.
  async ensureEmailInvitation(context: RequestContext, body: CreateIdentityInvitationBody): Promise<IdentityInvitationRecord> {
    try {
      return (await this.create(context, body)).invitation;
    } catch (error) {
      if (!(error instanceof BadRequestException) || error.message !== "IDENTITY_INVITATION_ALREADY_PENDING") throw error;
      const tenantId = this.requireTenantWideContext(context);
      const pending = await this.findPendingEmailInvitation(tenantId, parseSubjectType(body.subjectType), body.subjectId?.trim() ?? "");
      if (!pending) throw error;
      return pending;
    }
  }

  private async findPendingEmailInvitation(
    tenantId: string,
    subjectType: InvitationSubjectType,
    subjectId: string,
  ): Promise<IdentityInvitationRecord | undefined> {
    // ponytail: scans the tenant's invitations like the employee path; add a store lookup if lists grow large.
    return (await this.invitations.list(tenantId)).find((invitation) => (
      invitation.subjectType === subjectType
      && invitation.subjectId === subjectId
      && invitation.kind === "EMAIL_LINK"
      && invitation.status === "PENDING"
    ));
  }

  async createEmployeeInvitation(
    context: RequestContext,
    employeeId: string,
    input: { email: string; role: EmployeeInvitationRole },
  ): Promise<IdentityInvitationIssueResult> {
    const tenantId = this.requireTenantWideContext(context);
    this.assertElevatedEmployeeInvitationAllowed(context, input.role);
    const employee = await this.users.findEmployee(tenantId, employeeId);
    if (!employee) throw new NotFoundException("EMPLOYEE_NOT_FOUND");
    if (employee.status !== "ACTIVE") throw new BadRequestException("EMPLOYEE_INVITATION_REQUIRES_ACTIVE_PROFILE");
    if (employee.userId) throw new BadRequestException("EMPLOYEE_ALREADY_LINKED");
    // UAT F-13: a teacher-backed Employee whose teacher already has an account must not get a second account.
    if ((await this.teachers.findByEmployeeId(tenantId, employee.id))?.userId) {
      throw new BadRequestException("EMPLOYEE_ALREADY_LINKED_VIA_TEACHER");
    }
    const pending = (await this.invitations.list(tenantId)).find((invitation) => (
      invitation.subjectType === "EMPLOYEE" && invitation.subjectId === employeeId && invitation.status === "PENDING"
    ));
    if (pending && Date.parse(pending.expiresAt) > Date.now()) {
      throw new BadRequestException("EMPLOYEE_INVITATION_ALREADY_PENDING");
    }
    if (pending) {
      await this.invitations.revokePendingForSubject(tenantId, "EMPLOYEE", employeeId);
    }

    const email = input.email.trim().toLowerCase();
    const token = createActivationToken();
    const expiresAt = nextExpiry();
    const tenantSlug = await this.requireTenantSlug(tenantId);
    let invitation: IdentityInvitationRecord;
    try {
      invitation = await this.invitations.create({
        tenantId,
        subjectType: "EMPLOYEE",
        subjectId: employee.id,
        email,
        name: `${employee.firstName} ${employee.lastName}`,
        role: input.role,
        tokenHash: hashActivationToken(token),
        expiresAt,
        delivery: createInvitationDelivery(tenantId, tenantSlug, email, token, expiresAt, context.tenantLifecycleVersion),
      });
    } catch (error) {
      if (isEmployeePendingInvitationConflict(error)) {
        throw new BadRequestException("EMPLOYEE_INVITATION_ALREADY_PENDING");
      }
      throw error;
    }
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
  ): void {
    if (role !== "TENANT_OWNER" && role !== "TENANT_ADMIN") return;
    if (role === "TENANT_OWNER" && !hasCapabilityForRoles(context.roles, "owner:manage", context.capabilities)) {
      throw new ForbiddenException("TENANT_OWNER_MANAGE_REQUIRED");
    }
  }

  // UAT F-03: an admin can withdraw a sent invitation (wrong role, wrong address, left before accepting) and
  // issue a new one instead of waiting for the 24-hour expiry. The outbox payload is cleared so an unsent
  // e-mail never carries a dead link; an already delivered link fails with IDENTITY_INVITATION_NOT_PENDING.
  async revoke(context: RequestContext, id: string): Promise<IdentityInvitationRecord> {
    const tenantId = this.requireTenantWideContext(context);
    const existing = await this.invitations.findById(tenantId, id);
    if (!existing) throw new NotFoundException("IDENTITY_INVITATION_NOT_FOUND");
    if (existing.status !== "PENDING") throw new BadRequestException("IDENTITY_INVITATION_NOT_PENDING");
    // An owner invitation is withdrawn under the same capability that could issue it.
    if (existing.subjectType === "EMPLOYEE") this.assertElevatedEmployeeInvitationAllowed(context, existing.role as EmployeeInvitationRole);
    const revoked = await this.invitations.revoke(tenantId, id);
    if (!revoked) throw new BadRequestException("IDENTITY_INVITATION_NOT_PENDING");
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "IdentityInvitation",
      entityId: revoked.id,
      action: "identity_invitation.revoked",
      diff: { subjectType: revoked.subjectType, subjectId: revoked.subjectId, role: revoked.role, kind: revoked.kind },
    });
    return revoked;
  }

  // Returns only the invitation: the replay cache stores this response, and the activation token must
  // never be persisted outside the outbox.
  async resend(context: RequestContext, id: string, idempotencyKey?: string): Promise<IdentityInvitationRecord> {
    const run = async () => (await this.resendOnce(context, id)).invitation;
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "identity-invitation.resend", request: { actorUserId: context.userId, id } },
        run,
      );
    }
    return run();
  }

  private async resendOnce(context: RequestContext, id: string): Promise<IdentityInvitationIssueResult> {
    const tenantId = this.requireTenantWideContext(context);
    const existing = await this.invitations.findById(tenantId, id);
    if (!existing) throw new NotFoundException("IDENTITY_INVITATION_NOT_FOUND");
    if (existing.status !== "PENDING") throw new BadRequestException("IDENTITY_INVITATION_NOT_PENDING");
    if (existing.kind !== "EMAIL_LINK" || !existing.email) throw new BadRequestException("IDENTITY_INVITATION_RESEND_UNSUPPORTED");

    const token = createActivationToken();
    const expiresAt = nextExpiry();
    const tenantSlug = await this.requireTenantSlug(tenantId);
    const invitation = await this.invitations.resend(tenantId, id, {
      tokenHash: hashActivationToken(token),
      expiresAt,
      delivery: createInvitationDelivery(tenantId, tenantSlug, existing.email, token, expiresAt, context.tenantLifecycleVersion),
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
    if (invitation.status !== "PENDING") throw new BadRequestException("IDENTITY_INVITATION_NOT_PENDING");
    if (Date.parse(invitation.expiresAt) <= Date.now()) throw new BadRequestException("IDENTITY_INVITATION_EXPIRED");
    const employeeActivation = invitation.subjectType === "EMPLOYEE" && this.employeeActivations;
    // UAT F-08: every check that can reject a bad request runs before runVerifiedTenantMutation;
    // a 4xx thrown inside it would leave an UNCERTAIN activity row that blocks every later accept/resend.
    const subject = employeeActivation ? undefined : await this.requireAcceptableSubject(invitation);
    // UAT F-16 (KV-3b): an existing account with this e-mail keeps its roles and gains the invited one; a combination
    // the membership model cannot hold (student + anything) is refused here, before the mutation is admitted.
    const existingUser = subject ? await this.users.findTenantUserByEmail(invitation.tenantId, subject.email) : undefined;
    // A subject already linked to another account (e.g. a student who activated with a code meanwhile) is not
    // relinked by an e-mail invitation; refused before the mutation is admitted (UAT F-08 pattern).
    if (subject?.previousUserId && subject.previousUserId !== existingUser?.id) {
      throw new BadRequestException("SUBJECT_ALREADY_LINKED");
    }
    if (existingUser && !canAddTenantRole(existingUser.roles, invitation.role)) {
      throw new BadRequestException("IDENTITY_INVITATION_EMAIL_ACCOUNT_INCOMPATIBLE");
    }
    const roleAdded = !existingUser?.roles.includes(invitation.role);
    const passwordHash = await hashPasswordAsync(password);
    const admission = { tenantId: invitation.tenantId, lifecycleVersion: invitation.tenantLifecycleVersion!, kind: "AUTH_MUTATION" as const, referenceId: `invitation:${invitation.id}`, source: { type: "INVITATION" as const, id: invitation.id, tokenHash: hashActivationToken(token) } };
    if (employeeActivation) {
      // A non-ACCEPTED outcome is a known, committed result, so it is mapped to a 4xx only after the activity settles.
      const outcome = await runVerifiedTenantMutation(admission, async () => {
        const result = await employeeActivation.accept({
          tokenHash: hashActivationToken(token),
          passwordHash,
          name: body.name?.trim(),
          acceptedAt: new Date().toISOString(),
        });
        if (result.status === "ACCEPTED") {
          const accepted = result.invitation;
          await this.auditLogs?.record({
            tenantId: accepted.tenantId,
            actorUserId: accepted.acceptedUserId,
            entityType: "IdentityInvitation",
            entityId: accepted.id,
            action: "identity_invitation.accepted",
            diff: { subjectType: accepted.subjectType, subjectId: accepted.subjectId, userId: accepted.acceptedUserId },
          });
        }
        return result;
      });
      return requireAcceptedEmployeeActivation(outcome);
    }
    // A refusal thrown only after its own writes were undone is a known outcome: the activity row is closed
    // instead of left UNCERTAIN (UAT F-12 pattern). A failing compensation throws something else and stays UNCERTAIN.
    let compensatedRefusal: unknown;
    return runVerifiedTenantMutation(admission, async () => {
    const { email, nationalIdEncrypted, nationalIdHash } = subject!;

    // UAT F-06: user accounts are not capacity-limited; only LicenseTerm.activeStudentLimit is (DEC-20260801-01).
    const user = await this.users.createOrAttachTenantUser({
      tenantId: invitation.tenantId,
      email,
      name: body.name?.trim() || invitation.name,
      nationalIdEncrypted,
      nationalIdHash,
      passwordHash,
      roles: [invitation.role],
    });
    const boundSubject = await this.bindSubject(invitation.tenantId, invitation.subjectType, invitation.subjectId, user.id);
    if (!boundSubject) {
      if (roleAdded) await this.users.removeTenantRole(invitation.tenantId, user.id, invitation.role);
      if (!existingUser) await this.users.deleteUnusedTenantUser(invitation.tenantId, user.id);
      throw (compensatedRefusal = new NotFoundException("SUBJECT_NOT_FOUND"));
    }

    const accepted = await this.invitations.markAccepted(invitation.id, user.id, new Date().toISOString());
    if (!accepted) {
      // The invitation was revoked or expired while this accept was running (UAT F-03 review): undo the
      // link this call made, so the subject is not left bound to an account without the role.
      if (subject!.previousUserId !== user.id) await this.unbindSubject(invitation.tenantId, invitation.subjectType, invitation.subjectId, user.id);
      if (roleAdded) await this.users.removeTenantRole(invitation.tenantId, user.id, invitation.role);
      // An account this accept created (no e-mail match before) is removed again, so a later invitation to the
      // same address creates it with the password chosen then; an existing account's password is never changed.
      if (!existingUser) await this.users.deleteUnusedTenantUser(invitation.tenantId, user.id);
      throw (compensatedRefusal = new BadRequestException("IDENTITY_INVITATION_NOT_PENDING"));
    }
    await this.auditLogs?.record({
      tenantId: invitation.tenantId,
      actorUserId: user.id,
      entityType: "IdentityInvitation",
      entityId: invitation.id,
      action: "identity_invitation.accepted",
      diff: { subjectType: invitation.subjectType, subjectId: invitation.subjectId, userId: user.id },
    });
    if (invitation.subjectType === "TEACHER") await this.linkTeacherEmployee(invitation.tenantId, invitation.subjectId, user.id);
    return accepted;
    }, (error) => error !== undefined && error === compensatedRefusal);
  }

  // UAT F-13: the teacher's Employee row (Teacher.employeeId) gets the same account, so Çalışanlar ve Yetkiler
  // shows it as linked and offers no second account. An Employee already bound to another account is left alone.
  private async linkTeacherEmployee(tenantId: string, teacherId: string, userId: string): Promise<void> {
    const link = await this.teachers.linkEmployeeUser(tenantId, teacherId, userId);
    if (link !== "LINKED" && link !== "CONFLICT") return;
    await this.auditLogs?.record({
      tenantId,
      actorUserId: userId,
      entityType: "Teacher",
      entityId: teacherId,
      action: link === "LINKED" ? "teacher.employee_account_linked" : "teacher.employee_account_link_conflict",
      diff: { teacherId, userId },
    });
  }

  private async requireAcceptableSubject(invitation: IdentityInvitationRecord) {
    if (invitation.kind !== "EMAIL_LINK" || !invitation.email) throw new BadRequestException("IDENTITY_INVITATION_KIND_INVALID");
    const subject = await this.findSubject(invitation.tenantId, invitation.subjectType, invitation.subjectId);
    if (!subject) throw new NotFoundException("SUBJECT_NOT_FOUND");
    this.assertStudentPortalEligible(invitation.subjectType, subject);
    const nationalIdEncrypted = "nationalIdEncrypted" in subject ? subject.nationalIdEncrypted : undefined;
    const nationalIdHash = "nationalIdHash" in subject ? subject.nationalIdHash : undefined;
    // DEC-20261003-01: guardian accounts are invited from StudentContact rows, which never carry a T.C. number.
    // 2026-10-12 (UAT F-08): teacher accounts do not need one either. Guardian and teacher login is
    // tenant code + e-mail/login name; only student portal accounts still require a T.C. number.
    if (invitation.subjectType === "STUDENT" && (!nationalIdEncrypted || !nationalIdHash)) {
      throw new BadRequestException("SUBJECT_NATIONAL_ID_REQUIRED");
    }
    const previousUserId = "userId" in subject && typeof subject.userId === "string" ? subject.userId : undefined;
    return { email: invitation.email, nationalIdEncrypted, nationalIdHash, previousUserId };
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

  private async requireTenantSlug(tenantId: string): Promise<string> {
    const tenant = await this.tenants.findById(tenantId);
    if (!tenant) throw new NotFoundException("TENANT_NOT_FOUND");
    return tenant.slug;
  }

  private async findSubject(tenantId: string, subjectType: InvitationSubjectType, subjectId: string) {
    const subject =
      subjectType === "EMPLOYEE"
        ? await this.users.findEmployee(tenantId, subjectId)
        : subjectType === "STUDENT"
        ? await this.students.findProfileById(subjectId, tenantId)
        : subjectType === "GUARDIAN"
          ? await this.guardians.findById(subjectId, tenantId)
          : await this.teachers.findById(subjectId, tenantId);
    return subject?.tenantId === tenantId ? subject : undefined;
  }

  private bindSubject(tenantId: string, subjectType: InvitationSubjectType, subjectId: string, userId: string) {
    if (subjectType === "EMPLOYEE") return this.users.bindEmployeeUser(tenantId, subjectId, userId);
    if (subjectType === "STUDENT") return this.students.bindUser(tenantId, subjectId, userId);
    if (subjectType === "GUARDIAN") return this.guardians.bindUser(tenantId, subjectId, userId);
    return this.teachers.bindUser(tenantId, subjectId, userId);
  }

  private async unbindSubject(tenantId: string, subjectType: InvitationSubjectType, subjectId: string, userId: string): Promise<void> {
    if (subjectType === "STUDENT") await this.students.unbindUser(tenantId, subjectId, userId);
    else if (subjectType === "GUARDIAN") await this.guardians.unbindUser(tenantId, subjectId, userId);
    else if (subjectType === "TEACHER") await this.teachers.unbindUser(tenantId, subjectId, userId);
    // EMPLOYEE accepts take the EmployeeAccountActivationStore path (row lock) whenever that store is injected,
    // which the module always does; without it an employee subject has no unbind and keeps the link.
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
}

function isEmployeePendingInvitationConflict(error: unknown): boolean {
  if (error instanceof Error && error.message === "EMPLOYEE_INVITATION_ALREADY_PENDING") return true;
  return typeof error === "object" && error !== null && "code" in error && error.code === "23505";
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

function createInvitationDelivery(tenantId: string, tenantSlug: string, email: string, token: string, expiresAt: string, tenantLifecycleVersion?: number): SecretDeliveryOutboxInput {
  const url = createInvitationDeliveryUrl(token, tenantSlug);
  return {
    tenantId, sourceScope: "TENANT", tenantLifecycleVersion,
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

export function createInvitationDeliveryUrl(token: string, tenantSlug?: string): URL {
  const url = tenantSlug
    ? tenantWebUrl("/aktivasyon", tenantSlug)
    : new URL("/aktivasyon", process.env.WEB_URL ?? "http://localhost:3000");
  url.hash = new URLSearchParams({ token }).toString();
  return url;
}

function canAddTenantRole(roles: readonly string[], role: string): boolean {
  try {
    buildTenantMembershipDualWriteRows([...roles, role]);
    return true;
  } catch {
    return false;
  }
}
