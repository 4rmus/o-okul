import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { SchoolModule } from "../school/school.module.js";
import { StudentModule } from "../student/student.module.js";
import { PrivacyController } from "./privacy.controller.js";

@Module({
  imports: [AuthModule, SchoolModule, StudentModule],
  controllers: [PrivacyController],
})
export class PrivacyModule {}
