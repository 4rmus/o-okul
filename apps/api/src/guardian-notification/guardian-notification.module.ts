import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { resolvePersistenceDriver } from "../config/persistence.js";
import { createBullTenantQueueProducer } from "../queue/bullmq-producer.js";
import {
  GuardianAutoNotificationService,
  guardianNotifyQueueProducerToken,
  InMemoryGuardianNotifyQueueProducer,
} from "./guardian-auto-notification.service.js";
import { createGuardianNotificationSettingsStore, guardianNotificationSettingsStoreToken } from "./guardian-notification-settings-store.js";
import { GuardianNotificationSettingsController } from "./guardian-notification-settings.controller.js";

@Module({
  imports: [AuditLogModule],
  controllers: [GuardianNotificationSettingsController],
  providers: [
    GuardianAutoNotificationService,
    { provide: guardianNotificationSettingsStoreToken, useFactory: createGuardianNotificationSettingsStore },
    {
      provide: guardianNotifyQueueProducerToken,
      // Memory persistence has no worker or Redis behind it.
      useFactory: () => resolvePersistenceDriver() === "postgres" ? createBullTenantQueueProducer() : new InMemoryGuardianNotifyQueueProducer(),
    },
  ],
  exports: [GuardianAutoNotificationService],
})
export class GuardianNotificationModule {}
