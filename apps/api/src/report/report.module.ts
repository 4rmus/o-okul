import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { ExamPersistenceModule } from "../exam/exam-persistence.module.js";
import { createBullTenantQueueProducer } from "../queue/bullmq-producer.js";
import { SchoolModule } from "../school/school.module.js";
import { TenantPersistenceModule } from "../tenant/tenant-persistence.module.js";
import { ReportGenerationController } from "./report-generation.controller.js";
import {
  createReportPdfRenderer,
  ReportGenerationService,
  reportGenerationQueueProducerToken,
  reportPdfRendererToken,
} from "./report-generation.service.js";
import { createReportSnapshotStore, reportSnapshotStoreToken } from "./report-snapshot-store.js";

@Module({
  imports: [AuditLogModule, ExamPersistenceModule, SchoolModule, TenantPersistenceModule],
  controllers: [ReportGenerationController],
  providers: [
    ReportGenerationService,
    {
      provide: reportSnapshotStoreToken,
      useFactory: createReportSnapshotStore,
    },
    {
      provide: reportGenerationQueueProducerToken,
      useFactory: createBullTenantQueueProducer,
    },
    {
      provide: reportPdfRendererToken,
      useFactory: createReportPdfRenderer,
    },
  ],
  exports: [ReportGenerationService, reportSnapshotStoreToken],
})
export class ReportModule {}
