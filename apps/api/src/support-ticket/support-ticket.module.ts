import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { SchoolModule } from "../school/school.module.js";
import { UploadModule } from "../upload/upload.module.js";
import {
  createSupportTicketAttachmentStorageFromEnv,
  supportTicketAttachmentStorageToken,
} from "./support-ticket-attachment-storage.js";
import { SupportTicketController } from "./support-ticket.controller.js";
import { createSupportTicketStore, supportTicketStoreToken } from "./support-ticket-store.js";
import { SupportTicketService } from "./support-ticket.service.js";

@Module({
  imports: [AuditLogModule, SchoolModule, UploadModule],
  controllers: [SupportTicketController],
  providers: [
    SupportTicketService,
    {
      provide: supportTicketAttachmentStorageToken,
      useFactory: createSupportTicketAttachmentStorageFromEnv,
    },
    {
      provide: supportTicketStoreToken,
      useFactory: createSupportTicketStore,
    },
  ],
  exports: [SupportTicketService],
})
export class SupportTicketModule {}
