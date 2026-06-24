import { z } from "zod";
import { portalSubjectRoles } from "@o-okul/shared-types";
import { requiredTrimmedString } from "../http/zod-validation.js";

const rolePreviewTargetRoleSchema = z.enum(portalSubjectRoles);

export const rolePreviewStartBodySchema = z.object({
  targetRole: rolePreviewTargetRoleSchema,
  targetSubjectId: requiredTrimmedString,
}).strict();

export type RolePreviewStartBody = z.infer<typeof rolePreviewStartBodySchema>;
