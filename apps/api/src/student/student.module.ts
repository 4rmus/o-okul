import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { GuardianModule } from "../guardian/guardian.module.js";
import { IdentityInvitationModule } from "../identity-invitation/identity-invitation.module.js";
import { IdentityProvisioningModule } from "../identity-provisioning/identity-provisioning.module.js";
import { SchoolModule } from "../school/school.module.js";
import { TeacherModule } from "../teacher/teacher.module.js";
import { StudentController } from "./student.controller.js";
import { createStudentEnrollmentStore, studentEnrollmentStoreToken } from "./student-enrollment-store.js";
import { StudentImportService } from "./student-import.service.js";
import { StudentService } from "./student.service.js";

@Module({
  imports: [AuditLogModule, GuardianModule, IdentityInvitationModule, IdentityProvisioningModule, SchoolModule, TeacherModule],
  controllers: [StudentController],
  providers: [
    StudentImportService,
    {
      provide: studentEnrollmentStoreToken,
      useFactory: createStudentEnrollmentStore,
    },
    StudentService,
  ],
  exports: [StudentService],
})
export class StudentModule {}
