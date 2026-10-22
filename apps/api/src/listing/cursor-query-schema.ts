import { z } from "zod";
import { optionalTrimmedString } from "../http/zod-validation.js";

const emptyToUndefined = (value: unknown) => value === "" ? undefined : value;

/**
 * Shared query fields of the cursor lists (`GET /employees` pattern): opaque `cursor`, `direction` and a bounded
 * `limit`. Endpoints extend it and call `.strict()`, so a legacy `page` parameter is refused with 422.
 */
export function cursorListQueryShape(options: { defaultLimit: number; maxLimit: number }) {
  return {
    cursor: optionalTrimmedString,
    direction: z.preprocess((value) => value === undefined || value === "" ? "next" : value, z.enum(["next", "previous"])),
    limit: z.preprocess(
      (value) => value === undefined || value === "" ? options.defaultLimit : Number(value),
      z.number().int().min(1).max(options.maxLimit),
    ),
    q: optionalTrimmedString,
  };
}

export function optionalQueryEnum<const TValues extends readonly [string, ...string[]]>(values: TValues) {
  return z.preprocess(emptyToUndefined, z.enum(values).optional());
}

export function defaultedQueryEnum<const TValues extends readonly [string, ...string[]]>(values: TValues, defaultValue: TValues[number]) {
  return z.preprocess((value) => value === undefined || value === "" ? defaultValue : value, z.enum(values));
}

/** A `direction=previous` page needs the cursor it pages back from. */
export function previousNeedsCursor(query: { direction: "next" | "previous"; cursor?: string }): boolean {
  return query.direction !== "previous" || Boolean(query.cursor);
}
