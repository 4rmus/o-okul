import { Module } from "@nestjs/common";
import { AnnouncementPersistenceModule } from "../announcement/announcement-persistence.module.js";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { MessageTemplateModule } from "../message-template/message-template.module.js";
import { ScheduleModule } from "../program/schedule.module.js";
import { createBullTenantQueueProducer } from "../queue/bullmq-producer.js";
import { SchoolModule } from "../school/school.module.js";
import {
  createSmsBatchDeliveryReportStore,
  smsBatchDeliveryReportStoreToken,
} from "./sms-batch-delivery-report-store.js";
import { SmsBatchController } from "./sms-batch.controller.js";
import { SmsBatchService, smsBatchQueueProducerToken } from "./sms-batch.service.js";

@Module({
  imports: [AnnouncementPersistenceModule, AuditLogModule, MessageTemplateModule, ScheduleModule, SchoolModule],
  controllers: [SmsBatchController],
  providers: [
    SmsBatchService,
    {
      provide: smsBatchDeliveryReportStoreToken,
      useFactory: createSmsBatchDeliveryReportStore,
    },
    {
      provide: smsBatchQueueProducerToken,
      useFactory: createBullTenantQueueProducer,
    },
  ],
  exports: [SmsBatchService],
})
export class SmsBatchModule {}
