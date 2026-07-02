import { z } from "zod";
import type {
  AcademicTermCreateRequest,
  AcademicTermUpdateRequest,
  AcademicYearCreateRequest,
  AcademicYearUpdateRequest,
  AlanCreateRequest,
  AlanUpdateRequest,
  CampusCreateRequest,
  CampusUpdateRequest,
  ClassCreateRequest,
  ClassUpdateRequest,
  CourseCreateRequest,
  CourseUpdateRequest,
  GradeLevelCreateRequest,
  GradeLevelUpdateRequest,
  GuardianCreateRequest,
  GuardianStudentLinkRequest,
  GuardianStudentRelationRequest,
  GuardianUpdateRequest,
  LearningOutcomeCreateRequest,
  LearningOutcomeImportRequest,
  LearningOutcomeUpdateRequest,
  TeacherAssignmentCreateRequest,
  TeacherAssignmentUpdateRequest,
  TeacherCreateRequest,
  TeacherImportRequest,
  TeacherUpdateRequest,
} from "@o-okul/shared-types";
import {
  optionalDateString as optionalCalendarDateString,
  optionalTrimmedString,
  requiredDateString,
  requiredTrimmedString,
} from "../http/zod-validation.js";

const optionalNonEmptyString = requiredTrimmedString.optional();
const optionalEmailString = optionalTrimmedString.refine((value) => value === undefined || value === "" || value.includes("@"), {
  message: "EMAIL_INVALID",
});
const dateString = requiredDateString("DATE_INVALID");
const optionalDateString = optionalCalendarDateString("DATE_INVALID");
const teacherAssignmentRoleSchema = z.enum(["CLASS_TEACHER", "BRANCH_TEACHER", "GUIDANCE_COUNSELOR", "RESPONSIBLE_TEACHER"]);

export const campusCreateBodySchema = z.object({
  code: optionalTrimmedString,
  name: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict() satisfies z.ZodType<CampusCreateRequest>;

export const campusUpdateBodySchema = z.object({
  code: optionalTrimmedString,
  name: optionalNonEmptyString,
}).strict() satisfies z.ZodType<CampusUpdateRequest>;

export const gradeLevelCreateBodySchema = z.object({
  code: optionalTrimmedString,
  name: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict() satisfies z.ZodType<GradeLevelCreateRequest>;

export const gradeLevelUpdateBodySchema = z.object({
  code: optionalTrimmedString,
  name: optionalNonEmptyString,
}).strict() satisfies z.ZodType<GradeLevelUpdateRequest>;

export const alanCreateBodySchema = z.object({
  code: optionalTrimmedString,
  gradeLevelId: optionalNonEmptyString,
  name: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict() satisfies z.ZodType<AlanCreateRequest>;

export const alanUpdateBodySchema = z.object({
  code: optionalTrimmedString,
  gradeLevelId: optionalNonEmptyString,
  name: optionalNonEmptyString,
}).strict().refine(hasAtLeastOneField, {
  message: "UPDATE_BODY_EMPTY",
}) satisfies z.ZodType<AlanUpdateRequest>;

export const classCreateBodySchema = z.object({
  alanId: optionalNonEmptyString,
  campusId: optionalNonEmptyString,
  gradeLevelId: optionalNonEmptyString,
  name: requiredTrimmedString,
  section: optionalTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict() satisfies z.ZodType<ClassCreateRequest>;

export const classUpdateBodySchema = z.object({
  alanId: optionalNonEmptyString,
  campusId: optionalNonEmptyString,
  gradeLevelId: optionalNonEmptyString,
  name: optionalNonEmptyString,
  section: optionalTrimmedString,
}).strict().refine(hasAtLeastOneField, {
  message: "UPDATE_BODY_EMPTY",
}) satisfies z.ZodType<ClassUpdateRequest>;

export const courseCreateBodySchema = z.object({
  code: optionalTrimmedString,
  name: requiredTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict() satisfies z.ZodType<CourseCreateRequest>;

export const courseUpdateBodySchema = z.object({
  code: optionalTrimmedString,
  name: optionalNonEmptyString,
}).strict() satisfies z.ZodType<CourseUpdateRequest>;

export const learningOutcomeCreateBodySchema = z.object({
  branch: requiredTrimmedString,
  code: requiredTrimmedString,
  level: optionalTrimmedString,
  tenantId: optionalNonEmptyString,
  title: requiredTrimmedString,
}).strict() satisfies z.ZodType<LearningOutcomeCreateRequest>;

export const learningOutcomeUpdateBodySchema = z.object({
  branch: optionalNonEmptyString,
  code: optionalNonEmptyString,
  level: optionalTrimmedString,
  title: optionalNonEmptyString,
}).strict() satisfies z.ZodType<LearningOutcomeUpdateRequest>;

export const learningOutcomeImportBodySchema = z.object({
  fileBase64: requiredTrimmedString,
}).strict() satisfies z.ZodType<LearningOutcomeImportRequest>;

export const academicYearCreateBodySchema = z.object({
  endsAt: dateString,
  isActive: z.boolean().optional(),
  name: requiredTrimmedString,
  startsAt: dateString,
  tenantId: optionalNonEmptyString,
}).strict() satisfies z.ZodType<AcademicYearCreateRequest>;

export const academicYearUpdateBodySchema = z.object({
  endsAt: optionalDateString,
  isActive: z.boolean().optional(),
  name: optionalNonEmptyString,
  startsAt: optionalDateString,
}).strict() satisfies z.ZodType<AcademicYearUpdateRequest>;

export const academicTermCreateBodySchema = z.object({
  academicYearId: requiredTrimmedString,
  endsAt: dateString,
  isActive: z.boolean().optional(),
  name: requiredTrimmedString,
  startsAt: dateString,
  tenantId: optionalNonEmptyString,
}).strict() satisfies z.ZodType<AcademicTermCreateRequest>;

export const academicTermUpdateBodySchema = z.object({
  academicYearId: optionalNonEmptyString,
  endsAt: optionalDateString,
  isActive: z.boolean().optional(),
  name: optionalNonEmptyString,
  startsAt: optionalDateString,
}).strict() satisfies z.ZodType<AcademicTermUpdateRequest>;

export const teacherCreateBodySchema = z.object({
  branch: optionalTrimmedString,
  email: optionalEmailString,
  firstName: requiredTrimmedString,
  lastName: requiredTrimmedString,
  nationalId: optionalTrimmedString,
  phone: optionalTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict() satisfies z.ZodType<TeacherCreateRequest>;

export const teacherUpdateBodySchema = z.object({
  branch: optionalTrimmedString,
  email: optionalEmailString,
  firstName: optionalNonEmptyString,
  lastName: optionalNonEmptyString,
  nationalId: optionalTrimmedString,
  phone: optionalTrimmedString,
}).strict() satisfies z.ZodType<TeacherUpdateRequest>;

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
) satisfies z.ZodType<TeacherAssignmentCreateRequest>;

export const teacherAssignmentUpdateBodySchema = z.object(teacherAssignmentBodyFields).strict().refine(hasAtLeastOneField, {
  message: "UPDATE_BODY_EMPTY",
}) satisfies z.ZodType<TeacherAssignmentUpdateRequest>;

export const teacherImportBodySchema = z.object({
  fileBase64: requiredTrimmedString,
}).strict() satisfies z.ZodType<TeacherImportRequest>;

export const guardianCreateBodySchema = z.object({
  email: optionalEmailString,
  firstName: requiredTrimmedString,
  lastName: requiredTrimmedString,
  nationalId: optionalTrimmedString,
  phone: optionalTrimmedString,
  tenantId: optionalNonEmptyString,
}).strict() satisfies z.ZodType<GuardianCreateRequest>;

export const guardianUpdateBodySchema = z.object({
  email: optionalEmailString,
  firstName: optionalNonEmptyString,
  lastName: optionalNonEmptyString,
  nationalId: optionalTrimmedString,
  phone: optionalTrimmedString,
}).strict() satisfies z.ZodType<GuardianUpdateRequest>;

const guardianStudentRelationFields = {
  canOpenSupportTickets: z.boolean().optional(),
  canReceiveAnnouncements: z.boolean().optional(),
  canReceiveSms: z.boolean().optional(),
  canViewFinance: z.boolean().optional(),
};

export const guardianStudentLinkBodySchema = z.object({
  ...guardianStudentRelationFields,
  studentId: requiredTrimmedString,
}).strict() satisfies z.ZodType<GuardianStudentLinkRequest>;

export const guardianStudentRelationBodySchema = z.object(guardianStudentRelationFields).strict() satisfies z.ZodType<GuardianStudentRelationRequest>;

export const guardianNotificationPreferenceBodySchema = z.object({
  canOpenSupportTickets: z.boolean().optional(),
  canReceiveAnnouncements: z.boolean().optional(),
  canReceiveSms: z.boolean().optional(),
}).strict();

export type CampusCreateBody = CampusCreateRequest;
export type CampusUpdateBody = CampusUpdateRequest;
export type AlanCreateBody = AlanCreateRequest;
export type AlanUpdateBody = AlanUpdateRequest;
export type GradeLevelCreateBody = GradeLevelCreateRequest;
export type GradeLevelUpdateBody = GradeLevelUpdateRequest;
export type ClassCreateBody = ClassCreateRequest;
export type ClassUpdateBody = ClassUpdateRequest;
export type CourseCreateBody = CourseCreateRequest;
export type CourseUpdateBody = CourseUpdateRequest;
export type LearningOutcomeCreateBody = LearningOutcomeCreateRequest;
export type LearningOutcomeUpdateBody = LearningOutcomeUpdateRequest;
export type AcademicYearCreateBody = AcademicYearCreateRequest;
export type AcademicYearUpdateBody = AcademicYearUpdateRequest;
export type AcademicTermCreateBody = AcademicTermCreateRequest;
export type AcademicTermUpdateBody = AcademicTermUpdateRequest;
export type TeacherCreateBody = z.infer<typeof teacherCreateBodySchema>;
export type TeacherUpdateBody = z.infer<typeof teacherUpdateBodySchema>;
export type TeacherAssignmentCreateBody = TeacherAssignmentCreateRequest;
export type TeacherAssignmentUpdateBody = TeacherAssignmentUpdateRequest;
export type TeacherImportBody = TeacherImportRequest;
export type GuardianCreateBody = z.infer<typeof guardianCreateBodySchema>;
export type GuardianUpdateBody = z.infer<typeof guardianUpdateBodySchema>;
export type GuardianStudentLinkBody = z.infer<typeof guardianStudentLinkBodySchema>;
export type GuardianStudentRelationBody = z.infer<typeof guardianStudentRelationBodySchema>;
export type GuardianNotificationPreferenceBody = z.infer<typeof guardianNotificationPreferenceBodySchema>;

function hasAtLeastOneField(value: Record<string, unknown>): boolean {
  return Object.keys(value).length > 0;
}
