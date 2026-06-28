import { existsSync, lstatSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, parse, resolve } from "node:path";

process.env.NODE_ENV ??= "test";
process.env.PERSISTENCE_DRIVER ??= "memory";
process.env.QUEUE_METRICS_ENABLED ??= "false";
process.env.LOGIN_ATTEMPT_LIMITER_STORE ??= "memory";
process.env.LOG_ENABLED ??= "false";
process.env.REPORT_PDF_RENDERER ??= "memory";
process.env.OPENAPI_UI_ENABLED = "false";

const outputTempPathError = "OPENAPI_OUTPUT lokal temp path olmamalı.";
const outputFileSymlinkError = "OPENAPI_OUTPUT symlink olmayan file artifact olmalı.";
const outputParentSymlinkError = "OPENAPI_OUTPUT parent dizini symlink olmayan dizin olmalı.";
const outputPath = validateOutputTarget(process.env.OPENAPI_OUTPUT || "artifacts/openapi.json");
const announcementAudiences = ["GUARDIANS", "SCHOOL", "STUDENTS", "TEACHERS"];
const announcementDeliveryChannels = ["EMAIL", "PUSH"];
const announcementDeliveryStatuses = ["completed", "failed", "queued"];
const announcementDeliveryResultStatuses = ["completed", "failed"];
const announcementRecipientTypes = ["GUARDIAN", "STUDENT", "TEACHER"];
const adminMfaModes = ["off", "optional", "required"];
const answerKeyStatuses = ["DRAFT", "PUBLISHED"];
const answerKeyRecordRequired = [
  "id",
  "tenantId",
  "examId",
  "version",
  "questionCount",
  "branches",
  "scoringConfig",
  "status",
  "createdAt",
  "updatedAt",
];
const answerKeyResponseForbidden = ["correctAnswer", "fileBase64", "keyData", "participantNo", "questions", "studentId"];
const guardianRecordRequired = ["id", "tenantId", "firstName", "lastName"];
const guardianStudentRecordRequired = [
  "id",
  "tenantId",
  "guardianId",
  "studentId",
  "canViewFinance",
  "canReceiveSms",
  "canReceiveAnnouncements",
  "canOpenSupportTickets",
];
const guardianStudentDetailStudentRequired = ["id", "firstName", "lastName", "status", "hasPortalUser"];
const paymentInstallmentStatuses = ["PENDING", "PAID", "OVERDUE", "CANCELED"];
const paymentPlanWithInstallmentsRequired = ["id", "tenantId", "studentId", "title", "totalAmount", "currency", "createdAt", "installments"];
const paymentPlanPortalForbiddenDeep = [
  "birthDate",
  "contentBase64",
  "downloadUrl",
  "email",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "password",
  "phone",
  "photoKey",
  "rawRow",
  "refreshToken",
  "s3Key",
  "storageKey",
  "token",
  "tokenHash",
  "userId",
];
const parserConfigSuggestionRequestAlternatives = [["sampleText"], ["fileBase64"], ["preset"]];
const parserDelimiters = ["COMMA", "FIXED", "PIPE", "TAB"];
const opticalFormTemplateRecordRequired = [
  "id",
  "tenantId",
  "name",
  "version",
  "encoding",
  "delimiter",
  "skipHeaderLines",
  "fieldMapping",
  "status",
  "createdAt",
  "updatedAt",
];
const opticalFormTemplateForbiddenDeep = [
  "contentBase64",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "rawRow",
  "sampleText",
  "token",
  "tokenHash",
];
const rawImportEvaluationStatuses = ["COMPLETED", "RUNNING"];
const rawImportQuarantineStatuses = ["OPEN", "RESOLVED"];
const rawImportQuarantineRecordRequired = [
  "id",
  "tenantId",
  "examId",
  "rawImportId",
  "rowNumber",
  "rawRow",
  "reason",
  "status",
  "createdAt",
  "updatedAt",
];
const rawImportResponseForbidden = [
  "contentBase64",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "phone",
  "s3Key",
  "token",
];
const reportSnapshotStatuses = ["READY", "STALE"];
const reportQuestionStatuses = ["BLANK", "CORRECT", "WRONG"];
const reportSnapshotRecordRequired = ["id", "tenantId", "examId", "reportType", "status", "inputRefs", "createdAt", "updatedAt"];
const reportStudentSnapshotForbiddenDeep = [
  "answer",
  "contentBase64",
  "correctAnswer",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "phone",
  "questions",
  "rawRow",
  "s3Key",
  "storageKey",
];
const reportExportForbidden = ["contentBase64", "objectKey", "rawRow", "s3Key", "snapshotData", "storageKey"];
const reportDetailForbiddenDeep = [
  "birthDate",
  "contentBase64",
  "email",
  "fileBase64",
  "guardian",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "phone",
  "photoKey",
  "rawRow",
  "s3Key",
  "storageKey",
  "token",
  "userId",
];
const reportSnapshotListForbiddenDeep = [
  ...reportDetailForbiddenDeep,
  "answer",
  "bookletType",
  "commentary",
  "correctAnswer",
  "outcomes",
  "participantNo",
  "questions",
  "statistics",
  "studentName",
];
const reportProgressForbiddenDeep = [
  ...reportDetailForbiddenDeep,
  "answer",
  "correctAnswer",
  "outcomes",
  "questions",
];
const reportErrorBookletForbidden = [
  "bookletType",
  "branches",
  "classId",
  "className",
  "commentary",
  "outcomes",
  "participantNo",
  "resultKey",
  "statistics",
  "studentName",
  "total",
];
const reportStudentSnapshotRequired = ["tenantId", "examId", "snapshotId", "studentId", "resultKey", "total", "branches"];
const reportErrorBookletRequired = ["tenantId", "examId", "snapshotId", "studentId", "items"];
const reportStudentSnapshotFieldChecks = [
  { path: ["responseData", "total", "questionCount"], minimum: 0 },
  { path: ["responseData", "total", "successRate"], minimum: 0 },
  { path: ["responseData", "branches", "items", "questionCount"], minimum: 0 },
  { path: ["responseData", "branches", "items", "successRate"], minimum: 0 },
  { path: ["responseData", "outcomes", "items", "questionCount"], minimum: 0 },
  { path: ["responseData", "outcomes", "items", "successRate"], minimum: 0 },
  { path: ["responseData", "questions", "items", "questionNo"], minimum: 1 },
  { path: ["responseData", "questions", "items", "status"], enum: reportQuestionStatuses },
  { path: ["responseData", "generatedAt"], format: "date-time" },
];
const reportErrorBookletFieldChecks = [
  { path: ["responseData", "items", "items", "questionNo"], minimum: 1 },
  { path: ["responseData", "items", "items", "status"], enum: reportQuestionStatuses },
  { path: ["responseData", "generatedAt"], format: "date-time" },
];
const reportProgressFieldChecks = [
  { path: ["responseData", "points", "items", "total", "questionCount"], minimum: 0 },
  { path: ["responseData", "points", "items", "total", "successRate"], minimum: 0 },
  { path: ["responseData", "points", "items", "branches", "items", "questionCount"], minimum: 0 },
  { path: ["responseData", "points", "items", "branches", "items", "successRate"], minimum: 0 },
];
const reportSnapshotListFieldChecks = [
  { path: ["responseDataItem", "status"], enum: reportSnapshotStatuses },
  { path: ["responseDataItem", "createdAt"], format: "date-time" },
  { path: ["responseDataItem", "updatedAt"], format: "date-time" },
  { path: ["responseDataItem", "snapshotData", "resultCount"], minimum: 0 },
  { path: ["responseDataItem", "snapshotData", "averages", "questionCount"], minimum: 0 },
  { path: ["responseDataItem", "snapshotData", "averages", "successRate"], minimum: 0 },
  { path: ["responseDataItem", "snapshotData", "branches", "items", "questionCount"], minimum: 0 },
  { path: ["responseDataItem", "snapshotData", "branches", "items", "successRate"], minimum: 0 },
  { path: ["responseDataItem", "snapshotData", "classes", "items", "resultCount"], minimum: 0 },
  { path: ["responseDataItem", "snapshotData", "classes", "items", "averages", "questionCount"], minimum: 0 },
  { path: ["responseDataItem", "snapshotData", "classes", "items", "averages", "successRate"], minimum: 0 },
  { path: ["responseDataItem", "snapshotData", "classes", "items", "branches", "items", "questionCount"], minimum: 0 },
  { path: ["responseDataItem", "snapshotData", "classes", "items", "branches", "items", "successRate"], minimum: 0 },
  { path: ["responseDataItem", "snapshotData", "students", "items", "total", "questionCount"], minimum: 0 },
  { path: ["responseDataItem", "snapshotData", "students", "items", "total", "successRate"], minimum: 0 },
];
const portalReportSnapshotListPaths = [
  "/api/v1/me/teacher/reports/{examId}/snapshots",
];
const portalReportStudentSnapshotPaths = [
  "/api/v1/me/student/reports/{examId}/snapshots/{snapshotId}",
  "/api/v1/me/student/reports/{examId}/latest",
  "/api/v1/me/teacher/reports/{examId}/snapshots/{snapshotId}/students/{studentId}",
  "/api/v1/me/guardian/students/{studentId}/reports/{examId}/snapshots/{snapshotId}",
  "/api/v1/me/guardian/students/{studentId}/reports/{examId}/latest",
];
const portalReportErrorBookletPaths = [
  "/api/v1/me/student/reports/{examId}/snapshots/{snapshotId}/error-booklet",
  "/api/v1/me/student/reports/{examId}/latest/error-booklet",
  "/api/v1/me/teacher/reports/{examId}/snapshots/{snapshotId}/students/{studentId}/error-booklet",
  "/api/v1/me/guardian/students/{studentId}/reports/{examId}/snapshots/{snapshotId}/error-booklet",
  "/api/v1/me/guardian/students/{studentId}/reports/{examId}/latest/error-booklet",
];
const portalReportProgressPaths = [
  "/api/v1/me/student/reports/{examId}/progress",
  "/api/v1/me/teacher/reports/{examId}/students/{studentId}/progress",
  "/api/v1/me/guardian/students/{studentId}/reports/{examId}/progress",
];
const portalReportOperationContracts = [
  ...portalReportSnapshotListPaths.map((path) => ({
    method: "get",
    path,
    responseListEnvelope: true,
    responseDataItemsRequired: reportSnapshotRecordRequired,
    responseDataForbiddenDeep: reportSnapshotListForbiddenDeep,
    fieldChecks: reportSnapshotListFieldChecks,
  })),
  ...portalReportStudentSnapshotPaths.map((path) => ({
    method: "get",
    path,
    responseEnvelope: true,
    responseDataRequired: reportStudentSnapshotRequired,
    responseDataForbiddenDeep: reportDetailForbiddenDeep,
    fieldChecks: reportStudentSnapshotFieldChecks,
  })),
  ...portalReportErrorBookletPaths.map((path) => ({
    method: "get",
    path,
    responseEnvelope: true,
    responseDataRequired: reportErrorBookletRequired,
    responseDataForbiddenDeep: [...reportDetailForbiddenDeep, ...reportErrorBookletForbidden],
    fieldChecks: reportErrorBookletFieldChecks,
  })),
  ...portalReportProgressPaths.map((path) => ({
    method: "get",
    path,
    responseEnvelope: true,
    responseDataRequired: ["tenantId", "examId", "studentId", "points"],
    responseDataForbiddenDeep: reportProgressForbiddenDeep,
    fieldChecks: reportProgressFieldChecks,
  })),
];
const studentStatuses = ["ACTIVE", "GRADUATED", "PASSIVE", "TRANSFERRED"];
const attendanceStatuses = ["ABSENT", "EXCUSED", "LATE", "PRESENT"];
const auditLogCategories = ["academic", "finance", "identity", "invitation", "kvkk", "operation", "report", "tenant", "user"];
const authResponseForbiddenDeep = [
  "passwordHash",
  "refreshToken",
  "refreshTokenHash",
  "tokenFamilyId",
  "totpLastUsedCounter",
  "totpRecoveryCodeHashes",
  "totpSecretEncrypted",
];
const developmentAssessmentVisibilities = ["GUARDIAN", "INTERNAL"];
const developmentTrendItemRequired = ["id", "periodLabel", "visibility", "scores"];
const developmentTrendForbiddenDeep = [
  "assessmentId",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "phone",
  "studentId",
  "teacherId",
  "tenantId",
  "userId",
];
const examStatuses = ["DRAFT", "PUBLISHED"];
const examParticipantStatuses = ["REGISTERED", "ATTENDED", "ABSENT"];
const supportTicketPriorities = ["HIGH", "LOW", "NORMAL"];
const supportTicketStatuses = ["CLOSED", "IN_PROGRESS", "OPEN", "RESOLVED"];
const messageTemplateForbiddenDeep = [
  "birthDate",
  "contentBase64",
  "deletedAt",
  "downloadUrl",
  "email",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "phone",
  "photoKey",
  "rawRow",
  "s3Key",
  "storageKey",
  "token",
  "userId",
];
const messageTemplateRequired = ["id", "tenantId", "name", "channel", "body"];
const messageTemplateChannels = ["SMS"];
const identityInvitationSubjectTypes = ["GUARDIAN", "STUDENT", "TEACHER"];
const identityInvitationStatuses = ["ACCEPTED", "PENDING"];
const identityInvitationRecordRequired = [
  "id",
  "tenantId",
  "subjectType",
  "subjectId",
  "email",
  "name",
  "role",
  "status",
  "expiresAt",
  "createdAt",
  "updatedAt",
];
const identityInvitationResponseForbiddenDeep = [
  "acceptedUserId",
  "activationToken",
  "password",
  "refreshToken",
  "refreshTokenHash",
  "token",
  "tokenHash",
];
const portalSupportTicketForbiddenDeep = [
  "attachment",
  "attachments",
  "birthDate",
  "contentBase64",
  "deletedAt",
  "downloadUrl",
  "email",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "nationalIdMasked",
  "objectKey",
  "phone",
  "photoKey",
  "rawRow",
  "requesterId",
  "s3Key",
  "storageKey",
  "token",
  "userId",
];
const portalSupportTicketResponseRequired = ["id", "tenantId", "subject", "message", "priority", "status", "createdAt"];
const portalSupportTicketStudentPaths = [
  "/api/v1/me/student/support-tickets",
  "/api/v1/me/guardian/students/{studentId}/support-tickets",
];
const portalSupportTicketTeacherPaths = [
  "/api/v1/me/teacher/support-tickets",
];
const teacherRecordRequired = ["id", "tenantId", "firstName", "lastName"];
const teacherResponseForbidden = [
  "downloadUrl",
  "email",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "photoKey",
  "token",
  "userId",
];
const teacherPortalReadForbiddenDeep = [
  "contentBase64",
  "downloadUrl",
  "email",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "password",
  "phone",
  "photoKey",
  "rawRow",
  "refreshToken",
  "s3Key",
  "storageKey",
  "token",
  "tokenHash",
  "userId",
];
const teacherPortalLookupsRequired = ["campuses", "classes", "courses", "gradeLevels", "terms"];
const teacherPortalLookupsFieldChecks = [
  { path: ["responseData", "campuses", "items", "id"], type: "string" },
  { path: ["responseData", "classes", "items", "id"], type: "string" },
  { path: ["responseData", "courses", "items", "id"], type: "string" },
  { path: ["responseData", "gradeLevels", "items", "id"], type: "string" },
  { path: ["responseData", "terms", "items", "id"], type: "string" },
];
const studentAcademicTimelineForbiddenDeep = [
  "contentBase64",
  "downloadUrl",
  "email",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "phone",
  "photoKey",
  "rawRow",
  "s3Key",
  "storageKey",
  "token",
  "userId",
];
const studentAcademicTimelineClassHistoryPaths = [
  "/api/v1/me/student/class-history",
  "/api/v1/me/guardian/students/{studentId}/class-history",
];
const studentAcademicTimelineEnrollmentPaths = [
  "/api/v1/me/student/enrollments",
  "/api/v1/me/guardian/students/{studentId}/enrollments",
];
const studentAcademicTimelineAttendancePaths = [
  "/api/v1/me/student/attendance",
  "/api/v1/me/guardian/students/{studentId}/attendance",
];
const studentAcademicTimelineAttendanceSummaryPaths = [
  "/api/v1/me/student/attendance/summary",
  "/api/v1/me/guardian/students/{studentId}/attendance/summary",
];
const studentAcademicTimelineTeacherNotePaths = [
  "/api/v1/me/student/teacher-notes",
  "/api/v1/me/guardian/students/{studentId}/teacher-notes",
];
const studentCoreForbiddenDeep = [
  "birthDate",
  "contentBase64",
  "downloadUrl",
  "email",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "phone",
  "photoKey",
  "rawRow",
  "s3Key",
  "storageKey",
  "token",
  "userId",
];
const studentProfileForbiddenDeep = [
  "contentBase64",
  "downloadUrl",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "rawRow",
  "s3Key",
  "storageKey",
  "token",
  "userId",
];
const studentCoreRequired = ["id", "tenantId", "firstName", "lastName", "status"];
const studentCorePaths = [
  "/api/v1/students",
];
const studentCoreItemPaths = [
  "/api/v1/students/{id}",
];
const studentProfilePaths = [
  "/api/v1/students/{id}/profile",
];
const studentImportRequestForbidden = [
  "birthDate",
  "classId",
  "email",
  "firstName",
  "lastName",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "phone",
  "photoKey",
  "rawRow",
  "studentId",
  "studentIds",
  "tenantId",
  "token",
  "userId",
];
const studentEnrollmentResponseRequired = ["id", "tenantId", "studentId", "status", "startsAt"];
const studentEnrollmentForbiddenDeep = [
  "birthDate",
  "contentBase64",
  "downloadUrl",
  "email",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "phone",
  "photoKey",
  "rawRow",
  "s3Key",
  "storageKey",
  "token",
  "userId",
];
const studentEnrollmentActionPaths = [
  "/api/v1/students/{id}/enrollments/renew",
  "/api/v1/students/{id}/enrollments/transfer",
];
const portalStudentRecordForbiddenDeep = [
  "birthDate",
  "contentBase64",
  "downloadUrl",
  "email",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "phone",
  "photoKey",
  "rawRow",
  "s3Key",
  "storageKey",
  "token",
  "userId",
];
const portalStudentProfileForbiddenDeep = [
  "contentBase64",
  "downloadUrl",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "rawRow",
  "s3Key",
  "storageKey",
  "token",
  "userId",
];
const portalStudentProfilePaths = [
  "/api/v1/me/student/profile",
  "/api/v1/me/guardian/students/{studentId}/profile",
];
const kvkkInventoryKinds = ["guardian", "student", "teacher"];
const kvkkInventoryRecordRequired = ["id", "kind", "displayRef", "piiCategories", "purgeAvailable"];
const kvkkInventoryForbiddenDeep = [
  "birthDate",
  "contentBase64",
  "downloadUrl",
  "email",
  "fileBase64",
  "firstName",
  "lastName",
  "name",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "password",
  "phone",
  "photoKey",
  "rawRow",
  "refreshToken",
  "s3Key",
  "storageKey",
  "token",
  "tokenHash",
  "userId",
];
const selfPurgeResultRequired = ["userId", "purgedAt"];
const selfPurgeForbiddenDeep = [
  "accessToken",
  "birthDate",
  "contentBase64",
  "downloadUrl",
  "email",
  "fileBase64",
  "firstName",
  "lastName",
  "name",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "password",
  "passwordHash",
  "phone",
  "photoKey",
  "rawRow",
  "refreshToken",
  "refreshTokenHash",
  "s3Key",
  "storageKey",
  "token",
  "tokenHash",
];
const meProfileForbiddenDeep = [
  "birthDate",
  "contentBase64",
  "email",
  "fileBase64",
  "firstName",
  "lastName",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "password",
  "phone",
  "photoKey",
  "rawRow",
  "refreshToken",
  "s3Key",
  "storageKey",
  "token",
];
const tenantRecordRequired = ["id", "name", "slug", "plan", "status"];
const tenantRecordForbiddenDeep = [
  "activationToken",
  "firstAdmin",
  "password",
  "passwordHash",
  "refreshToken",
  "token",
  "tokenHash",
];
const tenantAdminUpdateRequestProperties = [
  "contactEmail",
  "institutionType",
  "licenseEndsAt",
  "licenseStartsAt",
  "logoUrl",
  "name",
  "plan",
  "seatLimit",
  "slug",
  "status",
];
const tenantAdminUpdateRequestForbidden = [
  "activeSeatCount",
  "activationToken",
  "firstAdmin",
  "id",
  "password",
  "passwordHash",
  "refreshToken",
  "token",
  "tokenHash",
];
const tenantCreateRequestProperties = [
  "contactEmail",
  "firstAdmin",
  "id",
  "institutionType",
  "licenseEndsAt",
  "licenseStartsAt",
  "logoUrl",
  "name",
  "plan",
  "seatLimit",
  "slug",
  "status",
];
const tenantCreateRequestForbidden = [
  "activeSeatCount",
  "activationToken",
  "activationTokenExpiresAt",
  "activationTokenIssued",
  "admin",
  "passwordHash",
  "refreshToken",
  "tenant",
  "token",
  "tokenHash",
];
const tenantCreateResponseForbiddenDeep = [
  ...tenantRecordForbiddenDeep,
  "activationToken",
  "password",
  "passwordHash",
  "refreshToken",
  "refreshTokenHash",
  "token",
  "tokenHash",
];
const tenantCreateFieldChecks = [
  { path: ["requestBody", "contactEmail"], format: "email" },
  { path: ["requestBody", "firstAdmin", "email"], format: "email" },
  { path: ["requestBody", "firstAdmin", "name"], minLength: 1 },
  { path: ["requestBody", "firstAdmin", "nationalId"], minLength: 11 },
  { path: ["requestBody", "firstAdmin", "phone"], minLength: 1 },
  { path: ["requestBody", "licenseEndsAt"], format: "date-time" },
  { path: ["requestBody", "licenseStartsAt"], format: "date-time" },
  { path: ["requestBody", "name"], minLength: 1 },
  { path: ["requestBody", "seatLimit"], minimum: 1 },
  { path: ["requestBody", "slug"], minLength: 1 },
];
const tenantCurrentProfileRequestProperties = ["contactEmail", "institutionType", "logoUrl", "name"];
const tenantCurrentProfileRequestForbidden = [
  "activeSeatCount",
  "firstAdmin",
  "id",
  "licenseEndsAt",
  "licenseStartsAt",
  "plan",
  "seatLimit",
  "slug",
  "status",
];
const tenantAssignableRoles = ["ASSISTANT_ADMIN", "GUARDIAN", "STUDENT", "TEACHER", "TENANT_ADMIN"];
const tenantUserManagementRoles = ["ASSISTANT_ADMIN", "TENANT_ADMIN"];
const tenantUserRecordRequired = ["id", "name", "tenantId", "roles", "createdAt", "updatedAt"];
const tenantUserPasswordResetRequired = ["userId", "resetAt", "mustChangePassword"];
const tenantUserResponseForbiddenDeep = [
  "activationToken",
  "password",
  "passwordHash",
  "refreshToken",
  "refreshTokenHash",
  "token",
  "tokenHash",
];
const tenantUserCreateRequestForbidden = [
  "activationToken",
  "id",
  "password",
  "passwordHash",
  "refreshToken",
  "refreshTokenHash",
  "tenantId",
  "token",
  "tokenHash",
];
const tenantUserRoleUpdateRequestForbidden = [
  "activationToken",
  "email",
  "id",
  "name",
  "password",
  "passwordHash",
  "refreshToken",
  "refreshTokenHash",
  "tenantId",
  "token",
  "tokenHash",
];
const tenantRecordFieldChecks = [
  { path: ["responseData", "contactEmail"], format: "email" },
  { path: ["responseData", "licenseEndsAt"], format: "date-time" },
  { path: ["responseData", "licenseStartsAt"], format: "date-time" },
  { path: ["responseData", "seatLimit"], minimum: 1 },
  { path: ["responseData", "activeSeatCount"], minimum: 0 },
];
const tenantRecordListFieldChecks = [
  { path: ["responseDataItem", "contactEmail"], format: "email" },
  { path: ["responseDataItem", "licenseEndsAt"], format: "date-time" },
  { path: ["responseDataItem", "licenseStartsAt"], format: "date-time" },
  { path: ["responseDataItem", "seatLimit"], minimum: 1 },
  { path: ["responseDataItem", "activeSeatCount"], minimum: 0 },
];
const tenantUserRecordFieldChecks = [
  { path: ["responseData", "email"], format: "email" },
  { path: ["responseData", "roles"], minItems: 1 },
  { path: ["responseData", "roles", "items"], enum: tenantAssignableRoles },
  { path: ["responseData", "createdAt"], format: "date-time" },
  { path: ["responseData", "updatedAt"], format: "date-time" },
];
const tenantUserRecordListFieldChecks = [
  { path: ["responseDataItem", "email"], format: "email" },
  { path: ["responseDataItem", "roles"], minItems: 1 },
  { path: ["responseDataItem", "roles", "items"], enum: tenantAssignableRoles },
  { path: ["responseDataItem", "createdAt"], format: "date-time" },
  { path: ["responseDataItem", "updatedAt"], format: "date-time" },
];
const portalSubjectRoles = ["GUARDIAN", "STUDENT", "TEACHER"];
const rolePreviewSessionRequired = [
  "id",
  "tenantId",
  "actorUserId",
  "targetRole",
  "targetSubjectType",
  "targetSubjectId",
  "mode",
  "expiresAt",
  "createdAt",
  "previewToken",
];
const rolePreviewRequestForbidden = [
  "accessToken",
  "actorUserId",
  "activationToken",
  "createdAt",
  "expiresAt",
  "id",
  "mode",
  "password",
  "passwordHash",
  "previewToken",
  "refreshToken",
  "refreshTokenHash",
  "tenantId",
  "tokenHash",
];
const rolePreviewResponseForbiddenDeep = [
  "accessToken",
  "activationToken",
  "password",
  "passwordHash",
  "refreshToken",
  "refreshTokenHash",
  "tokenHash",
];
const rolePreviewFieldChecks = [
  { path: ["requestBody", "targetRole"], enum: portalSubjectRoles },
  { path: ["requestBody", "targetSubjectId"], minLength: 1 },
  { path: ["responseData", "targetRole"], enum: portalSubjectRoles },
  { path: ["responseData", "targetSubjectType"], enum: portalSubjectRoles },
  { path: ["responseData", "mode"], enum: ["READ_ONLY"] },
  { path: ["responseData", "expiresAt"], format: "date-time" },
  { path: ["responseData", "createdAt"], format: "date-time" },
  { path: ["responseData", "previewToken"], minLength: 1 },
];
const portalHomeworkMaterialAssignmentRequired = ["id", "tenantId", "materialId", "studentId", "createdAt"];
const portalHomeworkMaterialAssignmentForbiddenDeep = [
  "birthDate",
  "contentBase64",
  "email",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "password",
  "phone",
  "photoKey",
  "rawRow",
  "refreshToken",
  "s3Key",
  "storageKey",
  "token",
  "tokenHash",
  "userId",
];
const portalHomeworkMaterialAssignmentFieldChecks = [
  { path: ["responseDataItem", "dueAt"], format: "date-time" },
  { path: ["responseDataItem", "createdAt"], format: "date-time" },
];
const guardianNotificationPreferenceRequestProperties = [
  "canOpenSupportTickets",
  "canReceiveAnnouncements",
  "canReceiveSms",
  "canViewFinance",
];
const guardianNotificationPreferenceRequestForbidden = [
  "contentBase64",
  "email",
  "guardianId",
  "id",
  "nationalId",
  "password",
  "phone",
  "studentId",
  "tenantId",
  "token",
  "userId",
];
const guardianNotificationPreferenceForbiddenDeep = [
  "birthDate",
  "contentBase64",
  "email",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "password",
  "phone",
  "photoKey",
  "rawRow",
  "refreshToken",
  "s3Key",
  "storageKey",
  "token",
  "tokenHash",
  "userId",
];
const notificationDeviceForbiddenDeep = [
  "contentBase64",
  "email",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "phone",
  "rawRow",
  "s3Key",
  "storageKey",
  "token",
  "userId",
];
const notificationDeviceResponseRequired = ["id", "tenantId", "provider", "lastSeenAt"];
const teacherAssignmentRecordRequired = ["id", "tenantId", "teacherId", "role"];
const teacherAssignmentRoles = ["BRANCH_TEACHER", "CLASS_TEACHER", "GUIDANCE_COUNSELOR", "RESPONSIBLE_TEACHER"];
const teacherNoteVisibilities = ["GUARDIAN_STUDENT", "INTERNAL"];
const uploadContentTypes = ["application/pdf", "image/jpeg", "image/png", "text/plain"];
const fileDownloadRequired = ["fileName", "contentType", "byteSize", "sha256", "downloadMode"];
const fileDownloadForbiddenDeep = ["contentBase64", "objectKey", "rawRow", "s3Key", "storageKey", "token", "tokenHash"];
const fileDownloadFieldChecks = [
  { path: ["responseData", "contentType"], enum: uploadContentTypes },
  { path: ["responseData", "byteSize"], minimum: 1 },
  { path: ["responseData", "downloadMode"], enum: ["inline", "signed-url"] },
  { path: ["responseData", "downloadUrlExpiresInSeconds"], minimum: 0 },
  { path: ["responseData", "downloadUrlExpiresAt"], format: "date-time" },
];
const backupRestoreOperationTypes = ["BACKUP", "RESTORE_DRILL"];
const backupRestoreStatuses = ["completed", "failed", "queued"];
const backupRestoreJobRequired = [
  "id",
  "tenantId",
  "requestedByUserId",
  "operationType",
  "targetReference",
  "queueName",
  "jobId",
  "status",
  "checkedTables",
  "createdAt",
  "updatedAt",
];
const backupRestoreForbiddenDeep = [
  "accessToken",
  "contentBase64",
  "fileBase64",
  "password",
  "passwordHash",
  "rawRow",
  "refreshToken",
  "s3Key",
  "storageKey",
  "token",
  "tokenHash",
];
const backupRestoreJobFieldChecks = [
  { path: ["requestBody", "confirmationText"], minLength: 1 },
  { path: ["requestBody", "operationType"], enum: backupRestoreOperationTypes },
  { path: ["requestBody", "targetReference"], minLength: 1 },
  { path: ["responseData", "operationType"], enum: backupRestoreOperationTypes },
  { path: ["responseData", "queueName"], enum: ["backup-restore"] },
  { path: ["responseData", "status"], enum: backupRestoreStatuses },
  { path: ["responseData", "createdAt"], format: "date-time" },
  { path: ["responseData", "updatedAt"], format: "date-time" },
];
const backupRestoreJobListFieldChecks = [
  { path: ["responseDataItem", "operationType"], enum: backupRestoreOperationTypes },
  { path: ["responseDataItem", "queueName"], enum: ["backup-restore"] },
  { path: ["responseDataItem", "status"], enum: backupRestoreStatuses },
  { path: ["responseDataItem", "createdAt"], format: "date-time" },
  { path: ["responseDataItem", "updatedAt"], format: "date-time" },
];
const tenantExportRequired = ["formatVersion", "tenantId", "generatedByUserId", "exportedAt", "scope", "rowLimitPerTable", "tables", "warnings"];
const tenantExportForbiddenDeep = [
  "contentBase64",
  "fileBase64",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "password",
  "passwordHash",
  "phone",
  "rawRow",
  "refreshToken",
  "s3Key",
  "storageKey",
  "token",
  "tokenHash",
];
const smsBatchQueueResultRequired = ["tenantId", "templateId", "recipientCount", "queueName", "jobId", "status"];
const smsBatchDeliveryReportRequired = [
  "id",
  "tenantId",
  "jobId",
  "templateId",
  "recipientCount",
  "sentCount",
  "failedCount",
  "billableSegments",
  "status",
];
const smsBatchForbiddenDeep = [
  "accessToken",
  "contentBase64",
  "fileBase64",
  "messageBody",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "password",
  "passwordHash",
  "rawRow",
  "recipients",
  "refreshToken",
  "s3Key",
  "storageKey",
  "token",
  "tokenHash",
];
const smsBatchQueueFieldChecks = [
  { path: ["requestBody", "recipients"], minItems: 1 },
  { path: ["requestBody", "recipients", "items", "to"], minLength: 1 },
  { path: ["requestBody", "templateId"], minLength: 1 },
  { path: ["responseData", "recipientCount"], minimum: 0 },
  { path: ["responseData", "queueName"], enum: ["sms-batch"] },
  { path: ["responseData", "status"], enum: ["queued"] },
];
const smsBatchDeliveryReportFieldChecks = [
  { path: ["responseData", "recipientCount"], minimum: 0 },
  { path: ["responseData", "sentCount"], minimum: 0 },
  { path: ["responseData", "failedCount"], minimum: 0 },
  { path: ["responseData", "billableSegments"], minimum: 0 },
  { path: ["responseData", "status"], enum: backupRestoreStatuses },
  { path: ["responseData", "createdAt"], format: "date-time" },
  { path: ["responseData", "updatedAt"], format: "date-time" },
];
const smsBatchRecipientPreviewRequired = ["recipients", "recipientCount"];
const smsBatchRecipientPreviewForbiddenDeep = [
  "accessToken",
  "birthDate",
  "contentBase64",
  "email",
  "fileBase64",
  "messageBody",
  "nationalId",
  "nationalIdEncrypted",
  "nationalIdHash",
  "objectKey",
  "password",
  "passwordHash",
  "rawRow",
  "refreshToken",
  "s3Key",
  "storageKey",
  "token",
  "tokenHash",
  "userId",
];
const smsBatchRecipientPreviewFieldChecks = [
  { path: ["requestBody", "studentStatus"], enum: studentStatuses },
  { path: ["responseData", "recipientCount"], minimum: 0 },
  { path: ["responseData", "recipients", "items", "to"], minLength: 1 },
  { path: ["responseData", "recipients", "items", "studentIds"], minItems: 1 },
  { path: ["responseData", "recipients", "items", "studentNames"], minItems: 1 },
];
const schoolReferenceCrudContracts = [
  ...schoolCrudContracts({
    basePath: "/api/v1/academic-years",
    createRequired: ["endsAt", "name", "startsAt"],
    responseRequired: ["id", "tenantId", "name", "startsAt", "endsAt", "isActive"],
    dateFields: ["startsAt", "endsAt"],
  }),
  ...schoolCrudContracts({
    basePath: "/api/v1/academic-terms",
    createRequired: ["academicYearId", "endsAt", "name", "startsAt"],
    responseRequired: ["id", "tenantId", "academicYearId", "name", "startsAt", "endsAt", "isActive"],
    dateFields: ["startsAt", "endsAt"],
  }),
  ...schoolCrudContracts({
    basePath: "/api/v1/campuses",
    createRequired: ["name"],
    responseRequired: ["id", "tenantId", "name"],
  }),
  ...schoolCrudContracts({
    basePath: "/api/v1/alanlar",
    createRequired: ["name"],
    responseRequired: ["id", "tenantId", "name"],
  }),
  ...schoolReadDeleteContracts("/api/v1/classes", ["id", "tenantId", "name"]),
  ...schoolCrudContracts({
    basePath: "/api/v1/courses",
    createRequired: ["name"],
    responseRequired: ["id", "tenantId", "name"],
  }),
  ...schoolCrudContracts({
    basePath: "/api/v1/grade-levels",
    createRequired: ["name"],
    responseRequired: ["id", "tenantId", "name"],
  }),
  {
    method: "get",
    path: "/api/v1/grade-levels/{id}/courses",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "gradeLevelId", "courseId", "isDefault", "sortOrder", "courseName"],
  },
  ...schoolCrudContracts({
    basePath: "/api/v1/learning-outcomes",
    createRequired: ["branch", "code", "title"],
    responseRequired: ["id", "tenantId", "code", "branch", "title"],
  }),
];
const requiredOperationContracts = [
  ...schoolReferenceCrudContracts,
  {
    method: "get",
    path: "/health",
    rawResponseContentType: "application/json",
    rawResponseRequired: ["status"],
    fieldChecks: [
      { path: ["rawResponse", "status"], enum: ["ok"] },
    ],
  },
  {
    method: "get",
    path: "/health/ready",
    rawResponseContentType: "application/json",
    rawResponseRequired: ["status", "dependencies"],
    fieldChecks: [
      { path: ["rawResponse", "status"], enum: ["ready"] },
      { path: ["rawResponse", "dependencies", "postgres"], enum: ["ok"] },
      { path: ["rawResponse", "dependencies", "redis"], enum: ["ok"] },
    ],
  },
  {
    method: "get",
    path: "/api/v1/metrics",
    rawResponseContentType: "text/plain",
    fieldChecks: [
      { path: ["rawResponse"], type: "string" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/backup-restore-jobs",
    responseListEnvelope: true,
    responseDataItemsRequired: backupRestoreJobRequired,
    responseDataForbiddenDeep: backupRestoreForbiddenDeep,
    fieldChecks: backupRestoreJobListFieldChecks,
  },
  {
    method: "post",
    path: "/api/v1/backup-restore-jobs",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["confirmationText", "operationType", "targetReference"],
    responseDataRequired: backupRestoreJobRequired,
    responseDataForbiddenDeep: backupRestoreForbiddenDeep,
    fieldChecks: backupRestoreJobFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/backup-restore-jobs/tenant-export",
    rawResponseContentType: "application/json",
    rawResponseRequired: tenantExportRequired,
    rawResponseForbiddenDeep: tenantExportForbiddenDeep,
    fieldChecks: [
      { path: ["rawResponse", "formatVersion"], enum: ["tenant-export-v1"] },
      { path: ["rawResponse", "exportedAt"], format: "date-time" },
      { path: ["rawResponse", "scope"], enum: ["tenant-user-entered-data"] },
      { path: ["rawResponse", "rowLimitPerTable"], minimum: 1 },
    ],
  },
  {
    method: "post",
    path: "/api/v1/sms-batches",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["recipients", "templateId"],
    responseDataRequired: smsBatchQueueResultRequired,
    responseDataForbiddenDeep: smsBatchForbiddenDeep,
    fieldChecks: smsBatchQueueFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/sms-batches/{jobId}",
    responseEnvelope: true,
    responseDataRequired: smsBatchDeliveryReportRequired,
    responseDataForbiddenDeep: smsBatchForbiddenDeep,
    fieldChecks: smsBatchDeliveryReportFieldChecks,
  },
  {
    method: "post",
    path: "/api/v1/sms-batches/recipients/preview",
    requestBody: true,
    requestBodyRequired: false,
    responseEnvelope: true,
    requestProperties: ["announcementId", "campusId", "classId", "courseId", "gradeLevelId", "studentStatus", "termId"],
    responseDataRequired: smsBatchRecipientPreviewRequired,
    responseDataForbiddenDeep: smsBatchRecipientPreviewForbiddenDeep,
    fieldChecks: smsBatchRecipientPreviewFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/development/criteria",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "name", "scaleMin", "scaleMax", "sortOrder"],
  },
  {
    method: "post",
    path: "/api/v1/development/criteria",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["name"],
    responseDataRequired: ["id", "tenantId", "name", "scaleMin", "scaleMax", "sortOrder"],
  },
  {
    method: "get",
    path: "/api/v1/development/assessments",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "studentId", "teacherId", "periodLabel", "visibility", "scores"],
    fieldChecks: [
      { path: ["responseDataItem", "visibility"], enum: developmentAssessmentVisibilities },
      { path: ["responseDataItem", "scores"], minItems: 1 },
    ],
  },
  {
    method: "post",
    path: "/api/v1/development/assessments",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["periodLabel", "scores", "studentId"],
    responseDataRequired: ["id", "tenantId", "studentId", "teacherId", "periodLabel", "visibility", "scores"],
    fieldChecks: [
      { path: ["requestBody", "scores"], minItems: 1 },
      { path: ["requestBody", "visibility"], enum: developmentAssessmentVisibilities },
      { path: ["responseData", "visibility"], enum: developmentAssessmentVisibilities },
      { path: ["responseData", "scores"], minItems: 1 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/student/development-assessments",
    responseListEnvelope: true,
    responseDataItemsRequired: developmentTrendItemRequired,
    responseDataForbiddenDeep: developmentTrendForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "visibility"], enum: developmentAssessmentVisibilities },
      { path: ["responseDataItem", "scores"], minItems: 1 },
      { path: ["responseDataItem", "scores", "items", "score"], minimum: 0 },
      { path: ["responseDataItem", "scores", "items", "scaleMin"], minimum: 0 },
      { path: ["responseDataItem", "scores", "items", "scaleMax"], minimum: 0 },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/guardian/students/{studentId}/development-assessments",
    responseListEnvelope: true,
    responseDataItemsRequired: developmentTrendItemRequired,
    responseDataForbiddenDeep: developmentTrendForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "visibility"], enum: developmentAssessmentVisibilities },
      { path: ["responseDataItem", "scores"], minItems: 1 },
      { path: ["responseDataItem", "scores", "items", "score"], minimum: 0 },
      { path: ["responseDataItem", "scores", "items", "scaleMin"], minimum: 0 },
      { path: ["responseDataItem", "scores", "items", "scaleMax"], minimum: 0 },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/teacher",
    responseEnvelope: true,
    responseDataRequired: teacherRecordRequired,
    responseDataForbidden: teacherResponseForbidden,
  },
  {
    method: "get",
    path: "/api/v1/me/teacher/lookups",
    responseEnvelope: true,
    responseDataRequired: teacherPortalLookupsRequired,
    responseDataForbiddenDeep: teacherPortalReadForbiddenDeep,
    fieldChecks: teacherPortalLookupsFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/me/teacher/students",
    responseListEnvelope: true,
    responseDataItemsRequired: studentCoreRequired,
    responseDataForbiddenDeep: teacherPortalReadForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "status"], enum: studentStatuses },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/teacher/schedule",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "classId", "teacherId", "title", "startsAt", "endsAt"],
    responseDataForbiddenDeep: teacherPortalReadForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "startsAt"], format: "date-time" },
      { path: ["responseDataItem", "endsAt"], format: "date-time" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/teacher/attendance",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "studentId", "date", "status"],
    responseDataForbiddenDeep: teacherPortalReadForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "date"], format: "date" },
      { path: ["responseDataItem", "status"], enum: attendanceStatuses },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/teacher/homework",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "classId", "title"],
    responseDataForbiddenDeep: teacherPortalReadForbiddenDeep,
  },
  {
    method: "get",
    path: "/api/v1/me/teacher/homework/materials",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "title"],
    responseDataForbiddenDeep: teacherPortalReadForbiddenDeep,
  },
  {
    method: "get",
    path: "/api/v1/me/teacher/homework/materials/{id}/assignments",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "materialId", "studentId", "createdAt"],
    responseDataForbiddenDeep: teacherPortalReadForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/teacher/teacher-notes",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "studentId", "teacherId", "visibility", "body", "createdAt"],
    responseDataForbiddenDeep: teacherPortalReadForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "visibility"], enum: teacherNoteVisibilities },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
    ],
  },
  ...studentAcademicTimelineClassHistoryPaths.map((path) => ({
    method: "get",
    path,
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "studentId", "startsAt"],
    responseDataForbiddenDeep: studentAcademicTimelineForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "startsAt"], format: "date" },
      { path: ["responseDataItem", "endsAt"], format: "date" },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
      { path: ["responseDataItem", "updatedAt"], format: "date-time" },
    ],
  })),
  ...studentAcademicTimelineEnrollmentPaths.map((path) => ({
    method: "get",
    path,
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "studentId", "status", "startsAt"],
    responseDataForbiddenDeep: studentAcademicTimelineForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "status"], enum: studentStatuses },
      { path: ["responseDataItem", "startsAt"], format: "date" },
      { path: ["responseDataItem", "endsAt"], format: "date" },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
    ],
  })),
  ...studentAcademicTimelineAttendancePaths.map((path) => ({
    method: "get",
    path,
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "studentId", "date", "status"],
    responseDataForbiddenDeep: studentAcademicTimelineForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "date"], format: "date" },
      { path: ["responseDataItem", "status"], enum: attendanceStatuses },
    ],
  })),
  ...studentAcademicTimelineAttendanceSummaryPaths.map((path) => ({
    method: "get",
    path,
    responseEnvelope: true,
    responseDataRequired: ["studentId", "total", "present", "absent", "late", "excused"],
    responseDataForbiddenDeep: studentAcademicTimelineForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "total"], minimum: 0 },
      { path: ["responseData", "present"], minimum: 0 },
      { path: ["responseData", "absent"], minimum: 0 },
      { path: ["responseData", "late"], minimum: 0 },
      { path: ["responseData", "excused"], minimum: 0 },
    ],
  })),
  ...studentAcademicTimelineTeacherNotePaths.map((path) => ({
    method: "get",
    path,
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "studentId", "teacherId", "visibility", "body", "createdAt"],
    responseDataForbiddenDeep: studentAcademicTimelineForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "visibility"], enum: ["GUARDIAN_STUDENT"] },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
    ],
  })),
  {
    method: "get",
    path: "/api/v1/me/student",
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "firstName", "lastName", "status"],
    responseDataForbiddenDeep: portalStudentRecordForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "status"], enum: studentStatuses },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/guardian/students",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "firstName", "lastName", "status"],
    responseDataForbiddenDeep: portalStudentRecordForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "status"], enum: studentStatuses },
    ],
  },
  ...portalStudentProfilePaths.map((path) => ({
    method: "get",
    path,
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "firstName", "lastName", "status"],
    responseDataForbiddenDeep: portalStudentProfileForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "status"], enum: studentStatuses },
    ],
  })),
  {
    method: "get",
    path: "/api/v1/me/notification-devices",
    responseListEnvelope: true,
    responseDataItemsRequired: notificationDeviceResponseRequired,
    responseDataForbiddenDeep: notificationDeviceForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "lastSeenAt"], format: "date-time" },
      { path: ["responseDataItem", "disabledAt"], format: "date-time" },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
      { path: ["responseDataItem", "updatedAt"], format: "date-time" },
    ],
  },
  {
    method: "post",
    path: "/api/v1/me/notification-devices",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["provider", "token"],
    responseDataRequired: notificationDeviceResponseRequired,
    responseDataForbiddenDeep: notificationDeviceForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "provider"], minLength: 1 },
      { path: ["requestBody", "token"], minLength: 1 },
      { path: ["responseData", "lastSeenAt"], format: "date-time" },
    ],
  },
  {
    method: "delete",
    path: "/api/v1/me/notification-devices/{id}",
    responseEnvelope: true,
    responseDataRequired: notificationDeviceResponseRequired,
    responseDataForbiddenDeep: notificationDeviceForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "lastSeenAt"], format: "date-time" },
      { path: ["responseData", "disabledAt"], format: "date-time" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/privacy/inventory",
    responseListEnvelope: true,
    responseDataItemsRequired: kvkkInventoryRecordRequired,
    responseDataForbiddenDeep: kvkkInventoryForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "kind"], enum: kvkkInventoryKinds },
    ],
  },
  {
    method: "post",
    path: "/api/v1/privacy/me/purge-pii",
    responseEnvelope: true,
    responseDataRequired: selfPurgeResultRequired,
    responseDataForbiddenDeep: selfPurgeForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "purgedAt"], format: "date-time" },
    ],
  },
  ...portalSupportTicketStudentPaths.map((path) => ({
    method: "get",
    path,
    responseListEnvelope: true,
    responseDataItemsRequired: [...portalSupportTicketResponseRequired, "studentId"],
    responseDataForbiddenDeep: portalSupportTicketForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "priority"], enum: supportTicketPriorities },
      { path: ["responseDataItem", "status"], enum: supportTicketStatuses },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
    ],
  })),
  ...portalSupportTicketStudentPaths.map((path) => ({
    method: "post",
    path,
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["message", "subject"],
    requestForbidden: [
      "contentBase64",
      "createdAt",
      "fileBase64",
      "id",
      "requesterId",
      "status",
      "storageKey",
      "studentId",
      "tenantId",
      "token",
    ],
    responseDataRequired: [...portalSupportTicketResponseRequired, "studentId"],
    responseDataForbiddenDeep: portalSupportTicketForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "message"], minLength: 1 },
      { path: ["requestBody", "subject"], minLength: 1 },
      { path: ["requestBody", "priority"], enum: supportTicketPriorities },
      { path: ["responseData", "priority"], enum: supportTicketPriorities },
      { path: ["responseData", "status"], enum: supportTicketStatuses },
      { path: ["responseData", "createdAt"], format: "date-time" },
    ],
  })),
  ...portalSupportTicketTeacherPaths.map((path) => ({
    method: "get",
    path,
    responseListEnvelope: true,
    responseDataItemsRequired: portalSupportTicketResponseRequired,
    responseDataForbiddenDeep: portalSupportTicketForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "priority"], enum: supportTicketPriorities },
      { path: ["responseDataItem", "status"], enum: supportTicketStatuses },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
    ],
  })),
  ...portalSupportTicketTeacherPaths.map((path) => ({
    method: "post",
    path,
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["message", "subject"],
    requestForbidden: [
      "contentBase64",
      "createdAt",
      "fileBase64",
      "id",
      "requesterId",
      "status",
      "storageKey",
      "tenantId",
      "token",
    ],
    responseDataRequired: portalSupportTicketResponseRequired,
    responseDataForbiddenDeep: portalSupportTicketForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "message"], minLength: 1 },
      { path: ["requestBody", "subject"], minLength: 1 },
      { path: ["requestBody", "priority"], enum: supportTicketPriorities },
      { path: ["responseData", "priority"], enum: supportTicketPriorities },
      { path: ["responseData", "status"], enum: supportTicketStatuses },
      { path: ["responseData", "createdAt"], format: "date-time" },
    ],
  })),
  {
    method: "get",
    path: "/api/v1/audit-logs",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "entityType", "action", "createdAt"],
  },
  {
    method: "get",
    path: "/api/v1/audit-logs/safe-list",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "actionLabel", "actorLabel", "category", "entityLabel", "createdAt"],
    responseDataItemsForbidden: [
      "action",
      "actorUserId",
      "attachmentId",
      "body",
      "commentId",
      "diff",
      "downloadUrl",
      "email",
      "entityId",
      "entityType",
      "fileName",
      "guardianId",
      "ip",
      "message",
      "nationalIdEncrypted",
      "nationalIdHash",
      "objectKey",
      "phone",
      "studentId",
      "subject",
      "supportTicketId",
      "tenantId",
      "ticketId",
      "token",
      "url",
      "userAgent",
    ],
    fieldChecks: [
      { path: ["responseDataItem", "category"], enum: auditLogCategories },
    ],
  },
  {
    method: "get",
    path: "/api/v1/audit-logs/student-summary",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "actionLabel", "createdAt"],
    responseDataItemsForbidden: [
      "action",
      "actorLabel",
      "actorUserId",
      "attachmentId",
      "body",
      "commentId",
      "diff",
      "downloadUrl",
      "email",
      "entityId",
      "entityLabel",
      "entityType",
      "fileName",
      "guardianId",
      "ip",
      "message",
      "nationalIdEncrypted",
      "nationalIdHash",
      "objectKey",
      "phone",
      "studentId",
      "subject",
      "supportTicketId",
      "tenantId",
      "ticketId",
      "token",
      "url",
      "userAgent",
    ],
  },
  {
    method: "post",
    path: "/api/v1/auth/login",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["tenantSlug", "nationalId", "password"],
    responseDataOneOfRequired: [
      ["accessToken", "session"],
      ["challengeToken", "expiresAt", "methods", "status"],
    ],
    responseDataForbiddenDeep: authResponseForbiddenDeep,
  },
  {
    method: "post",
    path: "/api/v1/auth/totp/verify",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["challengeToken"],
    requestAnyOfRequired: [["totpCode"], ["recoveryCode"]],
    responseDataRequired: ["accessToken", "session"],
    responseDataForbiddenDeep: authResponseForbiddenDeep,
  },
  {
    method: "post",
    path: "/api/v1/auth/refresh",
    requestBody: true,
    requestBodyRequired: false,
    responseEnvelope: true,
    requestProperties: ["refreshToken"],
    requiredHeaders: ["X-CSRF-Token"],
    responseDataRequired: ["accessToken", "session"],
    responseDataForbiddenDeep: authResponseForbiddenDeep,
  },
  {
    method: "post",
    path: "/api/v1/auth/logout",
    requestBody: true,
    requestBodyRequired: false,
    requestProperties: ["refreshToken"],
    requiredHeaders: ["X-CSRF-Token"],
    responseStatus: "204",
    noResponseBody: true,
  },
  {
    method: "post",
    path: "/api/v1/auth/password-reset/request",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["email"],
    responseDataRequired: ["status"],
    responseDataForbidden: ["resetToken", "expiresAt"],
    fieldChecks: [
      { path: ["requestBody", "email"], format: "email" },
      { path: ["responseData", "status"], enum: ["ACCEPTED"] },
    ],
  },
  {
    method: "post",
    path: "/api/v1/auth/password-reset/confirm",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["password", "token"],
    responseDataRequired: ["resetAt"],
    responseDataForbidden: ["accessToken", "refreshToken"],
    fieldChecks: [
      { path: ["requestBody", "password"], minLength: 8 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/auth/totp/status",
    responseEnvelope: true,
    responseDataRequired: ["enabled", "mode", "recoveryCodesRemaining"],
    fieldChecks: [
      { path: ["responseData", "mode"], enum: adminMfaModes },
      { path: ["responseData", "recoveryCodesRemaining"], minimum: 0 },
    ],
  },
  {
    method: "post",
    path: "/api/v1/auth/totp/setup",
    responseEnvelope: true,
    responseDataRequired: ["keyUri", "recoveryCodes", "secret", "setupExpiresAt", "setupToken"],
    fieldChecks: [
      { path: ["responseData", "recoveryCodes"], minItems: 1 },
    ],
  },
  {
    method: "post",
    path: "/api/v1/auth/totp/confirm",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["setupToken", "totpCode"],
    responseDataRequired: ["enabledAt", "recoveryCodesRemaining"],
    fieldChecks: [
      { path: ["responseData", "recoveryCodesRemaining"], minimum: 0 },
    ],
  },
  {
    method: "post",
    path: "/api/v1/auth/totp/disable",
    requestBody: true,
    responseEnvelope: true,
    requestAnyOfRequired: [["totpCode"], ["recoveryCode"]],
    responseDataRequired: ["disabledAt"],
  },
  {
    method: "get",
    path: "/api/v1/tenants",
    responseListEnvelope: true,
    responseDataItemsRequired: tenantRecordRequired,
    responseDataForbiddenDeep: tenantRecordForbiddenDeep,
    fieldChecks: tenantRecordListFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/tenants/{id}",
    responseEnvelope: true,
    responseDataRequired: tenantRecordRequired,
    responseDataForbiddenDeep: tenantRecordForbiddenDeep,
    fieldChecks: tenantRecordFieldChecks,
  },
  {
    method: "post",
    path: "/api/v1/tenants",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["name", "slug"],
    requestProperties: tenantCreateRequestProperties,
    requestForbidden: tenantCreateRequestForbidden,
    responseDataOneOfRequired: [tenantRecordRequired, ["tenant", "admin"]],
    responseDataForbiddenDeep: tenantCreateResponseForbiddenDeep,
    fieldChecks: tenantCreateFieldChecks,
  },
  {
    method: "patch",
    path: "/api/v1/tenants/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: tenantAdminUpdateRequestProperties,
    requestForbidden: tenantAdminUpdateRequestForbidden,
    responseDataRequired: tenantRecordRequired,
    responseDataForbiddenDeep: tenantRecordForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "contactEmail"], format: "email" },
      { path: ["requestBody", "licenseEndsAt"], format: "date-time" },
      { path: ["requestBody", "licenseStartsAt"], format: "date-time" },
      { path: ["requestBody", "seatLimit"], minimum: 1 },
      ...tenantRecordFieldChecks,
    ],
  },
  {
    method: "delete",
    path: "/api/v1/tenants/{id}",
    responseEnvelope: true,
    responseDataRequired: tenantRecordRequired,
    responseDataForbiddenDeep: tenantRecordForbiddenDeep,
    fieldChecks: tenantRecordFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/tenant-users",
    responseListEnvelope: true,
    responseDataItemsRequired: tenantUserRecordRequired,
    responseDataForbiddenDeep: tenantUserResponseForbiddenDeep,
    fieldChecks: tenantUserRecordListFieldChecks,
  },
  {
    method: "post",
    path: "/api/v1/tenant-users",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["email", "name", "nationalId", "phone", "roles"],
    requestForbidden: tenantUserCreateRequestForbidden,
    responseDataRequired: tenantUserRecordRequired,
    responseDataForbiddenDeep: tenantUserResponseForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "email"], format: "email" },
      { path: ["requestBody", "name"], minLength: 1 },
      { path: ["requestBody", "nationalId"], minLength: 11 },
      { path: ["requestBody", "phone"], minLength: 1 },
      { path: ["requestBody", "roles"], minItems: 1 },
      { path: ["requestBody", "roles", "items"], enum: tenantUserManagementRoles },
      ...tenantUserRecordFieldChecks,
    ],
  },
  {
    method: "patch",
    path: "/api/v1/tenant-users/{userId}/roles",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["roles"],
    requestForbidden: tenantUserRoleUpdateRequestForbidden,
    responseDataRequired: tenantUserRecordRequired,
    responseDataForbiddenDeep: tenantUserResponseForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "roles"], minItems: 1 },
      { path: ["requestBody", "roles", "items"], enum: tenantUserManagementRoles },
      ...tenantUserRecordFieldChecks,
    ],
  },
  {
    method: "post",
    path: "/api/v1/tenant-users/{userId}/reset-password",
    responseEnvelope: true,
    responseDataRequired: tenantUserPasswordResetRequired,
    responseDataForbiddenDeep: tenantUserResponseForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "resetAt"], format: "date-time" },
      { path: ["responseData", "mustChangePassword"], enum: [true] },
    ],
  },
  {
    method: "post",
    path: "/api/v1/role-previews",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["targetRole", "targetSubjectId"],
    requestForbidden: rolePreviewRequestForbidden,
    responseDataRequired: rolePreviewSessionRequired,
    responseDataForbiddenDeep: rolePreviewResponseForbiddenDeep,
    fieldChecks: rolePreviewFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/me/profile",
    responseEnvelope: true,
    responseDataRequired: ["userId", "tenantId", "roles"],
    responseDataForbiddenDeep: meProfileForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "roles"], minItems: 1 },
      { path: ["responseData", "subjectType"], enum: ["GUARDIAN", "STUDENT", "TEACHER"] },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/tenant",
    responseEnvelope: true,
    responseDataRequired: tenantRecordRequired,
    responseDataForbiddenDeep: tenantRecordForbiddenDeep,
  },
  {
    method: "patch",
    path: "/api/v1/me/tenant",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: tenantCurrentProfileRequestProperties,
    requestForbidden: tenantCurrentProfileRequestForbidden,
    responseDataRequired: tenantRecordRequired,
    responseDataForbiddenDeep: tenantRecordForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "contactEmail"], format: "email" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/student/homework/material-assignments",
    responseListEnvelope: true,
    responseDataItemsRequired: portalHomeworkMaterialAssignmentRequired,
    responseDataForbiddenDeep: portalHomeworkMaterialAssignmentForbiddenDeep,
    fieldChecks: portalHomeworkMaterialAssignmentFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/me/guardian/homework/material-assignments",
    responseListEnvelope: true,
    responseDataItemsRequired: portalHomeworkMaterialAssignmentRequired,
    responseDataForbiddenDeep: portalHomeworkMaterialAssignmentForbiddenDeep,
    fieldChecks: portalHomeworkMaterialAssignmentFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/me/guardian/students/{studentId}/homework/material-assignments",
    responseListEnvelope: true,
    responseDataItemsRequired: portalHomeworkMaterialAssignmentRequired,
    responseDataForbiddenDeep: portalHomeworkMaterialAssignmentForbiddenDeep,
    fieldChecks: portalHomeworkMaterialAssignmentFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/me/guardian/students/{studentId}/notification-preferences",
    responseEnvelope: true,
    responseDataRequired: guardianStudentRecordRequired,
    responseDataForbiddenDeep: guardianNotificationPreferenceForbiddenDeep,
  },
  {
    method: "patch",
    path: "/api/v1/me/guardian/students/{studentId}/notification-preferences",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: guardianNotificationPreferenceRequestProperties,
    requestForbidden: guardianNotificationPreferenceRequestForbidden,
    responseDataRequired: guardianStudentRecordRequired,
    responseDataForbiddenDeep: guardianNotificationPreferenceForbiddenDeep,
  },
  {
    method: "get",
    path: "/api/v1/me/guardian/students/{studentId}/payment-plans",
    responseListEnvelope: true,
    responseDataItemsRequired: paymentPlanWithInstallmentsRequired,
    responseDataForbiddenDeep: paymentPlanPortalForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "totalAmount"], minimum: 1 },
      { path: ["responseDataItem", "installments", "items", "status"], enum: paymentInstallmentStatuses },
      { path: ["responseDataItem", "installments", "items", "amount"], minimum: 1 },
      { path: ["responseDataItem", "installments", "items", "dueDate"], format: "date" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/exams",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "title", "status", "createdAt", "updatedAt"],
    fieldChecks: [
      { path: ["responseDataItem", "status"], enum: examStatuses },
      { path: ["responseDataItem", "examType"], enum: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
    ],
  },
  {
    method: "post",
    path: "/api/v1/exams",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["title"],
    requestProperties: ["alanId", "classId", "classIds", "examType", "gradeLevelId", "startsAt", "title"],
    responseDataRequired: ["id", "tenantId", "title", "status", "createdAt", "updatedAt"],
    fieldChecks: [
      { path: ["responseData", "status"], enum: examStatuses },
      { path: ["requestBody", "examType"], enum: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
      { path: ["responseData", "examType"], enum: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
    ],
  },
  {
    method: "get",
    path: "/api/v1/exams/{examId}",
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "title", "status", "createdAt", "updatedAt"],
    fieldChecks: [
      { path: ["responseData", "status"], enum: examStatuses },
      { path: ["responseData", "examType"], enum: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
    ],
  },
  {
    method: "patch",
    path: "/api/v1/exams/{examId}",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["title"],
    requestProperties: ["alanId", "classId", "classIds", "examType", "gradeLevelId", "startsAt", "title"],
    responseDataRequired: ["id", "tenantId", "title", "status", "createdAt", "updatedAt"],
    fieldChecks: [
      { path: ["responseData", "status"], enum: examStatuses },
      { path: ["requestBody", "examType"], enum: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
      { path: ["responseData", "examType"], enum: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
    ],
  },
  {
    method: "post",
    path: "/api/v1/exams/{examId}/publish",
    responseEnvelope: true,
    idempotencyHeader: true,
    responseDataRequired: ["id", "tenantId", "title", "status", "createdAt", "updatedAt"],
    fieldChecks: [
      { path: ["responseData", "status"], enum: examStatuses },
    ],
  },
  { method: "delete", path: "/api/v1/exams/{examId}", responseStatus: "204", noResponseBody: true },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/participants",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "examId", "studentId", "status", "createdAt", "updatedAt"],
    fieldChecks: [
      { path: ["responseDataItem", "status"], enum: examParticipantStatuses },
    ],
  },
  {
    method: "post",
    path: "/api/v1/exams/{examId}/participants",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["studentId"],
    responseDataRequired: ["id", "tenantId", "examId", "studentId", "status", "createdAt", "updatedAt"],
    fieldChecks: [
      { path: ["responseData", "status"], enum: examParticipantStatuses },
    ],
  },
  {
    method: "post",
    path: "/api/v1/exams/{examId}/parser-configs/suggestions",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["fileBase64", "preset", "sampleSize", "sampleText"],
    requestAnyOfRequired: parserConfigSuggestionRequestAlternatives,
    responseDataRequired: ["examId", "suggestion", "status"],
    responseDataForbiddenDeep: ["fileBase64", "sampleText"],
    fieldChecks: [
      { path: ["requestBody", "preset"], enum: ["OPTIK_7108_LGS"] },
      { path: ["requestBody", "sampleSize"], minimum: 1 },
      { path: ["responseData", "status"], enum: ["suggested"] },
      { path: ["responseData", "suggestion", "confidence"], enum: ["low", "medium", "high"] },
      { path: ["responseData", "suggestion", "delimiter"], enum: parserDelimiters },
      { path: ["responseData", "suggestion", "skipHeaderLines"], minimum: 0 },
      { path: ["responseData", "suggestion", "version"], enum: [1] },
    ],
  },
  {
    method: "post",
    path: "/api/v1/exams/{examId}/parser-configs/approvals",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["suggestion", "version"],
    responseDataRequired: ["tenantId", "examId", "version", "encoding", "delimiter", "skipHeaderLines", "fieldMapping", "status"],
    fieldChecks: [
      { path: ["requestBody", "suggestion", "confidence"], enum: ["low", "medium", "high"] },
      { path: ["requestBody", "suggestion", "delimiter"], enum: parserDelimiters },
      { path: ["requestBody", "suggestion", "skipHeaderLines"], minimum: 0 },
      { path: ["requestBody", "suggestion", "version"], enum: [1] },
      { path: ["responseData", "delimiter"], enum: parserDelimiters },
      { path: ["responseData", "skipHeaderLines"], minimum: 0 },
      { path: ["responseData", "status"], enum: ["APPROVED"] },
    ],
  },
  {
    method: "get",
    path: "/api/v1/optical-form-templates",
    responseListEnvelope: true,
    responseDataItemsRequired: opticalFormTemplateRecordRequired,
    responseDataForbiddenDeep: opticalFormTemplateForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "encoding"], enum: ["UTF-8"] },
      { path: ["responseDataItem", "delimiter"], enum: parserDelimiters },
      { path: ["responseDataItem", "skipHeaderLines"], minimum: 0 },
      { path: ["responseDataItem", "status"], enum: ["APPROVED", "DRAFT"] },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
      { path: ["responseDataItem", "updatedAt"], format: "date-time" },
    ],
  },
  {
    method: "post",
    path: "/api/v1/optical-form-templates",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["name", "suggestion", "version"],
    responseDataRequired: opticalFormTemplateRecordRequired,
    responseDataForbiddenDeep: opticalFormTemplateForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "suggestion", "confidence"], enum: ["low", "medium", "high"] },
      { path: ["requestBody", "suggestion", "delimiter"], enum: parserDelimiters },
      { path: ["requestBody", "suggestion", "skipHeaderLines"], minimum: 0 },
      { path: ["requestBody", "suggestion", "version"], enum: [1] },
      { path: ["responseData", "encoding"], enum: ["UTF-8"] },
      { path: ["responseData", "delimiter"], enum: parserDelimiters },
      { path: ["responseData", "skipHeaderLines"], minimum: 0 },
      { path: ["responseData", "status"], enum: ["APPROVED", "DRAFT"] },
      { path: ["responseData", "createdAt"], format: "date-time" },
      { path: ["responseData", "updatedAt"], format: "date-time" },
    ],
  },
  {
    method: "post",
    path: "/api/v1/optical-form-templates/{templateId}/apply",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["examId", "version"],
    responseDataRequired: ["tenantId", "examId", "version", "encoding", "delimiter", "skipHeaderLines", "fieldMapping", "status"],
    responseDataForbiddenDeep: opticalFormTemplateForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "encoding"], enum: ["CP1254", "ISO-8859-9", "UTF-8"] },
      { path: ["responseData", "delimiter"], enum: parserDelimiters },
      { path: ["responseData", "skipHeaderLines"], minimum: 0 },
      { path: ["responseData", "status"], enum: ["APPROVED"] },
    ],
  },
  { method: "post", path: "/api/v1/exams/{examId}/answer-keys", requestBody: true, responseEnvelope: true, idempotencyHeader: true },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/answer-keys",
    responseListEnvelope: true,
    responseDataItemsRequired: answerKeyRecordRequired,
    responseDataItemsForbidden: answerKeyResponseForbidden,
    fieldChecks: [
      { path: ["responseDataItem", "questionCount"], minimum: 1 },
      { path: ["responseDataItem", "branches"], minItems: 1 },
      { path: ["responseDataItem", "branches", "items", "questionCount"], minimum: 1 },
      { path: ["responseDataItem", "scoringConfig", "wrongPenalty"], minimum: 0 },
      { path: ["responseDataItem", "status"], enum: answerKeyStatuses },
      { path: ["responseDataItem", "publishedAt"], format: "date-time" },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
      { path: ["responseDataItem", "updatedAt"], format: "date-time" },
    ],
  },
  { method: "post", path: "/api/v1/exams/{examId}/answer-keys/imports/dry-run", requestBody: true, responseEnvelope: true },
  { method: "post", path: "/api/v1/exams/{examId}/answer-keys/imports", requestBody: true, responseEnvelope: true, idempotencyHeader: true },
  {
    method: "post",
    path: "/api/v1/exams/{examId}/answer-keys/{version}/publish",
    requestBody: true,
    requestBodyRequired: false,
    responseEnvelope: true,
    idempotencyHeader: true,
    responseDataRequired: [...answerKeyRecordRequired, "publishedAt"],
    responseDataForbidden: answerKeyResponseForbidden,
    fieldChecks: [
      { path: ["responseData", "questionCount"], minimum: 1 },
      { path: ["responseData", "branches"], minItems: 1 },
      { path: ["responseData", "branches", "items", "questionCount"], minimum: 1 },
      { path: ["responseData", "scoringConfig", "wrongPenalty"], minimum: 0 },
      { path: ["responseData", "status"], enum: ["PUBLISHED"] },
      { path: ["responseData", "publishedAt"], format: "date-time" },
      { path: ["responseData", "createdAt"], format: "date-time" },
      { path: ["responseData", "updatedAt"], format: "date-time" },
    ],
  },
  { method: "post", path: "/api/v1/exams/{examId}/raw-imports", requestBody: true, responseEnvelope: true, idempotencyHeader: true },
  {
    method: "post",
    path: "/api/v1/exams/{examId}/raw-imports/{rawImportId}/evaluation-jobs",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
  },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/raw-imports/{rawImportId}/quarantines",
    responseListEnvelope: true,
    responseDataItemsRequired: rawImportQuarantineRecordRequired,
    responseDataItemsForbidden: rawImportResponseForbidden,
    fieldChecks: [
      { path: ["responseDataItem", "rowNumber"], minimum: 1 },
      { path: ["responseDataItem", "status"], enum: rawImportQuarantineStatuses },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
      { path: ["responseDataItem", "updatedAt"], format: "date-time" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/raw-imports/{rawImportId}/summary",
    responseEnvelope: true,
    responseDataRequired: ["tenantId", "examId", "rawImportId", "matchedCount", "quarantinedCount", "totalRows", "quarantineReasons"],
    fieldChecks: [
      { path: ["responseData", "matchedCount"], minimum: 0 },
      { path: ["responseData", "quarantinedCount"], minimum: 0 },
      { path: ["responseData", "totalRows"], minimum: 0 },
      { path: ["responseData", "quarantineReasons", "items", "count"], minimum: 0 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/raw-imports/{rawImportId}/evaluation-status",
    responseEnvelope: true,
    responseDataRequired: ["tenantId", "examId", "rawImportId", "matchedCount", "evaluatedCount", "pendingCount", "status"],
    fieldChecks: [
      { path: ["responseData", "matchedCount"], minimum: 0 },
      { path: ["responseData", "evaluatedCount"], minimum: 0 },
      { path: ["responseData", "pendingCount"], minimum: 0 },
      { path: ["responseData", "status"], enum: rawImportEvaluationStatuses },
    ],
  },
  {
    method: "post",
    path: "/api/v1/exams/{examId}/raw-imports/{rawImportId}/quarantines/{quarantineId}/resolve",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["resolvedStudentId"],
    responseDataRequired: [...rawImportQuarantineRecordRequired, "resolvedStudentId", "evaluationJob"],
    responseDataForbidden: rawImportResponseForbidden,
    fieldChecks: [
      { path: ["responseData", "rowNumber"], minimum: 1 },
      { path: ["responseData", "status"], enum: ["RESOLVED"] },
      { path: ["responseData", "createdAt"], format: "date-time" },
      { path: ["responseData", "updatedAt"], format: "date-time" },
      { path: ["responseData", "evaluationJob", "queueName"], enum: ["exam-evaluation"] },
      { path: ["responseData", "evaluationJob", "status"], enum: ["queued"] },
    ],
  },
  {
    method: "get",
    path: "/api/v1/import-quarantines/summary",
    responseEnvelope: true,
    responseDataRequired: ["openCount"],
    fieldChecks: [
      { path: ["responseData", "openCount"], minimum: 0 },
    ],
  },
  { method: "post", path: "/api/v1/exams/{examId}/reports/generation-jobs", requestBody: true, responseEnvelope: true, idempotencyHeader: true },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/reports/snapshots",
    responseListEnvelope: true,
    responseDataItemsRequired: reportSnapshotRecordRequired,
    responseDataForbiddenDeep: reportSnapshotListForbiddenDeep,
    fieldChecks: reportSnapshotListFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/reports/students/{studentId}/snapshots",
    responseListEnvelope: true,
    responseDataItemsRequired: reportSnapshotRecordRequired,
    responseDataForbiddenDeep: reportStudentSnapshotForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "status"], enum: reportSnapshotStatuses },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
      { path: ["responseDataItem", "updatedAt"], format: "date-time" },
      { path: ["responseDataItem", "snapshotData", "resultCount"], minimum: 0 },
      { path: ["responseDataItem", "snapshotData", "students"], minItems: 1 },
      { path: ["responseDataItem", "snapshotData", "students", "items", "total", "questionCount"], minimum: 0 },
      { path: ["responseDataItem", "snapshotData", "students", "items", "total", "successRate"], minimum: 0 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/reports/snapshots/{snapshotId}/export.xlsx",
    responseEnvelope: true,
    responseDataRequired: ["fileName", "contentType", "fileBase64", "rowCount"],
    responseDataForbidden: reportExportForbidden,
    fieldChecks: [
      { path: ["responseData", "contentType"], enum: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
      { path: ["responseData", "fileBase64"], format: "byte" },
      { path: ["responseData", "rowCount"], minimum: 0 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/reports/snapshots/{snapshotId}/export.pdf",
    responseEnvelope: true,
    responseDataRequired: ["fileName", "contentType", "fileBase64", "pageCount"],
    responseDataForbidden: reportExportForbidden,
    fieldChecks: [
      { path: ["responseData", "contentType"], enum: ["application/pdf"] },
      { path: ["responseData", "fileBase64"], format: "byte" },
      { path: ["responseData", "pageCount"], minimum: 1 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/reports/students/{studentId}/progress",
    responseEnvelope: true,
    responseDataRequired: ["tenantId", "examId", "studentId", "points"],
    responseDataForbiddenDeep: reportProgressForbiddenDeep,
    fieldChecks: reportProgressFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/reports/snapshots/{snapshotId}/students/{studentId}",
    responseEnvelope: true,
    responseDataRequired: reportStudentSnapshotRequired,
    responseDataForbiddenDeep: reportDetailForbiddenDeep,
    fieldChecks: reportStudentSnapshotFieldChecks,
  },
  {
    method: "get",
    path: "/api/v1/exams/{examId}/reports/snapshots/{snapshotId}/students/{studentId}/error-booklet",
    responseEnvelope: true,
    responseDataRequired: reportErrorBookletRequired,
    responseDataForbiddenDeep: [...reportDetailForbiddenDeep, ...reportErrorBookletForbidden],
    fieldChecks: reportErrorBookletFieldChecks,
  },
  ...portalReportOperationContracts,
  {
    method: "post",
    path: "/api/v1/students",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["firstName", "lastName"],
    responseDataRequired: ["id", "tenantId", "firstName", "lastName", "status"],
    responseDataForbiddenDeep: ["guardian", "invitationId", ...studentCoreForbiddenDeep],
    fieldChecks: [
      { path: ["requestBody", "status"], enum: studentStatuses },
      { path: ["responseData", "status"], enum: studentStatuses },
    ],
  },
  ...studentCorePaths.map((path) => ({
    method: "get",
    path,
    responseListEnvelope: true,
    responseDataItemsRequired: studentCoreRequired,
    responseDataForbiddenDeep: studentCoreForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "status"], enum: studentStatuses },
    ],
  })),
  ...studentCoreItemPaths.map((path) => ({
    method: "get",
    path,
    responseEnvelope: true,
    responseDataRequired: studentCoreRequired,
    responseDataForbiddenDeep: studentCoreForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "status"], enum: studentStatuses },
    ],
  })),
  ...studentCoreItemPaths.map((path) => ({
    method: "patch",
    path,
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["classId", "firstName", "lastName", "responsibleTeacherId", "status"],
    requestForbidden: ["birthDate", "email", "nationalId", "nationalIdEncrypted", "nationalIdHash", "phone", "photoKey", "tenantId", "userId"],
    responseDataRequired: studentCoreRequired,
    responseDataForbiddenDeep: studentCoreForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "status"], enum: studentStatuses },
      { path: ["responseData", "status"], enum: studentStatuses },
    ],
  })),
  ...studentCoreItemPaths.map((path) => ({
    method: "delete",
    path,
    responseStatus: "204",
    noResponseBody: true,
  })),
  {
    method: "get",
    path: "/api/v1/students/{id}/class-history",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "studentId", "startsAt"],
    responseDataForbiddenDeep: studentEnrollmentForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "startsAt"], format: "date" },
      { path: ["responseDataItem", "endsAt"], format: "date" },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
      { path: ["responseDataItem", "updatedAt"], format: "date-time" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/students/{id}/enrollments",
    responseListEnvelope: true,
    responseDataItemsRequired: studentEnrollmentResponseRequired,
    responseDataForbiddenDeep: studentEnrollmentForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "status"], enum: studentStatuses },
      { path: ["responseDataItem", "startsAt"], format: "date" },
      { path: ["responseDataItem", "endsAt"], format: "date" },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
      { path: ["responseDataItem", "updatedAt"], format: "date-time" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/students/{id}/teacher-assignments",
    responseListEnvelope: true,
    responseDataItemsRequired: teacherAssignmentRecordRequired,
    responseDataForbiddenDeep: ["birthDate", "email", "fileBase64", "nationalId", "nationalIdEncrypted", "nationalIdHash", "phone", "photoKey", "token", "userId"],
    fieldChecks: [
      { path: ["responseDataItem", "role"], enum: teacherAssignmentRoles },
      { path: ["responseDataItem", "startsAt"], format: "date" },
      { path: ["responseDataItem", "endsAt"], format: "date" },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
      { path: ["responseDataItem", "updatedAt"], format: "date-time" },
    ],
  },
  {
    method: "post",
    path: "/api/v1/students/{id}/purge-pii",
    requestBody: true,
    requestBodyRequired: false,
    responseEnvelope: true,
    responseDataRequired: studentCoreRequired,
    responseDataForbiddenDeep: studentCoreForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "status"], enum: studentStatuses },
    ],
  },
  {
    method: "patch",
    path: "/api/v1/students/{id}/tenant",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["tenantId"],
    requestForbidden: ["birthDate", "email", "firstName", "lastName", "nationalId", "nationalIdEncrypted", "nationalIdHash", "phone", "photoKey", "status", "userId"],
    responseDataRequired: studentCoreRequired,
    responseDataForbiddenDeep: studentCoreForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "status"], enum: studentStatuses },
    ],
  },
  ...studentProfilePaths.map((path) => ({
    method: "get",
    path,
    responseEnvelope: true,
    responseDataRequired: studentCoreRequired,
    responseDataForbiddenDeep: studentProfileForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "status"], enum: studentStatuses },
    ],
  })),
  ...studentProfilePaths.map((path) => ({
    method: "patch",
    path,
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["email", "nationalId", "phone", "photoKey"],
    requestForbidden: [
      "classId",
      "contentBase64",
      "downloadUrl",
      "fileBase64",
      "firstName",
      "lastName",
      "nationalIdEncrypted",
      "nationalIdHash",
      "objectKey",
      "responsibleTeacherId",
      "s3Key",
      "status",
      "storageKey",
      "tenantId",
      "token",
      "userId",
    ],
    responseDataRequired: studentCoreRequired,
    responseDataForbiddenDeep: studentProfileForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "status"], enum: studentStatuses },
    ],
  })),
  {
    method: "get",
    path: "/api/v1/students/export",
    responseEnvelope: true,
    responseDataRequired: ["fileName", "contentType", "fileBase64", "rowCount"],
    fieldChecks: [
      { path: ["responseData", "contentType"], enum: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
      { path: ["responseData", "fileBase64"], format: "byte" },
      { path: ["responseData", "rowCount"], minimum: 0 },
    ],
  },
  {
    method: "post",
    path: "/api/v1/students/imports/dry-run",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["fileBase64"],
    requestForbidden: studentImportRequestForbidden,
    responseDataRequired: ["dryRun", "totalRows", "validRows", "errors", "quota", "wouldImport"],
    fieldChecks: [
      { path: ["requestBody", "fileBase64"], minLength: 1 },
      { path: ["responseData", "dryRun"], enum: [true] },
      { path: ["responseData", "totalRows"], minimum: 0 },
      { path: ["responseData", "validRows", "items", "row"], minimum: 1 },
      { path: ["responseData", "quota", "limit"], minimum: 0 },
      { path: ["responseData", "quota", "current"], minimum: 0 },
      { path: ["responseData", "quota", "incoming"], minimum: 0 },
    ],
  },
  {
    method: "post",
    path: "/api/v1/students/imports",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["fileBase64"],
    requestForbidden: studentImportRequestForbidden,
    responseDataRequired: ["importedRows", "students"],
    responseDataForbiddenDeep: studentCoreForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "fileBase64"], minLength: 1 },
      { path: ["responseData", "importedRows"], minimum: 0 },
      { path: ["responseData", "students", "items", "status"], enum: studentStatuses },
    ],
  },
  {
    method: "post",
    path: "/api/v1/students/enrollments/bulk-renew",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestProperties: ["academicYearId", "classId", "classIdBySourceClassId", "startsAt", "studentIds", "termId", "useAutomaticClassMapping"],
    requestForbidden: ["birthDate", "email", "fileBase64", "nationalId", "nationalIdEncrypted", "nationalIdHash", "phone", "photoKey", "status", "tenantId", "userId"],
    responseDataRequired: ["updatedCount", "enrollments"],
    responseDataForbiddenDeep: studentEnrollmentForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "startsAt"], format: "date" },
      { path: ["requestBody", "studentIds"], minItems: 1 },
      { path: ["responseData", "updatedCount"], minimum: 0 },
      { path: ["responseData", "enrollments", "items", "status"], enum: studentStatuses },
      { path: ["responseData", "enrollments", "items", "startsAt"], format: "date" },
    ],
  },
  ...studentEnrollmentActionPaths.map((path) => ({
    method: "post",
    path,
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestProperties: ["academicYearId", "classId", "startsAt", "termId"],
    requestForbidden: ["birthDate", "email", "fileBase64", "nationalId", "nationalIdEncrypted", "nationalIdHash", "phone", "photoKey", "studentIds", "tenantId", "userId"],
    responseDataRequired: studentEnrollmentResponseRequired,
    responseDataForbiddenDeep: studentEnrollmentForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "startsAt"], format: "date" },
      { path: ["responseData", "status"], enum: studentStatuses },
      { path: ["responseData", "startsAt"], format: "date" },
    ],
  })),
  {
    method: "get",
    path: "/api/v1/guardians",
    responseListEnvelope: true,
    responseDataItemsRequired: guardianRecordRequired,
  },
  {
    method: "post",
    path: "/api/v1/guardians",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["firstName", "lastName"],
    responseDataRequired: guardianRecordRequired,
  },
  {
    method: "get",
    path: "/api/v1/guardians/{id}",
    responseEnvelope: true,
    responseDataRequired: guardianRecordRequired,
  },
  {
    method: "patch",
    path: "/api/v1/guardians/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["firstName", "lastName", "phone"],
    responseDataRequired: guardianRecordRequired,
  },
  { method: "delete", path: "/api/v1/guardians/{id}", responseStatus: "204", noResponseBody: true },
  {
    method: "post",
    path: "/api/v1/guardians/{id}/purge-pii",
    requestBody: true,
    requestBodyRequired: false,
    responseEnvelope: true,
    responseDataRequired: guardianRecordRequired,
    responseDataForbidden: ["phone"],
  },
  {
    method: "get",
    path: "/api/v1/guardians/{id}/students",
    responseListEnvelope: true,
    responseDataItemsRequired: guardianStudentRecordRequired,
  },
  {
    method: "post",
    path: "/api/v1/guardians/{id}/students",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["studentId"],
    responseDataRequired: guardianStudentRecordRequired,
  },
  {
    method: "patch",
    path: "/api/v1/guardians/{id}/students/{studentId}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: [
      "canOpenSupportTickets",
      "canReceiveAnnouncements",
      "canReceiveSms",
      "canViewFinance",
    ],
    responseDataRequired: guardianStudentRecordRequired,
  },
  { method: "delete", path: "/api/v1/guardians/{id}/students/{studentId}", responseStatus: "204", noResponseBody: true },
  {
    method: "get",
    path: "/api/v1/guardians/{id}/student-details",
    responseEnvelope: true,
    responseDataRequired: ["availableStudents", "linkedStudents", "links"],
    responseDataForbiddenDeep: ["birthDate", "email", "nationalId", "nationalIdEncrypted", "nationalIdHash", "phone", "photoKey", "responsibleTeacherId", "userId"],
    fieldChecks: [
      ...guardianStudentRecordRequired.map((field) => ({ path: ["responseData", "links", "items", field] })),
      ...guardianStudentDetailStudentRequired.flatMap((field) => [
        { path: ["responseData", "linkedStudents", "items", field] },
        { path: ["responseData", "availableStudents", "items", field] },
      ]),
      { path: ["responseData", "linkedStudents", "items", "status"], enum: studentStatuses },
      { path: ["responseData", "availableStudents", "items", "status"], enum: studentStatuses },
    ],
  },
  {
    method: "get",
    path: "/api/v1/students/{id}/guardians",
    responseListEnvelope: true,
    responseDataItemsRequired: guardianRecordRequired,
  },
  {
    method: "get",
    path: "/api/v1/students/{id}/guardian-links",
    responseListEnvelope: true,
    responseDataItemsRequired: guardianStudentRecordRequired,
  },
  {
    method: "get",
    path: "/api/v1/me/student/guardians",
    responseListEnvelope: true,
    responseDataItemsRequired: guardianRecordRequired,
  },
  {
    method: "get",
    path: "/api/v1/me/student/guardian-links",
    responseListEnvelope: true,
    responseDataItemsRequired: guardianStudentRecordRequired,
  },
  {
    method: "post",
    path: "/api/v1/announcements",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["body", "title"],
    responseDataRequired: ["id", "tenantId", "title", "body", "audience", "publishedAt"],
    fieldChecks: [
      { path: ["requestBody", "audience"], enum: announcementAudiences },
      { path: ["responseData", "audience"], enum: announcementAudiences },
    ],
  },
  {
    method: "get",
    path: "/api/v1/announcements",
    responseEnvelope: true,
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "title", "body", "audience", "publishedAt"],
    fieldChecks: [
      { path: ["responseData", "items", "audience"], enum: announcementAudiences },
    ],
  },
  {
    method: "get",
    path: "/api/v1/announcements/{id}",
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "title", "body", "audience", "publishedAt"],
    fieldChecks: [
      { path: ["responseData", "audience"], enum: announcementAudiences },
    ],
  },
  {
    method: "get",
    path: "/api/v1/announcements/{id}/recipients",
    responseEnvelope: true,
    responseDataRequired: ["announcementId", "total", "read", "unread", "recipients"],
    fieldChecks: [
      { path: ["responseData", "recipients", "items", "recipientType"], enum: announcementRecipientTypes },
    ],
  },
  {
    method: "get",
    path: "/api/v1/announcements/{id}/delivery-reports",
    responseEnvelope: true,
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "announcementId", "channel", "recipientCount", "deliveredCount", "failedCount", "status"],
    fieldChecks: [
      { path: ["responseData", "items", "channel"], enum: announcementDeliveryChannels },
      { path: ["responseData", "items", "status"], enum: announcementDeliveryStatuses },
    ],
  },
  {
    method: "post",
    path: "/api/v1/announcements/{id}/delivery-results",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["channel", "deliveredCount", "failedCount", "recipientCount", "status"],
    responseDataRequired: ["tenantId", "announcementId", "channel", "recipientCount", "deliveredCount", "failedCount", "queueName", "jobId", "status"],
    fieldChecks: [
      { path: ["requestBody", "channel"], enum: announcementDeliveryChannels },
      { path: ["requestBody", "status"], enum: announcementDeliveryResultStatuses },
      { path: ["responseData", "channel"], enum: announcementDeliveryChannels },
      { path: ["responseData", "status"], enum: ["queued"] },
      { path: ["responseData", "queueName"], enum: ["announcement-delivery"] },
    ],
  },
  {
    method: "post",
    path: "/api/v1/announcements/{id}/deliveries",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["channel"],
    responseDataRequired: ["tenantId", "announcementId", "channel", "recipientCount", "deliveredCount", "failedCount", "queueName", "jobId", "status"],
    fieldChecks: [
      { path: ["requestBody", "channel"], enum: announcementDeliveryChannels },
      { path: ["responseData", "channel"], enum: announcementDeliveryChannels },
      { path: ["responseData", "status"], enum: ["queued"] },
      { path: ["responseData", "queueName"], enum: ["announcement-delivery"] },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/student/announcements",
    responseEnvelope: true,
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "title", "body", "audience", "publishedAt"],
    fieldChecks: [
      { path: ["responseData", "items", "audience"], enum: announcementAudiences },
    ],
  },
  {
    method: "post",
    path: "/api/v1/me/student/announcements/{id}/read",
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "title", "body", "audience", "publishedAt"],
    fieldChecks: [
      { path: ["responseData", "audience"], enum: announcementAudiences },
      { path: ["responseData", "readAt"], format: "date-time" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/guardian/students/{studentId}/announcements",
    responseEnvelope: true,
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "title", "body", "audience", "publishedAt"],
    fieldChecks: [
      { path: ["responseData", "items", "audience"], enum: announcementAudiences },
    ],
  },
  {
    method: "post",
    path: "/api/v1/me/guardian/students/{studentId}/announcements/{id}/read",
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "title", "body", "audience", "publishedAt"],
    fieldChecks: [
      { path: ["responseData", "audience"], enum: announcementAudiences },
      { path: ["responseData", "readAt"], format: "date-time" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/me/teacher/announcements",
    responseEnvelope: true,
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "title", "body", "audience", "publishedAt"],
    fieldChecks: [
      { path: ["responseData", "items", "audience"], enum: announcementAudiences },
    ],
  },
  {
    method: "post",
    path: "/api/v1/me/teacher/announcements/{id}/read",
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "title", "body", "audience", "publishedAt"],
    fieldChecks: [
      { path: ["responseData", "audience"], enum: announcementAudiences },
      { path: ["responseData", "readAt"], format: "date-time" },
    ],
  },
  {
    method: "post",
    path: "/api/v1/classes",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["name"],
    responseDataRequired: ["id", "tenantId", "name"],
  },
  {
    method: "patch",
    path: "/api/v1/classes/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["alanId", "campusId", "gradeLevelId", "name", "section"],
    requestMinProperties: 1,
    responseDataRequired: ["id", "tenantId", "name"],
  },
  {
    method: "get",
    path: "/api/v1/teachers",
    responseListEnvelope: true,
    responseDataItemsRequired: teacherRecordRequired,
    responseDataItemsForbidden: teacherResponseForbidden,
  },
  {
    method: "post",
    path: "/api/v1/teachers",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["firstName", "lastName"],
    responseDataRequired: teacherRecordRequired,
    responseDataForbidden: teacherResponseForbidden,
  },
  {
    method: "get",
    path: "/api/v1/teachers/{id}",
    responseEnvelope: true,
    responseDataRequired: teacherRecordRequired,
    responseDataForbidden: teacherResponseForbidden,
  },
  {
    method: "patch",
    path: "/api/v1/teachers/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["branch", "firstName", "lastName"],
    responseDataRequired: teacherRecordRequired,
    responseDataForbidden: teacherResponseForbidden,
  },
  { method: "delete", path: "/api/v1/teachers/{id}", responseStatus: "204", noResponseBody: true },
  {
    method: "get",
    path: "/api/v1/teachers/{id}/assignments",
    responseListEnvelope: true,
    responseDataItemsRequired: teacherAssignmentRecordRequired,
    fieldChecks: [
      { path: ["responseDataItem", "role"], enum: teacherAssignmentRoles },
      { path: ["responseDataItem", "startsAt"], format: "date" },
      { path: ["responseDataItem", "endsAt"], format: "date" },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
      { path: ["responseDataItem", "updatedAt"], format: "date-time" },
    ],
  },
  {
    method: "post",
    path: "/api/v1/teachers/{id}/purge-pii",
    requestBody: true,
    requestBodyRequired: false,
    responseEnvelope: true,
    responseDataRequired: teacherRecordRequired,
    responseDataForbidden: teacherResponseForbidden,
  },
  {
    method: "post",
    path: "/api/v1/teachers/{id}/assignments",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["classId", "courseId", "endsAt", "role", "startsAt", "studentId", "termId"],
    requestAnyOfRequired: [["classId"], ["studentId"]],
    responseDataRequired: ["id", "tenantId", "teacherId", "role"],
    fieldChecks: [
      { path: ["requestBody", "role"], enum: teacherAssignmentRoles },
      { path: ["responseData", "role"], enum: teacherAssignmentRoles },
    ],
  },
  {
    method: "patch",
    path: "/api/v1/teachers/{id}/assignments/{assignmentId}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["classId", "courseId", "endsAt", "role", "startsAt", "studentId", "termId"],
    requestMinProperties: 1,
    responseDataRequired: ["id", "tenantId", "teacherId", "role"],
    fieldChecks: [
      { path: ["requestBody", "role"], enum: teacherAssignmentRoles },
      { path: ["responseData", "role"], enum: teacherAssignmentRoles },
    ],
  },
  {
    method: "delete",
    path: "/api/v1/teachers/{id}/assignments/{assignmentId}",
    responseStatus: "204",
    noResponseBody: true,
  },
  {
    method: "post",
    path: "/api/v1/teachers/imports/dry-run",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["fileBase64"],
    responseDataRequired: ["dryRun", "totalRows", "validRows", "errors", "wouldImport"],
    fieldChecks: [
      { path: ["requestBody", "fileBase64"], minLength: 1 },
      { path: ["responseData", "dryRun"], enum: [true] },
      { path: ["responseData", "totalRows"], minimum: 0 },
    ],
  },
  {
    method: "post",
    path: "/api/v1/teachers/imports",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["fileBase64"],
    responseDataRequired: ["importedRows", "createdTeachers", "createdAssignments", "teachers", "assignments"],
    fieldChecks: [
      { path: ["requestBody", "fileBase64"], minLength: 1 },
      { path: ["responseData", "importedRows"], minimum: 0 },
      { path: ["responseData", "createdTeachers"], minimum: 0 },
      { path: ["responseData", "createdAssignments"], minimum: 0 },
    ],
  },
  {
    method: "post",
    path: "/api/v1/schedule-lessons",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["classId", "endsAt", "startsAt", "teacherId", "title"],
    responseDataRequired: ["id", "tenantId", "classId", "teacherId", "title", "startsAt", "endsAt"],
  },
  {
    method: "get",
    path: "/api/v1/schedule-lessons",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "classId", "teacherId", "title", "startsAt", "endsAt"],
  },
  {
    method: "get",
    path: "/api/v1/schedule-lessons/{id}",
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "classId", "teacherId", "title", "startsAt", "endsAt"],
  },
  {
    method: "patch",
    path: "/api/v1/schedule-lessons/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["classId", "courseId", "endsAt", "startsAt", "teacherId", "termId", "title"],
    requestMinProperties: 1,
    responseDataRequired: ["id", "tenantId", "classId", "teacherId", "title", "startsAt", "endsAt"],
  },
  {
    method: "delete",
    path: "/api/v1/schedule-lessons/{id}",
    responseStatus: "204",
    noResponseBody: true,
  },
  {
    method: "post",
    path: "/api/v1/study-sessions",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["capacity", "classId", "endsAt", "startsAt", "studentIds", "teacherId", "title"],
    responseDataRequired: ["id", "tenantId", "classId", "teacherId", "studentIds", "title", "capacity", "startsAt", "endsAt"],
    fieldChecks: [
      { path: ["requestBody", "capacity"], minimum: 1 },
      { path: ["requestBody", "studentIds"], minItems: 1 },
      { path: ["responseData", "capacity"], minimum: 1 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/study-sessions",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "classId", "teacherId", "studentIds", "title", "capacity", "startsAt", "endsAt"],
    fieldChecks: [
      { path: ["responseDataItem", "capacity"], minimum: 1 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/study-sessions/{id}",
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "classId", "teacherId", "studentIds", "title", "capacity", "startsAt", "endsAt"],
    fieldChecks: [
      { path: ["responseData", "capacity"], minimum: 1 },
    ],
  },
  {
    method: "patch",
    path: "/api/v1/study-sessions/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["capacity", "classId", "courseId", "endsAt", "startsAt", "studentIds", "teacherId", "termId", "title"],
    requestMinProperties: 1,
    responseDataRequired: ["id", "tenantId", "classId", "teacherId", "studentIds", "title", "capacity", "startsAt", "endsAt"],
    fieldChecks: [
      { path: ["requestBody", "capacity"], minimum: 1 },
      { path: ["requestBody", "studentIds"], minItems: 1 },
      { path: ["responseData", "capacity"], minimum: 1 },
    ],
  },
  {
    method: "delete",
    path: "/api/v1/study-sessions/{id}",
    responseStatus: "204",
    noResponseBody: true,
  },
  {
    method: "get",
    path: "/api/v1/teacher-notes",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "studentId", "teacherId", "visibility", "body", "createdAt"],
    fieldChecks: [
      { path: ["responseDataItem", "visibility"], enum: teacherNoteVisibilities },
    ],
  },
  {
    method: "post",
    path: "/api/v1/teacher-notes",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["body", "studentId", "visibility"],
    responseDataRequired: ["id", "tenantId", "studentId", "teacherId", "visibility", "body", "createdAt"],
    fieldChecks: [
      { path: ["requestBody", "visibility"], enum: teacherNoteVisibilities },
      { path: ["responseData", "visibility"], enum: teacherNoteVisibilities },
    ],
  },
  {
    method: "patch",
    path: "/api/v1/teacher-notes/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["body", "courseId", "developmentStatus", "termId", "visibility"],
    requestMinProperties: 1,
    responseDataRequired: ["id", "tenantId", "studentId", "teacherId", "visibility", "body", "createdAt"],
    fieldChecks: [
      { path: ["requestBody", "visibility"], enum: teacherNoteVisibilities },
      { path: ["responseData", "visibility"], enum: teacherNoteVisibilities },
    ],
  },
  {
    method: "delete",
    path: "/api/v1/teacher-notes/{id}",
    responseStatus: "204",
    noResponseBody: true,
  },
  {
    method: "post",
    path: "/api/v1/support-tickets",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["message", "subject"],
    responseDataRequired: ["id", "tenantId", "subject", "message", "priority", "status", "createdAt"],
    fieldChecks: [
      { path: ["requestBody", "priority"], enum: supportTicketPriorities },
      { path: ["responseData", "priority"], enum: supportTicketPriorities },
      { path: ["responseData", "status"], enum: supportTicketStatuses },
    ],
  },
  {
    method: "patch",
    path: "/api/v1/support-tickets/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["priority", "status"],
    requestMinProperties: 1,
    responseDataRequired: ["id", "tenantId", "subject", "message", "priority", "status", "createdAt"],
    fieldChecks: [
      { path: ["requestBody", "priority"], enum: supportTicketPriorities },
      { path: ["requestBody", "status"], enum: supportTicketStatuses },
      { path: ["responseData", "priority"], enum: supportTicketPriorities },
      { path: ["responseData", "status"], enum: supportTicketStatuses },
    ],
  },
  {
    method: "get",
    path: "/api/v1/support-tickets",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "subject", "message", "priority", "status", "createdAt"],
    fieldChecks: [
      { path: ["responseDataItem", "priority"], enum: supportTicketPriorities },
      { path: ["responseDataItem", "status"], enum: supportTicketStatuses },
    ],
  },
  {
    method: "get",
    path: "/api/v1/support-tickets/{id}",
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "subject", "message", "priority", "status", "createdAt"],
    fieldChecks: [
      { path: ["responseData", "priority"], enum: supportTicketPriorities },
      { path: ["responseData", "status"], enum: supportTicketStatuses },
    ],
  },
  {
    method: "post",
    path: "/api/v1/support-tickets/{id}/attachments",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["contentType", "fileBase64", "fileName"],
    responseDataRequired: ["id", "tenantId", "ticketId", "fileName", "contentType", "byteSize", "sha256", "createdAt"],
    responseDataForbidden: ["contentBase64", "fileBase64"],
    fieldChecks: [
      { path: ["requestBody", "contentType"], enum: uploadContentTypes },
      { path: ["responseData", "contentType"], enum: uploadContentTypes },
      { path: ["responseData", "byteSize"], minimum: 1 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/support-tickets/{id}/attachments",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "ticketId", "fileName", "contentType", "byteSize", "sha256", "createdAt"],
    responseDataItemsForbidden: ["contentBase64", "fileBase64", "storageKey"],
    fieldChecks: [
      { path: ["responseDataItem", "contentType"], enum: uploadContentTypes },
      { path: ["responseDataItem", "byteSize"], minimum: 1 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/support-tickets/{id}/attachments/{attachmentId}/download",
    responseEnvelope: true,
    responseDataRequired: fileDownloadRequired,
    responseDataForbiddenDeep: fileDownloadForbiddenDeep,
    fieldChecks: fileDownloadFieldChecks,
  },
  {
    method: "post",
    path: "/api/v1/support-tickets/{id}/comments",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["body"],
    responseDataRequired: ["id", "tenantId", "ticketId", "body", "createdAt"],
  },
  {
    method: "get",
    path: "/api/v1/support-tickets/{id}/comments",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "ticketId", "body", "createdAt"],
  },
  {
    method: "post",
    path: "/api/v1/homework/materials",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["title"],
    responseDataRequired: ["id", "tenantId", "title"],
  },
  {
    method: "get",
    path: "/api/v1/homework/materials",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "title"],
  },
  {
    method: "get",
    path: "/api/v1/homework/materials/{id}",
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "title"],
  },
  {
    method: "patch",
    path: "/api/v1/homework/materials/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["description", "title"],
    requestMinProperties: 1,
    responseDataRequired: ["id", "tenantId", "title"],
  },
  {
    method: "delete",
    path: "/api/v1/homework/materials/{id}",
    responseStatus: "204",
    noResponseBody: true,
  },
  {
    method: "post",
    path: "/api/v1/homework/materials/{id}/files",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["contentType", "fileBase64", "fileName"],
    responseDataRequired: ["id", "tenantId", "materialId", "fileName", "contentType", "byteSize", "sha256", "createdAt"],
    responseDataForbidden: ["contentBase64", "fileBase64", "storageKey"],
    fieldChecks: [
      { path: ["requestBody", "contentType"], enum: uploadContentTypes },
      { path: ["responseData", "contentType"], enum: uploadContentTypes },
      { path: ["responseData", "byteSize"], minimum: 1 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/homework/materials/{id}/files",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "materialId", "fileName", "contentType", "byteSize", "sha256", "createdAt"],
    responseDataItemsForbidden: ["contentBase64", "fileBase64", "storageKey"],
    fieldChecks: [
      { path: ["responseDataItem", "contentType"], enum: uploadContentTypes },
      { path: ["responseDataItem", "byteSize"], minimum: 1 },
    ],
  },
  {
    method: "get",
    path: "/api/v1/homework/materials/{id}/files/{fileId}/download",
    responseEnvelope: true,
    responseDataRequired: fileDownloadRequired,
    responseDataForbiddenDeep: fileDownloadForbiddenDeep,
    fieldChecks: fileDownloadFieldChecks,
  },
  {
    method: "post",
    path: "/api/v1/homework/materials/{id}/assignments",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["studentId"],
    responseDataRequired: ["id", "tenantId", "materialId", "studentId", "createdAt"],
  },
  {
    method: "get",
    path: "/api/v1/homework/materials/{id}/assignments",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "materialId", "studentId", "createdAt"],
  },
  {
    method: "get",
    path: "/api/v1/homework",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "classId", "title"],
  },
  {
    method: "get",
    path: "/api/v1/homework/{id}",
    responseEnvelope: true,
    responseDataRequired: ["id", "tenantId", "classId", "title"],
  },
  {
    method: "post",
    path: "/api/v1/homework",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["classId", "title"],
    responseDataRequired: ["id", "tenantId", "classId", "title"],
  },
  {
    method: "post",
    path: "/api/v1/homework/from-material",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["classId", "materialId"],
    responseDataRequired: ["id", "tenantId", "classId", "title"],
  },
  {
    method: "patch",
    path: "/api/v1/homework/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["classId", "description", "dueAt", "title"],
    requestMinProperties: 1,
    responseDataRequired: ["id", "tenantId", "classId", "title"],
  },
  {
    method: "patch",
    path: "/api/v1/homework/{id}/check-status",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["checked"],
    responseDataRequired: ["id", "tenantId", "classId", "title"],
  },
  {
    method: "delete",
    path: "/api/v1/homework/{id}",
    responseStatus: "204",
    noResponseBody: true,
  },
  {
    method: "post",
    path: "/api/v1/payment-plans",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestRequired: ["studentId", "title", "totalAmount", "installments"],
    responseDataRequired: ["id", "tenantId", "studentId", "title", "totalAmount", "currency", "createdAt", "installments"],
    fieldChecks: [
      { path: ["requestBody", "installments"], minItems: 1 },
      { path: ["requestBody", "installments", "items", "status"], enum: paymentInstallmentStatuses },
      { path: ["responseData", "installments", "items", "status"], enum: paymentInstallmentStatuses },
    ],
  },
  {
    method: "get",
    path: "/api/v1/payment-plans",
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "studentId", "title", "totalAmount", "currency", "createdAt", "installments"],
    fieldChecks: [
      { path: ["responseDataItem", "installments", "items", "status"], enum: paymentInstallmentStatuses },
    ],
  },
  {
    method: "patch",
    path: "/api/v1/payment-plans/{planId}/installments/{installmentId}",
    requestBody: true,
    responseEnvelope: true,
    idempotencyHeader: true,
    requestProperties: ["amount", "dueDate", "paidAt", "status"],
    responseDataRequired: ["id", "tenantId", "studentId", "title", "totalAmount", "currency", "createdAt", "installments"],
    fieldChecks: [
      { path: ["requestBody", "status"], enum: paymentInstallmentStatuses },
      { path: ["responseData", "installments", "items", "status"], enum: paymentInstallmentStatuses },
    ],
  },
  {
    method: "get",
    path: "/api/v1/message-templates",
    responseListEnvelope: true,
    responseDataItemsRequired: messageTemplateRequired,
    responseDataForbiddenDeep: messageTemplateForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "channel"], enum: messageTemplateChannels },
    ],
  },
  {
    method: "post",
    path: "/api/v1/message-templates",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["name", "body"],
    requestForbidden: ["deletedAt", "id", "userId", "token"],
    responseDataRequired: messageTemplateRequired,
    responseDataForbiddenDeep: messageTemplateForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "name"], minLength: 1 },
      { path: ["requestBody", "body"], minLength: 1 },
      { path: ["requestBody", "channel"], enum: messageTemplateChannels },
      { path: ["responseData", "channel"], enum: messageTemplateChannels },
    ],
  },
  {
    method: "get",
    path: "/api/v1/message-templates/{id}",
    responseEnvelope: true,
    responseDataRequired: messageTemplateRequired,
    responseDataForbiddenDeep: messageTemplateForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "channel"], enum: messageTemplateChannels },
    ],
  },
  {
    method: "patch",
    path: "/api/v1/message-templates/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestProperties: ["name", "channel", "body"],
    requestForbidden: ["deletedAt", "id", "tenantId", "userId", "token"],
    responseDataRequired: messageTemplateRequired,
    responseDataForbiddenDeep: messageTemplateForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "name"], minLength: 1 },
      { path: ["requestBody", "body"], minLength: 1 },
      { path: ["requestBody", "channel"], enum: messageTemplateChannels },
      { path: ["responseData", "channel"], enum: messageTemplateChannels },
    ],
  },
  {
    method: "delete",
    path: "/api/v1/message-templates/{id}",
    responseStatus: "204",
    noResponseBody: true,
  },
  {
    method: "get",
    path: "/api/v1/identity-invitations",
    responseListEnvelope: true,
    responseDataItemsRequired: identityInvitationRecordRequired,
    responseDataForbiddenDeep: identityInvitationResponseForbiddenDeep,
    fieldChecks: [
      { path: ["responseDataItem", "subjectType"], enum: identityInvitationSubjectTypes },
      { path: ["responseDataItem", "role"], enum: identityInvitationSubjectTypes },
      { path: ["responseDataItem", "status"], enum: identityInvitationStatuses },
      { path: ["responseDataItem", "expiresAt"], format: "date-time" },
      { path: ["responseDataItem", "createdAt"], format: "date-time" },
      { path: ["responseDataItem", "updatedAt"], format: "date-time" },
    ],
  },
  {
    method: "post",
    path: "/api/v1/identity-invitations",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["email", "subjectId", "subjectType"],
    requestForbidden: ["acceptedUserId", "activationToken", "id", "role", "status", "tenantId", "tokenHash"],
    responseDataRequired: identityInvitationRecordRequired,
    responseDataForbiddenDeep: identityInvitationResponseForbiddenDeep,
    fieldChecks: [
      { path: ["requestBody", "email"], format: "email" },
      { path: ["requestBody", "subjectId"], minLength: 1 },
      { path: ["requestBody", "subjectType"], enum: identityInvitationSubjectTypes },
      { path: ["responseData", "subjectType"], enum: identityInvitationSubjectTypes },
      { path: ["responseData", "role"], enum: identityInvitationSubjectTypes },
      { path: ["responseData", "status"], enum: identityInvitationStatuses },
      { path: ["responseData", "expiresAt"], format: "date-time" },
    ],
  },
  {
    method: "post",
    path: "/api/v1/identity-invitations/accept",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["password", "token"],
    requestForbidden: ["acceptedUserId", "email", "role", "status", "subjectId", "subjectType", "tenantId", "tokenHash"],
    responseDataRequired: ["status"],
    responseDataForbiddenDeep: [
      "acceptedUserId",
      "activationToken",
      "createdAt",
      "email",
      "id",
      "name",
      "password",
      "role",
      "subjectId",
      "subjectType",
      "tenantId",
      "token",
      "tokenHash",
      "updatedAt",
    ],
    fieldChecks: [
      { path: ["requestBody", "password"], minLength: 8 },
      { path: ["requestBody", "token"], minLength: 1 },
      { path: ["responseData", "status"], enum: ["ACCEPTED"] },
      { path: ["responseData", "acceptedAt"], format: "date-time" },
    ],
  },
  {
    method: "post",
    path: "/api/v1/identity-invitations/{id}/resend",
    responseEnvelope: true,
    responseDataRequired: identityInvitationRecordRequired,
    responseDataForbiddenDeep: identityInvitationResponseForbiddenDeep,
    fieldChecks: [
      { path: ["responseData", "subjectType"], enum: identityInvitationSubjectTypes },
      { path: ["responseData", "role"], enum: identityInvitationSubjectTypes },
      { path: ["responseData", "status"], enum: identityInvitationStatuses },
      { path: ["responseData", "expiresAt"], format: "date-time" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/attendance",
    responseEnvelope: true,
    responseListEnvelope: true,
    responseDataItemsRequired: ["id", "tenantId", "studentId", "date", "status"],
    fieldChecks: [
      { path: ["responseData", "items", "status"], enum: attendanceStatuses },
      { path: ["responseData", "items", "date"], format: "date" },
    ],
  },
  {
    method: "get",
    path: "/api/v1/attendance/summary",
    responseEnvelope: true,
    responseDataRequired: ["studentId", "total", "present", "absent", "late", "excused"],
    fieldChecks: [
      { path: ["responseData", "total"], minimum: 0 },
      { path: ["responseData", "absent"], minimum: 0 },
    ],
  },
  {
    method: "post",
    path: "/api/v1/attendance",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["date", "status", "studentId"],
    responseDataRequired: ["id", "tenantId", "studentId", "date", "status"],
    fieldChecks: [
      { path: ["requestBody", "date"], format: "date" },
      { path: ["requestBody", "status"], enum: attendanceStatuses },
      { path: ["responseData", "date"], format: "date" },
      { path: ["responseData", "status"], enum: attendanceStatuses },
    ],
  },
  {
    method: "patch",
    path: "/api/v1/attendance/{id}",
    requestBody: true,
    responseEnvelope: true,
    requestRequired: ["status"],
    requestProperties: ["courseId", "status", "termId"],
    responseDataRequired: ["id", "tenantId", "studentId", "date", "status"],
    fieldChecks: [
      { path: ["requestBody", "status"], enum: attendanceStatuses },
      { path: ["responseData", "status"], enum: attendanceStatuses },
    ],
  },
  {
    method: "delete",
    path: "/api/v1/attendance/{id}",
    responseStatus: "204",
    noResponseBody: true,
  },
];

function schoolCrudContracts({ basePath, createRequired, responseRequired, dateFields = [] }) {
  return [
    {
      method: "get",
      path: basePath,
      responseListEnvelope: true,
      responseDataItemsRequired: responseRequired,
      fieldChecks: dateFieldChecks("responseDataItem", dateFields),
    },
    {
      method: "post",
      path: basePath,
      requestBody: true,
      responseEnvelope: true,
      requestRequired: createRequired,
      responseDataRequired: responseRequired,
      fieldChecks: [
        ...dateFieldChecks("requestBody", dateFields),
        ...dateFieldChecks("responseData", dateFields),
      ],
    },
    {
      method: "get",
      path: `${basePath}/{id}`,
      responseEnvelope: true,
      responseDataRequired: responseRequired,
      fieldChecks: dateFieldChecks("responseData", dateFields),
    },
    {
      method: "patch",
      path: `${basePath}/{id}`,
      requestBody: true,
      responseEnvelope: true,
      responseDataRequired: responseRequired,
      fieldChecks: [
        ...dateFieldChecks("requestBody", dateFields),
        ...dateFieldChecks("responseData", dateFields),
      ],
    },
    {
      method: "delete",
      path: `${basePath}/{id}`,
      responseStatus: "204",
      noResponseBody: true,
    },
  ];
}

function schoolReadDeleteContracts(basePath, responseRequired) {
  return [
    {
      method: "get",
      path: basePath,
      responseListEnvelope: true,
      responseDataItemsRequired: responseRequired,
    },
    {
      method: "get",
      path: `${basePath}/{id}`,
      responseEnvelope: true,
      responseDataRequired: responseRequired,
    },
    {
      method: "delete",
      path: `${basePath}/{id}`,
      responseStatus: "204",
      noResponseBody: true,
    },
  ];
}

function dateFieldChecks(root, fields) {
  return fields.map((field) => ({ path: [root, field], format: "date" }));
}

let app;
try {
  const [{ NestFactory }, { AppModule }, { configureApiApp }, { createOpenApiDocument }] = await Promise.all([
    import("@nestjs/core"),
    import("../apps/api/dist/app.module.js"),
    import("../apps/api/dist/http/configure-api-app.js"),
    import("../apps/api/dist/openapi.js"),
  ]);

  app = await NestFactory.create(AppModule, { logger: false });
  configureApiApp(app);
  await app.init();

  const document = createOpenApiDocument(app);
  validateOpenApiDocument(document);

  await mkdir(dirname(outputPath), { recursive: true });
  assertParentPathAllowed(dirname(outputPath));
  assertExistingFileArtifact(outputPath);
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`);
  assertExistingFileArtifact(outputPath);

  console.log(`OpenAPI JSON yazıldı: ${outputPath} (${Object.keys(document.paths).length} path).`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Cannot find module") && message.includes("apps/api/dist")) {
    console.error("OpenAPI üretimi için önce API build çıktısı gerekli: pnpm --filter @o-okul/api build");
  }
  console.error(`OpenAPI üretimi başarısız: ${message}`);
  process.exitCode = 1;
} finally {
  await app?.close();
}

function validateOpenApiDocument(document) {
  const failures = [];
  const pathKeys = Object.keys(document.paths ?? {});
  if (pathKeys.length < 40) {
    failures.push(`OpenAPI path sayısı beklenenden düşük: ${pathKeys.length}`);
  }

  for (const expectedPath of [
    "/api/v1/auth/login",
    "/api/v1/students",
    "/api/v1/exams",
    "/api/v1/payment-plans",
    "/api/v1/metrics",
  ]) {
    if (!document.paths?.[expectedPath]) {
      failures.push(`OpenAPI eksik path: ${expectedPath}`);
    }
  }

  if (document.openapi !== "3.0.0") {
    failures.push(`OpenAPI versiyonu beklenmiyor: ${document.openapi}`);
  }

  if (!document.components?.securitySchemes?.["access-token"]) {
    failures.push("OpenAPI access-token bearer security scheme eksik.");
  }

  for (const contract of requiredOperationContracts) {
    const operation = document.paths?.[contract.path]?.[contract.method];
    if (!operation) {
      failures.push(`OpenAPI contract path/metot eksik: ${contract.method.toUpperCase()} ${contract.path}`);
      continue;
    }

    if (contract.requestBody && !operation.requestBody?.content?.["application/json"]?.schema) {
      failures.push(`OpenAPI request body schema eksik: ${contract.method.toUpperCase()} ${contract.path}`);
    }

    const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
    if (contract.requestBodyRequired !== undefined && operation.requestBody?.required !== contract.requestBodyRequired) {
      failures.push(`OpenAPI request body required beklenmiyor: ${contract.method.toUpperCase()} ${contract.path}=${operation.requestBody?.required}`);
    }
    if (contract.requestRequired) {
      requireSchemaFields(requestSchema, contract.requestRequired, failures, `${contract.method.toUpperCase()} ${contract.path} request body`);
    }
    if (contract.requestProperties) {
      requireSchemaProperties(requestSchema, contract.requestProperties, failures, `${contract.method.toUpperCase()} ${contract.path} request body`);
    }
    if (contract.requestForbidden) {
      rejectSchemaProperties(requestSchema, contract.requestForbidden, failures, `${contract.method.toUpperCase()} ${contract.path} request body`);
    }
    if (contract.requestMinProperties !== undefined && requestSchema?.minProperties !== contract.requestMinProperties) {
      failures.push(`OpenAPI minProperties beklenmiyor: ${contract.method.toUpperCase()} ${contract.path} request body=${requestSchema?.minProperties}`);
    }
    if (contract.requestAnyOfRequired) {
      requireAnyOfRequired(requestSchema, contract.requestAnyOfRequired, failures, `${contract.method.toUpperCase()} ${contract.path} request body`);
    }
    if (contract.requiredHeaders) {
      for (const header of contract.requiredHeaders) {
        requireHeader(operation, header, failures, `${contract.method.toUpperCase()} ${contract.path}`);
      }
    }

    if (contract.responseStatus && !operation.responses?.[contract.responseStatus]) {
      failures.push(`OpenAPI response status eksik: ${contract.method.toUpperCase()} ${contract.path} ${contract.responseStatus}`);
    }
    if (contract.noResponseBody) {
      const response = operation.responses?.[contract.responseStatus ?? "204"];
      if (response?.content) {
        failures.push(`OpenAPI no-content response body tasimamali: ${contract.method.toUpperCase()} ${contract.path}`);
      }
    }

    const successResponse = operation.responses?.[contract.responseStatus] ?? operation.responses?.["201"] ?? operation.responses?.["200"];
    const successSchema = successResponse?.content?.["application/json"]?.schema;
    const rawResponseSchema = contract.rawResponseContentType
      ? successResponse?.content?.[contract.rawResponseContentType]?.schema
      : undefined;
    if (contract.rawResponseContentType && !rawResponseSchema) {
      failures.push(`OpenAPI raw response content eksik: ${contract.method.toUpperCase()} ${contract.path} ${contract.rawResponseContentType}`);
    }
    if (contract.rawResponseRequired) {
      requireSchemaFields(rawResponseSchema, contract.rawResponseRequired, failures, `${contract.method.toUpperCase()} ${contract.path} raw response`);
    }
    if (contract.rawResponseForbiddenDeep) {
      rejectSchemaPropertiesDeep(rawResponseSchema, contract.rawResponseForbiddenDeep, failures, `${contract.method.toUpperCase()} ${contract.path} raw response`);
    }
    if (contract.responseEnvelope && !hasRequiredDataEnvelope(successSchema)) {
      failures.push(`OpenAPI response envelope schema eksik: ${contract.method.toUpperCase()} ${contract.path}`);
    }
    if (contract.responseListEnvelope && !hasRequiredListEnvelope(successSchema)) {
      failures.push(`OpenAPI list response meta schema eksik: ${contract.method.toUpperCase()} ${contract.path}`);
    }
    if (contract.responseDataOneOfRequired) {
      requireOneOfSchemaFields(successSchema?.properties?.data, contract.responseDataOneOfRequired, failures, `${contract.method.toUpperCase()} ${contract.path} response data`);
    }
    if (contract.responseDataRequired) {
      requireSchemaFields(successSchema?.properties?.data, contract.responseDataRequired, failures, `${contract.method.toUpperCase()} ${contract.path} response data`);
    }
    if (contract.responseDataItemsRequired) {
      requireSchemaFields(successSchema?.properties?.data?.items, contract.responseDataItemsRequired, failures, `${contract.method.toUpperCase()} ${contract.path} response data item`);
    }
    if (contract.responseDataItemsForbidden) {
      rejectSchemaProperties(successSchema?.properties?.data?.items, contract.responseDataItemsForbidden, failures, `${contract.method.toUpperCase()} ${contract.path} response data item`);
    }
    if (contract.responseDataForbidden) {
      rejectSchemaProperties(successSchema?.properties?.data, contract.responseDataForbidden, failures, `${contract.method.toUpperCase()} ${contract.path} response data`);
    }
    if (contract.responseDataForbiddenDeep) {
      rejectSchemaPropertiesDeep(successSchema?.properties?.data, contract.responseDataForbiddenDeep, failures, `${contract.method.toUpperCase()} ${contract.path} response data`);
    }

    if (contract.idempotencyHeader && !hasOptionalIdempotencyHeader(operation)) {
      failures.push(`OpenAPI optional Idempotency-Key header eksik: ${contract.method.toUpperCase()} ${contract.path}`);
    }

    for (const check of contract.fieldChecks ?? []) {
      const schema = resolveContractSchema(check.path, requestSchema, successSchema?.properties?.data, rawResponseSchema);
      validateFieldCheck(schema, check, failures, `${contract.method.toUpperCase()} ${contract.path} ${check.path.join(".")}`);
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }
}

function requireSchemaFields(schema, fields, failures, label) {
  requireSchemaProperties(schema, fields, failures, label);
  const required = Array.isArray(schema?.required) ? schema.required : [];
  for (const field of fields) {
    if (!required.includes(field)) {
      failures.push(`OpenAPI required alan eksik: ${label}.${field}`);
    }
  }
}

function requireSchemaProperties(schema, fields, failures, label) {
  for (const field of fields) {
    if (!schema?.properties?.[field]) {
      failures.push(`OpenAPI property eksik: ${label}.${field}`);
    }
  }
}

function rejectSchemaProperties(schema, fields, failures, label) {
  for (const field of fields) {
    if (schema?.properties?.[field]) {
      failures.push(`OpenAPI property olmamali: ${label}.${field}`);
    }
  }
}

function rejectSchemaPropertiesDeep(schema, fields, failures, label) {
  for (const field of fields) {
    if (schemaHasPropertyDeep(schema, field)) {
      failures.push(`OpenAPI property olmamali: ${label}.${field}`);
    }
  }
}

function schemaHasPropertyDeep(schema, field) {
  if (!schema || typeof schema !== "object") return false;
  if (schema.properties?.[field]) return true;
  if (Array.isArray(schema.oneOf) && schema.oneOf.some((entry) => schemaHasPropertyDeep(entry, field))) return true;
  if (Array.isArray(schema.anyOf) && schema.anyOf.some((entry) => schemaHasPropertyDeep(entry, field))) return true;
  if (schema.items && schemaHasPropertyDeep(schema.items, field)) return true;
  return false;
}

function requireOneOfSchemaFields(schema, fieldGroups, failures, label) {
  const oneOf = Array.isArray(schema?.oneOf) ? schema.oneOf : [];
  for (const group of fieldGroups) {
    const found = oneOf.some((entry) => schemaHasRequiredFields(entry, group));
    if (!found) {
      failures.push(`OpenAPI oneOf required grup eksik: ${label}=[${group.join(",")}]`);
    }
  }
}

function schemaHasRequiredFields(schema, fields) {
  const required = Array.isArray(schema?.required) ? schema.required : [];
  return fields.every((field) => schema?.properties?.[field] && required.includes(field));
}

function requireHeader(operation, header, failures, label) {
  const found = (operation.parameters ?? []).some((parameter) =>
    parameter?.in === "header" &&
    typeof parameter.name === "string" &&
    parameter.name.toLowerCase() === header.toLowerCase() &&
    parameter.required === true,
  );
  if (!found) {
    failures.push(`OpenAPI required header eksik: ${label} ${header}`);
  }
}

function requireAnyOfRequired(schema, requiredGroups, failures, label) {
  const actualGroups = Array.isArray(schema?.anyOf)
    ? schema.anyOf.map((entry) => Array.isArray(entry?.required) ? [...entry.required].sort() : [])
    : [];
  for (const group of requiredGroups) {
    const expected = [...group].sort();
    const found = actualGroups.some((actual) =>
      actual.length === expected.length && actual.every((value, index) => value === expected[index]),
    );
    if (!found) {
      failures.push(`OpenAPI anyOf required grup eksik: ${label}=[${expected.join(",")}]`);
    }
  }
}

function hasRequiredDataEnvelope(schema) {
  return Boolean(
    schema?.properties?.data &&
    Array.isArray(schema.required) &&
    schema.required.includes("data"),
  );
}

function hasRequiredListEnvelope(schema) {
  const meta = schema?.properties?.meta;
  return Boolean(
    hasRequiredDataEnvelope(schema) &&
    meta &&
    Array.isArray(schema.required) &&
    schema.required.includes("meta") &&
    schema?.properties?.data?.type === "array" &&
    schema?.properties?.data?.items &&
    Array.isArray(meta.required) &&
    ["total", "page", "limit", "totalPages"].every((field) => meta.required.includes(field) && meta.properties?.[field]),
  );
}

function resolveContractSchema(path, requestSchema, responseDataSchema, rawResponseSchema) {
  const [root, ...segments] = path;
  let current = root === "requestBody"
    ? requestSchema
    : root === "rawResponse"
      ? rawResponseSchema
    : root === "responseDataItem"
      ? responseDataSchema?.items
      : responseDataSchema;
  for (const segment of segments) {
    current = segment === "items" && current?.type === "array" ? current.items : current?.properties?.[segment];
  }
  return current;
}

function validateFieldCheck(schema, check, failures, label) {
  if (!schema) {
    failures.push(`OpenAPI field schema eksik: ${label}`);
    return;
  }
  if (check.minItems !== undefined && schema.minItems !== check.minItems) {
    failures.push(`OpenAPI minItems beklenmiyor: ${label}=${schema.minItems}`);
  }
  if (check.minimum !== undefined && schema.minimum !== check.minimum) {
    failures.push(`OpenAPI minimum beklenmiyor: ${label}=${schema.minimum}`);
  }
  if (check.minLength !== undefined && schema.minLength !== check.minLength) {
    failures.push(`OpenAPI minLength beklenmiyor: ${label}=${schema.minLength}`);
  }
  if (check.format !== undefined && schema.format !== check.format) {
    failures.push(`OpenAPI format beklenmiyor: ${label}=${schema.format}`);
  }
  if (check.type !== undefined && schema.type !== check.type) {
    failures.push(`OpenAPI type beklenmiyor: ${label}=${schema.type}`);
  }
  if (check.enum) {
    const actual = Array.isArray(schema.enum) ? [...schema.enum].sort() : [];
    const expected = [...check.enum].sort();
    if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
      failures.push(`OpenAPI enum beklenmiyor: ${label}=[${actual.join(",")}]`);
    }
  }
}

function hasOptionalIdempotencyHeader(operation) {
  return (operation.parameters ?? []).some((parameter) =>
    parameter?.in === "header" &&
    typeof parameter.name === "string" &&
    parameter.name.toLowerCase() === "idempotency-key" &&
    parameter.required === false,
  );
}

function validateOutputTarget(target) {
  const file = resolve(target);
  if (isLocalTempPath(file)) {
    fail(outputTempPathError);
  }

  assertParentPathAllowed(dirname(file));
  assertExistingFileArtifact(file);
  return file;
}

function assertParentPathAllowed(parentPath) {
  const root = parse(parentPath).root;
  const segments = parentPath.slice(root.length).split(/[\\/]+/).filter(Boolean);
  let current = root;

  for (const segment of segments) {
    current = resolve(current, segment);
    if (!existsSync(current)) return;

    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      fail(outputParentSymlinkError);
    }
  }
}

function assertExistingFileArtifact(file) {
  if (!existsSync(file)) return;

  const stat = lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    fail(outputFileSymlinkError);
  }
}

function isLocalTempPath(path) {
  const normalized = path.replace(/\/+$/g, "") || "/";
  return (
    normalized === "/tmp" ||
    normalized.startsWith("/tmp/") ||
    normalized === "/var/tmp" ||
    normalized.startsWith("/var/tmp/") ||
    normalized === "/private/tmp" ||
    normalized.startsWith("/private/tmp/")
  );
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
