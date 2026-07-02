import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { TeacherModule } from "../teacher/teacher.module.js";
import { SchoolModule } from "../school/school.module.js";
import { ScheduleController } from "./schedule.controller.js";
import { createScheduleStore, scheduleStoreToken } from "./schedule-store.js";
import { ScheduleService } from "./schedule.service.js";

@Module({
  imports: [AuditLogModule, SchoolModule, TeacherModule],
  controllers: [ScheduleController],
  providers: [
    ScheduleService,
    {
      provide: scheduleStoreToken,
      useFactory: createScheduleStore,
    },
  ],
  exports: [ScheduleService, scheduleStoreToken],
})
export class ScheduleModule {}
