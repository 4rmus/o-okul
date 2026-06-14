import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { ScheduleModule } from "../program/schedule.module.js";
import { SchoolModule } from "../school/school.module.js";
import { StudentModule } from "../student/student.module.js";
import { UploadModule } from "../upload/upload.module.js";
import {
  createHomeworkMaterialFileStorageFromEnv,
  homeworkMaterialFileStorageToken,
} from "./homework-material-file-storage.js";
import { HomeworkController } from "./homework.controller.js";
import { createHomeworkStore, homeworkStoreToken } from "./homework-store.js";
import { HomeworkService } from "./homework.service.js";

@Module({
  imports: [AuditLogModule, ScheduleModule, SchoolModule, StudentModule, UploadModule],
  controllers: [HomeworkController],
  providers: [
    {
      provide: homeworkStoreToken,
      useFactory: createHomeworkStore,
    },
    {
      provide: homeworkMaterialFileStorageToken,
      useFactory: createHomeworkMaterialFileStorageFromEnv,
    },
    HomeworkService,
  ],
  exports: [HomeworkService],
})
export class HomeworkModule {}
