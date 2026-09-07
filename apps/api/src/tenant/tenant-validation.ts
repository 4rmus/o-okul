import { z } from "zod";
import { licenseTermCreateBodySchema } from "../license/license-validation.js";
import { optionalTrimmedString, optionalUppercaseString, requiredTrimmedString, requiredUppercaseString } from "../http/zod-validation.js";

const tenantEmailSchema = requiredTrimmedString.refine((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value), {
  message: "TENANT_EMAIL_INVALID",
});
const optionalTenantEmailSchema = tenantEmailSchema.optional();
const tenantUrlSchema = requiredTrimmedString.refine((value) => {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}, { message: "TENANT_URL_INVALID" });
const optionalTenantUrlSchema = tenantUrlSchema.optional();
const tenantAccessStatusSchema = z.enum(["ACTIVE", "SUSPENDED"]);

const tenantFirstOwnerBodySchema = z.object({
  email: tenantEmailSchema,
  name: requiredUppercaseString,
  nationalId: z.string().trim().regex(/^\d{11}$/, "TENANT_FIRST_OWNER_NATIONAL_ID_INVALID").optional(),
}).strict();

const tenantCampusCreateBodySchema = z.object({
  code: optionalTrimmedString,
  name: requiredUppercaseString,
  unitType: z.enum(["SCHOOL", "COURSE", "MIXED"]).optional(),
}).strict();

const tenantCreateWritableFields = {
  contactEmail: optionalTenantEmailSchema,
  campuses: z.array(tenantCampusCreateBodySchema).min(1),
  firstOwner: tenantFirstOwnerBodySchema,
  institutionType: optionalTrimmedString,
  logoUrl: optionalTenantUrlSchema,
  licenseTerm: licenseTermCreateBodySchema,
  name: optionalUppercaseString,
  slug: optionalTrimmedString,
};

const tenantAdminUpdateWritableFields = {
  contactEmail: optionalTenantEmailSchema,
  institutionType: optionalTrimmedString,
  logoUrl: optionalTenantUrlSchema,
  name: optionalUppercaseString,
};

export const tenantCreateBodySchema = z.object({
  ...tenantCreateWritableFields,
  name: requiredUppercaseString,
  slug: requiredTrimmedString,
}).strict();

export const tenantUpdateBodySchema = z.object(tenantAdminUpdateWritableFields).strict();

export const tenantStatusUpdateBodySchema = z.object({
  status: tenantAccessStatusSchema,
  expectedLifecycleVersion: z.number().int().min(0).max(2147483646),
  reason: z.enum(["SECURITY_REVIEW", "INSTITUTION_REQUEST", "OPERATIONS_REVIEW"]),
  confirmationText: z.string().min(1).max(128),
}).strict();

export const tenantCurrentProfileBodySchema = z.object({
  contactEmail: optionalTenantEmailSchema,
  institutionType: optionalTrimmedString,
  logoUrl: optionalTenantUrlSchema,
  name: optionalUppercaseString,
}).strict();

export type TenantCreateBody = z.infer<typeof tenantCreateBodySchema>;
export type TenantUpdateBody = z.infer<typeof tenantUpdateBodySchema>;
export type TenantStatusUpdateBody = z.infer<typeof tenantStatusUpdateBodySchema>;
export type TenantCurrentProfileBody = z.infer<typeof tenantCurrentProfileBodySchema>;
