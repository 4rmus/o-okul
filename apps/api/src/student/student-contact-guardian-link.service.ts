import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from "@nestjs/common";
import {
  hasCapabilityForRoles,
  type StudentContactGuardianLinkRequest,
  type StudentContactGuardianLinkResult,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { type AuthUserStore, authUserStoreToken } from "../auth/auth-user-store.js";
import { canAttachGuardianRole } from "../auth/tenant-membership-projection.js";
import type { RequestContext } from "../context/request-context.js";
import { GuardianService } from "../guardian/guardian.service.js";
import { IdempotencyService } from "../http/idempotency.js";
import { type GuardianStore, guardianStoreToken } from "../school/guardian-store.js";
import { requireTenantWideStaffContext } from "../tenant/tenant-access.js";
import {
  type StudentContactGuardianLinkWrite,
  type StudentContactStorageRecord,
  type StudentContactStore,
  studentContactStoreToken,
} from "./student-contact-store.js";
import { decryptStudentContactValue } from "./student-contact-pii.js";
import { StudentService } from "./student.service.js";

/**
 * DEC-20261003-01 (KV-3b): the institution admin links a LEGAL_GUARDIAN contact to an EXISTING guardian picked by hand
 * (sibling guardian, or a contact whose email the bulk invite skipped as EMAIL_IN_USE). No automatic matching and no
 * new guardian account here: a guardianId that is not a live guardian of this tenant is a 422. The GuardianStudent link
 * is created with every permission off when missing, in the same transaction as the contact write.
 *
 * Product owner decision (2026-10-05): a person who is both staff/teacher and guardian keeps ONE account. Instead of a
 * guardian the admin may pick an existing user of the tenant (userId); the same transaction then reuses or creates that
 * user's Guardian profile and adds the GUARDIAN role beside the existing memberships (opened as its own persona, no
 * capability merge). Unlinking also closes the access: the GuardianStudent link is removed unless another contact of
 * the same student still points at that guardian. Only LEGAL_GUARDIAN contacts are linked.
 */
@Injectable()
export class StudentContactGuardianLinkService {
  constructor(
    private readonly students: StudentService,
    private readonly guardians: GuardianService,
    @Inject(studentContactStoreToken) private readonly contacts: StudentContactStore,
    @Inject(guardianStoreToken) private readonly guardianStore: GuardianStore,
    @Inject(authUserStoreToken) private readonly users: AuthUserStore,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  link(
    context: RequestContext,
    studentId: string,
    contactId: string,
    target: StudentContactGuardianLinkRequest,
    idempotencyKey?: string,
  ): Promise<StudentContactGuardianLinkResult> {
    if (!idempotencyKey?.trim()) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    const run = () => target.userId !== undefined
      ? this.linkUserOnce(context, studentId, contactId, target.userId)
      : this.linkOnce(context, studentId, contactId, target.guardianId);
    return this.idempotency
      ? this.idempotency.run(context, { key: idempotencyKey, operation: "student.contact.guardian-link", request: { studentId, contactId, ...target } }, run)
      : run();
  }

  unlink(
    context: RequestContext,
    studentId: string,
    contactId: string,
    idempotencyKey?: string,
  ): Promise<StudentContactGuardianLinkResult> {
    if (!idempotencyKey?.trim()) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    const run = () => this.unlinkOnce(context, studentId, contactId);
    return this.idempotency
      ? this.idempotency.run(context, { key: idempotencyKey, operation: "student.contact.guardian-unlink", request: { studentId, contactId } }, run)
      : run();
  }

  private async linkOnce(
    context: RequestContext,
    studentId: string,
    contactId: string,
    guardianId: string,
  ): Promise<StudentContactGuardianLinkResult> {
    const contact = await this.findContact(context, studentId, contactId);
    const unchanged = { studentId: contact.studentId, contactId: contact.id, guardianId, changed: false, guardianStudentCreated: false };
    if (contact.relationType !== "LEGAL_GUARDIAN") throw new UnprocessableEntityException("STUDENT_CONTACT_NOT_LEGAL_GUARDIAN");
    if (contact.guardianId === guardianId) return unchanged;
    if (contact.guardianId) throw new ConflictException("STUDENT_CONTACT_GUARDIAN_ALREADY_LINKED");
    await this.requireGuardian(context, guardianId);

    const write = await linkConflictAs409(this.contacts.linkGuardianWithStudentLink(contact.tenantId, contact.id, guardianId));
    if (!write.linked) {
      const current = await this.contacts.findById(contact.tenantId, contact.id);
      if (!current) throw new NotFoundException("STUDENT_CONTACT_NOT_FOUND");
      if (current.guardianId === guardianId) return unchanged;
      throw new ConflictException("STUDENT_CONTACT_GUARDIAN_ALREADY_LINKED");
    }

    await this.recordLinkAudits(context, contact, guardianId, write, "guardian");
    return { ...unchanged, changed: true, guardianStudentCreated: write.guardianStudentCreated };
  }

  private async linkUserOnce(
    context: RequestContext,
    studentId: string,
    contactId: string,
    userId: string,
  ): Promise<StudentContactGuardianLinkResult> {
    const contact = await this.findContact(context, studentId, contactId);
    if (contact.relationType !== "LEGAL_GUARDIAN") throw new UnprocessableEntityException("STUDENT_CONTACT_NOT_LEGAL_GUARDIAN");
    // Missing, platform (SYSTEM_ADMIN) and other-tenant users answer the same 422 (no cross-tenant existence leak).
    const user = await this.users.findById(userId);
    if (!user || user.tenantId !== contact.tenantId) throw new UnprocessableEntityException("STUDENT_CONTACT_USER_NOT_FOUND");
    if (!canAttachGuardianRole(user)) throw new UnprocessableEntityException("STUDENT_CONTACT_USER_NOT_ELIGIBLE");
    // Adding a role to an owner revokes the owner's sessions: same owner:manage rule as a membership change.
    const isOwner = user.roles.includes("TENANT_OWNER") || user.membership?.staffRole === "TENANT_OWNER";
    if (isOwner && !hasCapabilityForRoles(context.roles, "owner:manage", context.capabilities)) {
      throw new ForbiddenException("TENANT_OWNER_MANAGE_REQUIRED");
    }
    const unchanged = (guardianId: string) => ({
      studentId: contact.studentId, contactId: contact.id, guardianId, changed: false, guardianStudentCreated: false,
      guardianCreated: false, guardianRoleAdded: false,
    });
    const userGuardianId = async () => (await this.guardianStore.findByUserId(contact.tenantId, userId))?.id;
    if (contact.guardianId) {
      if (contact.guardianId === await userGuardianId()) return unchanged(contact.guardianId);
      throw new ConflictException("STUDENT_CONTACT_GUARDIAN_ALREADY_LINKED");
    }

    const write = await linkConflictAs409(this.contacts.linkUserAsGuardianWithStudentLink(contact.tenantId, contact.id, userId));
    if (write.userNotEligible) throw new UnprocessableEntityException("STUDENT_CONTACT_USER_NOT_ELIGIBLE");
    if (!write.linked || !write.guardianId) {
      const current = await this.contacts.findById(contact.tenantId, contact.id);
      if (!current) throw new NotFoundException("STUDENT_CONTACT_NOT_FOUND");
      if (current.guardianId && current.guardianId === await userGuardianId()) return unchanged(current.guardianId);
      throw new ConflictException("STUDENT_CONTACT_GUARDIAN_ALREADY_LINKED");
    }

    if (write.guardianCreated) {
      await this.auditLogs?.record({
        tenantId: contact.tenantId,
        actorUserId: context.userId,
        entityType: "Guardian",
        entityId: write.guardianId,
        action: "guardian.created",
        diff: { source: "student_contact.guardian_linked", userBound: true },
      });
    }
    if (write.guardianRoleAdded) {
      await this.auditLogs?.record({
        tenantId: contact.tenantId,
        actorUserId: context.userId,
        entityType: "User",
        entityId: userId,
        action: "user.guardian_role_added",
        diff: { role: "GUARDIAN", guardianId: write.guardianId, existingRolesKept: true, sessionsRevoked: write.sessionsRevoked },
      });
    }
    await this.recordLinkAudits(context, contact, write.guardianId, write, "user");
    // Same contact-phone rule as the bulk invite (empty Guardian.phone only, never a login name, no phone matching).
    await this.guardians.fillEmptyPhone(context, write.guardianId, contact.phoneEncrypted && decryptStudentContactValue(contact.phoneEncrypted));
    return {
      ...unchanged(write.guardianId),
      changed: true,
      guardianStudentCreated: write.guardianStudentCreated,
      guardianCreated: write.guardianCreated,
      guardianRoleAdded: write.guardianRoleAdded,
    };
  }

  private async recordLinkAudits(
    context: RequestContext,
    contact: StudentContactStorageRecord,
    guardianId: string,
    write: StudentContactGuardianLinkWrite,
    source: "guardian" | "user",
  ): Promise<void> {
    if (write.guardianStudentCreated && write.guardianStudentId) {
      await this.auditLogs?.record({
        tenantId: contact.tenantId,
        actorUserId: context.userId,
        entityType: "GuardianStudent",
        entityId: write.guardianStudentId,
        action: "guardian_student.linked",
        diff: { guardianId, studentId: contact.studentId, fieldsSet: [], source: "student_contact.guardian_linked" },
      });
    }
    await this.auditLogs?.record({
      tenantId: contact.tenantId,
      actorUserId: context.userId,
      entityType: "StudentContact",
      entityId: contact.id,
      action: "student_contact.guardian_linked",
      diff: { studentId: contact.studentId, guardianId, guardianStudentCreated: write.guardianStudentCreated, target: source },
    });
  }

  private async unlinkOnce(context: RequestContext, studentId: string, contactId: string): Promise<StudentContactGuardianLinkResult> {
    const contact = await this.findContact(context, studentId, contactId);
    const result = { studentId: contact.studentId, contactId: contact.id, changed: false, guardianStudentCreated: false, guardianStudentRemoved: false };
    if (!contact.guardianId) return result;
    const guardianId = contact.guardianId;
    const write = await this.contacts.unlinkGuardian(contact.tenantId, contact.id, guardianId);
    if (!write.unlinked) {
      const current = await this.contacts.findById(contact.tenantId, contact.id);
      if (!current) throw new NotFoundException("STUDENT_CONTACT_NOT_FOUND");
      if (!current.guardianId) return result;
      throw new ConflictException("STUDENT_CONTACT_GUARDIAN_LINK_CONFLICT");
    }
    if (write.guardianStudentRemoved) {
      await this.auditLogs?.record({
        tenantId: contact.tenantId,
        actorUserId: context.userId,
        entityType: "GuardianStudent",
        entityId: `${guardianId}:${contact.studentId}`,
        action: "guardian_student.unlinked",
        diff: { guardianId, studentId: contact.studentId, source: "student_contact.guardian_unlinked" },
      });
    }
    await this.auditLogs?.record({
      tenantId: contact.tenantId,
      actorUserId: context.userId,
      entityType: "StudentContact",
      entityId: contact.id,
      action: "student_contact.guardian_unlinked",
      diff: { studentId: contact.studentId, guardianId, guardianStudentRemoved: write.guardianStudentRemoved },
    });
    await this.guardians.recordGuardianRoleRemoved(context, contact.tenantId, guardianId, { sessionsRevoked: 0, ...write });
    return { ...result, changed: true, guardianStudentRemoved: write.guardianStudentRemoved };
  }

  private async findContact(context: RequestContext, studentId: string, contactId: string): Promise<StudentContactStorageRecord> {
    try {
      requireTenantWideStaffContext(context, "EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
    } catch (error) {
      throw new ForbiddenException(error instanceof Error ? error.message : "EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
    }
    const student = await this.students.findOne(context, studentId);
    const contact = await this.contacts.findById(student.tenantId, contactId);
    if (!contact || contact.studentId !== student.id) throw new NotFoundException("STUDENT_CONTACT_NOT_FOUND");
    return contact;
  }

  /** Missing, soft-deleted and other-tenant guardians all answer the same 422 (no cross-tenant existence leak). */
  private async requireGuardian(context: RequestContext, guardianId: string): Promise<void> {
    try {
      await this.guardians.findGuardian(context, guardianId);
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof ForbiddenException) {
        throw new UnprocessableEntityException("STUDENT_CONTACT_GUARDIAN_NOT_FOUND");
      }
      throw error;
    }
  }
}

/** The store reports a lost link/unlink race (or a Guardian.userId unique clash) as this code; answer 409, not 500. */
async function linkConflictAs409<T>(write: Promise<T>): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (error instanceof Error && error.message === "STUDENT_CONTACT_GUARDIAN_LINK_CONFLICT") throw new ConflictException(error.message);
    throw error;
  }
}
