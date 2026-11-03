import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { SchoolModule } from "../school/school.module.js";
import { DevelopmentController } from "./development.controller.js";
import { DevelopmentPersistenceModule } from "./development-persistence.module.js";
import { DevelopmentService } from "./development.service.js";

@Module({
  imports: [AuditLogModule, DevelopmentPersistenceModule, SchoolModule],
  controllers: [DevelopmentController],
  providers: [DevelopmentService],
  exports: [DevelopmentService],
})
export class DevelopmentModule {}
