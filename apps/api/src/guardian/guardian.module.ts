import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { FeatureRolloutModule } from "../feature-rollout/feature-rollout.module.js";
import { IdentityProvisioningModule } from "../identity-provisioning/identity-provisioning.module.js";
import { SchoolModule } from "../school/school.module.js";
import { GuardianService } from "./guardian.service.js";
import { GuardianWritePolicy } from "./guardian-write-policy.js";
import { GuardiansController } from "./guardians.controller.js";

@Module({
  imports: [AuditLogModule, FeatureRolloutModule, IdentityProvisioningModule, SchoolModule],
  controllers: [GuardiansController],
  providers: [GuardianService, GuardianWritePolicy],
  exports: [GuardianService, GuardianWritePolicy],
})
export class GuardianModule {}
