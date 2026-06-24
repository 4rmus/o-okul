import { Body, Controller, Get, Headers, Post, Res, UseGuards } from "@nestjs/common";
import type { Response } from "express";
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
import { TenantDataExportService } from "./tenant-data-export.service.js";

@Controller("backup-restore-jobs")
@UseGuards(RolesGuard)
export class BackupRestoreController {
  constructor(
    private readonly jobs: BackupRestoreService,
    private readonly tenantExports: TenantDataExportService,
  ) {}

  @Get("tenant-export")
  @RequireCapability("operation:manage")
  async exportTenantData(@Res() response: Response): Promise<void> {
    const payload = await this.tenantExports.createExport(getRequestContext());
    const date = payload.exportedAt.slice(0, 10);
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("content-disposition", `attachment; filename="o-okul-${payload.tenantId}-${date}.json"`);
    response.status(200).json(payload);
  }

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
