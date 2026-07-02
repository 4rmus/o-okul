import { z } from "zod";
import { portalSubjectRoles } from "@o-okul/shared-types";

const requiredText = (fieldName: string) => z.string().trim().min(1, `${fieldName} zorunludur.`);
const optionalText = () => z.string().trim();

const optionalNationalId = optionalText().refine((value) => !value || /^\d{11}$/.test(value), {
  message: "TC Kimlik No 11 rakam olmalıdır.",
}).refine((value) => !value || isValidTcIdentity(value), {
  message: "TC Kimlik No geçerli olmalıdır.",
});
const requiredNationalId = requiredText("TC kimlik no").refine((value) => /^\d{11}$/.test(value), {
  message: "TC Kimlik No 11 rakam olmalıdır.",
}).refine(isValidTcIdentity, {
  message: "TC Kimlik No geçerli olmalıdır.",
});

const optionalEmail = optionalText().refine((value) => !value || z.string().email().safeParse(value).success, {
  message: "E-posta geçerli olmalıdır.",
});
const requiredEmail = (fieldName: string) => requiredText(fieldName).email("E-posta geçerli olmalıdır.");
const requiredTurkishMobilePhone = (fieldName: string) => requiredText(fieldName).refine(isTurkishMobilePhone, {
  message: "Telefon geçerli bir Türkiye cep telefonu olmalıdır.",
});

const optionalDate = optionalText().refine((value) => !value || isCalendarDateString(value), {
  message: "Doğum tarihi geçerli olmalıdır.",
});

const optionalIsoDateTime = optionalText().refine((value) => !value || isIsoDateTimeString(value), {
  message: "Başlangıç geçerli olmalıdır.",
});

const requiredDateTime = (fieldName: string) => requiredText(fieldName).refine(isIsoDateTimeString, {
  message: `${fieldName} geçerli olmalıdır.`,
});

export const classFormSchema = z.object({
  name: requiredText("Sınıf adı"),
  alanId: optionalText(),
  campusId: optionalText(),
  gradeLevelId: optionalText(),
  section: optionalText(),
});

export const campusFormSchema = z.object({
  name: requiredText("Kampüs adı"),
  code: optionalText(),
});

export const gradeLevelFormSchema = z.object({
  name: requiredText("Seviye adı"),
  code: optionalText(),
});

export const academicYearFormSchema = z.object({
  name: requiredText("Akademik yıl adı"),
  startsAt: optionalDate.refine((value) => Boolean(value), { message: "Başlangıç zorunludur." }),
  endsAt: optionalDate.refine((value) => Boolean(value), { message: "Bitiş zorunludur." }),
  isActive: z.boolean(),
}).superRefine((value, context) => {
  if (Date.parse(value.startsAt) >= Date.parse(value.endsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Bitiş başlangıçtan sonra olmalıdır.",
      path: ["endsAt"],
    });
  }
});

export const academicTermFormSchema = z.object({
  academicYearId: requiredText("Akademik yıl"),
  name: requiredText("Dönem adı"),
  startsAt: optionalDate.refine((value) => Boolean(value), { message: "Başlangıç zorunludur." }),
  endsAt: optionalDate.refine((value) => Boolean(value), { message: "Bitiş zorunludur." }),
  isActive: z.boolean(),
}).superRefine((value, context) => {
  if (Date.parse(value.startsAt) >= Date.parse(value.endsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Bitiş başlangıçtan sonra olmalıdır.",
      path: ["endsAt"],
    });
  }
});

export const courseFormSchema = z.object({
  name: requiredText("Ders adı"),
  code: optionalText(),
});

export const learningOutcomeFormSchema = z.object({
  code: requiredText("Kazanım kodu"),
  branch: requiredText("Branş"),
  title: requiredText("Kazanım adı"),
  level: optionalText(),
});

export const examFormSchema = z.object({
  title: requiredText("Sınav adı"),
  startsAt: optionalIsoDateTime,
});

export const examWithClassFormSchema = examFormSchema.extend({
  alanId: optionalText(),
  classIds: z.array(z.string()).min(1, "En az bir sınıf seçilmelidir."),
  examType: z.enum(["", "SCHOOL", "LGS", "TYT", "AYT", "KPSS"]),
  gradeLevelId: optionalText(),
});

export const examParticipantFormSchema = z.object({
  studentId: requiredText("Öğrenci"),
  participantNo: optionalText(),
  bookletType: optionalText(),
});

export const tenantFormSchema = z.object({
  name: requiredText("Kurum adı"),
  slug: requiredText("Slug"),
  plan: z.enum(["TRIAL", "PRO", "ENTERPRISE"]),
  licenseStartsAt: optionalDate,
  licenseEndsAt: optionalDate,
  seatLimit: optionalText().transform((value, context) => {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Koltuk limiti pozitif tam sayı olmalıdır.",
      });
      return z.NEVER;
    }
    return parsed;
  }),
  status: z.enum(["ACTIVE", "SUSPENDED", "TRIAL"]),
}).superRefine((value, context) => {
  if (value.licenseStartsAt && value.licenseEndsAt && Date.parse(value.licenseStartsAt) >= Date.parse(value.licenseEndsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Lisans bitişi başlangıçtan sonra olmalıdır.",
      path: ["licenseEndsAt"],
    });
  }
});

export const tenantCreateFormSchema = tenantFormSchema.and(z.object({
  firstAdmin: z.object({
    name: requiredText("Admin ad soyad"),
    email: requiredEmail("Admin e-posta"),
    nationalId: requiredNationalId,
    phone: requiredTurkishMobilePhone("Admin telefon"),
  }).transform((value) => ({
    email: value.email,
    name: value.name,
    nationalId: value.nationalId,
    phone: value.phone,
  })),
}));

export const scheduleLessonFormSchema = z.object({
  classId: requiredText("Sınıf"),
  teacherId: requiredText("Öğretmen"),
  courseId: optionalText(),
  termId: optionalText(),
  title: requiredText("Ders başlığı"),
  startsAt: requiredDateTime("Başlangıç"),
  endsAt: requiredDateTime("Bitiş"),
}).superRefine((value, context) => {
  if (Date.parse(value.startsAt) >= Date.parse(value.endsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Bitiş başlangıçtan sonra olmalıdır.",
      path: ["endsAt"],
    });
  }
});

export const studySessionFormSchema = z.object({
  classId: requiredText("Sınıf"),
  teacherId: requiredText("Öğretmen"),
  courseId: optionalText(),
  termId: optionalText(),
  studentIds: z.array(z.string()).min(1, "En az bir öğrenci seçilmelidir."),
  title: requiredText("Etüt başlığı"),
  capacity: z.coerce.number().int("Kapasite tam sayı olmalıdır.").min(1, "Kapasite en az 1 olmalıdır."),
  startsAt: requiredDateTime("Başlangıç"),
  endsAt: requiredDateTime("Bitiş"),
}).superRefine((value, context) => {
  if (Date.parse(value.startsAt) >= Date.parse(value.endsAt)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Bitiş başlangıçtan sonra olmalıdır.",
      path: ["endsAt"],
    });
  }
  if (value.studentIds.length > value.capacity) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Kapasite öğrenci sayısından küçük olamaz.",
      path: ["capacity"],
    });
  }
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
  courseId: optionalText(),
  termId: optionalText(),
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
  studentNo: optionalText(),
  classId: optionalText(),
  responsibleTeacherId: optionalText(),
  status: z.enum(["ACTIVE", "PASSIVE", "GRADUATED", "TRANSFERRED"]),
  nationalId: optionalNationalId,
  phone: optionalText(),
  email: optionalEmail,
  guardianFirstName: optionalText(),
  guardianLastName: optionalText(),
  guardianPhone: optionalText(),
  guardianCanViewFinance: z.boolean(),
  guardianCanReceiveSms: z.boolean(),
  guardianCanReceiveAnnouncements: z.boolean(),
  guardianCanOpenSupportTickets: z.boolean(),
}).superRefine((value, context) => {
  const hasGuardianName = Boolean(value.guardianFirstName || value.guardianLastName);
  const hasGuardianContact = Boolean(value.guardianPhone);
  const hasGuardianInput = hasGuardianName || hasGuardianContact;
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
  if (hasGuardianInput && !value.guardianFirstName) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Veli adı zorunludur.",
      path: ["guardianFirstName"],
    });
  }
  if (hasGuardianInput && !value.guardianLastName) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Veli soyadı zorunludur.",
      path: ["guardianLastName"],
    });
  }
  if (hasGuardianInput && !hasGuardianContact) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Veli telefonu zorunludur.",
      path: ["guardianPhone"],
    });
  }
});

export const announcementFormSchema = z.object({
  title: requiredText("Başlık"),
  body: requiredText("Duyuru metni"),
  audience: z.enum(["SCHOOL", "TEACHERS", "STUDENTS", "GUARDIANS"]),
  campusId: optionalText(),
  gradeLevelId: optionalText(),
  classId: optionalText(),
  courseId: optionalText(),
  termId: optionalText(),
});

export const messageTemplateFormSchema = z.object({
  name: requiredText("Şablon adı"),
  body: requiredText("Mesaj metni"),
});

export const supportTicketFormSchema = z.object({
  subject: requiredText("Konu"),
  message: requiredText("Mesaj"),
  priority: z.enum(["LOW", "NORMAL", "HIGH"]),
  studentId: optionalText(),
  campusId: optionalText(),
  gradeLevelId: optionalText(),
  classId: optionalText(),
  courseId: optionalText(),
  termId: optionalText(),
});

export const homeworkMaterialFormSchema = z.object({
  title: requiredText("Materyal adı"),
  description: optionalText(),
});

export const userRolesSchema = z.array(z.enum(["TENANT_ADMIN", "ASSISTANT_ADMIN"])).min(1, "En az bir rol seçilmelidir.");

export const tenantUserFormSchema = z.object({
  email: requiredText("E-posta").email("E-posta geçerli olmalıdır."),
  name: requiredText("Ad Soyad"),
  nationalId: requiredNationalId,
  phone: requiredText("Telefon"),
  roles: userRolesSchema,
});

export const identityInvitationFormSchema = z.object({
  subjectType: z.enum(portalSubjectRoles),
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
      message: "Dosya seçilmelidir.",
      path: ["fileBase64"],
    });
  }
});

export const parserConfigApprovalFormSchema = z.object({
  examId: requiredText("Sınav ID"),
  version: requiredText("Format sürümü"),
});

export const answerKeyImportFormSchema = z.object({
  examId: requiredText("Sınav ID"),
  version: requiredText("Anahtar versiyonu"),
  fileBase64: requiredText("Cevap anahtarı dosyası"),
});

export const rawImportUploadFormSchema = z.object({
  examId: requiredText("Sınav ID"),
  parserConfigVersion: requiredText("Format sürümü"),
  sourceType: requiredText("Kaynak tipi"),
  fileName: requiredText("Optik dosya"),
  fileBase64: requiredText("Optik dosya"),
});

export const quarantineLookupFormSchema = z.object({
  examId: requiredText("Sınav ID"),
  rawImportId: requiredText("Yüklenen optik dosya"),
});

export const quarantineResolveFormSchema = z.object({
  resolvedStudentId: requiredText("Öğrenci"),
});

export const reportQueryFormSchema = z.object({
  examId: requiredText("Sınav"),
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

export const attendanceFormSchema = z.object({
  studentId: requiredText("Öğrenci"),
  courseId: optionalText(),
  termId: optionalText(),
  date: optionalDate.refine((value) => Boolean(value), { message: "Tarih zorunludur." }),
  status: z.enum(["PRESENT", "ABSENT", "LATE", "EXCUSED"]),
});

export const teacherNoteFormSchema = z.object({
  studentId: requiredText("Öğrenci"),
  teacherId: optionalText(),
  courseId: optionalText(),
  termId: optionalText(),
  visibility: z.enum(["INTERNAL", "GUARDIAN_STUDENT"]),
  body: requiredText("Not"),
  developmentStatus: optionalText(),
});

export const materialAssignmentFormSchema = z.object({
  materialId: requiredText("Materyal"),
  studentId: requiredText("Öğrenci"),
  courseId: optionalText(),
  termId: optionalText(),
  note: optionalText(),
  dueAt: optionalDate,
});

export type ClassFormState = z.input<typeof classFormSchema>;
export type ClassFormPayload = z.output<typeof classFormSchema>;
export type CampusFormState = z.input<typeof campusFormSchema>;
export type CampusFormPayload = z.output<typeof campusFormSchema>;
export type GradeLevelFormState = z.input<typeof gradeLevelFormSchema>;
export type GradeLevelFormPayload = z.output<typeof gradeLevelFormSchema>;
export type AcademicYearFormState = z.input<typeof academicYearFormSchema>;
export type AcademicYearFormPayload = z.output<typeof academicYearFormSchema>;
export type AcademicTermFormState = z.input<typeof academicTermFormSchema>;
export type AcademicTermFormPayload = z.output<typeof academicTermFormSchema>;
export type CourseFormState = z.input<typeof courseFormSchema>;
export type CourseFormPayload = z.output<typeof courseFormSchema>;
export type LearningOutcomeFormState = z.input<typeof learningOutcomeFormSchema>;
export type LearningOutcomeFormPayload = z.output<typeof learningOutcomeFormSchema>;
export type ExamFormState = z.input<typeof examFormSchema>;
export type ExamFormPayload = z.output<typeof examFormSchema>;
export type ExamWithClassFormState = z.input<typeof examWithClassFormSchema>;
export type ExamWithClassFormPayload = z.output<typeof examWithClassFormSchema>;
export type ExamParticipantFormState = z.input<typeof examParticipantFormSchema>;
export type ExamParticipantFormPayload = z.output<typeof examParticipantFormSchema>;
export type TenantFormState = z.input<typeof tenantFormSchema>;
export type TenantFormPayload = z.output<typeof tenantFormSchema>;
export type TenantCreateFormState = z.input<typeof tenantCreateFormSchema>;
export type TenantCreateFormPayload = z.output<typeof tenantCreateFormSchema>;
export type ScheduleLessonFormState = z.input<typeof scheduleLessonFormSchema>;
export type ScheduleLessonFormPayload = z.output<typeof scheduleLessonFormSchema>;
export type StudySessionFormState = z.input<typeof studySessionFormSchema>;
export type StudySessionFormPayload = z.output<typeof studySessionFormSchema>;
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
export type AnswerKeyImportFormPayload = z.output<typeof answerKeyImportFormSchema>;
export type RawImportUploadFormPayload = z.output<typeof rawImportUploadFormSchema>;
export type QuarantineLookupFormPayload = z.output<typeof quarantineLookupFormSchema>;
export type QuarantineResolveFormPayload = z.output<typeof quarantineResolveFormSchema>;
export type ReportQueryFormPayload = z.output<typeof reportQueryFormSchema>;
export type SupportTicketAttachmentFormPayload = z.output<typeof supportTicketAttachmentFormSchema>;
export type SupportTicketCommentFormPayload = z.output<typeof supportTicketCommentFormSchema>;
export type AttendanceFormState = z.input<typeof attendanceFormSchema>;
export type AttendanceFormPayload = z.output<typeof attendanceFormSchema>;
export type TeacherNoteFormState = z.input<typeof teacherNoteFormSchema>;
export type TeacherNoteFormPayload = z.output<typeof teacherNoteFormSchema>;
export type MaterialAssignmentFormPayload = z.output<typeof materialAssignmentFormSchema>;

export function firstFormError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Form bilgilerini kontrol edin.";
}

function isIsoDateTimeString(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  return Boolean(match?.[1] && isCalendarDateString(match[1]) && !Number.isNaN(Date.parse(value)));
}

function isCalendarDateString(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidTcIdentity(value: string): boolean {
  if (!/^[1-9]\d{10}$/.test(value)) return false;
  const digits = value.split("").map(Number);
  const digit = (index: number) => digits[index] ?? 0;
  const oddSum = digit(0) + digit(2) + digit(4) + digit(6) + digit(8);
  const evenSum = digit(1) + digit(3) + digit(5) + digit(7);
  const tenth = ((oddSum * 7) - evenSum) % 10;
  const total = digits.slice(0, 10).reduce((sum, current) => sum + current, 0) % 10;
  return digit(9) === tenth && digit(10) === total;
}

function isTurkishMobilePhone(value: string): boolean {
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("0090")) {
    digits = digits.slice(4);
  } else if (digits.startsWith("90") && digits.length === 12) {
    digits = digits.slice(2);
  }
  if (digits.startsWith("0") && digits.length === 11) {
    digits = digits.slice(1);
  }
  return /^5\d{9}$/.test(digits);
}
