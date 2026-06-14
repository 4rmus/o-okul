import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { AuthPersistenceModule } from "../auth/auth-persistence.module.js";
import { TenantPersistenceModule } from "../tenant/tenant-persistence.module.js";
import { UserManagementController } from "./user-management.controller.js";
import { UserManagementPersistenceModule } from "./user-management-persistence.module.js";
import { UserManagementService } from "./user-management.service.js";

@Module({
  imports: [AuditLogModule, AuthPersistenceModule, TenantPersistenceModule, UserManagementPersistenceModule],
  controllers: [UserManagementController],
  providers: [UserManagementService],
  exports: [UserManagementService],
})
export class UserManagementModule {}
