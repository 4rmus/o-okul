import { describe, expect, it } from "vitest";
import type { RequestContext } from "../context/request-context.js";
import { ParserConfigSuggestionService } from "./parser-config-suggestion.service.js";

const newPresetCases = [
  {
    preset: "OPTIK_129",
    examType: "TYT",
    nationalId: { kind: "fixed", start: 36, length: 11 },
    studentNo: { kind: "fixed", start: 11, length: 5 },
    bookletType: { kind: "fixed", start: 55, length: 1 },
    estimatedQuestionCount: 120,
    segments: [
      { start: 56, length: 40 },
      { start: 96, length: 20 },
      { start: 142, length: 40 },
      { start: 182, length: 20 },
    ],
  },
  {
    preset: "OPTIK_129",
    examType: "AYT",
    nationalId: { kind: "fixed", start: 36, length: 11 },
    studentNo: { kind: "fixed", start: 11, length: 5 },
    bookletType: { kind: "fixed", start: 55, length: 1 },
    estimatedQuestionCount: 160,
    segments: [
      { start: 56, length: 40 },
      { start: 96, length: 40 },
      { start: 142, length: 40 },
      { start: 182, length: 40 },
    ],
  },
  {
    preset: "YANIT",
    examType: "TYT",
    nationalId: { kind: "fixed", start: 12, length: 11 },
    studentNo: { kind: "fixed", start: 6, length: 6 },
    bookletType: { kind: "fixed", start: 48, length: 1 },
    estimatedQuestionCount: 120,
    segments: [
      { start: 49, length: 40 },
      { start: 95, length: 20 },
      { start: 141, length: 40 },
      { start: 187, length: 20 },
    ],
  },
  {
    preset: "YANIT",
    examType: "AYT",
    nationalId: { kind: "fixed", start: 12, length: 11 },
    studentNo: { kind: "fixed", start: 6, length: 6 },
    bookletType: { kind: "fixed", start: 48, length: 1 },
    estimatedQuestionCount: 160,
    segments: [
      { start: 49, length: 40 },
      { start: 95, length: 40 },
      { start: 141, length: 40 },
      { start: 187, length: 40 },
    ],
  },
  {
    preset: "OPTIK_840_LGS",
    examType: "LGS",
    nationalId: { kind: "fixed", start: 34, length: 11 },
    studentNo: { kind: "fixed", start: 9, length: 5 },
    bookletType: { kind: "fixed", start: 59, length: 1 },
    estimatedQuestionCount: 90,
    segments: [
      { start: 160, length: 20 },
      { start: 180, length: 10 },
      { start: 200, length: 10 },
      { start: 220, length: 10 },
      { start: 240, length: 20 },
      { start: 260, length: 20 },
    ],
  },
] as const;

describe("ParserConfigSuggestionService", () => {
  it("örnek metinden parser config önerisi üretir", async () => {
    const service = createService();

    const result = await service.suggest(createContext(), {
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

  it("base64 dosya içeriğini analiz eder", async () => {
    const service = createService();

    const result = await service.suggest(createContext(), {
      examId: "exam-a",
      fileBase64: Buffer.from("12345|A|ABCDE\n67890|B|BBCDE").toString("base64"),
    });

    expect(result.suggestion.delimiter).toBe("PIPE");
    expect(result.suggestion.skipHeaderLines).toBe(0);
  });

  it("OPTİK-7108 LGS presetini örnek dosya istemeden döndürür", async () => {
    const service = createService();

    const result = await service.suggest(createContext(), {
      examId: "exam-a",
      preset: "OPTIK_7108_LGS",
    });

    expect(result).toMatchObject({
      examId: "exam-a",
      status: "suggested",
      suggestion: {
        delimiter: "FIXED",
        skipHeaderLines: 0,
        confidence: "high",
        fieldMapping: {
          nationalId: { kind: "fixed", start: 37, length: 11 },
          studentNo: { kind: "fixed", start: 11, length: 4 },
          bookletType: { kind: "fixed", start: 50, length: 1 },
          answers: {
            kind: "fixed",
            estimatedQuestionCount: 90,
            segments: [
              { start: 51, length: 20 },
              { start: 71, length: 10 },
              { start: 91, length: 10 },
              { start: 111, length: 10 },
              { start: 131, length: 20 },
              { start: 151, length: 20 },
            ],
          },
        },
      },
    });
  });

  it.each(newPresetCases)("$preset presetini $examType sınavına göre ve fixture uyarısıyla döndürür", async (testCase) => {
    const service = createService(testCase.examType);

    const result = await service.suggest(createContext(), {
      examId: "exam-a",
      preset: testCase.preset,
    });

    expect(result).toMatchObject({
      examId: "exam-a",
      status: "suggested",
      suggestion: {
        delimiter: "FIXED",
        confidence: "medium",
        warnings: ["REAL_TXT_DAT_FIXTURE_NOT_VERIFIED"],
        fieldMapping: {
          nationalId: testCase.nationalId,
          studentNo: testCase.studentNo,
          bookletType: testCase.bookletType,
          answers: {
            kind: "fixed",
            estimatedQuestionCount: testCase.estimatedQuestionCount,
            segments: testCase.segments,
          },
        },
      },
    });
    expect(testCase.segments.reduce((total, segment) => total + segment.length, 0))
      .toBe(testCase.estimatedQuestionCount);
  });

  it("birleşik TYT/AYT presetini başka sınav türünde reddeder", async () => {
    const service = createService("LGS");

    await expect(service.suggest(createContext(), {
      examId: "exam-a",
      preset: "OPTIK_129",
    })).rejects.toThrow("FORMAT_ANALYZER_PRESET_TYT_AYT_EXAM_REQUIRED");
  });

  it("örnek yoksa analiz etmeden 400 döner", async () => {
    const service = createService();

    await expect(service.suggest(createContext(), {
      examId: "exam-a",
    })).rejects.toThrow("PARSER_CONFIG_SAMPLE_REQUIRED");
  });

  it("geçersiz sampleSize değerini 400 ile reddeder", async () => {
    const service = createService();

    await expect(service.suggest(createContext(), {
      examId: "exam-a",
      sampleText: "12345|A|ABCDE",
      sampleSize: 0,
    })).rejects.toThrow("PARSER_CONFIG_SAMPLE_SIZE_INVALID");
  });

  it("analyzer hatasını 400'e çevirir", async () => {
    const service = createService();

    await expect(service.suggest(createContext(), {
      examId: "exam-a",
      sampleText: "ogrenci_no\tkitapcik\tcevaplar",
    })).rejects.toMatchObject({ status: 400 });
  });

  it("tenant context yoksa reddeder", async () => {
    const service = createService();

    await expect(service.suggest({
      userId: "system",
      tenantId: null,
      roles: ["SYSTEM_ADMIN"],
      bypassRls: false,
    }, {
      examId: "exam-a",
      sampleText: "12345|A|ABCDE",
    })).rejects.toThrow("TENANT_CONTEXT_MISSING");
  });
});

function createService(examType = "TYT") {
  return new ParserConfigSuggestionService({
    async findById(tenantId, examId) {
      return {
        id: examId,
        tenantId,
        examType,
        title: "Deneme",
        status: "DRAFT",
        createdAt: "2026-07-26T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:00.000Z",
      };
    },
  });
}

function createContext(): RequestContext {
  return {
    userId: "user-a",
    tenantId: "tenant-a",
    roles: ["TENANT_ADMIN"],
    bypassRls: false,
  };
}
