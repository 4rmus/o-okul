import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { RawImportQuarantineService } from "./raw-import-quarantine.service.js";
import { RawImportAnalysisService } from "./raw-import-analysis.service.js";
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
    private readonly analysis: RawImportAnalysisService,
  ) {}

  @Post()
  @RequireCapability("academic:manage")
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
  @RequireCapability("academic:manage")
  listQuarantines(
    @Param("examId") examId: string,
    @Param("rawImportId") rawImportId: string,
  ) {
    return this.quarantines.list(getRequestContext(), examId, rawImportId);
  }

  @Get(":rawImportId/summary")
  @RequireCapability("academic:manage")
  summary(
    @Param("examId") examId: string,
    @Param("rawImportId") rawImportId: string,
  ) {
    return this.analysis.summary(getRequestContext(), examId, rawImportId);
  }

  @Post(":rawImportId/evaluation-jobs")
  @RequireCapability("academic:manage")
  enqueueEvaluation(
    @Param("examId") examId: string,
    @Param("rawImportId") rawImportId: string,
    @Body() body: { answerKeyId?: string },
  ) {
    return this.analysis.enqueueEvaluation(getRequestContext(), {
      examId,
      rawImportId,
      answerKeyId: body.answerKeyId,
    });
  }

  @Post(":rawImportId/quarantines/:quarantineId/resolve")
  @RequireCapability("academic:manage")
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
