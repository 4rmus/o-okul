import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import ExcelJS from "exceljs";
import type {
  AnswerKeyBranchSummary,
  AnswerKeyRecord,
  AnswerKeyScoringConfig,
} from "@uzman-hocam/shared-types";
import type { RequestContext } from "../context/request-context.js";
import { learningOutcomeStoreToken, type LearningOutcomeStore } from "../school/learning-outcome-store.js";
import {
  AnswerKeyService,
  type AnswerKeyBookletVariantSummary,
  type SaveAnswerKeyBookletVariantInput,
} from "./answer-key.service.js";

export interface AnswerKeyExcelImportInput {
  examId?: string;
  version?: string;
  fileBase64?: string;
  scoringConfig?: unknown;
}

export interface AnswerKeyExcelImportDryRunResult {
  dryRun: true;
  tenantId: string;
  examId: string;
  version: string;
  questionCount: number;
  branches: AnswerKeyBranchSummary[];
  scoringConfig: AnswerKeyScoringConfig;
  bookletVariants: AnswerKeyBookletVariantSummary[];
  wouldImport: boolean;
}

export interface AnswerKeyExcelImportResult {
  imported: true;
  answerKey: AnswerKeyRecord;
  bookletVariants: AnswerKeyBookletVariantSummary[];
}

interface ParsedAnswerKeyWorkbook {
  questions: Array<{
    questionNo: number;
    correctAnswer: string;
    branch: string;
    outcomeCode?: string;
    topic?: string;
  }>;
  bookletVariants: SaveAnswerKeyBookletVariantInput[];
}

interface ParsedWorkbookRow {
  lesson: string;
  section: string;
  globalQuestionNo: number;
  localQuestionNo: number;
  bEquivalent: number;
  correctAnswer: string;
  branch: string;
  outcomeCode?: string;
  topic?: string;
}

const expectedQuestionCount = 90;
const answerChoices = new Set(["A", "B", "C", "D", "E"]);

@Injectable()
export class AnswerKeyExcelImportService {
  constructor(
    private readonly answerKeys: AnswerKeyService,
    @Optional()
    @Inject(learningOutcomeStoreToken)
    private readonly learningOutcomes?: LearningOutcomeStore,
  ) {}

  async dryRun(context: RequestContext, input: AnswerKeyExcelImportInput): Promise<AnswerKeyExcelImportDryRunResult> {
    const parsed = await this.parseWorkbook(input.fileBase64);
    const result = await this.answerKeys.create(context, {
      examId: input.examId,
      version: input.version,
      questions: parsed.questions,
      scoringConfig: input.scoringConfig,
      bookletVariants: parsed.bookletVariants,
      dryRun: true,
    });
    if (result.status !== "DRY_RUN") {
      throw new Error("ANSWER_KEY_IMPORT_DRY_RUN_INVALID");
    }
    return {
      dryRun: true,
      tenantId: result.tenantId,
      examId: result.examId,
      version: result.version,
      questionCount: result.questionCount,
      branches: result.branches,
      scoringConfig: result.scoringConfig,
      bookletVariants: result.bookletVariants,
      wouldImport: true,
    };
  }

  async import(context: RequestContext, input: AnswerKeyExcelImportInput): Promise<AnswerKeyExcelImportResult> {
    const parsed = await this.parseWorkbook(input.fileBase64);
    const answerKey = await this.answerKeys.create(context, {
      examId: input.examId,
      version: input.version,
      questions: parsed.questions,
      scoringConfig: input.scoringConfig,
      bookletVariants: parsed.bookletVariants,
    });
    if (answerKey.status === "DRY_RUN") {
      throw new Error("ANSWER_KEY_IMPORT_RESULT_INVALID");
    }
    await this.syncLearningOutcomes(context, parsed.questions);
    return {
      imported: true,
      answerKey,
      bookletVariants: parsed.bookletVariants.map((variant) => ({
        code: variant.code,
        questionCount: variant.permutation.length,
      })),
    };
  }

  private async parseWorkbook(fileBase64: string | undefined): Promise<ParsedAnswerKeyWorkbook> {
    if (!fileBase64) {
      throw new BadRequestException("ANSWER_KEY_IMPORT_FILE_REQUIRED");
    }

    const workbook = new ExcelJS.Workbook();
    const bytes = Buffer.from(fileBase64, "base64");
    const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException("ANSWER_KEY_IMPORT_WORKSHEET_REQUIRED");
    }

    const headers = this.readHeaders(worksheet.getRow(1));
    const rows: ParsedWorkbookRow[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const questionNoText = this.cellText(row.getCell(headers.questionNo).value);
      if (!questionNoText) return;

      const localQuestionNo = this.readPositiveInteger(questionNoText, "ANSWER_KEY_IMPORT_QUESTION_NO_INVALID");
      const bEquivalent = this.readPositiveInteger(
        this.cellText(row.getCell(headers.bEquivalent).value),
        "ANSWER_KEY_IMPORT_B_EQUIVALENT_INVALID",
      );
      const correctAnswer = this.cellText(row.getCell(headers.correctAnswer).value).toUpperCase();
      if (!answerChoices.has(correctAnswer)) {
        throw new BadRequestException("ANSWER_KEY_IMPORT_CORRECT_ANSWER_INVALID");
      }

      const lesson = headers.lesson ? this.cellText(row.getCell(headers.lesson).value) : "";
      const section = headers.section ? this.cellText(row.getCell(headers.section).value) : lesson;
      const branch = this.cellText(row.getCell(headers.branch).value) || lesson || section;
      if (!branch) {
        throw new BadRequestException("ANSWER_KEY_IMPORT_BRANCH_REQUIRED");
      }
      const outcomeCode = this.cellText(row.getCell(headers.outcomeCode).value);
      const topic = this.cellText(row.getCell(headers.topic).value);

      rows.push({
        lesson,
        section,
        globalQuestionNo: rows.length + 1,
        localQuestionNo,
        bEquivalent,
        correctAnswer,
        branch,
        ...(outcomeCode ? { outcomeCode } : {}),
        ...(topic ? { topic } : {}),
      });
    });

    const questions = rows.map(({ bEquivalent: _bEquivalent, globalQuestionNo, localQuestionNo: _localQuestionNo, lesson: _lesson, section: _section, ...question }) => ({
      ...question,
      questionNo: globalQuestionNo,
    }));
    const bPermutation = this.createGlobalBPermutation(rows);

    if (questions.length !== expectedQuestionCount) {
      throw new BadRequestException("ANSWER_KEY_IMPORT_QUESTION_COUNT_INVALID");
    }
    this.assertPermutation(bPermutation);

    return {
      questions,
      bookletVariants: [{ code: "B", permutation: bPermutation }],
    };
  }

  private createGlobalBPermutation(rows: ParsedWorkbookRow[]): number[] {
    const sectionStats = new Map<string, { start: number; count: number }>();
    for (const row of rows) {
      const current = sectionStats.get(row.section);
      sectionStats.set(row.section, {
        start: current ? current.start : row.globalQuestionNo,
        count: (current?.count ?? 0) + 1,
      });
    }

    const permutation: number[] = [];
    for (const row of rows) {
      const section = sectionStats.get(row.section);
      if (!section || row.bEquivalent > section.count) {
        throw new BadRequestException("ANSWER_KEY_IMPORT_B_EQUIVALENT_INVALID");
      }
      if (row.localQuestionNo > section.count) {
        throw new BadRequestException("ANSWER_KEY_IMPORT_QUESTION_NO_INVALID");
      }
      permutation[row.globalQuestionNo - 1] = section.start + row.bEquivalent - 1;
    }
    return permutation;
  }

  private readHeaders(row: ExcelJS.Row): {
    lesson?: number;
    section?: number;
    questionNo: number;
    bEquivalent: number;
    correctAnswer: number;
    outcomeCode: number;
    topic: number;
    branch: number;
  } {
    const headers = new Map<string, number>();
    row.eachCell((cell, colNumber) => headers.set(normalizeHeader(this.cellText(cell.value)), colNumber));
    return {
      lesson: optionalHeader(headers, "DERS"),
      section: optionalHeader(headers, "BÖLÜM"),
      questionNo: requiredAnyHeader(headers, ["SORU NUMARASI", "SORU NO"]),
      bEquivalent: requiredAnyHeader(headers, ["B KİTAPÇIĞI KARŞILIĞI", "B KITAPCIGI KARSILIGI", "B KARŞILIĞI"]),
      correctAnswer: requiredHeader(headers, "CEVAP"),
      outcomeCode: requiredHeader(headers, "KAZANIM"),
      topic: requiredHeader(headers, "KONU"),
      branch: requiredHeader(headers, "BRANŞ"),
    };
  }

  private readPositiveInteger(value: string, errorCode: string): number {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      throw new BadRequestException(errorCode);
    }
    return parsed;
  }

  private assertPermutation(permutation: number[]): void {
    if (permutation.length !== expectedQuestionCount) {
      throw new BadRequestException("ANSWER_KEY_IMPORT_B_PERMUTATION_INVALID");
    }
    const seen = new Set<number>();
    for (const questionNo of permutation) {
      if (!Number.isInteger(questionNo) || questionNo <= 0 || questionNo > expectedQuestionCount || seen.has(questionNo)) {
        throw new BadRequestException("ANSWER_KEY_IMPORT_B_PERMUTATION_INVALID");
      }
      seen.add(questionNo);
    }
  }

  private cellText(value: ExcelJS.CellValue): string {
    if (value === null || value === undefined) {
      return "";
    }
    if (typeof value === "object") {
      if ("text" in value && typeof value.text === "string") {
        return value.text.trim();
      }
      if ("result" in value) {
        return this.cellText(value.result);
      }
      return "";
    }

    return String(value).trim();
  }

  private async syncLearningOutcomes(context: RequestContext, questions: ParsedAnswerKeyWorkbook["questions"]): Promise<void> {
    if (!this.learningOutcomes || !context.tenantId) {
      return;
    }

    const incoming = new Map<string, { branch: string; title: string }>();
    for (const question of questions) {
      const code = question.outcomeCode?.trim();
      if (!code || incoming.has(code)) continue;

      incoming.set(code, {
        branch: question.branch,
        title: question.topic?.trim() || code,
      });
    }
    if (incoming.size === 0) {
      return;
    }

    const existingByCode = new Map(
      (await this.learningOutcomes.list())
        .filter((outcome) => outcome.tenantId === context.tenantId && !outcome.deletedAt)
        .map((outcome) => [outcome.code, outcome]),
    );

    for (const [code, outcome] of incoming) {
      const existing = existingByCode.get(code);
      if (!existing) {
        await this.learningOutcomes.create({
          tenantId: context.tenantId,
          code,
          branch: outcome.branch,
          title: outcome.title,
        });
        continue;
      }

      if (existing.branch !== outcome.branch || existing.title !== outcome.title) {
        await this.learningOutcomes.update(existing.id, {
          branch: outcome.branch,
          title: outcome.title,
        });
      }
    }
  }
}

function requiredHeader(headers: Map<string, number>, name: string): number {
  const index = headers.get(normalizeHeader(name));
  if (!index) {
    throw new BadRequestException("ANSWER_KEY_IMPORT_HEADER_MISSING");
  }
  return index;
}

function requiredAnyHeader(headers: Map<string, number>, names: string[]): number {
  for (const name of names) {
    const index = optionalHeader(headers, name);
    if (index) {
      return index;
    }
  }
  throw new BadRequestException("ANSWER_KEY_IMPORT_HEADER_MISSING");
}

function optionalHeader(headers: Map<string, number>, name: string): number | undefined {
  return headers.get(normalizeHeader(name));
}

function normalizeHeader(value: string): string {
  return value
    .toLocaleUpperCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
