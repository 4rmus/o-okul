import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { AuthPersistenceModule } from "../auth/auth-persistence.module.js";
import { TenantPersistenceModule } from "../tenant/tenant-persistence.module.js";
import { IdentityInvitationModule } from "../identity-invitation/identity-invitation.module.js";
import { EmployeeAccessController, TenantMembershipController, UserManagementController } from "./user-management.controller.js";
import { UserManagementPersistenceModule } from "./user-management-persistence.module.js";
import { UserManagementService } from "./user-management.service.js";

@Module({
  imports: [AuditLogModule, AuthPersistenceModule, IdentityInvitationModule, TenantPersistenceModule, UserManagementPersistenceModule],
  controllers: [UserManagementController, EmployeeAccessController, TenantMembershipController],
  providers: [UserManagementService],
  exports: [UserManagementService],
})
export class UserManagementModule {}
