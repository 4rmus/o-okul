import { z } from "zod";
import type { StudySessionCreateRequest, StudySessionUpdateRequest } from "@o-okul/shared-types";
import { optionalIsoDateTime, requiredIsoDateTime, requiredTrimmedString } from "../http/zod-validation.js";

const optionalNonEmptyString = requiredTrimmedString.optional();
const positiveIntegerSchema = z.number().int().positive();
const studentIdsSchema = z.array(requiredTrimmedString).min(1);
const studySessionDateTimeSchema = requiredIsoDateTime("STUDY_SESSION_TIME_INVALID");
const optionalStudySessionDateTimeSchema = optionalIsoDateTime("STUDY_SESSION_TIME_INVALID");

export const studySessionCreateBodySchema = z.object({
  capacity: positiveIntegerSchema,
  classId: requiredTrimmedString,
  courseId: optionalNonEmptyString,
  endsAt: studySessionDateTimeSchema,
  startsAt: studySessionDateTimeSchema,
  studentIds: studentIdsSchema,
  teacherId: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
  termId: optionalNonEmptyString,
  title: requiredTrimmedString,
}).strict().superRefine(validateStudySessionTimeRange) satisfies z.ZodType<StudySessionCreateRequest>;

export const studySessionUpdateBodySchema = z.object({
  capacity: positiveIntegerSchema.optional(),
  classId: optionalNonEmptyString,
  courseId: optionalNonEmptyString,
  endsAt: optionalStudySessionDateTimeSchema,
  startsAt: optionalStudySessionDateTimeSchema,
  studentIds: studentIdsSchema.optional(),
  teacherId: optionalNonEmptyString,
  termId: optionalNonEmptyString,
  title: optionalNonEmptyString,
}).strict().refine(hasAtLeastOneField, {
  message: "UPDATE_BODY_EMPTY",
}).superRefine(validateStudySessionTimeRange) satisfies z.ZodType<StudySessionUpdateRequest>;

export type StudySessionCreateBody = StudySessionCreateRequest;
export type StudySessionUpdateBody = StudySessionUpdateRequest;

function hasAtLeastOneField(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

function validateStudySessionTimeRange(
  value: { startsAt?: string; endsAt?: string },
  context: z.RefinementCtx,
): void {
  if (!value.startsAt || !value.endsAt) return;

  const startsAt = Date.parse(value.startsAt);
  const endsAt = Date.parse(value.endsAt);
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt > startsAt) return;

  context.addIssue({
    code: "custom",
    message: "STUDY_SESSION_TIME_RANGE_INVALID",
    path: ["endsAt"],
  });
}
