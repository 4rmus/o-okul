import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { IdentityInvitationModule } from "../identity-invitation/identity-invitation.module.js";
import { SchoolModule } from "../school/school.module.js";
import { createStudentClassHistoryStore, studentClassHistoryStoreToken } from "./student-class-history-store.js";
import { StudentController } from "./student.controller.js";
import { createStudentEnrollmentStore, studentEnrollmentStoreToken } from "./student-enrollment-store.js";
import { StudentImportService } from "./student-import.service.js";
import { StudentService } from "./student.service.js";

@Module({
  imports: [AuditLogModule, IdentityInvitationModule, SchoolModule],
  controllers: [StudentController],
  providers: [
    StudentImportService,
    {
      provide: studentClassHistoryStoreToken,
      useFactory: createStudentClassHistoryStore,
    },
    {
      provide: studentEnrollmentStoreToken,
      useFactory: createStudentEnrollmentStore,
    },
    StudentService,
  ],
  exports: [StudentService],
})
export class StudentModule {}
