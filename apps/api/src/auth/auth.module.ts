import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { SchoolModule } from "../school/school.module.js";
import { TenantPersistenceModule } from "../tenant/tenant-persistence.module.js";
import { AuthController } from "./auth.controller.js";
import { AuthPersistenceModule } from "./auth-persistence.module.js";
import { AuthService } from "./auth.service.js";
import { IdentityResolver } from "./identity-resolver.js";

@Module({
  imports: [AuditLogModule, AuthPersistenceModule, SchoolModule, TenantPersistenceModule],
  controllers: [AuthController],
  providers: [AuthService, IdentityResolver],
  exports: [AuthService],
})
export class AuthModule {}
