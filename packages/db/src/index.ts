export const tenantScopedTables = [
  "TenantMembership",
  "Class",
  "Student",
  "Teacher",
  "Guardian",
  "GuardianStudent",
  "ScheduleLesson",
  "StudySession",
  "StudySessionStudent",
  "HomeworkMaterial",
  "HomeworkMaterialFile",
  "HomeworkMaterialAssignment",
  "Homework",
  "Exam",
  "ParserConfig",
  "ExamParticipant",
  "RawImport",
  "AnswerKey",
  "ExamBookletVariant",
  "ExamResult",
  "ParsedAnswer",
  "ImportQuarantine",
  "ReportSnapshot",
  "Announcement",
  "AnnouncementDeliveryReport",
  "MessageTemplate",
  "SmsBatchDeliveryReport",
  "SupportTicket",
  "SupportTicketAttachment",
  "SupportTicketComment",
  "AuditLog",
] as const;

export type TenantScopedTable = (typeof tenantScopedTables)[number];

export { createTenantPgPool } from "./pg-pool.js";
export { withTenantDb } from "./tenant-db.js";
export type { Queryable, TenantDbContext, TenantQueryable } from "./tenant-db.js";
