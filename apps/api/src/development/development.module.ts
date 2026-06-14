import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { SchoolModule } from "../school/school.module.js";
import { DevelopmentController } from "./development.controller.js";
import { createDevelopmentStore, developmentStoreToken } from "./development-store.js";
import { DevelopmentService } from "./development.service.js";

@Module({
  imports: [AuditLogModule, SchoolModule],
  controllers: [DevelopmentController],
  providers: [
    DevelopmentService,
    {
      provide: developmentStoreToken,
      useFactory: createDevelopmentStore,
    },
  ],
  exports: [DevelopmentService],
})
export class DevelopmentModule {}
