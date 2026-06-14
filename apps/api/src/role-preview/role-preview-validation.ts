import { z } from "zod";
import { requiredTrimmedString } from "../http/zod-validation.js";

const rolePreviewTargetRoleSchema = z.enum(["GUARDIAN", "STUDENT", "TEACHER"]);

export const rolePreviewStartBodySchema = z.object({
  targetRole: rolePreviewTargetRoleSchema,
  targetSubjectId: requiredTrimmedString,
}).strict();

export type RolePreviewStartBody = z.infer<typeof rolePreviewStartBodySchema>;
