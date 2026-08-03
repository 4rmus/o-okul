import { z } from "zod";
import {
  portalSubjectRoles,
  type IdentityInvitationAcceptRequest,
  type IdentityInvitationCreateRequest,
} from "@o-okul/shared-types";
import { optionalUppercaseString, requiredTrimmedString } from "../http/zod-validation.js";
import { passwordMaxLength, passwordMinLength, passwordPolicyViolation } from "../auth/password-policy.js";

const invitationSubjectTypeSchema = z.enum(portalSubjectRoles);

export const identityInvitationCreateBodySchema = z.object({
  email: requiredTrimmedString.refine((value) => value.includes("@"), { message: "EMAIL_REQUIRED" }),
  name: optionalUppercaseString,
  subjectId: requiredTrimmedString,
  subjectType: invitationSubjectTypeSchema,
}).strict() satisfies z.ZodType<IdentityInvitationCreateRequest>;

export const identityInvitationAcceptBodySchema = z.object({
  name: optionalUppercaseString,
  password: z.string().min(passwordMinLength).max(passwordMaxLength).refine((value) => !passwordPolicyViolation(value), {
    message: "PASSWORD_COMMON_REJECTED",
  }),
  token: requiredTrimmedString,
}).strict() satisfies z.ZodType<IdentityInvitationAcceptRequest>;

export type IdentityInvitationCreateBody = IdentityInvitationCreateRequest;
export type IdentityInvitationAcceptBody = IdentityInvitationAcceptRequest;
