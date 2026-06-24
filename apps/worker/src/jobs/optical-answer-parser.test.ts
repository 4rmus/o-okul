import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getParserConfigPresetSuggestion } from "./format-analyzer-service.js";
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
        bookletType: "A",
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

  it("OPTİK-7108 gerçek satırındaki sol boşluk dolgusunu fixed kolonlarda korur", () => {
    const parser = new OpticalAnswerParser();
    const firstLine = readFirstValidIsemARow();

    const result = parser.parse({
      ...createBaseInput(),
      content: firstLine,
      parserConfig: {
        delimiter: "FIXED",
        skipHeaderLines: 0,
        fieldMapping: {
          studentNo: { kind: "fixed", start: 11, length: 4 },
          bookletType: { kind: "fixed", start: 50, length: 1 },
          answers: { kind: "fixed", start: 51, length: 20, estimatedQuestionCount: 20 },
        },
      },
      participants: [{ participantId: "participant-real", participantNo: "102", bookletType: "A" }],
    });

    expect(result.unmatched).toEqual([]);
    expect(result.matched[0]).toMatchObject({
      participantId: "participant-real",
      rowNumber: 1,
      status: "MATCHED",
    });
    expect(result.matched[0]?.answers.map((item) => item.answer).join("")).toBe("CBCCDCBABDBCBDABCAAA");
  });

  it("OPTİK-7108 gerçek satırındaki bitişik olmayan ders bloklarını 90 soruya birleştirir", () => {
    const parser = new OpticalAnswerParser();
    const firstLine = readFirstValidIsemARow();

    const result = parser.parse({
      ...createBaseInput(),
      content: firstLine,
      parserConfig: {
        delimiter: "FIXED",
        skipHeaderLines: 0,
        fieldMapping: {
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
      participants: [{ participantId: "participant-real", participantNo: "102", bookletType: "A" }],
    });

    const answers = result.matched[0]?.answers ?? [];
    expect(result.unmatched).toEqual([]);
    expect(answers).toHaveLength(90);
    expect(answers[0]).toEqual({ questionNo: 1, answer: "C" });
    expect(answers[19]).toEqual({ questionNo: 20, answer: "A" });
    expect(answers[20]).toEqual({ questionNo: 21, answer: "B" });
    expect(answers[49]).toEqual({ questionNo: 50, answer: "C" });
    expect(answers[54]).toEqual({ questionNo: 55, answer: "" });
    expect(answers[57]).toEqual({ questionNo: 58, answer: "C" });
    expect(answers[89]).toEqual({ questionNo: 90, answer: "A" });
  });

  it("OPTİK-7108 LGS preset'i gerçek satırı 90 soruya parse eder", () => {
    const parser = new OpticalAnswerParser();
    const firstLine = readFirstValidIsemARow();
    const preset = getParserConfigPresetSuggestion("OPTIK_7108_LGS");

    const result = parser.parse({
      ...createBaseInput(),
      content: firstLine,
      parserConfig: preset,
      participants: [{ participantId: "participant-real", participantNo: "102", bookletType: "A" }],
    });

    expect(result.unmatched).toEqual([]);
    expect(result.matched[0]?.answers).toHaveLength(90);
    expect(result.matched[0]?.answers[54]).toEqual({ questionNo: 55, answer: "" });
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

  it("TC hash eşleşmesi varsa OKUL NO çakışmasında doğru participante bağlar", () => {
    const parser = new OpticalAnswerParser();

    const result = parser.parse({
      ...createBaseInput(),
      content: "tc\togrenci_no\tkitapcik\tcevaplar\n10000000146\t12345\tA\tABCDE",
      parserConfig: {
        delimiter: "TAB",
        skipHeaderLines: 1,
        fieldMapping: {
          nationalId: { kind: "delimited", column: 0 },
          studentNo: { kind: "delimited", column: 1 },
          bookletType: { kind: "delimited", column: 2 },
          answers: { kind: "delimited", column: 3, estimatedQuestionCount: 5 },
        },
      },
      participants: [
        { participantId: "participant-wrong", studentNo: "12345", bookletType: "A" },
        { participantId: "participant-right", studentNo: "98765", nationalIdHash: hashNationalId("10000000146"), bookletType: "A" },
      ],
    });

    expect(result.unmatched).toEqual([]);
    expect(result.matched[0]?.participantId).toBe("participant-right");
  });

  it("öğrenci no alanına TC geldiyse TC hash eşleşmesiyle participante bağlar", () => {
    const parser = new OpticalAnswerParser();

    const result = parser.parse({
      ...createBaseInput(),
      content: "ogrenci_no\tkitapcik\tcevaplar\n10000000146\tA\tABCDE",
      parserConfig: createDelimitedConfig(),
      participants: [
        { participantId: "participant-right", studentNo: "98765", nationalIdHash: hashNationalId("10000000146"), bookletType: "A" },
      ],
    });

    expect(result.unmatched).toEqual([]);
    expect(result.matched[0]).toMatchObject({
      participantId: "participant-right",
      bookletType: "A",
    });
  });

  it("öğrenci no alanındaki TC eşleşmezse karantinada TC değerini maskeler", () => {
    const parser = new OpticalAnswerParser();

    const result = parser.parse({
      ...createBaseInput(),
      content: "ogrenci_no\tkitapcik\tcevaplar\n10000000146\tA\tABCDE",
      parserConfig: createDelimitedConfig(),
      participants: [],
    });

    expect(result.matched).toEqual([]);
    expect(result.unmatched[0]).toMatchObject({
      reason: "STUDENT_NOT_FOUND",
      rawRow: {
        line: "*******0146\tA\tABCDE",
        studentNo: "*******0146",
      },
    });
    expect(result.unmatched[0]?.rawRow.line).not.toContain("10000000146");
    expect(result.unmatched[0]?.rawRow.studentNo).not.toContain("10000000146");
  });

  it("karantina raw satırında TC kimlik değerini maskeler", () => {
    const parser = new OpticalAnswerParser();

    const result = parser.parse({
      ...createBaseInput(),
      content: "tc\togrenci_no\tkitapcik\tcevaplar\n10000000146\t99999\tA\tABCDE",
      parserConfig: {
        delimiter: "TAB",
        skipHeaderLines: 1,
        fieldMapping: {
          nationalId: { kind: "delimited", column: 0 },
          studentNo: { kind: "delimited", column: 1 },
          bookletType: { kind: "delimited", column: 2 },
          answers: { kind: "delimited", column: 3, estimatedQuestionCount: 5 },
        },
      },
      participants: [],
    });

    expect(result.unmatched[0]).toMatchObject({
      reason: "STUDENT_NOT_FOUND",
      rawRow: {
        line: "*******0146\t99999\tA\tABCDE",
        studentNo: "99999",
      },
    });
    expect(result.unmatched[0]?.rawRow.line).not.toContain("10000000146");
  });

  it("64 karakter hex STUDENT_PII_HASH_KEY ile TC alanını parse eder", () => {
    const previous = process.env.STUDENT_PII_HASH_KEY;
    process.env.STUDENT_PII_HASH_KEY = "a".repeat(64);
    const parser = new OpticalAnswerParser();

    try {
      const result = parser.parse({
        ...createBaseInput(),
        content: "tc\togrenci_no\tkitapcik\tcevaplar\n10000000146\t99999\tA\tABCDE",
        parserConfig: {
          delimiter: "TAB",
          skipHeaderLines: 1,
          fieldMapping: {
            nationalId: { kind: "delimited", column: 0 },
            studentNo: { kind: "delimited", column: 1 },
            bookletType: { kind: "delimited", column: 2 },
            answers: { kind: "delimited", column: 3, estimatedQuestionCount: 5 },
          },
        },
        participants: [{ participantId: "participant-a", studentNo: "99999", bookletType: "A" }],
      });

      expect(result.unmatched).toEqual([]);
      expect(result.matched[0]?.participantId).toBe("participant-a");
    } finally {
      if (previous === undefined) {
        delete process.env.STUDENT_PII_HASH_KEY;
      } else {
        process.env.STUDENT_PII_HASH_KEY = previous;
      }
    }
  });

  it("çözülmüş karantina satırını verilen participante MATCHED ParsedAnswer yapar", () => {
    const parser = new OpticalAnswerParser();

    const result = parser.parseResolvedQuarantine({
      ...createBaseInput(),
      line: "99999\tA\tABCDE",
      rowNumber: 8,
      parserConfig: createDelimitedConfig(),
      participantId: "participant-resolved",
    });

    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      rawImportId: "raw-import-a",
      participantId: "participant-resolved",
      parserConfigVersion: "parser-v1",
      rowNumber: 8,
      bookletType: "A",
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

  it("çözülmüş karantina satırı cevap olarak bozuksa MATCHED üretmez", () => {
    const parser = new OpticalAnswerParser();

    expect(() => parser.parseResolvedQuarantine({
      ...createBaseInput(),
      line: "99999\tA\tABXDE",
      rowNumber: 8,
      parserConfig: createDelimitedConfig(),
      participantId: "participant-resolved",
    })).toThrow("OPTICAL_RESOLVED_QUARANTINE_ANSWER_PARSE_INVALID");
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

function readFirstValidIsemARow(): string {
  const row = readFileSync("../../ornek-veriler/iSEM .txt", "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .find((line) => line.length >= 171 && line.slice(50, 51).trim() === "A");
  if (!row) throw new Error("ISEM_VALID_A_ROW_MISSING");
  return row;
}

function hashNationalId(value: string): string {
  return createHmac("sha256", Buffer.from("22222222222222222222222222222222")).update(value).digest("hex");
}
