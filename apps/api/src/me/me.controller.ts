import { Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import type {
  DevelopmentTrendItem,
  HomeworkMaterialAssignmentRecord,
  HomeworkMaterialRecord,
  HomeworkRecord,
  GuardianRecord,
  MeProfileResponse,
  ReportErrorBooklet,
  ReportStudentProgress,
  ReportStudentSnapshot,
  ReportSnapshotRecord,
  PublicStudentRecord,
  ScheduleLessonRecord,
  StudentRecord,
  StudentClassHistoryRecord,
  StudentEnrollmentRecord,
  StudentProfileRecord,
  TeacherPortalLookupsResponse,
  TeacherRecord,
  AttendanceRecord,
  AttendanceSummaryRecord,
  TeacherNoteRecord,
  PaymentPlanWithInstallmentsRecord,
  AnnouncementRecord,
  SupportTicketRecord,
  GuardianStudentRecord,
  NotificationDeviceTokenRecord,
  PublicNotificationDeviceTokenRecord,
  PublicPortalSupportTicketRecord,
} from "@uzman-hocam/shared-types";
import { AnnouncementService } from "../announcement/announcement.service.js";
import { AttendanceService } from "../attendance/attendance.service.js";
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
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { ReportGenerationService, type ReportSnapshotListFilters } from "../report/report-generation.service.js";
import { SchoolService } from "../school/school.service.js";
import {
  guardianNotificationPreferenceBodySchema,
  type GuardianNotificationPreferenceBody,
} from "../school/school-validation.js";
import { StudentService } from "../student/student.service.js";
import { SupportTicketService } from "../support-ticket/support-ticket.service.js";
import {
  type PortalSupportTicketCreateBody,
  type TeacherPortalSupportTicketCreateBody,
  portalSupportTicketCreateBodySchema,
  teacherPortalSupportTicketCreateBodySchema,
} from "../support-ticket/support-ticket-validation.js";
import { TeacherNoteService } from "../teacher-note/teacher-note.service.js";
import { TenantService } from "../tenant/tenant.service.js";
import type { TenantRecord } from "../tenant/tenant-store.js";
import { tenantCurrentProfileBodySchema, type TenantCurrentProfileBody } from "../tenant/tenant-validation.js";

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
  @RequireCapability("operation:manage")
  updateTenant(
    @Body(zodBody(tenantCurrentProfileBodySchema)) body: TenantCurrentProfileBody,
  ): Promise<TenantRecord> {
    return this.tenants.updateCurrent(getRequestContext(), body);
  }

  @Get("notification-devices")
  @Roles("TENANT_ADMIN", "TEACHER", "STUDENT", "GUARDIAN")
  async notificationDevicesList(): Promise<PublicNotificationDeviceTokenRecord[]> {
    return (await this.notificationDevices.listCurrentUser(getRequestContext())).map(toPublicNotificationDeviceResponse);
  }

  @Post("notification-devices")
  @Roles("TENANT_ADMIN", "TEACHER", "STUDENT", "GUARDIAN")
  async registerNotificationDevice(
    @Body(zodBody(notificationDeviceRegisterBodySchema)) body: NotificationDeviceRegisterBody,
  ): Promise<PublicNotificationDeviceTokenRecord> {
    return toPublicNotificationDeviceResponse(await this.notificationDevices.registerCurrentUser(getRequestContext(), body));
  }

  @Delete("notification-devices/:id")
  @Roles("TENANT_ADMIN", "TEACHER", "STUDENT", "GUARDIAN")
  async disableNotificationDevice(@Param("id") id: string): Promise<PublicNotificationDeviceTokenRecord> {
    return toPublicNotificationDeviceResponse(await this.notificationDevices.disableCurrentUser(getRequestContext(), id));
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
  async studentSupportTickets(): Promise<PublicPortalSupportTicketRecord[]> {
    return (await this.supportTickets.listCurrentStudent(getRequestContext())).map(toPublicPortalSupportTicketResponse);
  }

  @Post("student/support-tickets")
  @Roles("STUDENT")
  async createStudentSupportTicket(
    @Body(zodBody(portalSupportTicketCreateBodySchema)) body: PortalSupportTicketCreateBody,
  ): Promise<PublicPortalSupportTicketRecord> {
    return toPublicPortalSupportTicketResponse(await this.supportTickets.createCurrentStudent(getRequestContext(), body));
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

  @Get("guardian/students/:studentId/homework/material-assignments")
  @Roles("GUARDIAN")
  guardianStudentHomeworkMaterialAssignments(@Param("studentId") studentId: string): Promise<HomeworkMaterialAssignmentRecord[]> {
    const context = getRequestContext();
    assertGuardianContext(context);
    return this.homework.listCurrentGuardianStudentMaterialAssignments(context, studentId);
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
    @Body(zodBody(guardianNotificationPreferenceBodySchema)) body: GuardianNotificationPreferenceBody,
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
  async guardianStudentSupportTickets(@Param("studentId") studentId: string): Promise<PublicPortalSupportTicketRecord[]> {
    return (await this.supportTickets.listCurrentGuardianStudent(getRequestContext(), studentId)).map(toPublicPortalSupportTicketResponse);
  }

  @Post("guardian/students/:studentId/support-tickets")
  @Roles("GUARDIAN")
  async createGuardianStudentSupportTicket(
    @Param("studentId") studentId: string,
    @Body(zodBody(portalSupportTicketCreateBodySchema)) body: PortalSupportTicketCreateBody,
  ): Promise<PublicPortalSupportTicketRecord> {
    return toPublicPortalSupportTicketResponse(await this.supportTickets.createCurrentGuardianStudent(getRequestContext(), studentId, body));
  }

  @Get("teacher/support-tickets")
  @Roles("TEACHER")
  async teacherSupportTickets(): Promise<PublicPortalSupportTicketRecord[]> {
    return (await this.supportTickets.listCurrentTeacher(getRequestContext())).map(toPublicPortalSupportTicketResponse);
  }

  @Post("teacher/support-tickets")
  @Roles("TEACHER")
  async createTeacherSupportTicket(
    @Body(zodBody(teacherPortalSupportTicketCreateBodySchema)) body: TeacherPortalSupportTicketCreateBody,
  ): Promise<PublicPortalSupportTicketRecord> {
    return toPublicPortalSupportTicketResponse(await this.supportTickets.createCurrentTeacher(getRequestContext(), body));
  }

  @Get("teacher/students")
  @Roles("TEACHER")
  teacherStudents(): Promise<PublicStudentRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.students.listForViewer(context);
  }

  @Get("teacher/attendance")
  @Roles("TEACHER")
  teacherAttendance(): Promise<AttendanceRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.attendance.list(context);
  }

  @Get("teacher/homework")
  @Roles("TEACHER")
  teacherHomework(): Promise<HomeworkRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.homework.list(context);
  }

  @Get("teacher/homework/materials")
  @Roles("TEACHER")
  teacherHomeworkMaterials(): Promise<HomeworkMaterialRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.homework.listMaterials(context);
  }

  @Get("teacher/homework/materials/:id/assignments")
  @Roles("TEACHER")
  teacherHomeworkMaterialAssignments(@Param("id") id: string): Promise<HomeworkMaterialAssignmentRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.homework.listMaterialAssignments(context, id);
  }

  @Get("teacher/teacher-notes")
  @Roles("TEACHER")
  teacherTeacherNotes(): Promise<TeacherNoteRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.teacherNotes.list(context);
  }

  @Get("teacher/lookups")
  @Roles("TEACHER")
  async teacherLookups(): Promise<TeacherPortalLookupsResponse> {
    const context = getRequestContext();
    assertTeacherContext(context);

    const [schedule, students, attendance, homework, materials, teacherNotes, supportTickets] = await Promise.all([
      this.schedules.listCurrentTeacherLessons(context),
      this.students.list(context),
      this.attendance.list(context),
      this.homework.list(context),
      this.homework.listMaterials(context),
      this.teacherNotes.list(context),
      this.supportTickets.listCurrentTeacher(context),
    ]);
    const materialAssignments = (
      await Promise.all(materials.map((material) => this.homework.listMaterialAssignments(context, material.id)))
    ).flat();

    const classIds = new Set<string>();
    const campusIds = new Set<string>();
    const courseIds = new Set<string>();
    const gradeLevelIds = new Set<string>();
    const termIds = new Set<string>();

    for (const student of students) addOptionalId(classIds, student.classId);
    for (const lesson of schedule) {
      addOptionalId(classIds, lesson.classId);
      addOptionalId(courseIds, lesson.courseId);
      addOptionalId(termIds, lesson.termId);
    }
    for (const record of attendance) {
      addOptionalId(courseIds, record.courseId);
      addOptionalId(termIds, record.termId);
    }
    for (const record of homework) addOptionalId(classIds, record.classId);
    for (const record of materialAssignments) {
      addOptionalId(courseIds, record.courseId);
      addOptionalId(termIds, record.termId);
    }
    for (const record of teacherNotes) {
      addOptionalId(courseIds, record.courseId);
      addOptionalId(termIds, record.termId);
    }
    for (const record of supportTickets) {
      addOptionalId(campusIds, record.campusId);
      addOptionalId(classIds, record.classId);
      addOptionalId(courseIds, record.courseId);
      addOptionalId(gradeLevelIds, record.gradeLevelId);
      addOptionalId(termIds, record.termId);
    }

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

    return {
      campuses: filterByIds(campuses, campusIds),
      classes,
      courses: filterByIds(courses, courseIds),
      gradeLevels: filterByIds(gradeLevels, gradeLevelIds),
      terms: filterByIds(terms, termIds),
    };
  }

  @Get("teacher/reports/:examId/snapshots")
  @Roles("TEACHER")
  teacherReportSnapshots(
    @Param("examId") examId: string,
    @Query() query: ReportSnapshotListFilters,
  ): Promise<ReportSnapshotRecord[]> {
    const context = getRequestContext();
    assertTeacherContext(context);
    return this.reports.listSnapshots(context, examId, query);
  }

  @Get("teacher/reports/:examId/snapshots/:snapshotId/students/:studentId")
  @Roles("TEACHER")
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
  @Roles("TEACHER")
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
  @Roles("TEACHER")
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
  async teacher(): Promise<TeacherRecord> {
    return toPublicTeacherResponse(await this.school.findCurrentTeacher(getRequestContext()));
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
