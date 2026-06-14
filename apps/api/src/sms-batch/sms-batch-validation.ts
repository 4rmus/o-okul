import { z } from "zod";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const studentStatusSchema = z.enum(["ACTIVE", "PASSIVE", "GRADUATED", "TRANSFERRED"]);

const smsBatchRecipientSchema = z.object({
  to: requiredTrimmedString,
}).strict();

export const smsBatchCreateBodySchema = z.object({
  recipients: z.array(smsBatchRecipientSchema).min(1),
  templateId: requiredTrimmedString,
}).strict();

export const smsBatchRecipientPreviewBodySchema = z.preprocess(
  (value) => value ?? {},
  z.object({
    announcementId: optionalTrimmedString,
    campusId: optionalTrimmedString,
    classId: optionalTrimmedString,
    courseId: optionalTrimmedString,
    gradeLevelId: optionalTrimmedString,
    studentStatus: studentStatusSchema.optional(),
    termId: optionalTrimmedString,
  }).strict(),
);

export type SmsBatchCreateBody = z.infer<typeof smsBatchCreateBodySchema>;
export type SmsBatchRecipientPreviewBody = z.infer<typeof smsBatchRecipientPreviewBodySchema>;
