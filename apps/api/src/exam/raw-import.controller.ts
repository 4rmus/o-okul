import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from "@nestjs/common";
import type {
  RawImportEvaluationRequest,
  RawImportQuarantineResolveRequest,
  RawImportUploadRequest,
  RawImportUploadResult,
} from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { RawImportQuarantineService } from "./raw-import-quarantine.service.js";
import { RawImportAnalysisService } from "./raw-import-analysis.service.js";
import { RawImportUploadService } from "./raw-import-upload.service.js";

const rawImportUploadBodySchema = z.object({
  contentType: optionalTrimmedString,
  fileBase64: requiredTrimmedString,
  fileName: requiredTrimmedString,
  parserConfigVersion: requiredTrimmedString,
  sourceType: requiredTrimmedString,
}).strict() satisfies z.ZodType<RawImportUploadRequest>;
const rawImportEvaluationBodySchema = z.preprocess((value) => value ?? {}, z.object({
  answerKeyId: optionalTrimmedString,
}).strict()) satisfies z.ZodType<RawImportEvaluationRequest>;
const rawImportResolveBodySchema = z.object({
  resolvedStudentId: requiredTrimmedString,
}).strict() satisfies z.ZodType<RawImportQuarantineResolveRequest>;

type RawImportUploadBody = RawImportUploadRequest;
type RawImportEvaluationBody = RawImportEvaluationRequest;
type RawImportResolveBody = RawImportQuarantineResolveRequest;

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
    @Body(zodBody(rawImportUploadBodySchema)) body: RawImportUploadBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<RawImportUploadResult> {
    return this.rawImports.upload(getRequestContext(), {
      examId,
      sourceType: body.sourceType,
      fileName: body.fileName,
      bytes: body.fileBase64 ? Buffer.from(body.fileBase64, "base64") : undefined,
      contentType: body.contentType,
      parserConfigVersion: body.parserConfigVersion,
    }, idempotencyKey);
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
    @Body(zodBody(rawImportEvaluationBodySchema)) body: RawImportEvaluationBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.analysis.enqueueEvaluation(getRequestContext(), {
      examId,
      rawImportId,
      answerKeyId: body.answerKeyId,
    }, idempotencyKey);
  }

  @Get(":rawImportId/evaluation-status")
  @RequireCapability("academic:manage")
  evaluationStatus(
    @Param("examId") examId: string,
    @Param("rawImportId") rawImportId: string,
    @Query("answerKeyId") answerKeyId?: string,
  ) {
    return this.analysis.evaluationStatus(getRequestContext(), {
      examId,
      rawImportId,
      answerKeyId,
    });
  }

  @Post(":rawImportId/quarantines/:quarantineId/resolve")
  @RequireCapability("academic:manage")
  resolveQuarantine(
    @Param("examId") examId: string,
    @Param("rawImportId") rawImportId: string,
    @Param("quarantineId") quarantineId: string,
    @Body(zodBody(rawImportResolveBodySchema)) body: RawImportResolveBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ) {
    return this.quarantines.resolve(getRequestContext(), {
      examId,
      rawImportId,
      quarantineId,
      resolvedStudentId: body.resolvedStudentId,
    }, idempotencyKey);
  }
}
