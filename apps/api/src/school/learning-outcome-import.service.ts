import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, Injectable, Optional, PayloadTooLargeException } from "@nestjs/common";
import type {
  LearningOutcomeImportDryRunResult,
  LearningOutcomeImportError,
  LearningOutcomeImportPreviewRow,
  LearningOutcomeImportRequest,
  LearningOutcomeImportResult,
  LearningOutcomeRecord,
} from "@o-okul/shared-types";
import ExcelJS from "exceljs";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { SchoolService } from "./school.service.js";

type ParsedLearningOutcomeImportRow = LearningOutcomeImportPreviewRow;

const maxLearningOutcomeImportBytes = 5 * 1024 * 1024;

@Injectable()
export class LearningOutcomeImportService {
  constructor(
    private readonly school: SchoolService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async dryRun(context: RequestContext, input: Partial<LearningOutcomeImportRequest>): Promise<LearningOutcomeImportDryRunResult> {
    if (!input.fileBase64) {
      throw new BadRequestException("IMPORT_FILE_REQUIRED");
    }

    const { rows, errors } = await this.readAndValidateRows(context, input.fileBase64);
    return {
      dryRun: true,
      totalRows: rows.length,
      validRows: errors.length > 0 ? [] : rows,
      errors,
      wouldImport: errors.length === 0,
    };
  }

  async import(
    context: RequestContext,
    input: Partial<LearningOutcomeImportRequest>,
    idempotencyKey?: string,
  ): Promise<LearningOutcomeImportResult> {
    const idempotencyRequest = {
      fileSha256: input.fileBase64 ? createSha256(Buffer.from(input.fileBase64, "base64")) : undefined,
    };
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "learning-outcome.import.commit", request: idempotencyRequest },
        () => this.importOnce(context, input),
      );
    }

    return this.importOnce(context, input);
  }

  private async importOnce(context: RequestContext, input: Partial<LearningOutcomeImportRequest>): Promise<LearningOutcomeImportResult> {
    if (!input.fileBase64) {
      throw new BadRequestException("IMPORT_FILE_REQUIRED");
    }
    const { rows, errors } = await this.readAndValidateRows(context, input.fileBase64);
    if (errors.length > 0) {
      throw new BadRequestException({
        error: {
          code: "LEARNING_OUTCOME_IMPORT_INVALID",
          message: "Kazanım aktarım dosyası geçersiz.",
          details: errors,
        },
      });
    }

    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const existingByCode = new Map(
      (await this.school.listLearningOutcomes(context)).map((record) => [normalizeValue(record.code), record]),
    );
    const outcomes: LearningOutcomeRecord[] = [];
    let createdOutcomes = 0;
    let updatedOutcomes = 0;

    for (const row of rows) {
      const key = normalizeValue(row.code);
      const existing = existingByCode.get(key);
      if (existing) {
        const updated = await this.school.updateLearningOutcome(context, existing.id, {
          branch: row.branch,
          code: row.code,
          level: row.level,
          title: row.title,
        });
        existingByCode.set(key, updated);
        outcomes.push(updated);
        updatedOutcomes += 1;
      } else {
        const created = await this.school.createLearningOutcome(context, {
          branch: row.branch,
          code: row.code,
          level: row.level,
          title: row.title,
        });
        existingByCode.set(key, created);
        outcomes.push(created);
        createdOutcomes += 1;
      }
    }

    return {
      importedRows: rows.length,
      createdOutcomes,
      updatedOutcomes,
      outcomes,
    };
  }

  private async readAndValidateRows(
    context: RequestContext,
    fileBase64: string,
  ): Promise<{ rows: ParsedLearningOutcomeImportRow[]; errors: LearningOutcomeImportError[] }> {
    const rows = await this.readRows(fileBase64);
    return { rows, errors: await this.validateRows(context, rows) };
  }

  private async readRows(fileBase64: string): Promise<ParsedLearningOutcomeImportRow[]> {
    const bytes = Buffer.from(fileBase64, "base64");
    if (bytes.length > maxLearningOutcomeImportBytes) {
      throw new PayloadTooLargeException("IMPORT_FILE_TOO_LARGE");
    }
    if (isXlsx(bytes)) {
      const workbook = new ExcelJS.Workbook();
      const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        throw new BadRequestException("IMPORT_WORKSHEET_REQUIRED");
      }

      const matrix: Array<{ rowNumber: number; cells: string[] }> = [];
      worksheet.eachRow((row, rowNumber) => {
        const cells: string[] = [];
        for (let index = 1; index <= row.cellCount; index += 1) {
          cells.push(cellText(row.getCell(index).value));
        }
        matrix.push({ rowNumber, cells });
      });
      return readMatrixRows(matrix);
    }

    const lines = bytes.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
    const delimiter = detectDelimiter(lines.find((line) => line.trim()) ?? "");
    const matrix = lines
      .map((line, index) => ({ rowNumber: index + 1, cells: parseDelimitedLine(line, delimiter).map((cell) => cell.trim()) }))
      .filter((row) => row.cells.some((cell) => cell));
    return readMatrixRows(matrix);
  }

  private async validateRows(context: RequestContext, rows: ParsedLearningOutcomeImportRow[]): Promise<LearningOutcomeImportError[]> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const errors: LearningOutcomeImportError[] = [];
    const seenCodes = new Set<string>();
    const existingCodes = new Set((await this.school.listLearningOutcomes(context)).map((record) => normalizeValue(record.code)));

    for (const row of rows) {
      if (!row.code) {
        errors.push({ row: row.row, field: "code", code: "REQUIRED" });
      }
      if (!row.branch) {
        errors.push({ row: row.row, field: "branch", code: "REQUIRED" });
      }
      if (!row.title) {
        errors.push({ row: row.row, field: "title", code: "REQUIRED" });
      }
      if (!row.code) continue;

      const key = normalizeValue(row.code);
      if (seenCodes.has(key)) {
        errors.push({ row: row.row, field: "code", code: "DUPLICATE_CODE", value: row.code });
      }
      seenCodes.add(key);
      if (existingCodes.has(key)) {
        row.willUpdate = true;
      }
    }

    return errors;
  }
}

function createSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function readMatrixRows(matrix: Array<{ rowNumber: number; cells: string[] }>): ParsedLearningOutcomeImportRow[] {
  const rows: ParsedLearningOutcomeImportRow[] = [];
  const headerRowIndex = findHeaderRowIndex(matrix);
  const header = matrix[headerRowIndex]?.cells ?? [];
  const codeIndex = findHeaderIndex(header, ["code", "kod", "kazanimKodu", "kazanımKodu"]) ?? 0;
  const branchIndex = findHeaderIndex(header, ["branch", "brans", "branş"]) ?? 1;
  const titleIndex = findHeaderIndex(header, ["title", "baslik", "başlık", "kazanim", "kazanım", "kazanimAdi", "kazanımAdı"]) ?? 2;
  const levelIndex = findHeaderIndex(header, ["level", "seviye", "sinifSeviyesi", "sınıfSeviyesi"]);

  for (const row of matrix.slice(headerRowIndex + 1)) {
    const code = row.cells[codeIndex]?.trim() ?? "";
    const branch = row.cells[branchIndex]?.trim() ?? "";
    const title = row.cells[titleIndex]?.trim() ?? "";
    const level = levelIndex === undefined ? "" : row.cells[levelIndex]?.trim() ?? "";
    if (!code && !branch && !title && !level) continue;

    rows.push({
      row: row.rowNumber,
      code,
      branch,
      title,
      ...(level ? { level } : {}),
    });
  }

  return rows;
}

function isXlsx(bytes: Buffer): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text.trim();
    if ("result" in value) return cellText(value.result);
    return "";
  }
  return String(value).trim();
}

function detectDelimiter(line: string): string {
  if (line.includes(";")) return ";";
  if (line.includes("\t")) return "\t";
  return ",";
}

function parseDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current);
  return cells;
}

function findHeaderRowIndex(matrix: Array<{ cells: string[] }>): number {
  const index = matrix.findIndex((row) =>
    findHeaderIndex(row.cells, ["code", "kod", "kazanimKodu", "kazanımKodu"]) !== undefined &&
    findHeaderIndex(row.cells, ["title", "baslik", "başlık", "kazanim", "kazanım", "kazanimAdi", "kazanımAdı"]) !== undefined,
  );
  return index === -1 ? 0 : index;
}

function findHeaderIndex(header: string[], names: string[]): number | undefined {
  const normalizedNames = new Set(names.map(normalizeHeader));
  const index = header.findIndex((cell) => normalizedNames.has(normalizeHeader(cell)));
  return index === -1 ? undefined : index;
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR").replace(/[\s_-]+/g, "");
}

function normalizeValue(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR");
}
