import { BadRequestException, Body, Controller, Get, Headers, Param, Post, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { deviceBackupFileLimit, deviceBackupPasswordSchema } from "./device-backup-archive.js";
import { DeviceRestoreService } from "./device-restore.service.js";

const requestSchema=z.object({password:deviceBackupPasswordSchema,planToken:z.string().min(1).max(1024)}).strict();
const operationSchema=z.string().regex(/^[a-f0-9]{32}$/);
const operation=(value:string)=>{if(!operationSchema.safeParse(value).success)throw new BadRequestException("DEVICE_RESTORE_OPERATION_INVALID");return value;};
@Controller("device-restores")
export class DeviceRestoreController {
  constructor(private readonly restores:DeviceRestoreService){}
  @Get("current")
  @RequireCapability("operation:manage")
  current(){return this.restores.current(getRequestContext());}

  @Post("requests")
  @RequireCapability("operation:manage")
  @UseInterceptors(FileInterceptor("file",{limits:{fileSize:deviceBackupFileLimit,files:1,fields:2,parts:4,fieldSize:1024}}))
  async request(@Body() body:unknown,@Headers("idempotency-key") key:string,@UploadedFile() file?:{buffer:Buffer;size:number}){
    if(!file?.buffer||file.size!==file.buffer.length)throw new BadRequestException("DEVICE_BACKUP_FILE_REQUIRED");
    try{const parsed=requestSchema.safeParse(body);if(!parsed.success)throw new BadRequestException("DEVICE_RESTORE_REQUEST_INVALID");return await this.restores.request(getRequestContext(),file.buffer,parsed.data.password,parsed.data.planToken,key??"");}
    finally{file.buffer.fill(0);}
  }
  @Post(":operationId/cancel")
  @RequireCapability("operation:manage")
  cancel(@Param("operationId") id:string){return this.restores.cancel(getRequestContext(),operation(id));}

  @Get("tenants/:tenantId")
  @RequireCapability("tenant:clean-reset")
  tenant(@Param("tenantId") tenantId:string){return this.restores.current(getRequestContext(),tenantId);}

  @Post("tenants/:tenantId/:operationId/approve")
  @RequireCapability("tenant:clean-reset")
  approve(@Param("tenantId") tenantId:string,@Param("operationId") id:string,@Headers("x-step-up-token") proof:string){return this.restores.approve(getRequestContext(),tenantId,operation(id),proof??"");}
}
