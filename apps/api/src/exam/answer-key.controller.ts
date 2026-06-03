import { Body, Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import type { AnswerKeyRecord } from "@uzman-hocam/shared-types";
import { getRequestContext } from "../context/request-context.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  AnswerKeyService,
  type AnswerKeyDryRunResult,
  type CreateAnswerKeyInput,
} from "./answer-key.service.js";
import {
  AnswerKeyExcelImportService,
  type AnswerKeyExcelImportDryRunResult,
  type AnswerKeyExcelImportInput,
  type AnswerKeyExcelImportResult,
} from "./answer-key-excel-import.service.js";

@Controller("exams/:examId/answer-keys")
@UseGuards(RolesGuard)
export class AnswerKeyController {
  constructor(
    private readonly answerKeys: AnswerKeyService,
    private readonly imports: AnswerKeyExcelImportService,
  ) {}

  @Post()
  @RequireCapability("academic:manage")
  create(
    @Param("examId") examId: string,
    @Body() body: Omit<CreateAnswerKeyInput, "examId">,
  ): Promise<AnswerKeyRecord | AnswerKeyDryRunResult> {
    return this.answerKeys.create(getRequestContext(), {
      examId,
      version: body.version,
      questions: body.questions,
      scoringConfig: body.scoringConfig,
      dryRun: body.dryRun,
    });
  }

  @Get()
  @Roles("TEACHER")
  list(@Param("examId") examId: string): Promise<AnswerKeyRecord[]> {
    return this.answerKeys.list(getRequestContext(), examId);
  }

  @Post("imports/dry-run")
  @RequireCapability("academic:manage")
  dryRunImport(
    @Param("examId") examId: string,
    @Body() body: Omit<AnswerKeyExcelImportInput, "examId">,
  ): Promise<AnswerKeyExcelImportDryRunResult> {
    return this.imports.dryRun(getRequestContext(), {
      examId,
      version: body.version,
      fileBase64: body.fileBase64,
      scoringConfig: body.scoringConfig,
    });
  }

  @Post("imports")
  @RequireCapability("academic:manage")
  import(
    @Param("examId") examId: string,
    @Body() body: Omit<AnswerKeyExcelImportInput, "examId">,
  ): Promise<AnswerKeyExcelImportResult> {
    return this.imports.import(getRequestContext(), {
      examId,
      version: body.version,
      fileBase64: body.fileBase64,
      scoringConfig: body.scoringConfig,
    });
  }

  @Post(":version/publish")
  @RequireCapability("academic:manage")
  publish(
    @Param("examId") examId: string,
    @Param("version") version: string,
  ): Promise<AnswerKeyRecord> {
    return this.answerKeys.publish(getRequestContext(), examId, version);
  }
}
