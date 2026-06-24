import { z } from "zod";
import {
  portalSubjectRoles,
  type IdentityInvitationAcceptRequest,
  type IdentityInvitationCreateRequest,
} from "@uzman-hocam/shared-types";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const invitationSubjectTypeSchema = z.enum(portalSubjectRoles);

export const identityInvitationCreateBodySchema = z.object({
  email: requiredTrimmedString.refine((value) => value.includes("@"), { message: "EMAIL_REQUIRED" }),
  name: optionalTrimmedString,
  subjectId: requiredTrimmedString,
  subjectType: invitationSubjectTypeSchema,
}).strict() satisfies z.ZodType<IdentityInvitationCreateRequest>;

export const identityInvitationAcceptBodySchema = z.object({
  name: optionalTrimmedString,
  password: z.string().min(8),
  token: requiredTrimmedString,
}).strict() satisfies z.ZodType<IdentityInvitationAcceptRequest>;

export type IdentityInvitationCreateBody = IdentityInvitationCreateRequest;
export type IdentityInvitationAcceptBody = IdentityInvitationAcceptRequest;
