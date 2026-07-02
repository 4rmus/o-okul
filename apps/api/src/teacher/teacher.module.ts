import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { IdentityProvisioningModule } from "../identity-provisioning/identity-provisioning.module.js";
import { SchoolModule } from "../school/school.module.js";
import { TeacherImportService } from "./teacher-import.service.js";
import { TeacherService } from "./teacher.service.js";
import { TeachersController } from "./teachers.controller.js";

@Module({
  imports: [AuditLogModule, IdentityProvisioningModule, SchoolModule],
  controllers: [TeachersController],
  providers: [TeacherService, TeacherImportService],
  exports: [TeacherService, TeacherImportService],
})
export class TeacherModule {}
