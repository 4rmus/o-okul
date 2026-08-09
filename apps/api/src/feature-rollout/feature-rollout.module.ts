import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { FeatureRolloutController } from "./feature-rollout.controller.js";
import { FeatureRolloutService } from "./feature-rollout.service.js";

@Module({
  imports: [AuditLogModule],
  controllers: [FeatureRolloutController],
  providers: [FeatureRolloutService],
  exports: [FeatureRolloutService],
})
export class FeatureRolloutModule {}
