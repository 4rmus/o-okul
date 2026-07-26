import { z } from "zod";
import type {
  ParserConfigApprovalRequest,
  ParserConfigSuggestion,
  ParserConfigSuggestionRequest,
} from "@o-okul/shared-types";
import { optionalTrimmedString, requiredTrimmedString } from "../http/zod-validation.js";

const parserFieldSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    column: z.number().int().nonnegative(),
    kind: z.literal("delimited"),
  }).strict(),
  z.object({
    kind: z.literal("fixed"),
    length: z.number().int().positive(),
    start: z.number().int().nonnegative(),
  }).strict(),
]);

const parserAnswerSegmentSchema = z.object({
  length: z.number().int().positive(),
  start: z.number().int().nonnegative(),
}).strict();

const parserAnswerFieldSpecSchema = z.discriminatedUnion("kind", [
  z.object({
    column: z.number().int().nonnegative(),
    estimatedQuestionCount: z.number().int().positive(),
    kind: z.literal("delimited"),
  }).strict(),
  z.object({
    estimatedQuestionCount: z.number().int().positive(),
    kind: z.literal("fixed"),
    length: z.number().int().positive().optional(),
    segments: z.array(parserAnswerSegmentSchema).min(1).optional(),
    start: z.number().int().nonnegative().optional(),
  }).strict().refine((value) => Boolean(value.segments?.length || (value.start !== undefined && value.length !== undefined)), {
    message: "FIXED cevap alanı start/length veya segments içermeli.",
    path: ["segments"],
  }),
]);

export const parserConfigSuggestionSchema = z.object({
  confidence: z.enum(["low", "medium", "high"]),
  delimiter: z.enum(["TAB", "COMMA", "PIPE", "FIXED"]),
  encoding: z.enum(["UTF-8", "ISO-8859-9", "CP1254"]),
  fieldMapping: z.object({
    absentMarker: optionalTrimmedString,
    answers: parserAnswerFieldSpecSchema,
    bookletType: parserFieldSpecSchema,
    nationalId: parserFieldSpecSchema.optional(),
    studentNo: parserFieldSpecSchema,
  }).strict(),
  skipHeaderLines: z.number().int().nonnegative(),
  version: z.literal(1),
  warnings: z.array(z.string()),
}).strict() satisfies z.ZodType<ParserConfigSuggestion>;

export const parserConfigSuggestionBodySchema = z.object({
  fileBase64: optionalTrimmedString,
  preset: z.enum([
    "OPTIK_7108_LGS",
    "OPTIK_129",
    "YANIT",
    "OPTIK_840_LGS",
  ]).optional(),
  sampleSize: z.number().int().positive().optional(),
  sampleText: optionalTrimmedString,
}).strict() satisfies z.ZodType<ParserConfigSuggestionRequest>;

export const parserConfigApprovalBodySchema = z.object({
  suggestion: parserConfigSuggestionSchema,
  version: requiredTrimmedString,
}).strict() satisfies z.ZodType<ParserConfigApprovalRequest>;

export type ParserConfigSuggestionBody = z.infer<typeof parserConfigSuggestionBodySchema>;
export type ParserConfigApprovalBody = z.infer<typeof parserConfigApprovalBodySchema>;
