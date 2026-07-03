import { UnprocessableEntityException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { optionalIsoDateTime, optionalUppercaseString, requiredDateString, requiredUppercaseString, zodBody, zodQuery } from "./zod-validation.js";

describe("ZodValidationPipe", () => {
  it("valid body'yi parse eder ve trim uygular", () => {
    const pipe = zodBody(z.object({
      email: z.string().trim().email(),
    }).strict());

    expect(pipe.transform({ email: " admin@example.test " })).toEqual({ email: "admin@example.test" });
  });

  it("gecersiz body icin 422 ve alan hatasi uretir", () => {
    const pipe = zodBody(z.object({
      amount: z.number().int().positive(),
    }).strict());

    expect(() => pipe.transform({ amount: "100" })).toThrow(UnprocessableEntityException);
    try {
      pipe.transform({ amount: "100" });
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        error: {
          code: "VALIDATION_FAILED",
          message: "İstek gövdesi geçersiz.",
          details: {
            fields: [
              expect.objectContaining({
                code: expect.any(String),
                path: "amount",
              }),
            ],
          },
        },
      });
    }
  });

  it("gecersiz query icin 422 ve sorgu mesaji uretir", () => {
    const pipe = zodQuery(z.object({
      status: z.enum(["ACTIVE", "PASSIVE"]).optional(),
    }));

    expect(() => pipe.transform({ status: "UNKNOWN" })).toThrow(UnprocessableEntityException);
    try {
      pipe.transform({ status: "UNKNOWN" });
    } catch (error) {
      expect(error).toBeInstanceOf(UnprocessableEntityException);
      expect((error as UnprocessableEntityException).getResponse()).toEqual({
        error: {
          code: "VALIDATION_FAILED",
          message: "Sorgu parametreleri geçersiz.",
          details: {
            fields: [
              expect.objectContaining({
                code: expect.any(String),
                path: "status",
              }),
            ],
          },
        },
      });
    }
  });

  it("takvim dışı YYYY-MM-DD tarihlerini reddeder", () => {
    const pipe = zodBody(z.object({
      dueDate: requiredDateString("DATE_INVALID"),
    }).strict());

    expect(pipe.transform({ dueDate: "2024-02-29" })).toEqual({ dueDate: "2024-02-29" });
    expect(() => pipe.transform({ dueDate: "2026-02-29" })).toThrow(UnprocessableEntityException);
    expect(() => pipe.transform({ dueDate: "2026-99-99" })).toThrow(UnprocessableEntityException);
  });

  it("ISO benzeri olmayan veya takvim dışı datetime değerlerini reddeder", () => {
    const pipe = zodBody(z.object({
      startsAt: optionalIsoDateTime("DATETIME_INVALID"),
    }).strict());

    expect(pipe.transform({ startsAt: "2026-03-15T09:00" })).toEqual({ startsAt: "2026-03-15T09:00" });
    expect(pipe.transform({ startsAt: "2026-03-15T09:00:00.000Z" })).toEqual({ startsAt: "2026-03-15T09:00:00.000Z" });
    expect(pipe.transform({ startsAt: "2026-03-15" })).toEqual({ startsAt: "2026-03-15" });
    expect(() => pipe.transform({ startsAt: "2026-02-29T09:00" })).toThrow(UnprocessableEntityException);
    expect(() => pipe.transform({ startsAt: "15 Mart 2026" })).toThrow(UnprocessableEntityException);
  });

  it("metni tr-TR yerel ayarıyla büyük harfe çevirir (noktalı İ)", () => {
    const pipe = zodBody(z.object({
      firstName: requiredUppercaseString,
      section: optionalUppercaseString,
    }).strict());

    // "izel" -> "İZEL" (noktasız i değil); "ığdır" -> "IĞDIR"
    expect(pipe.transform({ firstName: " izel ", section: "ığdır" })).toEqual({ firstName: "İZEL", section: "IĞDIR" });
    expect(() => pipe.transform({ firstName: "   " })).toThrow(UnprocessableEntityException);
  });
});
