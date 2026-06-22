import { z } from "zod";
import type {
  HomeworkCheckStatusRequest,
  HomeworkCreateRequest,
  HomeworkFromMaterialCreateRequest,
  HomeworkMaterialAssignmentCreateRequest,
  HomeworkMaterialCreateRequest,
  HomeworkMaterialFileCreateRequest,
  HomeworkMaterialUpdateRequest,
  HomeworkUpdateRequest,
} from "@uzman-hocam/shared-types";
import { optionalIsoDateTime, optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const optionalNonEmptyString = requiredTrimmedString.optional();
const uploadContentTypeSchema = z.enum(["application/pdf", "image/jpeg", "image/png", "text/plain"]);

export const homeworkMaterialFileCreateBodySchema = z.object({
  contentType: uploadContentTypeSchema,
  fileBase64: requiredTrimmedString,
  fileName: requiredTrimmedString,
}).strict() satisfies z.ZodType<HomeworkMaterialFileCreateRequest>;

export const homeworkMaterialAssignmentCreateBodySchema = z.object({
  courseId: optionalNonEmptyString,
  dueAt: optionalIsoDateTime("HOMEWORK_DUE_DATE_INVALID"),
  note: optionalTrimmedString,
  studentId: requiredTrimmedString,
  termId: optionalNonEmptyString,
}).strict() satisfies z.ZodType<HomeworkMaterialAssignmentCreateRequest>;

export const homeworkMaterialCreateBodySchema = z.object({
  description: optionalTrimmedString,
  tenantId: optionalNonEmptyString,
  title: requiredTrimmedString,
}).strict() satisfies z.ZodType<HomeworkMaterialCreateRequest>;

export const homeworkMaterialUpdateBodySchema = z.object({
  description: optionalTrimmedString,
  title: optionalNonEmptyString,
}).strict().refine(hasAtLeastOneField, {
  message: "UPDATE_BODY_EMPTY",
}) satisfies z.ZodType<HomeworkMaterialUpdateRequest>;

export const homeworkCreateBodySchema = z.object({
  classId: requiredTrimmedString,
  description: optionalTrimmedString,
  dueAt: optionalIsoDateTime("HOMEWORK_DUE_DATE_INVALID"),
  tenantId: optionalNonEmptyString,
  title: requiredTrimmedString,
}).strict() satisfies z.ZodType<HomeworkCreateRequest>;

export const homeworkFromMaterialCreateBodySchema = z.object({
  classId: requiredTrimmedString,
  dueAt: optionalIsoDateTime("HOMEWORK_DUE_DATE_INVALID"),
  materialId: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict() satisfies z.ZodType<HomeworkFromMaterialCreateRequest>;

export const homeworkUpdateBodySchema = z.object({
  classId: optionalNonEmptyString,
  description: optionalTrimmedString,
  dueAt: optionalIsoDateTime("HOMEWORK_DUE_DATE_INVALID"),
  title: optionalNonEmptyString,
}).strict().refine(hasAtLeastOneField, {
  message: "UPDATE_BODY_EMPTY",
}) satisfies z.ZodType<HomeworkUpdateRequest>;

export const homeworkCheckStatusBodySchema = z.object({
  checked: z.boolean(),
}).strict() satisfies z.ZodType<HomeworkCheckStatusRequest>;

export type HomeworkMaterialFileCreateBody = HomeworkMaterialFileCreateRequest;
export type HomeworkMaterialAssignmentCreateBody = HomeworkMaterialAssignmentCreateRequest;
export type HomeworkMaterialCreateBody = HomeworkMaterialCreateRequest;
export type HomeworkMaterialUpdateBody = HomeworkMaterialUpdateRequest;
export type HomeworkCreateBody = HomeworkCreateRequest;
export type HomeworkFromMaterialCreateBody = HomeworkFromMaterialCreateRequest;
export type HomeworkUpdateBody = HomeworkUpdateRequest;
export type HomeworkCheckStatusBody = HomeworkCheckStatusRequest;

function hasAtLeastOneField(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}
