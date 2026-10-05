import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  StudentGuardianInvitationBulkRequest,
  StudentGuardianInvitationBulkResult,
  StudentGuardianInvitationRowResult,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { GuardianService } from "../guardian/guardian.service.js";
import { IdempotencyService } from "../http/idempotency.js";
import { IdentityInvitationService } from "../identity-invitation/identity-invitation.service.js";
import { requireTenantWideStaffContext } from "../tenant/tenant-access.js";
import { type UserManagementStore, userManagementStoreToken } from "../user-management/user-management-store.js";
import { decryptStudentContactValue } from "./student-contact-pii.js";
import { type StudentContactStorageRecord, type StudentContactStore, studentContactStoreToken } from "./student-contact-store.js";
import { StudentService } from "./student.service.js";

/**
 * DEC-20261003-01 (KV-3): the institution admin invites guardians in bulk from the selected students'
 * LEGAL_GUARDIAN contacts. A contact already linked to a guardian account is never invited twice; the
 * account login stays tenant code + email login name (never T.C. or phone); the contact phone is copied to an
 * empty Guardian.phone as a contact field only. Contact consent fields and
 * GuardianStudent permissions are left untouched (link permissions default to false).
 */
@Injectable()
export class StudentGuardianInvitationService {
  constructor(
    private readonly students: StudentService,
    private readonly guardians: GuardianService,
    private readonly invitations: IdentityInvitationService,
    @Inject(studentContactStoreToken) private readonly contacts: StudentContactStore,
    @Inject(userManagementStoreToken) private readonly users: UserManagementStore,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async inviteBulk(
    context: RequestContext,
    input: StudentGuardianInvitationBulkRequest,
    idempotencyKey?: string,
  ): Promise<StudentGuardianInvitationBulkResult> {
    if (!idempotencyKey?.trim()) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    if (!this.idempotency) return this.inviteBulkOnce(context, input);
    return this.idempotency.run(
      context,
      { key: idempotencyKey, operation: "student.guardian-invitation.bulk", request: input },
      () => this.inviteBulkOnce(context, input),
    );
  }

  private async inviteBulkOnce(
    context: RequestContext,
    input: StudentGuardianInvitationBulkRequest,
  ): Promise<StudentGuardianInvitationBulkResult> {
    let tenantId: string;
    try {
      tenantId = requireTenantWideStaffContext(context, "EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
    } catch (error) {
      throw new ForbiddenException(error instanceof Error ? error.message : "EMPLOYEE_TENANT_WIDE_SCOPE_REQUIRED");
    }
    const studentIds = [...new Set(input.studentIds)];
    if (studentIds.length === 0) throw new BadRequestException("STUDENT_GUARDIAN_INVITATION_STUDENTS_REQUIRED");
    // Validate every student (tenant + scope) before the first write.
    const students = await Promise.all(studentIds.map((id) => this.students.findOne(context, id)));

    // ponytail: no automatic guardian matching (DEC-20261003-01); an email that already belongs to a user or a
    // pending invitation is skipped and the admin links that contact by hand.
    const pending = (await this.invitations.list(context)).filter((invitation) => invitation.status === "PENDING");
    const emailsInUse = new Set<string>([
      ...(await this.users.listTenantUsers(tenantId)).map((user) => user.email?.trim().toLowerCase()),
      ...pending.map((invitation) => invitation.email?.trim().toLowerCase()),
    ].filter((email): email is string => Boolean(email)));
    const pendingGuardianIds = new Set(pending
      .filter((invitation) => invitation.subjectType === "GUARDIAN")
      .map((invitation) => invitation.subjectId));

    const results: StudentGuardianInvitationRowResult[] = [];
    for (const student of students) {
      const legalGuardians = (await this.contacts.listByStudent(tenantId, student.id))
        .filter((contact) => contact.relationType === "LEGAL_GUARDIAN");
      if (legalGuardians.length === 0) {
        results.push({ studentId: student.id, status: "SKIPPED", reason: "NO_LEGAL_GUARDIAN_CONTACT" });
        continue;
      }
      for (const contact of legalGuardians) {
        results.push(await this.inviteContact(context, contact, emailsInUse, pendingGuardianIds));
      }
    }

    return {
      createdCount: results.filter((row) => row.status === "CREATED").length,
      alreadyExistsCount: results.filter((row) => row.status === "ALREADY_EXISTS").length,
      skippedCount: results.filter((row) => row.status === "SKIPPED").length,
      results,
    };
  }

  private async inviteContact(
    context: RequestContext,
    contact: StudentContactStorageRecord,
    emailsInUse: Set<string>,
    pendingGuardianIds: Set<string>,
  ): Promise<StudentGuardianInvitationRowResult> {
    const row = { studentId: contact.studentId, contactId: contact.id };
    if (contact.guardianId && await this.hasAccountOrPendingInvitation(context, contact.guardianId, pendingGuardianIds)) {
      return { ...row, status: "ALREADY_EXISTS", guardianId: contact.guardianId };
    }

    const email = contact.emailEncrypted ? decryptStudentContactValue(contact.emailEncrypted).trim().toLowerCase() : "";
    if (!email) return { ...row, status: "SKIPPED", reason: "EMAIL_MISSING" };
    if (emailsInUse.has(email)) return { ...row, status: "SKIPPED", reason: "EMAIL_IN_USE" };

    // A linked guardian without account or pending invitation (e.g. revoked, or an earlier run stopped
    // after linking) only gets the missing invitation.
    let guardianId = contact.guardianId;
    if (!guardianId) {
      const guardian = await this.guardians.createGuardian(context, { firstName: contact.firstName, lastName: contact.lastName });
      await this.guardians.linkGuardianStudent(context, guardian.id, contact.studentId);
      // ponytail: separate store writes; a concurrent run with another key can leave an unlinked guardian
      // without account or invitation. Move to one transaction if that shows up in audit.
      if (!await this.contacts.linkGuardian(contact.tenantId, contact.id, guardian.id)) {
        throw new ConflictException("STUDENT_CONTACT_GUARDIAN_LINK_CONFLICT");
      }
      guardianId = guardian.id;
    }
    await this.guardians.fillEmptyPhone(context, guardianId, contact.phoneEncrypted && decryptStudentContactValue(contact.phoneEncrypted));

    const issued = await this.invitations.create(context, {
      subjectType: "GUARDIAN",
      subjectId: guardianId,
      email,
      name: `${contact.firstName} ${contact.lastName}`.trim(),
    });
    emailsInUse.add(email);
    pendingGuardianIds.add(guardianId);
    await this.auditLogs?.record({
      tenantId: contact.tenantId,
      actorUserId: context.userId,
      entityType: "StudentContact",
      entityId: contact.id,
      action: "student_contact.guardian_invited",
      diff: { studentId: contact.studentId, guardianId, invitationId: issued.invitation.id, guardianCreated: !contact.guardianId },
    });
    return { ...row, status: "CREATED", guardianId, invitationId: issued.invitation.id };
  }

  private async hasAccountOrPendingInvitation(
    context: RequestContext,
    guardianId: string,
    pendingGuardianIds: Set<string>,
  ): Promise<boolean> {
    if (pendingGuardianIds.has(guardianId)) return true;
    try {
      return Boolean((await this.guardians.findGuardian(context, guardianId)).userId);
    } catch (error) {
      // A soft-deleted guardian still holds the link; the admin resolves it, the bulk run never re-creates it.
      if (error instanceof NotFoundException) return true;
      throw error;
    }
  }
}
