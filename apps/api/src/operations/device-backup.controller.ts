import { BadRequestException, Body, Controller, Get, HttpCode, Injectable, Post, Res, UnauthorizedException, UploadedFile, UseGuards, UseInterceptors, type CanActivate } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { ReadOnlyOperation } from "../http/read-only-operation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { assertInstitutionAdmin } from "../tenant/tenant-fresh-reset.service.js";
import { deviceBackupFileLimit, deviceBackupPasswordSchema } from "./device-backup-archive.js";
import { DeviceBackupService } from "./device-backup.service.js";

@Injectable()
export class DeviceBackupGuard implements CanActivate {
  canActivate() {
    let context; try { context = getRequestContext(); } catch { throw new UnauthorizedException(); }
    assertInstitutionAdmin(context); return true;
  }
}
const previewBodySchema = z.object({ password: deviceBackupPasswordSchema, planToken: z.string().min(1).max(1024).optional() }).strict();
const bodySchema = z.object({ password: deviceBackupPasswordSchema }).strict();
function password(body: unknown) {
  const result = bodySchema.safeParse(body);
  if (!result.success) throw new BadRequestException("DEVICE_BACKUP_PASSWORD_INVALID");
  return result.data.password;
}
@Controller("device-backups")
@UseGuards(DeviceBackupGuard)
export class DeviceBackupController {
  constructor(private readonly backups: DeviceBackupService) {}
  @Get("status")
  @RequireCapability("operation:manage")
  status() { return this.backups.status(getRequestContext()); }

  @Post("download")
  @HttpCode(200)
  @RequireCapability("operation:manage")
  @ReadOnlyOperation()
  async download(@Body() body: unknown, @Res() response: Response) {
    const archive = await this.backups.download(getRequestContext(), password(body));
    response.setHeader("cache-control", "no-store");
    response.setHeader("content-type", "application/octet-stream");
    response.setHeader("content-disposition", `attachment; filename="o-okul-${new Date().toISOString().slice(0,10)}.ookulbackup"`);
    response.status(200).send(archive);
  }
  @Post("preview")
  @RequireCapability("operation:manage")
  @ReadOnlyOperation()
  // Busboy emits partsLimit upon reaching it; file/field limits still enforce one file and password plus an optional plan token.
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: deviceBackupFileLimit, files: 1, fields: 2, parts: 4, fieldSize: 1024 } }))
  async preview(@Body() body: unknown, @UploadedFile() file?: { buffer: Buffer; size: number }) {
    const parsed = previewBodySchema.safeParse(body);
    if (!parsed.success) { file?.buffer.fill(0); throw new BadRequestException("DEVICE_BACKUP_PREVIEW_INVALID"); }
    const secret = parsed.data.password;
    if (!file?.buffer || file.size !== file.buffer.length) throw new BadRequestException("DEVICE_BACKUP_FILE_REQUIRED");
    try { return await this.backups.preview(getRequestContext(), file.buffer, secret, parsed.data.planToken); }
    finally { file.buffer.fill(0); }
  }
}
