import { Body, Controller, Get, Headers, Param, Post, Put, Query, UseGuards } from "@nestjs/common";
import type {
  GradeAssessmentCreateRequest,
  GradeAssessmentDetail,
  GradeAssessmentPublishResult,
  GradeAssessmentRecord,
  GradeEntriesSaveRequest,
  GradeEntryRecord,
} from "@o-okul/shared-types";
import { z } from "zod";
import { getRequestContext } from "../context/request-context.js";
import { optionalTrimmedString, requiredTrimmedString, zodBody, zodQuery } from "../http/zod-validation.js";
import { RequireCapability } from "../rbac/capability.decorator.js";
import { RolesGuard } from "../rbac/roles.guard.js";
import { GradebookService } from "./gradebook.service.js";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "DATE_INVALID").refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "DATE_INVALID");

const assessmentCreateSchema = z.object({
  classId: requiredTrimmedString,
  courseId: requiredTrimmedString,
  termId: requiredTrimmedString,
  kind: z.enum(["WRITTEN", "PERFORMANCE", "PROJECT", "PARTICIPATION"]),
  title: requiredTrimmedString.pipe(z.string().max(120)),
  heldOn: isoDate,
  maxScore: z.number().optional(),
}).strict() satisfies z.ZodType<GradeAssessmentCreateRequest>;

const entriesSaveSchema = z.object({
  entries: z.array(z.object({
    studentId: requiredTrimmedString,
    score: z.number().nullable(),
    absent: z.boolean(),
  }).strict()).min(1).max(200),
}).strict() satisfies z.ZodType<GradeEntriesSaveRequest>;

const assessmentListQuerySchema = z.object({
  classId: optionalTrimmedString,
  courseId: optionalTrimmedString,
  termId: optionalTrimmedString,
}).strict();

@Controller("grade-assessments")
@UseGuards(RolesGuard)
export class GradebookController {
  constructor(private readonly gradebook: GradebookService) {}

  @Get()
  @RequireCapability("academic:read")
  list(@Query(zodQuery(assessmentListQuerySchema)) query: z.infer<typeof assessmentListQuerySchema>): Promise<GradeAssessmentRecord[]> {
    return this.gradebook.listAssessments(getRequestContext(), query);
  }

  @Post()
  @RequireCapability("academic:manage")
  create(@Body(zodBody(assessmentCreateSchema)) body: GradeAssessmentCreateRequest): Promise<GradeAssessmentRecord> {
    return this.gradebook.createAssessment(getRequestContext(), body);
  }

  @Get(":id")
  @RequireCapability("academic:read")
  get(@Param("id") id: string): Promise<GradeAssessmentDetail> {
    return this.gradebook.getAssessment(getRequestContext(), id);
  }

  /** Teachers write only for their assigned class and course; the service enforces it. */
  @Put(":id/entries")
  @RequireCapability("academic:read")
  saveEntries(@Param("id") id: string, @Body(zodBody(entriesSaveSchema)) body: GradeEntriesSaveRequest): Promise<GradeEntryRecord[]> {
    return this.gradebook.saveEntries(getRequestContext(), id, body);
  }

  @Post(":id/publish")
  @RequireCapability("academic:manage")
  publish(@Param("id") id: string, @Headers("idempotency-key") idempotencyKey?: string): Promise<GradeAssessmentPublishResult> {
    return this.gradebook.publish(getRequestContext(), id, idempotencyKey);
  }
}
