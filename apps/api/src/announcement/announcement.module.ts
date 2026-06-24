import { Module } from "@nestjs/common";
import { createNotificationAdapterFromEnv } from "@o-okul/notification-adapter";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { NotificationDeviceModule } from "../notification-device/notification-device.module.js";
import { createBullTenantQueueProducer } from "../queue/bullmq-producer.js";
import { SchoolModule } from "../school/school.module.js";
import { UserManagementPersistenceModule } from "../user-management/user-management-persistence.module.js";
import { AnnouncementController } from "./announcement.controller.js";
import { AnnouncementPersistenceModule } from "./announcement-persistence.module.js";
import {
  AnnouncementService,
  announcementDeliveryQueueProducerToken,
  notificationAdapterToken,
} from "./announcement.service.js";

@Module({
  imports: [
    AnnouncementPersistenceModule,
    AuditLogModule,
    NotificationDeviceModule,
    SchoolModule,
    UserManagementPersistenceModule,
  ],
  controllers: [AnnouncementController],
  providers: [
    AnnouncementService,
    {
      provide: announcementDeliveryQueueProducerToken,
      useFactory: createBullTenantQueueProducer,
    },
    {
      provide: notificationAdapterToken,
      useFactory: () => createNotificationAdapterFromEnv(process.env),
    },
  ],
  exports: [AnnouncementService],
})
export class AnnouncementModule {}
