import { z } from "zod";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const invitationSubjectTypeSchema = z.enum(["STUDENT", "GUARDIAN", "TEACHER"]);

export const identityInvitationCreateBodySchema = z.object({
  email: requiredTrimmedString.refine((value) => value.includes("@"), { message: "EMAIL_REQUIRED" }),
  name: optionalTrimmedString,
  subjectId: requiredTrimmedString,
  subjectType: invitationSubjectTypeSchema,
}).strict();

export const identityInvitationAcceptBodySchema = z.object({
  name: optionalTrimmedString,
  password: z.string().min(8),
  token: requiredTrimmedString,
}).strict();

export type IdentityInvitationCreateBody = z.infer<typeof identityInvitationCreateBodySchema>;
export type IdentityInvitationAcceptBody = z.infer<typeof identityInvitationAcceptBodySchema>;
