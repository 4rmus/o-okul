import { Module } from "@nestjs/common";
import { AuthPersistenceModule } from "../auth/auth-persistence.module.js";
import { IdentityProvisioningService } from "./identity-provisioning.service.js";

@Module({
  imports: [AuthPersistenceModule],
  providers: [IdentityProvisioningService],
  exports: [IdentityProvisioningService],
})
export class IdentityProvisioningModule {}
