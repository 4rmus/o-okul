import { Body, Controller, Delete, ForbiddenException, Get, Headers, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { z } from "zod";
import type { TeacherTodaySummary } from "@o-okul/shared-types";
import type {
  DevelopmentTrendItem,
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  HomeworkSubmissionRecord,
  StudentHomeworkRecord,
  GuardianRecord,
  GuardianStudentOverview,
  InstitutionDashboardSummary,
  MeProfileResponse,
  MePasswordChangeRequest,
  MePasswordChangeResponse,
  MeSessionRecord,
  MeSessionRevokeAllResponse,
  ReportErrorBooklet,
  ReportStudentProgress,
  ReportStudentSnapshot,
  ReportSnapshotRecord,
  PublicStudentRecord,
  ScheduleLessonRecord,
  StudentRecord,
  StudentEnrollmentRecord,
  StudentProfileRecord,
  TeacherPortalLookupsResponse,
  TeacherRecord,
  AttendanceRecord,
  AttendanceSummaryRecord,
  TeacherNoteRecord,
  PaymentPlanWithInstallmentsRecord,
  PortalReportIndexItem,
  AnnouncementRecord,
  SupportTicketRecord,
  GuardianStudentRecord,
  NotificationDeviceTokenRecord,
  PublicNotificationDeviceTokenRecord,
  PublicPortalSupportTicketRecord,
  PortalSupportTicketCommentCreateResponse,
  PublicPortalSupportTicketCommentRecord,
  SupportTicketCommentRecord,
} from "@o-okul/shared-types";
import { AnnouncementService } from "../announcement/announcement.service.js";
import { AttendanceService } from "../attendance/attendance.service.js";
import { AuthService } from "../auth/auth.service.js";
import { getRequestContext, type RequestContext } from "../context/request-context.js";
import { DevelopmentService } from "../development/development.service.js";
import { HomeworkService } from "../homework/homework.service.js";
import { zodBody } from "../http/zod-validation.js";
import { NotificationDeviceService } from "../notification-device/notification-device.service.js";
import {
  notificationDeviceRegisterBodySchema,
  type NotificationDeviceRegisterBody,
} from "../notification-device/notification-device-validation.js";
import { PaymentService } from "../payment/payment.service.js";
import { ScheduleService } from "../program/schedule.service.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { ReportGenerationService, type ReportSnapshotListFilters } from "../report/report-generation.service.js";
import { GuardianService } from "../guardian/guardian.service.js";
import { toGuardianResponse } from "../guardian/guardian-response.js";
import { SchoolService } from "../school/school.service.js";
import {
  guardianNotificationPreferenceBodySchema,
  type GuardianNotificationPreferenceBody,
} from "../school/school-validation.js";
import { StudentService } from "../student/student.service.js";
import { TeacherService } from "../teacher/teacher.service.js";
import { SupportTicketService } from "../support-ticket/support-ticket.service.js";
import {
  type PortalSupportTicketCreateBody,
  type TeacherPortalSupportTicketCreateBody,
  portalSupportTicketCreateBodySchema,
  supportTicketCommentCreateBodySchema,
  type SupportTicketCommentCreateBody,
  teacherPortalSupportTicketCreateBodySchema,
} from "../support-ticket/support-ticket-validation.js";
import { TeacherNoteService } from "../teacher-note/teacher-note.service.js";
import { TenantService } from "../tenant/tenant.service.js";
import type { TenantRecord } from "../tenant/tenant-store.js";
import { tenantCurrentProfileBodySchema, type TenantCurrentProfileBody } from "../tenant/tenant-validation.js";
import { passwordMaxLength, passwordMinLength, passwordPolicyViolation } from "../auth/password-policy.js";
import { MeGuardianOverviewService } from "./me-guardian-overview.service.js";
import { MeInstitutionDashboardService } from "./me-institution-dashboard.service.js";
import { MeReportIndexService } from "./me-report-index.service.js";
import { MeTeacherTodayService } from "./me-teacher-today.service.js";

const mePasswordChangeBodySchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(passwordMinLength).max(passwordMaxLength).refine((value) => !passwordPolicyViolation(value), {
    message: "PASSWORD_COMMON_REJECTED",
  }),
}).strict() satisfies z.ZodType<MePasswordChangeRequest>;

@Controller("me")
export class MeController {
  constructor(
    private readonly announcements: AnnouncementService,
    private readonly attendance: AttendanceService,
    private readonly auth: AuthService,
    private readonly development: DevelopmentService,
    private readonly homework: HomeworkService,
    private readonly notificationDevices: NotificationDeviceService,
    private readonly payments: PaymentService,
    private readonly guardianOverview: MeGuardianOverviewService,
    private readonly institutionDashboard: MeInstitutionDashboardService,
    private readonly reportIndex: MeReportIndexService,
    private readonly teacherTodaySummary: MeTeacherTodayService,
    private readonly reports: ReportGenerationService,
    private readonly guardians: GuardianService,
    private readonly school: SchoolService,
    private readonly schedules: ScheduleService,
    private readonly students: StudentService,
    private readonly supportTickets: SupportTicketService,
    private readonly teachers: TeacherService,
    private readonly teacherNotes: TeacherNoteService,
    private readonly tenants: TenantService,
  ) {}

  @Get("profile")
  @RequireCapability("account:self")
  profile(): Promise<MeProfileResponse> {
    return this.auth.getCurrentProfile(getRequestContext());
  }

  @Post("password")
  @HttpCode(200)
  @RequireCapability("account:self")
  changePassword(@Body(zodBody(mePasswordChangeBodySchema)) body: MePasswordChangeRequest): Promise<MePasswordChangeResponse> {
    return this.auth.changeCurrentPassword(getRequestContext(), body.currentPassword, body.newPassword);
  }

  @Get("sessions")
  @RequireCapability("account:self")
  sessions(): Promise<MeSessionRecord[]> {
    return this.auth.listCurrentSessions(getRequestContext());
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  @RequireCapability("account:self")
  revokeSession(@Param("id") sessionId: string): Promise<void> {
    return this.auth.revokeCurrentSession(getRequestContext(), sessionId);
  }

  @Delete("sessions")
  @HttpCode(200)
  @RequireCapability("account:self")
  revokeAllSessions(): Promise<MeSessionRevokeAllResponse> {
    return this.auth.revokeAllCurrentSessions(getRequestContext());
  }

  @Get("tenant")
  @RequireCapability("setup:read")
  tenant(): Promise<TenantRecord> {
    return this.tenants.findCurrent(getRequestContext());
  }

  @Get("institution-dashboard")
  @RequireCapability("setup:read")
  institutionDashboardSummary(): Promise<InstitutionDashboardSummary> {
    return this.institutionDashboard.get(getRequestContext());
  }

  @Patch("tenant")
  @RequireCapability("setup:manage")
  updateTenant(
    @Body(zodBody(tenantCurrentProfileBodySchema)) body: TenantCurrentProfileBody,
  ): Promise<TenantRecord> {
    return this.tenants.updateCurrent(getRequestContext(), body);
  }

  @Get("notification-devices")
  @RequireCapability("notification:device")
  async notificationDevicesList(): Promise<PublicNotificationDeviceTokenRecord[]> {
    return (await this.notificationDevices.listCurrentUser(getRequestContext())).map(toPublicNotificationDeviceResponse);
  }

  @Post("notification-devices")
  @RequireCapability("notification:device")
  async registerNotificationDevice(
    @Body(zodBody(notificationDeviceRegisterBodySchema)) body: NotificationDeviceRegisterBody,
  ): Promise<PublicNotificationDeviceTokenRecord> {
    return toPublicNotificationDeviceResponse(await this.notificationDevices.registerCurrentUser(getRequestContext(), body));
  }

  @Delete("notification-devices/:id")
  @RequireCapability("notification:device")
  async disableNotificationDevice(@Param("id") id: string): Promise<PublicNotificationDeviceTokenRecord> {
    return toPublicNotificationDeviceResponse(await this.notificationDevices.disableCurrentUser(getRequestContext(), id));
  }

  @Get("student")
  @RequireCapability("portal:student")
  student(): Promise<StudentRecord> {
    return this.students.findCurrentStudent(getRequestContext());
  }

  @Get("student/profile")
  @RequireCapability("portal:student")
  studentProfile(): Promise<StudentProfileRecord> {
    return this.students.findCurrentStudentProfile(getRequestContext());
  }

  @Get("student/guardians")
  @RequireCapability("portal:student")
  async studentGuardians(): Promise<GuardianRecord[]> {
    const context = getRequestContext();
    return (await this.guardians.listCurrentStudentGuardians(context)).map((record) => toGuardianResponse(record, context));
  }

  @Get("student/guardian-links")
  @RequireCapability("portal:student")
  studentGuardianLinks(): Promise<GuardianStudentRecord[]> {
    return this.guardians.listCurrentStudentGuardianLinks(getRequestContext());
  }

  @Get("student/enrollments")
  @RequireCapability("portal:student")
  studentEnrollments(): Promise<StudentEnrollmentRecord[]> {
    const context = getRequestContext();
    assertStudentContext(context);
    return this.students.listEnrollments(context, context.subjectId);
  }

  @Get("student/homework/material-assignments")
  @RequireCapability("portal:student")
  studentHomeworkMaterialAssignments(): Promise<HomeworkMaterialAssignmentRecord[]> {
    return this.homework.listCurrentStudentMaterialAssignments(getRequestContext());
  }

  @Get("student/homework")
  @RequireCapability("portal:student")
  studentHomework(): Promise<StudentHomeworkRecord[]> {
    return this.homework.listCurrentStudentHomework(getRequestContext());
  }

  @Post("student/homework/:homeworkId/submission")
  @RequireCapability("portal:student")
  submitStudentHomework(
    @Param("homeworkId") homeworkId: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<HomeworkSubmissionRecord> {
    return this.homework.submitCurrentStudentHomework(getRequestContext(), homeworkId, idempotencyKey);
  }

  @Get("student/attendance")
  @RequireCapability("portal:student")
  studentAttendance(): Promise<AttendanceRecord[]> {
    return this.attendance.listCurrentStudent(getRequestContext());
  }

  @Get("student/attendance/summary")
  @RequireCapability("portal:student")
  studentAttendanceSummary(): Promise<AttendanceSummaryRecord> {
    return this.attendance.summarizeCurrentStudent(getRequestContext());
  }

  @Get("student/teacher-notes")
  @RequireCapability("portal:student")
  studentTeacherNotes(): Promise<TeacherNoteRecord[]> {
    return this.teacherNotes.listCurrentStudent(getRequestContext());
  }

  @Get("student/development-assessments")
  @RequireCapability("portal:student")
  studentDevelopmentAssessments(): Promise<DevelopmentTrendItem[]> {
    return this.development.listCurrentStudent(getRequestContext());
  }

  @Get("student/announcements")
  @RequireCapability("portal:student")
  studentAnnouncements(): Promise<AnnouncementRecord[]> {
    return this.announcements.listCurrentStudent(getRequestContext());
  }

  @Post("student/announcements/:id/read")
  @RequireCapability("portal:student")
  markStudentAnnouncementRead(@Param("id") id: string): Promise<AnnouncementRecord> {
    return this.announcements.markCurrentStudentRead(getRequestContext(), id);
  }

  @Get("student/support-tickets")
  @RequireCapability("portal:student")
  async studentSupportTickets(): Promise<PublicPortalSupportTicketRecord[]> {
    return (await this.supportTickets.listCurrentStudent(getRequestContext())).map(toPublicPortalSupportTicketResponse);
  }

  @Post("student/support-tickets")
  @RequireCapability("portal:student")
  async createStudentSupportTicket(
    @Body(zodBody(portalSupportTicketCreateBodySchema)) body: PortalSupportTicketCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PublicPortalSupportTicketRecord> {
    return toPublicPortalSupportTicketResponse(await this.supportTickets.createCurrentStudent(getRequestContext(), body, idempotencyKey));
  }

  @Get("student/support-tickets/:ticketId/comments")
  @RequireCapability("portal:student")
  async studentSupportTicketComments(@Param("ticketId") ticketId: string): Promise<PublicPortalSupportTicketCommentRecord[]> {
    const result = await this.supportTickets.listCurrentStudentComments(getRequestContext(), ticketId);
    return result.comments.map((comment) => toPublicPortalSupportTicketCommentResponse(comment, result.ticket));
  }

  @Post("student/support-tickets/:ticketId/comments")
  @RequireCapability("portal:student")
  async addStudentSupportTicketComment(
    @Param("ticketId") ticketId: string,
    @Body(zodBody(supportTicketCommentCreateBodySchema)) body: SupportTicketCommentCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PortalSupportTicketCommentCreateResponse> {
    return toPublicPortalSupportTicketCommentCreateResponse(
      await this.supportTickets.addCurrentStudentComment(getRequestContext(), ticketId, body, idempotencyKey),
    );
  }

  @Get("student/reports")
  @RequireCapability("portal:student")
  async studentReportIndex(): Promise<PortalReportIndexItem[]> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reportIndex.listForStudent(context, student.id);
  }

  @Get("student/reports/:examId/snapshots/:snapshotId")
  @RequireCapability("portal:student")
  async studentReport(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
  ): Promise<ReportStudentSnapshot> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reports.getStudentReport(context, examId, snapshotId, student.id);
  }

  @Get("student/reports/:examId/latest")
  @RequireCapability("portal:student")
  async latestStudentReport(@Param("examId") examId: string): Promise<ReportStudentSnapshot> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reports.getLatestStudentReport(context, examId, student.id);
  }

  @Get("student/reports/:examId/snapshots/:snapshotId/error-booklet")
  @RequireCapability("portal:student")
  async studentErrorBooklet(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
  ): Promise<ReportErrorBooklet> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reports.getStudentErrorBooklet(context, examId, snapshotId, student.id);
  }

  @Get("student/reports/:examId/latest/error-booklet")
  @RequireCapability("portal:student")
  async latestStudentErrorBooklet(@Param("examId") examId: string): Promise<ReportErrorBooklet> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reports.getLatestStudentErrorBooklet(context, examId, student.id);
  }

  @Get("student/reports/:examId/progress")
  @RequireCapability("portal:student")
  async studentProgress(@Param("examId") examId: string, @Query("scope") scope?: string): Promise<ReportStudentProgress> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reports.getStudentProgress(context, examId, student.id, {
      scope: scope === "all" ? "all" : "exam",
    });
  }

  @Get("guardian/students")
  @RequireCapability("portal:guardian")
  guardianStudents(): Promise<StudentRecord[]> {
    return this.students.listCurrentGuardianStudents(getRequestContext());
  }

  /** KV-4: one allow-list read model for a linked student; ward:read is the guardian scope capability. */
  @Get("guardian/students/:studentId/overview")
  @RequireCapability("ward:read")
  guardianStudentOverview(@Param("studentId") studentId: string): Promise<GuardianStudentOverview> {
    const context = getRequestContext();
    assertGuardianContext(context);
    return this.guardianOverview.get(context, studentId);
  }

  @Get("guardian/students/:studentId/profile")
  @RequireCapability("portal:guardian")
  guardianStudentProfile(@Param("studentId") studentId: string): Promise<StudentProfileRecord> {
    const context = getRequestContext();
    assertGuardianContext(context);
    return this.students.findProfileForViewer(context, studentId);
  }

  @Get("guardian/students/:studentId/enrollments")
  @RequireCapability("portal:guardian")
  guardianStudentEnrollments(@Param("studentId") studentId: string): Promise<StudentEnrollmentRecord[]> {
    const context = getRequestContext();
    assertGuardianContext(context);
    return this.students.listEnrollments(context, studentId);
  }

  @Get("guardian/homework/material-assignments")
  @RequireCapability("portal:guardian")
  guardianHomeworkMaterialAssignments(): Promise<HomeworkMaterialAssignmentRecord[]> {
    return this.homework.listCurrentGuardianMaterialAssignments(getRequestContext());
  }

  @Get("guardian/students/:studentId/homework/material-assignments")
  @RequireCapability("portal:guardian")
  guardianStudentHomeworkMaterialAssignments(@Param("studentId") studentId: string): Promise<HomeworkMaterialAssignmentRecord[]> {
    const context = getRequestContext();
    assertGuardianContext(context);
    return this.homework.listCurrentGuardianStudentMaterialAssignments(context, studentId);
  }

  @Get("guardian/students/:studentId/attendance")
  @RequireCapability("portal:guardian")
  guardianStudentAttendance(@Param("studentId") studentId: string): Promise<AttendanceRecord[]> {
    return this.attendance.listCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Get("guardian/students/:studentId/attendance/summary")
  @RequireCapability("portal:guardian")
  guardianStudentAttendanceSummary(@Param("studentId") studentId: string): Promise<AttendanceSummaryRecord> {
    return this.attendance.summarizeCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Get("guardian/students/:studentId/teacher-notes")
  @RequireCapability("portal:guardian")
  guardianStudentTeacherNotes(@Param("studentId") studentId: string): Promise<TeacherNoteRecord[]> {
    return this.teacherNotes.listCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Get("guardian/students/:studentId/development-assessments")
  @RequireCapability("portal:guardian")
  guardianStudentDevelopmentAssessments(@Param("studentId") studentId: string): Promise<DevelopmentTrendItem[]> {
    return this.development.listCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Get("guardian/students/:studentId/announcements")
  @RequireCapability("portal:guardian")
  guardianStudentAnnouncements(@Param("studentId") studentId: string): Promise<AnnouncementRecord[]> {
    return this.announcements.listCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Post("guardian/students/:studentId/announcements/:id/read")
  @RequireCapability("portal:guardian")
  markGuardianStudentAnnouncementRead(
    @Param("studentId") studentId: string,
    @Param("id") id: string,
  ): Promise<AnnouncementRecord> {
    return this.announcements.markCurrentGuardianStudentRead(getRequestContext(), studentId, id);
  }

  @Get("guardian/students/:studentId/notification-preferences")
  @RequireCapability("portal:guardian")
  guardianStudentNotificationPreferences(@Param("studentId") studentId: string): Promise<GuardianStudentRecord> {
    return this.guardians.findCurrentGuardianNotificationPreferences(getRequestContext(), studentId);
  }

  @Patch("guardian/students/:studentId/notification-preferences")
  @RequireCapability("portal:guardian")
  updateGuardianStudentNotificationPreferences(
    @Param("studentId") studentId: string,
    @Body(zodBody(guardianNotificationPreferenceBodySchema)) body: GuardianNotificationPreferenceBody,
  ): Promise<GuardianStudentRecord> {
    return this.guardians.updateCurrentGuardianNotificationPreferences(getRequestContext(), studentId, body);
  }

  @Get("guardian/students/:studentId/payment-plans")
  @RequireCapability("portal:guardian")
  guardianStudentPaymentPlans(@Param("studentId") studentId: string): Promise<PaymentPlanWithInstallmentsRecord[]> {
    return this.payments.listCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Get("guardian/students/:studentId/support-tickets")
  @RequireCapability("portal:guardian")
  async guardianStudentSupportTickets(@Param("studentId") studentId: string): Promise<PublicPortalSupportTicketRecord[]> {
    return (await this.supportTickets.listCurrentGuardianStudent(getRequestContext(), studentId)).map(toPublicPortalSupportTicketResponse);
  }

  @Post("guardian/students/:studentId/support-tickets")
  @RequireCapability("portal:guardian")
  async createGuardianStudentSupportTicket(
    @Param("studentId") studentId: string,
    @Body(zodBody(portalSupportTicketCreateBodySchema)) body: PortalSupportTicketCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PublicPortalSupportTicketRecord> {
    return toPublicPortalSupportTicketResponse(await this.supportTickets.createCurrentGuardianStudent(getRequestContext(), studentId, body, idempotencyKey));
  }

  @Get("teacher/support-tickets")
  @RequireCapability("portal:teacher")
  async teacherSupportTickets(): Promise<PublicPortalSupportTicketRecord[]> {
    return (await this.supportTickets.listCurrentTeacher(getRequestContext())).map(toPublicPortalSupportTicketResponse);
  }

  @Post("teacher/support-tickets")
  @RequireCapability("portal:teacher")
  async createTeacherSupportTicket(
    @Body(zodBody(teacherPortalSupportTicketCreateBodySchema)) body: TeacherPortalSupportTicketCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PublicPortalSupportTicketRecord> {
    return toPublicPortalSupportTicketResponse(await this.supportTickets.createCurrentTeacher(getRequestContext(), body, idempotencyKey));
  }

  @Get("teacher/support-tickets/:ticketId/comments")
  @RequireCapability("portal:teacher")
  async teacherSupportTicketComments(@Param("ticketId") ticketId: string): Promise<PublicPortalSupportTicketCommentRecord[]> {
    const result = await this.supportTickets.listCurrentTeacherComments(getRequestContext(), ticketId);
    return result.comments.map((comment) => toPublicPortalSupportTicketCommentResponse(comment, result.ticket));
  }

  @Post("teacher/support-tickets/:ticketId/comments")
  @RequireCapability("portal:teacher")
  async addTeacherSupportTicketComment(
    @Param("ticketId") ticketId: string,
    @Body(zodBody(supportTicketCommentCreateBodySchema)) body: SupportTicketCommentCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<PortalSupportTicketCommentCreateResponse> {
    return toPublicPortalSupportTicketCommentCreateResponse(
      await this.supportTickets.addCurrentTeacherComment(getRequestContext(), ticketId, body, idempotencyKey),
    );
  }

  @Get("teacher/students")
  @RequireCapability("portal:teacher")
  teacherStudents(): Promise<PublicStudentRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.students.listForViewer(context);
  }

  @Get("teacher/students/:studentId/enrollments")
  @RequireCapability("portal:teacher")
  teacherStudentEnrollments(@Param("studentId") studentId: string): Promise<StudentEnrollmentRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.students.listEnrollments(context, studentId);
  }

  @Get("teacher/attendance")
  @RequireCapability("portal:teacher")
  teacherAttendance(): Promise<AttendanceRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.attendance.list(context);
  }

  @Get("teacher/homework")
  @RequireCapability("portal:teacher")
  teacherHomework(): Promise<HomeworkRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.homework.list(context);
  }

  @Get("teacher/homework/materials")
  @RequireCapability("portal:teacher")
  teacherHomeworkMaterials(): Promise<HomeworkMaterialRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.homework.listMaterials(context);
  }

  @Get("teacher/homework/materials/:id/assignments")
  @RequireCapability("portal:teacher")
  teacherHomeworkMaterialAssignments(@Param("id") id: string): Promise<HomeworkMaterialAssignmentRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.homework.listMaterialAssignments(context, id);
  }

  @Get("teacher/homework/material-assignments")
  @RequireCapability("portal:teacher")
  teacherHomeworkAllMaterialAssignments(): Promise<HomeworkMaterialAssignmentRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.homework.listCurrentTeacherMaterialAssignments(context);
  }

  @Get("teacher/teacher-notes")
  @RequireCapability("portal:teacher")
  teacherTeacherNotes(): Promise<TeacherNoteRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.teacherNotes.list(context);
  }

  @Get("teacher/lookups")
  @RequireCapability("portal:teacher")
  async teacherLookups(): Promise<TeacherPortalLookupsResponse> {
    const context = getRequestContext();
    assertTeacherContext(context);

    const today = new Date().toISOString().slice(0, 10);
    const [teacherAssignments, visibleStudents] = await Promise.all([
      this.teachers.listTeacherAssignments(context, context.subjectId),
      this.students.listForViewer(context),
    ]);
    const assignments = teacherAssignments.filter((assignment) =>
      (!assignment.startsAt || assignment.startsAt <= today) &&
      (!assignment.endsAt || assignment.endsAt >= today),
    );

    const classIds = new Set<string>();
    const attendanceClassIds = new Set<string>();
    const campusIds = new Set<string>();
    const courseIds = new Set<string>();
    const gradeLevelIds = new Set<string>();
    const termIds = new Set<string>();

    for (const assignment of assignments) {
      addOptionalId(classIds, assignment.classId);
      addOptionalId(attendanceClassIds, assignment.classId);
      addOptionalId(courseIds, assignment.courseId);
      addOptionalId(termIds, assignment.termId);
    }
    for (const student of visibleStudents) addOptionalId(classIds, student.classId);

    const classes = filterByIds(await this.school.listClasses(context), classIds);
    for (const record of classes) {
      addOptionalId(campusIds, record.campusId);
      addOptionalId(gradeLevelIds, record.gradeLevelId);
    }

    const [campuses, courses, gradeLevels, terms] = await Promise.all([
      this.school.listCampuses(context),
      this.school.listCourses(context),
      this.school.listGradeLevels(context),
      this.school.listAcademicTerms(context),
    ]);
    const allCoursesAllowed = assignments.some((assignment) => assignment.classId && !assignment.courseId);
    const allTermsAllowed = assignments.some((assignment) =>
      (assignment.classId || assignment.studentId || assignment.courseId) && !assignment.termId,
    );

    return {
      attendanceClassIds: classes.filter((record) => attendanceClassIds.has(record.id)).map((record) => record.id),
      campuses: filterByIds(campuses, campusIds),
      classes,
      courses: allCoursesAllowed ? courses : filterByIds(courses, courseIds),
      gradeLevels: filterByIds(gradeLevels, gradeLevelIds),
      terms: allTermsAllowed ? terms : filterByIds(terms, termIds),
    };
  }

  @Get("teacher/reports/:examId/snapshots")
  @RequireCapability("portal:teacher")
  teacherReportSnapshots(
    @Param("examId") examId: string,
    @Query() query: ReportSnapshotListFilters,
  ): Promise<ReportSnapshotRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.reports.listSnapshots(context, examId, query);
  }

  @Get("teacher/reports")
  @RequireCapability("portal:teacher")
  teacherReportIndex(): Promise<PortalReportIndexItem[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.reportIndex.listForTeacher(context);
  }

  @Get("teacher/reports/:examId/snapshots/:snapshotId/students/:studentId")
  @RequireCapability("portal:teacher")
  teacherStudentReport(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
    @Param("studentId") studentId: string,
  ): Promise<ReportStudentSnapshot> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.reports.getStudentReport(context, examId, snapshotId, studentId);
  }

  @Get("teacher/reports/:examId/snapshots/:snapshotId/students/:studentId/error-booklet")
  @RequireCapability("portal:teacher")
  teacherStudentErrorBooklet(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
    @Param("studentId") studentId: string,
  ): Promise<ReportErrorBooklet> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.reports.getStudentErrorBooklet(context, examId, snapshotId, studentId);
  }

  @Get("teacher/reports/:examId/students/:studentId/progress")
  @RequireCapability("portal:teacher")
  teacherStudentProgress(
    @Param("examId") examId: string,
    @Param("studentId") studentId: string,
    @Query("scope") scope?: string,
  ): Promise<ReportStudentProgress> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.reports.getStudentProgress(context, examId, studentId, {
      scope: scope === "all" ? "all" : "exam",
    });
  }

  @Get("guardian/students/:studentId/reports")
  @RequireCapability("portal:guardian")
  async guardianStudentReportIndex(@Param("studentId") studentId: string): Promise<PortalReportIndexItem[]> {
    const context = getRequestContext();
    assertGuardianContext(context);
    const student = await this.students.findOneForViewer(context, studentId);
    return this.reportIndex.listForStudent(context, student.id);
  }

  @Get("guardian/students/:studentId/reports/:examId/snapshots/:snapshotId")
  @RequireCapability("portal:guardian")
  async guardianStudentReport(
    @Param("studentId") studentId: string,
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
  ): Promise<ReportStudentSnapshot> {
    const context = getRequestContext();
    assertGuardianContext(context);
    const student = await this.students.findOneForViewer(context, studentId);
    return this.reports.getStudentReport(context, examId, snapshotId, student.id);
  }

  @Get("guardian/students/:studentId/reports/:examId/latest")
  @RequireCapability("portal:guardian")
  async latestGuardianStudentReport(
    @Param("studentId") studentId: string,
    @Param("examId") examId: string,
  ): Promise<ReportStudentSnapshot> {
    const context = getRequestContext();
    assertGuardianContext(context);
    const student = await this.students.findOneForViewer(context, studentId);
    return this.reports.getLatestStudentReport(context, examId, student.id);
  }

  @Get("guardian/students/:studentId/reports/:examId/snapshots/:snapshotId/error-booklet")
  @RequireCapability("portal:guardian")
  async guardianStudentErrorBooklet(
    @Param("studentId") studentId: string,
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
  ): Promise<ReportErrorBooklet> {
    const context = getRequestContext();
    assertGuardianContext(context);
    const student = await this.students.findOneForViewer(context, studentId);
    return this.reports.getStudentErrorBooklet(context, examId, snapshotId, student.id);
  }

  @Get("guardian/students/:studentId/reports/:examId/latest/error-booklet")
  @RequireCapability("portal:guardian")
  async latestGuardianStudentErrorBooklet(
    @Param("studentId") studentId: string,
    @Param("examId") examId: string,
  ): Promise<ReportErrorBooklet> {
    const context = getRequestContext();
    assertGuardianContext(context);
    const student = await this.students.findOneForViewer(context, studentId);
    return this.reports.getLatestStudentErrorBooklet(context, examId, student.id);
  }

  @Get("guardian/students/:studentId/reports/:examId/progress")
  @RequireCapability("portal:guardian")
  async guardianStudentProgress(
    @Param("studentId") studentId: string,
    @Param("examId") examId: string,
    @Query("scope") scope?: string,
  ): Promise<ReportStudentProgress> {
    const context = getRequestContext();
    assertGuardianContext(context);
    const student = await this.students.findOneForViewer(context, studentId);
    return this.reports.getStudentProgress(context, examId, student.id, {
      scope: scope === "all" ? "all" : "exam",
    });
  }

  @Get("teacher")
  @RequireCapability("portal:teacher")
  async teacher(): Promise<TeacherRecord> {
    return toPublicTeacherResponse(await this.teachers.findCurrentTeacher(getRequestContext()));
  }

  @Get("teacher/today")
  @RequireCapability("portal:teacher")
  teacherToday(): Promise<TeacherTodaySummary> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.teacherTodaySummary.get(context);
  }

  @Get("teacher/schedule")
  @RequireCapability("portal:teacher")
  teacherSchedule(): Promise<ScheduleLessonRecord[]> {
    return this.schedules.listCurrentTeacherLessons(getRequestContext());
  }

  @Get("teacher/announcements")
  @RequireCapability("portal:teacher")
  teacherAnnouncements(): Promise<AnnouncementRecord[]> {
    return this.announcements.listCurrentTeacher(getRequestContext());
  }

  @Post("teacher/announcements/:id/read")
  @RequireCapability("portal:teacher")
  markTeacherAnnouncementRead(@Param("id") id: string): Promise<AnnouncementRecord> {
    return this.announcements.markCurrentTeacherRead(getRequestContext(), id);
  }
}

function toPublicTeacherResponse(record: TeacherRecord): TeacherRecord {
  const response = { ...record };
  delete response.userId;
  return response;
}

function toPublicNotificationDeviceResponse(record: NotificationDeviceTokenRecord): PublicNotificationDeviceTokenRecord {
  const { token: _token, userId: _userId, ...response } = record;
  return response;
}

function toPublicPortalSupportTicketResponse(record: SupportTicketRecord): PublicPortalSupportTicketRecord {
  const { requesterId: _requesterId, ...response } = record;
  return response;
}

function toPublicPortalSupportTicketCommentResponse(
  comment: SupportTicketCommentRecord,
  ticket: SupportTicketRecord,
): PublicPortalSupportTicketCommentRecord {
  return {
    id: comment.id,
    ticketId: comment.ticketId,
    author: comment.authorId === ticket.requesterId ? "REQUESTER" : "INSTITUTION",
    body: comment.body,
    createdAt: comment.createdAt,
  };
}

function toPublicPortalSupportTicketCommentCreateResponse(
  result: Awaited<ReturnType<SupportTicketService["addCurrentStudentComment"]>>,
): PortalSupportTicketCommentCreateResponse {
  return {
    ticket: toPublicPortalSupportTicketResponse(result.ticket),
    comment: toPublicPortalSupportTicketCommentResponse(result.comment, result.ticket),
  };
}

function assertGuardianContext(context: RequestContext): void {
  if (context.subjectType !== "GUARDIAN" || !context.subjectId) {
    throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
  }
}

function assertStudentContext(context: RequestContext): asserts context is RequestContext & { subjectType: "STUDENT"; subjectId: string } {
  if (context.subjectType !== "STUDENT" || !context.subjectId) {
    throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
  }
}

function assertTeacherContext(context: RequestContext): asserts context is RequestContext & { subjectType: "TEACHER"; subjectId: string } {
  if (context.subjectType !== "TEACHER" || !context.subjectId) {
    throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
  }
}

function addOptionalId(target: Set<string>, value: string | undefined): void {
  if (value) target.add(value);
}

function filterByIds<TRecord extends { id: string }>(records: TRecord[], ids: ReadonlySet<string>): TRecord[] {
  return records.filter((record) => ids.has(record.id));
}
