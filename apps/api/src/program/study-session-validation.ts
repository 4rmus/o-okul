import { z } from "zod";
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
}).strict();

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
}).strict();

export type StudySessionCreateBody = z.infer<typeof studySessionCreateBodySchema>;
export type StudySessionUpdateBody = z.infer<typeof studySessionUpdateBodySchema>;
