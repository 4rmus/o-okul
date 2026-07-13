import { z } from "zod";
import type { AttendanceCreateRequest, AttendanceDailyUpsertRequest, AttendanceUpdateRequest } from "@o-okul/shared-types";
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

export const attendanceDailyUpsertBodySchema = z.object({
  classId: requiredTrimmedString,
  date: attendanceDateSchema,
  entries: z.array(z.object({
    studentId: requiredTrimmedString,
    status: attendanceStatusSchema,
  }).strict()).min(1).max(200),
}).strict() satisfies z.ZodType<AttendanceDailyUpsertRequest>;

export type AttendanceCreateBody = AttendanceCreateRequest;
export type AttendanceDailyUpsertBody = AttendanceDailyUpsertRequest;
export type AttendanceUpdateBody = AttendanceUpdateRequest;
