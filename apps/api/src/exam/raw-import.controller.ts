import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { RawImportQuarantineService } from "./raw-import-quarantine.service.js";
import {
  RawImportUploadService,
  type RawImportUploadResult,
} from "./raw-import-upload.service.js";

@Controller("exams/:examId/raw-imports")
@UseGuards(RolesGuard)
export class RawImportController {
  constructor(
    private readonly rawImports: RawImportUploadService,
    private readonly quarantines: RawImportQuarantineService,
  ) {}

  @Post()
  @Roles("TENANT_ADMIN")
  upload(
    @Param("examId") examId: string,
    @Body() body: {
      sourceType?: string;
      fileName?: string;
      fileBase64?: string;
      contentType?: string;
      parserConfigVersion?: string;
    },
  ): Promise<RawImportUploadResult> {
    return this.rawImports.upload(getRequestContext(), {
      examId,
      sourceType: body.sourceType,
      fileName: body.fileName,
      bytes: body.fileBase64 ? Buffer.from(body.fileBase64, "base64") : undefined,
      contentType: body.contentType,
      parserConfigVersion: body.parserConfigVersion,
    });
  }

  @Get(":rawImportId/quarantines")
  @Roles("TENANT_ADMIN")
  listQuarantines(
    @Param("examId") examId: string,
    @Param("rawImportId") rawImportId: string,
  ) {
    return this.quarantines.list(getRequestContext(), examId, rawImportId);
  }

  @Post(":rawImportId/quarantines/:quarantineId/resolve")
  @Roles("TENANT_ADMIN")
  resolveQuarantine(
    @Param("examId") examId: string,
    @Param("rawImportId") rawImportId: string,
    @Param("quarantineId") quarantineId: string,
    @Body() body: { resolvedStudentId?: string },
  ) {
    return this.quarantines.resolve(getRequestContext(), {
      examId,
      rawImportId,
      quarantineId,
      resolvedStudentId: body.resolvedStudentId,
    });
  }
}
