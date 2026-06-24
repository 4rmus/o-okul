import { createHmac } from "node:crypto";
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
  nationalIdHash?: string | null;
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

export interface ResolvedQuarantineParseInput {
  tenantId: string;
  examId: string;
  rawImportId: string;
  parserConfigVersion: string;
  line: string;
  rowNumber: number;
  parserConfig: Pick<ParserConfigSuggestion, "delimiter" | "skipHeaderLines" | "fieldMapping">;
  participantId: string;
}

export interface MatchedParsedAnswer {
  tenantId: string;
  examId: string;
  rawImportId: string;
  participantId: string;
  parserConfigVersion: string;
  rowNumber: number;
  bookletType: string;
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
  maskedLine: string;
  studentNo: string;
  nationalIdHash?: string;
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
      const normalizedLine = normalizeFixedWidthLine(line, input.parserConfig.delimiter);
      const row = parseLine(normalizedLine, input.parserConfig, index + input.parserConfig.skipHeaderLines + 1);
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
        bookletType: row.bookletType,
        answers: row.answers,
        status: "MATCHED",
      });
    }

    return { matched, unmatched };
  }

  parseResolvedQuarantine(input: ResolvedQuarantineParseInput): MatchedParsedAnswer {
    validateResolvedInput(input);

    const row = parseLine(normalizeFixedWidthLine(input.line, input.parserConfig.delimiter), input.parserConfig, input.rowNumber);
    const reason = getQuarantineReason(row, input.parserConfig.fieldMapping.absentMarker);
    if (reason) {
      throw new Error(`OPTICAL_RESOLVED_QUARANTINE_${reason}`);
    }

    return {
      tenantId: input.tenantId,
      examId: input.examId,
      rawImportId: input.rawImportId,
      participantId: input.participantId,
      parserConfigVersion: input.parserConfigVersion,
      rowNumber: row.rowNumber,
      bookletType: row.bookletType,
      answers: row.answers,
      status: "MATCHED",
    };
  }
}

function validateInput(input: OpticalAnswerParserInput): void {
  if (!input.tenantId || !input.examId || !input.rawImportId || !input.parserConfigVersion) {
    throw new Error("OPTICAL_PARSE_INPUT_INVALID");
  }
}

function validateResolvedInput(input: ResolvedQuarantineParseInput): void {
  if (
    !input.tenantId ||
    !input.examId ||
    !input.rawImportId ||
    !input.parserConfigVersion ||
    !input.participantId ||
    !Number.isInteger(input.rowNumber) ||
    input.rowNumber <= 0
  ) {
    throw new Error("OPTICAL_RESOLVED_QUARANTINE_INPUT_INVALID");
  }
}

function parseLine(
  line: string,
  parserConfig: OpticalAnswerParserInput["parserConfig"],
  rowNumber: number,
): ParsedOpticalRow {
  const warnings: string[] = [];
  const nationalId = parserConfig.fieldMapping.nationalId
    ? extractField(line, parserConfig.delimiter, parserConfig.fieldMapping.nationalId).trim()
    : "";
  const studentNo = extractField(line, parserConfig.delimiter, parserConfig.fieldMapping.studentNo).trim();
  const bookletType = extractField(line, parserConfig.delimiter, parserConfig.fieldMapping.bookletType).trim();
  const rawAnswers = extractAnswerField(line, parserConfig.delimiter, parserConfig.fieldMapping.answers);
  const maskedLine = maskSensitiveFields(line, parserConfig, studentNo);

  if (!studentNo) {
    warnings.push("STUDENT_NO_MISSING");
  }
  if (!bookletType) {
    warnings.push("BOOKLET_TYPE_MISSING");
  }

  return {
    rowNumber,
    line,
    maskedLine,
    studentNo,
    ...(nationalId ? { nationalIdHash: toNationalIdHash(nationalId, warnings) } : {}),
    bookletType,
    rawAnswers,
    answers: toStudentAnswers(rawAnswers, parserConfig.fieldMapping.answers, warnings),
    warnings,
  };
}

function maskSensitiveFields(
  line: string,
  parserConfig: OpticalAnswerParserInput["parserConfig"],
  studentNo: string,
): string {
  if (parserConfig.fieldMapping.nationalId) {
    return maskField(line, parserConfig.delimiter, parserConfig.fieldMapping.nationalId);
  }
  if (isNationalIdCandidate(studentNo)) {
    return maskField(line, parserConfig.delimiter, parserConfig.fieldMapping.studentNo);
  }
  return line;
}

function normalizeLines(content: string | Buffer): string[] {
  const text = Buffer.isBuffer(content) ? content.toString("utf8") : content;
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);
}

function normalizeFixedWidthLine(line: string, delimiter: ParserDelimiter): string {
  if (delimiter !== "FIXED" || !line.includes("\t")) {
    return line;
  }

  let normalized = "";
  let column = 0;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]!;
    if (char === "\t") {
      const spaceCount = 8 - (column % 8);
      normalized += " ".repeat(spaceCount);
      column += spaceCount;
      continue;
    }
    normalized += char;
    column += 1;
  }
  return normalized;
}

function extractField(line: string, delimiter: ParserDelimiter, spec: FieldSpec): string {
  if (spec.kind === "fixed") {
    return line.slice(spec.start, spec.start + spec.length);
  }

  return splitLine(line, delimiter)[spec.column] ?? "";
}

function extractAnswerField(line: string, delimiter: ParserDelimiter, spec: AnswerFieldSpec): string {
  if (spec.kind === "fixed") {
    if (spec.segments?.length) {
      return spec.segments.map((segment) => line.slice(segment.start, segment.start + segment.length)).join("");
    }
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
  const nationalIdHashes = [row.nationalIdHash, toNationalIdHashCandidate(row.studentNo)].filter(
    (value): value is string => Boolean(value),
  );
  const nationalIdCandidates = participants.filter((participant) =>
    participant.nationalIdHash && nationalIdHashes.includes(participant.nationalIdHash),
  );
  if (nationalIdCandidates.length > 0) {
    return preferBookletMatch(row, nationalIdCandidates);
  }

  const candidates = participants.filter((participant) =>
    [participant.studentNo, participant.participantNo].some((value) => value === row.studentNo),
  );
  return preferBookletMatch(row, candidates);
}

function preferBookletMatch(
  row: ParsedOpticalRow,
  candidates: OpticalAnswerParticipant[],
): OpticalAnswerParticipant[] {
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
      line: row.maskedLine,
      studentNo: isNationalIdCandidate(row.studentNo) ? maskNationalId(row.studentNo) : row.studentNo,
      bookletType: row.bookletType,
      warnings: row.warnings,
    },
    reason,
  };
}

function toNationalIdHash(value: string, warnings: string[]): string | undefined {
  const normalized = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(normalized)) {
    warnings.push("NATIONAL_ID_INVALID");
    return undefined;
  }
  return createHmac("sha256", getNationalIdHashKey()).update(normalized).digest("hex");
}

function toNationalIdHashCandidate(value: string): string | undefined {
  const normalized = value.replace(/\D/g, "");
  if (!isNationalIdCandidate(normalized)) {
    return undefined;
  }
  return createHmac("sha256", getNationalIdHashKey()).update(normalized).digest("hex");
}

function isNationalIdCandidate(value: string): boolean {
  return /^\d{11}$/.test(value.replace(/\D/g, ""));
}

function maskField(line: string, delimiter: ParserDelimiter, spec: FieldSpec): string {
  if (spec.kind === "fixed") {
    const value = line.slice(spec.start, spec.start + spec.length);
    const masked = maskNationalId(value);
    return `${line.slice(0, spec.start)}${masked.padEnd(spec.length, " ")}${line.slice(spec.start + spec.length)}`;
  }

  const values = splitLine(line, delimiter);
  if (values[spec.column] !== undefined) {
    values[spec.column] = maskNationalId(values[spec.column]!);
  }
  return values.join(delimiterValue(delimiter));
}

function maskNationalId(value: string): string {
  const normalized = value.replace(/\D/g, "");
  if (normalized.length < 4) {
    return "";
  }
  return `*******${normalized.slice(-4)}`;
}

function delimiterValue(delimiter: ParserDelimiter): string {
  if (delimiter === "TAB") return "\t";
  if (delimiter === "PIPE") return "|";
  if (delimiter === "COMMA") return ",";
  return "";
}

function getNationalIdHashKey(): Buffer {
  const value = process.env.STUDENT_PII_HASH_KEY;
  if (!value) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("STUDENT_PII_HASH_KEY_REQUIRED");
    }
    return Buffer.from("22222222222222222222222222222222");
  }

  const key = decodeNationalIdHashKey(value);
  if (key.length !== 32) {
    throw new Error("STUDENT_PII_HASH_KEY_INVALID_LENGTH");
  }
  return key;
}

function decodeNationalIdHashKey(value: string): Buffer {
  if (value.startsWith("base64:")) {
    return Buffer.from(value.slice("base64:".length), "base64");
  }
  if (/^[0-9a-f]{64}$/i.test(value)) {
    return Buffer.from(value, "hex");
  }
  return Buffer.from(value);
}
