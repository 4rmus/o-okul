import { Body, Controller, Get, Headers, Param, Post, UseGuards } from "@nestjs/common";
import type { AnswerKeyRecord } from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import {
  AnswerKeyService,
  type AnswerKeyDryRunResult,
} from "./answer-key.service.js";
import {
  AnswerKeyExcelImportService,
  type AnswerKeyExcelImportDryRunResult,
  type AnswerKeyExcelImportResult,
} from "./answer-key-excel-import.service.js";

const answerChoiceSchema = z.preprocess(
  (value) => typeof value === "string" ? value.trim().toUpperCase() : value,
  z.enum(["A", "B", "C", "D", "E"]),
);
const answerKeyScoreSectionSchema = z.enum([
  "LGS_TURKCE", "LGS_MATEMATIK", "LGS_FEN", "LGS_INKILAP", "LGS_DIN", "LGS_YABANCI_DIL",
  "TYT_TURKCE", "TYT_SOSYAL", "TYT_MATEMATIK", "TYT_FEN",
  "AYT_MATEMATIK", "AYT_FIZIK", "AYT_KIMYA", "AYT_BIYOLOJI", "AYT_EDEBIYAT",
  "AYT_TARIH_1", "AYT_COGRAFYA_1", "AYT_TARIH_2", "AYT_COGRAFYA_2", "AYT_FELSEFE", "AYT_DIN",
]);
const answerKeyQuestionSchema = z.object({
  branch: requiredTrimmedString,
  correctAnswer: answerChoiceSchema,
  evaluationStatus: z.enum(["ACTIVE", "CANCELLED"]).default("ACTIVE"),
  outcomeCode: optionalTrimmedString,
  questionNo: z.number().int().positive(),
  scoreSection: answerKeyScoreSectionSchema.optional(),
  topic: optionalTrimmedString,
}).strict();
const answerKeyScoringConfigSchema = z.object({
  rawScoreMultiplier: z.number().optional(),
  standardScoreBase: z.number().optional(),
  standardScoreMultiplier: z.number().optional(),
  wrongPenalty: z.number().min(0).optional(),
}).strict().optional();
const answerKeyBookletVariantSchema = z.object({
  code: requiredTrimmedString,
  permutation: z.array(z.number().int().positive()).min(1),
}).strict();
const answerKeyCreateBodySchema = z.object({
  bookletVariants: z.array(answerKeyBookletVariantSchema).optional(),
  dryRun: z.boolean().optional(),
  questions: z.array(answerKeyQuestionSchema).min(1),
  scoringConfig: answerKeyScoringConfigSchema,
  version: requiredTrimmedString,
}).strict();
const answerKeyExcelImportBodySchema = z.object({
  fileBase64: requiredTrimmedString,
  scoringConfig: answerKeyScoringConfigSchema,
  version: requiredTrimmedString,
}).strict();

type AnswerKeyCreateBody = z.infer<typeof answerKeyCreateBodySchema>;
type AnswerKeyExcelImportBody = z.infer<typeof answerKeyExcelImportBodySchema>;

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
    @Body(zodBody(answerKeyCreateBodySchema)) body: AnswerKeyCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<AnswerKeyRecord | AnswerKeyDryRunResult> {
    return this.answerKeys.create(getRequestContext(), {
      examId,
      version: body.version,
      questions: body.questions,
      scoringConfig: body.scoringConfig,
      bookletVariants: body.bookletVariants,
      dryRun: body.dryRun,
    }, idempotencyKey);
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
    @Body(zodBody(answerKeyExcelImportBodySchema)) body: AnswerKeyExcelImportBody,
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
    @Body(zodBody(answerKeyExcelImportBodySchema)) body: AnswerKeyExcelImportBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<AnswerKeyExcelImportResult> {
    return this.imports.import(getRequestContext(), {
      examId,
      version: body.version,
      fileBase64: body.fileBase64,
      scoringConfig: body.scoringConfig,
    }, idempotencyKey);
  }

  @Post(":version/publish")
  @RequireCapability("academic:manage")
  publish(
    @Param("examId") examId: string,
    @Param("version") version: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<AnswerKeyRecord> {
    return this.answerKeys.publish(getRequestContext(), examId, version, idempotencyKey);
  }
}
