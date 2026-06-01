import { Body, Controller, Param, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  RawImportUploadService,
  type RawImportUploadResult,
} from "./raw-import-upload.service.js";

@Controller("exams/:examId/raw-imports")
@UseGuards(RolesGuard)
export class RawImportController {
  constructor(private readonly rawImports: RawImportUploadService) {}

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
}
