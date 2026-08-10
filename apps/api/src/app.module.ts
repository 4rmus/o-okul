import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { AuditLogModule } from "./audit-log/audit-log.module.js";
import { AnnouncementModule } from "./announcement/announcement.module.js";
import { AttendanceModule } from "./attendance/attendance.module.js";
import { AuthModule } from "./auth/auth.module.js";
import { RequestContextMiddleware } from "./context/request-context.middleware.js";
import { DevelopmentModule } from "./development/development.module.js";
import { ExamModule } from "./exam/exam.module.js";
import { FeatureRolloutModule } from "./feature-rollout/feature-rollout.module.js";
import { HealthModule } from "./health/health.module.js";
import { HomeworkModule } from "./homework/homework.module.js";
import { IdentityInvitationModule } from "./identity-invitation/identity-invitation.module.js";
import { HttpInfrastructureModule } from "./http/http-infrastructure.module.js";
import { LicensePersistenceModule } from "./license/license-persistence.module.js";
import { MessageTemplateModule } from "./message-template/message-template.module.js";
import { MeModule } from "./me/me.module.js";
import { MetricsMiddleware } from "./metrics/metrics.middleware.js";
import { MetricsModule } from "./metrics/metrics.module.js";
import { NotificationDeviceModule } from "./notification-device/notification-device.module.js";
import { OperationsModule } from "./operations/operations.module.js";
import { PaymentModule } from "./payment/payment.module.js";
import { PrivacyModule } from "./privacy/privacy.module.js";
import { ScheduleModule } from "./program/schedule.module.js";
import { StudySessionModule } from "./program/study-session.module.js";
import { ReportModule } from "./report/report.module.js";
import { RolePreviewModule } from "./role-preview/role-preview.module.js";
import { SchoolModule } from "./school/school.module.js";
import { SecurityHeadersMiddleware } from "./security/security-headers.middleware.js";
import { SearchModule } from "./search/search.module.js";
import { SetupModule } from "./setup/setup.module.js";
import { SmsBatchModule } from "./sms-batch/sms-batch.module.js";
import { StudentModule } from "./student/student.module.js";
import { StudentOverviewModule } from "./student-overview/student-overview.module.js";
import { SupportTicketModule } from "./support-ticket/support-ticket.module.js";
import { TeacherNoteModule } from "./teacher-note/teacher-note.module.js";
import { TenantModule } from "./tenant/tenant.module.js";
import { TenantPersistenceModule } from "./tenant/tenant-persistence.module.js";
import { UploadModule } from "./upload/upload.module.js";
import { UserManagementPersistenceModule } from "./user-management/user-management-persistence.module.js";
import { UserManagementModule } from "./user-management/user-management.module.js";

@Module({
  imports: [
    AuditLogModule,
    AnnouncementModule,
    AuthModule,
    AttendanceModule,
    DevelopmentModule,
    ExamModule,
    FeatureRolloutModule,
    HealthModule,
    HomeworkModule,
    HttpInfrastructureModule,
    IdentityInvitationModule,
    LicensePersistenceModule,
    MeModule,
    MessageTemplateModule,
    MetricsModule,
    NotificationDeviceModule,
    OperationsModule,
    PaymentModule,
    PrivacyModule,
    ReportModule,
    RolePreviewModule,
    ScheduleModule,
    SchoolModule,
    SearchModule,
    SetupModule,
    SmsBatchModule,
    StudentModule,
    StudentOverviewModule,
    StudySessionModule,
    SupportTicketModule,
    TeacherNoteModule,
    TenantModule,
    TenantPersistenceModule,
    UploadModule,
    UserManagementModule,
    UserManagementPersistenceModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(SecurityHeadersMiddleware, RequestContextMiddleware, MetricsMiddleware).forRoutes("{*path}");
  }
}
