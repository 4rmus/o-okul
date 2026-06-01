import {
  type AnswerFieldSpec,
  type FieldSpec,
  type ParserConfigSuggestion,
  type ParserDelimiter,
} from "./format-analyzer-service.js";
import { type Choice, type StudentAnswer } from "./scoring-engine.js";

export interface OpticalAnswerParticipant {
  participantId: string;
  studentNo?: string | null;
  participantNo?: string | null;
  bookletType?: string | null;
}

export interface OpticalAnswerParserInput {
  tenantId: string;
  examId: string;
  rawImportId: string;
  parserConfigVersion: string;
  content: string | Buffer;
  parserConfig: Pick<ParserConfigSuggestion, "delimiter" | "skipHeaderLines" | "fieldMapping">;
  participants: OpticalAnswerParticipant[];
}

export interface MatchedParsedAnswer {
  tenantId: string;
  examId: string;
  rawImportId: string;
  participantId: string;
  parserConfigVersion: string;
  rowNumber: number;
  answers: StudentAnswer[];
  status: "MATCHED";
}

export type ImportQuarantineReason =
  | "STUDENT_NOT_FOUND"
  | "DUPLICATE_MATCH"
  | "ANSWER_PARSE_INVALID"
  | "ABSENT_MARKER";

export interface UnmatchedParsedAnswer {
  tenantId: string;
  examId: string;
  rawImportId: string;
  rowNumber: number;
  rawRow: {
    line: string;
    studentNo: string;
    bookletType: string;
    warnings: string[];
  };
  reason: ImportQuarantineReason;
}

export interface OpticalAnswerParseResult {
  matched: MatchedParsedAnswer[];
  unmatched: UnmatchedParsedAnswer[];
}

interface ParsedOpticalRow {
  rowNumber: number;
  line: string;
  studentNo: string;
  bookletType: string;
  answers: StudentAnswer[];
  rawAnswers: string;
  warnings: string[];
}

export class OpticalAnswerParser {
  parse(input: OpticalAnswerParserInput): OpticalAnswerParseResult {
    validateInput(input);

    const lines = normalizeLines(input.content);
    const dataLines = lines.slice(input.parserConfig.skipHeaderLines);
    if (dataLines.length === 0) {
      throw new Error("OPTICAL_PARSE_DATA_LINE_MISSING");
    }

    const matched: MatchedParsedAnswer[] = [];
    const unmatched: UnmatchedParsedAnswer[] = [];

    for (const [index, line] of dataLines.entries()) {
      const row = parseLine(line, input.parserConfig, index + input.parserConfig.skipHeaderLines + 1);
      const reason = getQuarantineReason(row, input.parserConfig.fieldMapping.absentMarker);
      if (reason) {
        unmatched.push(toUnmatched(input, row, reason));
        continue;
      }

      const candidates = findParticipants(row, input.participants);
      if (candidates.length === 0) {
        unmatched.push(toUnmatched(input, row, "STUDENT_NOT_FOUND"));
        continue;
      }
      if (candidates.length > 1) {
        unmatched.push(toUnmatched(input, row, "DUPLICATE_MATCH"));
        continue;
      }

      matched.push({
        tenantId: input.tenantId,
        examId: input.examId,
        rawImportId: input.rawImportId,
        participantId: candidates[0]!.participantId,
        parserConfigVersion: input.parserConfigVersion,
        rowNumber: row.rowNumber,
        answers: row.answers,
        status: "MATCHED",
      });
    }

    return { matched, unmatched };
  }
}

function validateInput(input: OpticalAnswerParserInput): void {
  if (!input.tenantId || !input.examId || !input.rawImportId || !input.parserConfigVersion) {
    throw new Error("OPTICAL_PARSE_INPUT_INVALID");
  }
}

function parseLine(
  line: string,
  parserConfig: OpticalAnswerParserInput["parserConfig"],
  rowNumber: number,
): ParsedOpticalRow {
  const warnings: string[] = [];
  const studentNo = extractField(line, parserConfig.delimiter, parserConfig.fieldMapping.studentNo).trim();
  const bookletType = extractField(line, parserConfig.delimiter, parserConfig.fieldMapping.bookletType).trim();
  const rawAnswers = extractAnswerField(line, parserConfig.delimiter, parserConfig.fieldMapping.answers);

  if (!studentNo) {
    warnings.push("STUDENT_NO_MISSING");
  }
  if (!bookletType) {
    warnings.push("BOOKLET_TYPE_MISSING");
  }

  return {
    rowNumber,
    line,
    studentNo,
    bookletType,
    rawAnswers,
    answers: toStudentAnswers(rawAnswers, parserConfig.fieldMapping.answers, warnings),
    warnings,
  };
}

function normalizeLines(content: string | Buffer): string[] {
  const text = Buffer.isBuffer(content) ? content.toString("utf8") : content;
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function extractField(line: string, delimiter: ParserDelimiter, spec: FieldSpec): string {
  if (spec.kind === "fixed") {
    return line.slice(spec.start, spec.start + spec.length);
  }

  return splitLine(line, delimiter)[spec.column] ?? "";
}

function extractAnswerField(line: string, delimiter: ParserDelimiter, spec: AnswerFieldSpec): string {
  if (spec.kind === "fixed") {
    return line.slice(spec.start ?? 0, (spec.start ?? 0) + (spec.length ?? 0));
  }

  return splitLine(line, delimiter)[spec.column ?? 0] ?? "";
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

function toStudentAnswers(
  rawAnswers: string,
  spec: AnswerFieldSpec,
  warnings: string[],
): StudentAnswer[] {
  const answerChars = Array.from(rawAnswers.toUpperCase());
  if (answerChars.length !== spec.estimatedQuestionCount) {
    warnings.push("ANSWER_COUNT_MISMATCH");
  }

  return Array.from({ length: spec.estimatedQuestionCount }, (_unused, index) => ({
    questionNo: index + 1,
    answer: toChoice(answerChars[index], warnings),
  }));
}

function toChoice(value: string | undefined, warnings: string[]): Choice {
  if (value === undefined || value === "" || value === " " || value === "." || value === "-") {
    return "";
  }
  if (value === "A" || value === "B" || value === "C" || value === "D" || value === "E") {
    return value;
  }

  warnings.push("INVALID_ANSWER_CHOICE");
  return "";
}

function getQuarantineReason(
  row: ParsedOpticalRow,
  absentMarker: string | undefined,
): ImportQuarantineReason | undefined {
  if (absentMarker && row.rawAnswers.trim() === absentMarker) {
    return "ABSENT_MARKER";
  }
  if (row.warnings.includes("INVALID_ANSWER_CHOICE") || row.warnings.includes("ANSWER_COUNT_MISMATCH")) {
    return "ANSWER_PARSE_INVALID";
  }
  return undefined;
}

function findParticipants(
  row: ParsedOpticalRow,
  participants: OpticalAnswerParticipant[],
): OpticalAnswerParticipant[] {
  const candidates = participants.filter((participant) =>
    [participant.studentNo, participant.participantNo].some((value) => value === row.studentNo),
  );
  const bookletMatches = candidates.filter((participant) =>
    participant.bookletType && participant.bookletType === row.bookletType,
  );
  return bookletMatches.length > 0 ? bookletMatches : candidates;
}

function toUnmatched(
  input: OpticalAnswerParserInput,
  row: ParsedOpticalRow,
  reason: ImportQuarantineReason,
): UnmatchedParsedAnswer {
  return {
    tenantId: input.tenantId,
    examId: input.examId,
    rawImportId: input.rawImportId,
    rowNumber: row.rowNumber,
    rawRow: {
      line: row.line,
      studentNo: row.studentNo,
      bookletType: row.bookletType,
      warnings: row.warnings,
    },
    reason,
  };
}
