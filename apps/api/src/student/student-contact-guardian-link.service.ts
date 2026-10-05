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
import type { StudentContactGuardianLinkResult } from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { GuardianService } from "../guardian/guardian.service.js";
import { IdempotencyService } from "../http/idempotency.js";
import { requireTenantWideStaffContext } from "../tenant/tenant-access.js";
import { type StudentContactStorageRecord, type StudentContactStore, studentContactStoreToken } from "./student-contact-store.js";
import { StudentService } from "./student.service.js";

/**
 * DEC-20261003-01 (KV-3b): the institution admin links a LEGAL_GUARDIAN contact to an EXISTING guardian picked by hand
 * (sibling guardian, or a contact whose email the bulk invite skipped as EMAIL_IN_USE). No automatic matching and no
 * new guardian account here: a guardianId that is not a live guardian of this tenant is a 422. The GuardianStudent link
 * is created with every permission off when missing, in the same transaction as the contact write.
 */
@Injectable()
export class StudentContactGuardianLinkService {
  constructor(
    private readonly students: StudentService,
    private readonly guardians: GuardianService,
    @Inject(studentContactStoreToken) private readonly contacts: StudentContactStore,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  link(
    context: RequestContext,
    studentId: string,
    contactId: string,
    guardianId: string,
    idempotencyKey?: string,
  ): Promise<StudentContactGuardianLinkResult> {
    if (!idempotencyKey?.trim()) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    const run = () => this.linkOnce(context, studentId, contactId, guardianId);
    return this.idempotency
      ? this.idempotency.run(context, { key: idempotencyKey, operation: "student.contact.guardian-link", request: { studentId, contactId, guardianId } }, run)
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

    const write = await this.contacts.linkGuardianWithStudentLink(contact.tenantId, contact.id, guardianId);
    if (!write.linked) {
      const current = await this.contacts.findById(contact.tenantId, contact.id);
      if (!current) throw new NotFoundException("STUDENT_CONTACT_NOT_FOUND");
      if (current.guardianId === guardianId) return unchanged;
      throw new ConflictException("STUDENT_CONTACT_GUARDIAN_ALREADY_LINKED");
    }

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
      diff: { studentId: contact.studentId, guardianId, guardianStudentCreated: write.guardianStudentCreated },
    });
    return { ...unchanged, changed: true, guardianStudentCreated: write.guardianStudentCreated };
  }

  private async unlinkOnce(context: RequestContext, studentId: string, contactId: string): Promise<StudentContactGuardianLinkResult> {
    const contact = await this.findContact(context, studentId, contactId);
    const result = { studentId: contact.studentId, contactId: contact.id, changed: false, guardianStudentCreated: false };
    if (!contact.guardianId) return result;
    if (!await this.contacts.unlinkGuardian(contact.tenantId, contact.id, contact.guardianId)) {
      const current = await this.contacts.findById(contact.tenantId, contact.id);
      if (!current) throw new NotFoundException("STUDENT_CONTACT_NOT_FOUND");
      if (!current.guardianId) return result;
      throw new ConflictException("STUDENT_CONTACT_GUARDIAN_LINK_CONFLICT");
    }
    await this.auditLogs?.record({
      tenantId: contact.tenantId,
      actorUserId: context.userId,
      entityType: "StudentContact",
      entityId: contact.id,
      action: "student_contact.guardian_unlinked",
      diff: { studentId: contact.studentId, guardianId: contact.guardianId },
    });
    return { ...result, changed: true };
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
