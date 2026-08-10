import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  StudentContactCreateRequest,
  StudentContactRecord,
  StudentContactUpdateRequest,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { normalizeTurkishMobilePhone } from "../auth/phone-normalize.js";
import type { RequestContext } from "../context/request-context.js";
import { FeatureRolloutService } from "../feature-rollout/feature-rollout.service.js";
import { IdempotencyService } from "../http/idempotency.js";
import { maskContactEmail, maskContactPhone } from "../privacy/contact-mask.js";
import { hasCapability } from "../rbac/role-capabilities.js";
import {
  decryptStudentContactValue,
  encryptStudentContactValue,
  hashStudentContactValue,
} from "./student-contact-pii.js";
import { buildStudentContactStorageInput } from "./student-contact-input.js";
import {
  type StudentContactStorageRecord,
  type StudentContactStore,
  type StudentContactStoreInput,
  studentContactStoreToken,
} from "./student-contact-store.js";
import { StudentService } from "./student.service.js";

@Injectable()
export class StudentContactService {
  constructor(
    private readonly students: StudentService,
    @Inject(studentContactStoreToken) private readonly store: StudentContactStore,
    private readonly featureRollouts: FeatureRolloutService,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async list(context: RequestContext, studentId: string): Promise<StudentContactRecord[]> {
    await this.featureRollouts.assertEnabled(context, "web.student-registry-v2");
    this.assertCanRead(context, studentId);
    await this.students.findOneForViewer(context, studentId);
    const tenantId = this.requireTenantId(context);
    return (await this.store.listByStudent(tenantId, studentId)).map(toStudentContactRecord);
  }

  async create(
    context: RequestContext,
    studentId: string,
    input: StudentContactCreateRequest,
    idempotencyKey?: string,
  ): Promise<StudentContactRecord> {
    if (!idempotencyKey) throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    if (this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "student.contact.create", request: { studentId, ...input } },
        () => this.createOnce(context, studentId, input),
      );
    }
    return this.createOnce(context, studentId, input);
  }

  private async createOnce(
    context: RequestContext,
    studentId: string,
    input: StudentContactCreateRequest,
  ): Promise<StudentContactRecord> {
    await this.featureRollouts.assertEnabled(context, "web.student-registry-v2");
    const student = await this.students.findOne(context, studentId);
    const record = await this.store.create(buildStudentContactStorageInput(student.tenantId, student.id, input));
    await this.recordMutation(context, record, "student_contact.created");
    return toStudentContactRecord(record);
  }

  private assertCanRead(context: RequestContext, studentId: string): void {
    if (hasCapability(context, "privacy:manage")) return;
    if (context.subjectType === "STUDENT" && context.subjectId === studentId) return;
    throw new ForbiddenException("STUDENT_CONTACT_READ_FORBIDDEN");
  }

  async update(
    context: RequestContext,
    studentId: string,
    id: string,
    input: StudentContactUpdateRequest,
  ): Promise<StudentContactRecord> {
    await this.featureRollouts.assertEnabled(context, "web.student-registry-v2");
    const student = await this.students.findOne(context, studentId);
    const existing = await this.store.findById(student.tenantId, id);
    if (!existing || existing.studentId !== student.id) throw new NotFoundException("STUDENT_CONTACT_NOT_FOUND");
    const merged = mergeStorageInput(existing, input);
    const updated = await this.store.update(id, merged);
    if (!updated) throw new NotFoundException("STUDENT_CONTACT_NOT_FOUND");
    await this.recordMutation(context, updated, "student_contact.updated");
    return toStudentContactRecord(updated);
  }

  async delete(context: RequestContext, studentId: string, id: string): Promise<void> {
    await this.featureRollouts.assertEnabled(context, "web.student-registry-v2");
    const student = await this.students.findOne(context, studentId);
    const existing = await this.store.findById(student.tenantId, id);
    if (!existing || existing.studentId !== student.id) throw new NotFoundException("STUDENT_CONTACT_NOT_FOUND");
    if (!await this.store.softDelete(student.tenantId, id)) throw new NotFoundException("STUDENT_CONTACT_NOT_FOUND");
    await this.recordMutation(context, existing, "student_contact.deleted");
  }

  private requireTenantId(context: RequestContext): string {
    if (!context.tenantId || context.bypassRls) throw new ForbiddenException("TENANT_CONTEXT_REQUIRED");
    return context.tenantId;
  }

  private async recordMutation(
    context: RequestContext,
    record: StudentContactStorageRecord,
    action: string,
  ): Promise<void> {
    await this.auditLogs?.record({
      tenantId: record.tenantId,
      actorUserId: context.userId,
      entityType: "StudentContact",
      entityId: record.id,
      action,
      diff: {
        studentId: record.studentId,
        relationType: record.relationType,
        hasPhone: Boolean(record.phoneEncrypted),
        hasEmail: Boolean(record.emailEncrypted),
        canReceiveSms: record.canReceiveSms,
        canReceiveAnnouncements: record.canReceiveAnnouncements,
        canReceiveFinance: record.canReceiveFinance,
      },
    });
  }
}

function mergeStorageInput(
  existing: StudentContactStorageRecord,
  input: StudentContactUpdateRequest,
): StudentContactStoreInput {
  const phone = input.phone === undefined ? undefined : normalizePhone(input.phone);
  const email = input.email === undefined ? undefined : normalizeEmail(input.email);
  const permissions = {
    canReceiveSms: input.canReceiveSms ?? existing.canReceiveSms,
    canReceiveAnnouncements: input.canReceiveAnnouncements ?? existing.canReceiveAnnouncements,
    canReceiveFinance: input.canReceiveFinance ?? existing.canReceiveFinance,
  };
  const consentSource = input.consentSource === undefined ? existing.consentSource : optionalText(input.consentSource);
  const consentRecordedAt = input.consentRecordedAt === undefined ? existing.consentRecordedAt : optionalDateTime(input.consentRecordedAt);
  assertConsent(permissions, consentSource, consentRecordedAt);
  return {
    tenantId: existing.tenantId,
    studentId: existing.studentId,
    firstName: input.firstName === undefined ? existing.firstName : requireText(input.firstName, "STUDENT_CONTACT_FIRST_NAME_REQUIRED"),
    lastName: input.lastName === undefined ? existing.lastName : requireText(input.lastName, "STUDENT_CONTACT_LAST_NAME_REQUIRED"),
    relationType: input.relationType ?? existing.relationType,
    phoneEncrypted: input.phone === undefined ? existing.phoneEncrypted : (phone ? encryptStudentContactValue(phone) : undefined),
    phoneHash: input.phone === undefined ? existing.phoneHash : (phone ? hashStudentContactValue("phone", phone) : undefined),
    emailEncrypted: input.email === undefined ? existing.emailEncrypted : (email ? encryptStudentContactValue(email) : undefined),
    emailHash: input.email === undefined ? existing.emailHash : (email ? hashStudentContactValue("email", email) : undefined),
    ...permissions,
    consentSource,
    consentRecordedAt,
  };
}

function toStudentContactRecord(record: StudentContactStorageRecord): StudentContactRecord {
  const phone = record.phoneEncrypted ? decryptStudentContactValue(record.phoneEncrypted) : undefined;
  const email = record.emailEncrypted ? decryptStudentContactValue(record.emailEncrypted) : undefined;
  return {
    id: record.id,
    tenantId: record.tenantId,
    studentId: record.studentId,
    firstName: record.firstName,
    lastName: record.lastName,
    relationType: record.relationType,
    phoneMasked: phone ? maskContactPhone(phone) : undefined,
    emailMasked: email ? maskContactEmail(email) : undefined,
    canReceiveSms: record.canReceiveSms,
    canReceiveAnnouncements: record.canReceiveAnnouncements,
    canReceiveFinance: record.canReceiveFinance,
    consentSource: record.consentSource,
    consentRecordedAt: record.consentRecordedAt,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function assertConsent(
  permissions: { canReceiveSms: boolean; canReceiveAnnouncements: boolean; canReceiveFinance: boolean },
  source: string | undefined,
  recordedAt: string | undefined,
): void {
  if ((permissions.canReceiveSms || permissions.canReceiveAnnouncements || permissions.canReceiveFinance) && (!optionalText(source) || !optionalDateTime(recordedAt))) {
    throw new BadRequestException("STUDENT_CONTACT_CONSENT_REQUIRED");
  }
}

function normalizePhone(value: string | undefined): string | undefined {
  const trimmed = optionalText(value);
  return trimmed ? normalizeTurkishMobilePhone(trimmed, "STUDENT_CONTACT_PHONE_INVALID") : undefined;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const trimmed = optionalText(value)?.toLowerCase();
  if (trimmed && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) throw new BadRequestException("STUDENT_CONTACT_EMAIL_INVALID");
  return trimmed;
}

function optionalDateTime(value: string | undefined): string | undefined {
  const trimmed = optionalText(value);
  if (!trimmed) return undefined;
  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) throw new BadRequestException("STUDENT_CONTACT_CONSENT_DATE_INVALID");
  return new Date(timestamp).toISOString();
}

function requireText(value: string, errorCode: string): string {
  const trimmed = optionalText(value);
  if (!trimmed) throw new BadRequestException(errorCode);
  return trimmed;
}

function optionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
