import { Module } from "@nestjs/common";
import {
  createNotificationDeviceTokenStore,
  notificationDeviceTokenStoreToken,
} from "./notification-device-store.js";
import { NotificationDeviceService } from "./notification-device.service.js";

@Module({
  providers: [
    NotificationDeviceService,
    {
      provide: notificationDeviceTokenStoreToken,
      useFactory: createNotificationDeviceTokenStore,
    },
  ],
  exports: [NotificationDeviceService],
})
export class NotificationDeviceModule {}
