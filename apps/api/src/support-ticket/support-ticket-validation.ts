import { z } from "zod";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const supportTicketPrioritySchema = z.enum(["LOW", "NORMAL", "HIGH"]);
const supportTicketStatusSchema = z.enum(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"]);
const uploadContentTypeSchema = z.enum(["application/pdf", "image/jpeg", "image/png", "text/plain"]);

export const supportTicketCreateBodySchema = z.object({
  campusId: optionalTrimmedString,
  classId: optionalTrimmedString,
  courseId: optionalTrimmedString,
  gradeLevelId: optionalTrimmedString,
  message: requiredTrimmedString,
  priority: supportTicketPrioritySchema.optional(),
  studentId: optionalTrimmedString,
  subject: requiredTrimmedString,
  tenantId: optionalTrimmedString,
  termId: optionalTrimmedString,
}).strict();

export const supportTicketUpdateBodySchema = z.object({
  priority: supportTicketPrioritySchema.optional(),
  status: supportTicketStatusSchema.optional(),
}).strict().refine((body) => body.priority !== undefined || body.status !== undefined, {
  message: "SUPPORT_TICKET_UPDATE_REQUIRED",
});

export const supportTicketAttachmentCreateBodySchema = z.object({
  contentType: uploadContentTypeSchema,
  fileBase64: requiredTrimmedString,
  fileName: requiredTrimmedString,
}).strict();

export const supportTicketCommentCreateBodySchema = z.object({
  body: requiredTrimmedString,
}).strict();

export type SupportTicketCreateBody = z.infer<typeof supportTicketCreateBodySchema>;
export type SupportTicketUpdateBody = z.infer<typeof supportTicketUpdateBodySchema>;
export type SupportTicketAttachmentCreateBody = z.infer<typeof supportTicketAttachmentCreateBodySchema>;
export type SupportTicketCommentCreateBody = z.infer<typeof supportTicketCommentCreateBodySchema>;
