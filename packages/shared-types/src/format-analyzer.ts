export type ParserEncoding = "UTF-8" | "ISO-8859-9" | "CP1254";
export type ParserDelimiter = "TAB" | "COMMA" | "PIPE" | "FIXED";

export type FieldSpec =
  | { kind: "delimited"; column: number }
  | { kind: "fixed"; start: number; length: number };

export interface AnswerFieldSpec {
  kind: FieldSpec["kind"];
  column?: number;
  start?: number;
  length?: number;
  estimatedQuestionCount: number;
}

export interface ParserConfigSuggestion {
  encoding: ParserEncoding;
  delimiter: ParserDelimiter;
  skipHeaderLines: number;
  fieldMapping: {
    studentNo: FieldSpec;
    bookletType: FieldSpec;
    answers: AnswerFieldSpec;
    absentMarker?: string;
  };
  version: 1;
  confidence: "low" | "medium" | "high";
  warnings: string[];
}

export interface FormatAnalyzerInput {
  sampleText?: string;
  content?: string | Uint8Array;
  sampleSize?: number;
}

interface DelimiterCandidate {
  delimiter: Exclude<ParserDelimiter, "FIXED">;
  separator: string;
}

const delimiterCandidates: DelimiterCandidate[] = [
  { delimiter: "TAB", separator: "\t" },
  { delimiter: "PIPE", separator: "|" },
  { delimiter: "COMMA", separator: "," },
];

export class FormatAnalyzerService {
  analyze(input: FormatAnalyzerInput): ParserConfigSuggestion {
    const sampleText = getSampleText(input);
    const lines = normalizeLines(sampleText);
    if (lines.length === 0) {
      throw new Error("FORMAT_ANALYZER_SAMPLE_EMPTY");
    }

    const delimiter = detectDelimiter(lines);
    const firstLine = lines[0]!;
    const skipHeaderLines = hasHeader(firstLine, delimiter) ? 1 : 0;
    const dataLine = lines[skipHeaderLines];
    if (!dataLine) {
      throw new Error("FORMAT_ANALYZER_DATA_LINE_MISSING");
    }

    const warnings: string[] = [];
    if (sampleText.includes("\uFFFD")) {
      warnings.push("ENCODING_REPLACEMENT_CHARACTER_FOUND");
    }
    if (hasStableSeparator(lines, ";")) {
      warnings.push("SEMICOLON_DELIMITER_NOT_SUPPORTED");
    }

    if (delimiter === "FIXED") {
      return createFixedSuggestion(dataLine, skipHeaderLines, warnings);
    }

    return createDelimitedSuggestion(firstLine, dataLine, delimiter, skipHeaderLines, warnings);
  }
}

function getSampleText(input: FormatAnalyzerInput): string {
  const content = input.sampleText ?? input.content;
  if (content === undefined) {
    throw new Error("FORMAT_ANALYZER_SAMPLE_EMPTY");
  }

  const text = typeof content === "string" ? content : new TextDecoder("utf-8").decode(content);
  return input.sampleSize === undefined ? text : text.slice(0, input.sampleSize);
}

function normalizeLines(sampleText: string): string[] {
  return sampleText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function detectDelimiter(lines: string[]): ParserDelimiter {
  let best: { delimiter: ParserDelimiter; score: number } = { delimiter: "FIXED", score: 0 };

  for (const candidate of delimiterCandidates) {
    const columnCounts = lines
      .slice(0, 5)
      .map((line) => line.split(candidate.separator).length)
      .filter((count) => count > 1);
    if (columnCounts.length === 0) {
      continue;
    }

    const mostCommonCount = mode(columnCounts);
    const score = columnCounts.filter((count) => count === mostCommonCount).length * mostCommonCount;
    if (score > best.score) {
      best = { delimiter: candidate.delimiter, score };
    }
  }

  return best.delimiter;
}

function hasStableSeparator(lines: string[], separator: string): boolean {
  const columnCounts = lines
    .slice(0, 5)
    .map((line) => line.split(separator).length)
    .filter((count) => count > 1);
  if (columnCounts.length === 0) {
    return false;
  }

  const mostCommonCount = mode(columnCounts);
  return columnCounts.filter((count) => count === mostCommonCount).length >= 2;
}

function hasHeader(firstLine: string, delimiter: ParserDelimiter): boolean {
  const values = splitLine(firstLine, delimiter).map((value) => normalizeToken(value));
  return values.some((value) =>
    [
      "studentno",
      "studentnumber",
      "ogrencino",
      "ogrencinumarasi",
      "kitapcik",
      "booklet",
      "answers",
      "cevaplar",
    ].includes(value),
  );
}

function createDelimitedSuggestion(
  headerLine: string,
  dataLine: string,
  delimiter: Exclude<ParserDelimiter, "FIXED">,
  skipHeaderLines: number,
  warnings: string[],
): ParserConfigSuggestion {
  const headerValues = splitLine(headerLine, delimiter);
  const dataValues = splitLine(dataLine, delimiter);
  const studentNoColumn = findColumn(headerValues, ["studentno", "studentnumber", "ogrencino", "ogrencinumarasi"]) ?? 0;
  const bookletColumn = findColumn(headerValues, ["booklet", "kitapcik"]) ?? 1;
  const answersColumn = findColumn(headerValues, ["answers", "cevaplar"]) ?? Math.min(2, dataValues.length - 1);
  const answerValue = dataValues[answersColumn] ?? "";

  return {
    encoding: "UTF-8",
    delimiter,
    skipHeaderLines,
    fieldMapping: {
      studentNo: { kind: "delimited", column: studentNoColumn },
      bookletType: { kind: "delimited", column: bookletColumn },
      answers: {
        kind: "delimited",
        column: answersColumn,
        estimatedQuestionCount: countAnswerChars(answerValue),
      },
    },
    version: 1,
    confidence: skipHeaderLines === 1 ? "high" : "medium",
    warnings,
  };
}

function createFixedSuggestion(
  dataLine: string,
  skipHeaderLines: number,
  warnings: string[],
): ParserConfigSuggestion {
  const studentNoMatch = dataLine.match(/\d+/);
  const studentStart = studentNoMatch?.index ?? 0;
  const studentLength = studentNoMatch?.[0].length ?? Math.min(8, dataLine.length);
  const afterStudent = studentStart + studentLength;
  const bookletMatch = dataLine.slice(afterStudent).match(/[A-Z]/i);
  const bookletStart = bookletMatch?.index === undefined ? afterStudent : afterStudent + bookletMatch.index;
  const answersStart = bookletStart + 1;

  if (!studentNoMatch) {
    warnings.push("STUDENT_NO_NOT_DETECTED");
  }
  if (!bookletMatch) {
    warnings.push("BOOKLET_TYPE_NOT_DETECTED");
  }

  return {
    encoding: "UTF-8",
    delimiter: "FIXED",
    skipHeaderLines,
    fieldMapping: {
      studentNo: { kind: "fixed", start: studentStart, length: studentLength },
      bookletType: { kind: "fixed", start: bookletStart, length: 1 },
      answers: {
        kind: "fixed",
        start: answersStart,
        length: Math.max(dataLine.length - answersStart, 0),
        estimatedQuestionCount: countAnswerChars(dataLine.slice(answersStart)),
      },
    },
    version: 1,
    confidence: studentNoMatch && bookletMatch ? "medium" : "low",
    warnings,
  };
}

function splitLine(line: string, delimiter: ParserDelimiter): string[] {
  if (delimiter === "TAB") {
    return line.split("\t").map((value) => value.trim());
  }
  if (delimiter === "PIPE") {
    return line.split("|").map((value) => value.trim());
  }
  if (delimiter === "COMMA") {
    return line.split(",").map((value) => value.trim());
  }
  return [line];
}

function findColumn(values: string[], names: string[]): number | undefined {
  const index = values.findIndex((value) => names.includes(normalizeToken(value)));
  return index >= 0 ? index : undefined;
}

function normalizeToken(value: string): string {
  return value
    .toLocaleLowerCase("tr-TR")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-z0-9]/g, "");
}

function countAnswerChars(value: string): number {
  return Array.from(value.toUpperCase()).filter((char) => ["A", "B", "C", "D", "E"].includes(char)).length;
}

function mode(values: number[]): number {
  const counts = new Map<number, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return values.reduce((best, value) => (counts.get(value)! > counts.get(best)! ? value : best), values[0]!);
}
