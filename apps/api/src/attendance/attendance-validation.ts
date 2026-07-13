import { z } from "zod";
import type { AttendanceDailyUpsertRequest } from "@o-okul/shared-types";
import { requiredDateString, requiredTrimmedString } from "../http/zod-validation.js";

const attendanceStatusSchema = z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]);
const attendanceDateSchema = requiredDateString("ATTENDANCE_DATE_INVALID");

export const attendanceDailyUpsertBodySchema = z.object({
  classId: requiredTrimmedString,
  date: attendanceDateSchema,
  entries: z.array(z.object({
    studentId: requiredTrimmedString,
    status: attendanceStatusSchema,
  }).strict()).min(1).max(200),
}).strict() satisfies z.ZodType<AttendanceDailyUpsertRequest>;

export type AttendanceDailyUpsertBody = AttendanceDailyUpsertRequest;
