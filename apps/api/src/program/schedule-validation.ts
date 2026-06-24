import { z } from "zod";
import type { ScheduleLessonCreateRequest, ScheduleLessonUpdateRequest } from "@o-okul/shared-types";
import { optionalIsoDateTime, requiredIsoDateTime, requiredTrimmedString } from "../http/zod-validation.js";

const optionalNonEmptyString = requiredTrimmedString.optional();
const scheduleDateTimeSchema = requiredIsoDateTime("SCHEDULE_LESSON_TIME_INVALID");
const optionalScheduleDateTimeSchema = optionalIsoDateTime("SCHEDULE_LESSON_TIME_INVALID");

export const scheduleLessonCreateBodySchema = z.object({
  classId: requiredTrimmedString,
  courseId: optionalNonEmptyString,
  endsAt: scheduleDateTimeSchema,
  teacherId: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
  termId: optionalNonEmptyString,
  title: requiredTrimmedString,
  startsAt: scheduleDateTimeSchema,
}).strict().superRefine(validateScheduleTimeRange) satisfies z.ZodType<ScheduleLessonCreateRequest>;

export const scheduleLessonUpdateBodySchema = z.object({
  classId: optionalNonEmptyString,
  courseId: optionalNonEmptyString,
  endsAt: optionalScheduleDateTimeSchema,
  teacherId: optionalNonEmptyString,
  termId: optionalNonEmptyString,
  title: optionalNonEmptyString,
  startsAt: optionalScheduleDateTimeSchema,
}).strict().refine(hasAtLeastOneField, {
  message: "UPDATE_BODY_EMPTY",
}).superRefine(validateScheduleTimeRange) satisfies z.ZodType<ScheduleLessonUpdateRequest>;

export type ScheduleLessonCreateBody = ScheduleLessonCreateRequest;
export type ScheduleLessonUpdateBody = ScheduleLessonUpdateRequest;

function hasAtLeastOneField(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}

function validateScheduleTimeRange(
  value: { startsAt?: string; endsAt?: string },
  context: z.RefinementCtx,
): void {
  if (!value.startsAt || !value.endsAt) return;

  const startsAt = Date.parse(value.startsAt);
  const endsAt = Date.parse(value.endsAt);
  if (Number.isNaN(startsAt) || Number.isNaN(endsAt) || endsAt > startsAt) return;

  context.addIssue({
    code: "custom",
    message: "SCHEDULE_LESSON_TIME_RANGE_INVALID",
    path: ["endsAt"],
  });
}
