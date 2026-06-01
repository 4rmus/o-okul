import { z } from "zod";

const requiredText = (fieldName: string) => z.string().trim().min(1, `${fieldName} zorunludur.`);
const optionalText = () => z.string().trim();

const optionalNationalId = optionalText().refine((value) => !value || /^\d{11}$/.test(value), {
  message: "TC Kimlik No 11 rakam olmalıdır.",
});

const optionalEmail = optionalText().refine((value) => !value || z.string().email().safeParse(value).success, {
  message: "E-posta geçerli olmalıdır.",
});

const optionalDate = optionalText().refine((value) => !value || /^\d{4}-\d{2}-\d{2}$/.test(value), {
  message: "Doğum tarihi geçerli olmalıdır.",
});

export const classFormSchema = z.object({
  name: requiredText("Sınıf adı"),
  level: optionalText(),
});

export const teacherFormSchema = z.object({
  firstName: requiredText("Ad"),
  lastName: requiredText("Soyad"),
  branch: optionalText(),
});

export const teacherAssignmentFormSchema = z.object({
  role: z.enum(["CLASS_TEACHER", "BRANCH_TEACHER", "GUIDANCE_COUNSELOR", "RESPONSIBLE_TEACHER"]),
  classId: optionalText(),
  studentId: optionalText(),
  startsAt: optionalDate,
  endsAt: optionalDate,
}).superRefine((value, context) => {
  if (!value.classId && !value.studentId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Atama için sınıf veya öğrenci seçilmelidir.",
      path: ["classId"],
    });
  }
});

export const guardianFormSchema = z.object({
  firstName: requiredText("Ad"),
  lastName: requiredText("Soyad"),
  phone: optionalText(),
});

export const studentFormSchema = z.object({
  firstName: requiredText("Ad"),
  lastName: requiredText("Soyad"),
  classId: optionalText(),
  responsibleTeacherId: optionalText(),
  status: z.enum(["ACTIVE", "PASSIVE"]),
  nationalId: optionalNationalId,
  phone: optionalText(),
  email: optionalEmail,
  birthDate: optionalDate,
  guardianFirstName: optionalText(),
  guardianLastName: optionalText(),
  guardianPhone: optionalText(),
}).superRefine((value, context) => {
  if (value.guardianFirstName && !value.guardianLastName) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Veli soyadı zorunludur.",
      path: ["guardianLastName"],
    });
  }
  if (!value.guardianFirstName && value.guardianLastName) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Veli adı zorunludur.",
      path: ["guardianFirstName"],
    });
  }
});

export const announcementFormSchema = z.object({
  title: requiredText("Başlık"),
  body: requiredText("Duyuru metni"),
  audience: z.enum(["SCHOOL", "TEACHERS"]),
});

export const messageTemplateFormSchema = z.object({
  name: requiredText("Şablon adı"),
  body: requiredText("Mesaj metni"),
});

export const supportTicketFormSchema = z.object({
  subject: requiredText("Konu"),
  message: requiredText("Mesaj"),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]),
});

export const homeworkMaterialFormSchema = z.object({
  title: requiredText("Materyal adı"),
  description: optionalText(),
});

export const userRolesSchema = z.array(z.enum(["TENANT_ADMIN", "TEACHER", "STUDENT", "GUARDIAN"])).min(1, "En az bir rol seçilmelidir.");

export const tenantUserFormSchema = z.object({
  email: requiredText("E-posta").email("E-posta geçerli olmalıdır."),
  name: requiredText("Ad Soyad"),
  password: z.string().min(8, "Şifre en az 8 karakter olmalıdır."),
  roles: userRolesSchema,
});

export const identityInvitationFormSchema = z.object({
  subjectType: z.enum(["STUDENT", "GUARDIAN", "TEACHER"]),
  subjectId: requiredText("Kişi"),
  email: requiredText("E-posta").email("E-posta geçerli olmalıdır."),
  name: optionalText(),
});

export const parserConfigSuggestionFormSchema = z.object({
  examId: requiredText("Sınav ID"),
  sampleText: optionalText(),
  fileBase64: optionalText(),
}).superRefine((value, context) => {
  if (!value.sampleText && !value.fileBase64) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Örnek içerik veya dosya zorunludur.",
      path: ["sampleText"],
    });
  }
});

export const parserConfigApprovalFormSchema = z.object({
  examId: requiredText("Sınav ID"),
  version: requiredText("Versiyon"),
});

export const reportQueryFormSchema = z.object({
  examId: requiredText("Rapor sınav ID"),
});

export const supportTicketAttachmentFormSchema = z.object({
  ticketId: requiredText("Ek bildirimi"),
  fileName: requiredText("Destek eki"),
  contentType: z.enum(["text/plain", "application/pdf", "image/jpeg", "image/png"]),
  fileBase64: requiredText("Destek eki"),
});

export const supportTicketCommentFormSchema = z.object({
  ticketId: requiredText("Yorum bildirimi"),
  body: requiredText("Yorum"),
});

export type ClassFormState = z.input<typeof classFormSchema>;
export type ClassFormPayload = z.output<typeof classFormSchema>;
export type TeacherFormState = z.input<typeof teacherFormSchema>;
export type TeacherFormPayload = z.output<typeof teacherFormSchema>;
export type TeacherAssignmentFormState = z.input<typeof teacherAssignmentFormSchema>;
export type TeacherAssignmentFormPayload = z.output<typeof teacherAssignmentFormSchema>;
export type GuardianFormState = z.input<typeof guardianFormSchema>;
export type GuardianFormPayload = z.output<typeof guardianFormSchema>;
export type StudentFormState = z.input<typeof studentFormSchema>;
export type StudentFormPayload = z.output<typeof studentFormSchema>;
export type AnnouncementFormState = z.input<typeof announcementFormSchema>;
export type AnnouncementFormPayload = z.output<typeof announcementFormSchema>;
export type MessageTemplateFormState = z.input<typeof messageTemplateFormSchema>;
export type MessageTemplateFormPayload = z.output<typeof messageTemplateFormSchema>;
export type SupportTicketFormState = z.input<typeof supportTicketFormSchema>;
export type SupportTicketFormPayload = z.output<typeof supportTicketFormSchema>;
export type HomeworkMaterialFormState = z.input<typeof homeworkMaterialFormSchema>;
export type HomeworkMaterialFormPayload = z.output<typeof homeworkMaterialFormSchema>;
export type UserRolesPayload = z.output<typeof userRolesSchema>;
export type TenantUserFormState = z.input<typeof tenantUserFormSchema>;
export type TenantUserFormPayload = z.output<typeof tenantUserFormSchema>;
export type IdentityInvitationFormState = z.input<typeof identityInvitationFormSchema>;
export type IdentityInvitationFormPayload = z.output<typeof identityInvitationFormSchema>;
export type ParserConfigSuggestionFormPayload = z.output<typeof parserConfigSuggestionFormSchema>;
export type ParserConfigApprovalFormPayload = z.output<typeof parserConfigApprovalFormSchema>;
export type ReportQueryFormPayload = z.output<typeof reportQueryFormSchema>;
export type SupportTicketAttachmentFormPayload = z.output<typeof supportTicketAttachmentFormSchema>;
export type SupportTicketCommentFormPayload = z.output<typeof supportTicketCommentFormSchema>;

export function firstFormError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Form bilgilerini kontrol edin.";
}
