import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, UseGuards } from "@nestjs/common";
import type { ExamParticipantRecord, ExamRecord } from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { optionalIsoDateTime, optionalTrimmedString, requiredTrimmedString, zodBody } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { Roles } from "../rbac/roles.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { ExamService, type CreateExamParticipantInput } from "./exam.service.js";

const examBaseBodySchema = z.object({
  alanId: optionalTrimmedString,
  classId: optionalTrimmedString,
  classIds: z.array(requiredTrimmedString).optional(),
  examYear: z.number().int().min(2000).max(2100).optional(),
  examType: optionalTrimmedString,
  gradeLevelId: optionalTrimmedString,
  linkedTytExamId: optionalTrimmedString,
  scoringProfileId: optionalTrimmedString,
  startsAt: optionalIsoDateTime("EXAM_STARTS_AT_INVALID"),
  title: requiredTrimmedString,
}).strict();
const examCreateBodySchema = examBaseBodySchema.extend({
  answerKey: z.object({
    fileBase64: requiredTrimmedString,
    scoringConfig: z.unknown().optional(),
    version: requiredTrimmedString,
  }).strict(),
}).strict();
const examUpdateBodySchema = examBaseBodySchema;
const examParticipantBodySchema = z.object({
  bookletType: optionalTrimmedString,
  participantNo: optionalTrimmedString,
  studentId: requiredTrimmedString,
}).strict();

type ExamCreateBody = z.infer<typeof examCreateBodySchema>;
type ExamUpdateBody = z.infer<typeof examUpdateBodySchema>;

@Controller("exams")
@UseGuards(RolesGuard)
export class ExamController {
  constructor(private readonly exams: ExamService) {}

  @Post()
  @RequireCapability("academic:manage")
  create(
    @Body(zodBody(examCreateBodySchema)) body: ExamCreateBody,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<ExamRecord> {
    return this.exams.create(getRequestContext(), {
      title: body.title,
      gradeLevelId: body.gradeLevelId,
      alanId: body.alanId,
      examType: body.examType,
      examYear: body.examYear,
      scoringProfileId: body.scoringProfileId,
      linkedTytExamId: body.linkedTytExamId,
      startsAt: body.startsAt,
      classId: body.classId,
      classIds: body.classIds,
      answerKey: body.answerKey,
    }, idempotencyKey);
  }

  @Get()
  @Roles("TEACHER")
  list(): Promise<ExamRecord[]> {
    return this.exams.list(getRequestContext());
  }

  @Get(":examId")
  @Roles("TEACHER")
  get(@Param("examId") examId: string): Promise<ExamRecord> {
    return this.exams.get(getRequestContext(), examId);
  }

  @Patch(":examId")
  @RequireCapability("academic:manage")
  update(
    @Param("examId") examId: string,
    @Body(zodBody(examUpdateBodySchema)) body: ExamUpdateBody,
  ): Promise<ExamRecord> {
    return this.exams.update(getRequestContext(), examId, {
      title: body.title,
      gradeLevelId: body.gradeLevelId,
      alanId: body.alanId,
      examType: body.examType,
      examYear: body.examYear,
      scoringProfileId: body.scoringProfileId,
      linkedTytExamId: body.linkedTytExamId,
      startsAt: body.startsAt,
      classId: body.classId,
      classIds: body.classIds,
    });
  }

  @Post(":examId/publish")
  @RequireCapability("academic:manage")
  publish(
    @Param("examId") examId: string,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<ExamRecord> {
    return this.exams.publish(getRequestContext(), examId, idempotencyKey);
  }

  @Delete(":examId")
  @HttpCode(204)
  @RequireCapability("academic:manage")
  async delete(@Param("examId") examId: string): Promise<void> {
    await this.exams.delete(getRequestContext(), examId);
  }

  @Get(":examId/participants")
  @Roles("TEACHER")
  participants(@Param("examId") examId: string): Promise<ExamParticipantRecord[]> {
    return this.exams.listParticipants(getRequestContext(), examId);
  }

  @Post(":examId/participants")
  @RequireCapability("academic:manage")
  addParticipant(
    @Param("examId") examId: string,
    @Body(zodBody(examParticipantBodySchema)) body: CreateExamParticipantInput,
    @Headers("idempotency-key") idempotencyKey?: string,
  ): Promise<ExamParticipantRecord> {
    return this.exams.addParticipant(getRequestContext(), examId, {
      studentId: body.studentId,
      participantNo: body.participantNo,
      bookletType: body.bookletType,
    }, idempotencyKey);
  }
}
