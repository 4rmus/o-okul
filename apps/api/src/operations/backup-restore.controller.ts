import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { BackupRestoreService, type CreateBackupRestoreJobInput } from "./backup-restore.service.js";
import type { BackupRestoreJobRecord } from "./backup-restore-store.js";

@Controller("backup-restore-jobs")
@UseGuards(RolesGuard)
export class BackupRestoreController {
  constructor(private readonly jobs: BackupRestoreService) {}

  @Get()
  @RequireCapability("operation:manage")
  list(): Promise<BackupRestoreJobRecord[]> {
    return this.jobs.list(getRequestContext());
  }

  @Post()
  @RequireCapability("operation:manage")
  create(@Body() body: CreateBackupRestoreJobInput): Promise<BackupRestoreJobRecord> {
    return this.jobs.enqueue(getRequestContext(), body);
  }
}
