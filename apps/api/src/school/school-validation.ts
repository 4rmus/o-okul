import { z } from "zod";
import {
  optionalDateString as optionalCalendarDateString,
  optionalTrimmedString,
  requiredDateString,
  requiredTrimmedString,
} from "../http/zod-validation.js";

const optionalNonEmptyString = requiredTrimmedString.optional();
const dateString = requiredDateString("DATE_INVALID");
const optionalDateString = optionalCalendarDateString("DATE_INVALID");
const guardianRelationshipTypeSchema = z.enum(["MOTHER", "FATHER", "GUARDIAN", "EMERGENCY_CONTACT", "OTHER"]);
const teacherAssignmentRoleSchema = z.enum(["CLASS_TEACHER", "BRANCH_TEACHER", "GUIDANCE_COUNSELOR", "RESPONSIBLE_TEACHER"]);

export const campusCreateBodySchema = z.object({
  code: optionalTrimmedString,
  name: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict();

export const campusUpdateBodySchema = z.object({
  code: optionalTrimmedString,
  name: optionalNonEmptyString,
}).strict();

export const gradeLevelCreateBodySchema = z.object({
  code: optionalTrimmedString,
  name: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict();

export const gradeLevelUpdateBodySchema = z.object({
  code: optionalTrimmedString,
  name: optionalNonEmptyString,
}).strict();

export const classCreateBodySchema = z.object({
  campusId: optionalNonEmptyString,
  gradeLevelId: optionalNonEmptyString,
  level: optionalTrimmedString,
  name: requiredTrimmedString,
  section: optionalTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict();

export const classUpdateBodySchema = z.object({
  campusId: optionalNonEmptyString,
  gradeLevelId: optionalNonEmptyString,
  level: optionalTrimmedString,
  name: optionalNonEmptyString,
  section: optionalTrimmedString,
}).strict();

export const courseCreateBodySchema = z.object({
  code: optionalTrimmedString,
  name: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict();

export const courseUpdateBodySchema = z.object({
  code: optionalTrimmedString,
  name: optionalNonEmptyString,
}).strict();

export const learningOutcomeCreateBodySchema = z.object({
  branch: requiredTrimmedString,
  code: requiredTrimmedString,
  level: optionalTrimmedString,
  tenantId: optionalNonEmptyString,
  title: requiredTrimmedString,
}).strict();

export const learningOutcomeUpdateBodySchema = z.object({
  branch: optionalNonEmptyString,
  code: optionalNonEmptyString,
  level: optionalTrimmedString,
  title: optionalNonEmptyString,
}).strict();

export const academicYearCreateBodySchema = z.object({
  endsAt: dateString,
  isActive: z.boolean().optional(),
  name: requiredTrimmedString,
  startsAt: dateString,
  tenantId: optionalNonEmptyString,
}).strict();

export const academicYearUpdateBodySchema = z.object({
  endsAt: optionalDateString,
  isActive: z.boolean().optional(),
  name: optionalNonEmptyString,
  startsAt: optionalDateString,
}).strict();

export const academicTermCreateBodySchema = z.object({
  academicYearId: requiredTrimmedString,
  endsAt: dateString,
  isActive: z.boolean().optional(),
  name: requiredTrimmedString,
  startsAt: dateString,
  tenantId: optionalNonEmptyString,
}).strict();

export const academicTermUpdateBodySchema = z.object({
  academicYearId: optionalNonEmptyString,
  endsAt: optionalDateString,
  isActive: z.boolean().optional(),
  name: optionalNonEmptyString,
  startsAt: optionalDateString,
}).strict();

export const teacherCreateBodySchema = z.object({
  branch: optionalTrimmedString,
  firstName: requiredTrimmedString,
  lastName: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict();

export const teacherUpdateBodySchema = z.object({
  branch: optionalTrimmedString,
  firstName: optionalNonEmptyString,
  lastName: optionalNonEmptyString,
}).strict();

const teacherAssignmentBodyFields = {
  classId: optionalNonEmptyString,
  courseId: optionalNonEmptyString,
  endsAt: optionalDateString,
  role: teacherAssignmentRoleSchema.optional(),
  startsAt: optionalDateString,
  studentId: optionalNonEmptyString,
  termId: optionalNonEmptyString,
};

export const teacherAssignmentCreateBodySchema = z.object(teacherAssignmentBodyFields).strict().refine(
  (body) => body.classId !== undefined || body.studentId !== undefined,
  { message: "TEACHER_ASSIGNMENT_TARGET_REQUIRED", path: ["classId"] },
);

export const teacherAssignmentUpdateBodySchema = z.object(teacherAssignmentBodyFields).strict();

export const guardianCreateBodySchema = z.object({
  firstName: requiredTrimmedString,
  lastName: requiredTrimmedString,
  phone: optionalTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict();

export const guardianUpdateBodySchema = z.object({
  firstName: optionalNonEmptyString,
  lastName: optionalNonEmptyString,
  phone: optionalTrimmedString,
}).strict();

const guardianStudentRelationFields = {
  canOpenSupportTickets: z.boolean().optional(),
  canReceiveAnnouncements: z.boolean().optional(),
  canReceiveSms: z.boolean().optional(),
  canViewFinance: z.boolean().optional(),
  isPrimary: z.boolean().optional(),
  relationshipType: guardianRelationshipTypeSchema.optional(),
};

export const guardianStudentLinkBodySchema = z.object({
  ...guardianStudentRelationFields,
  studentId: requiredTrimmedString,
}).strict();

export const guardianStudentRelationBodySchema = z.object(guardianStudentRelationFields).strict();

export const guardianNotificationPreferenceBodySchema = z.object({
  canOpenSupportTickets: z.boolean().optional(),
  canReceiveAnnouncements: z.boolean().optional(),
  canReceiveSms: z.boolean().optional(),
}).strict();

export type CampusCreateBody = z.infer<typeof campusCreateBodySchema>;
export type CampusUpdateBody = z.infer<typeof campusUpdateBodySchema>;
export type GradeLevelCreateBody = z.infer<typeof gradeLevelCreateBodySchema>;
export type GradeLevelUpdateBody = z.infer<typeof gradeLevelUpdateBodySchema>;
export type ClassCreateBody = z.infer<typeof classCreateBodySchema>;
export type ClassUpdateBody = z.infer<typeof classUpdateBodySchema>;
export type CourseCreateBody = z.infer<typeof courseCreateBodySchema>;
export type CourseUpdateBody = z.infer<typeof courseUpdateBodySchema>;
export type LearningOutcomeCreateBody = z.infer<typeof learningOutcomeCreateBodySchema>;
export type LearningOutcomeUpdateBody = z.infer<typeof learningOutcomeUpdateBodySchema>;
export type AcademicYearCreateBody = z.infer<typeof academicYearCreateBodySchema>;
export type AcademicYearUpdateBody = z.infer<typeof academicYearUpdateBodySchema>;
export type AcademicTermCreateBody = z.infer<typeof academicTermCreateBodySchema>;
export type AcademicTermUpdateBody = z.infer<typeof academicTermUpdateBodySchema>;
export type TeacherCreateBody = z.infer<typeof teacherCreateBodySchema>;
export type TeacherUpdateBody = z.infer<typeof teacherUpdateBodySchema>;
export type TeacherAssignmentCreateBody = z.infer<typeof teacherAssignmentCreateBodySchema>;
export type TeacherAssignmentUpdateBody = z.infer<typeof teacherAssignmentUpdateBodySchema>;
export type GuardianCreateBody = z.infer<typeof guardianCreateBodySchema>;
export type GuardianUpdateBody = z.infer<typeof guardianUpdateBodySchema>;
export type GuardianStudentLinkBody = z.infer<typeof guardianStudentLinkBodySchema>;
export type GuardianStudentRelationBody = z.infer<typeof guardianStudentRelationBodySchema>;
export type GuardianNotificationPreferenceBody = z.infer<typeof guardianNotificationPreferenceBodySchema>;
