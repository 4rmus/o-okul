import { Controller, ForbiddenException, Get, Param, UseGuards } from "@nestjs/common";
import type {
  HomeworkMaterialAssignmentRecord,
  MeProfileResponse,
  ReportErrorBooklet,
  ReportStudentProgress,
  ReportStudentSnapshot,
  ScheduleLessonRecord,
  StudentRecord,
  StudentProfileRecord,
  TeacherRecord,
  AttendanceRecord,
  AttendanceSummaryRecord,
  TeacherNoteRecord,
  PaymentPlanWithInstallmentsRecord,
} from "@uzman-hocam/shared-types";
import { AttendanceService } from "../attendance/attendance.service.js";
import { getRequestContext, type RequestContext } from "../context/request-context.js";
import { HomeworkService } from "../homework/homework.service.js";
import { PaymentService } from "../payment/payment.service.js";
import { ScheduleService } from "../program/schedule.service.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { ReportGenerationService } from "../report/report-generation.service.js";
import { SchoolService } from "../school/school.service.js";
import { StudentService } from "../student/student.service.js";
import { TeacherNoteService } from "../teacher-note/teacher-note.service.js";

@Controller("me")
@UseGuards(RolesGuard)
export class MeController {
  constructor(
    private readonly attendance: AttendanceService,
    private readonly homework: HomeworkService,
    private readonly payments: PaymentService,
    private readonly reports: ReportGenerationService,
    private readonly school: SchoolService,
    private readonly schedules: ScheduleService,
    private readonly students: StudentService,
    private readonly teacherNotes: TeacherNoteService,
  ) {}

  @Get("profile")
  @Roles("GUARDIAN")
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
  async studentProgress(@Param("examId") examId: string): Promise<ReportStudentProgress> {
    const context = getRequestContext();
    const student = await this.students.findCurrentStudent(context);
    return this.reports.getStudentProgress(context, examId, student.id);
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

  @Get("guardian/students/:studentId/payment-plans")
  @Roles("GUARDIAN")
  guardianStudentPaymentPlans(@Param("studentId") studentId: string): Promise<PaymentPlanWithInstallmentsRecord[]> {
    return this.payments.listCurrentGuardianStudent(getRequestContext(), studentId);
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
  ): Promise<ReportStudentProgress> {
    const context = getRequestContext();
    assertGuardianContext(context);
    const student = await this.students.findOneForViewer(context, studentId);
    return this.reports.getStudentProgress(context, examId, student.id);
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
}

function assertGuardianContext(context: RequestContext): void {
  if (context.subjectType !== "GUARDIAN" || !context.subjectId) {
    throw new ForbiddenException("SUBJECT_CONTEXT_MISSING");
  }
}
