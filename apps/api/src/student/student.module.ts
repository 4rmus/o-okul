import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { GuardianModule } from "../guardian/guardian.module.js";
import { IdentityInvitationModule } from "../identity-invitation/identity-invitation.module.js";
import { IdentityProvisioningModule } from "../identity-provisioning/identity-provisioning.module.js";
import { LicensePersistenceModule } from "../license/license-persistence.module.js";
import { ReportModule } from "../report/report.module.js";
import { SchoolModule } from "../school/school.module.js";
import { TeacherModule } from "../teacher/teacher.module.js";
import { UserManagementPersistenceModule } from "../user-management/user-management-persistence.module.js";
import { StudentController } from "./student.controller.js";
import { StudentContactController } from "./student-contact.controller.js";
import { createStudentContactStore, studentContactStoreToken } from "./student-contact-store.js";
import { StudentContactService } from "./student-contact.service.js";
import { StudentGuardianInvitationService } from "./student-guardian-invitation.service.js";
import { StudentImportService } from "./student-import.service.js";
import { StudentPersistenceModule } from "./student-persistence.module.js";
import { StudentService } from "./student.service.js";

@Module({
  imports: [AuditLogModule, GuardianModule, IdentityInvitationModule, IdentityProvisioningModule, LicensePersistenceModule, ReportModule, SchoolModule, StudentPersistenceModule, TeacherModule, UserManagementPersistenceModule],
  controllers: [StudentController, StudentContactController],
  providers: [
    StudentImportService,
    StudentContactService,
    StudentGuardianInvitationService,
    {
      provide: studentContactStoreToken,
      useFactory: createStudentContactStore,
    },
    StudentService,
  ],
  exports: [StudentContactService, StudentPersistenceModule, StudentService],
})
export class StudentModule {}
