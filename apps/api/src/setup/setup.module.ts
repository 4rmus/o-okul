import { Module } from "@nestjs/common";
import { SchoolModule } from "../school/school.module.js";
import { StudentModule } from "../student/student.module.js";
import { TeacherModule } from "../teacher/teacher.module.js";
import { TenantModule } from "../tenant/tenant.module.js";
import { SetupReadinessController } from "./setup-readiness.controller.js";
import { SetupReadinessService } from "./setup-readiness.service.js";

@Module({
  imports: [SchoolModule, StudentModule, TeacherModule, TenantModule],
  controllers: [SetupReadinessController],
  providers: [SetupReadinessService],
})
export class SetupModule {}
