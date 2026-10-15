import { Module } from "@nestjs/common";
import { AccountPiiModule } from "../account-pii/account-pii.module.js";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { IdentityProvisioningModule } from "../identity-provisioning/identity-provisioning.module.js";
import { SchoolModule } from "../school/school.module.js";
import { TeacherImportService } from "./teacher-import.service.js";
import { TeacherService } from "./teacher.service.js";
import { TeachersController } from "./teachers.controller.js";

@Module({
  imports: [AccountPiiModule, AuditLogModule, IdentityProvisioningModule, SchoolModule],
  controllers: [TeachersController],
  providers: [TeacherService, TeacherImportService],
  exports: [TeacherService, TeacherImportService],
})
export class TeacherModule {}
