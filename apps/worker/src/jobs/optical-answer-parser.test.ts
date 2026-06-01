import { describe, expect, it } from "vitest";
import { OpticalAnswerParser } from "./optical-answer-parser.js";
import type { ParserConfigSuggestion } from "./format-analyzer-service.js";

describe("OpticalAnswerParser", () => {
  it("başlıklı TAB içeriğini MATCHED ParsedAnswer adayına çevirir", () => {
    const parser = new OpticalAnswerParser();

    const result = parser.parse({
      ...createBaseInput(),
      content: [
        "ogrenci_no\tkitapcik\tcevaplar",
        "12345\tA\tABCDE",
      ].join("\n"),
      parserConfig: createDelimitedConfig(),
      participants: [{ participantId: "participant-a", studentNo: "12345", bookletType: "A" }],
    });

    expect(result).toEqual({
      matched: [{
        tenantId: "tenant-a",
        examId: "exam-a",
        rawImportId: "raw-import-a",
        participantId: "participant-a",
        parserConfigVersion: "parser-v1",
        rowNumber: 2,
        answers: [
          { questionNo: 1, answer: "A" },
          { questionNo: 2, answer: "B" },
          { questionNo: 3, answer: "C" },
          { questionNo: 4, answer: "D" },
          { questionNo: 5, answer: "E" },
        ],
        status: "MATCHED",
      }],
      unmatched: [],
    });
  });

  it("fixed-width içeriği participantNo üzerinden eşleştirir", () => {
    const parser = new OpticalAnswerParser();

    const result = parser.parse({
      ...createBaseInput(),
      content: Buffer.from("123456AABCDE"),
      parserConfig: {
        delimiter: "FIXED",
        skipHeaderLines: 0,
        fieldMapping: {
          studentNo: { kind: "fixed", start: 0, length: 6 },
          bookletType: { kind: "fixed", start: 6, length: 1 },
          answers: { kind: "fixed", start: 7, length: 5, estimatedQuestionCount: 5 },
        },
      },
      participants: [{ participantId: "participant-a", participantNo: "123456", bookletType: "A" }],
    });

    expect(result.matched[0]).toMatchObject({
      participantId: "participant-a",
      rowNumber: 1,
      answers: [
        { questionNo: 1, answer: "A" },
        { questionNo: 2, answer: "B" },
        { questionNo: 3, answer: "C" },
        { questionNo: 4, answer: "D" },
        { questionNo: 5, answer: "E" },
      ],
      status: "MATCHED",
    });
  });

  it("öğrenci bulunamazsa ImportQuarantine adayı döndürür", () => {
    const parser = new OpticalAnswerParser();

    const result = parser.parse({
      ...createBaseInput(),
      content: "ogrenci_no\tkitapcik\tcevaplar\n99999\tA\tABCDE",
      parserConfig: createDelimitedConfig(),
      participants: [{ participantId: "participant-a", studentNo: "12345", bookletType: "A" }],
    });

    expect(result).toEqual({
      matched: [],
      unmatched: [{
        tenantId: "tenant-a",
        examId: "exam-a",
        rawImportId: "raw-import-a",
        rowNumber: 2,
        rawRow: {
          line: "99999\tA\tABCDE",
          studentNo: "99999",
          bookletType: "A",
          warnings: [],
        },
        reason: "STUDENT_NOT_FOUND",
      }],
    });
  });

  it("aynı öğrenci birden fazla participante denk gelirse duplicate quarantine döndürür", () => {
    const parser = new OpticalAnswerParser();

    const result = parser.parse({
      ...createBaseInput(),
      content: "ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABCDE",
      parserConfig: createDelimitedConfig(),
      participants: [
        { participantId: "participant-a", studentNo: "12345" },
        { participantId: "participant-b", participantNo: "12345" },
      ],
    });

    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]?.reason).toBe("DUPLICATE_MATCH");
  });

  it("geçersiz cevap karakterini ANSWER_PARSE_INVALID quarantine olarak döndürür", () => {
    const parser = new OpticalAnswerParser();

    const result = parser.parse({
      ...createBaseInput(),
      content: "ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABXDE",
      parserConfig: createDelimitedConfig(),
      participants: [{ participantId: "participant-a", studentNo: "12345", bookletType: "A" }],
    });

    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]).toMatchObject({
      reason: "ANSWER_PARSE_INVALID",
      rawRow: {
        studentNo: "12345",
        bookletType: "A",
        warnings: ["INVALID_ANSWER_CHOICE"],
      },
    });
  });

  it("absent marker satırını ayrı quarantine sebebiyle döndürür", () => {
    const parser = new OpticalAnswerParser();

    const result = parser.parse({
      ...createBaseInput(),
      content: "ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABSENT",
      parserConfig: {
        ...createDelimitedConfig(),
        fieldMapping: {
          ...createDelimitedConfig().fieldMapping,
          absentMarker: "ABSENT",
        },
      },
      participants: [{ participantId: "participant-a", studentNo: "12345", bookletType: "A" }],
    });

    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]?.reason).toBe("ABSENT_MARKER");
  });

  it("data satırı yoksa net hata verir", () => {
    const parser = new OpticalAnswerParser();

    expect(() =>
      parser.parse({
        ...createBaseInput(),
        content: "ogrenci_no\tkitapcik\tcevaplar",
        parserConfig: createDelimitedConfig(),
        participants: [],
      }),
    ).toThrow("OPTICAL_PARSE_DATA_LINE_MISSING");
  });
});

function createBaseInput() {
  return {
    tenantId: "tenant-a",
    examId: "exam-a",
    rawImportId: "raw-import-a",
    parserConfigVersion: "parser-v1",
  };
}

function createDelimitedConfig(): Pick<ParserConfigSuggestion, "delimiter" | "skipHeaderLines" | "fieldMapping"> {
  return {
    delimiter: "TAB",
    skipHeaderLines: 1,
    fieldMapping: {
      studentNo: { kind: "delimited", column: 0 },
      bookletType: { kind: "delimited", column: 1 },
      answers: { kind: "delimited", column: 2, estimatedQuestionCount: 5 },
    },
  };
}
