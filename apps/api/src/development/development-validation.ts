import { z } from "zod";
import {
  developmentMentorNoteMaxLength,
  type DevelopmentAssessmentCreateRequest,
  type DevelopmentCriterionCreateRequest,
} from "@o-okul/shared-types";
import { optionalTrimmedString, requiredTrimmedString, trimmedString } from "../http/zod-validation.js";

const integerSchema = z.number().int();

export const developmentCriterionBodySchema = z.object({
  name: requiredTrimmedString,
  scaleMax: integerSchema.optional(),
  scaleMin: integerSchema.optional(),
  sortOrder: integerSchema.optional(),
}).strict() satisfies z.ZodType<DevelopmentCriterionCreateRequest>;

const developmentAssessmentScoreBodySchema = z.object({
  criterionId: requiredTrimmedString,
  score: integerSchema,
}).strict();

const developmentAssessmentVisibilitySchema = z.enum(["GUARDIAN", "INTERNAL"]);

// A duplicate criterionId is rejected by the service (DEVELOPMENT_SCORE_CRITERION_DUPLICATE) before any insert.
export const developmentAssessmentBodySchema = z.object({
  mentorNote: trimmedString.max(developmentMentorNoteMaxLength).optional(),
  periodLabel: requiredTrimmedString.max(120),
  scores: z.array(developmentAssessmentScoreBodySchema).min(1).max(50),
  studentId: requiredTrimmedString,
  teacherId: optionalTrimmedString,
  termId: optionalTrimmedString,
  visibility: developmentAssessmentVisibilitySchema.optional(),
}).strict() satisfies z.ZodType<DevelopmentAssessmentCreateRequest>;

export type DevelopmentCriterionBody = DevelopmentCriterionCreateRequest;
export type DevelopmentAssessmentBody = DevelopmentAssessmentCreateRequest;
