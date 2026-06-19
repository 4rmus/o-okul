import type { ParserConfigSuggestion, ParserDelimiter } from "./format-analyzer.js";

export interface Session {
  id: string;
  userId: string;
  tenantId: string;
  roles: string[];
  membershipVersion: number;
  status: string;
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
}

export interface AuthResponse {
  accessToken: string;
  session: Session;
}

export interface MfaChallengeResponse {
  status: "MFA_REQUIRED";
  challengeToken: string;
  expiresAt: string;
  methods: Array<"totp" | "recovery_code">;
}

export type LoginResponse = AuthResponse | MfaChallengeResponse;

export interface TotpSetupResponse {
  secret: string;
  keyUri: string;
  setupToken: string;
  setupExpiresAt: string;
  recoveryCodes: string[];
}

export interface TotpSetupConfirmResponse {
  enabledAt: string;
  recoveryCodesRemaining: number;
}

export interface TotpStatusResponse {
  mode: "off" | "optional" | "required";
  enabled: boolean;
  enabledAt?: string;
  recoveryCodesRemaining: number;
}

export interface MeProfileResponse {
  userId: string;
  tenantId: string | null;
  roles: string[];
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
}

export interface TeacherPortalLookupsResponse {
  campuses: CampusRecord[];
  classes: ClassRecord[];
  courses: CourseRecord[];
  gradeLevels: GradeLevelRecord[];
  terms: AcademicTermRecord[];
}

export type KvkkInventoryKind = "student" | "teacher" | "guardian";

export interface KvkkInventoryRecord {
  id: string;
  kind: KvkkInventoryKind;
  displayRef: string;
  piiCategories: string[];
  purgeAvailable: boolean;
}

export interface NotificationDeviceTokenRecord {
  id: string;
  tenantId: string;
  userId: string;
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
  provider: string;
  token: string;
  platform?: string;
  lastSeenAt: string;
  disabledAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface ClassRecord {
  id: string;
  tenantId: string;
  name: string;
  level?: string;
  campusId?: string;
  gradeLevelId?: string;
  section?: string;
}

export interface CampusRecord {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
}

export interface GradeLevelRecord {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
}

export interface CourseRecord {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
}

export interface LearningOutcomeRecord {
  id: string;
  tenantId: string;
  code: string;
  branch: string;
  title: string;
  level?: string;
}

export interface AcademicYearRecord {
  id: string;
  tenantId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

export interface AcademicTermRecord {
  id: string;
  tenantId: string;
  academicYearId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

export interface TeacherRecord {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  branch?: string;
  userId?: string;
}

export type TeacherAssignmentRole = "CLASS_TEACHER" | "BRANCH_TEACHER" | "GUIDANCE_COUNSELOR" | "RESPONSIBLE_TEACHER";

export interface TeacherAssignmentRecord {
  id: string;
  tenantId: string;
  teacherId: string;
  classId?: string;
  studentId?: string;
  courseId?: string;
  termId?: string;
  role: TeacherAssignmentRole;
  startsAt?: string;
  endsAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TeacherImportError {
  row: number;
  field: "className" | "courseName" | "firstName" | "lastName";
  code: "CLASS_NOT_FOUND" | "COURSE_NOT_FOUND" | "REQUIRED";
  value?: string;
}

export interface TeacherImportPreviewRow {
  row: number;
  classId?: string;
  className?: string;
  courseId?: string;
  courseName?: string;
  firstName: string;
  lastName: string;
  branch?: string;
}

export interface TeacherImportDryRunResult {
  dryRun: true;
  totalRows: number;
  validRows: TeacherImportPreviewRow[];
  errors: TeacherImportError[];
  wouldImport: boolean;
}

export interface TeacherImportResult {
  importedRows: number;
  createdTeachers: number;
  createdAssignments: number;
  teachers: TeacherRecord[];
  assignments: TeacherAssignmentRecord[];
}

export interface GuardianRecord {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  phone?: string;
  userId?: string;
}

export type GuardianRelationshipType = "MOTHER" | "FATHER" | "GUARDIAN" | "EMERGENCY_CONTACT" | "OTHER";

export interface GuardianStudentRecord {
  id: string;
  tenantId: string;
  guardianId: string;
  studentId: string;
  relationshipType: GuardianRelationshipType;
  isPrimary: boolean;
  canViewFinance: boolean;
  canReceiveSms: boolean;
  canReceiveAnnouncements: boolean;
  canOpenSupportTickets: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentRecord {
  id: string;
  tenantId: string;
  studentNo?: string;
  firstName: string;
  lastName: string;
  classId?: string;
  responsibleTeacherId?: string;
  status: StudentStatus;
  userId?: string;
}

export type StudentStatus = "ACTIVE" | "PASSIVE" | "GRADUATED" | "TRANSFERRED";

export interface GuardianStudentDetailStudentRecord {
  id: string;
  studentNo?: string;
  firstName: string;
  lastName: string;
  classId?: string;
  className?: string;
  status: StudentStatus;
  hasPortalUser: boolean;
}

export interface GuardianStudentDetailsResponse {
  links: GuardianStudentRecord[];
  linkedStudents: GuardianStudentDetailStudentRecord[];
  availableStudents: GuardianStudentDetailStudentRecord[];
}

export interface StudentClassHistoryRecord {
  id: string;
  tenantId: string;
  studentId: string;
  classId?: string;
  className?: string;
  campusName?: string;
  gradeLevelName?: string;
  section?: string;
  academicYearId?: string;
  termId?: string;
  startsAt: string;
  endsAt?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentEnrollmentRecord {
  id: string;
  tenantId: string;
  studentId: string;
  academicYearId?: string;
  termId?: string;
  classId?: string;
  className?: string;
  campusName?: string;
  gradeLevelName?: string;
  section?: string;
  status: StudentStatus;
  startsAt: string;
  endsAt?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentProfileRecord extends StudentRecord {
  className?: string;
  campusName?: string;
  gradeLevelName?: string;
  section?: string;
  responsibleTeacherName?: string;
  nationalIdMasked?: string;
  birthDate?: string;
  phone?: string;
  email?: string;
  photoKey?: string;
}

export interface ScheduleLessonRecord {
  id: string;
  tenantId: string;
  classId: string;
  teacherId: string;
  courseId?: string;
  termId?: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface StudySessionRecord {
  id: string;
  tenantId: string;
  classId: string;
  teacherId: string;
  courseId?: string;
  termId?: string;
  studentIds: string[];
  title: string;
  capacity: number;
  startsAt: string;
  endsAt: string;
}

export interface HomeworkRecord {
  id: string;
  tenantId: string;
  classId: string;
  sourceMaterialId?: string;
  sourceMaterialTitle?: string;
  title: string;
  description?: string;
  dueAt?: string;
  checkedAt?: string;
  checkedBy?: string;
}

export interface HomeworkMaterialRecord {
  id: string;
  tenantId: string;
  title: string;
  description?: string;
}

export type UploadContentType = "application/pdf" | "image/jpeg" | "image/png" | "text/plain";

export interface HomeworkMaterialFileRecord {
  id: string;
  tenantId: string;
  materialId: string;
  uploadedById?: string;
  fileName: string;
  contentType: UploadContentType;
  byteSize: number;
  sha256: string;
  createdAt: string;
}

export interface HomeworkMaterialFileDownloadResult {
  fileName: string;
  contentType: HomeworkMaterialFileRecord["contentType"];
  byteSize: number;
  sha256: string;
  downloadMode: "inline" | "signed-url";
  fileBase64?: string;
  downloadUrl?: string;
  downloadUrlExpiresAt?: string;
  downloadUrlExpiresInSeconds?: number;
}

export interface HomeworkMaterialAssignmentRecord {
  id: string;
  tenantId: string;
  materialId: string;
  materialTitle?: string;
  studentId: string;
  courseId?: string;
  termId?: string;
  assignedById?: string;
  note?: string;
  dueAt?: string;
  createdAt: string;
}

export interface AnnouncementRecord {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  audience: "SCHOOL" | "TEACHERS" | "STUDENTS" | "GUARDIANS";
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  publishedAt: string;
  readAt?: string;
}

export interface AnnouncementRecipientRecord {
  announcementId: string;
  recipientType: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId: string;
  userId?: string;
  displayName: string;
  relatedStudentId?: string;
  relatedStudentName?: string;
  readAt?: string;
}

export interface AnnouncementRecipientReport {
  announcementId: string;
  total: number;
  read: number;
  unread: number;
  recipients: AnnouncementRecipientRecord[];
}

export type AnnouncementDeliveryChannel = "EMAIL" | "PUSH";
export type AnnouncementDeliveryStatus = "queued" | "completed" | "failed";

export interface AnnouncementDeliveryReportRecord {
  id: string;
  tenantId: string;
  announcementId: string;
  channel: AnnouncementDeliveryChannel;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  status: AnnouncementDeliveryStatus;
  providerErrorCode?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface MessageTemplateRecord {
  id: string;
  tenantId: string;
  name: string;
  channel: "SMS";
  body: string;
  deletedAt?: string;
}

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  studentId: string;
  courseId?: string;
  termId?: string;
  date: string;
  status: AttendanceStatus;
  deletedAt?: string;
}

export interface AttendanceSummaryRecord {
  studentId: string;
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
}

export type TeacherNoteVisibility = "INTERNAL" | "GUARDIAN_STUDENT";

export interface TeacherNoteRecord {
  id: string;
  tenantId: string;
  studentId: string;
  teacherId: string;
  courseId?: string;
  termId?: string;
  visibility: TeacherNoteVisibility;
  body: string;
  developmentStatus?: string;
  createdAt: string;
  deletedAt?: string;
}

export type DevelopmentAssessmentVisibility = "INTERNAL" | "GUARDIAN";

export interface DevelopmentTrendScore {
  criterionId: string;
  criterionName: string;
  score: number;
  scaleMin: number;
  scaleMax: number;
}

export interface DevelopmentTrendItem {
  id: string;
  periodLabel: string;
  mentorNote?: string;
  visibility: DevelopmentAssessmentVisibility;
  createdAt?: string;
  scores: DevelopmentTrendScore[];
}

export type PaymentInstallmentStatus = "PENDING" | "PAID" | "OVERDUE" | "CANCELED";

export interface PaymentInstallmentRecord {
  id: string;
  tenantId: string;
  planId: string;
  installmentNo: number;
  amount: number;
  dueDate: string;
  status: PaymentInstallmentStatus;
  paidAt?: string;
  createdAt: string;
  deletedAt?: string;
}

export interface PaymentPlanRecord {
  id: string;
  tenantId: string;
  studentId: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  title: string;
  totalAmount: number;
  currency: string;
  createdAt: string;
  deletedAt?: string;
}

export interface PaymentPlanWithInstallmentsRecord extends PaymentPlanRecord {
  installments: PaymentInstallmentRecord[];
}

export interface SupportTicketRecord {
  id: string;
  tenantId: string;
  requesterId?: string;
  studentId?: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  subject: string;
  message: string;
  priority: "LOW" | "NORMAL" | "HIGH";
  status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";
  createdAt: string;
}

export interface SupportTicketAttachmentRecord {
  id: string;
  tenantId: string;
  ticketId: string;
  uploadedById?: string;
  fileName: string;
  contentType: UploadContentType;
  byteSize: number;
  sha256: string;
  createdAt: string;
}

export interface SupportTicketAttachmentDownloadResult {
  fileName: string;
  contentType: SupportTicketAttachmentRecord["contentType"];
  byteSize: number;
  sha256: string;
  downloadMode: "inline" | "signed-url";
  fileBase64?: string;
  downloadUrl?: string;
  downloadUrlExpiresAt?: string;
  downloadUrlExpiresInSeconds?: number;
}

export interface SupportTicketCommentRecord {
  id: string;
  tenantId: string;
  ticketId: string;
  authorId?: string;
  body: string;
  createdAt: string;
}

export interface AuditLogRecord {
  id: string;
  tenantId?: string;
  actorUserId?: string;
  entityType: string;
  entityId?: string;
  action: string;
  diff?: Record<string, unknown>;
  createdAt: string;
}

export type AuditLogCategory = "academic" | "finance" | "identity" | "invitation" | "kvkk" | "operation" | "report" | "tenant" | "user";

export interface AuditLogListItemRecord {
  id: string;
  actionLabel: string;
  actorLabel: string;
  category: AuditLogCategory;
  entityLabel: string;
  createdAt: string;
}

export interface StudentAuditSummaryRecord {
  id: string;
  actionLabel: string;
  createdAt: string;
}

export interface ReportSnapshotRecord {
  id: string;
  tenantId: string;
  examId: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  reportType: string;
  status: string;
  inputRefs: Record<string, unknown>;
  snapshotData?: {
    generatedAt?: string;
    resultCount?: number;
    averages?: {
      correct?: number;
      wrong?: number;
      blank?: number;
      net?: number;
      questionCount?: number;
      rawScore?: number;
      estimatedRawScore?: number;
      standardScore?: number;
      successRate?: number;
    };
    branches?: Array<{
      branch: string;
      resultCount: number;
      correct?: number;
      wrong?: number;
      blank?: number;
      net: number;
      questionCount?: number;
      successRate?: number;
    }>;
    outcomes?: Array<{
      outcomeCode: string;
      branch: string;
      resultCount: number;
      correct?: number;
      wrong?: number;
      blank?: number;
      net: number;
      questionCount?: number;
      successRate?: number;
    }>;
    classes?: Array<{
      classId: string | null;
      className: string | null;
      resultCount: number;
      averages: {
        correct?: number;
        wrong?: number;
        blank?: number;
        net?: number;
        questionCount?: number;
        rawScore?: number;
        standardScore?: number;
        estimatedRawScore?: number;
        successRate?: number;
      };
      branches?: Array<{
        branch: string;
        resultCount: number;
        correct?: number;
        wrong?: number;
        blank?: number;
        net: number;
        questionCount?: number;
        successRate?: number;
      }>;
    }>;
    commentary?: ReportSnapshotCommentary;
    students?: Array<{
      studentId: string;
      classId?: string;
      className?: string;
      resultKey: string;
      total?: {
        correct?: number;
        wrong?: number;
        blank?: number;
        net?: number;
        questionCount?: number;
        rawScore?: number;
        standardScore?: number;
        estimatedRawScore?: number;
        successRate?: number;
      };
      branches?: Array<{
        branch: string;
        correct?: number;
        wrong?: number;
        blank?: number;
        net?: number;
        questionCount?: number;
        successRate?: number;
      }>;
      outcomes?: Array<{
        outcomeCode: string;
        branch: string;
        correct?: number;
        wrong?: number;
        blank?: number;
        net?: number;
        questionCount?: number;
        successRate?: number;
      }>;
      questions?: Array<{
        questionNo: number;
        branch: string;
        outcomeCode?: string;
        answer: string;
        correctAnswer: string;
        status: "CORRECT" | "WRONG" | "BLANK";
      }>;
      commentary?: ReportStudentCommentary;
    }>;
  };
  generatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportSnapshotCommentary {
  provider: "template";
  generatedAt: string;
  parentSummary: string;
  teacherActionDrafts: string[];
  reviewStatus: "DRAFT";
  disclaimer: string;
  dataPolicy: {
    piiIncluded: false;
    fieldsUsed: string[];
    fieldsExcluded: string[];
  };
}

export interface ReportSnapshotExportResult {
  fileName: string;
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/pdf";
  fileBase64: string;
  rowCount?: number;
  pageCount?: number;
}

export interface ReportPdfSnapshotRecord {
  id: string;
  tenantId: string;
  examId: string;
  reportType: string;
  status: string;
  snapshotData?: Record<string, unknown>;
  generatedAt?: string;
}

export interface ReportPdfInstitution {
  institutionLogoUrl?: string;
  institutionName?: string;
}

export interface ReportPdfRenderJobPayload {
  snapshot: ReportPdfSnapshotRecord;
  institution?: ReportPdfInstitution;
}

export interface ReportPdfRenderJobResult {
  fileName: string;
  contentType: "application/pdf";
  fileBase64: string;
  pageCount: number;
}

export interface ReportStudentScoreSummary {
  correct?: number;
  wrong?: number;
  blank?: number;
  net?: number;
  questionCount?: number;
  rawScore?: number;
  standardScore?: number;
  estimatedRawScore?: number;
  successRate?: number;
}

export interface ReportStudentBranchSummary {
  branch: string;
  correct?: number;
  wrong?: number;
  blank?: number;
  net?: number;
  questionCount?: number;
  successRate?: number;
  classNetAverage?: number;
  schoolNetAverage?: number;
  generalNetAverage?: number;
}

export interface ReportStudentOutcomeSummary {
  outcomeCode: string;
  branch: string;
  correct?: number;
  wrong?: number;
  blank?: number;
  net?: number;
  questionCount?: number;
  successRate?: number;
}

export interface ReportStudentQuestionSummary {
  questionNo: number;
  branch: string;
  outcomeCode?: string;
  answer: string;
  correctAnswer: string;
  status: "CORRECT" | "WRONG" | "BLANK";
}

export interface ReportScopeRank {
  rank: number;
  outOf: number;
  percentile: number;
}

export interface ReportStudentBranchStatistics {
  branch: string;
  standardScore: number;
  general: ReportScopeRank;
  class?: ReportScopeRank;
}

export interface ReportStudentStatistics {
  standardScore: number;
  general: ReportScopeRank;
  class?: ReportScopeRank;
  branches: ReportStudentBranchStatistics[];
}

export interface ReportStudentCommentary {
  provider: "template";
  generatedAt: string;
  parentSummary: string;
  teacherActionDraft: string;
  reviewStatus: "DRAFT";
  disclaimer: string;
}

export interface ReportStudentSnapshot {
  tenantId: string;
  institutionName?: string;
  institutionLogoUrl?: string;
  examId: string;
  examTitle?: string;
  examStartsAt?: string;
  snapshotId: string;
  studentId: string;
  studentName?: string;
  participantNo?: string;
  bookletType?: string;
  classId?: string;
  className?: string;
  courseId?: string;
  resultKey: string;
  termId?: string;
  total: ReportStudentScoreSummary;
  branches: ReportStudentBranchSummary[];
  outcomes?: ReportStudentOutcomeSummary[];
  questions?: ReportStudentQuestionSummary[];
  statistics?: ReportStudentStatistics;
  commentary?: ReportStudentCommentary;
  generatedAt?: string;
}

export interface ReportStudentProgressPoint {
  snapshotId: string;
  courseId?: string;
  examTitle?: string;
  generatedAt?: string;
  termId?: string;
  total: ReportStudentScoreSummary;
  branches?: ReportStudentBranchSummary[];
}

export interface ReportStudentProgress {
  tenantId: string;
  examId: string;
  studentId: string;
  points: ReportStudentProgressPoint[];
  netDelta?: number;
  standardScoreDelta?: number;
}

export interface ReportErrorBooklet {
  tenantId: string;
  examId: string;
  snapshotId: string;
  studentId: string;
  items: ReportStudentQuestionSummary[];
  generatedAt?: string;
}

export type ExamStatus = "DRAFT" | "PUBLISHED";

export interface ExamRecord {
  id: string;
  tenantId: string;
  title: string;
  status: string;
  startsAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type ExamParticipantStatus = "REGISTERED" | "ATTENDED" | "ABSENT";

export interface ExamParticipantRecord {
  id: string;
  tenantId: string;
  examId: string;
  studentId: string;
  participantNo?: string;
  bookletType?: string;
  status: ExamParticipantStatus | string;
  createdAt: string;
  updatedAt: string;
}

export interface OpticalFormTemplateRecord {
  id: string;
  tenantId: string;
  name: string;
  version: string;
  encoding: "UTF-8";
  delimiter: ParserDelimiter;
  skipHeaderLines: number;
  fieldMapping: ParserConfigSuggestion["fieldMapping"];
  status: "APPROVED" | "DRAFT";
  createdAt: string;
  updatedAt: string;
}

export type AnswerChoice = "A" | "B" | "C" | "D" | "E";

export interface AnswerKeyItemInput {
  questionNo: number;
  correctAnswer: AnswerChoice;
  branch: string;
  outcomeCode?: string;
  topic?: string;
}

export interface AnswerKeyScoringConfig {
  wrongPenalty: number;
  rawScoreMultiplier?: number;
  standardScoreBase?: number;
  standardScoreMultiplier?: number;
}

export interface AnswerKeyBranchSummary {
  branch: string;
  questionCount: number;
}

export interface AnswerKeyRecord {
  id: string;
  tenantId: string;
  examId: string;
  version: string;
  questionCount: number;
  branches: AnswerKeyBranchSummary[];
  scoringConfig: AnswerKeyScoringConfig;
  status: "DRAFT" | "PUBLISHED";
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}
