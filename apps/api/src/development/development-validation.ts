import { z } from "zod";
import type { DevelopmentAssessmentCreateRequest, DevelopmentCriterionCreateRequest } from "@o-okul/shared-types";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

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

export const developmentAssessmentBodySchema = z.object({
  mentorNote: optionalTrimmedString,
  periodLabel: requiredTrimmedString,
  scores: z.array(developmentAssessmentScoreBodySchema).min(1),
  studentId: requiredTrimmedString,
  teacherId: optionalTrimmedString,
  termId: optionalTrimmedString,
  visibility: developmentAssessmentVisibilitySchema.optional(),
}).strict() satisfies z.ZodType<DevelopmentAssessmentCreateRequest>;

export type DevelopmentCriterionBody = DevelopmentCriterionCreateRequest;
export type DevelopmentAssessmentBody = DevelopmentAssessmentCreateRequest;
