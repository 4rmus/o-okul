import { z } from "zod";
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
}).strict();

export const scheduleLessonUpdateBodySchema = z.object({
  classId: optionalNonEmptyString,
  courseId: optionalNonEmptyString,
  endsAt: optionalScheduleDateTimeSchema,
  teacherId: optionalNonEmptyString,
  termId: optionalNonEmptyString,
  title: optionalNonEmptyString,
  startsAt: optionalScheduleDateTimeSchema,
}).strict();

export type ScheduleLessonCreateBody = z.infer<typeof scheduleLessonCreateBodySchema>;
export type ScheduleLessonUpdateBody = z.infer<typeof scheduleLessonUpdateBodySchema>;
