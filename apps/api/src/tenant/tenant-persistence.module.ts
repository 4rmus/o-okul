import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { AuthPersistenceModule } from "../auth/auth-persistence.module.js";
import { authSessionStoreToken, type SessionStore } from "../auth/session-store.js";
import { createTenantStore, tenantStoreToken } from "./tenant-store.js";

@Module({
  imports: [AuditLogModule, AuthPersistenceModule],
  providers: [
    {
      provide: tenantStoreToken,
      inject: [AuditLogService, authSessionStoreToken],
      useFactory: (auditLogs: AuditLogService, sessions: SessionStore) => createTenantStore({ auditLogs, sessions }),
    },
  ],
  exports: [tenantStoreToken],
})
export class TenantPersistenceModule {}
