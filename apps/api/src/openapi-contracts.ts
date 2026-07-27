import type { OpenAPIObject } from "@nestjs/swagger";

type JsonSchema = Record<string, unknown>;
type JsonContent = Record<string, { schema: JsonSchema }>;

interface OperationContract {
  requestBody?: JsonSchema;
  requestBodyRequired?: boolean;
  responseBody?: JsonSchema;
  rawResponseBody?: JsonSchema;
  rawResponseContentType?: string;
  listResponse?: boolean;
  noContent?: boolean;
  idempotent?: boolean;
  idempotencyRequired?: boolean;
  requiredHeaders?: Array<{ name: string; description?: string; schema?: JsonSchema }>;
  queryParameters?: Array<{ name: string; description?: string; required?: boolean; schema?: JsonSchema }>;
}

const jsonContentType = "application/json";

const csrfHeaderContract = {
  name: "X-CSRF-Token",
  description: "Required CSRF token matching the csrfToken cookie for refresh/logout.",
  schema: stringSchema(),
};

const listMetaSchema = objectSchema({
  total: integerSchema({ minimum: 0 }),
  page: integerSchema({ minimum: 1 }),
  limit: integerSchema({ minimum: 0 }),
  totalPages: integerSchema({ minimum: 0 }),
}, ["total", "page", "limit", "totalPages"]);

const healthStatusSchema = objectSchema({
  status: { type: "string", enum: ["ok"] },
}, ["status"]);

const readyStatusSchema = objectSchema({
  status: { type: "string", enum: ["ready"] },
  dependencies: objectSchema({
    postgres: { type: "string", enum: ["ok"] },
    redis: { type: "string", enum: ["ok"] },
  }, ["postgres", "redis"]),
}, ["status", "dependencies"]);

const sessionSchema = objectSchema({
  id: stringSchema(),
  userId: stringSchema(),
  tenantId: stringSchema(),
  roles: arraySchema(stringSchema(), { minItems: 1 }),
  membershipVersion: integerSchema({ minimum: 0 }),
  status: stringSchema(),
  mustChangePassword: { type: "boolean" },
  subjectType: { type: "string", enum: ["STUDENT", "GUARDIAN", "TEACHER"] },
  subjectId: stringSchema(),
}, ["id", "userId", "tenantId", "roles", "membershipVersion", "status"]);

const meProfileResponseSchema = objectSchema({
  userId: stringSchema(),
  tenantId: { type: "string", nullable: true },
  roles: arraySchema(stringSchema(), { minItems: 1 }),
  mustChangePassword: { type: "boolean" },
  subjectType: { type: "string", enum: ["STUDENT", "GUARDIAN", "TEACHER"] },
  subjectId: stringSchema(),
}, ["userId", "tenantId", "roles"]);

const tenantRecordSchema = objectSchema({
  id: stringSchema(),
  name: stringSchema(),
  slug: stringSchema(),
  plan: stringSchema(),
  licenseStartsAt: stringSchema({ format: "date-time" }),
  licenseEndsAt: stringSchema({ format: "date-time" }),
  institutionType: stringSchema(),
  contactEmail: stringSchema({ format: "email" }),
  logoUrl: stringSchema(),
  seatLimit: integerSchema({ minimum: 1 }),
  activeSeatCount: integerSchema({ minimum: 0 }),
  status: stringSchema(),
}, ["id", "name", "slug", "plan", "status"]);

const tenantFirstAdminCreateRequestSchema = objectSchema({
  email: stringSchema({ format: "email" }),
  name: stringSchema({ minLength: 1 }),
  nationalId: stringSchema({ minLength: 11, maxLength: 11 }),
  phone: stringSchema({ minLength: 1 }),
}, ["email", "name", "nationalId", "phone"]);

const tenantCreateRequestSchema = objectSchema({
  contactEmail: stringSchema({ format: "email" }),
  firstAdmin: tenantFirstAdminCreateRequestSchema,
  id: stringSchema(),
  institutionType: stringSchema(),
  licenseEndsAt: stringSchema({ format: "date-time" }),
  licenseStartsAt: stringSchema({ format: "date-time" }),
  logoUrl: stringSchema(),
  name: stringSchema({ minLength: 1 }),
  plan: stringSchema(),
  seatLimit: integerSchema({ minimum: 1 }),
  slug: stringSchema({ minLength: 1 }),
  status: stringSchema(),
}, ["name", "slug"]);

const tenantCurrentProfileUpdateRequestSchema = objectSchema({
  contactEmail: stringSchema({ format: "email" }),
  institutionType: stringSchema(),
  logoUrl: stringSchema(),
  name: stringSchema(),
});

const tenantAdminUpdateRequestSchema = objectSchema({
  contactEmail: stringSchema({ format: "email" }),
  institutionType: stringSchema(),
  licenseEndsAt: stringSchema({ format: "date-time" }),
  licenseStartsAt: stringSchema({ format: "date-time" }),
  logoUrl: stringSchema(),
  name: stringSchema(),
  plan: stringSchema(),
  seatLimit: integerSchema({ minimum: 1 }),
  slug: stringSchema(),
  status: stringSchema(),
});

const tenantAssignableRoleSchema = {
  type: "string",
  enum: ["TENANT_ADMIN", "ASSISTANT_ADMIN", "TEACHER", "STUDENT", "GUARDIAN"],
};

const tenantUserManagementRoleSchema = {
  type: "string",
  enum: ["TENANT_ADMIN", "ASSISTANT_ADMIN"],
};

const tenantUserRecordSchema = objectSchema({
  id: stringSchema(),
  email: stringSchema({ format: "email" }),
  name: stringSchema(),
  tenantId: stringSchema(),
  roles: arraySchema(tenantAssignableRoleSchema, { minItems: 1 }),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "name", "tenantId", "roles", "createdAt", "updatedAt"]);

const tenantFirstAdminProvisionResultSchema = objectSchema({
  ...(tenantUserRecordSchema.properties as Record<string, JsonSchema>),
}, ["id", "email", "name", "tenantId", "roles", "createdAt", "updatedAt"]);

const tenantCreateWithAdminResponseSchema = objectSchema({
  tenant: tenantRecordSchema,
  admin: tenantFirstAdminProvisionResultSchema,
}, ["tenant", "admin"]);

const tenantUserCreateRequestSchema = objectSchema({
  email: stringSchema({ format: "email" }),
  name: stringSchema({ minLength: 1 }),
  nationalId: stringSchema({ minLength: 11, maxLength: 11 }),
  phone: stringSchema({ minLength: 1 }),
  roles: arraySchema(tenantUserManagementRoleSchema, { minItems: 1 }),
}, ["email", "name", "nationalId", "phone", "roles"]);

const tenantUserRoleUpdateRequestSchema = objectSchema({
  roles: arraySchema(tenantUserManagementRoleSchema, { minItems: 1 }),
}, ["roles"]);

const tenantUserPasswordResetResponseSchema = objectSchema({
  userId: stringSchema(),
  resetAt: stringSchema({ format: "date-time" }),
  mustChangePassword: { type: "boolean", enum: [true] },
}, ["userId", "resetAt", "mustChangePassword"]);

const portalSubjectRoleSchema = {
  type: "string",
  enum: ["TEACHER", "STUDENT", "GUARDIAN"],
};

const rolePreviewStartRequestSchema = objectSchema({
  targetRole: portalSubjectRoleSchema,
  targetSubjectId: stringSchema({ minLength: 1 }),
}, ["targetRole", "targetSubjectId"]);

const rolePreviewSessionSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  actorUserId: stringSchema(),
  targetRole: portalSubjectRoleSchema,
  targetSubjectType: portalSubjectRoleSchema,
  targetSubjectId: stringSchema(),
  mode: { type: "string", enum: ["READ_ONLY"] },
  expiresAt: stringSchema({ format: "date-time" }),
  createdAt: stringSchema({ format: "date-time" }),
  previewToken: stringSchema({ minLength: 1 }),
}, ["id", "tenantId", "actorUserId", "targetRole", "targetSubjectType", "targetSubjectId", "mode", "expiresAt", "createdAt", "previewToken"]);

const authResponseSchema = objectSchema({
  accessToken: stringSchema(),
  session: sessionSchema,
}, ["accessToken", "session"]);

const mfaChallengeResponseSchema = objectSchema({
  status: { type: "string", enum: ["MFA_REQUIRED"] },
  challengeToken: stringSchema(),
  expiresAt: stringSchema({ format: "date-time" }),
  methods: arraySchema({ type: "string", enum: ["totp", "recovery_code"] }, { minItems: 1 }),
}, ["status", "challengeToken", "expiresAt", "methods"]);

const tenantSelectionOptionSchema = objectSchema({
  tenantId: stringSchema(),
  name: stringSchema(),
  slug: stringSchema(),
}, ["tenantId", "name", "slug"]);

const tenantSelectionRequiredResponseSchema = objectSchema({
  status: { type: "string", enum: ["TENANT_SELECTION_REQUIRED"] },
  selectionToken: stringSchema(),
  expiresAt: stringSchema({ format: "date-time" }),
  tenants: arraySchema(tenantSelectionOptionSchema, { minItems: 1 }),
}, ["status", "selectionToken", "expiresAt", "tenants"]);

const tenantSelectionRequestSchema = objectSchema({
  selectionToken: stringSchema({ minLength: 1 }),
  tenantId: stringSchema({ minLength: 1 }),
}, ["selectionToken", "tenantId"]);

const refreshRequestSchema = objectSchema({});

const passwordResetAcceptedResponseSchema = objectSchema({
  status: { type: "string", enum: ["ACCEPTED"] },
}, ["status"]);

const passwordResetConfirmResponseSchema = objectSchema({
  resetAt: stringSchema({ format: "date-time" }),
}, ["resetAt"]);

const mePasswordChangeRequestSchema = objectSchema({
  currentPassword: stringSchema({ minLength: 1 }),
  newPassword: stringSchema({ minLength: 8 }),
}, ["currentPassword", "newPassword"]);

const mePasswordChangeResponseSchema = objectSchema({
  changedAt: stringSchema({ format: "date-time" }),
}, ["changedAt"]);

const totpVerificationRequestSchema = objectSchema({
  challengeToken: stringSchema(),
  totpCode: stringSchema(),
  recoveryCode: stringSchema(),
}, ["challengeToken"], {
  anyOf: [
    { required: ["totpCode"] },
    { required: ["recoveryCode"] },
  ],
});

const totpSetupConfirmRequestSchema = objectSchema({
  setupToken: stringSchema(),
  totpCode: stringSchema(),
}, ["setupToken", "totpCode"]);

const totpSetupResponseSchema = objectSchema({
  secret: stringSchema(),
  keyUri: stringSchema(),
  setupToken: stringSchema(),
  setupExpiresAt: stringSchema({ format: "date-time" }),
  recoveryCodes: arraySchema(stringSchema(), { minItems: 1 }),
}, ["secret", "keyUri", "setupToken", "setupExpiresAt", "recoveryCodes"]);

const mfaEnrollmentRequiredResponseSchema = objectSchema({
  status: { type: "string", enum: ["MFA_ENROLLMENT_REQUIRED"] },
  secret: stringSchema(),
  keyUri: stringSchema(),
  setupToken: stringSchema(),
  setupExpiresAt: stringSchema({ format: "date-time" }),
  recoveryCodes: arraySchema(stringSchema(), { minItems: 1 }),
}, ["status", "secret", "keyUri", "setupToken", "setupExpiresAt", "recoveryCodes"]);

const totpSetupConfirmResponseSchema = objectSchema({
  enabledAt: stringSchema({ format: "date-time" }),
  recoveryCodesRemaining: integerSchema({ minimum: 0 }),
}, ["enabledAt", "recoveryCodesRemaining"]);

const totpStatusResponseSchema = objectSchema({
  mode: { type: "string", enum: ["off", "optional", "required"] },
  enabled: { type: "boolean" },
  enabledAt: stringSchema({ format: "date-time" }),
  recoveryCodesRemaining: integerSchema({ minimum: 0 }),
}, ["mode", "enabled", "recoveryCodesRemaining"]);

const totpDisableRequestSchema = objectSchema({
  totpCode: stringSchema(),
  recoveryCode: stringSchema(),
}, [], {
  anyOf: [
    { required: ["totpCode"] },
    { required: ["recoveryCode"] },
  ],
});

const totpDisableResponseSchema = objectSchema({
  disabledAt: stringSchema({ format: "date-time" }),
}, ["disabledAt"]);

const notificationDeviceRegisterRequestSchema = objectSchema({
  platform: stringSchema(),
  provider: stringSchema({ minLength: 1 }),
  token: stringSchema({ minLength: 1 }),
}, ["provider", "token"]);

const publicNotificationDeviceRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  subjectType: { type: "string", enum: ["STUDENT", "GUARDIAN", "TEACHER"] },
  subjectId: stringSchema(),
  provider: stringSchema(),
  platform: stringSchema(),
  lastSeenAt: stringSchema({ format: "date-time" }),
  disabledAt: stringSchema({ format: "date-time" }),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "provider", "lastSeenAt"]);

const kvkkInventoryRecordSchema = objectSchema({
  id: stringSchema(),
  kind: { type: "string", enum: ["student", "teacher", "guardian", "user"] },
  displayRef: stringSchema(),
  piiCategories: arraySchema(stringSchema()),
  purgeAvailable: { type: "boolean" },
}, ["id", "kind", "displayRef", "piiCategories", "purgeAvailable"]);

const selfPurgeResultSchema = objectSchema({
  userId: stringSchema(),
  tenantId: stringSchema(),
  purgedAt: stringSchema({ format: "date-time" }),
}, ["userId", "purgedAt"]);

const answerChoiceSchema = {
  type: "string",
  enum: ["A", "B", "C", "D", "E"],
};

const answerKeyScoringConfigSchema = optionalObject({
  rawScoreMultiplier: numberSchema(),
  standardScoreBase: numberSchema(),
  standardScoreMultiplier: numberSchema(),
  wrongPenalty: numberSchema({ minimum: 0 }),
});

const answerKeyStatusSchema = {
  type: "string",
  enum: ["DRAFT", "PUBLISHED"],
};

const answerKeyEvaluationStatusSchema = {
  type: "string",
  enum: ["ACTIVE", "CANCELLED"],
  default: "ACTIVE",
};

const answerKeyScoreSectionSchema = {
  type: "string",
  enum: [
    "LGS_TURKCE", "LGS_MATEMATIK", "LGS_FEN", "LGS_INKILAP", "LGS_DIN", "LGS_YABANCI_DIL",
    "TYT_TURKCE", "TYT_SOSYAL", "TYT_MATEMATIK", "TYT_FEN",
    "AYT_MATEMATIK", "AYT_FIZIK", "AYT_KIMYA", "AYT_BIYOLOJI", "AYT_EDEBIYAT",
    "AYT_TARIH_1", "AYT_COGRAFYA_1", "AYT_TARIH_2", "AYT_COGRAFYA_2", "AYT_FELSEFE", "AYT_DIN",
  ],
};

const answerKeyQuestionSchema = objectSchema({
  branch: stringSchema(),
  correctAnswer: answerChoiceSchema,
  evaluationStatus: answerKeyEvaluationStatusSchema,
  outcomeCode: stringSchema(),
  questionNo: integerSchema({ minimum: 1 }),
  scoreSection: answerKeyScoreSectionSchema,
  topic: stringSchema(),
}, ["branch", "correctAnswer", "evaluationStatus", "questionNo"]);

const answerKeyBookletVariantSchema = objectSchema({
  code: stringSchema(),
  permutation: arraySchema(integerSchema({ minimum: 1 }), { minItems: 1 }),
}, ["code", "permutation"]);

const answerKeyBranchSummarySchema = objectSchema({
  branch: stringSchema(),
  questionCount: integerSchema({ minimum: 1 }),
}, ["branch", "questionCount"]);

const answerKeyRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  examId: stringSchema(),
  version: stringSchema(),
  questionCount: integerSchema({ minimum: 1 }),
  branches: arraySchema(answerKeyBranchSummarySchema, { minItems: 1 }),
  scoringConfig: answerKeyScoringConfigSchema,
  status: answerKeyStatusSchema,
  publishedAt: stringSchema({ format: "date-time" }),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "examId", "version", "questionCount", "branches", "scoringConfig", "status", "createdAt", "updatedAt"]);

const publishedAnswerKeyRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  examId: stringSchema(),
  version: stringSchema(),
  questionCount: integerSchema({ minimum: 1 }),
  branches: arraySchema(answerKeyBranchSummarySchema, { minItems: 1 }),
  scoringConfig: answerKeyScoringConfigSchema,
  status: { type: "string", enum: ["PUBLISHED"] },
  publishedAt: stringSchema({ format: "date-time" }),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "examId", "version", "questionCount", "branches", "scoringConfig", "status", "publishedAt", "createdAt", "updatedAt"]);

const announcementAudienceSchema = {
  type: "string",
  enum: ["SCHOOL", "TEACHERS", "STUDENTS", "GUARDIANS"],
};

const announcementDeliveryChannelSchema = {
  type: "string",
  enum: ["EMAIL", "PUSH"],
};

const announcementDeliveryResultStatusSchema = {
  type: "string",
  enum: ["completed", "failed"],
};

const announcementDeliveryStatusSchema = {
  type: "string",
  enum: ["queued", "completed", "failed"],
};

const announcementRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  title: stringSchema(),
  body: stringSchema(),
  audience: announcementAudienceSchema,
  campusId: stringSchema(),
  gradeLevelId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  publishedAt: stringSchema({ format: "date-time" }),
  readAt: stringSchema({ format: "date-time" }),
  deletedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "title", "body", "audience", "publishedAt"]);

const announcementRecipientRecordSchema = objectSchema({
  announcementId: stringSchema(),
  recipientType: { type: "string", enum: ["STUDENT", "GUARDIAN", "TEACHER"] },
  subjectId: stringSchema(),
  userId: stringSchema(),
  displayName: stringSchema(),
  relatedStudentId: stringSchema(),
  relatedStudentName: stringSchema(),
  readAt: stringSchema({ format: "date-time" }),
}, ["announcementId", "recipientType", "subjectId", "displayName"]);

const announcementRecipientReportSchema = objectSchema({
  announcementId: stringSchema(),
  total: integerSchema({ minimum: 0 }),
  read: integerSchema({ minimum: 0 }),
  unread: integerSchema({ minimum: 0 }),
  recipients: arraySchema(announcementRecipientRecordSchema),
}, ["announcementId", "total", "read", "unread", "recipients"]);

const announcementDeliveryQueueResultSchema = objectSchema({
  tenantId: stringSchema(),
  announcementId: stringSchema(),
  channel: announcementDeliveryChannelSchema,
  recipientCount: integerSchema({ minimum: 0 }),
  deliveredCount: integerSchema({ minimum: 0 }),
  failedCount: integerSchema({ minimum: 0 }),
  queueName: { type: "string", enum: ["announcement-delivery"] },
  jobId: stringSchema(),
  status: { type: "string", enum: ["queued"] },
}, ["tenantId", "announcementId", "channel", "recipientCount", "deliveredCount", "failedCount", "queueName", "jobId", "status"]);

const announcementDeliveryReportRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  announcementId: stringSchema(),
  channel: announcementDeliveryChannelSchema,
  recipientCount: integerSchema({ minimum: 0 }),
  deliveredCount: integerSchema({ minimum: 0 }),
  failedCount: integerSchema({ minimum: 0 }),
  status: announcementDeliveryStatusSchema,
  providerErrorCode: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "announcementId", "channel", "recipientCount", "deliveredCount", "failedCount", "status"]);

const paymentInstallmentStatusSchema = {
  type: "string",
  enum: ["PENDING", "PAID", "OVERDUE", "CANCELED"],
};
const paymentTransactionMethodSchema = {
  type: "string",
  enum: ["CASH", "BANK_TRANSFER", "CARD_POS", "OTHER"],
};

const teacherAssignmentRoleSchema = {
  type: "string",
  enum: ["CLASS_TEACHER", "BRANCH_TEACHER", "GUIDANCE_COUNSELOR", "RESPONSIBLE_TEACHER"],
};

const teacherNoteVisibilitySchema = {
  type: "string",
  enum: ["INTERNAL", "GUARDIAN_STUDENT"],
};

const supportTicketPrioritySchema = {
  type: "string",
  enum: ["LOW", "NORMAL", "HIGH"],
};

const supportTicketStatusSchema = {
  type: "string",
  enum: ["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"],
};

const auditLogCategorySchema = {
  type: "string",
  enum: ["academic", "finance", "identity", "invitation", "kvkk", "operation", "report", "tenant", "user"],
};

const uploadContentTypeSchema = {
  type: "string",
  enum: ["application/pdf", "image/jpeg", "image/png", "text/plain"],
};

const fileDownloadResultSchema = objectSchema({
  fileName: stringSchema(),
  contentType: uploadContentTypeSchema,
  byteSize: integerSchema({ minimum: 1 }),
  sha256: stringSchema(),
  downloadMode: { type: "string", enum: ["inline", "signed-url"] },
  fileBase64: stringSchema({ format: "byte" }),
  downloadUrl: stringSchema(),
  downloadUrlExpiresAt: stringSchema({ format: "date-time" }),
  downloadUrlExpiresInSeconds: integerSchema({ minimum: 0 }),
}, ["fileName", "contentType", "byteSize", "sha256", "downloadMode"]);

const attendanceStatusSchema = {
  type: "string",
  enum: ["PRESENT", "ABSENT", "LATE", "EXCUSED"],
};

const developmentAssessmentVisibilitySchema = {
  type: "string",
  enum: ["GUARDIAN", "INTERNAL"],
};

const developmentCriterionRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  name: stringSchema(),
  scaleMin: integerSchema(),
  scaleMax: integerSchema(),
  sortOrder: integerSchema({ minimum: 0 }),
}, ["id", "tenantId", "name", "scaleMin", "scaleMax", "sortOrder"]);

const developmentCriterionCreateRequestSchema = objectSchema({
  name: stringSchema(),
  scaleMin: integerSchema(),
  scaleMax: integerSchema(),
  sortOrder: integerSchema(),
}, ["name"]);

const developmentScoreRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  assessmentId: stringSchema(),
  criterionId: stringSchema(),
  score: integerSchema(),
}, ["id", "tenantId", "assessmentId", "criterionId", "score"]);

const developmentAssessmentScoreInputSchema = objectSchema({
  criterionId: stringSchema(),
  score: integerSchema(),
}, ["criterionId", "score"]);

const developmentAssessmentRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  studentId: stringSchema(),
  teacherId: stringSchema(),
  termId: stringSchema(),
  periodLabel: stringSchema(),
  mentorNote: stringSchema(),
  visibility: developmentAssessmentVisibilitySchema,
  createdAt: stringSchema({ format: "date-time" }),
  scores: arraySchema(developmentScoreRecordSchema, { minItems: 1 }),
}, ["id", "tenantId", "studentId", "teacherId", "periodLabel", "visibility", "scores"]);

const developmentAssessmentCreateRequestSchema = objectSchema({
  mentorNote: stringSchema(),
  periodLabel: stringSchema(),
  scores: arraySchema(developmentAssessmentScoreInputSchema, { minItems: 1 }),
  studentId: stringSchema(),
  teacherId: stringSchema(),
  termId: stringSchema(),
  visibility: developmentAssessmentVisibilitySchema,
}, ["periodLabel", "scores", "studentId"]);

const developmentTrendScoreSchema = objectSchema({
  criterionId: stringSchema(),
  criterionName: stringSchema(),
  score: integerSchema({ minimum: 0 }),
  scaleMin: integerSchema({ minimum: 0 }),
  scaleMax: integerSchema({ minimum: 0 }),
}, ["criterionId", "criterionName", "score", "scaleMin", "scaleMax"]);

const developmentTrendItemSchema = objectSchema({
  id: stringSchema(),
  periodLabel: stringSchema(),
  mentorNote: stringSchema(),
  visibility: developmentAssessmentVisibilitySchema,
  createdAt: stringSchema({ format: "date-time" }),
  scores: arraySchema(developmentTrendScoreSchema, { minItems: 1 }),
}, ["id", "periodLabel", "visibility", "scores"]);

const namedSchoolReferenceRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  name: stringSchema(),
  code: stringSchema(),
}, ["id", "tenantId", "name"]);

const namedSchoolReferenceCreateRequestSchema = objectSchema({
  code: stringSchema(),
  name: stringSchema(),
  tenantId: stringSchema(),
}, ["name"]);

const namedSchoolReferenceUpdateRequestSchema = objectSchema({
  code: stringSchema(),
  name: stringSchema(),
});

const alanRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  gradeLevelId: stringSchema(),
  name: stringSchema(),
  code: stringSchema(),
}, ["id", "tenantId", "name"]);

const alanCreateRequestSchema = objectSchema({
  code: stringSchema(),
  gradeLevelId: stringSchema(),
  name: stringSchema(),
  tenantId: stringSchema(),
}, ["name"]);

const alanUpdateRequestSchema = objectSchema({
  code: stringSchema(),
  gradeLevelId: stringSchema(),
  name: stringSchema(),
});

const gradeLevelCourseRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  gradeLevelId: stringSchema(),
  courseId: stringSchema(),
  alanId: stringSchema(),
  isDefault: { type: "boolean" },
  sortOrder: integerSchema(),
  courseName: stringSchema(),
  courseCode: stringSchema(),
  alanName: stringSchema(),
}, ["id", "tenantId", "gradeLevelId", "courseId", "isDefault", "sortOrder", "courseName"]);

const learningOutcomeRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  code: stringSchema(),
  branch: stringSchema(),
  title: stringSchema(),
  level: stringSchema(),
}, ["id", "tenantId", "code", "branch", "title"]);

const learningOutcomeCreateRequestSchema = objectSchema({
  branch: stringSchema(),
  code: stringSchema(),
  level: stringSchema(),
  tenantId: stringSchema(),
  title: stringSchema(),
}, ["branch", "code", "title"]);

const learningOutcomeUpdateRequestSchema = objectSchema({
  branch: stringSchema(),
  code: stringSchema(),
  level: stringSchema(),
  title: stringSchema(),
});

const learningOutcomeImportRequestSchema = objectSchema({
  fileBase64: stringSchema({ minLength: 1 }),
}, ["fileBase64"]);

const learningOutcomeImportErrorSchema = objectSchema({
  row: integerSchema({ minimum: 1 }),
  field: { type: "string", enum: ["code", "branch", "title"] },
  code: { type: "string", enum: ["DUPLICATE_CODE", "REQUIRED"] },
  value: stringSchema(),
}, ["row", "field", "code"]);

const learningOutcomeImportPreviewRowSchema = objectSchema({
  row: integerSchema({ minimum: 1 }),
  code: stringSchema(),
  branch: stringSchema(),
  title: stringSchema(),
  level: stringSchema(),
  willUpdate: { type: "boolean" },
}, ["row", "code", "branch", "title"]);

const learningOutcomeImportDryRunResultSchema = objectSchema({
  dryRun: { type: "boolean", enum: [true] },
  totalRows: integerSchema({ minimum: 0 }),
  validRows: arraySchema(learningOutcomeImportPreviewRowSchema),
  errors: arraySchema(learningOutcomeImportErrorSchema),
  wouldImport: { type: "boolean" },
}, ["dryRun", "totalRows", "validRows", "errors", "wouldImport"]);

const learningOutcomeImportResultSchema = objectSchema({
  importedRows: integerSchema({ minimum: 0 }),
  createdOutcomes: integerSchema({ minimum: 0 }),
  updatedOutcomes: integerSchema({ minimum: 0 }),
  outcomes: arraySchema(learningOutcomeRecordSchema),
}, ["importedRows", "createdOutcomes", "updatedOutcomes", "outcomes"]);

const academicYearRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  name: stringSchema(),
  startsAt: stringSchema({ format: "date" }),
  endsAt: stringSchema({ format: "date" }),
  isActive: { type: "boolean" },
}, ["id", "tenantId", "name", "startsAt", "endsAt", "isActive"]);

const academicYearCreateRequestSchema = objectSchema({
  endsAt: stringSchema({ format: "date" }),
  isActive: { type: "boolean" },
  name: stringSchema(),
  startsAt: stringSchema({ format: "date" }),
  tenantId: stringSchema(),
}, ["endsAt", "name", "startsAt"]);

const academicYearUpdateRequestSchema = objectSchema({
  endsAt: stringSchema({ format: "date" }),
  isActive: { type: "boolean" },
  name: stringSchema(),
  startsAt: stringSchema({ format: "date" }),
});

const academicTermRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  academicYearId: stringSchema(),
  name: stringSchema(),
  startsAt: stringSchema({ format: "date" }),
  endsAt: stringSchema({ format: "date" }),
  isActive: { type: "boolean" },
}, ["id", "tenantId", "academicYearId", "name", "startsAt", "endsAt", "isActive"]);

const academicTermCreateRequestSchema = objectSchema({
  academicYearId: stringSchema(),
  endsAt: stringSchema({ format: "date" }),
  isActive: { type: "boolean" },
  name: stringSchema(),
  startsAt: stringSchema({ format: "date" }),
  tenantId: stringSchema(),
}, ["academicYearId", "endsAt", "name", "startsAt"]);

const academicTermUpdateRequestSchema = objectSchema({
  academicYearId: stringSchema(),
  endsAt: stringSchema({ format: "date" }),
  isActive: { type: "boolean" },
  name: stringSchema(),
  startsAt: stringSchema({ format: "date" }),
});

const classRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  name: stringSchema(),
  alanId: stringSchema(),
  campusId: stringSchema(),
  gradeLevelId: stringSchema(),
  section: stringSchema(),
}, ["id", "tenantId", "name"]);

const teacherPortalLookupsResponseSchema = objectSchema({
  campuses: arraySchema(namedSchoolReferenceRecordSchema),
  classes: arraySchema(classRecordSchema),
  courses: arraySchema(namedSchoolReferenceRecordSchema),
  gradeLevels: arraySchema(namedSchoolReferenceRecordSchema),
  terms: arraySchema(academicTermRecordSchema),
}, ["campuses", "classes", "courses", "gradeLevels", "terms"]);

const classCreateRequestSchema = objectSchema({
  alanId: stringSchema(),
  campusId: stringSchema(),
  gradeLevelId: stringSchema(),
  name: stringSchema(),
  section: stringSchema(),
  tenantId: stringSchema(),
}, ["name"]);

const classUpdateRequestSchema = objectSchema({
  alanId: stringSchema(),
  campusId: stringSchema(),
  gradeLevelId: stringSchema(),
  name: stringSchema(),
  section: stringSchema(),
}, [], { minProperties: 1 });

const teacherAssignmentRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  teacherId: stringSchema(),
  classId: stringSchema(),
  studentId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  role: teacherAssignmentRoleSchema,
  startsAt: stringSchema({ format: "date" }),
  endsAt: stringSchema({ format: "date" }),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "teacherId", "role"]);

const teacherAssignmentCreateRequestSchema = objectSchema({
  classId: stringSchema(),
  courseId: stringSchema(),
  endsAt: stringSchema({ format: "date" }),
  role: teacherAssignmentRoleSchema,
  startsAt: stringSchema({ format: "date" }),
  studentId: stringSchema(),
  termId: stringSchema(),
}, [], {
  anyOf: [
    { required: ["classId"] },
    { required: ["studentId"] },
  ],
});

const teacherAssignmentUpdateRequestSchema = objectSchema({
  classId: stringSchema(),
  courseId: stringSchema(),
  endsAt: stringSchema({ format: "date" }),
  role: teacherAssignmentRoleSchema,
  startsAt: stringSchema({ format: "date" }),
  studentId: stringSchema(),
  termId: stringSchema(),
}, [], { minProperties: 1 });

const teacherRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  branch: stringSchema(),
  phone: stringSchema(),
  provisioning: { type: "string", enum: ["PROVISIONED", "INVITED", "SKIPPED"] },
}, ["id", "tenantId", "firstName", "lastName"]);

const teacherCreateRequestSchema = objectSchema({
  branch: stringSchema(),
  email: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  nationalId: stringSchema(),
  phone: stringSchema(),
  tenantId: stringSchema(),
}, ["firstName", "lastName"]);

const teacherUpdateRequestSchema = objectSchema({
  branch: stringSchema(),
  email: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  nationalId: stringSchema(),
  phone: stringSchema(),
});

const teacherImportRequestSchema = objectSchema({
  fileBase64: stringSchema({ minLength: 1 }),
}, ["fileBase64"]);

const teacherImportErrorSchema = objectSchema({
  row: integerSchema({ minimum: 1 }),
  field: { type: "string", enum: ["className", "courseName", "firstName", "lastName", "nationalId", "phone"] },
  code: { type: "string", enum: ["CLASS_NOT_FOUND", "COURSE_NOT_FOUND", "INVALID", "REQUIRED"] },
  value: stringSchema(),
}, ["row", "field", "code"]);

const teacherImportPreviewRowSchema = objectSchema({
  accountPreview: objectSchema({
    usernameMasked: stringSchema(),
    willCreate: { type: "boolean" },
  }, ["usernameMasked", "willCreate"]),
  row: integerSchema({ minimum: 1 }),
  classId: stringSchema(),
  className: stringSchema(),
  courseId: stringSchema(),
  courseName: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  branch: stringSchema(),
}, ["row", "firstName", "lastName"]);

const teacherImportDryRunResultSchema = objectSchema({
  dryRun: { type: "boolean", enum: [true] },
  totalRows: integerSchema({ minimum: 0 }),
  validRows: arraySchema(teacherImportPreviewRowSchema),
  errors: arraySchema(teacherImportErrorSchema),
  wouldImport: { type: "boolean" },
}, ["dryRun", "totalRows", "validRows", "errors", "wouldImport"]);

const teacherImportResultSchema = objectSchema({
  importedRows: integerSchema({ minimum: 0 }),
  createdTeachers: integerSchema({ minimum: 0 }),
  createdAssignments: integerSchema({ minimum: 0 }),
  teachers: arraySchema(teacherRecordSchema),
  assignments: arraySchema(teacherAssignmentRecordSchema),
}, ["importedRows", "createdTeachers", "createdAssignments", "teachers", "assignments"]);

const homeworkRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  classId: stringSchema(),
  sourceMaterialId: stringSchema(),
  sourceMaterialTitle: stringSchema(),
  title: stringSchema(),
  description: stringSchema(),
  dueAt: stringSchema({ format: "date-time" }),
  checkedAt: stringSchema({ format: "date-time" }),
  checkedBy: stringSchema(),
}, ["id", "tenantId", "classId", "title"]);

const homeworkCreateRequestSchema = objectSchema({
  classId: stringSchema(),
  description: stringSchema(),
  dueAt: stringSchema({ format: "date-time" }),
  tenantId: stringSchema(),
  title: stringSchema(),
}, ["classId", "title"]);

const homeworkFromMaterialCreateRequestSchema = objectSchema({
  classId: stringSchema(),
  dueAt: stringSchema({ format: "date-time" }),
  materialId: stringSchema(),
  tenantId: stringSchema(),
}, ["classId", "materialId"]);

const homeworkUpdateRequestSchema = objectSchema({
  classId: stringSchema(),
  description: stringSchema(),
  dueAt: stringSchema({ format: "date-time" }),
  title: stringSchema(),
}, [], { minProperties: 1 });

const homeworkCheckStatusRequestSchema = objectSchema({
  checked: { type: "boolean" },
}, ["checked"]);

const homeworkMaterialRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  title: stringSchema(),
  description: stringSchema(),
}, ["id", "tenantId", "title"]);

const homeworkMaterialCreateRequestSchema = objectSchema({
  description: stringSchema(),
  tenantId: stringSchema(),
  title: stringSchema(),
}, ["title"]);

const homeworkMaterialUpdateRequestSchema = objectSchema({
  description: stringSchema(),
  title: stringSchema(),
}, [], { minProperties: 1 });

const homeworkMaterialFileCreateRequestSchema = objectSchema({
  contentType: uploadContentTypeSchema,
  fileBase64: stringSchema({ format: "byte" }),
  fileName: stringSchema(),
}, ["contentType", "fileBase64", "fileName"]);

const homeworkMaterialFileRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  materialId: stringSchema(),
  uploadedById: stringSchema(),
  fileName: stringSchema(),
  contentType: uploadContentTypeSchema,
  byteSize: integerSchema({ minimum: 1 }),
  sha256: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "materialId", "fileName", "contentType", "byteSize", "sha256", "createdAt"]);

const homeworkMaterialAssignmentCreateRequestSchema = objectSchema({
  courseId: stringSchema(),
  dueAt: stringSchema({ format: "date-time" }),
  note: stringSchema(),
  studentId: stringSchema(),
  termId: stringSchema(),
}, ["studentId"]);

const homeworkMaterialAssignmentRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  materialId: stringSchema(),
  materialTitle: stringSchema(),
  studentId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  assignedById: stringSchema(),
  note: stringSchema(),
  dueAt: stringSchema({ format: "date-time" }),
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "materialId", "studentId", "createdAt"]);

const homeworkMaterialAssignmentWithTitleRecordSchema = {
  ...homeworkMaterialAssignmentRecordSchema,
  required: ["id", "tenantId", "materialId", "materialTitle", "studentId", "createdAt"],
};

const scheduleLessonRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  classId: stringSchema(),
  teacherId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  title: stringSchema(),
  startsAt: stringSchema({ format: "date-time" }),
  endsAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "classId", "teacherId", "title", "startsAt", "endsAt"]);

const scheduleLessonCreateRequestSchema = objectSchema({
  classId: stringSchema(),
  courseId: stringSchema(),
  endsAt: stringSchema({ format: "date-time" }),
  startsAt: stringSchema({ format: "date-time" }),
  teacherId: stringSchema(),
  tenantId: stringSchema(),
  termId: stringSchema(),
  title: stringSchema(),
}, ["classId", "endsAt", "startsAt", "teacherId", "title"]);

const scheduleLessonUpdateRequestSchema = objectSchema({
  classId: stringSchema(),
  courseId: stringSchema(),
  endsAt: stringSchema({ format: "date-time" }),
  startsAt: stringSchema({ format: "date-time" }),
  teacherId: stringSchema(),
  termId: stringSchema(),
  title: stringSchema(),
}, [], { minProperties: 1 });

const studySessionRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  classId: stringSchema(),
  teacherId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  studentIds: arraySchema(stringSchema()),
  title: stringSchema(),
  capacity: integerSchema({ minimum: 1 }),
  startsAt: stringSchema({ format: "date-time" }),
  endsAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "classId", "teacherId", "studentIds", "title", "capacity", "startsAt", "endsAt"]);

const studySessionCreateRequestSchema = objectSchema({
  capacity: integerSchema({ minimum: 1 }),
  classId: stringSchema(),
  courseId: stringSchema(),
  endsAt: stringSchema({ format: "date-time" }),
  startsAt: stringSchema({ format: "date-time" }),
  studentIds: arraySchema(stringSchema(), { minItems: 1 }),
  teacherId: stringSchema(),
  tenantId: stringSchema(),
  termId: stringSchema(),
  title: stringSchema(),
}, ["capacity", "classId", "endsAt", "startsAt", "studentIds", "teacherId", "title"]);

const studySessionUpdateRequestSchema = objectSchema({
  capacity: integerSchema({ minimum: 1 }),
  classId: stringSchema(),
  courseId: stringSchema(),
  endsAt: stringSchema({ format: "date-time" }),
  startsAt: stringSchema({ format: "date-time" }),
  studentIds: arraySchema(stringSchema(), { minItems: 1 }),
  teacherId: stringSchema(),
  termId: stringSchema(),
  title: stringSchema(),
}, [], { minProperties: 1 });

const teacherNoteRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  studentId: stringSchema(),
  teacherId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  visibility: teacherNoteVisibilitySchema,
  body: stringSchema(),
  developmentStatus: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
  deletedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "studentId", "teacherId", "visibility", "body", "createdAt"]);

const portalTeacherNoteRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  studentId: stringSchema(),
  teacherId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  visibility: { type: "string", enum: ["GUARDIAN_STUDENT"] },
  body: stringSchema(),
  developmentStatus: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "studentId", "teacherId", "visibility", "body", "createdAt"]);

const teacherNoteCreateRequestSchema = objectSchema({
  body: stringSchema(),
  courseId: stringSchema(),
  developmentStatus: stringSchema(),
  studentId: stringSchema(),
  teacherId: stringSchema(),
  termId: stringSchema(),
  visibility: teacherNoteVisibilitySchema,
}, ["body", "studentId", "visibility"]);

const teacherNoteUpdateRequestSchema = objectSchema({
  body: stringSchema(),
  courseId: stringSchema(),
  developmentStatus: stringSchema(),
  termId: stringSchema(),
  visibility: teacherNoteVisibilitySchema,
}, [], { minProperties: 1 });

const supportTicketRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  requesterId: stringSchema(),
  studentId: stringSchema(),
  campusId: stringSchema(),
  gradeLevelId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  subject: stringSchema(),
  message: stringSchema(),
  priority: supportTicketPrioritySchema,
  status: supportTicketStatusSchema,
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "subject", "message", "priority", "status", "createdAt"]);

const portalSupportTicketRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  studentId: stringSchema(),
  campusId: stringSchema(),
  gradeLevelId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  subject: stringSchema(),
  message: stringSchema(),
  priority: supportTicketPrioritySchema,
  status: supportTicketStatusSchema,
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "subject", "message", "priority", "status", "createdAt"]);

const portalStudentSupportTicketRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  studentId: stringSchema(),
  campusId: stringSchema(),
  gradeLevelId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  subject: stringSchema(),
  message: stringSchema(),
  priority: supportTicketPrioritySchema,
  status: supportTicketStatusSchema,
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "studentId", "subject", "message", "priority", "status", "createdAt"]);

const supportTicketCreateRequestSchema = objectSchema({
  campusId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  gradeLevelId: stringSchema(),
  message: stringSchema(),
  priority: supportTicketPrioritySchema,
  studentId: stringSchema(),
  subject: stringSchema(),
  tenantId: stringSchema(),
  termId: stringSchema(),
}, ["message", "subject"]);

const portalSupportTicketCreateRequestSchema = objectSchema({
  campusId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  gradeLevelId: stringSchema(),
  message: stringSchema({ minLength: 1 }),
  priority: supportTicketPrioritySchema,
  subject: stringSchema({ minLength: 1 }),
  termId: stringSchema(),
}, ["message", "subject"]);

const teacherPortalSupportTicketCreateRequestSchema = objectSchema({
  campusId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  gradeLevelId: stringSchema(),
  message: stringSchema({ minLength: 1 }),
  priority: supportTicketPrioritySchema,
  studentId: stringSchema(),
  subject: stringSchema({ minLength: 1 }),
  termId: stringSchema(),
}, ["message", "subject"]);

const supportTicketUpdateRequestSchema = objectSchema({
  priority: supportTicketPrioritySchema,
  status: supportTicketStatusSchema,
}, [], { minProperties: 1 });

const supportTicketAttachmentCreateRequestSchema = objectSchema({
  contentType: uploadContentTypeSchema,
  fileBase64: stringSchema({ format: "byte" }),
  fileName: stringSchema(),
}, ["contentType", "fileBase64", "fileName"]);

const supportTicketAttachmentRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  ticketId: stringSchema(),
  uploadedById: stringSchema(),
  fileName: stringSchema(),
  contentType: uploadContentTypeSchema,
  byteSize: integerSchema({ minimum: 1 }),
  sha256: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "ticketId", "fileName", "contentType", "byteSize", "sha256", "createdAt"]);

const supportTicketCommentCreateRequestSchema = objectSchema({
  body: stringSchema(),
}, ["body"]);

const supportTicketCommentRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  ticketId: stringSchema(),
  authorId: stringSchema(),
  body: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "ticketId", "body", "createdAt"]);

const auditLogRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  actorUserId: stringSchema(),
  entityType: stringSchema(),
  entityId: stringSchema(),
  action: stringSchema(),
  diff: looseObjectSchema(),
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "entityType", "action", "createdAt"]);

const auditLogListItemRecordSchema = objectSchema({
  id: stringSchema(),
  actionLabel: stringSchema(),
  actorLabel: stringSchema(),
  category: auditLogCategorySchema,
  entityLabel: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "actionLabel", "actorLabel", "category", "entityLabel", "createdAt"]);

const studentAuditSummaryRecordSchema = objectSchema({
  id: stringSchema(),
  actionLabel: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "actionLabel", "createdAt"]);

const paymentPlanInstallmentInputSchema = objectSchema({
  amount: integerSchema({ minimum: 1 }),
  dueDate: stringSchema({ format: "date" }),
  installmentNo: integerSchema({ minimum: 1 }),
  paidAt: stringSchema({ format: "date-time" }),
  status: paymentInstallmentStatusSchema,
}, ["amount", "dueDate", "installmentNo"]);

const paymentInstallmentUpdateRequestSchema = objectSchema({
  amount: integerSchema({ minimum: 1 }),
  dueDate: stringSchema({ format: "date" }),
  paidAt: stringSchema({ format: "date-time" }),
  status: paymentInstallmentStatusSchema,
});

const paymentTransactionCreateRequestSchema = objectSchema({
  amount: integerSchema({ minimum: 1 }),
  currency: stringSchema({ minLength: 3, maxLength: 3 }),
  installmentId: stringSchema(),
  method: paymentTransactionMethodSchema,
  note: stringSchema(),
  paidAt: stringSchema({ format: "date-time" }),
}, ["amount", "method", "paidAt"]);

const paymentTransactionVoidRequestSchema = objectSchema({
  note: stringSchema(),
});

const paymentInstallmentRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  planId: stringSchema(),
  installmentNo: integerSchema({ minimum: 1 }),
  amount: integerSchema({ minimum: 1 }),
  dueDate: stringSchema({ format: "date" }),
  status: paymentInstallmentStatusSchema,
  paidAt: stringSchema({ format: "date-time" }),
  createdAt: stringSchema({ format: "date-time" }),
  deletedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "planId", "installmentNo", "amount", "dueDate", "status", "createdAt"]);

const paymentTransactionRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  planId: stringSchema(),
  installmentId: stringSchema(),
  amount: integerSchema({ minimum: 1 }),
  currency: stringSchema({ minLength: 3, maxLength: 3 }),
  method: paymentTransactionMethodSchema,
  paidAt: stringSchema({ format: "date-time" }),
  receiptNo: stringSchema(),
  note: stringSchema(),
  voidedAt: stringSchema({ format: "date-time" }),
  voidReason: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "planId", "amount", "currency", "method", "paidAt", "receiptNo", "createdAt"]);
const voidedPaymentTransactionRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  planId: stringSchema(),
  installmentId: stringSchema(),
  amount: integerSchema({ minimum: 1 }),
  currency: stringSchema({ minLength: 3, maxLength: 3 }),
  method: paymentTransactionMethodSchema,
  paidAt: stringSchema({ format: "date-time" }),
  receiptNo: stringSchema(),
  note: stringSchema(),
  voidedAt: stringSchema({ format: "date-time" }),
  voidReason: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "planId", "amount", "currency", "method", "paidAt", "receiptNo", "createdAt", "voidedAt"]);

const paymentPlanWithInstallmentsRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  studentId: stringSchema(),
  campusId: stringSchema(),
  gradeLevelId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  title: stringSchema(),
  totalAmount: integerSchema({ minimum: 1 }),
  currency: stringSchema({ minLength: 3, maxLength: 3 }),
  createdAt: stringSchema({ format: "date-time" }),
  deletedAt: stringSchema({ format: "date-time" }),
  installments: arraySchema(paymentInstallmentRecordSchema),
  transactions: arraySchema(paymentTransactionRecordSchema),
}, ["id", "tenantId", "studentId", "title", "totalAmount", "currency", "createdAt", "installments"]);

const attendanceRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  studentId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  date: stringSchema({ format: "date" }),
  status: attendanceStatusSchema,
  deletedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "studentId", "date", "status"]);

const attendanceSummaryRecordSchema = objectSchema({
  studentId: stringSchema(),
  total: integerSchema({ minimum: 0 }),
  present: integerSchema({ minimum: 0 }),
  absent: integerSchema({ minimum: 0 }),
  late: integerSchema({ minimum: 0 }),
  excused: integerSchema({ minimum: 0 }),
}, ["studentId", "total", "present", "absent", "late", "excused"]);

const attendanceAggregateRecordSchema = objectSchema({
  total: integerSchema({ minimum: 0 }),
  present: integerSchema({ minimum: 0 }),
  absent: integerSchema({ minimum: 0 }),
  late: integerSchema({ minimum: 0 }),
  excused: integerSchema({ minimum: 0 }),
}, ["total", "present", "absent", "late", "excused"]);

const attendanceDailyUpsertRequestSchema = objectSchema({
  classId: stringSchema({ minLength: 1 }),
  date: stringSchema({ format: "date" }),
  entries: arraySchema(objectSchema({
    studentId: stringSchema({ minLength: 1 }),
    status: attendanceStatusSchema,
  }, ["studentId", "status"]), { minItems: 1, maxItems: 200 }),
}, ["classId", "date", "entries"]);

const attendanceDailyUpsertResponseSchema = objectSchema({
  records: arraySchema(attendanceRecordSchema),
  summary: attendanceAggregateRecordSchema,
}, ["records", "summary"]);

const attendanceDailyRosterStudentSchema = objectSchema({
  id: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  studentNo: stringSchema(),
  classId: stringSchema(),
}, ["id", "firstName", "lastName", "classId"]);

const attendanceDailyRosterSummarySchema = objectSchema({
  total: integerSchema({ minimum: 0 }),
  present: integerSchema({ minimum: 0 }),
  absent: integerSchema({ minimum: 0 }),
  late: integerSchema({ minimum: 0 }),
  excused: integerSchema({ minimum: 0 }),
  unmarked: integerSchema({ minimum: 0 }),
}, ["total", "present", "absent", "late", "excused", "unmarked"]);

const attendanceDailyRosterResponseSchema = objectSchema({
  classId: stringSchema(),
  date: stringSchema({ format: "date" }),
  students: arraySchema(attendanceDailyRosterStudentSchema),
  records: arraySchema(attendanceRecordSchema),
  summary: attendanceDailyRosterSummarySchema,
}, ["classId", "date", "students", "records", "summary"]);

const studentStatusSchema = {
  type: "string",
  enum: ["ACTIVE", "PASSIVE", "GRADUATED", "TRANSFERRED"],
};

const studentGuardianProvisionRequestSchema = objectSchema({
  canOpenSupportTickets: { type: "boolean" },
  canReceiveAnnouncements: { type: "boolean" },
  canReceiveSms: { type: "boolean" },
  canViewFinance: { type: "boolean" },
  email: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  nationalId: stringSchema(),
  phone: stringSchema(),
});

const guardianRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  phone: stringSchema(),
  userId: stringSchema(),
  matched: { type: "boolean" },
  provisioning: { type: "string", enum: ["PROVISIONED", "INVITED", "SKIPPED"] },
}, ["id", "tenantId", "firstName", "lastName"]);

const guardianPiiPurgedRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  userId: stringSchema(),
}, ["id", "tenantId", "firstName", "lastName"]);

const guardianCreateRequestSchema = objectSchema({
  email: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  nationalId: stringSchema(),
  phone: stringSchema(),
  tenantId: stringSchema(),
}, ["firstName", "lastName"]);

const guardianUpdateRequestSchema = objectSchema({
  email: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  nationalId: stringSchema(),
  phone: stringSchema(),
});

const guardianStudentRelationRequestProperties: Record<string, JsonSchema> = {
  canOpenSupportTickets: { type: "boolean" },
  canReceiveAnnouncements: { type: "boolean" },
  canReceiveSms: { type: "boolean" },
  canViewFinance: { type: "boolean" },
};

const guardianStudentRelationRequestSchema = objectSchema(guardianStudentRelationRequestProperties);

const guardianStudentLinkRequestSchema = objectSchema({
  ...guardianStudentRelationRequestProperties,
  studentId: stringSchema(),
}, ["studentId"]);

const guardianStudentRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  guardianId: stringSchema(),
  studentId: stringSchema(),
  canViewFinance: { type: "boolean" },
  canReceiveSms: { type: "boolean" },
  canReceiveAnnouncements: { type: "boolean" },
  canOpenSupportTickets: { type: "boolean" },
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, [
  "id",
  "tenantId",
  "guardianId",
  "studentId",
  "canViewFinance",
  "canReceiveSms",
  "canReceiveAnnouncements",
  "canOpenSupportTickets",
]);

const studentRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  studentNo: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  classId: stringSchema(),
  responsibleTeacherId: stringSchema(),
  status: studentStatusSchema,
  userId: stringSchema(),
}, ["id", "tenantId", "firstName", "lastName", "status"]);

const studentUpdateRequestSchema = objectSchema({
  classId: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  responsibleTeacherId: stringSchema(),
  status: studentStatusSchema,
});

const studentTenantUpdateRequestSchema = objectSchema({
  tenantId: stringSchema(),
}, ["tenantId"]);

const publicStudentRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  studentNo: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  classId: stringSchema(),
  responsibleTeacherId: stringSchema(),
  status: studentStatusSchema,
}, ["id", "tenantId", "firstName", "lastName", "status"]);

const globalSearchResultRecordSchema = objectSchema({
  href: stringSchema(),
  id: stringSchema(),
  subtitle: stringSchema(),
  title: stringSchema(),
  type: { type: "string", enum: ["students", "teachers", "guardians", "classes"] },
}, ["href", "id", "title", "type"]);

const publicStudentProfileRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  studentNo: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  classId: stringSchema(),
  responsibleTeacherId: stringSchema(),
  status: studentStatusSchema,
  className: stringSchema(),
  campusName: stringSchema(),
  gradeLevelName: stringSchema(),
  section: stringSchema(),
  responsibleTeacherName: stringSchema(),
  nationalIdMasked: stringSchema(),
  phone: stringSchema(),
  email: stringSchema({ format: "email" }),
  photoKey: stringSchema(),
}, ["id", "tenantId", "firstName", "lastName", "status"]);

const studentProfileUpdateRequestSchema = objectSchema({
  email: stringSchema({ format: "email" }),
  nationalId: stringSchema(),
  phone: stringSchema(),
  photoKey: stringSchema(),
});

const guardianStudentDetailStudentRecordSchema = objectSchema({
  id: stringSchema(),
  studentNo: stringSchema(),
  firstName: stringSchema(),
  lastName: stringSchema(),
  classId: stringSchema(),
  className: stringSchema(),
  status: studentStatusSchema,
  hasPortalUser: { type: "boolean" },
}, ["id", "firstName", "lastName", "status", "hasPortalUser"]);

const guardianStudentDetailsResponseSchema = objectSchema({
  links: arraySchema(guardianStudentRecordSchema),
  linkedStudents: arraySchema(guardianStudentDetailStudentRecordSchema),
  availableStudents: arraySchema(guardianStudentDetailStudentRecordSchema),
}, ["links", "linkedStudents", "availableStudents"]);

const examRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  gradeLevelId: stringSchema(),
  alanId: stringSchema(),
  examType: { type: "string", enum: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
  examYear: integerSchema({ minimum: 2000, maximum: 2100 }),
  scoringProfileId: stringSchema(),
  linkedTytExamId: stringSchema(),
  title: stringSchema(),
  status: { type: "string", enum: ["DRAFT", "PUBLISHED"] },
  answerKeySummary: objectSchema({
    status: { type: "string", enum: ["MISSING", "DRAFT", "PUBLISHED"] },
    version: stringSchema(),
    questionCount: integerSchema({ minimum: 1 }),
    branchCount: integerSchema({ minimum: 1 }),
    updatedAt: stringSchema({ format: "date-time" }),
  }, ["status"]),
  startsAt: stringSchema({ format: "date-time" }),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "title", "status", "answerKeySummary", "createdAt", "updatedAt"]);

const examCreateRequestSchema = objectSchema({
  answerKey: objectSchema({
    fileBase64: stringSchema(),
    scoringConfig: looseObjectSchema(),
    version: stringSchema(),
  }, ["fileBase64", "version"]),
  alanId: stringSchema(),
  classId: stringSchema(),
  classIds: arraySchema(stringSchema()),
  examType: { type: "string", enum: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
  examYear: integerSchema({ minimum: 2000, maximum: 2100 }),
  scoringProfileId: stringSchema(),
  linkedTytExamId: stringSchema(),
  gradeLevelId: stringSchema(),
  startsAt: stringSchema({ format: "date-time" }),
  title: stringSchema(),
}, ["title", "answerKey"]);

const examParticipantRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  examId: stringSchema(),
  studentId: stringSchema(),
  participantNo: stringSchema(),
  bookletType: stringSchema(),
  status: { type: "string", enum: ["REGISTERED", "ATTENDED", "ABSENT"] },
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "examId", "studentId", "status", "createdAt", "updatedAt"]);

const examParticipantCreateRequestSchema = objectSchema({
  bookletType: stringSchema(),
  participantNo: stringSchema(),
  studentId: stringSchema(),
}, ["studentId"]);

const parserConfigSuggestionLooseSchema = objectSchema({
  confidence: { type: "string", enum: ["low", "medium", "high"] },
  delimiter: { type: "string", enum: ["TAB", "COMMA", "PIPE", "FIXED"] },
  encoding: { type: "string", enum: ["UTF-8", "ISO-8859-9", "CP1254"] },
  fieldMapping: looseObjectSchema(),
  skipHeaderLines: integerSchema({ minimum: 0 }),
  version: { type: "number", enum: [1] },
  warnings: arraySchema(stringSchema()),
}, ["confidence", "delimiter", "encoding", "fieldMapping", "skipHeaderLines", "version", "warnings"]);

const parserConfigSuggestionRequestSchema = objectSchema({
  fileBase64: stringSchema(),
  preset: {
    type: "string",
    enum: ["OPTIK_7108_LGS", "OPTIK_129", "YANIT", "OPTIK_840_LGS"],
  },
  sampleSize: integerSchema({ minimum: 1 }),
  sampleText: stringSchema(),
}, [], {
  anyOf: [
    { required: ["sampleText"] },
    { required: ["fileBase64"] },
    { required: ["preset"] },
  ],
});

const parserConfigSuggestionResultSchema = objectSchema({
  examId: stringSchema(),
  suggestion: parserConfigSuggestionLooseSchema,
  status: { type: "string", enum: ["suggested"] },
}, ["examId", "suggestion", "status"]);

const parserConfigApprovalRequestSchema = objectSchema({
  suggestion: parserConfigSuggestionLooseSchema,
  version: stringSchema(),
}, ["suggestion", "version"]);

const savedParserConfigSchema = objectSchema({
  tenantId: stringSchema(),
  examId: stringSchema(),
  templateId: stringSchema(),
  version: stringSchema(),
  encoding: { type: "string", enum: ["UTF-8", "ISO-8859-9", "CP1254"] },
  delimiter: { type: "string", enum: ["TAB", "COMMA", "PIPE", "FIXED"] },
  skipHeaderLines: integerSchema({ minimum: 0 }),
  fieldMapping: looseObjectSchema(),
  status: { type: "string", enum: ["APPROVED"] },
}, ["tenantId", "examId", "version", "encoding", "delimiter", "skipHeaderLines", "fieldMapping", "status"]);

const opticalFormTemplateCreateRequestSchema = objectSchema({
  name: stringSchema(),
  suggestion: parserConfigSuggestionLooseSchema,
  version: stringSchema(),
}, ["name", "suggestion", "version"]);

const opticalFormTemplateApplyRequestSchema = objectSchema({
  examId: stringSchema(),
  version: stringSchema(),
}, ["examId", "version"]);

const opticalFormTemplateRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  name: stringSchema(),
  version: stringSchema(),
  encoding: { type: "string", enum: ["UTF-8"] },
  delimiter: { type: "string", enum: ["TAB", "COMMA", "PIPE", "FIXED"] },
  skipHeaderLines: integerSchema({ minimum: 0 }),
  fieldMapping: looseObjectSchema(),
  status: { type: "string", enum: ["APPROVED", "DRAFT"] },
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "name", "version", "encoding", "delimiter", "skipHeaderLines", "fieldMapping", "status", "createdAt", "updatedAt"]);

const rawImportQuarantineResolveRequestSchema = objectSchema({
  resolvedStudentId: stringSchema(),
}, ["resolvedStudentId"]);

const rawImportQuarantineResolveBulkRequestSchema = objectSchema({
  items: arraySchema(objectSchema({
    quarantineId: stringSchema(),
    resolvedStudentId: stringSchema(),
  }, ["quarantineId", "resolvedStudentId"]), { minItems: 1 }),
}, ["items"]);

const rawImportEvaluationQueueJobSchema = objectSchema({
  participantId: stringSchema(),
  jobId: stringSchema(),
  status: { type: "string", enum: ["queued"] },
}, ["participantId", "jobId", "status"]);

const rawImportParseSummarySchema = objectSchema({
  tenantId: stringSchema(),
  examId: stringSchema(),
  rawImportId: stringSchema(),
  matchedCount: integerSchema({ minimum: 0 }),
  quarantinedCount: integerSchema({ minimum: 0 }),
  totalRows: integerSchema({ minimum: 0 }),
  quarantineReasons: arraySchema(objectSchema({
    reason: stringSchema(),
    count: integerSchema({ minimum: 0 }),
  }, ["reason", "count"])),
}, ["tenantId", "examId", "rawImportId", "matchedCount", "quarantinedCount", "totalRows", "quarantineReasons"]);

const rawImportEvaluationStatusSchema = objectSchema({
  tenantId: stringSchema(),
  examId: stringSchema(),
  rawImportId: stringSchema(),
  answerKeyId: stringSchema(),
  matchedCount: integerSchema({ minimum: 0 }),
  evaluatedCount: integerSchema({ minimum: 0 }),
  pendingCount: integerSchema({ minimum: 0 }),
  status: { type: "string", enum: ["COMPLETED", "RUNNING"] },
}, ["tenantId", "examId", "rawImportId", "matchedCount", "evaluatedCount", "pendingCount", "status"]);

const rawImportQuarantineEvaluationJobSchema = objectSchema({
  tenantId: stringSchema(),
  examId: stringSchema(),
  rawImportId: stringSchema(),
  participantId: stringSchema(),
  answerKeyId: stringSchema(),
  queueName: { type: "string", enum: ["exam-evaluation"] },
  jobId: stringSchema(),
  status: { type: "string", enum: ["queued"] },
}, ["tenantId", "examId", "rawImportId", "participantId", "answerKeyId", "queueName", "jobId", "status"]);

const rawImportQuarantineRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  examId: stringSchema(),
  rawImportId: stringSchema(),
  rowNumber: integerSchema({ minimum: 1 }),
  rawRow: looseObjectSchema(),
  reason: stringSchema(),
  status: { type: "string", enum: ["OPEN", "RESOLVED"] },
  resolvedStudentId: stringSchema(),
  resolvedParticipantId: stringSchema(),
  answerKeyId: stringSchema(),
  rawImportSha256: stringSchema(),
  evaluationJob: rawImportQuarantineEvaluationJobSchema,
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "examId", "rawImportId", "rowNumber", "rawRow", "reason", "status", "createdAt", "updatedAt"]);

const resolvedRawImportQuarantineRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  examId: stringSchema(),
  rawImportId: stringSchema(),
  rowNumber: integerSchema({ minimum: 1 }),
  rawRow: looseObjectSchema(),
  reason: stringSchema(),
  status: { type: "string", enum: ["RESOLVED"] },
  resolvedStudentId: stringSchema(),
  resolvedParticipantId: stringSchema(),
  answerKeyId: stringSchema(),
  rawImportSha256: stringSchema(),
  evaluationJob: rawImportQuarantineEvaluationJobSchema,
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, [
  "id",
  "tenantId",
  "examId",
  "rawImportId",
  "rowNumber",
  "rawRow",
  "reason",
  "status",
  "resolvedStudentId",
  "evaluationJob",
  "createdAt",
  "updatedAt",
]);

const rawImportQuarantineResolveBulkResponseSchema = objectSchema({
  results: arraySchema(objectSchema({
    errorCode: stringSchema(),
    quarantine: resolvedRawImportQuarantineRecordSchema,
    quarantineId: stringSchema(),
    status: { type: "string", enum: ["RESOLVED", "FAILED"] },
  }, ["quarantineId", "status"])),
}, ["results"]);

const rawImportQuarantineSummarySchema = objectSchema({
  openCount: integerSchema({ minimum: 0 }),
}, ["openCount"]);

const reportSnapshotStatusSchema = {
  type: "string",
  enum: ["READY", "STALE"],
};

const reportQuestionStatusSchema = {
  type: "string",
  enum: ["BLANK", "CANCELLED", "CORRECT", "WRONG"],
};

const examScoreTypeSchema = {
  type: "string",
  enum: ["LGS", "TYT", "SAY", "EA", "SOZ"],
};

const examScoreMetricsSchema = objectSchema({
  correct: numberSchema({ minimum: 0 }),
  wrong: numberSchema({ minimum: 0 }),
  blank: numberSchema({ minimum: 0 }),
  net: numberSchema(),
  questionCount: numberSchema({ minimum: 0 }),
  successRate: numberSchema(),
}, ["correct", "wrong", "blank", "net", "questionCount", "successRate"]);

const examScoreViewSchema = objectSchema({
  type: examScoreTypeSchema,
  status: { type: "string", enum: ["CALCULATED", "NOT_ELIGIBLE", "MISSING_TYT"] },
  metrics: examScoreMetricsSchema,
  practiceScore: numberSchema(),
  profileId: stringSchema(),
  officialComparable: { type: "boolean", enum: [false] },
}, ["type", "status", "metrics", "profileId", "officialComparable"]);

const reportRankSchema = objectSchema({
  rank: integerSchema({ minimum: 1 }),
  outOf: integerSchema({ minimum: 1 }),
}, ["rank", "outOf"]);

const examScoreRankingSchema = objectSchema({
  type: examScoreTypeSchema,
  institution: reportRankSchema,
  class: reportRankSchema,
}, ["type", "institution"]);

const examScoreAverageSchema = objectSchema({
  type: examScoreTypeSchema,
  calculatedCount: integerSchema({ minimum: 0 }),
  practiceScore: numberSchema(),
}, ["type", "calculatedCount", "practiceScore"]);

const reportScoringAssumptionsSchema = objectSchema({
  standardDeviationUsed: { type: "boolean", enum: [false] },
  cancelledQuestionsExcludedFromScoringDenominator: { type: "boolean", enum: [true] },
  lgsAvailableSectionWeightsRenormalized: { type: "boolean" },
}, [
  "standardDeviationUsed",
  "cancelledQuestionsExcludedFromScoringDenominator",
  "lgsAvailableSectionWeightsRenormalized",
]);

const reportScoreSummarySchema = objectSchema({
  correct: numberSchema({ minimum: 0 }),
  wrong: numberSchema({ minimum: 0 }),
  blank: numberSchema({ minimum: 0 }),
  net: numberSchema(),
  questionCount: numberSchema({ minimum: 0 }),
  rawScore: numberSchema({ minimum: 0 }),
  standardScore: numberSchema({ minimum: 0 }),
  estimatedRawScore: numberSchema({ minimum: 0 }),
  successRate: numberSchema({ minimum: 0 }),
});

const reportStudentBranchSummarySchema = objectSchema({
  branch: stringSchema(),
  correct: numberSchema({ minimum: 0 }),
  wrong: numberSchema({ minimum: 0 }),
  blank: numberSchema({ minimum: 0 }),
  net: numberSchema(),
  questionCount: numberSchema({ minimum: 0 }),
  successRate: numberSchema({ minimum: 0 }),
  classNetAverage: numberSchema(),
  schoolNetAverage: numberSchema(),
  generalNetAverage: numberSchema(),
}, ["branch"]);

const reportStudentOutcomeSummarySchema = objectSchema({
  outcomeCode: stringSchema(),
  branch: stringSchema(),
  correct: numberSchema({ minimum: 0 }),
  wrong: numberSchema({ minimum: 0 }),
  blank: numberSchema({ minimum: 0 }),
  net: numberSchema(),
  questionCount: numberSchema({ minimum: 0 }),
  successRate: numberSchema({ minimum: 0 }),
}, ["outcomeCode", "branch"]);

const reportStudentQuestionSummarySchema = objectSchema({
  questionNo: integerSchema({ minimum: 1 }),
  branch: stringSchema(),
  outcomeCode: stringSchema(),
  topic: stringSchema(),
  scoreSection: answerKeyScoreSectionSchema,
  evaluationStatus: answerKeyEvaluationStatusSchema,
  answer: stringSchema(),
  correctAnswer: stringSchema(),
  status: reportQuestionStatusSchema,
}, ["questionNo", "branch", "answer", "correctAnswer", "status"]);

const reportScopeRankSchema = objectSchema({
  rank: integerSchema({ minimum: 1 }),
  outOf: integerSchema({ minimum: 1 }),
  percentile: numberSchema({ minimum: 0 }),
}, ["rank", "outOf"]);

const reportStudentBranchStatisticsSchema = objectSchema({
  branch: stringSchema(),
  standardScore: numberSchema({ minimum: 0 }),
  general: reportScopeRankSchema,
  class: reportScopeRankSchema,
}, ["branch"]);

const reportStudentStatisticsSchema = objectSchema({
  standardScore: numberSchema({ minimum: 0 }),
  general: reportScopeRankSchema,
  class: reportScopeRankSchema,
  branches: arraySchema(reportStudentBranchStatisticsSchema),
}, []);

const reportStudentScopedSnapshotDataSchema = objectSchema({
  schemaVersion: integerSchema({ minimum: 1 }),
  examType: { type: "string", enum: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
  examYear: integerSchema({ minimum: 2000, maximum: 2100 }),
  scoringProfileId: stringSchema(),
  examTitle: stringSchema(),
  examStartsAt: stringSchema({ format: "date-time" }),
  scoreAverages: arraySchema(examScoreAverageSchema),
  officialComparable: { type: "boolean", enum: [false] },
  scoringAssumptions: reportScoringAssumptionsSchema,
  reportType: stringSchema(),
  generatedAt: stringSchema({ format: "date-time" }),
  resultCount: integerSchema({ minimum: 0 }),
  students: arraySchema(objectSchema({
    studentId: stringSchema(),
    displayName: stringSchema(),
    studentNo: stringSchema(),
    participantNo: stringSchema(),
    bookletType: stringSchema(),
    classId: stringSchema(),
    className: stringSchema(),
    resultKey: stringSchema(),
    scoreViews: arraySchema(examScoreViewSchema),
    scoreRankings: arraySchema(examScoreRankingSchema),
    total: reportScoreSummarySchema,
  }, ["studentId", "resultKey", "total"]), { minItems: 1 }),
}, ["reportType", "resultCount", "students"]);

const reportSnapshotListStudentSchema = objectSchema({
  studentId: stringSchema(),
  displayName: stringSchema(),
  studentNo: stringSchema(),
  participantNo: stringSchema(),
  bookletType: stringSchema(),
  classId: stringSchema(),
  className: stringSchema(),
  resultKey: stringSchema(),
  scoreViews: arraySchema(examScoreViewSchema),
  scoreRankings: arraySchema(examScoreRankingSchema),
  total: reportScoreSummarySchema,
}, ["studentId", "resultKey", "total"]);

const reportSnapshotListClassSchema = objectSchema({
  classId: stringSchema(),
  className: stringSchema(),
  resultCount: integerSchema({ minimum: 0 }),
  averages: reportScoreSummarySchema,
  branches: arraySchema(reportStudentBranchSummarySchema),
}, ["classId", "resultCount"]);

const reportSnapshotListDataSchema = objectSchema({
  schemaVersion: integerSchema({ minimum: 1 }),
  examType: { type: "string", enum: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
  examYear: integerSchema({ minimum: 2000, maximum: 2100 }),
  scoringProfileId: stringSchema(),
  examTitle: stringSchema(),
  examStartsAt: stringSchema({ format: "date-time" }),
  scoreAverages: arraySchema(examScoreAverageSchema),
  officialComparable: { type: "boolean", enum: [false] },
  scoringAssumptions: reportScoringAssumptionsSchema,
  reportType: stringSchema(),
  generatedAt: stringSchema({ format: "date-time" }),
  resultCount: integerSchema({ minimum: 0 }),
  averages: reportScoreSummarySchema,
  branches: arraySchema(reportStudentBranchSummarySchema),
  classes: arraySchema(reportSnapshotListClassSchema),
  students: arraySchema(reportSnapshotListStudentSchema),
}, ["reportType", "resultCount"]);

const reportSnapshotRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  examId: stringSchema(),
  campusId: stringSchema(),
  gradeLevelId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  reportType: stringSchema(),
  status: reportSnapshotStatusSchema,
  inputRefs: looseObjectSchema(),
  snapshotData: reportStudentScopedSnapshotDataSchema,
  generatedAt: stringSchema({ format: "date-time" }),
  staleAt: stringSchema({ format: "date-time" }),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "examId", "reportType", "status", "inputRefs", "createdAt", "updatedAt"]);

const reportSnapshotListRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  examId: stringSchema(),
  campusId: stringSchema(),
  gradeLevelId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  termId: stringSchema(),
  reportType: stringSchema(),
  status: reportSnapshotStatusSchema,
  inputRefs: looseObjectSchema(),
  snapshotData: reportSnapshotListDataSchema,
  generatedAt: stringSchema({ format: "date-time" }),
  staleAt: stringSchema({ format: "date-time" }),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "examId", "reportType", "status", "inputRefs", "createdAt", "updatedAt"]);

const reportSnapshotExcelExportResultSchema = objectSchema({
  fileName: stringSchema(),
  contentType: {
    type: "string",
    enum: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  },
  fileBase64: stringSchema({ format: "byte" }),
  rowCount: integerSchema({ minimum: 0 }),
}, ["fileName", "contentType", "fileBase64", "rowCount"]);

const reportSnapshotPdfExportResultSchema = objectSchema({
  fileName: stringSchema(),
  contentType: {
    type: "string",
    enum: ["application/pdf"],
  },
  fileBase64: stringSchema({ format: "byte" }),
  pageCount: integerSchema({ minimum: 1 }),
}, ["fileName", "contentType", "fileBase64", "pageCount"]);

const reportStudentProgressPointSchema = objectSchema({
  snapshotId: stringSchema(),
  courseId: stringSchema(),
  examTitle: stringSchema(),
  generatedAt: stringSchema({ format: "date-time" }),
  termId: stringSchema(),
  total: reportScoreSummarySchema,
  branches: arraySchema(reportStudentBranchSummarySchema),
}, ["snapshotId", "total"]);

const reportStudentProgressSchema = objectSchema({
  tenantId: stringSchema(),
  examId: stringSchema(),
  studentId: stringSchema(),
  points: arraySchema(reportStudentProgressPointSchema),
  successRateDelta: numberSchema(),
  netDelta: numberSchema(),
  standardScoreDelta: numberSchema(),
}, ["tenantId", "examId", "studentId", "points"]);

const reportStudentSnapshotSchema = objectSchema({
  tenantId: stringSchema(),
  institutionName: stringSchema(),
  institutionLogoUrl: stringSchema(),
  examId: stringSchema(),
  examType: { type: "string", enum: ["SCHOOL", "LGS", "TYT", "AYT", "KPSS"] },
  examYear: integerSchema({ minimum: 2000, maximum: 2100 }),
  scoringProfileId: stringSchema(),
  examTitle: stringSchema(),
  examStartsAt: stringSchema({ format: "date-time" }),
  snapshotId: stringSchema(),
  studentId: stringSchema(),
  studentName: stringSchema(),
  participantNo: stringSchema(),
  bookletType: stringSchema(),
  classId: stringSchema(),
  className: stringSchema(),
  courseId: stringSchema(),
  resultKey: stringSchema(),
  termId: stringSchema(),
  scoreViews: arraySchema(examScoreViewSchema),
  scoreRankings: arraySchema(examScoreRankingSchema),
  total: reportScoreSummarySchema,
  branches: arraySchema(reportStudentBranchSummarySchema),
  outcomes: arraySchema(reportStudentOutcomeSummarySchema),
  questions: arraySchema(reportStudentQuestionSummarySchema),
  statistics: reportStudentStatisticsSchema,
  generatedAt: stringSchema({ format: "date-time" }),
}, ["tenantId", "examId", "snapshotId", "studentId", "resultKey", "total", "branches"]);

const reportErrorBookletSchema = objectSchema({
  tenantId: stringSchema(),
  examId: stringSchema(),
  snapshotId: stringSchema(),
  studentId: stringSchema(),
  items: arraySchema(reportStudentQuestionSummarySchema),
  generatedAt: stringSchema({ format: "date-time" }),
}, ["tenantId", "examId", "snapshotId", "studentId", "items"]);

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

const portalReportSnapshotListPaths = [
  "/api/v1/me/teacher/reports/{examId}/snapshots",
];

const portalReportIndexItemSchema = objectSchema({
  examId: stringSchema(),
  title: stringSchema(),
  startsAt: stringSchema({ format: "date-time" }),
  latestReadySnapshotId: stringSchema(),
  latestGeneratedAt: stringSchema({ format: "date-time" }),
}, ["examId", "title", "latestReadySnapshotId", "latestGeneratedAt"]);

const portalReportIndexPaths = [
  "/api/v1/me/student/reports",
  "/api/v1/me/teacher/reports",
  "/api/v1/me/guardian/students/{studentId}/reports",
];

const portalReportOperationContracts: Record<string, OperationContract> = {
  ...Object.fromEntries(portalReportIndexPaths.map((path) => [
    `get ${path}`,
    { responseBody: arraySchema(portalReportIndexItemSchema), listResponse: true },
  ])),
  ...Object.fromEntries(portalReportSnapshotListPaths.map((path) => [
    `get ${path}`,
    { responseBody: arraySchema(reportSnapshotListRecordSchema), listResponse: true },
  ])),
  ...Object.fromEntries(portalReportStudentSnapshotPaths.map((path) => [
    `get ${path}`,
    { responseBody: reportStudentSnapshotSchema },
  ])),
  ...Object.fromEntries(portalReportErrorBookletPaths.map((path) => [
    `get ${path}`,
    { responseBody: reportErrorBookletSchema },
  ])),
  ...Object.fromEntries(portalReportProgressPaths.map((path) => [
    `get ${path}`,
    { responseBody: reportStudentProgressSchema },
  ])),
};

const studentEnrollmentActionRequestSchema = objectSchema({
  academicYearId: stringSchema(),
  classId: stringSchema(),
  startsAt: stringSchema({ format: "date" }),
  termId: stringSchema(),
});

const studentBulkEnrollmentRequestSchema = objectSchema({
  academicYearId: stringSchema(),
  classId: stringSchema(),
  classIdBySourceClassId: looseObjectSchema(),
  startsAt: stringSchema({ format: "date" }),
  studentIds: arraySchema(stringSchema(), { minItems: 1 }),
  termId: stringSchema(),
  useAutomaticClassMapping: { type: "boolean" },
});

const studentEnrollmentRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  studentId: stringSchema(),
  academicYearId: stringSchema(),
  termId: stringSchema(),
  classId: stringSchema(),
  className: stringSchema(),
  campusName: stringSchema(),
  gradeLevelName: stringSchema(),
  section: stringSchema(),
  status: studentStatusSchema,
  startsAt: stringSchema({ format: "date" }),
  endsAt: stringSchema({ format: "date" }),
  reason: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "studentId", "status", "startsAt"]);

const nullableStudentEnrollmentRecordSchema = {
  ...studentEnrollmentRecordSchema,
  nullable: true,
};

const studentBulkEnrollmentResultSchema = objectSchema({
  updatedCount: integerSchema({ minimum: 0 }),
  enrollments: arraySchema(studentEnrollmentRecordSchema),
}, ["updatedCount", "enrollments"]);

const studentImportRequestSchema = objectSchema({
  fileBase64: stringSchema({ minLength: 1 }),
}, ["fileBase64"]);

const studentImportErrorSchema = objectSchema({
  row: integerSchema({ minimum: 0 }),
  field: { type: "string", enum: ["className", "email", "firstName", "guardianNationalId", "guardianPhone", "lastName", "nationalId", "phone", "quota", "studentNo"] },
  code: {
    type: "string",
    enum: [
      "CLASS_NOT_FOUND",
      "INVALID_DATE",
      "INVALID_EMAIL",
      "INVALID_NATIONAL_ID",
      "INVALID_PHONE",
      "REQUIRED",
      "STUDENT_NATIONAL_ID_DUPLICATE",
      "STUDENT_NO_DUPLICATE",
      "STUDENT_QUOTA_EXCEEDED",
    ],
  },
  value: stringSchema(),
}, ["row", "field", "code"]);

const studentImportPreviewRowSchema = objectSchema({
  accountPreview: objectSchema({
    usernameMasked: stringSchema(),
    willCreate: { type: "boolean" },
  }, ["usernameMasked", "willCreate"]),
  row: integerSchema({ minimum: 1 }),
  classId: stringSchema(),
  className: stringSchema(),
  email: stringSchema({ format: "email" }),
  firstName: stringSchema(),
  guardian: studentGuardianProvisionRequestSchema,
  lastName: stringSchema(),
  studentNo: stringSchema(),
}, ["row", "firstName", "lastName"]);

const studentImportQuotaSchema = objectSchema({
  limit: integerSchema({ minimum: 0 }),
  current: integerSchema({ minimum: 0 }),
  incoming: integerSchema({ minimum: 0 }),
  wouldExceed: { type: "boolean" },
}, ["limit", "current", "incoming", "wouldExceed"]);

const studentImportDryRunResultSchema = objectSchema({
  dryRun: { type: "boolean", enum: [true] },
  totalRows: integerSchema({ minimum: 0 }),
  validRows: arraySchema(studentImportPreviewRowSchema),
  errors: arraySchema(studentImportErrorSchema),
  quota: studentImportQuotaSchema,
  wouldImport: { type: "boolean" },
}, ["dryRun", "totalRows", "validRows", "errors", "quota", "wouldImport"]);

const studentImportResultSchema = objectSchema({
  importedRows: integerSchema({ minimum: 0 }),
  students: arraySchema(publicStudentRecordSchema),
}, ["importedRows", "students"]);

const studentExportResultSchema = objectSchema({
  fileName: stringSchema(),
  contentType: { type: "string", enum: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"] },
  fileBase64: stringSchema({ format: "byte" }),
  rowCount: integerSchema({ minimum: 0 }),
}, ["fileName", "contentType", "fileBase64", "rowCount"]);

const backupRestoreJobCreateRequestSchema = objectSchema({
  confirmationText: stringSchema({ minLength: 1 }),
  operationType: { type: "string", enum: ["BACKUP", "RESTORE_DRILL"] },
  reason: stringSchema(),
  targetReference: stringSchema({ minLength: 1 }),
}, ["confirmationText", "operationType", "targetReference"]);

const backupRestoreJobRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  requestedByUserId: stringSchema(),
  operationType: { type: "string", enum: ["BACKUP", "RESTORE_DRILL"] },
  targetReference: stringSchema(),
  reason: stringSchema(),
  queueName: { type: "string", enum: ["backup-restore"] },
  jobId: stringSchema(),
  status: { type: "string", enum: ["queued", "completed", "failed"] },
  checkedTables: arraySchema(stringSchema()),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "requestedByUserId", "operationType", "targetReference", "queueName", "jobId", "status", "checkedTables", "createdAt", "updatedAt"]);

const tenantDataExportPayloadSchema = objectSchema({
  formatVersion: { type: "string", enum: ["tenant-export-v1"] },
  tenantId: stringSchema(),
  generatedByUserId: stringSchema(),
  exportedAt: stringSchema({ format: "date-time" }),
  scope: { type: "string", enum: ["tenant-user-entered-data"] },
  rowLimitPerTable: integerSchema({ minimum: 1 }),
  tables: looseObjectSchema(),
  warnings: arraySchema(stringSchema()),
}, ["formatVersion", "tenantId", "generatedByUserId", "exportedAt", "scope", "rowLimitPerTable", "tables", "warnings"]);

const messageTemplateChannelSchema = { type: "string", enum: ["SMS"] };

const identityInvitationSubjectTypeSchema = { type: "string", enum: ["TEACHER", "STUDENT", "GUARDIAN"] };
const identityInvitationStatusSchema = { type: "string", enum: ["PENDING", "ACCEPTED"] };

const identityInvitationRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  subjectType: identityInvitationSubjectTypeSchema,
  subjectId: stringSchema(),
  email: stringSchema({ format: "email" }),
  name: stringSchema(),
  role: identityInvitationSubjectTypeSchema,
  status: identityInvitationStatusSchema,
  expiresAt: stringSchema({ format: "date-time" }),
  acceptedAt: stringSchema({ format: "date-time" }),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "subjectType", "subjectId", "email", "name", "role", "status", "expiresAt", "createdAt", "updatedAt"]);

const identityInvitationCreateRequestSchema = objectSchema({
  email: stringSchema({ format: "email" }),
  name: stringSchema(),
  subjectId: stringSchema({ minLength: 1 }),
  subjectType: identityInvitationSubjectTypeSchema,
}, ["email", "subjectId", "subjectType"]);

const identityInvitationAcceptRequestSchema = objectSchema({
  name: stringSchema(),
  password: stringSchema({ minLength: 8 }),
  token: stringSchema({ minLength: 1 }),
}, ["password", "token"]);

const identityInvitationAcceptResponseSchema = objectSchema({
  status: { type: "string", enum: ["ACCEPTED"] },
  acceptedAt: stringSchema({ format: "date-time" }),
}, ["status"]);


const messageTemplateRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  name: stringSchema(),
  channel: messageTemplateChannelSchema,
  body: stringSchema(),
}, ["id", "tenantId", "name", "channel", "body"]);

const messageTemplateCreateRequestSchema = objectSchema({
  tenantId: stringSchema(),
  name: stringSchema({ minLength: 1 }),
  channel: messageTemplateChannelSchema,
  body: stringSchema({ minLength: 1 }),
}, ["name", "body"]);

const messageTemplateUpdateRequestSchema = objectSchema({
  name: stringSchema({ minLength: 1 }),
  channel: messageTemplateChannelSchema,
  body: stringSchema({ minLength: 1 }),
});

const smsBatchCreateRequestSchema = objectSchema({
  recipients: arraySchema(objectSchema({
    to: stringSchema({ minLength: 1 }),
  }, ["to"]), { minItems: 1 }),
  templateId: stringSchema({ minLength: 1 }),
}, ["recipients", "templateId"]);

const smsBatchQueueResultSchema = objectSchema({
  tenantId: stringSchema(),
  templateId: stringSchema(),
  recipientCount: integerSchema({ minimum: 0 }),
  queueName: { type: "string", enum: ["sms-batch"] },
  jobId: stringSchema(),
  status: { type: "string", enum: ["queued"] },
}, ["tenantId", "templateId", "recipientCount", "queueName", "jobId", "status"]);

const smsBatchRecipientPreviewRequestSchema = objectSchema({
  announcementId: stringSchema(),
  campusId: stringSchema(),
  classId: stringSchema(),
  courseId: stringSchema(),
  gradeLevelId: stringSchema(),
  studentStatus: studentStatusSchema,
  termId: stringSchema(),
});

const smsBatchRecipientPreviewRecordSchema = objectSchema({
  to: stringSchema({ minLength: 1 }),
  guardianId: stringSchema(),
  guardianName: stringSchema(),
  studentIds: arraySchema(stringSchema(), { minItems: 1 }),
  studentNames: arraySchema(stringSchema(), { minItems: 1 }),
}, ["to", "guardianId", "guardianName", "studentIds", "studentNames"]);

const smsBatchRecipientPreviewResultSchema = objectSchema({
  recipients: arraySchema(smsBatchRecipientPreviewRecordSchema),
  recipientCount: integerSchema({ minimum: 0 }),
}, ["recipients", "recipientCount"]);

const smsBatchDeliveryReportRecordSchema = objectSchema({
  id: stringSchema(),
  tenantId: stringSchema(),
  jobId: stringSchema(),
  templateId: stringSchema(),
  recipientCount: integerSchema({ minimum: 0 }),
  sentCount: integerSchema({ minimum: 0 }),
  failedCount: integerSchema({ minimum: 0 }),
  billableSegments: integerSchema({ minimum: 0 }),
  status: { type: "string", enum: ["queued", "completed", "failed"] },
  providerErrorCode: stringSchema(),
  createdAt: stringSchema({ format: "date-time" }),
  updatedAt: stringSchema({ format: "date-time" }),
}, ["id", "tenantId", "jobId", "templateId", "recipientCount", "sentCount", "failedCount", "billableSegments", "status"]);

const operationContracts: Record<string, OperationContract> = {
  "get /health": {
    rawResponseBody: healthStatusSchema,
    rawResponseContentType: jsonContentType,
  },
  "get /health/ready": {
    rawResponseBody: readyStatusSchema,
    rawResponseContentType: jsonContentType,
  },
  "get /api/v1/metrics": {
    rawResponseBody: stringSchema(),
    rawResponseContentType: "text/plain",
  },
  "get /api/v1/search": {
    responseBody: arraySchema(globalSearchResultRecordSchema),
    listResponse: true,
  },
  "post /api/v1/auth/login": {
    requestBody: objectSchema({
      tenantSlug: stringSchema(),
      nationalId: stringSchema(),
      password: stringSchema(),
    }, ["nationalId", "password"]),
    responseBody: {
      oneOf: [
        authResponseSchema,
        mfaChallengeResponseSchema,
        mfaEnrollmentRequiredResponseSchema,
        tenantSelectionRequiredResponseSchema,
      ],
    },
  },
  "post /api/v1/auth/login/select": {
    requestBody: tenantSelectionRequestSchema,
    responseBody: {
      oneOf: [
        authResponseSchema,
        mfaChallengeResponseSchema,
        mfaEnrollmentRequiredResponseSchema,
      ],
    },
  },
  "post /api/v1/auth/totp/verify": {
    requestBody: totpVerificationRequestSchema,
    responseBody: authResponseSchema,
  },
  "post /api/v1/auth/totp/enrollment/confirm": {
    requestBody: totpSetupConfirmRequestSchema,
    responseBody: authResponseSchema,
  },
  "post /api/v1/auth/refresh": {
    requestBody: refreshRequestSchema,
    requestBodyRequired: false,
    responseBody: authResponseSchema,
    requiredHeaders: [csrfHeaderContract],
  },
  "post /api/v1/auth/logout": {
    requestBody: refreshRequestSchema,
    requestBodyRequired: false,
    noContent: true,
    requiredHeaders: [csrfHeaderContract],
  },
  "post /api/v1/auth/password-reset/request": {
    requestBody: objectSchema({
      email: stringSchema({ format: "email" }),
    }, ["email"]),
    responseBody: passwordResetAcceptedResponseSchema,
  },
  "post /api/v1/auth/password-reset/confirm": {
    requestBody: objectSchema({
      password: stringSchema({ minLength: 8 }),
      token: stringSchema(),
    }, ["password", "token"]),
    responseBody: passwordResetConfirmResponseSchema,
  },
  "get /api/v1/auth/totp/status": {
    responseBody: totpStatusResponseSchema,
  },
  "post /api/v1/auth/totp/setup": {
    responseBody: totpSetupResponseSchema,
  },
  "post /api/v1/auth/totp/confirm": {
    requestBody: totpSetupConfirmRequestSchema,
    responseBody: totpSetupConfirmResponseSchema,
  },
  "post /api/v1/auth/totp/disable": {
    requestBody: totpDisableRequestSchema,
    responseBody: totpDisableResponseSchema,
  },
  "get /api/v1/tenants": {
    responseBody: arraySchema(tenantRecordSchema),
    listResponse: true,
  },
  "get /api/v1/tenants/{id}": {
    responseBody: tenantRecordSchema,
  },
  "post /api/v1/tenants": {
    requestBody: tenantCreateRequestSchema,
    responseBody: {
      oneOf: [
        tenantRecordSchema,
        tenantCreateWithAdminResponseSchema,
      ],
    },
  },
  "patch /api/v1/tenants/{id}": {
    requestBody: tenantAdminUpdateRequestSchema,
    responseBody: tenantRecordSchema,
  },
  "delete /api/v1/tenants/{id}": {
    responseBody: tenantRecordSchema,
  },
  "get /api/v1/tenant-users": {
    responseBody: arraySchema(tenantUserRecordSchema),
    listResponse: true,
  },
  "post /api/v1/tenant-users": {
    requestBody: tenantUserCreateRequestSchema,
    responseBody: tenantUserRecordSchema,
  },
  "patch /api/v1/tenant-users/{userId}/roles": {
    requestBody: tenantUserRoleUpdateRequestSchema,
    responseBody: tenantUserRecordSchema,
  },
  "post /api/v1/tenant-users/{userId}/reset-password": {
    responseBody: tenantUserPasswordResetResponseSchema,
  },
  "post /api/v1/role-previews": {
    requestBody: rolePreviewStartRequestSchema,
    responseBody: rolePreviewSessionSchema,
  },
  "get /api/v1/me/profile": {
    responseBody: meProfileResponseSchema,
  },
  "post /api/v1/me/password": {
    requestBody: mePasswordChangeRequestSchema,
    responseBody: mePasswordChangeResponseSchema,
  },
  "get /api/v1/me/tenant": {
    responseBody: tenantRecordSchema,
  },
  "patch /api/v1/me/tenant": {
    requestBody: tenantCurrentProfileUpdateRequestSchema,
    responseBody: tenantRecordSchema,
  },
  "get /api/v1/me/notification-devices": {
    responseBody: arraySchema(publicNotificationDeviceRecordSchema),
    listResponse: true,
  },
  "post /api/v1/me/notification-devices": {
    requestBody: notificationDeviceRegisterRequestSchema,
    responseBody: publicNotificationDeviceRecordSchema,
  },
  "delete /api/v1/me/notification-devices/{id}": {
    responseBody: publicNotificationDeviceRecordSchema,
  },
  "get /api/v1/privacy/inventory": {
    responseBody: arraySchema(kvkkInventoryRecordSchema),
    listResponse: true,
  },
  "post /api/v1/privacy/me/purge-pii": {
    responseBody: selfPurgeResultSchema,
  },
  "get /api/v1/development/criteria": {
    responseBody: arraySchema(developmentCriterionRecordSchema),
    listResponse: true,
  },
  "post /api/v1/development/criteria": {
    requestBody: developmentCriterionCreateRequestSchema,
    responseBody: developmentCriterionRecordSchema,
  },
  "get /api/v1/development/assessments": {
    responseBody: arraySchema(developmentAssessmentRecordSchema),
    listResponse: true,
  },
  "post /api/v1/development/assessments": {
    requestBody: developmentAssessmentCreateRequestSchema,
    responseBody: developmentAssessmentRecordSchema,
  },
  "get /api/v1/me/student/development-assessments": {
    responseBody: arraySchema(developmentTrendItemSchema),
    listResponse: true,
  },
  "get /api/v1/me/guardian/students/{studentId}/development-assessments": {
    responseBody: arraySchema(developmentTrendItemSchema),
    listResponse: true,
  },
  "get /api/v1/me/student": {
    responseBody: publicStudentRecordSchema,
  },
  "get /api/v1/me/student/profile": {
    responseBody: publicStudentProfileRecordSchema,
  },
  "get /api/v1/me/guardian/students": {
    responseBody: arraySchema(publicStudentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/guardian/students/{studentId}/profile": {
    responseBody: publicStudentProfileRecordSchema,
  },
  "get /api/v1/me/teacher": {
    responseBody: teacherRecordSchema,
  },
  "get /api/v1/me/teacher/lookups": {
    responseBody: teacherPortalLookupsResponseSchema,
  },
  "get /api/v1/me/teacher/students": {
    responseBody: arraySchema(publicStudentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/teacher/schedule": {
    responseBody: arraySchema(scheduleLessonRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/teacher/attendance": {
    responseBody: arraySchema(attendanceRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/teacher/homework": {
    responseBody: arraySchema(homeworkRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/teacher/homework/materials": {
    responseBody: arraySchema(homeworkMaterialRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/teacher/homework/materials/{id}/assignments": {
    responseBody: arraySchema(homeworkMaterialAssignmentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/teacher/homework/material-assignments": {
    responseBody: arraySchema(homeworkMaterialAssignmentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/teacher/teacher-notes": {
    responseBody: arraySchema(teacherNoteRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/student/enrollments": {
    responseBody: arraySchema(studentEnrollmentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/student/homework/material-assignments": {
    responseBody: arraySchema(homeworkMaterialAssignmentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/student/attendance": {
    responseBody: arraySchema(attendanceRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/student/attendance/summary": {
    responseBody: attendanceSummaryRecordSchema,
  },
  "get /api/v1/me/student/teacher-notes": {
    responseBody: arraySchema(portalTeacherNoteRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/guardian/students/{studentId}/enrollments": {
    responseBody: arraySchema(studentEnrollmentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/teacher/students/{studentId}/enrollments": {
    responseBody: arraySchema(studentEnrollmentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/guardian/homework/material-assignments": {
    responseBody: arraySchema(homeworkMaterialAssignmentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/guardian/students/{studentId}/homework/material-assignments": {
    responseBody: arraySchema(homeworkMaterialAssignmentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/guardian/students/{studentId}/attendance": {
    responseBody: arraySchema(attendanceRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/guardian/students/{studentId}/attendance/summary": {
    responseBody: attendanceSummaryRecordSchema,
  },
  "get /api/v1/me/guardian/students/{studentId}/teacher-notes": {
    responseBody: arraySchema(portalTeacherNoteRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/guardian/students/{studentId}/notification-preferences": {
    responseBody: guardianStudentRecordSchema,
  },
  "patch /api/v1/me/guardian/students/{studentId}/notification-preferences": {
    requestBody: guardianStudentRelationRequestSchema,
    responseBody: guardianStudentRecordSchema,
  },
  "get /api/v1/me/guardian/students/{studentId}/payment-plans": {
    responseBody: arraySchema(paymentPlanWithInstallmentsRecordSchema),
    listResponse: true,
  },
  "get /api/v1/audit-logs": {
    responseBody: arraySchema(auditLogRecordSchema),
    listResponse: true,
  },
  "get /api/v1/audit-logs/safe-list": {
    responseBody: arraySchema(auditLogListItemRecordSchema),
    listResponse: true,
  },
  "get /api/v1/audit-logs/student-summary": {
    responseBody: arraySchema(studentAuditSummaryRecordSchema),
    listResponse: true,
  },
  "post /api/v1/exams/{examId}/answer-keys": {
    idempotent: true,
    requestBody: objectSchema({
      bookletVariants: arraySchema(answerKeyBookletVariantSchema),
      dryRun: { type: "boolean" },
      questions: arraySchema(answerKeyQuestionSchema, { minItems: 1 }),
      scoringConfig: answerKeyScoringConfigSchema,
      version: stringSchema(),
    }, ["questions", "version"]),
    responseBody: {
      oneOf: [
        answerKeyRecordSchema,
        objectSchema({
          dryRun: { type: "boolean", enum: [true] },
          questionCount: integerSchema({ minimum: 1 }),
          branches: arraySchema(looseObjectSchema()),
        }, ["dryRun", "questionCount", "branches"]),
      ],
    },
  },
  "post /api/v1/exams/{examId}/answer-keys/imports/dry-run": {
    requestBody: answerKeyExcelImportBodySchema(),
    responseBody: objectSchema({
      dryRun: { type: "boolean", enum: [true] },
      tenantId: stringSchema(),
      examId: stringSchema(),
      version: stringSchema(),
      questionCount: integerSchema({ minimum: 1 }),
      bookletVariants: arraySchema(looseObjectSchema()),
      wouldImport: { type: "boolean" },
    }, ["dryRun", "tenantId", "examId", "version", "questionCount", "bookletVariants", "wouldImport"]),
  },
  "post /api/v1/exams/{examId}/answer-keys/imports": {
    idempotent: true,
    requestBody: answerKeyExcelImportBodySchema(),
    responseBody: objectSchema({
      imported: { type: "boolean", enum: [true] },
      answerKey: answerKeyRecordSchema,
      bookletVariants: arraySchema(looseObjectSchema()),
    }, ["imported", "answerKey", "bookletVariants"]),
  },
  "get /api/v1/exams/{examId}/answer-keys": {
    responseBody: arraySchema(answerKeyRecordSchema),
    listResponse: true,
  },
  "post /api/v1/exams/{examId}/raw-imports": {
    idempotent: true,
    requestBody: objectSchema({
      contentType: stringSchema(),
      fileBase64: stringSchema(),
      fileName: stringSchema(),
      parserConfigVersion: stringSchema(),
      sourceType: stringSchema(),
    }, ["fileBase64", "fileName", "parserConfigVersion", "sourceType"]),
    responseBody: objectSchema({
      rawImport: objectSchema({
        id: stringSchema(),
        tenantId: stringSchema(),
        examId: stringSchema(),
        sha256: stringSchema(),
        s3Key: stringSchema(),
        parserConfigVersion: stringSchema(),
      }, ["id", "tenantId", "examId", "sha256", "s3Key", "parserConfigVersion"]),
      parseJob: objectSchema({
        jobId: stringSchema(),
        queueName: stringSchema(),
      }, ["jobId", "queueName"]),
    }, ["rawImport", "parseJob"]),
  },
  "post /api/v1/exams/{examId}/raw-imports/{rawImportId}/evaluation-jobs": {
    idempotent: true,
    requestBody: objectSchema({
      answerKeyId: stringSchema(),
    }),
    responseBody: objectSchema({
      tenantId: stringSchema(),
      examId: stringSchema(),
      rawImportId: stringSchema(),
      answerKeyId: stringSchema(),
      rawImportSha256: stringSchema(),
      matchedCount: integerSchema({ minimum: 0 }),
      queuedCount: integerSchema({ minimum: 0 }),
      queueName: { type: "string", enum: ["exam-evaluation"] },
      jobs: arraySchema(rawImportEvaluationQueueJobSchema),
    }, ["tenantId", "examId", "rawImportId", "matchedCount", "queuedCount", "queueName", "jobs"]),
  },
  "get /api/v1/exams/{examId}/raw-imports/{rawImportId}/quarantines": {
    responseBody: arraySchema(rawImportQuarantineRecordSchema),
    listResponse: true,
  },
  "get /api/v1/exams/{examId}/raw-imports/{rawImportId}/summary": {
    responseBody: rawImportParseSummarySchema,
  },
  "get /api/v1/exams/{examId}/raw-imports/{rawImportId}/evaluation-status": {
    responseBody: rawImportEvaluationStatusSchema,
  },
  "get /api/v1/import-quarantines/summary": {
    responseBody: rawImportQuarantineSummarySchema,
  },
  "post /api/v1/exams/{examId}/reports/generation-jobs": {
    idempotent: true,
    requestBody: objectSchema({
      campusId: stringSchema(),
      classId: stringSchema(),
      courseId: stringSchema(),
      gradeLevelId: stringSchema(),
      reportType: { type: "string", enum: ["EXAM_RESULT_SUMMARY"] },
      termId: stringSchema(),
    }, ["reportType"]),
    responseBody: objectSchema({
      tenantId: stringSchema(),
      examId: stringSchema(),
      reportType: { type: "string", enum: ["EXAM_RESULT_SUMMARY"] },
      queueName: { type: "string", enum: ["report-generation"] },
      jobId: stringSchema(),
      status: { type: "string", enum: ["queued"] },
    }, ["tenantId", "examId", "reportType", "queueName", "jobId", "status"]),
  },
  "get /api/v1/exams/{examId}/reports/generation-jobs/{jobId}": {
    responseBody: objectSchema({
      jobId: stringSchema(),
      status: { type: "string", enum: ["QUEUED", "RUNNING", "COMPLETED", "FAILED"] },
      snapshotId: stringSchema(),
      errorCode: stringSchema(),
      updatedAt: stringSchema({ format: "date-time" }),
    }, ["jobId", "status", "updatedAt"]),
  },
  "get /api/v1/exams/{examId}/reports/snapshots": {
    responseBody: arraySchema(reportSnapshotListRecordSchema),
    listResponse: true,
  },
  "get /api/v1/exams/{examId}/reports/students/{studentId}/snapshots": {
    responseBody: arraySchema(reportSnapshotRecordSchema),
    listResponse: true,
  },
  "get /api/v1/exams/{examId}/reports/snapshots/{snapshotId}/export.xlsx": {
    responseBody: reportSnapshotExcelExportResultSchema,
  },
  "get /api/v1/exams/{examId}/reports/snapshots/{snapshotId}/export.pdf": {
    responseBody: reportSnapshotPdfExportResultSchema,
  },
  "get /api/v1/exams/{examId}/reports/snapshots/{snapshotId}/export.karneler.pdf": {
    responseBody: reportSnapshotPdfExportResultSchema,
  },
  "get /api/v1/exams/{examId}/reports/snapshots/{snapshotId}/students/{studentId}/export.pdf": {
    responseBody: reportSnapshotPdfExportResultSchema,
  },
  "get /api/v1/exams/{examId}/reports/students/{studentId}/progress": {
    responseBody: reportStudentProgressSchema,
  },
  "get /api/v1/exams/{examId}/reports/snapshots/{snapshotId}/students/{studentId}": {
    responseBody: reportStudentSnapshotSchema,
  },
  "get /api/v1/exams/{examId}/reports/snapshots/{snapshotId}/students/{studentId}/error-booklet": {
    responseBody: reportErrorBookletSchema,
  },
  ...portalReportOperationContracts,
  "post /api/v1/students": {
    idempotent: true,
    requestBody: objectSchema({
      classId: stringSchema(),
      firstName: stringSchema(),
      guardian: studentGuardianProvisionRequestSchema,
      lastName: stringSchema(),
      nationalId: stringSchema(),
      phone: stringSchema(),
      email: stringSchema({ format: "email" }),
      responsibleTeacherId: stringSchema(),
      status: studentStatusSchema,
      studentNo: stringSchema(),
      tenantId: stringSchema(),
    }, ["firstName", "lastName"]),
    responseBody: publicStudentRecordSchema,
  },
  "get /api/v1/students/export": {
    responseBody: studentExportResultSchema,
  },
  "get /api/v1/students": {
    responseBody: arraySchema(publicStudentRecordSchema),
    listResponse: true,
    queryParameters: [{
      name: "ids",
      description: "Comma-separated student ids to return.",
      schema: stringSchema(),
    }],
  },
  "get /api/v1/students/{id}": {
    responseBody: publicStudentRecordSchema,
  },
  "patch /api/v1/students/{id}": {
    requestBody: studentUpdateRequestSchema,
    responseBody: publicStudentRecordSchema,
  },
  "delete /api/v1/students/{id}": {
    noContent: true,
  },
  "get /api/v1/students/{id}/enrollments": {
    responseBody: arraySchema(studentEnrollmentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/students/{id}/teacher-assignments": {
    responseBody: arraySchema(teacherAssignmentRecordSchema),
    listResponse: true,
  },
  "post /api/v1/students/{id}/purge-pii": {
    requestBody: objectSchema({}),
    requestBodyRequired: false,
    responseBody: publicStudentRecordSchema,
  },
  "patch /api/v1/students/{id}/tenant": {
    requestBody: studentTenantUpdateRequestSchema,
    responseBody: publicStudentRecordSchema,
  },
  "get /api/v1/students/{id}/profile": {
    responseBody: publicStudentProfileRecordSchema,
  },
  "patch /api/v1/students/{id}/profile": {
    requestBody: studentProfileUpdateRequestSchema,
    responseBody: publicStudentProfileRecordSchema,
  },
  "get /api/v1/guardians": {
    responseBody: arraySchema(guardianRecordSchema),
    listResponse: true,
  },
  "post /api/v1/guardians": {
    requestBody: guardianCreateRequestSchema,
    responseBody: guardianRecordSchema,
    idempotent: true,
  },
  "get /api/v1/guardians/{id}": {
    responseBody: guardianRecordSchema,
  },
  "patch /api/v1/guardians/{id}": {
    requestBody: guardianUpdateRequestSchema,
    responseBody: guardianRecordSchema,
  },
  "delete /api/v1/guardians/{id}": {
    noContent: true,
  },
  "post /api/v1/guardians/{id}/purge-pii": {
    requestBody: objectSchema({}),
    requestBodyRequired: false,
    responseBody: guardianPiiPurgedRecordSchema,
  },
  "get /api/v1/guardians/{id}/students": {
    responseBody: arraySchema(guardianStudentRecordSchema),
    listResponse: true,
  },
  "post /api/v1/guardians/{id}/students": {
    requestBody: guardianStudentLinkRequestSchema,
    responseBody: guardianStudentRecordSchema,
    idempotent: true,
  },
  "patch /api/v1/guardians/{id}/students/{studentId}": {
    requestBody: guardianStudentRelationRequestSchema,
    responseBody: guardianStudentRecordSchema,
  },
  "delete /api/v1/guardians/{id}/students/{studentId}": {
    noContent: true,
  },
  "get /api/v1/guardians/{id}/student-details": {
    responseBody: guardianStudentDetailsResponseSchema,
  },
  "get /api/v1/students/{id}/guardians": {
    responseBody: arraySchema(guardianRecordSchema),
    listResponse: true,
  },
  "get /api/v1/students/{id}/guardian-links": {
    responseBody: arraySchema(guardianStudentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/student/guardians": {
    responseBody: arraySchema(guardianRecordSchema),
    listResponse: true,
  },
  "get /api/v1/me/student/guardian-links": {
    responseBody: arraySchema(guardianStudentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/announcements": {
    responseBody: arraySchema(announcementRecordSchema),
    listResponse: true,
  },
  "get /api/v1/announcements/{id}": {
    responseBody: announcementRecordSchema,
  },
  "get /api/v1/announcements/{id}/recipients": {
    responseBody: announcementRecipientReportSchema,
  },
  "get /api/v1/announcements/{id}/delivery-reports": {
    responseBody: arraySchema(announcementDeliveryReportRecordSchema),
    listResponse: true,
  },
  "post /api/v1/announcements": {
    idempotent: true,
    requestBody: objectSchema({
      audience: announcementAudienceSchema,
      body: stringSchema(),
      campusId: stringSchema(),
      classId: stringSchema(),
      courseId: stringSchema(),
      gradeLevelId: stringSchema(),
      tenantId: stringSchema(),
      termId: stringSchema(),
      title: stringSchema(),
    }, ["body", "title"]),
    responseBody: announcementRecordSchema,
  },
  "post /api/v1/announcements/{id}/delivery-results": {
    idempotent: true,
    requestBody: objectSchema({
      channel: announcementDeliveryChannelSchema,
      deliveredCount: integerSchema({ minimum: 0 }),
      failedCount: integerSchema({ minimum: 0 }),
      providerErrorCode: stringSchema(),
      recipientCount: integerSchema({ minimum: 0 }),
      status: announcementDeliveryResultStatusSchema,
    }, ["channel", "deliveredCount", "failedCount", "recipientCount", "status"]),
    responseBody: announcementDeliveryQueueResultSchema,
  },
  "post /api/v1/announcements/{id}/deliveries": {
    idempotent: true,
    idempotencyRequired: true,
    requestBody: objectSchema({
      channel: announcementDeliveryChannelSchema,
    }, ["channel"]),
    responseBody: announcementDeliveryQueueResultSchema,
  },
  "get /api/v1/me/student/announcements": {
    responseBody: arraySchema(announcementRecordSchema),
    listResponse: true,
  },
  "post /api/v1/me/student/announcements/{id}/read": {
    responseBody: announcementRecordSchema,
  },
  "get /api/v1/me/guardian/students/{studentId}/announcements": {
    responseBody: arraySchema(announcementRecordSchema),
    listResponse: true,
  },
  "post /api/v1/me/guardian/students/{studentId}/announcements/{id}/read": {
    responseBody: announcementRecordSchema,
  },
  "get /api/v1/me/teacher/announcements": {
    responseBody: arraySchema(announcementRecordSchema),
    listResponse: true,
  },
  "post /api/v1/me/teacher/announcements/{id}/read": {
    responseBody: announcementRecordSchema,
  },
  "get /api/v1/academic-years": {
    responseBody: arraySchema(academicYearRecordSchema),
    listResponse: true,
  },
  "post /api/v1/academic-years": {
    requestBody: academicYearCreateRequestSchema,
    responseBody: academicYearRecordSchema,
  },
  "get /api/v1/academic-years/{id}": {
    responseBody: academicYearRecordSchema,
  },
  "patch /api/v1/academic-years/{id}": {
    requestBody: academicYearUpdateRequestSchema,
    responseBody: academicYearRecordSchema,
  },
  "delete /api/v1/academic-years/{id}": {
    noContent: true,
  },
  "get /api/v1/academic-terms": {
    responseBody: arraySchema(academicTermRecordSchema),
    listResponse: true,
  },
  "post /api/v1/academic-terms": {
    requestBody: academicTermCreateRequestSchema,
    responseBody: academicTermRecordSchema,
  },
  "get /api/v1/academic-terms/{id}": {
    responseBody: academicTermRecordSchema,
  },
  "patch /api/v1/academic-terms/{id}": {
    requestBody: academicTermUpdateRequestSchema,
    responseBody: academicTermRecordSchema,
  },
  "delete /api/v1/academic-terms/{id}": {
    noContent: true,
  },
  "get /api/v1/campuses": {
    responseBody: arraySchema(namedSchoolReferenceRecordSchema),
    listResponse: true,
  },
  "post /api/v1/campuses": {
    requestBody: namedSchoolReferenceCreateRequestSchema,
    responseBody: namedSchoolReferenceRecordSchema,
  },
  "get /api/v1/campuses/{id}": {
    responseBody: namedSchoolReferenceRecordSchema,
  },
  "patch /api/v1/campuses/{id}": {
    requestBody: namedSchoolReferenceUpdateRequestSchema,
    responseBody: namedSchoolReferenceRecordSchema,
  },
  "delete /api/v1/campuses/{id}": {
    noContent: true,
  },
  "get /api/v1/alanlar": {
    responseBody: arraySchema(alanRecordSchema),
    listResponse: true,
  },
  "post /api/v1/alanlar": {
    requestBody: alanCreateRequestSchema,
    responseBody: alanRecordSchema,
  },
  "get /api/v1/alanlar/{id}": {
    responseBody: alanRecordSchema,
  },
  "patch /api/v1/alanlar/{id}": {
    requestBody: alanUpdateRequestSchema,
    responseBody: alanRecordSchema,
  },
  "delete /api/v1/alanlar/{id}": {
    noContent: true,
  },
  "post /api/v1/classes": {
    requestBody: classCreateRequestSchema,
    responseBody: classRecordSchema,
    idempotent: true,
  },
  "get /api/v1/classes": {
    responseBody: arraySchema(classRecordSchema),
    listResponse: true,
  },
  "get /api/v1/classes/{id}": {
    responseBody: classRecordSchema,
  },
  "patch /api/v1/classes/{id}": {
    requestBody: classUpdateRequestSchema,
    responseBody: classRecordSchema,
  },
  "delete /api/v1/classes/{id}": {
    noContent: true,
  },
  "get /api/v1/courses": {
    responseBody: arraySchema(namedSchoolReferenceRecordSchema),
    listResponse: true,
  },
  "post /api/v1/courses": {
    requestBody: namedSchoolReferenceCreateRequestSchema,
    responseBody: namedSchoolReferenceRecordSchema,
    idempotent: true,
  },
  "get /api/v1/courses/{id}": {
    responseBody: namedSchoolReferenceRecordSchema,
  },
  "patch /api/v1/courses/{id}": {
    requestBody: namedSchoolReferenceUpdateRequestSchema,
    responseBody: namedSchoolReferenceRecordSchema,
  },
  "delete /api/v1/courses/{id}": {
    noContent: true,
  },
  "get /api/v1/grade-levels": {
    responseBody: arraySchema(namedSchoolReferenceRecordSchema),
    listResponse: true,
  },
  "post /api/v1/grade-levels": {
    requestBody: namedSchoolReferenceCreateRequestSchema,
    responseBody: namedSchoolReferenceRecordSchema,
  },
  "get /api/v1/grade-levels/{id}": {
    responseBody: namedSchoolReferenceRecordSchema,
  },
  "get /api/v1/grade-levels/{id}/courses": {
    responseBody: arraySchema(gradeLevelCourseRecordSchema),
    listResponse: true,
  },
  "patch /api/v1/grade-levels/{id}": {
    requestBody: namedSchoolReferenceUpdateRequestSchema,
    responseBody: namedSchoolReferenceRecordSchema,
  },
  "delete /api/v1/grade-levels/{id}": {
    noContent: true,
  },
  "get /api/v1/learning-outcomes": {
    responseBody: arraySchema(learningOutcomeRecordSchema),
    listResponse: true,
  },
  "post /api/v1/learning-outcomes": {
    requestBody: learningOutcomeCreateRequestSchema,
    responseBody: learningOutcomeRecordSchema,
  },
  "post /api/v1/learning-outcomes/imports/dry-run": {
    requestBody: learningOutcomeImportRequestSchema,
    responseBody: learningOutcomeImportDryRunResultSchema,
  },
  "post /api/v1/learning-outcomes/imports": {
    requestBody: learningOutcomeImportRequestSchema,
    responseBody: learningOutcomeImportResultSchema,
    idempotent: true,
  },
  "get /api/v1/learning-outcomes/{id}": {
    responseBody: learningOutcomeRecordSchema,
  },
  "patch /api/v1/learning-outcomes/{id}": {
    requestBody: learningOutcomeUpdateRequestSchema,
    responseBody: learningOutcomeRecordSchema,
  },
  "delete /api/v1/learning-outcomes/{id}": {
    noContent: true,
  },
  "get /api/v1/teachers": {
    responseBody: arraySchema(teacherRecordSchema),
    listResponse: true,
  },
  "post /api/v1/teachers": {
    requestBody: teacherCreateRequestSchema,
    responseBody: teacherRecordSchema,
    idempotent: true,
  },
  "get /api/v1/teachers/{id}": {
    responseBody: teacherRecordSchema,
  },
  "patch /api/v1/teachers/{id}": {
    requestBody: teacherUpdateRequestSchema,
    responseBody: teacherRecordSchema,
  },
  "delete /api/v1/teachers/{id}": {
    noContent: true,
  },
  "get /api/v1/teachers/{id}/assignments": {
    responseBody: arraySchema(teacherAssignmentRecordSchema),
    listResponse: true,
  },
  "delete /api/v1/teachers/{id}/assignments/{assignmentId}": {
    noContent: true,
  },
  "post /api/v1/teachers/{id}/purge-pii": {
    requestBody: objectSchema({}),
    requestBodyRequired: false,
    responseBody: teacherRecordSchema,
  },
  "post /api/v1/teachers/{id}/assignments": {
    requestBody: teacherAssignmentCreateRequestSchema,
    responseBody: teacherAssignmentRecordSchema,
    idempotent: true,
  },
  "patch /api/v1/teachers/{id}/assignments/{assignmentId}": {
    requestBody: teacherAssignmentUpdateRequestSchema,
    responseBody: teacherAssignmentRecordSchema,
  },
  "post /api/v1/teachers/imports/dry-run": {
    requestBody: teacherImportRequestSchema,
    responseBody: teacherImportDryRunResultSchema,
  },
  "post /api/v1/teachers/imports": {
    requestBody: teacherImportRequestSchema,
    responseBody: teacherImportResultSchema,
    idempotent: true,
  },
  "post /api/v1/schedule-lessons": {
    requestBody: scheduleLessonCreateRequestSchema,
    responseBody: scheduleLessonRecordSchema,
    idempotent: true,
  },
  "get /api/v1/schedule-lessons": {
    responseBody: arraySchema(scheduleLessonRecordSchema),
    listResponse: true,
  },
  "get /api/v1/schedule-lessons/{id}": {
    responseBody: scheduleLessonRecordSchema,
  },
  "patch /api/v1/schedule-lessons/{id}": {
    requestBody: scheduleLessonUpdateRequestSchema,
    responseBody: scheduleLessonRecordSchema,
  },
  "delete /api/v1/schedule-lessons/{id}": {
    noContent: true,
  },
  "post /api/v1/study-sessions": {
    requestBody: studySessionCreateRequestSchema,
    responseBody: studySessionRecordSchema,
    idempotent: true,
  },
  "get /api/v1/study-sessions": {
    responseBody: arraySchema(studySessionRecordSchema),
    listResponse: true,
  },
  "get /api/v1/study-sessions/{id}": {
    responseBody: studySessionRecordSchema,
  },
  "patch /api/v1/study-sessions/{id}": {
    requestBody: studySessionUpdateRequestSchema,
    responseBody: studySessionRecordSchema,
  },
  "delete /api/v1/study-sessions/{id}": {
    noContent: true,
  },
  "get /api/v1/teacher-notes": {
    responseBody: arraySchema(teacherNoteRecordSchema),
    listResponse: true,
  },
  "post /api/v1/teacher-notes": {
    requestBody: teacherNoteCreateRequestSchema,
    responseBody: teacherNoteRecordSchema,
  },
  "patch /api/v1/teacher-notes/{id}": {
    requestBody: teacherNoteUpdateRequestSchema,
    responseBody: teacherNoteRecordSchema,
  },
  "delete /api/v1/teacher-notes/{id}": {
    noContent: true,
  },
  "get /api/v1/attendance": {
    responseBody: arraySchema(attendanceRecordSchema),
    listResponse: true,
    queryParameters: ["classId", "studentId", "date", "dateFrom", "dateTo"].map((name) => ({
      name,
      schema: stringSchema(),
    })),
  },
  "get /api/v1/attendance/summary": {
    responseBody: attendanceSummaryRecordSchema,
  },
  "get /api/v1/attendance/aggregate": {
    responseBody: attendanceAggregateRecordSchema,
  },
  "get /api/v1/attendance/daily": {
    queryParameters: ["classId", "date"].map((name) => ({
      name,
      required: true,
      schema: stringSchema(),
    })),
    responseBody: attendanceDailyRosterResponseSchema,
  },
  "put /api/v1/attendance/daily": {
    requestBody: attendanceDailyUpsertRequestSchema,
    responseBody: attendanceDailyUpsertResponseSchema,
  },
  "post /api/v1/support-tickets": {
    requestBody: supportTicketCreateRequestSchema,
    responseBody: supportTicketRecordSchema,
  },
  "patch /api/v1/support-tickets/{id}": {
    requestBody: supportTicketUpdateRequestSchema,
    responseBody: supportTicketRecordSchema,
  },
  "get /api/v1/support-tickets": {
    responseBody: arraySchema(supportTicketRecordSchema),
    listResponse: true,
  },
  "get /api/v1/support-tickets/{id}": {
    responseBody: supportTicketRecordSchema,
  },
  "get /api/v1/me/student/support-tickets": {
    responseBody: arraySchema(portalStudentSupportTicketRecordSchema),
    listResponse: true,
  },
  "post /api/v1/me/student/support-tickets": {
    requestBody: portalSupportTicketCreateRequestSchema,
    responseBody: portalStudentSupportTicketRecordSchema,
  },
  "get /api/v1/me/guardian/students/{studentId}/support-tickets": {
    responseBody: arraySchema(portalStudentSupportTicketRecordSchema),
    listResponse: true,
  },
  "post /api/v1/me/guardian/students/{studentId}/support-tickets": {
    requestBody: portalSupportTicketCreateRequestSchema,
    responseBody: portalStudentSupportTicketRecordSchema,
  },
  "get /api/v1/me/teacher/support-tickets": {
    responseBody: arraySchema(portalSupportTicketRecordSchema),
    listResponse: true,
  },
  "post /api/v1/me/teacher/support-tickets": {
    requestBody: teacherPortalSupportTicketCreateRequestSchema,
    responseBody: portalSupportTicketRecordSchema,
  },
  "post /api/v1/support-tickets/{id}/attachments": {
    idempotent: true,
    requestBody: supportTicketAttachmentCreateRequestSchema,
    responseBody: supportTicketAttachmentRecordSchema,
  },
  "get /api/v1/support-tickets/{id}/attachments": {
    responseBody: arraySchema(supportTicketAttachmentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/support-tickets/{id}/attachments/{attachmentId}/download": {
    responseBody: fileDownloadResultSchema,
  },
  "post /api/v1/support-tickets/{id}/comments": {
    idempotent: true,
    requestBody: supportTicketCommentCreateRequestSchema,
    responseBody: supportTicketCommentRecordSchema,
  },
  "get /api/v1/support-tickets/{id}/comments": {
    responseBody: arraySchema(supportTicketCommentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/homework/materials": {
    responseBody: arraySchema(homeworkMaterialRecordSchema),
    listResponse: true,
  },
  "get /api/v1/homework/materials/{id}": {
    responseBody: homeworkMaterialRecordSchema,
  },
  "post /api/v1/homework/materials": {
    requestBody: homeworkMaterialCreateRequestSchema,
    responseBody: homeworkMaterialRecordSchema,
  },
  "patch /api/v1/homework/materials/{id}": {
    requestBody: homeworkMaterialUpdateRequestSchema,
    responseBody: homeworkMaterialRecordSchema,
  },
  "delete /api/v1/homework/materials/{id}": {
    noContent: true,
  },
  "post /api/v1/homework/materials/{id}/files": {
    idempotent: true,
    requestBody: homeworkMaterialFileCreateRequestSchema,
    responseBody: homeworkMaterialFileRecordSchema,
  },
  "get /api/v1/homework/materials/{id}/files": {
    responseBody: arraySchema(homeworkMaterialFileRecordSchema),
    listResponse: true,
  },
  "get /api/v1/homework/materials/{id}/files/{fileId}/download": {
    responseBody: fileDownloadResultSchema,
  },
  "post /api/v1/homework/materials/{id}/assignments": {
    idempotent: true,
    requestBody: homeworkMaterialAssignmentCreateRequestSchema,
    responseBody: homeworkMaterialAssignmentRecordSchema,
  },
  "get /api/v1/homework/materials/{id}/assignments": {
    responseBody: arraySchema(homeworkMaterialAssignmentRecordSchema),
    listResponse: true,
  },
  "get /api/v1/homework/material-assignments": {
    queryParameters: [{
      name: "studentId",
      required: true,
      schema: stringSchema(),
    }],
    responseBody: arraySchema(homeworkMaterialAssignmentWithTitleRecordSchema),
    listResponse: true,
  },
  "get /api/v1/homework": {
    responseBody: arraySchema(homeworkRecordSchema),
    listResponse: true,
  },
  "get /api/v1/homework/{id}": {
    responseBody: homeworkRecordSchema,
  },
  "post /api/v1/homework": {
    requestBody: homeworkCreateRequestSchema,
    responseBody: homeworkRecordSchema,
  },
  "post /api/v1/homework/from-material": {
    requestBody: homeworkFromMaterialCreateRequestSchema,
    responseBody: homeworkRecordSchema,
  },
  "patch /api/v1/homework/{id}": {
    requestBody: homeworkUpdateRequestSchema,
    responseBody: homeworkRecordSchema,
  },
  "patch /api/v1/homework/{id}/check-status": {
    requestBody: homeworkCheckStatusRequestSchema,
    responseBody: homeworkRecordSchema,
  },
  "delete /api/v1/homework/{id}": {
    noContent: true,
  },
  "post /api/v1/payment-plans": {
    idempotent: true,
    requestBody: objectSchema({
      campusId: stringSchema(),
      classId: stringSchema(),
      courseId: stringSchema(),
      currency: stringSchema({ minLength: 3, maxLength: 3 }),
      gradeLevelId: stringSchema(),
      installments: arraySchema(paymentPlanInstallmentInputSchema, { minItems: 1 }),
      studentId: stringSchema(),
      termId: stringSchema(),
      title: stringSchema(),
      totalAmount: integerSchema({ minimum: 1 }),
    }, ["installments", "studentId", "title", "totalAmount"]),
    responseBody: paymentPlanWithInstallmentsRecordSchema,
  },
  "patch /api/v1/payment-plans/{planId}/installments/{installmentId}": {
    idempotent: true,
    requestBody: paymentInstallmentUpdateRequestSchema,
    responseBody: paymentPlanWithInstallmentsRecordSchema,
  },
  "delete /api/v1/payment-plans/{planId}": {
    idempotent: true,
    responseBody: paymentPlanWithInstallmentsRecordSchema,
  },
  "get /api/v1/payment-plans/{planId}/transactions": {
    responseBody: arraySchema(paymentTransactionRecordSchema),
    listResponse: true,
  },
  "post /api/v1/payment-plans/{planId}/transactions": {
    idempotent: true,
    requestBody: paymentTransactionCreateRequestSchema,
    responseBody: paymentTransactionRecordSchema,
  },
  "post /api/v1/payment-plans/{planId}/transactions/{transactionId}/void": {
    idempotent: true,
    requestBody: paymentTransactionVoidRequestSchema,
    responseBody: voidedPaymentTransactionRecordSchema,
  },
  "get /api/v1/payment-plans": {
    responseBody: arraySchema(paymentPlanWithInstallmentsRecordSchema),
    listResponse: true,
  },
  "post /api/v1/exams": {
    idempotent: true,
    requestBody: examCreateRequestSchema,
    responseBody: examRecordSchema,
  },
  "get /api/v1/exams": {
    listResponse: true,
    responseBody: arraySchema(examRecordSchema),
  },
  "get /api/v1/exams/{examId}": {
    responseBody: examRecordSchema,
  },
  "patch /api/v1/exams/{examId}": {
    requestBody: examCreateRequestSchema,
    responseBody: examRecordSchema,
  },
  "post /api/v1/exams/{examId}/publish": {
    idempotent: true,
    responseBody: examRecordSchema,
  },
  "delete /api/v1/exams/{examId}": {
    noContent: true,
  },
  "get /api/v1/exams/{examId}/participants": {
    listResponse: true,
    responseBody: arraySchema(examParticipantRecordSchema),
  },
  "post /api/v1/exams/{examId}/participants": {
    idempotent: true,
    requestBody: examParticipantCreateRequestSchema,
    responseBody: examParticipantRecordSchema,
  },
  "post /api/v1/exams/{examId}/parser-configs/suggestions": {
    requestBody: parserConfigSuggestionRequestSchema,
    responseBody: parserConfigSuggestionResultSchema,
  },
  "post /api/v1/exams/{examId}/parser-configs/approvals": {
    idempotent: true,
    requestBody: parserConfigApprovalRequestSchema,
    responseBody: savedParserConfigSchema,
  },
  "get /api/v1/optical-form-templates": {
    responseBody: arraySchema(opticalFormTemplateRecordSchema),
    listResponse: true,
  },
  "post /api/v1/optical-form-templates": {
    idempotent: true,
    requestBody: opticalFormTemplateCreateRequestSchema,
    responseBody: opticalFormTemplateRecordSchema,
  },
  "post /api/v1/optical-form-templates/{templateId}/apply": {
    idempotent: true,
    requestBody: opticalFormTemplateApplyRequestSchema,
    responseBody: savedParserConfigSchema,
  },
  "post /api/v1/exams/{examId}/answer-keys/{version}/publish": {
    idempotent: true,
    requestBody: objectSchema({}),
    requestBodyRequired: false,
    responseBody: publishedAnswerKeyRecordSchema,
  },
  "post /api/v1/exams/{examId}/raw-imports/{rawImportId}/quarantines/{quarantineId}/resolve": {
    idempotent: true,
    requestBody: rawImportQuarantineResolveRequestSchema,
    responseBody: resolvedRawImportQuarantineRecordSchema,
  },
  "post /api/v1/exams/{examId}/raw-imports/{rawImportId}/quarantines/resolve-bulk": {
    idempotent: true,
    requestBody: rawImportQuarantineResolveBulkRequestSchema,
    responseBody: rawImportQuarantineResolveBulkResponseSchema,
  },
  "post /api/v1/students/imports": {
    idempotent: true,
    requestBody: studentImportRequestSchema,
    responseBody: studentImportResultSchema,
  },
  "post /api/v1/students/imports/dry-run": {
    requestBody: studentImportRequestSchema,
    responseBody: studentImportDryRunResultSchema,
  },
  "post /api/v1/students/enrollments/bulk-renew": {
    idempotent: true,
    requestBody: studentBulkEnrollmentRequestSchema,
    responseBody: studentBulkEnrollmentResultSchema,
  },
  "post /api/v1/students/{id}/enrollments/renew": {
    idempotent: true,
    requestBody: studentEnrollmentActionRequestSchema,
    responseBody: studentEnrollmentRecordSchema,
  },
  "post /api/v1/students/{id}/enrollments/transfer": {
    idempotent: true,
    requestBody: studentEnrollmentActionRequestSchema,
    responseBody: nullableStudentEnrollmentRecordSchema,
  },
  "post /api/v1/backup-restore-jobs": {
    idempotent: true,
    requestBody: backupRestoreJobCreateRequestSchema,
    responseBody: backupRestoreJobRecordSchema,
  },
  "get /api/v1/backup-restore-jobs": {
    responseBody: arraySchema(backupRestoreJobRecordSchema),
    listResponse: true,
  },
  "get /api/v1/backup-restore-jobs/tenant-export": {
    rawResponseBody: tenantDataExportPayloadSchema,
    rawResponseContentType: jsonContentType,
  },
  "get /api/v1/identity-invitations": {
    responseBody: arraySchema(identityInvitationRecordSchema),
    listResponse: true,
  },
  "post /api/v1/identity-invitations": {
    requestBody: identityInvitationCreateRequestSchema,
    responseBody: identityInvitationRecordSchema,
  },
  "post /api/v1/identity-invitations/accept": {
    requestBody: identityInvitationAcceptRequestSchema,
    responseBody: identityInvitationAcceptResponseSchema,
  },
  "post /api/v1/identity-invitations/{id}/resend": {
    responseBody: identityInvitationRecordSchema,
  },
  "get /api/v1/message-templates": {
    responseBody: arraySchema(messageTemplateRecordSchema),
    listResponse: true,
  },
  "post /api/v1/message-templates": {
    requestBody: messageTemplateCreateRequestSchema,
    responseBody: messageTemplateRecordSchema,
  },
  "get /api/v1/message-templates/{id}": {
    responseBody: messageTemplateRecordSchema,
  },
  "patch /api/v1/message-templates/{id}": {
    requestBody: messageTemplateUpdateRequestSchema,
    responseBody: messageTemplateRecordSchema,
  },
  "delete /api/v1/message-templates/{id}": {
    noContent: true,
  },
  "post /api/v1/sms-batches": {
    idempotent: true,
    requestBody: smsBatchCreateRequestSchema,
    responseBody: smsBatchQueueResultSchema,
  },
  "get /api/v1/sms-batches/{jobId}": {
    responseBody: smsBatchDeliveryReportRecordSchema,
  },
  "post /api/v1/sms-batches/recipients/preview": {
    requestBody: smsBatchRecipientPreviewRequestSchema,
    requestBodyRequired: false,
    responseBody: smsBatchRecipientPreviewResultSchema,
  },
};

export function applyOpenApiContracts(document: OpenAPIObject): OpenAPIObject {
  for (const [key, contract] of Object.entries(operationContracts)) {
    const [method, path] = key.split(" ") as [string, string];
    const pathItem = document.paths?.[path] as Record<string, any> | undefined;
    const operation = pathItem?.[method];
    if (!operation) continue;

    if (contract.requestBody) {
      operation.requestBody = {
        required: contract.requestBodyRequired ?? true,
        content: jsonContent(contract.requestBody),
      };
    }

    if (contract.requiredHeaders) {
      for (const header of contract.requiredHeaders) {
        upsertHeaderParameter(operation, header);
      }
    }

    if (contract.queryParameters) {
      for (const query of contract.queryParameters) {
        upsertQueryParameter(operation, query);
      }
    }

    if (contract.noContent) {
      operation.responses ??= {};
      operation.responses["204"] = {
        description: operation.responses["204"]?.description ?? "No content",
      };
      delete operation.responses["204"].content;
    }

    if (contract.rawResponseBody) {
      const successCode = operation.responses?.["201"] ? "201" : "200";
      operation.responses ??= {};
      operation.responses[successCode] = {
        description: operation.responses[successCode]?.description ?? "Successful response",
        content: jsonContent(contract.rawResponseBody, contract.rawResponseContentType ?? jsonContentType),
      };
    }

    if (contract.responseBody) {
      const successCode = operation.responses?.["201"] ? "201" : "200";
      operation.responses ??= {};
      operation.responses[successCode] = {
        description: operation.responses[successCode]?.description ?? "Successful response",
        content: jsonContent(contract.listResponse ? listEnvelopedSchema(contract.responseBody) : envelopedSchema(contract.responseBody)),
      };
    }

    if (contract.idempotent) {
      const required = contract.idempotencyRequired === true;
      operation.parameters ??= [];
      const idempotencyHeader = operation.parameters.find((parameter: any) =>
        typeof parameter === "object" &&
        "in" in parameter &&
        parameter.in === "header" &&
        parameter.name.toLowerCase() === "idempotency-key",
      );
      if (idempotencyHeader) {
        idempotencyHeader.name = "Idempotency-Key";
        idempotencyHeader.required = required;
        idempotencyHeader.schema = stringSchema({ maxLength: 128 });
        idempotencyHeader.description = idempotencyDescription(required);
      } else {
        operation.parameters.push({
          in: "header",
          name: "Idempotency-Key",
          required,
          schema: stringSchema({ maxLength: 128 }),
          description: idempotencyDescription(required),
        });
      }
    }
  }

  return document;
}

function idempotencyDescription(required: boolean): string {
  return required
    ? "Required retry key. Reusing the same key with a different body returns 409."
    : "Optional retry key. Reusing the same key with a different body returns 409.";
}

function upsertHeaderParameter(
  operation: Record<string, any>,
  header: { name: string; description?: string; schema?: JsonSchema },
): void {
  operation.parameters ??= [];
  const existing = operation.parameters.find((parameter: any) =>
    typeof parameter === "object" &&
    "in" in parameter &&
    parameter.in === "header" &&
    typeof parameter.name === "string" &&
    parameter.name.toLowerCase() === header.name.toLowerCase(),
  );
  const normalized = {
    in: "header",
    name: header.name,
    required: true,
    schema: header.schema ?? stringSchema(),
    ...(header.description ? { description: header.description } : {}),
  };
  if (existing) {
    Object.assign(existing, normalized);
  } else {
    operation.parameters.push(normalized);
  }
}

function upsertQueryParameter(
  operation: Record<string, any>,
  query: { name: string; description?: string; required?: boolean; schema?: JsonSchema },
): void {
  operation.parameters ??= [];
  const existing = operation.parameters.find((parameter: any) =>
    typeof parameter === "object" &&
    "in" in parameter &&
    parameter.in === "query" &&
    parameter.name === query.name,
  );
  const normalized = {
    in: "query",
    name: query.name,
    required: query.required ?? false,
    schema: query.schema ?? stringSchema(),
    ...(query.description ? { description: query.description } : {}),
  };
  if (existing) {
    Object.assign(existing, normalized);
  } else {
    operation.parameters.push(normalized);
  }
}

function answerKeyExcelImportBodySchema(): JsonSchema {
  return objectSchema({
    fileBase64: stringSchema(),
    scoringConfig: answerKeyScoringConfigSchema,
    version: stringSchema(),
  }, ["fileBase64", "version"]);
}

function envelopedSchema(dataSchema: JsonSchema): JsonSchema {
  return objectSchema({ data: dataSchema }, ["data"]);
}

function listEnvelopedSchema(dataSchema: JsonSchema): JsonSchema {
  return objectSchema({ data: dataSchema, meta: listMetaSchema }, ["data", "meta"]);
}

function jsonContent(schema: JsonSchema, contentType = jsonContentType): JsonContent {
  return {
    [contentType]: { schema },
  };
}

function objectSchema(properties: Record<string, JsonSchema>, required: string[] = [], options: JsonSchema = {}): JsonSchema {
  const requiredSet = new Set(required);
  const filtered = Object.fromEntries(
    Object.entries(properties).filter(([key, schema]) => requiredSet.has(key) || !isOptionalSchema(schema)),
  );
  return {
    type: "object",
    additionalProperties: false,
    properties: filtered,
    ...(required.length > 0 ? { required } : {}),
    ...options,
  };
}

function optionalObject(properties: Record<string, JsonSchema>): JsonSchema {
  return {
    ...objectSchema(properties),
    "x-optional": true,
  };
}

function looseObjectSchema(): JsonSchema {
  return {
    type: "object",
    additionalProperties: true,
  };
}

function arraySchema(items: JsonSchema, options: { minItems?: number; maxItems?: number } = {}): JsonSchema {
  return {
    type: "array",
    items,
    ...options,
  };
}

function stringSchema(options: Record<string, unknown> = {}): JsonSchema {
  return {
    type: "string",
    ...options,
  };
}

function numberSchema(options: Record<string, unknown> = {}): JsonSchema {
  return {
    type: "number",
    ...options,
  };
}

function integerSchema(options: Record<string, unknown> = {}): JsonSchema {
  return {
    type: "integer",
    ...options,
  };
}

function isOptionalSchema(schema: JsonSchema): boolean {
  return schema["x-optional"] === true;
}
