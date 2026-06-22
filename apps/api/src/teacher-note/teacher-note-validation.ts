import { z } from "zod";
import type { TeacherNoteCreateRequest, TeacherNoteUpdateRequest } from "@uzman-hocam/shared-types";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const teacherNoteVisibilitySchema = z.enum(["INTERNAL", "GUARDIAN_STUDENT"]);

export const teacherNoteCreateBodySchema = z.object({
  body: requiredTrimmedString,
  courseId: optionalTrimmedString,
  developmentStatus: optionalTrimmedString,
  studentId: requiredTrimmedString,
  teacherId: optionalTrimmedString,
  termId: optionalTrimmedString,
  visibility: teacherNoteVisibilitySchema,
}).strict() satisfies z.ZodType<TeacherNoteCreateRequest>;

export const teacherNoteUpdateBodySchema = z.object({
  body: requiredTrimmedString.optional(),
  courseId: optionalTrimmedString,
  developmentStatus: optionalTrimmedString,
  termId: optionalTrimmedString,
  visibility: teacherNoteVisibilitySchema.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, {
  message: "UPDATE_BODY_EMPTY",
}) satisfies z.ZodType<TeacherNoteUpdateRequest>;

export type TeacherNoteCreateBody = TeacherNoteCreateRequest;
export type TeacherNoteUpdateBody = TeacherNoteUpdateRequest;
