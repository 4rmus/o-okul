import { createHash } from "node:crypto";

export const tenantResetCatalog = {
  TenantMutationActivity: "PRESERVE", TenantFreshResetOperation: "PRESERVE", Tenant: "PRESERVE", LicenseTerm: "PRESERVE", LicenseUsage: "PRESERVE", AuditLog: "PRESERVE", BackupRestoreJob: "PRESERVE",
  PlatformAccount: "PRESERVE", PlatformIdempotencyKey: "PRESERVE", PlatformSession: "PRESERVE",
  User: "DELETE", TenantMembership: "DELETE", Employee: "DELETE",
  PaymentPlan: "BLOCK", PaymentInstallment: "BLOCK", PaymentTransaction: "BLOCK",
  SupportTicket: "BLOCK", SupportTicketAttachment: "BLOCK", SupportTicketComment: "BLOCK",
  WhatsAppConsent: "BLOCK", WhatsAppConsentEvent: "BLOCK",
  DevelopmentCriterion: "DELETE", DevelopmentAssessment: "DELETE", DevelopmentScore: "DELETE",
  GradeAssessment: "DELETE", GradeEntry: "DELETE",
  NotificationDeviceToken: "DELETE", MembershipCampusScope: "DELETE", AuthSession: "DELETE", IdempotencyKey: "DELETE",
  IdentityInvitation: "DELETE", ConsumedRefreshToken: "DELETE", PasswordResetToken: "DELETE", SecretDeliveryOutbox: "DELETE",
  Class: "DELETE", GradeLevel: "DELETE", Alan: "DELETE", Campus: "DELETE", Course: "DELETE", GradeLevelCourse: "DELETE",
  AcademicYear: "DELETE", AcademicTerm: "DELETE", Student: "DELETE", StudentEnrollment: "DELETE", Teacher: "DELETE",
  StudentContact: "DELETE", TeacherAssignment: "DELETE", Guardian: "DELETE", GuardianStudent: "DELETE",
  Attendance: "DELETE", TeacherNote: "DELETE", ScheduleLesson: "DELETE", StudySession: "DELETE", StudySessionStudent: "DELETE",
  HomeworkMaterial: "DELETE", HomeworkMaterialFile: "DELETE", HomeworkMaterialAssignment: "DELETE", Homework: "DELETE", HomeworkSubmission: "DELETE",
  Exam: "DELETE", ParserConfig: "DELETE", OpticalFormTemplate: "DELETE", ExamParticipant: "DELETE", RawImport: "DELETE",
  AnswerKey: "DELETE", ExamBookletVariant: "DELETE", LearningOutcome: "DELETE", ParsedAnswer: "DELETE", ExamResult: "DELETE",
  ImportQuarantine: "DELETE", ReportSnapshot: "DELETE", Announcement: "DELETE", AnnouncementReceipt: "DELETE",
  AnnouncementDeliveryReport: "DELETE", MessageTemplate: "DELETE", SmsBatchDeliveryReport: "DELETE",
} as const;
export type TenantResetTable = keyof typeof tenantResetCatalog;
export type ResetRow = Record<string, unknown>;
export type ResetTables = Record<TenantResetTable, ResetRow[]>;
export const tenantResetTableNames = Object.keys(tenantResetCatalog).sort() as TenantResetTable[];
export const tenantResetQueues = ["excel-import", "exam-evaluation", "report-generation", "sms-batch", "announcement-delivery", "backup-restore", "report-pdf-render"] as const;
export const tenantResetObjectFields = { RawImport: "s3Key", HomeworkMaterialFile: "storageKey", SupportTicketAttachment: "storageKey", Student: "photoKey" } as const;

export function resetDigest(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
export function assertResetCatalog(models: readonly string[]): void {
  if (stableJson([...models].sort()) !== stableJson(tenantResetTableNames)) throw new Error("RESET_CATALOG_UNCLASSIFIED_TABLE");
}

/** Every catalog table needs a restrictive reset-worker policy; only DELETE tables may grant DELETE to the worker. */
export function assertResetBoundaries(migrationSql: string): void {
  for (const [table, disposition] of Object.entries(tenantResetCatalog)) {
    if (!migrationSql.includes(`CREATE POLICY "${table}_reset_boundary"`) || !migrationSql.includes(`ON "${table}" AS RESTRICTIVE TO o_okul_reset_worker`)) throw new Error(`RESET_ROLE_BOUNDARY_MISSING:${table}`);
    if (disposition !== "DELETE" && migrationSql.includes(`GRANT DELETE ON "${table}" TO o_okul_reset_worker`)) throw new Error(`RESET_ROLE_DELETE_EXCESS:${table}`);
  }
}

export function resetOwnerMemberships(tables: ResetTables, now: Date): ResetRow[] {
  return tables.TenantMembership.filter((row) => row.staffRole === "TENANT_OWNER" && row.status === "ACTIVE" &&
    typeof row.startsAt === "string" && Date.parse(row.startsAt) <= now.getTime() &&
    (row.endsAt == null || Date.parse(String(row.endsAt)) > now.getTime()));
}
export function resetOwnerIds(tables: ResetTables, now: Date): Set<string> {
  return new Set(resetOwnerMemberships(tables, now).filter((membership) => {
    const users = tables.User.filter((row) => row.id === membership.userId && row.accountStatus === "ACTIVE" && row.membershipVersion === membership.version);
    const employees = tables.Employee.filter((row) => row.userId === membership.userId && row.status === "ACTIVE" && row.deletedAt == null);
    const active = tables.TenantMembership.filter((row) => row.userId === membership.userId && row.status === "ACTIVE" && (row.endsAt == null || Date.parse(String(row.endsAt)) > now.getTime()));
    return users.length === 1 && employees.length === 1 && active.filter((row) => row.staffRole != null || row.hasTeacherPersona || row.hasStudentPersona).length === 1 && !membership.hasStudentPersona && active.every((row) => ["TENANT_OWNER", "TENANT_ADMIN", "TEACHER"].includes(String(row.role))) && active.filter((row) => row.role !== "TEACHER").length === 1 &&
      ["TENANT_OWNER", "TENANT_ADMIN"].includes(String(membership.role)) &&
      active.some((row) => row.role === "TEACHER") === Boolean(membership.hasTeacherPersona) &&
      active.some((row) => row.role === "STUDENT") === Boolean(membership.hasStudentPersona);
  }).map((row) => String(row.userId)));
}

export function resetTableCounts(tables: ResetTables, now: Date) {
  const owners = resetOwnerIds(tables, now);
  const invalidOwners = new Set(resetOwnerMemberships(tables, now).map((row) => String(row.userId)).filter((id) => !owners.has(id)));
  return tenantResetTableNames.map((category) => {
    const rows = tables[category];
    const preserved = category === "User" ? rows.filter((row) => owners.has(String(row.id))).length :
      category === "TenantMembership" || category === "Employee" ? rows.filter((row) => owners.has(String(row.userId)) && (category !== "TenantMembership" || (row.staffRole === "TENANT_OWNER" && resetOwnerMemberships(tables, now).includes(row))) && (category !== "Employee" || (row.status === "ACTIVE" && row.deletedAt == null))).length :
        tenantResetCatalog[category] === "PRESERVE" ? rows.length : 0;
    const blocked = category === "User" ? rows.filter((row) => invalidOwners.has(String(row.id))).length : category === "TenantMembership" || category === "Employee" ? rows.filter((row) => invalidOwners.has(String(row.userId))).length : category === "StudentContact" ? rows.length : category === "GuardianStudent" ? rows.filter((row) => row.canReceiveSms || row.canReceiveAnnouncements).length : tenantResetCatalog[category] === "BLOCK" ? rows.length : 0;
    return { category, preserved, deleted: tenantResetCatalog[category] === "DELETE" ? rows.length - preserved - blocked : 0, blocked };
  });
}

// Reviewed scalar column boundary. New fields require an explicit catalog review.
export const tenantResetColumns: Record<TenantResetTable, readonly string[]> = {
  TenantMutationActivity: ["createdAt", "id", "kind", "lifecycleVersion", "referenceId", "status", "tenantId"],
  TenantFreshResetOperation: ["actorUserId", "backupReceipt", "createdAt", "errorCode", "expectedLifecycleVersion", "id", "idempotencyKey", "institutionRequestId", "phase", "preflightDigest", "preset", "reason", "requestHash", "result", "status", "tenantId", "updatedAt"],
  Tenant: ["contactEmail", "createdAt", "id", "institutionType", "licenseEndsAt", "licenseStartsAt", "lifecycleVersion", "logoUrl", "name", "plan", "resetRequest", "seatLimit", "slug", "status", "suspendedAt", "suspendedReason", "updatedAt"],
  PlatformAccount: ["createdAt", "email", "emailNormalized", "id", "loginName", "loginNameNormalized", "name", "passwordHash", "passwordHashVersion", "status", "totpEnabledAt", "totpSecretEncrypted", "updatedAt"],
  PlatformIdempotencyKey: ["completedAt", "createdAt", "id", "key", "operation", "platformAccountId", "requestHash", "responseBody", "status", "updatedAt"],
  PlatformSession: ["createdAt", "expiresAt", "id", "platformAccountId", "refreshTokenHash", "status", "tokenFamilyId", "updatedAt"],
  DevelopmentCriterion: ["createdAt", "deletedAt", "id", "name", "scaleMax", "scaleMin", "sortOrder", "tenantId", "updatedAt"],
  DevelopmentAssessment: ["createdAt", "id", "mentorNote", "periodLabel", "studentId", "teacherId", "tenantId", "termId", "updatedAt", "visibility"],
  DevelopmentScore: ["assessmentId", "createdAt", "criterionId", "id", "score", "tenantId", "updatedAt"],
  GradeAssessment: ["classId", "courseId", "createdAt", "createdById", "heldOn", "id", "kind", "maxScore", "notifiedVersion", "publishedVersion", "tenantId", "termId", "title", "updatedAt"],
  GradeEntry: ["absent", "assessmentId", "createdAt", "enteredById", "id", "publishedAt", "score", "studentId", "tenantId", "version"],
  User: ["accountStatus", "createdAt", "email", "emailNormalized", "id", "loginName", "loginNameNormalized", "membershipVersion", "mustChangePassword", "name", "nationalIdEncrypted", "nationalIdHash", "passwordChangedAt", "passwordHash", "passwordHashVersion", "tenantId", "totpEnabledAt", "totpLastUsedCounter", "totpRecoveryCodeHashes", "totpSecretEncrypted", "updatedAt"],
  NotificationDeviceToken: ["createdAt", "disabledAt", "id", "lastSeenAt", "platform", "provider", "subjectId", "subjectType", "tenantId", "token", "updatedAt", "userId"],
  TenantMembership: ["createdAt", "endedReason", "endsAt", "hasStudentPersona", "hasTeacherPersona", "id", "role", "scopeMode", "staffRole", "startsAt", "status", "tenantId", "updatedAt", "userId", "version"],
  MembershipCampusScope: ["campusId", "createdAt", "id", "membershipId", "tenantId"],
  LicenseTerm: ["activeStudentLimit", "auditReference", "cancelledAt", "createdAt", "createdByPlatformAccountId", "endsAt", "id", "planCode", "startsAt", "tenantId", "updatedAt"],
  LicenseUsage: ["activeStudentCount", "createdAt", "id", "licenseTermId", "peakActiveStudentCount", "reconciledAt", "tenantId", "updatedAt", "usageDate"],
  Employee: ["createdAt", "deletedAt", "employeeNo", "employmentEndsAt", "employmentStartsAt", "endedReason", "firstName", "id", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone", "status", "tenantId", "updatedAt", "userId", "workEmail"],
  AuthSession: ["activePersona", "clientIpPrefix", "createdAt", "deviceLabel", "expiresAt", "id", "lastSeenAt", "membershipId", "membershipVersion", "refreshTokenHash", "roles", "status", "subjectId", "subjectType", "tenantId", "tokenFamilyId", "updatedAt", "userId"],
  IdempotencyKey: ["completedAt", "createdAt", "expiresAt", "id", "key", "operation", "requestHash", "responseBody", "status", "tenantId", "updatedAt"],
  IdentityInvitation: ["acceptedAt", "acceptedUserId", "createdAt", "email", "expiresAt", "failedAttempts", "id", "kind", "maxAttempts", "name", "role", "status", "subjectId", "subjectType", "tenantId", "tokenHash", "updatedAt"],
  ConsumedRefreshToken: ["createdAt", "refreshTokenHash", "tokenFamilyId", "updatedAt"],
  PasswordResetToken: ["createdAt", "expiresAt", "id", "status", "tokenHash", "updatedAt", "usedAt", "userId"],
  SecretDeliveryOutbox: ["attempts", "availableAt", "claimToken", "claimedAt", "createdAt", "deliveredAt", "expiresAt", "id", "lastErrorCode", "payloadEncrypted", "providerMessageId", "purpose", "sourceId", "sourceScope", "status", "tenantId", "tenantLifecycleVersion", "updatedAt"],
  Class: ["alanId", "campusId", "createdAt", "deletedAt", "gradeLevelId", "id", "name", "section", "tenantId", "updatedAt"],
  GradeLevel: ["code", "createdAt", "deletedAt", "id", "name", "tenantId", "updatedAt"],
  Alan: ["code", "createdAt", "deletedAt", "gradeLevelId", "id", "name", "tenantId", "updatedAt"],
  Campus: ["code", "createdAt", "deletedAt", "id", "name", "tenantId", "unitType", "updatedAt"],
  Course: ["code", "createdAt", "deletedAt", "id", "name", "tenantId", "updatedAt"],
  GradeLevelCourse: ["alanId", "courseId", "createdAt", "gradeLevelId", "id", "isDefault", "sortOrder", "tenantId", "updatedAt"],
  AcademicYear: ["createdAt", "deletedAt", "endsAt", "id", "isActive", "name", "startsAt", "tenantId", "updatedAt"],
  AcademicTerm: ["academicYearId", "createdAt", "deletedAt", "endsAt", "id", "isActive", "name", "startsAt", "tenantId", "updatedAt"],
  Student: ["classId", "createdAt", "createdById", "deletedAt", "email", "firstName", "gradeLevelId", "id", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone", "photoKey", "responsibleTeacherId", "status", "studentNo", "tenantId", "updatedAt", "updatedById", "userId"],
  StudentEnrollment: ["academicYearId", "classId", "createdAt", "endsAt", "gradeLevelId", "id", "reason", "startsAt", "status", "studentId", "tenantId", "termId", "updatedAt"],
  Teacher: ["branch", "createdAt", "deletedAt", "employeeId", "firstName", "id", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone", "tenantId", "updatedAt", "userId"],
  StudentContact: ["canReceiveAnnouncements", "canReceiveFinance", "canReceiveSms", "consentRecordedAt", "consentSource", "createdAt", "deletedAt", "emailEncrypted", "emailHash", "firstName", "id", "lastName", "phoneEncrypted", "phoneHash", "relationType", "studentId", "tenantId", "updatedAt"],
  WhatsAppConsent: ["canReceiveWhatsapp", "createdAt", "id", "noticeVersion", "phoneHash", "purpose", "recordedAt", "source", "tenantId", "updatedAt", "version", "withdrawnAt"],
  WhatsAppConsentEvent: ["commandKeyHash", "createdAt", "eventType", "id", "noticeVersion", "purpose", "recordedAt", "requestHash", "sequence", "source", "studentContactId", "tenantId", "whatsappConsentId"],
  TeacherAssignment: ["classId", "courseId", "createdAt", "endsAt", "id", "role", "startsAt", "studentId", "teacherId", "tenantId", "termId", "updatedAt"],
  Guardian: ["createdAt", "deletedAt", "firstName", "id", "lastName", "nationalIdEncrypted", "nationalIdHash", "phone", "tenantId", "updatedAt", "userId"],
  GuardianStudent: ["canOpenSupportTickets", "canReceiveAnnouncements", "canReceiveSms", "canViewFinance", "createdAt", "guardianId", "id", "studentId", "tenantId", "updatedAt"],
  Attendance: ["courseId", "createdAt", "date", "deletedAt", "id", "status", "studentId", "tenantId", "termId", "updatedAt"],
  TeacherNote: ["body", "courseId", "createdAt", "deletedAt", "developmentStatus", "id", "studentId", "teacherId", "tenantId", "termId", "updatedAt", "visibility"],
  PaymentPlan: ["campusId", "classId", "courseId", "createdAt", "currency", "deletedAt", "gradeLevelId", "id", "studentId", "tenantId", "termId", "title", "totalAmount", "updatedAt"],
  PaymentInstallment: ["amount", "createdAt", "deletedAt", "dueDate", "id", "installmentNo", "paidAt", "planId", "status", "tenantId", "updatedAt"],
  PaymentTransaction: ["amount", "createdAt", "currency", "id", "installmentId", "method", "note", "paidAt", "planId", "receiptNo", "recordedByUserId", "tenantId", "updatedAt", "voidReason", "voidedAt"],
  ScheduleLesson: ["classId", "courseId", "createdAt", "deletedAt", "endsAt", "id", "startsAt", "teacherId", "tenantId", "termId", "title", "updatedAt"],
  StudySession: ["capacity", "classId", "courseId", "createdAt", "deletedAt", "endsAt", "id", "startsAt", "teacherId", "tenantId", "termId", "title", "updatedAt"],
  StudySessionStudent: ["createdAt", "id", "studentId", "studySessionId", "tenantId", "updatedAt"],
  HomeworkMaterial: ["createdAt", "deletedAt", "description", "id", "tenantId", "title", "updatedAt"],
  HomeworkMaterialFile: ["byteSize", "contentBase64", "contentType", "createdAt", "deletedAt", "fileName", "id", "materialId", "sha256", "storageKey", "tenantId", "updatedAt", "uploadedById"],
  HomeworkMaterialAssignment: ["assignedById", "courseId", "createdAt", "deletedAt", "dueAt", "id", "materialId", "note", "studentId", "tenantId", "termId", "updatedAt"],
  Homework: ["checkedAt", "checkedById", "classId", "createdAt", "deletedAt", "description", "dueAt", "id", "sourceMaterialId", "sourceMaterialTitle", "tenantId", "title", "updatedAt"],
  HomeworkSubmission: ["checkedAt", "checkedById", "createdAt", "homeworkId", "id", "studentId", "submittedAt", "tenantId", "updatedAt"],
  Exam: ["alanId", "createdAt", "deletedAt", "examType", "examYear", "gradeLevelId", "id", "linkedTytExamId", "scoringProfileId", "startsAt", "status", "tenantId", "title", "updatedAt"],
  ParserConfig: ["createdAt", "deletedAt", "delimiter", "encoding", "examId", "fieldMapping", "id", "skipHeaderLines", "status", "templateId", "tenantId", "updatedAt", "version"],
  OpticalFormTemplate: ["createdAt", "deletedAt", "delimiter", "encoding", "fieldMapping", "id", "name", "skipHeaderLines", "status", "tenantId", "updatedAt", "version"],
  ExamParticipant: ["bookletType", "createdAt", "deletedAt", "examId", "id", "participantNo", "status", "studentId", "tenantId", "updatedAt"],
  RawImport: ["createdAt", "deletedAt", "examId", "fileName", "id", "metadata", "parserConfigVersion", "s3Key", "sha256", "sourceType", "tenantId", "updatedAt"],
  AnswerKey: ["createdAt", "deletedAt", "examId", "id", "keyData", "publishedAt", "scoringConfig", "tenantId", "updatedAt", "version"],
  ExamBookletVariant: ["code", "createdAt", "deletedAt", "examId", "id", "permutation", "tenantId", "updatedAt"],
  LearningOutcome: ["branch", "code", "createdAt", "deletedAt", "id", "level", "tenantId", "title", "updatedAt"],
  ParsedAnswer: ["answers", "createdAt", "deletedAt", "examId", "id", "parserConfigVersion", "participantId", "rawImportId", "rowNumber", "status", "tenantId", "updatedAt"],
  ExamResult: ["answerKeyId", "answerKeyVersion", "computedAt", "createdAt", "deletedAt", "engineVersion", "examId", "id", "parserConfigVersion", "participantId", "rawImportId", "resultKey", "scoreData", "studentId", "tenantId", "updatedAt"],
  ImportQuarantine: ["createdAt", "deletedAt", "examId", "id", "rawImportId", "rawRow", "reason", "resolvedStudentId", "rowNumber", "status", "tenantId", "updatedAt"],
  ReportSnapshot: ["campusId", "classId", "contentHash", "courseId", "createdAt", "deletedAt", "examId", "generatedAt", "gradeLevelId", "id", "inputRefs", "reportType", "snapshotData", "staleAt", "status", "tenantId", "termId", "updatedAt"],
  Announcement: ["audience", "body", "campusId", "classId", "courseId", "createdAt", "deletedAt", "gradeLevelId", "id", "publishedAt", "tenantId", "termId", "title", "updatedAt"],
  AnnouncementReceipt: ["announcementId", "createdAt", "id", "readAt", "subjectId", "subjectType", "tenantId", "updatedAt", "userId"],
  AnnouncementDeliveryReport: ["announcementId", "channel", "createdAt", "deliveredCount", "failedCount", "id", "providerErrorCode", "recipientCount", "status", "tenantId", "updatedAt"],
  MessageTemplate: ["body", "channel", "createdAt", "deletedAt", "id", "name", "tenantId", "updatedAt"],
  SmsBatchDeliveryReport: ["billableSegments", "createdAt", "failedCount", "id", "jobId", "providerErrorCode", "recipientCount", "sentCount", "status", "templateId", "tenantId", "updatedAt"],
  BackupRestoreJob: ["checkedTables", "createdAt", "errorCode", "id", "jobId", "operationType", "queueName", "reason", "requestedByUserId", "result", "status", "targetReference", "tenantId", "updatedAt"],
  SupportTicket: ["campusId", "classId", "courseId", "createdAt", "deletedAt", "gradeLevelId", "id", "message", "priority", "requesterId", "status", "studentId", "subject", "tenantId", "termId", "updatedAt"],
  SupportTicketAttachment: ["byteSize", "contentBase64", "contentType", "createdAt", "deletedAt", "fileName", "id", "sha256", "storageKey", "tenantId", "ticketId", "updatedAt", "uploadedById"],
  SupportTicketComment: ["authorId", "body", "createdAt", "deletedAt", "id", "tenantId", "ticketId", "updatedAt"],
  AuditLog: ["action", "actorUserId", "createdAt", "diff", "entityId", "entityType", "id", "tenantId"],
};

export function assertResetColumns(columns: Record<string, readonly string[]>): void {
  if (resetDigest(columns) !== resetDigest(tenantResetColumns)) throw new Error("RESET_CATALOG_UNCLASSIFIED_COLUMN");
}
