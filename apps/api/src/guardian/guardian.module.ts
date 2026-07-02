import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { IdentityProvisioningModule } from "../identity-provisioning/identity-provisioning.module.js";
import { SchoolModule } from "../school/school.module.js";
import { GuardianImportService } from "./guardian-import.service.js";
import { GuardianService } from "./guardian.service.js";
import { GuardiansController } from "./guardians.controller.js";

@Module({
  imports: [AuditLogModule, IdentityProvisioningModule, SchoolModule],
  controllers: [GuardiansController],
  providers: [GuardianImportService, GuardianService],
  exports: [GuardianImportService, GuardianService],
})
export class GuardianModule {}
