import { Module } from "@nestjs/common";
import { AnnouncementModule } from "../announcement/announcement.module.js";
import { AttendanceModule } from "../attendance/attendance.module.js";
import { AuthModule } from "../auth/auth.module.js";
import { DevelopmentModule } from "../development/development.module.js";
import { ExamPersistenceModule } from "../exam/exam-persistence.module.js";
import { GuardianModule } from "../guardian/guardian.module.js";
import { HomeworkModule } from "../homework/homework.module.js";
import { NotificationDeviceModule } from "../notification-device/notification-device.module.js";
import { PaymentModule } from "../payment/payment.module.js";
import { ScheduleModule } from "../program/schedule.module.js";
import { ReportModule } from "../report/report.module.js";
import { SchoolModule } from "../school/school.module.js";
import { StudentModule } from "../student/student.module.js";
import { SupportTicketModule } from "../support-ticket/support-ticket.module.js";
import { TeacherModule } from "../teacher/teacher.module.js";
import { TeacherNoteModule } from "../teacher-note/teacher-note.module.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { MeController } from "./me.controller.js";
import { MeInstitutionDashboardService } from "./me-institution-dashboard.service.js";
import {
  createInstitutionDashboardStore,
  institutionDashboardStoreToken,
} from "./me-institution-dashboard.store.js";
import { MeReportIndexService } from "./me-report-index.service.js";
import { MeSetupReadinessService } from "./me-setup-readiness.service.js";
import { MeStudentDailyBriefService } from "./me-student-daily-brief.service.js";
import { MeTeacherDailyBriefService } from "./me-teacher-daily-brief.service.js";

@Module({
  imports: [
    AnnouncementModule,
    AttendanceModule,
    AuthModule,
    DevelopmentModule,
    ExamPersistenceModule,
    GuardianModule,
    HomeworkModule,
    NotificationDeviceModule,
    PaymentModule,
    ReportModule,
    ScheduleModule,
    SchoolModule,
    StudentModule,
    SupportTicketModule,
    TeacherModule,
    TeacherNoteModule,
    TenantModule,
  ],
  controllers: [MeController],
  providers: [
    MeInstitutionDashboardService,
    MeReportIndexService,
    MeSetupReadinessService,
    MeStudentDailyBriefService,
    MeTeacherDailyBriefService,
    {
      provide: institutionDashboardStoreToken,
      useFactory: createInstitutionDashboardStore,
    },
  ],
})
export class MeModule {}
