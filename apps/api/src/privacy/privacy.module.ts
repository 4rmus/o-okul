import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { PrivacyController } from "./privacy.controller.js";

@Module({
  imports: [AuthModule],
  controllers: [PrivacyController],
})
export class PrivacyModule {}
