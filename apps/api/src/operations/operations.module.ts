import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { createBullTenantQueueProducer } from "../queue/bullmq-producer.js";
import { BackupRestoreController } from "./backup-restore.controller.js";
import { backupRestoreJobStoreToken, createBackupRestoreJobStore } from "./backup-restore-store.js";
import {
  BackupRestoreService,
  backupRestoreQueueProducerToken,
} from "./backup-restore.service.js";
import { TenantDataExportService } from "./tenant-data-export.service.js";
import { createTenantDataExportStore, tenantDataExportStoreToken } from "./tenant-data-export-store.js";

@Module({
  imports: [AuditLogModule],
  controllers: [BackupRestoreController],
  providers: [
    BackupRestoreService,
    TenantDataExportService,
    {
      provide: backupRestoreJobStoreToken,
      useFactory: createBackupRestoreJobStore,
    },
    {
      provide: tenantDataExportStoreToken,
      useFactory: createTenantDataExportStore,
    },
    {
      provide: backupRestoreQueueProducerToken,
      useFactory: createBullTenantQueueProducer,
    },
  ],
})
export class OperationsModule {}
