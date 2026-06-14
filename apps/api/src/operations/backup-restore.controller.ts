import { Body, Controller, Get, Headers, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { BackupRestoreService } from "./backup-restore.service.js";
import type { BackupRestoreJobRecord } from "./backup-restore-store.js";
import {
  backupRestoreJobCreateBodySchema,
  type BackupRestoreJobCreateBody,
} from "./backup-restore-validation.js";

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
  create(
    @Body(zodBody(backupRestoreJobCreateBodySchema)) body: BackupRestoreJobCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<BackupRestoreJobRecord> {
    return this.jobs.enqueue(getRequestContext(), body, idempotencyKey);
  }
}
