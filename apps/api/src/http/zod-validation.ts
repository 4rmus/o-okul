import { PipeTransform, UnprocessableEntityException } from "@nestjs/common";
import { z } from "zod";

export interface ValidationFieldIssue {
  code: string;
  message: string;
  path: string;
}

export class ZodValidationPipe<TSchema extends z.ZodType> implements PipeTransform<unknown, z.infer<TSchema>> {
  constructor(
    private readonly schema: TSchema,
    private readonly message = "İstek gövdesi geçersiz.",
  ) {}

  transform(value: unknown): z.infer<TSchema> {
    const result = this.schema.safeParse(value);
    if (result.success) {
      return result.data;
    }

    throw new UnprocessableEntityException({
      error: {
        code: "VALIDATION_FAILED",
        message: this.message,
        details: {
          fields: result.error.issues.map(toFieldIssue),
        },
      },
    });
  }
}

export function zodBody<TSchema extends z.ZodType>(schema: TSchema): ZodValidationPipe<TSchema> {
  return new ZodValidationPipe(schema);
}

export function zodQuery<TSchema extends z.ZodType>(schema: TSchema): ZodValidationPipe<TSchema> {
  return new ZodValidationPipe(schema, "Sorgu parametreleri geçersiz.");
}

export const trimmedString = z.string().trim();
export const requiredTrimmedString = trimmedString.min(1);
export const optionalTrimmedString = trimmedString.optional();
export const nonEmptyStringArray = z.array(requiredTrimmedString).min(1);

export function toTurkishUpperCase(value: string): string {
  return value.toLocaleUpperCase("tr-TR");
}

export const requiredUppercaseString = requiredTrimmedString.transform(toTurkishUpperCase);
export const optionalUppercaseString = trimmedString.transform(toTurkishUpperCase).optional();
export const optionalNonEmptyUppercaseString = requiredUppercaseString.optional();

export function requiredDateString(errorMessage = "Tarih geçersiz."): z.ZodString {
  return requiredTrimmedString
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: errorMessage })
    .refine(isCalendarDateString, { message: errorMessage });
}

export function requiredIsoDateTime(errorMessage = "Tarih geçersiz."): z.ZodString {
  return trimmedString.refine(isIsoDateTimeString, { message: errorMessage });
}

export function optionalIsoDateTime(errorMessage = "Tarih geçersiz."): z.ZodOptional<z.ZodString> {
  return requiredIsoDateTime(errorMessage).optional();
}

export function optionalDateString(errorMessage = "Tarih geçersiz."): z.ZodOptional<z.ZodString> {
  return requiredDateString(errorMessage).optional();
}

function toFieldIssue(issue: z.core.$ZodIssue): ValidationFieldIssue {
  return {
    code: issue.code,
    message: issue.message,
    path: issue.path.length > 0 ? issue.path.join(".") : "$",
  };
}

function isCalendarDateString(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isIsoDateTimeString(value: string): boolean {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.exec(value);
  return Boolean(match?.[1] && isCalendarDateString(match[1]) && !Number.isNaN(Date.parse(value)));
}
