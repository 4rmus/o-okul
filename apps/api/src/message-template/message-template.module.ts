import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { MessageTemplateController } from "./message-template.controller.js";
import { createMessageTemplateStore, messageTemplateStoreToken } from "./message-template-store.js";
import { MessageTemplateService } from "./message-template.service.js";

@Module({
  imports: [AuditLogModule],
  controllers: [MessageTemplateController],
  providers: [
    MessageTemplateService,
    {
      provide: messageTemplateStoreToken,
      useFactory: createMessageTemplateStore,
    },
  ],
  exports: [MessageTemplateService],
})
export class MessageTemplateModule {}
