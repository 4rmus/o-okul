import { z } from "zod";
import { requiredTrimmedString } from "../http/zod-validation.js";
import { roles } from "../rbac/roles.js";

const tenantUserRoleSchema = z.enum(roles);

export const tenantUserCreateBodySchema = z.object({
  email: requiredTrimmedString.refine((value) => value.includes("@"), { message: "EMAIL_REQUIRED" }),
  name: requiredTrimmedString,
  password: z.string().min(8),
  roles: z.array(tenantUserRoleSchema).min(1),
}).strict();

export const tenantUserRolesBodySchema = z.object({
  roles: z.array(tenantUserRoleSchema).min(1),
}).strict();

export type TenantUserCreateBody = z.infer<typeof tenantUserCreateBodySchema>;
export type TenantUserRolesBody = z.infer<typeof tenantUserRolesBodySchema>;
