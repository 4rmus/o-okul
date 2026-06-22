import { z } from "zod";
import type { AttendanceCreateRequest, AttendanceUpdateRequest } from "@uzman-hocam/shared-types";
import { optionalTrimmedString, requiredDateString, requiredTrimmedString } from "../http/zod-validation.js";

const attendanceStatusSchema = z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]);
const attendanceDateSchema = requiredDateString("ATTENDANCE_DATE_INVALID");

export const attendanceCreateBodySchema = z.object({
  courseId: optionalTrimmedString,
  date: attendanceDateSchema,
  status: attendanceStatusSchema,
  studentId: requiredTrimmedString,
  termId: optionalTrimmedString,
}).strict() satisfies z.ZodType<AttendanceCreateRequest>;

export const attendanceUpdateBodySchema = z.object({
  courseId: optionalTrimmedString,
  status: attendanceStatusSchema,
  termId: optionalTrimmedString,
}).strict() satisfies z.ZodType<AttendanceUpdateRequest>;

export type AttendanceCreateBody = AttendanceCreateRequest;
export type AttendanceUpdateBody = AttendanceUpdateRequest;
