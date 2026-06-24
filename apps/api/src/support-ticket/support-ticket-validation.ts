import { z } from "zod";
import type {
  PortalSupportTicketCreateRequest,
  SupportTicketAttachmentCreateRequest,
  SupportTicketCommentCreateRequest,
  SupportTicketCreateRequest,
  SupportTicketUpdateRequest,
  TeacherPortalSupportTicketCreateRequest,
} from "@uzman-hocam/shared-types";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const supportTicketPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH"]);
const supportTicketStatusSchema = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
const uploadContentTypeSchema = z.enum(["application/pdf", "image/jpeg", "image/png", "text/plain"]);

const supportTicketCreateBodyShape = {
  campusId: optionalTrimmedString,
  classId: optionalTrimmedString,
  courseId: optionalTrimmedString,
  gradeLevelId: optionalTrimmedString,
  message: requiredTrimmedString,
  priority: supportTicketPrioritySchema.optional(),
  subject: requiredTrimmedString,
  termId: optionalTrimmedString,
};

export const supportTicketCreateBodySchema = z.object({
  ...supportTicketCreateBodyShape,
  studentId: optionalTrimmedString,
  tenantId: optionalTrimmedString,
}).strict() satisfies z.ZodType<SupportTicketCreateRequest>;

export const portalSupportTicketCreateBodySchema = z.object(supportTicketCreateBodyShape)
  .strict() satisfies z.ZodType<PortalSupportTicketCreateRequest>;

export const teacherPortalSupportTicketCreateBodySchema = z.object({
  ...supportTicketCreateBodyShape,
  studentId: optionalTrimmedString,
}).strict() satisfies z.ZodType<TeacherPortalSupportTicketCreateRequest>;

export const supportTicketUpdateBodySchema = z.object({
  priority: supportTicketPrioritySchema.optional(),
  status: supportTicketStatusSchema.optional(),
}).strict().refine((body) => body.priority !== undefined || body.status !== undefined, {
  message: "SUPPORT_TICKET_UPDATE_REQUIRED",
}) satisfies z.ZodType<SupportTicketUpdateRequest>;

export const supportTicketAttachmentCreateBodySchema = z.object({
  contentType: uploadContentTypeSchema,
  fileBase64: requiredTrimmedString,
  fileName: requiredTrimmedString,
}).strict() satisfies z.ZodType<SupportTicketAttachmentCreateRequest>;

export const supportTicketCommentCreateBodySchema = z.object({
  body: requiredTrimmedString,
}).strict() satisfies z.ZodType<SupportTicketCommentCreateRequest>;

export type SupportTicketCreateBody = SupportTicketCreateRequest;
export type PortalSupportTicketCreateBody = PortalSupportTicketCreateRequest;
export type TeacherPortalSupportTicketCreateBody = TeacherPortalSupportTicketCreateRequest;
export type SupportTicketUpdateBody = SupportTicketUpdateRequest;
export type SupportTicketAttachmentCreateBody = SupportTicketAttachmentCreateRequest;
export type SupportTicketCommentCreateBody = SupportTicketCommentCreateRequest;
