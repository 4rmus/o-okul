import { Module } from "@nestjs/common";
import { AuditLogController } from "./audit-log.controller.js";
import { auditLogStoreToken, createAuditLogStore } from "./audit-log-store.js";
import { AuditLogService } from "./audit-log.service.js";
import { ListExportAuditController } from "./list-export.controller.js";
import { ListExportAuditService } from "./list-export.service.js";

@Module({
  controllers: [AuditLogController, ListExportAuditController],
  providers: [
    AuditLogService,
    ListExportAuditService,
    {
      provide: auditLogStoreToken,
      useFactory: createAuditLogStore,
    },
  ],
  exports: [AuditLogService],
})
export class AuditLogModule {}
