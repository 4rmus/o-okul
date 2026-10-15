import { Module } from "@nestjs/common";
import { AuthPersistenceModule } from "../auth/auth-persistence.module.js";
import { GuardianModule } from "../guardian/guardian.module.js";
import { StudentModule } from "../student/student.module.js";
import { TeacherModule } from "../teacher/teacher.module.js";
import { PrivacyController } from "./privacy.controller.js";

@Module({
  imports: [AuthPersistenceModule, GuardianModule, StudentModule, TeacherModule],
  controllers: [PrivacyController],
})
export class PrivacyModule {}
