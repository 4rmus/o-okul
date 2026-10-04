import { Module } from "@nestjs/common";
import { AuditLogModule } from "../audit-log/audit-log.module.js";
import { SchoolModule } from "../school/school.module.js";
import { GradebookController } from "./gradebook.controller.js";
import { createGradebookStore, gradebookStoreToken } from "./gradebook-store.js";
import { GradebookService } from "./gradebook.service.js";

@Module({
  imports: [AuditLogModule, SchoolModule],
  controllers: [GradebookController],
  providers: [GradebookService, { provide: gradebookStoreToken, useFactory: createGradebookStore }],
})
export class GradebookModule {}
