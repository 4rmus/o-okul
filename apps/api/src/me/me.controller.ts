import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  DevelopmentTrendItem,
  HomeworkMaterialAssignmentRecord,
  GuardianRecord,
  MeProfileResponse,
  ReportErrorBooklet,
  ReportStudentProgress,
  ReportStudentSnapshot,
  ScheduleLessonRecord,
  StudentRecord,
  StudentClassHistoryRecord,
  StudentEnrollmentRecord,
  StudentProfileRecord,
  TeacherRecord,
  AttendanceRecord,
  AttendanceSummaryRecord,
  TeacherNoteRecord,
  PaymentPlanWithInstallmentsRecord,
  AnnouncementRecord,
  SupportTicketRecord,
  GuardianStudentRecord,
  NotificationDeviceTokenRecord,
} from "@uzman-hocam/shared-types";
import { AnnouncementService } from "../announcement/announcement.service.js";
import { AttendanceService } from "../attendance/attendance.service.js";
import { getRequestContext, type RequestContext } from "../context/request-context.js";
import { DevelopmentService } from "../development/development.service.js";
import { HomeworkService } from "../homework/homework.service.js";
import {
  NotificationDeviceService,
  type RegisterNotificationDeviceInput,
} from "../notification-device/notification-device.service.js";
import { PaymentService } from "../payment/payment.service.js";
import { ScheduleService } from "../program/schedule.service.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { ReportGenerationService } from "../report/report-generation.service.js";
import { type GuardianNotificationPreferenceInput, SchoolService } from "../school/school.service.js";
import { StudentService } from "../student/student.service.js";
import { SupportTicketService } from "../support-ticket/support-ticket.service.js";
import { TeacherNoteService } from "../teacher-note/teacher-note.service.js";
import { TenantService, type TenantWriteBody } from "../tenant/tenant.service.js";
import type { TenantRecord } from "../tenant/tenant-store.js";

@Controller("me")
@UseGuards(RolesGuard)
export class MeController {
  constructor(
    private readonly announcements: AnnouncementService,
    private readonly attendance: AttendanceService,
    private readonly development: DevelopmentService,
    private readonly homework: HomeworkService,
    private readonly notificationDevices: NotificationDeviceService,
    private readonly payments: PaymentService,
    private readonly reports: ReportGenerationService,
    private readonly school: SchoolService,
    private readonly schedules: ScheduleService,
    private readonly students: StudentService,
    private readonly supportTickets: SupportTicketService,
    private readonly teacherNotes: TeacherNoteService,
    private readonly tenants: TenantService,
  ) {}

  @Get("profile")
  @Roles("TENANT_ADMIN", "TEACHER", "STUDENT", "GUARDIAN")
  profile(): MeProfileResponse {
    const context = getRequestContext();
    return {
      userId: context.userId,
      tenantId: context.tenantId,
      roles: context.roles,
      subjectType: context.subjectType,
      subjectId: context.subjectId,
    };
  }

  @Get("tenant")
  @Roles("TENANT_ADMIN", "ASSISTANT_ADMIN")
  tenant(): Promise<TenantRecord> {
    return this.tenants.findCurrent(getRequestContext());
  }

  @Patch("tenant")
  @Roles("TENANT_ADMIN", "ASSISTANT_ADMIN")
  updateTenant(@Body() body: TenantWriteBody): Promise<TenantRecord> {
    return this.tenants.updateCurrent(getRequestContext(), body);
  }

  @Get("notification-devices")
  @Roles("TENANT_ADMIN", "TEACHER", "STUDENT", "GUARDIAN")
  notificationDevicesList(): Promise<NotificationDeviceTokenRecord[]> {
    return this.notificationDevices.listCurrentUser(getRequestContext());
  }

  @Post("notification-devices")
  @Roles("TENANT_ADMIN", "TEACHER", "STUDENT", "GUARDIAN")
  registerNotificationDevice(@Body() body: RegisterNotificationDeviceInput): Promise<NotificationDeviceTokenRecord> {
    return this.notificationDevices.registerCurrentUser(getRequestContext(), body);
  }

  @Delete("notification-devices/:id")
  @Roles("TENANT_ADMIN", "TEACHER", "STUDENT", "GUARDIAN")
  disableNotificationDevice(@Param("id") id: string): Promise<NotificationDeviceTokenRecord> {
    return this.notificationDevices.disableCurrentUser(getRequestContext(), id);
  }

  @Get("student")
  @Roles("STUDENT")
  student(): Promise<StudentRecord> {
    return this.students.findCurrentStudent(getRequestContext());
  }

  @Get("student/profile")
  @Roles("STUDENT")
  studentProfile(): Promise<StudentProfileRecord> {
    return this.students.findCurrentStudentProfile(getRequestContext());
  }

  @Get("student/guardians")
  @Roles("STUDENT")
  studentGuardians(): Promise<GuardianRecord[]> {
    return this.school.listCurrentStudentGuardians(getRequestContext());
  }

  @Get("student/guardian-links")
  @Roles("STUDENT")
  studentGuardianLinks(): Promise<GuardianStudentRecord[]> {
    return this.school.listCurrentStudentGuardianLinks(getRequestContext());
  }

  @Get("student/class-history")
  @Roles("STUDENT")
  studentClassHistory(): Promise<StudentClassHistoryRecord[]> {
    const context = getRequestContext();
    assertStudentContext(context);
    return this.students.listClassHistory(context, context.subjectId);
  }

  @Get("student/enrollments")
  @Roles("STUDENT")
  studentEnrollments(): Promise<StudentEnrollmentRecord[]> {
    const context = getRequestContext();
    assertStudentContext(context);
    return this.students.listEnrollments(context, context.subjectId);
  }

  @Get("student/homework/material-assignments")
  @Roles("STUDENT")
  studentHomeworkMaterialAssignments(): Promise<HomeworkMaterialAssignmentRecord[]> {
    return this.homework.listCurrentStudentMaterialAssignments(getRequestContext());
  }

  @Get("student/attendance")
  @Roles("STUDENT")
  studentAttendance(): Promise<AttendanceRecord[]> {
    return this.attendance.listCurrentStudent(getRequestContext());
  }

  @Get("student/attendance/summary")
  @Roles("STUDENT")
  studentAttendanceSummary(): Promise<AttendanceSummaryRecord> {
    return this.attendance.summarizeCurrentStudent(getRequestContext());
  }

  @Get("student/teacher-notes")
  @Roles("STUDENT")
  studentTeacherNotes(): Promise<TeacherNoteRecord[]> {
    return this.teacherNotes.listCurrentStudent(getRequestContext());
  }

  @Get("student/development-assessments")
  @Roles("STUDENT")
  studentDevelopmentAssessments(): Promise<DevelopmentTrendItem[]> {
    return this.development.listCurrentStudent(getRequestContext());
  }

  @Get("student/announcements")
  @Roles("STUDENT")
  studentAnnouncements(): Promise<AnnouncementRecord[]> {
    return this.announcements.listCurrentStudent(getRequestContext());
  }

  @Post("student/announcements/:id/read")
  @Roles("STUDENT")
  markStudentAnnouncementRead(@Param("id") id: string): Promise<AnnouncementRecord> {
    return this.announcements.markCurrentStudentRead(getRequestContext(), id);
  }

  @Get("student/support-tickets")
  @Roles("STUDENT")
  studentSupportTickets(): Promise<SupportTicketRecord[]> {
    return this.supportTickets.listCurrentStudent(getRequestContext());
  }

  @Post("student/support-tickets")
  @Roles("STUDENT")
  createStudentSupportTicket(@Body() body: Partial<SupportTicketRecord>): Promise<SupportTicketRecord> {
    return this.supportTickets.createCurrentStudent(getRequestContext(), body);
  }

  @Get("student/reports/:examId/snapshots/:snapshotId")
  @Roles("STUDENT")
  async studentReport(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
  ): Promise<ReportStudentSnapshot> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reports.getStudentReport(context, examId, snapshotId, student.id);
  }

  @Get("student/reports/:examId/latest")
  @Roles("STUDENT")
  async latestStudentReport(@Param("examId") examId: string): Promise<ReportStudentSnapshot> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reports.getLatestStudentReport(context, examId, student.id);
  }

  @Get("student/reports/:examId/snapshots/:snapshotId/error-booklet")
  @Roles("STUDENT")
  async studentErrorBooklet(
    @Param("examId") examId: string,
    @Param("snapshotId") snapshotId: string,
  ): Promise<ReportErrorBooklet> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reports.getStudentErrorBooklet(context, examId, snapshotId, student.id);
  }

  @Get("student/reports/:examId/latest/error-booklet")
  @Roles("STUDENT")
  async latestStudentErrorBooklet(@Param("examId") examId: string): Promise<ReportErrorBooklet> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reports.getLatestStudentErrorBooklet(context, examId, student.id);
  }

  @Get("student/reports/:examId/progress")
  @Roles("STUDENT")
  async studentProgress(@Param("examId") examId: string, @Query("scope") scope?: string): Promise<ReportStudentProgress> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reports.getStudentProgress(context, examId, student.id, {
      scope: scope === "all" ? "all" : "exam",
    });
  }

  @Get("guardian/students")
  @Roles("GUARDIAN")
  guardianStudents(): Promise<StudentRecord[]> {
    return this.students.listCurrentGuardianStudents(getRequestContext());
  }

  @Get("guardian/students/:studentId/profile")
  @Roles("GUARDIAN")
  guardianStudentProfile(@Param("studentId") studentId: string): Promise<StudentProfileRecord> {
    const context = getRequestContext();
    assertGuardianContext(context);
    return this.students.findProfileForViewer(context, studentId);
  }

  @Get("guardian/students/:studentId/class-history")
  @Roles("GUARDIAN")
  guardianStudentClassHistory(@Param("studentId") studentId: string): Promise<StudentClassHistoryRecord[]> {
    const context = getRequestContext();
    assertGuardianContext(context);
    return this.students.listClassHistory(context, studentId);
  }

  @Get("guardian/students/:studentId/enrollments")
  @Roles("GUARDIAN")
  guardianStudentEnrollments(@Param("studentId") studentId: string): Promise<StudentEnrollmentRecord[]> {
    const context = getRequestContext();
    assertGuardianContext(context);
    return this.students.listEnrollments(context, studentId);
  }

  @Get("guardian/homework/material-assignments")
  @Roles("GUARDIAN")
  guardianHomeworkMaterialAssignments(): Promise<HomeworkMaterialAssignmentRecord[]> {
    return this.homework.listCurrentGuardianMaterialAssignments(getRequestContext());
  }

  @Get("guardian/students/:studentId/attendance")
  @Roles("GUARDIAN")
  guardianStudentAttendance(@Param("studentId") studentId: string): Promise<AttendanceRecord[]> {
    return this.attendance.listCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Get("guardian/students/:studentId/attendance/summary")
  @Roles("GUARDIAN")
  guardianStudentAttendanceSummary(@Param("studentId") studentId: string): Promise<AttendanceSummaryRecord> {
    return this.attendance.summarizeCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Get("guardian/students/:studentId/teacher-notes")
  @Roles("GUARDIAN")
  guardianStudentTeacherNotes(@Param("studentId") studentId: string): Promise<TeacherNoteRecord[]> {
    return this.teacherNotes.listCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Get("guardian/students/:studentId/development-assessments")
  @Roles("GUARDIAN")
  guardianStudentDevelopmentAssessments(@Param("studentId") studentId: string): Promise<DevelopmentTrendItem[]> {
    return this.development.listCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Get("guardian/students/:studentId/announcements")
  @Roles("GUARDIAN")
  guardianStudentAnnouncements(@Param("studentId") studentId: string): Promise<AnnouncementRecord[]> {
    return this.announcements.listCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Post("guardian/students/:studentId/announcements/:id/read")
  @Roles("GUARDIAN")
  markGuardianStudentAnnouncementRead(
    @Param("studentId") studentId: string,
    @Param("id") id: string,
  ): Promise<AnnouncementRecord> {
    return this.announcements.markCurrentGuardianStudentRead(getRequestContext(), studentId, id);
  }

  @Get("guardian/students/:studentId/notification-preferences")
  @Roles("GUARDIAN")
  guardianStudentNotificationPreferences(@Param("studentId") studentId: string): Promise<GuardianStudentRecord> {
    return this.school.findCurrentGuardianNotificationPreferences(getRequestContext(), studentId);
  }

  @Patch("guardian/students/:studentId/notification-preferences")
  @Roles("GUARDIAN")
  updateGuardianStudentNotificationPreferences(
    @Param("studentId") studentId: string,
    @Body() body: GuardianNotificationPreferenceInput,
  ): Promise<GuardianStudentRecord> {
    return this.school.updateCurrentGuardianNotificationPreferences(getRequestContext(), studentId, body);
  }

  @Get("guardian/students/:studentId/payment-plans")
  @Roles("GUARDIAN")
  guardianStudentPaymentPlans(@Param("studentId") studentId: string): Promise<PaymentPlanWithInstallmentsRecord[]> {
    return this.payments.listCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Get("guardian/students/:studentId/support-tickets")
  @Roles("GUARDIAN")
  guardianStudentSupportTickets(@Param("studentId") studentId: string): Promise<SupportTicketRecord[]> {
    return this.supportTickets.listCurrentGuardianStudent(getRequestContext(), studentId);
  }

  @Post("guardian/students/:studentId/support-tickets")
  @Roles("GUARDIAN")
  createGuardianStudentSupportTicket(
    @Param("studentId") studentId: string,
    @Body() body: Partial<SupportTicketRecord>,
  ): Promise<SupportTicketRecord> {
    return this.supportTickets.createCurrentGuardianStudent(getRequestContext(), studentId, body);
  }

  @Get("teacher/support-tickets")
  @Roles("TEACHER")
  teacherSupportTickets(): Promise<SupportTicketRecord[]> {
    return this.supportTickets.listCurrentTeacher(getRequestContext());
  }

  @Post("teacher/support-tickets")
  @Roles("TEACHER")
  createTeacherSupportTicket(@Body() body: Partial<SupportTicketRecord>): Promise<SupportTicketRecord> {
    return this.supportTickets.createCurrentTeacher(getRequestContext(), body);
  }

  @Get("guardian/students/:studentId/reports/:examId/snapshots/:snapshotId")
  @Roles("GUARDIAN")
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
  @Roles("GUARDIAN")
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
  @Roles("GUARDIAN")
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
  @Roles("GUARDIAN")
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
  @Roles("GUARDIAN")
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
  @Roles("TEACHER")
  teacher(): Promise<TeacherRecord> {
    return this.school.findCurrentTeacher(getRequestContext());
  }

  @Get("teacher/schedule")
  @Roles("TEACHER")
  teacherSchedule(): Promise<ScheduleLessonRecord[]> {
    return this.schedules.listCurrentTeacherLessons(getRequestContext());
  }

  @Get("teacher/announcements")
  @Roles("TEACHER")
  teacherAnnouncements(): Promise<AnnouncementRecord[]> {
    return this.announcements.listCurrentTeacher(getRequestContext());
  }

  @Post("teacher/announcements/:id/read")
  @Roles("TEACHER")
  markTeacherAnnouncementRead(@Param("id") id: string): Promise<AnnouncementRecord> {
    return this.announcements.markCurrentTeacherRead(getRequestContext(), id);
  }
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
