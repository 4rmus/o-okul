import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuditLogController } from "./audit-log/audit-log.controller.js";
import { auditLogStoreToken, createAuditLogStore } from "./audit-log/audit-log-store.js";
import { AuditLogService } from "./audit-log/audit-log.service.js";
import { AttendanceController } from "./attendance/attendance.controller.js";
import { attendanceStoreToken, createAttendanceStore } from "./attendance/attendance-store.js";
import { AttendanceService } from "./attendance/attendance.service.js";
import { AnnouncementController } from "./announcement/announcement.controller.js";
import {
  announcementDeliveryReportStoreToken,
  createAnnouncementDeliveryReportStore,
} from "./announcement/announcement-delivery-report-store.js";
import { announcementReceiptStoreToken, createAnnouncementReceiptStore } from "./announcement/announcement-receipt-store.js";
import { announcementStoreToken, createAnnouncementStore } from "./announcement/announcement-store.js";
import {
  AnnouncementService,
  announcementDeliveryQueueProducerToken,
  notificationAdapterToken,
} from "./announcement/announcement.service.js";
import { createNotificationAdapterFromEnv } from "@uzman-hocam/notification-adapter";
import { AuthController } from "./auth/auth.controller.js";
import { authUserStoreToken, createAuthUserStore } from "./auth/auth-user-store.js";
import { AuthService } from "./auth/auth.service.js";
import { IdentityResolver } from "./auth/identity-resolver.js";
import { createPasswordResetStore, passwordResetStoreToken } from "./auth/password-reset-store.js";
import { authSessionStoreToken, createSessionStore } from "./auth/session-store.js";
import { RequestContextMiddleware } from "./context/request-context.middleware.js";
import { DevelopmentController } from "./development/development.controller.js";
import { createDevelopmentStore, developmentStoreToken } from "./development/development-store.js";
import { DevelopmentService } from "./development/development.service.js";
import { AnswerKeyController } from "./exam/answer-key.controller.js";
import { AnswerKeyExcelImportService } from "./exam/answer-key-excel-import.service.js";
import { AnswerKeyService, answerKeyRepositoryToken } from "./exam/answer-key.service.js";
import { ExamController } from "./exam/exam.controller.js";
import { ExamService, examParticipantRepositoryToken, examRepositoryToken } from "./exam/exam.service.js";
import { PostgresAnswerKeyRepository } from "./exam/postgres-answer-key-repository.js";
import { PostgresExamParticipantRepository } from "./exam/postgres-exam-participant-repository.js";
import { PostgresExamRepository } from "./exam/postgres-exam-repository.js";
import { ParserConfigController } from "./exam/parser-config.controller.js";
import { ParserConfigApprovalService, parserConfigRepositoryToken } from "./exam/parser-config-approval.service.js";
import { ParserConfigSuggestionService } from "./exam/parser-config-suggestion.service.js";
import { PostgresParserConfigRepository } from "./exam/postgres-parser-config-repository.js";
import { RawImportController } from "./exam/raw-import.controller.js";
import {
  createRawImportQuarantineStore,
  rawImportQuarantineStoreToken,
} from "./exam/raw-import-quarantine-store.js";
import { RawImportQuarantineService } from "./exam/raw-import-quarantine.service.js";
import { PostgresRawImportRepository } from "./exam/postgres-raw-import-repository.js";
import { RawImportQueueService, rawImportQueueProducerToken } from "./exam/raw-import-queue.service.js";
import {
  rawImportArchiveStoreToken,
  rawImportRepositoryToken,
  RawImportUploadService,
} from "./exam/raw-import-upload.service.js";
import { createS3RawImportArchiveStoreFromEnv } from "./exam/s3-raw-import-archive-store.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import { HomeworkController } from "./homework/homework.controller.js";
import { createHomeworkStore, homeworkStoreToken } from "./homework/homework-store.js";
import { HomeworkService } from "./homework/homework.service.js";
import { IdentityInvitationController } from "./identity-invitation/identity-invitation.controller.js";
import {
  createIdentityInvitationStore,
  identityInvitationStoreToken,
} from "./identity-invitation/identity-invitation-store.js";
import { IdentityInvitationService } from "./identity-invitation/identity-invitation.service.js";
import { ApiErrorFilter } from "./http/api-error.filter.js";
import { MessageTemplateController } from "./message-template/message-template.controller.js";
import { createMessageTemplateStore, messageTemplateStoreToken } from "./message-template/message-template-store.js";
import { MessageTemplateService } from "./message-template/message-template.service.js";
import { MeController } from "./me/me.controller.js";
import { MetricsController } from "./metrics/metrics.controller.js";
import { MetricsMiddleware } from "./metrics/metrics.middleware.js";
import { MetricsService } from "./metrics/metrics.service.js";
import {
  createNotificationDeviceTokenStore,
  notificationDeviceTokenStoreToken,
} from "./notification-device/notification-device-store.js";
import { NotificationDeviceService } from "./notification-device/notification-device.service.js";
import { PaymentController } from "./payment/payment.controller.js";
import { createPaymentPlanStore, paymentPlanStoreToken } from "./payment/payment-store.js";
import { PaymentService } from "./payment/payment.service.js";
import { PrivacyController } from "./privacy/privacy.controller.js";
import { ScheduleController } from "./program/schedule.controller.js";
import { createScheduleStore, scheduleStoreToken } from "./program/schedule-store.js";
import { ScheduleService } from "./program/schedule.service.js";
import { StudySessionController } from "./program/study-session.controller.js";
import { createStudySessionStore, studySessionStoreToken } from "./program/study-session-store.js";
import { StudySessionService } from "./program/study-session.service.js";
import { createBullTenantQueueProducer } from "./queue/bullmq-producer.js";
import { CapabilityGuard } from "./rbac/capability.guard.js";
import { RolesGuard } from "./rbac/roles.guard.js";
import { ReportGenerationController } from "./report/report-generation.controller.js";
import {
  createReportPdfRenderer,
  ReportGenerationService,
  reportGenerationQueueProducerToken,
  reportPdfRendererToken,
} from "./report/report-generation.service.js";
import { createReportSnapshotStore, reportSnapshotStoreToken } from "./report/report-snapshot-store.js";
import { AcademicCalendarController } from "./school/academic-calendar.controller.js";
import { academicCalendarStoreToken, createAcademicCalendarStore } from "./school/academic-calendar-store.js";
import { campusStoreToken, createCampusStore } from "./school/campus-store.js";
import { CampusesController } from "./school/campuses.controller.js";
import { classStoreToken, createClassStore } from "./school/class-store.js";
import { ClassesController } from "./school/classes.controller.js";
import { courseStoreToken, createCourseStore } from "./school/course-store.js";
import { CoursesController } from "./school/courses.controller.js";
import { createGuardianStudentStore, guardianStudentStoreToken } from "./school/guardian-student-store.js";
import { createGuardianStore, guardianStoreToken } from "./school/guardian-store.js";
import { GuardiansController } from "./school/guardians.controller.js";
import { gradeLevelStoreToken, createGradeLevelStore } from "./school/grade-level-store.js";
import { GradeLevelsController } from "./school/grade-levels.controller.js";
import { SchoolService } from "./school/school.service.js";
import { createTeacherAssignmentStore, teacherAssignmentStoreToken } from "./school/teacher-assignment-store.js";
import { createTeacherStore, teacherStoreToken } from "./school/teacher-store.js";
import { TeachersController } from "./school/teachers.controller.js";
import { SecurityHeadersMiddleware } from "./security/security-headers.middleware.js";
import {
  createSmsBatchDeliveryReportStore,
  smsBatchDeliveryReportStoreToken,
} from "./sms-batch/sms-batch-delivery-report-store.js";
import { SmsBatchController } from "./sms-batch/sms-batch.controller.js";
import { SmsBatchService, smsBatchQueueProducerToken } from "./sms-batch/sms-batch.service.js";
import { StudentController } from "./student/student.controller.js";
import { createStudentClassHistoryStore, studentClassHistoryStoreToken } from "./student/student-class-history-store.js";
import { createStudentEnrollmentStore, studentEnrollmentStoreToken } from "./student/student-enrollment-store.js";
import { StudentImportService } from "./student/student-import.service.js";
import { createStudentStore, studentStoreToken } from "./student/student-store.js";
import { StudentService } from "./student/student.service.js";
import { SupportTicketController } from "./support-ticket/support-ticket.controller.js";
import {
  createSupportTicketAttachmentStorageFromEnv,
  supportTicketAttachmentStorageToken,
} from "./support-ticket/support-ticket-attachment-storage.js";
import { createSupportTicketStore, supportTicketStoreToken } from "./support-ticket/support-ticket-store.js";
import { SupportTicketService } from "./support-ticket/support-ticket.service.js";
import { TeacherNoteController } from "./teacher-note/teacher-note.controller.js";
import { createTeacherNoteStore, teacherNoteStoreToken } from "./teacher-note/teacher-note-store.js";
import { TeacherNoteService } from "./teacher-note/teacher-note.service.js";
import { TenantController } from "./tenant/tenant.controller.js";
import { TenantService } from "./tenant/tenant.service.js";
import { createTenantStore, tenantStoreToken } from "./tenant/tenant-store.js";
import { UserManagementController } from "./user-management/user-management.controller.js";
import { createUserManagementStore, userManagementStoreToken } from "./user-management/user-management-store.js";
import { UserManagementService } from "./user-management/user-management.service.js";

@Module({
  controllers: [
    AuditLogController,
    AcademicCalendarController,
    AnnouncementController,
    AnswerKeyController,
    AttendanceController,
    AuthController,
    CampusesController,
    ClassesController,
    CoursesController,
    DevelopmentController,
    GradeLevelsController,
    GuardiansController,
    HealthController,
    HomeworkController,
    IdentityInvitationController,
    MeController,
    MessageTemplateController,
    MetricsController,
    ExamController,
    ParserConfigController,
    PaymentController,
    PrivacyController,
    RawImportController,
    ReportGenerationController,
    ScheduleController,
    SmsBatchController,
    StudySessionController,
    StudentController,
    SupportTicketController,
    TeachersController,
    TeacherNoteController,
    TenantController,
    UserManagementController,
  ],
  providers: [
    AuditLogService,
    AttendanceService,
    {
      provide: auditLogStoreToken,
      useFactory: createAuditLogStore,
    },
    {
      provide: attendanceStoreToken,
      useFactory: createAttendanceStore,
    },
    AnnouncementService,
    {
      provide: announcementStoreToken,
      useFactory: createAnnouncementStore,
    },
    {
      provide: announcementReceiptStoreToken,
      useFactory: createAnnouncementReceiptStore,
    },
    {
      provide: announcementDeliveryReportStoreToken,
      useFactory: createAnnouncementDeliveryReportStore,
    },
    {
      provide: announcementDeliveryQueueProducerToken,
      useFactory: createBullTenantQueueProducer,
    },
    {
      provide: notificationAdapterToken,
      useFactory: () => createNotificationAdapterFromEnv(process.env),
    },
    AuthService,
    DevelopmentService,
    {
      provide: authUserStoreToken,
      useFactory: createAuthUserStore,
    },
    {
      provide: authSessionStoreToken,
      useFactory: createSessionStore,
    },
    {
      provide: passwordResetStoreToken,
      useFactory: createPasswordResetStore,
    },
    IdentityResolver,
    AnswerKeyService,
    AnswerKeyExcelImportService,
    {
      provide: answerKeyRepositoryToken,
      useFactory: () => new PostgresAnswerKeyRepository(),
    },
    {
      provide: academicCalendarStoreToken,
      useFactory: createAcademicCalendarStore,
    },
    {
      provide: campusStoreToken,
      useFactory: createCampusStore,
    },
    {
      provide: classStoreToken,
      useFactory: createClassStore,
    },
    {
      provide: courseStoreToken,
      useFactory: createCourseStore,
    },
    {
      provide: developmentStoreToken,
      useFactory: createDevelopmentStore,
    },
    {
      provide: guardianStoreToken,
      useFactory: createGuardianStore,
    },
    {
      provide: guardianStudentStoreToken,
      useFactory: createGuardianStudentStore,
    },
    {
      provide: gradeLevelStoreToken,
      useFactory: createGradeLevelStore,
    },
    {
      provide: teacherStoreToken,
      useFactory: createTeacherStore,
    },
    {
      provide: teacherAssignmentStoreToken,
      useFactory: createTeacherAssignmentStore,
    },
    HealthService,
    {
      provide: homeworkStoreToken,
      useFactory: createHomeworkStore,
    },
    HomeworkService,
    IdentityInvitationService,
    {
      provide: identityInvitationStoreToken,
      useFactory: createIdentityInvitationStore,
    },
    MessageTemplateService,
    MetricsService,
    NotificationDeviceService,
    PaymentService,
    {
      provide: messageTemplateStoreToken,
      useFactory: createMessageTemplateStore,
    },
    {
      provide: notificationDeviceTokenStoreToken,
      useFactory: createNotificationDeviceTokenStore,
    },
    {
      provide: paymentPlanStoreToken,
      useFactory: createPaymentPlanStore,
    },
    ExamService,
    {
      provide: examRepositoryToken,
      useFactory: () => new PostgresExamRepository(),
    },
    {
      provide: examParticipantRepositoryToken,
      useFactory: () => new PostgresExamParticipantRepository(),
    },
    ParserConfigApprovalService,
    ParserConfigSuggestionService,
    {
      provide: parserConfigRepositoryToken,
      useFactory: () => new PostgresParserConfigRepository(),
    },
    RawImportQueueService,
    RawImportQuarantineService,
    RawImportUploadService,
    {
      provide: rawImportArchiveStoreToken,
      useFactory: () => ({
        put(input: Parameters<ReturnType<typeof createS3RawImportArchiveStoreFromEnv>["put"]>[0]) {
          return createS3RawImportArchiveStoreFromEnv().put(input);
        },
      }),
    },
    {
      provide: rawImportRepositoryToken,
      useFactory: () => new PostgresRawImportRepository(),
    },
    {
      provide: rawImportQuarantineStoreToken,
      useFactory: createRawImportQuarantineStore,
    },
    {
      provide: rawImportQueueProducerToken,
      useFactory: createBullTenantQueueProducer,
    },
    ReportGenerationService,
    {
      provide: reportSnapshotStoreToken,
      useFactory: createReportSnapshotStore,
    },
    {
      provide: reportGenerationQueueProducerToken,
      useFactory: createBullTenantQueueProducer,
    },
    {
      provide: reportPdfRendererToken,
      useFactory: createReportPdfRenderer,
    },
    {
      provide: scheduleStoreToken,
      useFactory: createScheduleStore,
    },
    ScheduleService,
    SchoolService,
    SmsBatchService,
    {
      provide: smsBatchDeliveryReportStoreToken,
      useFactory: createSmsBatchDeliveryReportStore,
    },
    {
      provide: smsBatchQueueProducerToken,
      useFactory: createBullTenantQueueProducer,
    },
    {
      provide: studySessionStoreToken,
      useFactory: createStudySessionStore,
    },
    StudySessionService,
    StudentImportService,
    {
      provide: studentStoreToken,
      useFactory: createStudentStore,
    },
    {
      provide: studentClassHistoryStoreToken,
      useFactory: createStudentClassHistoryStore,
    },
    {
      provide: studentEnrollmentStoreToken,
      useFactory: createStudentEnrollmentStore,
    },
    StudentService,
    SupportTicketService,
    TeacherNoteService,
    TenantService,
    UserManagementService,
    {
      provide: teacherNoteStoreToken,
      useFactory: createTeacherNoteStore,
    },
    {
      provide: tenantStoreToken,
      useFactory: createTenantStore,
    },
    {
      provide: userManagementStoreToken,
      useFactory: createUserManagementStore,
    },
    {
      provide: supportTicketAttachmentStorageToken,
      useFactory: createSupportTicketAttachmentStorageFromEnv,
    },
    {
      provide: supportTicketStoreToken,
      useFactory: createSupportTicketStore,
    },
    {
      provide: APP_FILTER,
      useClass: ApiErrorFilter,
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
    {
      provide: APP_GUARD,
      useClass: CapabilityGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityHeadersMiddleware, RequestContextMiddleware, MetricsMiddleware).forRoutes("{*path}");
  }
}
