import { Module } from "@nestjs/common";
import { AnnouncementModule } from "../announcement/announcement.module.js";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { SchoolModule } from "../school/school.module.js";
import { StudentModule } from "../student/student.module.js";
import { AttendanceController } from "./attendance.controller.js";
import { attendanceStoreToken, createAttendanceStore } from "./attendance-store.js";
import { AttendanceService } from "./attendance.service.js";

@Module({
  imports: [AnnouncementModule, AuditLogModule, SchoolModule, StudentModule],
  controllers: [AttendanceController],
  providers: [
    AttendanceService,
    {
      provide: attendanceStoreToken,
      useFactory: createAttendanceStore,
    },
  ],
  exports: [AttendanceService],
})
export class AttendanceModule {}
