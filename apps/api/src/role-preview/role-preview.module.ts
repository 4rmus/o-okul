import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { RolePreviewController } from "./role-preview.controller.js";
import { RolePreviewService } from "./role-preview.service.js";

@Module({
  imports: [AuditLogModule],
  controllers: [RolePreviewController],
  providers: [RolePreviewService],
  exports: [RolePreviewService],
})
export class RolePreviewModule {}
