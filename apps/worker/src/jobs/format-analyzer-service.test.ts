import { describe, expect, it } from "vitest";
import { FormatAnalyzerService } from "./format-analyzer-service.js";

describe("FormatAnalyzerService", () => {
  it("başlıklı TAB örneğinde kolon haritası önerir", () => {
    const service = new FormatAnalyzerService();

    const result = service.analyze({
      sampleText: [
        "ogrenci_no\tkitapcik\tcevaplar",
        "12345\tA\tABCDE",
        "67890\tB\tBBCDE",
      ].join("\n"),
    });

    expect(result).toMatchObject({
      encoding: "UTF-8",
      delimiter: "TAB",
      skipHeaderLines: 1,
      confidence: "high",
      fieldMapping: {
        studentNo: { kind: "delimited", column: 0 },
        bookletType: { kind: "delimited", column: 1 },
        answers: { kind: "delimited", column: 2, estimatedQuestionCount: 5 },
      },
      version: 1,
    });
  });

  it("Buffer içeriğini okuyup örnek boyutuyla sınırlar", () => {
    const service = new FormatAnalyzerService();

    const result = service.analyze({
      content: Buffer.from("ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABCDE\nIGNORED"),
      sampleSize: "ogrenci_no\tkitapcik\tcevaplar\n12345\tA\tABCDE".length,
    });

    expect(result.delimiter).toBe("TAB");
    expect(result.fieldMapping.answers.estimatedQuestionCount).toBe(5);
  });

  it("PIPE örneğinde başlık yoksa varsayılan kolon sırasını kullanır", () => {
    const service = new FormatAnalyzerService();

    const result = service.analyze({
      sampleText: [
        "12345|A|ABCDE",
        "67890|B|BBCDE",
      ].join("\n"),
    });

    expect(result.delimiter).toBe("PIPE");
    expect(result.skipHeaderLines).toBe(0);
    expect(result.confidence).toBe("medium");
    expect(result.fieldMapping.answers).toMatchObject({
      kind: "delimited",
      column: 2,
      estimatedQuestionCount: 5,
    });
  });

  it("ayraç bulunamazsa fixed-width başlangıçlarını tahmin eder", () => {
    const service = new FormatAnalyzerService();

    const result = service.analyze({
      sampleText: "123456AABCDE\n234567BBBBBA",
    });

    expect(result).toMatchObject({
      delimiter: "FIXED",
      skipHeaderLines: 0,
      confidence: "medium",
      fieldMapping: {
        studentNo: { kind: "fixed", start: 0, length: 6 },
        bookletType: { kind: "fixed", start: 6, length: 1 },
        answers: { kind: "fixed", start: 7, length: 5, estimatedQuestionCount: 5 },
      },
    });
  });

  it("boş örneği reddeder", () => {
    const service = new FormatAnalyzerService();

    expect(() => service.analyze({ sampleText: "\n\n" })).toThrow("FORMAT_ANALYZER_SAMPLE_EMPTY");
  });

  it("belirsiz ve bozuk karakterli örnekte düşük güven ve uyarı döner", () => {
    const service = new FormatAnalyzerService();

    const result = service.analyze({
      sampleText: "ad;soyad;cevap\nAli�;Veli�;ABCDE\nAyse;Yilmaz;BBCDE",
    });

    expect(result.delimiter).toBe("FIXED");
    expect(result.confidence).toBe("low");
    expect(result.warnings).toEqual(expect.arrayContaining([
      "ENCODING_REPLACEMENT_CHARACTER_FOUND",
      "SEMICOLON_DELIMITER_NOT_SUPPORTED",
      "STUDENT_NO_NOT_DETECTED",
    ]));
  });
});
