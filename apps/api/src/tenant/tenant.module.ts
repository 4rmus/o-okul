import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { AuthPersistenceModule } from "../auth/auth-persistence.module.js";
import { UserManagementPersistenceModule } from "../user-management/user-management-persistence.module.js";
import { TenantController } from "./tenant.controller.js";
import { TenantPersistenceModule } from "./tenant-persistence.module.js";
import { TenantService } from "./tenant.service.js";

@Module({
  imports: [AuditLogModule, AuthPersistenceModule, TenantPersistenceModule, UserManagementPersistenceModule],
  controllers: [TenantController],
  providers: [TenantService],
  exports: [TenantService],
})
export class TenantModule {}
