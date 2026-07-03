import { z } from "zod";
import { optionalIsoDateTime, optionalTrimmedString, optionalUppercaseString, requiredTrimmedString, requiredUppercaseString } from "../http/zod-validation.js";

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
const optionalTenantLicenseStartsAtSchema = z.preprocess((value) => value === "" ? undefined : value, optionalIsoDateTime("TENANT_LICENSE_START_INVALID"));
const optionalTenantLicenseEndsAtSchema = z.preprocess((value) => value === "" ? undefined : value, optionalIsoDateTime("TENANT_LICENSE_END_INVALID"));
const positiveIntegerSchema = z.number().int().positive();

const tenantFirstAdminBodySchema = z.object({
  email: tenantEmailSchema,
  name: requiredUppercaseString,
  nationalId: requiredTrimmedString,
  phone: requiredTrimmedString,
}).strict();

const tenantAdminWritableFields = {
  contactEmail: optionalTenantEmailSchema,
  firstAdmin: tenantFirstAdminBodySchema.optional(),
  id: optionalTrimmedString,
  institutionType: optionalTrimmedString,
  licenseEndsAt: optionalTenantLicenseEndsAtSchema,
  licenseStartsAt: optionalTenantLicenseStartsAtSchema,
  logoUrl: optionalTenantUrlSchema,
  name: optionalUppercaseString,
  plan: optionalTrimmedString,
  seatLimit: positiveIntegerSchema.optional(),
  slug: optionalTrimmedString,
  status: optionalTrimmedString,
};

const tenantAdminUpdateWritableFields = {
  contactEmail: optionalTenantEmailSchema,
  institutionType: optionalTrimmedString,
  licenseEndsAt: optionalTenantLicenseEndsAtSchema,
  licenseStartsAt: optionalTenantLicenseStartsAtSchema,
  logoUrl: optionalTenantUrlSchema,
  name: optionalUppercaseString,
  plan: optionalTrimmedString,
  seatLimit: positiveIntegerSchema.optional(),
  slug: optionalTrimmedString,
  status: optionalTrimmedString,
};

export const tenantCreateBodySchema = z.object({
  ...tenantAdminWritableFields,
  name: requiredUppercaseString,
  slug: requiredTrimmedString,
}).strict();

export const tenantUpdateBodySchema = z.object(tenantAdminUpdateWritableFields).strict();

export const tenantCurrentProfileBodySchema = z.object({
  contactEmail: optionalTenantEmailSchema,
  institutionType: optionalTrimmedString,
  logoUrl: optionalTenantUrlSchema,
  name: optionalUppercaseString,
}).strict();

export type TenantCreateBody = z.infer<typeof tenantCreateBodySchema>;
export type TenantUpdateBody = z.infer<typeof tenantUpdateBodySchema>;
export type TenantCurrentProfileBody = z.infer<typeof tenantCurrentProfileBodySchema>;
