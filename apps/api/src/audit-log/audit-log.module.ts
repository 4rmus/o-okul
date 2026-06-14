import { Module } from "@nestjs/common";
import { AuditLogController } from "./audit-log.controller.js";
import { auditLogStoreToken, createAuditLogStore } from "./audit-log-store.js";
import { AuditLogService } from "./audit-log.service.js";

@Module({
  controllers: [AuditLogController],
  providers: [
    AuditLogService,
    {
      provide: auditLogStoreToken,
      useFactory: createAuditLogStore,
    },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}
