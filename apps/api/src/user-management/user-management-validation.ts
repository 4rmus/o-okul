import { z } from "zod";
import { tenantAssignableRoles, type EmployeeAccountInvitationRequest, type EmployeeCreateRequest, type TenantMembershipUpdateRequest } from "@o-okul/shared-types";
import { optionalUppercaseString, requiredTrimmedString } from "../http/zod-validation.js";

const tenantUserRoleSchema = z.enum(tenantAssignableRoles);

export const tenantUserRolesBodySchema = z.object({
  roles: z.array(tenantUserRoleSchema).min(1),
}).strict();

export type TenantUserRolesBody = z.infer<typeof tenantUserRolesBodySchema>;

const employeeStaffRoleSchema = z.enum(["TENANT_OWNER", "TENANT_ADMIN", "OPERATIONS_STAFF", "FINANCE_STAFF"]);

export const employeeCreateBodySchema = z.object({
  employeeNo: optionalUppercaseString,
  firstName: requiredTrimmedString.max(100),
  lastName: requiredTrimmedString.max(100),
  workEmail: z.string().trim().email().max(254).optional(),
  phone: z.string().trim().min(7).max(30).optional(),
  employmentStartsAt: z.string().date().optional(),
  status: z.enum(["PLANNED", "ACTIVE"]),
}).strict() satisfies z.ZodType<EmployeeCreateRequest>;

export const employeeAccountInvitationBodySchema = z.object({
  email: z.string().trim().email().max(254),
  role: employeeStaffRoleSchema,
}).strict() satisfies z.ZodType<EmployeeAccountInvitationRequest>;

export type EmployeeCreateBody = z.infer<typeof employeeCreateBodySchema>;
export type EmployeeAccountInvitationBody = z.infer<typeof employeeAccountInvitationBodySchema>;

export const tenantMembershipUpdateBodySchema = z.object({
  campusIds: z.array(z.string().trim().min(1)).max(20),
  endedReason: z.string().trim().min(1).max(500).optional(),
  expectedVersion: z.number().int().min(1),
  hasTeacherPersona: z.boolean(),
  scopeMode: z.enum(["TENANT", "CAMPUSES"]),
  staffRole: employeeStaffRoleSchema.optional(),
  status: z.enum(["ACTIVE", "SUSPENDED", "ENDED"]),
}).strict().superRefine((input, context) => {
  if (!input.staffRole && !input.hasTeacherPersona) {
    context.addIssue({ code: "custom", message: "MEMBERSHIP_PERSONA_REQUIRED", path: ["hasTeacherPersona"] });
  }
  if (new Set(input.campusIds).size !== input.campusIds.length) {
    context.addIssue({ code: "custom", message: "MEMBERSHIP_CAMPUS_DUPLICATE", path: ["campusIds"] });
  }
  if (input.scopeMode === "TENANT" && input.campusIds.length > 0) {
    context.addIssue({ code: "custom", message: "MEMBERSHIP_TENANT_SCOPE_MUST_NOT_HAVE_CAMPUSES", path: ["campusIds"] });
  }
  if (input.scopeMode === "CAMPUSES" && input.campusIds.length === 0) {
    context.addIssue({ code: "custom", message: "MEMBERSHIP_CAMPUS_SCOPE_REQUIRED", path: ["campusIds"] });
  }
  if (input.status === "ENDED" && !input.endedReason) {
    context.addIssue({ code: "custom", message: "MEMBERSHIP_ENDED_REASON_REQUIRED", path: ["endedReason"] });
  }
  if (input.status !== "ENDED" && input.endedReason) {
    context.addIssue({ code: "custom", message: "MEMBERSHIP_ENDED_REASON_FORBIDDEN", path: ["endedReason"] });
  }
}) satisfies z.ZodType<TenantMembershipUpdateRequest>;

export type TenantMembershipUpdateBody = z.infer<typeof tenantMembershipUpdateBodySchema>;
