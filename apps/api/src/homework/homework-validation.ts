import { z } from "zod";
import { optionalIsoDateTime, optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const optionalNonEmptyString = requiredTrimmedString.optional();
const uploadContentTypeSchema = z.enum(["application/pdf", "image/jpeg", "image/png", "text/plain"]);

export const homeworkMaterialFileCreateBodySchema = z.object({
  contentType: uploadContentTypeSchema,
  fileBase64: requiredTrimmedString,
  fileName: requiredTrimmedString,
}).strict();

export const homeworkMaterialAssignmentCreateBodySchema = z.object({
  courseId: optionalNonEmptyString,
  dueAt: optionalIsoDateTime("HOMEWORK_DUE_DATE_INVALID"),
  note: optionalTrimmedString,
  studentId: requiredTrimmedString,
  termId: optionalNonEmptyString,
}).strict();

export const homeworkMaterialCreateBodySchema = z.object({
  description: optionalTrimmedString,
  tenantId: optionalNonEmptyString,
  title: requiredTrimmedString,
}).strict();

export const homeworkMaterialUpdateBodySchema = z.object({
  description: optionalTrimmedString,
  title: optionalNonEmptyString,
}).strict();

export const homeworkCreateBodySchema = z.object({
  classId: requiredTrimmedString,
  description: optionalTrimmedString,
  dueAt: optionalIsoDateTime("HOMEWORK_DUE_DATE_INVALID"),
  tenantId: optionalNonEmptyString,
  title: requiredTrimmedString,
}).strict();

export const homeworkFromMaterialCreateBodySchema = z.object({
  classId: requiredTrimmedString,
  dueAt: optionalIsoDateTime("HOMEWORK_DUE_DATE_INVALID"),
  materialId: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict();

export const homeworkUpdateBodySchema = z.object({
  classId: optionalNonEmptyString,
  description: optionalTrimmedString,
  dueAt: optionalIsoDateTime("HOMEWORK_DUE_DATE_INVALID"),
  title: optionalNonEmptyString,
}).strict();

export const homeworkCheckStatusBodySchema = z.object({
  checked: z.boolean(),
}).strict();

export type HomeworkMaterialFileCreateBody = z.infer<typeof homeworkMaterialFileCreateBodySchema>;
export type HomeworkMaterialAssignmentCreateBody = z.infer<typeof homeworkMaterialAssignmentCreateBodySchema>;
export type HomeworkMaterialCreateBody = z.infer<typeof homeworkMaterialCreateBodySchema>;
export type HomeworkMaterialUpdateBody = z.infer<typeof homeworkMaterialUpdateBodySchema>;
export type HomeworkCreateBody = z.infer<typeof homeworkCreateBodySchema>;
export type HomeworkFromMaterialCreateBody = z.infer<typeof homeworkFromMaterialCreateBodySchema>;
export type HomeworkUpdateBody = z.infer<typeof homeworkUpdateBodySchema>;
export type HomeworkCheckStatusBody = z.infer<typeof homeworkCheckStatusBodySchema>;
