import { BadRequestException } from "@nestjs/common";
import type { StudentContactCreateRequest } from "@o-okul/shared-types";
import { normalizeTurkishMobilePhone } from "../auth/phone-normalize.js";
import {
  encryptStudentContactValue,
  hashStudentContactValue,
} from "./student-contact-pii.js";
import type { StudentContactStoreInput } from "./student-contact-store.js";

export function buildStudentContactStorageInput(
  tenantId: string,
  studentId: string,
  input: StudentContactCreateRequest,
): StudentContactStoreInput {
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const permissions = {
    canReceiveSms: input.canReceiveSms ?? false,
    canReceiveAnnouncements: input.canReceiveAnnouncements ?? false,
    canReceiveFinance: input.canReceiveFinance ?? false,
  };
  const consentSource = optionalText(input.consentSource);
  const consentRecordedAt = optionalDateTime(input.consentRecordedAt);
  if ((permissions.canReceiveSms || permissions.canReceiveAnnouncements || permissions.canReceiveFinance)
    && (!consentSource || !consentRecordedAt)) {
    throw new BadRequestException("STUDENT_CONTACT_CONSENT_REQUIRED");
  }
  return {
    tenantId,
    studentId,
    firstName: requireText(input.firstName, "STUDENT_CONTACT_FIRST_NAME_REQUIRED"),
    lastName: requireText(input.lastName, "STUDENT_CONTACT_LAST_NAME_REQUIRED"),
    relationType: input.relationType,
    ...(phone ? { phoneEncrypted: encryptStudentContactValue(phone), phoneHash: hashStudentContactValue("phone", phone) } : {}),
    ...(email ? { emailEncrypted: encryptStudentContactValue(email), emailHash: hashStudentContactValue("email", email) } : {}),
    ...permissions,
    consentSource,
    consentRecordedAt,
  };
}

function normalizePhone(value: string | undefined): string | undefined {
  const trimmed = optionalText(value);
  return trimmed ? normalizeTurkishMobilePhone(trimmed, "STUDENT_CONTACT_PHONE_INVALID") : undefined;
}

function normalizeEmail(value: string | undefined): string | undefined {
  const trimmed = optionalText(value)?.toLowerCase();
  if (trimmed && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(trimmed)) {
    throw new BadRequestException("STUDENT_CONTACT_EMAIL_INVALID");
  }
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
