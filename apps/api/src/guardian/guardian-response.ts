import type { GuardianRecord } from "@o-okul/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { maskContactPhone } from "../privacy/contact-mask.js";
import { hasCapability } from "../rbac/role-capabilities.js";

export function toGuardianResponse(record: GuardianRecord, context: RequestContext): GuardianRecord {
  const response = { ...record } as GuardianRecord & { nationalIdEncrypted?: string; nationalIdHash?: string; createdByUserId?: string };
  delete response.nationalIdEncrypted;
  delete response.nationalIdHash;
  delete response.createdByUserId;
  if (record.phone) {
    response.phoneMasked = maskContactPhone(record.phone);
  }
  if (!hasCapability(context, "privacy:manage")) {
    delete response.phone;
  }
  return response;
}
