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

export interface MeProfileResponse {
  userId: string;
  tenantId: string | null;
  roles: string[];
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
}

export interface ClassRecord {
  id: string;
  tenantId: string;
  name: string;
  level?: string;
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
  role: TeacherAssignmentRole;
  startsAt?: string;
  endsAt?: string;
  createdAt?: string;
  updatedAt?: string;
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
  firstName: string;
  lastName: string;
  classId?: string;
  responsibleTeacherId?: string;
  status: StudentStatus;
  userId?: string;
}

export type StudentStatus = "ACTIVE" | "PASSIVE";

export interface StudentClassHistoryRecord {
  id: string;
  tenantId: string;
  studentId: string;
  classId?: string;
  startsAt: string;
  endsAt?: string;
  reason?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface StudentProfileRecord extends StudentRecord {
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
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface StudySessionRecord {
  id: string;
  tenantId: string;
  classId: string;
  teacherId: string;
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

export interface HomeworkMaterialAssignmentRecord {
  id: string;
  tenantId: string;
  materialId: string;
  studentId: string;
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
  audience: "SCHOOL" | "TEACHERS";
  publishedAt: string;
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
  visibility: TeacherNoteVisibility;
  body: string;
  developmentStatus?: string;
  createdAt: string;
  deletedAt?: string;
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
  fileBase64: string;
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

export interface ReportSnapshotRecord {
  id: string;
  tenantId: string;
  examId: string;
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
      rawScore?: number;
      standardScore?: number;
    };
    branches?: Array<{
      branch: string;
      resultCount: number;
      correct?: number;
      wrong?: number;
      blank?: number;
      net: number;
    }>;
    outcomes?: Array<{
      outcomeCode: string;
      branch: string;
      resultCount: number;
      correct?: number;
      wrong?: number;
      blank?: number;
      net: number;
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
        standardScore?: number;
      };
    }>;
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
        standardScore?: number;
      };
      branches?: Array<{
        branch: string;
        correct?: number;
        wrong?: number;
        blank?: number;
        net?: number;
      }>;
      outcomes?: Array<{
        outcomeCode: string;
        branch: string;
        correct?: number;
        wrong?: number;
        blank?: number;
        net?: number;
      }>;
      questions?: Array<{
        questionNo: number;
        branch: string;
        outcomeCode?: string;
        answer: string;
        correctAnswer: string;
        status: "CORRECT" | "WRONG" | "BLANK";
      }>;
    }>;
  };
  generatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportSnapshotExportResult {
  fileName: string;
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" | "application/pdf";
  fileBase64: string;
  rowCount?: number;
  pageCount?: number;
}

export interface ReportStudentScoreSummary {
  correct?: number;
  wrong?: number;
  blank?: number;
  net?: number;
  rawScore?: number;
  standardScore?: number;
}

export interface ReportStudentBranchSummary {
  branch: string;
  correct?: number;
  wrong?: number;
  blank?: number;
  net?: number;
}

export interface ReportStudentOutcomeSummary {
  outcomeCode: string;
  branch: string;
  correct?: number;
  wrong?: number;
  blank?: number;
  net?: number;
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

export interface ReportStudentSnapshot {
  tenantId: string;
  examId: string;
  snapshotId: string;
  studentId: string;
  classId?: string;
  className?: string;
  resultKey: string;
  total: ReportStudentScoreSummary;
  branches: ReportStudentBranchSummary[];
  outcomes?: ReportStudentOutcomeSummary[];
  statistics?: ReportStudentStatistics;
  generatedAt?: string;
}

export interface ReportStudentProgressPoint {
  snapshotId: string;
  generatedAt?: string;
  total: ReportStudentScoreSummary;
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

export type AnswerChoice = "A" | "B" | "C" | "D" | "E";

export interface AnswerKeyItemInput {
  questionNo: number;
  correctAnswer: AnswerChoice;
  branch: string;
  outcomeCode?: string;
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
