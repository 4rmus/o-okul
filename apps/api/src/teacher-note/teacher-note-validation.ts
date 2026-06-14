import { z } from "zod";
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
}).strict();

export const teacherNoteUpdateBodySchema = z.object({
  body: requiredTrimmedString.optional(),
  courseId: optionalTrimmedString,
  developmentStatus: optionalTrimmedString,
  termId: optionalTrimmedString,
  visibility: teacherNoteVisibilitySchema.optional(),
}).strict();

export type TeacherNoteCreateBody = z.infer<typeof teacherNoteCreateBodySchema>;
export type TeacherNoteUpdateBody = z.infer<typeof teacherNoteUpdateBodySchema>;
