import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { ParserConfigSuggestionService } from "./parser-config-suggestion.service.js";

describe("ParserConfigSuggestionService", () => {
  it("örnek metinden parser config önerisi üretir", () => {
    const service = new ParserConfigSuggestionService();

    const result = service.suggest(createContext(), {
      examId: "exam-a",
      sampleText: "ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABCDE",
    });

    expect(result).toMatchObject({
      examId: "exam-a",
      status: "suggested",
      suggestion: {
        encoding: "UTF-8",
        delimiter: "TAB",
        skipHeaderLines: 1,
        confidence: "high",
        fieldMapping: {
          studentNo: { kind: "delimited", column: 0 },
          bookletType: { kind: "delimited", column: 1 },
          answers: { kind: "delimited", column: 2, estimatedQuestionCount: 5 },
        },
      },
    });
  });

  it("base64 dosya içeriğini analiz eder", () => {
    const service = new ParserConfigSuggestionService();

    const result = service.suggest(createContext(), {
      examId: "exam-a",
      fileBase64: Buffer.from("12345|A|ABCDE\n67890|B|BBCDE").toString("base64"),
    });

    expect(result.suggestion.delimiter).toBe("PIPE");
    expect(result.suggestion.skipHeaderLines).toBe(0);
  });

  it("örnek yoksa analiz etmeden 400 döner", () => {
    const service = new ParserConfigSuggestionService();

    expect(() => service.suggest(createContext(), {
      examId: "exam-a",
    })).toThrow("PARSER_CONFIG_SAMPLE_REQUIRED");
  });

  it("geçersiz sampleSize değerini 400 ile reddeder", () => {
    const service = new ParserConfigSuggestionService();

    expect(() => service.suggest(createContext(), {
      examId: "exam-a",
      sampleText: "12345|A|ABCDE",
      sampleSize: 0,
    })).toThrow("PARSER_CONFIG_SAMPLE_SIZE_INVALID");
  });

  it("analyzer hatasını 400'e çevirir", () => {
    const service = new ParserConfigSuggestionService();

    try {
      service.suggest(createContext(), {
        examId: "exam-a",
        sampleText: "ogrenci_no\tkitapcik\tcevaplar",
      });
      throw new Error("EXPECTED_ERROR");
    } catch (error) {
      expect(error).toMatchObject({ status: 400 });
    }
  });

  it("tenant context yoksa reddeder", () => {
    const service = new ParserConfigSuggestionService();

    expect(() => service.suggest({
      userId: "system",
      tenantId: null,
      roles: ["SYSTEM_ADMIN"],
      bypassRls: false,
    }, {
      examId: "exam-a",
      sampleText: "12345|A|ABCDE",
    })).toThrow("TENANT_CONTEXT_MISSING");
  });
});

function createContext(): RequestContext {
  return {
    userId: "user-a",
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    bypassRls: false,
  };
}
