import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { AuthPersistenceModule } from "../auth/auth-persistence.module.js";
import { AccountPiiPurgeService } from "./account-pii-purge.service.js";

@Module({
  imports: [AuditLogModule, AuthPersistenceModule],
  providers: [AccountPiiPurgeService],
  exports: [AccountPiiPurgeService],
})
export class AccountPiiModule {}
