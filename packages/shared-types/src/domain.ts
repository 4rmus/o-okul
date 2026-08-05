import type {
  ParserConfigPreset,
  ParserConfigSuggestion,
  ParserDelimiter,
  ParserEncoding,
} from "./format-analyzer.js";
import type { PortalSubjectRoleName, TenantAssignableRoleName } from "./role-capabilities.js";

export type ActivePersona = "STAFF" | "TEACHER" | "STUDENT";

export interface Session {
  id: string;
  userId: string;
  tenantId: string;
  membershipId?: string;
  activePersona?: ActivePersona;
  roles: string[];
  membershipVersion: number;
  status: string;
  mustChangePassword?: boolean;
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
}

export interface AuthResponse {
  accessToken: string;
  session: Session;
}

export interface LoginRequest {
  /** @deprecated Tenant subdomaini kullanılır; yalnız geçiş root akışında gönderilir. */
  tenantSlug?: string;
  loginName: string;
  password: string;
}

export interface TenantLoginContextResponse {
  slug: string;
  name: string;
  logoUrl?: string;
}

export type TenantHostErrorCode =
  | "TENANT_HOST_UNKNOWN"
  | "TENANT_HOST_RESERVED"
  | "TENANT_HOST_MISMATCH"
  | "TENANT_HOST_REQUIRED"
  | "LEGACY_TENANT_LOGIN_RETIRED";

export interface TenantSelectionOption {
  tenantId: string;
  name: string;
  slug: string;
}

export interface TenantSelectionRequiredResponse {
  status: "TENANT_SELECTION_REQUIRED";
  selectionToken: string;
  expiresAt: string;
  tenants: TenantSelectionOption[];
}

export interface TenantSelectionRequest {
  selectionToken: string;
  tenantId: string;
}

export interface MfaChallengeResponse {
  status: "MFA_REQUIRED";
  challengeToken: string;
  expiresAt: string;
  methods: Array<"totp" | "recovery_code">;
}

export interface MfaEnrollmentRequiredResponse extends TotpSetupResponse {
  status: "MFA_ENROLLMENT_REQUIRED";
}

export type LoginResponse = AuthResponse | MfaChallengeResponse | MfaEnrollmentRequiredResponse | TenantSelectionRequiredResponse;

export type AuthRefreshRequest = Record<string, never>;

export interface PersonaSwitchRequest {
  activePersona: ActivePersona;
}

export interface PasswordResetRequest {
  /** @deprecated Tenant subdomaini kullanılır; yalnız geçiş root akışında gönderilir. */
  tenantSlug?: string;
  loginName: string;
}

export interface PasswordResetAcceptedResponse {
  status: "ACCEPTED";
}

export interface PasswordResetConfirmRequest {
  token: string;
  password: string;
}

export interface PasswordResetConfirmResponse {
  resetAt: string;
}

export interface MePasswordChangeRequest {
  currentPassword: string;
  newPassword: string;
}

export interface MePasswordChangeResponse {
  changedAt: string;
}

export interface MeSessionRecord {
  id: string;
  activePersona?: ActivePersona;
  deviceLabel: string;
  clientIpPrefix?: string;
  roles: string[];
  status: "ACTIVE";
  current: boolean;
  expiresAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface MeSessionRevokeAllResponse {
  revokedCount: number;
}

export interface TotpChallengeVerifyRequest {
  challengeToken: string;
  totpCode?: string;
  recoveryCode?: string;
}

export interface TotpSetupResponse {
  secret: string;
  keyUri: string;
  setupToken: string;
  setupExpiresAt: string;
  recoveryCodes: string[];
}

export interface TotpSetupConfirmRequest {
  setupToken: string;
  totpCode: string;
}

export type TotpEnrollmentConfirmRequest = TotpSetupConfirmRequest;

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

export interface TotpDisableRequest {
  totpCode?: string;
  recoveryCode?: string;
}

export interface TotpDisableResponse {
  disabledAt: string;
}

export type MfaStepUpPurpose = "OWNER_ADMIN_CHANGE";

export interface MfaStepUpRequest {
  purpose: MfaStepUpPurpose;
  totpCode?: string;
  recoveryCode?: string;
}

export interface MfaStepUpResponse {
  purpose: MfaStepUpPurpose;
  stepUpToken: string;
  expiresAt: string;
}

export interface MeProfileResponse {
  userId: string;
  tenantId: string | null;
  roles: string[];
  mustChangePassword?: boolean;
  subjectType?: "STUDENT" | "GUARDIAN" | "TEACHER";
  subjectId?: string;
  membershipId?: string;
  activePersona?: ActivePersona;
  availablePersonas?: ActivePersona[];
  capabilities?: string[];
  membership?: {
    id: string;
    version: number;
  };
}

export interface TenantRecord {
  id: string;
  name: string;
  slug: string;
  plan: string;
  licenseStartsAt?: string;
  licenseEndsAt?: string;
  institutionType?: string;
  contactEmail?: string;
  logoUrl?: string;
  seatLimit?: number;
  activeSeatCount?: number;
  status: string;
}

export type LicenseState = "SCHEDULED" | "ACTIVE" | "READ_ONLY" | "FROZEN" | "EXPIRED" | "CANCELLED";

export interface LicenseTermRecord {
  id: string;
  tenantId: string;
  planCode: string;
  startsAt: string;
  endsAt: string;
  activeStudentLimit: number;
  cancelledAt?: string;
  createdByPlatformAccountId?: string;
  auditReference?: string;
}

export interface LicenseTermListRecord extends LicenseTermRecord {
  state: LicenseState;
}

export interface LicenseTermCreateRequest {
  planCode: string;
  startsAt: string;
  endsAt: string;
  activeStudentLimit: number;
  auditReference: string;
}

export interface TenantCurrentProfileUpdateRequest {
  contactEmail?: string;
  institutionType?: string;
  logoUrl?: string;
  name?: string;
}

export interface TenantFirstAdminCreateRequest {
  email: string;
  name: string;
  nationalId: string;
}

export interface TenantFirstOwnerCreateRequest {
  email: string;
  name: string;
  nationalId?: string;
}

export interface TenantCampusCreateRequest {
  code?: string;
  name: string;
  unitType?: "SCHOOL" | "COURSE" | "MIXED";
}

export interface TenantOnboardingOwnerRecord {
  id: string;
  tenantId: string;
  employeeId: string;
  roles: ["TENANT_OWNER"];
}

export interface TenantCreateRequest {
  campuses?: TenantCampusCreateRequest[];
  contactEmail?: string;
  firstAdmin?: TenantFirstAdminCreateRequest;
  firstOwner?: TenantFirstOwnerCreateRequest;
  id?: string;
  institutionType?: string;
  licenseEndsAt?: string;
  licenseStartsAt?: string;
  logoUrl?: string;
  licenseTerm?: LicenseTermCreateRequest;
  name: string;
  plan?: string;
  seatLimit?: number;
  slug: string;
  status?: string;
}

export interface TenantAdminUpdateRequest {
  contactEmail?: string;
  institutionType?: string;
  logoUrl?: string;
  name?: string;
  slug?: string;
  status?: string;
}

export interface TenantUserRecord {
  id: string;
  email?: string;
  name: string;
  tenantId: string;
  roles: TenantAssignableRoleName[];
  createdAt: string;
  updatedAt: string;
}

export interface TenantUserRoleUpdateRequest {
  roles: TenantAssignableRoleName[];
}

export interface EmployeeAccessRecord {
  id: string;
  tenantId: string;
  employeeNo?: string;
  firstName: string;
  lastName: string;
  workEmail?: string;
  status: string;
  employmentStartsAt?: string;
  employmentEndsAt?: string;
  userId?: string;
  accountStatus?: string;
  access?: {
    membershipId: string;
    staffRole?: "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATIONS_STAFF" | "FINANCE_STAFF";
    hasTeacherPersona: boolean;
    status: string;
    version: number;
    scopeMode: "TENANT" | "CAMPUSES";
    campusIds: string[];
  };
}

export type EmployeeAccessSort = "lastName" | "-lastName" | "firstName" | "employeeNo";

export interface EmployeeAccessListQuery {
  cursor?: string;
  direction: "next" | "previous";
  limit: number;
  q?: string;
  sort: EmployeeAccessSort;
}

export type EmployeeStaffRole = "TENANT_OWNER" | "TENANT_ADMIN" | "OPERATIONS_STAFF" | "FINANCE_STAFF";
export type EmployeeInvitationRole = EmployeeStaffRole;
export type TenantMembershipLifecycleStatus = "ACTIVE" | "SUSPENDED" | "ENDED";
export type TenantMembershipScopeMode = "TENANT" | "CAMPUSES";

export interface EmployeeCreateRequest {
  employeeNo?: string;
  firstName: string;
  lastName: string;
  workEmail?: string;
  phone?: string;
  employmentStartsAt?: string;
  status: "PLANNED" | "ACTIVE";
}

export interface EmployeeAccountInvitationRequest {
  email: string;
  role: EmployeeInvitationRole;
}

export interface TenantMembershipUpdateRequest {
  expectedVersion: number;
  staffRole?: EmployeeStaffRole;
  hasTeacherPersona: boolean;
  status: TenantMembershipLifecycleStatus;
  scopeMode: TenantMembershipScopeMode;
  campusIds: string[];
  endedReason?: string;
}

export interface TenantMembershipUpdateResult {
  employee: EmployeeAccessRecord;
  sessionsRevoked: number;
}

export type TenantFirstAdminProvisionResult = TenantUserRecord;

export type TenantCreateResponse =
  | TenantRecord
  | {
      tenant: TenantRecord;
      admin: TenantFirstAdminProvisionResult;
    }
  | {
      tenant: TenantRecord;
      campuses: CampusRecord[];
      licenseTerm: LicenseTermRecord;
      owner: TenantOnboardingOwnerRecord;
    };

export interface RolePreviewStartRequest {
  targetRole: PortalSubjectRoleName;
  targetSubjectId: string;
}

export interface RolePreviewSession {
  id: string;
  tenantId: string;
  actorUserId: string;
  targetRole: PortalSubjectRoleName;
  targetSubjectType: PortalSubjectRoleName;
  targetSubjectId: string;
  mode: "READ_ONLY";
  expiresAt: string;
  createdAt: string;
  previewToken: string;
}

export interface TeacherPortalLookupsResponse {
  attendanceClassIds: string[];
  campuses: CampusRecord[];
  classes: ClassRecord[];
  courses: CourseRecord[];
  gradeLevels: GradeLevelRecord[];
  terms: AcademicTermRecord[];
}

export type KvkkInventoryKind = "student" | "teacher" | "guardian" | "user";

export interface KvkkInventoryRecord {
  id: string;
  kind: KvkkInventoryKind;
  displayRef: string;
  piiCategories: string[];
  purgeAvailable: boolean;
}

export interface SelfPurgeResult {
  userId: string;
  tenantId?: string;
  purgedAt: string;
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

export type PublicNotificationDeviceTokenRecord = Omit<NotificationDeviceTokenRecord, "token" | "userId">;

export interface ClassRecord {
  id: string;
  tenantId: string;
  name: string;
  alanId?: string;
  campusId?: string;
  gradeLevelId?: string;
  section?: string;
}

export interface ClassCreateRequest {
  tenantId?: string;
  name: string;
  alanId?: string;
  campusId?: string;
  gradeLevelId?: string;
  section?: string;
}

export interface ClassUpdateRequest {
  name?: string;
  alanId?: string;
  campusId?: string;
  gradeLevelId?: string;
  section?: string;
}

export interface CampusRecord {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
  unitType?: "SCHOOL" | "COURSE" | "MIXED";
}

export interface CampusCreateRequest {
  tenantId?: string;
  name: string;
  code?: string;
  unitType?: "SCHOOL" | "COURSE" | "MIXED";
}

export interface CampusUpdateRequest {
  name?: string;
  code?: string;
  unitType?: "SCHOOL" | "COURSE" | "MIXED";
}

export interface GradeLevelRecord {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
}

export interface GradeLevelCreateRequest {
  tenantId?: string;
  name: string;
  code?: string;
}

export interface GradeLevelUpdateRequest {
  name?: string;
  code?: string;
}

export interface AlanRecord {
  id: string;
  tenantId: string;
  gradeLevelId?: string;
  name: string;
  code?: string;
}

export interface AlanCreateRequest {
  tenantId?: string;
  gradeLevelId?: string;
  name: string;
  code?: string;
}

export interface AlanUpdateRequest {
  gradeLevelId?: string;
  name?: string;
  code?: string;
}

export interface CourseRecord {
  id: string;
  tenantId: string;
  name: string;
  code?: string;
}

export interface GradeLevelCourseRecord {
  id: string;
  tenantId: string;
  gradeLevelId: string;
  courseId: string;
  alanId?: string;
  isDefault: boolean;
  sortOrder: number;
  courseName: string;
  courseCode?: string;
  alanName?: string;
}

export interface CourseCreateRequest {
  tenantId?: string;
  name: string;
  code?: string;
}

export interface CourseUpdateRequest {
  name?: string;
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

export interface LearningOutcomeCreateRequest {
  tenantId?: string;
  code: string;
  branch: string;
  title: string;
  level?: string;
}

export interface LearningOutcomeUpdateRequest {
  code?: string;
  branch?: string;
  title?: string;
  level?: string;
}

export interface LearningOutcomeImportRequest {
  fileBase64: string;
}

export interface LearningOutcomeImportError {
  row: number;
  field: "code" | "branch" | "title";
  code: "DUPLICATE_CODE" | "REQUIRED";
  value?: string;
}

export interface LearningOutcomeImportPreviewRow {
  row: number;
  code: string;
  branch: string;
  title: string;
  level?: string;
  willUpdate?: boolean;
}

export interface LearningOutcomeImportDryRunResult {
  dryRun: true;
  totalRows: number;
  validRows: LearningOutcomeImportPreviewRow[];
  errors: LearningOutcomeImportError[];
  wouldImport: boolean;
}

export interface LearningOutcomeImportResult {
  importedRows: number;
  createdOutcomes: number;
  updatedOutcomes: number;
  outcomes: LearningOutcomeRecord[];
}

export interface AcademicYearRecord {
  id: string;
  tenantId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
}

export interface AcademicYearCreateRequest {
  tenantId?: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive?: boolean;
}

export interface AcademicYearUpdateRequest {
  name?: string;
  startsAt?: string;
  endsAt?: string;
  isActive?: boolean;
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

export interface AcademicTermCreateRequest {
  tenantId?: string;
  academicYearId: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isActive?: boolean;
}

export interface AcademicTermUpdateRequest {
  academicYearId?: string;
  name?: string;
  startsAt?: string;
  endsAt?: string;
  isActive?: boolean;
}

export type IdentityProvisioningStatus = "PROVISIONED" | "INVITED" | "SKIPPED";

export interface TeacherRecord {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string;
  branch?: string;
  phone?: string;
  userId?: string;
  provisioning?: IdentityProvisioningStatus;
}

export interface TeacherCreateRequest {
  tenantId?: string;
  firstName: string;
  lastName: string;
  branch?: string;
  email?: string;
  nationalId?: string;
  phone?: string;
}

export interface TeacherUpdateRequest {
  firstName?: string;
  lastName?: string;
  branch?: string;
  email?: string;
  nationalId?: string;
  phone?: string;
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

export interface TeacherAssignmentCreateRequest {
  classId?: string;
  studentId?: string;
  courseId?: string;
  termId?: string;
  role?: TeacherAssignmentRole;
  startsAt?: string;
  endsAt?: string;
}

export interface TeacherAssignmentUpdateRequest {
  classId?: string;
  studentId?: string;
  courseId?: string;
  termId?: string;
  role?: TeacherAssignmentRole;
  startsAt?: string;
  endsAt?: string;
}

export interface TeacherImportRequest {
  fileBase64: string;
}

export interface TeacherImportError {
  row: number;
  field: "className" | "courseName" | "firstName" | "lastName" | "nationalId" | "phone";
  code: "CLASS_NOT_FOUND" | "COURSE_NOT_FOUND" | "INVALID" | "REQUIRED";
  value?: string;
}

export interface TeacherImportPreviewRow {
  row: number;
  accountPreview?: {
    usernameMasked: string;
    willCreate: boolean;
  };
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
  matched?: boolean;
  provisioning?: IdentityProvisioningStatus;
}

export type GuardianRelationshipType = "MOTHER" | "FATHER" | "GUARDIAN" | "EMERGENCY_CONTACT" | "OTHER";

export interface GuardianCreateRequest {
  tenantId?: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  nationalId?: string;
}

export interface GuardianUpdateRequest {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  nationalId?: string;
}

export interface GuardianStudentRelationRequest {
  canViewFinance?: boolean;
  canReceiveSms?: boolean;
  canReceiveAnnouncements?: boolean;
  canOpenSupportTickets?: boolean;
}

export interface GuardianStudentLinkRequest extends GuardianStudentRelationRequest {
  studentId: string;
}

export interface GuardianStudentRecord {
  id: string;
  tenantId: string;
  guardianId: string;
  studentId: string;
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

export type PublicStudentRecord = Omit<StudentRecord, "userId">;

export type StudentStatus = "ACTIVE" | "PASSIVE" | "GRADUATED" | "TRANSFERRED";

export type StudentPortalAccessState = "ACTIVE" | "SUSPENDED" | "INVITED" | "NOT_INVITED" | "INCONSISTENT";

export interface StudentPortalAccessRecord {
  studentId: string;
  tenantId: string;
  studentNo?: string;
  firstName: string;
  lastName: string;
  studentStatus: StudentStatus;
  accessState: StudentPortalAccessState;
  userId?: string;
  accountStatus?: string;
  membership?: {
    id: string;
    status: "ACTIVE" | "SUSPENDED" | "ENDED";
    version: number;
  };
  invitation?: {
    id: string;
    kind: "EMAIL_LINK" | "STUDENT_CODE";
    status: "PENDING" | "ACCEPTED" | "REVOKED";
    emailMasked?: string;
    expiresAt: string;
  };
  activeSessionCount: number;
}

export interface StudentPortalAccessUpdateRequest {
  status: "ACTIVE" | "SUSPENDED";
  expectedVersion: number;
}

export interface StudentPortalAccessUpdateResult {
  studentId: string;
  tenantId: string;
  userId: string;
  accountStatus: string;
  membership: {
    id: string;
    status: "ACTIVE" | "SUSPENDED";
    version: number;
  };
  sessionsRevoked: number;
}

export interface StudentGuardianProvisionRequest {
  firstName?: string;
  lastName?: string;
  nationalId?: string;
  phone?: string;
  email?: string;
  canViewFinance?: boolean;
  canReceiveSms?: boolean;
  canReceiveAnnouncements?: boolean;
  canOpenSupportTickets?: boolean;
}

export interface StudentCreateRequest {
  tenantId?: string;
  studentNo?: string;
  firstName: string;
  lastName: string;
  classId?: string;
  responsibleTeacherId?: string;
  status?: StudentStatus;
  nationalId?: string;
  phone?: string;
  email?: string;
  guardian?: StudentGuardianProvisionRequest;
}

export interface StudentUpdateRequest {
  firstName?: string;
  lastName?: string;
  classId?: string;
  responsibleTeacherId?: string;
  status?: StudentStatus;
}

export interface StudentTenantUpdateRequest {
  tenantId: string;
}

export interface StudentProfileUpdateRequest {
  nationalId?: string;
  phone?: string;
  email?: string;
  photoKey?: string;
}

export interface StudentEnrollmentActionRequest {
  academicYearId?: string;
  termId?: string;
  classId?: string;
  startsAt?: string;
}

export interface StudentBulkEnrollmentRequest extends StudentEnrollmentActionRequest {
  studentIds?: string[];
  classIdBySourceClassId?: Record<string, string>;
  useAutomaticClassMapping?: boolean;
}

export interface StudentBulkEnrollmentResult {
  updatedCount: number;
  enrollments: StudentEnrollmentRecord[];
}

export interface StudentImportRequest {
  fileBase64: string;
}

export interface StudentImportError {
  row: number;
  field: "className" | "email" | "firstName" | "guardianNationalId" | "guardianPhone" | "lastName" | "nationalId" | "phone" | "quota" | "studentNo";
  code:
    | "CLASS_NOT_FOUND"
    | "INVALID_DATE"
    | "INVALID_EMAIL"
    | "INVALID_NATIONAL_ID"
    | "INVALID_PHONE"
    | "REQUIRED"
    | "STUDENT_NATIONAL_ID_DUPLICATE"
    | "STUDENT_NO_DUPLICATE"
    | "ACTIVE_STUDENT_LIMIT_REACHED";
  value?: string;
}

export interface StudentImportPreviewRow {
  row: number;
  accountPreview?: {
    usernameMasked: string;
    willCreate: boolean;
  };
  classId?: string;
  className?: string;
  email?: string;
  firstName: string;
  guardian?: StudentGuardianProvisionRequest;
  lastName: string;
  studentNo?: string;
}

export interface StudentImportDryRunResult {
  dryRun: true;
  totalRows: number;
  validRows: StudentImportPreviewRow[];
  errors: StudentImportError[];
  quota: {
    limit: number;
    current: number;
    incoming: number;
    wouldExceed: boolean;
  };
  wouldImport: boolean;
}

export interface StudentImportResult {
  importedRows: number;
  students: PublicStudentRecord[];
}

export interface StudentExportResult {
  fileName: string;
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  fileBase64: string;
  rowCount: number;
}

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

export type GlobalSearchType = "students" | "teachers" | "guardians" | "classes";

export interface GlobalSearchResultRecord {
  id: string;
  type: GlobalSearchType;
  title: string;
  subtitle?: string;
  href: string;
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
  phone?: string;
  email?: string;
  photoKey?: string;
}

export type PublicStudentProfileRecord = Omit<StudentProfileRecord, "userId">;

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

export interface ScheduleLessonCreateRequest {
  tenantId?: string;
  classId: string;
  teacherId: string;
  courseId?: string;
  termId?: string;
  title: string;
  startsAt: string;
  endsAt: string;
}

export interface ScheduleLessonUpdateRequest {
  classId?: string;
  teacherId?: string;
  courseId?: string;
  termId?: string;
  title?: string;
  startsAt?: string;
  endsAt?: string;
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

export interface StudySessionCreateRequest {
  tenantId?: string;
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

export interface StudySessionUpdateRequest {
  classId?: string;
  teacherId?: string;
  courseId?: string;
  termId?: string;
  studentIds?: string[];
  title?: string;
  capacity?: number;
  startsAt?: string;
  endsAt?: string;
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

export interface HomeworkMaterialCreateRequest {
  tenantId?: string;
  title: string;
  description?: string;
}

export interface HomeworkMaterialUpdateRequest {
  title?: string;
  description?: string;
}

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

export interface HomeworkMaterialFileCreateRequest {
  contentType: UploadContentType;
  fileBase64: string;
  fileName: string;
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

export interface HomeworkMaterialAssignmentCreateRequest {
  studentId: string;
  courseId?: string;
  termId?: string;
  note?: string;
  dueAt?: string;
}

export interface HomeworkCreateRequest {
  tenantId?: string;
  classId: string;
  title: string;
  description?: string;
  dueAt?: string;
}

export interface HomeworkFromMaterialCreateRequest {
  tenantId?: string;
  classId: string;
  materialId: string;
  dueAt?: string;
}

export interface HomeworkUpdateRequest {
  classId?: string;
  title?: string;
  description?: string;
  dueAt?: string;
}

export interface HomeworkCheckStatusRequest {
  checked: boolean;
}

export type AnnouncementAudience = "SCHOOL" | "TEACHERS" | "STUDENTS" | "GUARDIANS";

export interface AnnouncementCreateRequest {
  audience?: AnnouncementAudience;
  body: string;
  campusId?: string;
  classId?: string;
  courseId?: string;
  gradeLevelId?: string;
  tenantId?: string;
  termId?: string;
  title: string;
}

export interface AnnouncementRecord {
  id: string;
  tenantId: string;
  title: string;
  body: string;
  audience: AnnouncementAudience;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  publishedAt: string;
  readAt?: string;
  deletedAt?: string;
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

export interface AnnouncementDeliveryResultRequest {
  channel: AnnouncementDeliveryChannel;
  deliveredCount: number;
  failedCount: number;
  providerErrorCode?: string;
  recipientCount: number;
  status: Exclude<AnnouncementDeliveryStatus, "queued">;
}

export interface AnnouncementDeliverySendRequest {
  channel: AnnouncementDeliveryChannel;
}

export interface AnnouncementDeliveryQueueResult {
  tenantId: string;
  announcementId: string;
  channel: AnnouncementDeliveryChannel;
  recipientCount: number;
  deliveredCount: number;
  failedCount: number;
  queueName: "announcement-delivery";
  jobId: string;
  status: "queued";
}

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

export interface ApiListMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ApiCursorListMeta {
  limit: number;
  nextCursor?: string;
  previousCursor?: string;
}

export interface ApiItemResponse<TItem> {
  data: TItem;
}

export interface ApiListResponse<TItem> {
  data: TItem[];
  meta: ApiListMeta;
}

export interface ApiCursorListResponse<TItem> {
  data: TItem[];
  meta: ApiCursorListMeta;
}

export type IdentityInvitationSubjectType = "TEACHER" | "STUDENT" | "GUARDIAN" | "EMPLOYEE";
export type IdentityInvitationStatus = "PENDING" | "ACCEPTED" | "REVOKED";

export interface IdentityInvitationRecord {
  id: string;
  tenantId: string;
  subjectType: IdentityInvitationSubjectType;
  subjectId: string;
  email?: string;
  name: string;
  role: TenantAssignableRoleName;
  kind: "EMAIL_LINK" | "STUDENT_CODE";
  status: IdentityInvitationStatus;
  expiresAt: string;
  acceptedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface IdentityInvitationCreateRequest {
  email: string;
  name?: string;
  subjectId: string;
  subjectType: Exclude<IdentityInvitationSubjectType, "EMPLOYEE">;
}

export interface IdentityInvitationAcceptRequest {
  name?: string;
  password: string;
  token: string;
}

export type IdentityInvitationCreateResponse = IdentityInvitationRecord;
export type IdentityInvitationResendResponse = IdentityInvitationRecord;

export interface IdentityInvitationAcceptResponse {
  status: "ACCEPTED";
  acceptedAt?: string;
}

export interface StudentPortalInvitationIssueResponse {
  invitationId: string;
  studentId: string;
  tenantSlug: string;
  studentNo: string;
  activationCode: string;
  activationUrl: string;
  expiresAt: string;
}

export interface StudentPortalActivationRequest {
  /** @deprecated Tenant subdomaini kullanılır; yalnız geçiş root akışında gönderilir. */
  tenantSlug?: string;
  studentNo: string;
  code: string;
  password: string;
}

export interface StudentPortalActivationResponse {
  status: "ACCEPTED";
  acceptedAt: string;
  loginName: string;
}

export interface MessageTemplateRecord {
  id: string;
  tenantId: string;
  name: string;
  channel: "SMS";
  body: string;
  deletedAt?: string;
}

export interface MessageTemplateCreateRequest {
  tenantId?: string;
  name: string;
  channel?: "SMS";
  body: string;
}

export interface MessageTemplateUpdateRequest {
  name?: string;
  channel?: "SMS";
  body?: string;
}

export type BackupRestoreOperationType = "BACKUP" | "RESTORE_DRILL";
export type BackupRestoreJobStatus = "queued" | "completed" | "failed";

export interface BackupRestoreJobCreateRequest {
  confirmationText: string;
  operationType: BackupRestoreOperationType;
  reason?: string;
  targetReference: string;
}

export interface BackupRestoreJobRecord {
  id: string;
  tenantId: string;
  requestedByUserId: string;
  operationType: BackupRestoreOperationType;
  targetReference: string;
  reason?: string;
  queueName: "backup-restore";
  jobId: string;
  status: BackupRestoreJobStatus;
  result?: "PASS";
  checkedTables: string[];
  errorCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TenantDataExportPayload {
  formatVersion: "tenant-export-v1";
  tenantId: string;
  generatedByUserId: string;
  exportedAt: string;
  scope: "tenant-user-entered-data";
  rowLimitPerTable: number;
  tables: Record<string, unknown[]>;
  warnings: string[];
}

export interface SmsBatchRecipientInput {
  to: string;
}

export interface SmsBatchCreateRequest {
  templateId: string;
  recipients: SmsBatchRecipientInput[];
}

export interface SmsBatchQueueResult {
  tenantId: string;
  templateId: string;
  recipientCount: number;
  queueName: "sms-batch";
  jobId: string;
  status: "queued";
}

export interface SmsBatchRecipientPreviewRequest {
  announcementId?: string;
  campusId?: string;
  classId?: string;
  courseId?: string;
  gradeLevelId?: string;
  studentStatus?: StudentStatus;
  termId?: string;
}

export interface SmsBatchRecipientPreviewRecord {
  to: string;
  guardianId: string;
  guardianName: string;
  studentIds: string[];
  studentNames: string[];
}

export interface SmsBatchRecipientPreviewResult {
  recipients: SmsBatchRecipientPreviewRecord[];
  recipientCount: number;
}

export interface SmsBatchDeliveryReportRecord {
  id: string;
  tenantId: string;
  jobId: string;
  templateId: string;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  billableSegments: number;
  status: "queued" | "completed" | "failed";
  providerErrorCode?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

export interface AttendanceRecord {
  id: string;
  tenantId: string;
  studentId: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  date: string;
  status: AttendanceStatus;
  deletedAt?: string;
}

export interface AttendanceDailyEntry {
  studentId: string;
  status: AttendanceStatus;
}

export interface AttendanceDailyUpsertRequest {
  classId: string;
  date: string;
  entries: AttendanceDailyEntry[];
}

export interface AttendanceAggregateRecord {
  total: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
}

export interface AttendanceDailyUpsertResponse {
  records: AttendanceRecord[];
  summary: AttendanceAggregateRecord;
}

export interface AttendanceDailyRosterStudent {
  id: string;
  firstName: string;
  lastName: string;
  studentNo?: string;
  classId: string;
}

export interface AttendanceDailyRosterSummary extends AttendanceAggregateRecord {
  unmarked: number;
}

export interface AttendanceDailyRosterResponse {
  classId: string;
  date: string;
  students: AttendanceDailyRosterStudent[];
  records: AttendanceRecord[];
  summary: AttendanceDailyRosterSummary;
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

export interface TeacherNoteCreateRequest {
  studentId: string;
  teacherId?: string;
  courseId?: string;
  termId?: string;
  visibility: TeacherNoteVisibility;
  body: string;
  developmentStatus?: string;
}

export interface TeacherNoteUpdateRequest {
  courseId?: string;
  termId?: string;
  visibility?: TeacherNoteVisibility;
  body?: string;
  developmentStatus?: string;
}

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

export interface DevelopmentCriterionCreateRequest {
  name: string;
  scaleMin?: number;
  scaleMax?: number;
  sortOrder?: number;
}

export interface DevelopmentAssessmentScoreInput {
  criterionId: string;
  score: number;
}

export interface DevelopmentAssessmentCreateRequest {
  studentId: string;
  teacherId?: string;
  termId?: string;
  periodLabel: string;
  mentorNote?: string;
  visibility?: DevelopmentAssessmentVisibility;
  scores: DevelopmentAssessmentScoreInput[];
}

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
export type PaymentTransactionMethod = "CASH" | "BANK_TRANSFER" | "CARD_POS" | "OTHER";

export interface PaymentPlanInstallmentInput {
  installmentNo: number;
  amount: number;
  dueDate: string;
  status?: PaymentInstallmentStatus;
  paidAt?: string;
}

export interface PaymentPlanCreateRequest {
  studentId: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  title: string;
  totalAmount: number;
  currency?: string;
  installments: PaymentPlanInstallmentInput[];
}

export interface PaymentInstallmentUpdateRequest {
  amount?: number;
  dueDate?: string;
  status?: PaymentInstallmentStatus;
  paidAt?: string;
}

export interface PaymentTransactionCreateRequest {
  installmentId?: string;
  amount: number;
  currency?: string;
  method: PaymentTransactionMethod;
  paidAt: string;
  note?: string;
}

export interface PaymentTransactionVoidRequest {
  note?: string;
}

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
  transactions?: PaymentTransactionRecord[];
}

export interface PaymentTransactionRecord {
  id: string;
  tenantId: string;
  planId: string;
  installmentId?: string;
  amount: number;
  currency: string;
  method: PaymentTransactionMethod;
  paidAt: string;
  receiptNo: string;
  note?: string;
  recordedByUserId?: string;
  voidedAt?: string;
  voidReason?: string;
  createdAt: string;
}

export type SupportTicketPriority = "LOW" | "NORMAL" | "HIGH";
export type SupportTicketStatus = "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED";

export interface SupportTicketCreateRequest {
  tenantId?: string;
  studentId?: string;
  campusId?: string;
  gradeLevelId?: string;
  classId?: string;
  courseId?: string;
  termId?: string;
  subject: string;
  message: string;
  priority?: SupportTicketPriority;
}

export type PortalSupportTicketCreateRequest = Omit<SupportTicketCreateRequest, "studentId" | "tenantId">;

export type TeacherPortalSupportTicketCreateRequest = Omit<SupportTicketCreateRequest, "tenantId">;

export interface SupportTicketUpdateRequest {
  priority?: SupportTicketPriority;
  status?: SupportTicketStatus;
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
  priority: SupportTicketPriority;
  status: SupportTicketStatus;
  createdAt: string;
}

export type PublicPortalSupportTicketRecord = Omit<SupportTicketRecord, "requesterId">;

export interface SupportTicketAttachmentCreateRequest {
  fileName: string;
  contentType: UploadContentType;
  fileBase64: string;
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

export interface SupportTicketCommentCreateRequest {
  body: string;
}

export interface SupportTicketCommentRecord {
  id: string;
  tenantId: string;
  ticketId: string;
  authorId?: string;
  body: string;
  createdAt: string;
}

export type PortalSupportTicketCommentAuthor = "REQUESTER" | "INSTITUTION";

export interface PublicPortalSupportTicketCommentRecord {
  id: string;
  ticketId: string;
  author: PortalSupportTicketCommentAuthor;
  body: string;
  createdAt: string;
}

export interface PortalSupportTicketCommentCreateResponse {
  ticket: PublicPortalSupportTicketRecord;
  comment: PublicPortalSupportTicketCommentRecord;
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

export type ExamScoreType = "LGS" | "TYT" | "SAY" | "EA" | "SOZ";
export type ExamScoreStatus = "CALCULATED" | "NOT_ELIGIBLE" | "MISSING_TYT";

export interface ExamScoreMetrics {
  correct: number;
  wrong: number;
  blank: number;
  net: number;
  questionCount: number;
  successRate: number;
}

export interface ExamScoreView {
  type: ExamScoreType;
  status: ExamScoreStatus;
  metrics: ExamScoreMetrics;
  practiceScore?: number;
  profileId: string;
  officialComparable: false;
}

export interface ReportScoringAssumptions {
  standardDeviationUsed: false;
  cancelledQuestionsExcludedFromScoringDenominator: true;
  lgsAvailableSectionWeightsRenormalized: boolean;
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
    schemaVersion?: number;
    examType?: ExamType | string;
    examYear?: number;
    scoringProfileId?: string;
    examTitle?: string;
    examStartsAt?: string;
    scoreAverages?: ExamScoreAverage[];
    officialComparable?: false;
    scoringAssumptions?: ReportScoringAssumptions;
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
    students?: Array<{
      studentId: string;
      displayName?: string;
      studentNo?: string;
      participantNo?: string;
      bookletType?: string;
      classId?: string;
      className?: string;
      resultKey: string;
      scoreViews?: ExamScoreView[];
      scoreRankings?: ExamScoreRanking[];
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
        status: "CORRECT" | "WRONG" | "BLANK" | "CANCELLED";
      }>;
    }>;
  };
  generatedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PortalReportIndexItem {
  examId: string;
  title: string;
  startsAt?: string;
  latestReadySnapshotId: string;
  latestGeneratedAt: string;
}

export interface ReportGenerationJobStatus {
  jobId: string;
  status: "QUEUED" | "RUNNING" | "COMPLETED" | "FAILED";
  snapshotId?: string;
  errorCode?: string;
  updatedAt: string;
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
  topic?: string;
  scoreSection?: AnswerKeyScoreSection;
  evaluationStatus?: "ACTIVE" | "CANCELLED";
  answer: string;
  correctAnswer: string;
  status: "CORRECT" | "WRONG" | "BLANK" | "CANCELLED";
}

export interface ReportScopeRank {
  rank: number;
  outOf: number;
  percentile?: number;
}

export interface ReportRank {
  rank: number;
  outOf: number;
}

export interface ExamScoreRanking {
  type: ExamScoreType;
  institution: ReportRank;
  class?: ReportRank;
}

export interface ExamScoreAverage {
  type: ExamScoreType;
  calculatedCount: number;
  practiceScore: number;
}

export interface ReportStudentBranchStatistics {
  branch: string;
  standardScore?: number;
  general?: ReportScopeRank;
  class?: ReportScopeRank;
  institutionRank?: ReportRank;
  classRank?: ReportRank;
}

export interface ReportStudentStatistics {
  standardScore?: number;
  general?: ReportScopeRank;
  class?: ReportScopeRank;
  institutionRank?: ReportRank;
  classRank?: ReportRank;
  branches?: ReportStudentBranchStatistics[];
}

export interface ReportStudentSnapshot {
  tenantId: string;
  institutionName?: string;
  institutionLogoUrl?: string;
  examId: string;
  examType?: ExamType | string;
  examYear?: number;
  scoringProfileId?: string;
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
  scoreViews?: ExamScoreView[];
  scoreRankings?: ExamScoreRanking[];
  total: ReportStudentScoreSummary;
  branches: ReportStudentBranchSummary[];
  outcomes?: ReportStudentOutcomeSummary[];
  questions?: ReportStudentQuestionSummary[];
  statistics?: ReportStudentStatistics;
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
  successRateDelta?: number;
  netDelta?: number;
  standardScoreDelta?: number;
}

export interface InstitutionDashboardClassSummary {
  classId?: string;
  className?: string;
  resultCount: number;
  successRate?: number;
  net?: number;
  questionCount?: number;
}

export interface InstitutionDashboardReportSummary {
  snapshotId: string;
  generatedAt?: string;
  resultCount: number;
  successRate?: number;
  net?: number;
  questionCount?: number;
  classes: InstitutionDashboardClassSummary[];
}

export interface InstitutionDashboardExamSummary {
  examId: string;
  title: string;
  startsAt?: string;
  registeredParticipantCount: number;
  attendedParticipantCount: number;
  absentParticipantCount: number;
  reportStatus: "READY" | "MISSING";
  report?: InstitutionDashboardReportSummary;
}

export interface InstitutionDashboardSummary {
  generatedAt: string;
  institution: {
    name: string;
    institutionType?: string;
    contactEmail?: string;
    logoUrl?: string;
  };
  activeStudentCount: number;
  attention: {
    attendanceAlertCount: number;
    openImportQuarantineCount: number;
    openSupportTicketCount: number;
  };
  latestExam?: InstitutionDashboardExamSummary;
}

export interface ReportErrorBooklet {
  tenantId: string;
  examId: string;
  snapshotId: string;
  studentId: string;
  items: ReportStudentQuestionSummary[];
  generatedAt?: string;
}

export interface RawImportUploadRequest {
  contentType?: string;
  fileBase64: string;
  fileName: string;
  parserConfigVersion: string;
  sourceType: string;
}

export interface RawImportRecord {
  id: string;
  tenantId: string;
  examId: string;
  sha256: string;
  s3Key: string;
  parserConfigVersion: string;
}

export interface RawImportParseJobRecord {
  jobId: string;
  queueName: string;
}

export interface RawImportUploadResult {
  rawImport: RawImportRecord;
  parseJob: RawImportParseJobRecord;
  status: "uploaded";
}

export interface RawImportQuarantineReasonSummary {
  reason: string;
  count: number;
}

export interface RawImportParseSummary {
  tenantId: string;
  examId: string;
  rawImportId: string;
  matchedCount: number;
  quarantinedCount: number;
  totalRows: number;
  quarantineReasons: RawImportQuarantineReasonSummary[];
}

export interface RawImportEvaluationRequest {
  answerKeyId?: string;
}

export interface RawImportEvaluationJobRecord {
  participantId: string;
  jobId: string;
  status: "queued";
}

export interface RawImportEvaluationQueueResult {
  tenantId: string;
  examId: string;
  rawImportId: string;
  answerKeyId?: string;
  rawImportSha256?: string;
  matchedCount: number;
  queuedCount: number;
  queueName: "exam-evaluation";
  jobs: RawImportEvaluationJobRecord[];
}

export interface RawImportEvaluationStatus {
  tenantId: string;
  examId: string;
  rawImportId: string;
  answerKeyId?: string;
  matchedCount: number;
  evaluatedCount: number;
  pendingCount: number;
  status: "COMPLETED" | "RUNNING";
}

export interface RawImportQuarantineResolveRequest {
  resolvedStudentId: string;
}

export interface RawImportQuarantineResolveBulkItem {
  quarantineId: string;
  resolvedStudentId: string;
}

export interface RawImportQuarantineResolveBulkRequest {
  items: RawImportQuarantineResolveBulkItem[];
}

export interface RawImportQuarantineEvaluationJob {
  tenantId: string;
  examId: string;
  rawImportId: string;
  participantId: string;
  answerKeyId: string;
  queueName: "exam-evaluation";
  jobId: string;
  status: "queued";
}

export interface RawImportQuarantineRecord {
  id: string;
  tenantId: string;
  examId: string;
  rawImportId: string;
  rowNumber: number;
  rawRow: Record<string, unknown>;
  reason: string;
  status: "OPEN" | "RESOLVED" | string;
  resolvedStudentId?: string;
  resolvedParticipantId?: string;
  answerKeyId?: string;
  rawImportSha256?: string;
  evaluationJob?: RawImportQuarantineEvaluationJob;
  createdAt: string;
  updatedAt: string;
}

export interface RawImportQuarantineResolveBulkResult {
  errorCode?: string;
  quarantine?: RawImportQuarantineRecord;
  quarantineId: string;
  status: "RESOLVED" | "FAILED";
}

export interface RawImportQuarantineResolveBulkResponse {
  results: RawImportQuarantineResolveBulkResult[];
}

export interface RawImportQuarantineSummary {
  openCount: number;
}

export interface ParserConfigSuggestionRequest {
  fileBase64?: string;
  preset?: ParserConfigPreset;
  sampleSize?: number;
  sampleText?: string;
}

export interface ParserConfigSuggestionResult {
  examId: string;
  suggestion: ParserConfigSuggestion;
  status: "suggested";
}

export interface ParserConfigApprovalRequest {
  suggestion: ParserConfigSuggestion;
  version: string;
}

export interface ParserConfigRecord {
  tenantId: string;
  examId: string;
  templateId?: string;
  version: string;
  encoding: ParserEncoding;
  delimiter: ParserDelimiter;
  skipHeaderLines: number;
  fieldMapping: ParserConfigSuggestion["fieldMapping"];
  status: "APPROVED";
}

export type ExamStatus = "DRAFT" | "PUBLISHED";
export type ExamType = "SCHOOL" | "LGS" | "TYT" | "AYT" | "KPSS";

export interface ExamAnswerKeySummary {
  status: "MISSING" | "DRAFT" | "PUBLISHED";
  version?: string;
  questionCount?: number;
  branchCount?: number;
  updatedAt?: string;
}

export interface ExamRecord {
  id: string;
  tenantId: string;
  gradeLevelId?: string;
  alanId?: string;
  examType?: ExamType | string;
  examYear?: number;
  scoringProfileId?: string;
  linkedTytExamId?: string;
  title: string;
  status: string;
  answerKeySummary?: ExamAnswerKeySummary;
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

export interface OpticalFormTemplateCreateRequest {
  name: string;
  suggestion: ParserConfigSuggestion;
  version: string;
}

export interface OpticalFormTemplateApplyRequest {
  examId: string;
  version: string;
}

export type AnswerChoice = "A" | "B" | "C" | "D" | "E";
export type AnswerKeyEvaluationStatus = "ACTIVE" | "CANCELLED";
export type AnswerKeyScoreSection =
  | "LGS_TURKCE"
  | "LGS_MATEMATIK"
  | "LGS_FEN"
  | "LGS_INKILAP"
  | "LGS_DIN"
  | "LGS_YABANCI_DIL"
  | "TYT_TURKCE"
  | "TYT_SOSYAL"
  | "TYT_MATEMATIK"
  | "TYT_FEN"
  | "AYT_MATEMATIK"
  | "AYT_FIZIK"
  | "AYT_KIMYA"
  | "AYT_BIYOLOJI"
  | "AYT_EDEBIYAT"
  | "AYT_TARIH_1"
  | "AYT_COGRAFYA_1"
  | "AYT_TARIH_2"
  | "AYT_COGRAFYA_2"
  | "AYT_FELSEFE"
  | "AYT_DIN";

export interface AnswerKeyItemInput {
  questionNo: number;
  correctAnswer: AnswerChoice;
  branch: string;
  scoreSection?: AnswerKeyScoreSection;
  evaluationStatus?: AnswerKeyEvaluationStatus;
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
