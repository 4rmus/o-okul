import { Module } from "@nestjs/common";
import {
  announcementDeliveryReportStoreToken,
  createAnnouncementDeliveryReportStore,
} from "./announcement-delivery-report-store.js";
import { announcementReceiptStoreToken, createAnnouncementReceiptStore } from "./announcement-receipt-store.js";
import { announcementStoreToken, createAnnouncementStore } from "./announcement-store.js";

@Module({
  providers: [
    {
      provide: announcementStoreToken,
      useFactory: createAnnouncementStore,
    },
    {
      provide: announcementReceiptStoreToken,
      useFactory: createAnnouncementReceiptStore,
    },
    {
      provide: announcementDeliveryReportStoreToken,
      useFactory: createAnnouncementDeliveryReportStore,
    },
  ],
  exports: [announcementStoreToken, announcementReceiptStoreToken, announcementDeliveryReportStoreToken],
})
export class AnnouncementPersistenceModule {}
