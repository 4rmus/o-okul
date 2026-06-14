import { z } from "zod";
import { optionalTrimmedString, requiredDateString, requiredTrimmedString } from "../http/zod-validation.js";

const attendanceStatusSchema = z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]);
const attendanceDateSchema = requiredDateString("ATTENDANCE_DATE_INVALID");

export const attendanceCreateBodySchema = z.object({
  courseId: optionalTrimmedString,
  date: attendanceDateSchema,
  status: attendanceStatusSchema,
  studentId: requiredTrimmedString,
  termId: optionalTrimmedString,
}).strict();

export const attendanceUpdateBodySchema = z.object({
  courseId: optionalTrimmedString,
  status: attendanceStatusSchema,
  termId: optionalTrimmedString,
}).strict();

export type AttendanceCreateBody = z.infer<typeof attendanceCreateBodySchema>;
export type AttendanceUpdateBody = z.infer<typeof attendanceUpdateBodySchema>;
