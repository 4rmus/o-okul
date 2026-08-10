import { Module } from "@nestjs/common";
import { AttendanceModule } from "../attendance/attendance.module.js";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { FeatureRolloutModule } from "../feature-rollout/feature-rollout.module.js";
import { GuardianModule } from "../guardian/guardian.module.js";
import { HomeworkModule } from "../homework/homework.module.js";
import { ReportModule } from "../report/report.module.js";
import { SchoolModule } from "../school/school.module.js";
import { StudentModule } from "../student/student.module.js";
import { TeacherNoteModule } from "../teacher-note/teacher-note.module.js";
import { TeacherModule } from "../teacher/teacher.module.js";
import { StudentOverviewController } from "./student-overview.controller.js";
import { StudentOverviewService } from "./student-overview.service.js";

@Module({
  imports: [
    AttendanceModule,
    AuditLogModule,
    FeatureRolloutModule,
    GuardianModule,
    HomeworkModule,
    ReportModule,
    SchoolModule,
    StudentModule,
    TeacherModule,
    TeacherNoteModule,
  ],
  controllers: [StudentOverviewController],
  providers: [StudentOverviewService],
})
export class StudentOverviewModule {}
