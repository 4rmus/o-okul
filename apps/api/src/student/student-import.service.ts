import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import ExcelJS from "exceljs";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { StudentService, type StudentGuardianProvisionInput, type StudentRecord } from "./student.service.js";
import type {
  PublicStudentRecord,
  StudentExportResult,
  StudentImportDryRunResult,
  StudentImportError,
  StudentImportPreviewRow,
  StudentImportRequest,
  StudentImportResult,
} from "@uzman-hocam/shared-types";

type StudentImportDryRunInput = Partial<StudentImportRequest>;

@Injectable()
export class StudentImportService {
  constructor(
    private readonly students: StudentService,
    @Inject(classStoreToken) private readonly classes: ClassStore,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async dryRun(context: RequestContext, input: StudentImportDryRunInput): Promise<StudentImportDryRunResult> {
    if (!input.fileBase64) {
      throw new BadRequestException("IMPORT_FILE_REQUIRED");
    }

    const rows = await this.readRows(input.fileBase64);
    const errors = await this.validateRows(context, rows);
    const quota = await this.students.previewQuota(context, rows.length);

    if (quota.wouldExceed) {
      errors.push({ row: 0, field: "quota", code: "STUDENT_QUOTA_EXCEEDED" });
    }

    return {
      dryRun: true,
      totalRows: rows.length,
      validRows: errors.length > 0 ? [] : rows,
      errors,
      quota,
      wouldImport: errors.length === 0,
    };
  }

  async import(
    context: RequestContext,
    input: StudentImportDryRunInput,
    idempotencyKey?: string,
  ): Promise<StudentImportResult> {
    const idempotencyRequest = {
      fileSha256: input.fileBase64 ? createSha256(Buffer.from(input.fileBase64, "base64")) : undefined,
    };
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "student.import.commit", request: idempotencyRequest },
        () => this.importOnce(context, input),
      );
    }

    return this.importOnce(context, input);
  }

  private async importOnce(context: RequestContext, input: StudentImportDryRunInput): Promise<StudentImportResult> {
    const dryRun = await this.dryRun(context, input);
    const rowErrors = dryRun.errors.filter((error) => error.code !== "STUDENT_QUOTA_EXCEEDED");

    if (rowErrors.length > 0) {
      throw new BadRequestException({
        code: "STUDENT_IMPORT_INVALID",
        errors: rowErrors,
      });
    }
    if (dryRun.quota.wouldExceed) {
      throw new ConflictException("STUDENT_QUOTA_EXCEEDED");
    }

    const students = await this.students.createMany(context, dryRun.validRows);
    await this.auditLogs?.record({
      tenantId: context.tenantId ?? undefined,
      actorUserId: context.userId,
      entityType: "StudentImport",
      action: "student_import.completed",
      diff: {
        totalRows: dryRun.totalRows,
        importedRows: students.length,
        errorCount: dryRun.errors.length,
        quota: dryRun.quota,
      },
    });
    return {
      importedRows: students.length,
      students: students.map(toPublicImportedStudent),
    };
  }

  async export(context: RequestContext): Promise<StudentExportResult> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Students");
    const students = await this.students.list(context);
    const classes = (await this.classes.list()).filter((record) => record.tenantId === context.tenantId && !record.deletedAt);
    const classById = new Map(classes.map((record) => [record.id, record]));

    worksheet.addRow(["okul_no", "ad", "soyad", "sinif"]);
    for (const student of students) {
      worksheet.addRow([student.studentNo ?? "", student.firstName, student.lastName, student.classId ? classById.get(student.classId)?.name ?? "" : ""]);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      fileName: "students.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileBase64: Buffer.from(buffer).toString("base64"),
      rowCount: students.length,
    };
  }

  private async readRows(fileBase64: string): Promise<StudentImportPreviewRow[]> {
    const bytes = Buffer.from(fileBase64, "base64");
    if (isXlsx(bytes)) {
      const worksheet = await this.readFirstWorksheet(bytes);
      return this.readWorksheetRows(worksheet);
    }

    return this.readDelimitedRows(bytes.toString("utf8"));
  }

  private async readFirstWorksheet(bytes: Buffer): Promise<ExcelJS.Worksheet> {
    const workbook = new ExcelJS.Workbook();
    const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException("IMPORT_WORKSHEET_REQUIRED");
    }

    return worksheet;
  }

  private readWorksheetRows(worksheet: ExcelJS.Worksheet): StudentImportPreviewRow[] {
    const matrix: Array<{ rowNumber: number; cells: string[] }> = [];

    worksheet.eachRow((row, rowNumber) => {
      const cells: string[] = [];
      for (let index = 1; index <= row.cellCount; index += 1) {
        cells.push(this.cellText(row.getCell(index).value));
      }
      matrix.push({ rowNumber, cells });
    });

    return this.readMatrixRows(matrix);
  }

  private readDelimitedRows(content: string): StudentImportPreviewRow[] {
    const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
    const delimiter = detectDelimiter(lines.find((line) => line.trim()) ?? "");
    const matrix = lines
      .map((line, index) => ({ rowNumber: index + 1, cells: parseDelimitedLine(line, delimiter).map((cell) => cell.trim()) }))
      .filter((row) => row.cells.some((cell) => cell));

    return this.readMatrixRows(matrix);
  }

  private readMatrixRows(matrix: Array<{ rowNumber: number; cells: string[] }>): StudentImportPreviewRow[] {
    const rows: StudentImportPreviewRow[] = [];
    const headerRowIndex = findHeaderRowIndex(matrix);
    const header = matrix[headerRowIndex]?.cells ?? [];
    const studentNoIndex = findHeaderIndex(header, ["studentNo", "schoolNo", "okulNo", "okulNumarasi", "okulNumarası", "ogrenciNo", "öğrenciNo"]);
    const firstNameIndex = findHeaderIndex(header, ["firstName", "ad", "adi", "adı", "isim"]) ?? 0;
    const lastNameIndex = findHeaderIndex(header, ["lastName", "soyad", "soyadi", "soyadı"]) ?? 1;
    const classIndex = findHeaderIndex(header, ["class", "className", "sinif", "sınıf", "sube", "şube", "sinifAdi", "sınıfAdı"]);
    const guardianFirstNameIndex = findHeaderIndex(header, ["guardianFirstName", "veliAd", "veliAdi", "veliAdı"]);
    const guardianLastNameIndex = findHeaderIndex(header, ["guardianLastName", "veliSoyad", "veliSoyadi", "veliSoyadı"]);
    const guardianPhoneIndex = findHeaderIndex(header, ["guardianPhone", "veliTelefon", "veliTel", "veliCep"]);

    for (const row of matrix.slice(headerRowIndex + 1)) {
      const studentNo = studentNoIndex === undefined ? "" : row.cells[studentNoIndex]?.trim() ?? "";
      const firstName = row.cells[firstNameIndex]?.trim() ?? "";
      const lastName = row.cells[lastNameIndex]?.trim() ?? "";
      const className = classIndex === undefined ? "" : row.cells[classIndex]?.trim() ?? "";
      const guardian = readGuardian(row.cells, guardianFirstNameIndex, guardianLastNameIndex, guardianPhoneIndex);
      if (!studentNo && !firstName && !lastName) continue;

      rows.push({
        row: row.rowNumber,
        firstName,
        lastName,
        ...(studentNo ? { studentNo } : {}),
        ...(className ? { className } : {}),
        ...(guardian ? { guardian } : {}),
      });
    }

    return rows;
  }

  private async validateRows(context: RequestContext, rows: StudentImportPreviewRow[]): Promise<StudentImportError[]> {
    const errors: StudentImportError[] = [];
    const classes = (await this.classes.list()).filter((record) => record.tenantId === context.tenantId && !record.deletedAt);
    const classByName = new Map(classes.map((record) => [this.normalizeValue(record.name), record]));
    const existingStudentNos = new Set(
      (await this.students.list(context))
        .map((student) => student.studentNo)
        .filter((studentNo): studentNo is string => Boolean(studentNo))
        .map((studentNo) => this.normalizeStudentNo(studentNo)),
    );
    const seenStudentNos = new Set<string>();

    for (const row of rows) {
      if (row.studentNo) {
        const normalizedStudentNo = this.normalizeStudentNo(row.studentNo);
        if (seenStudentNos.has(normalizedStudentNo) || existingStudentNos.has(normalizedStudentNo)) {
          errors.push({ row: row.row, field: "studentNo", code: "STUDENT_NO_DUPLICATE", value: row.studentNo });
        }
        seenStudentNos.add(normalizedStudentNo);
      }
      if (!row.firstName) {
        errors.push({ row: row.row, field: "firstName", code: "REQUIRED" });
      }
      if (!row.lastName) {
        errors.push({ row: row.row, field: "lastName", code: "REQUIRED" });
      }
      if (row.className) {
        const classRecord = classByName.get(this.normalizeValue(row.className));
        if (classRecord) {
          row.classId = classRecord.id;
        } else {
          errors.push({ row: row.row, field: "className", code: "CLASS_NOT_FOUND", value: row.className });
        }
      }
    }

    return errors;
  }

  private normalizeValue(value: string): string {
    return value.trim().toLocaleLowerCase("tr-TR");
  }

  private normalizeStudentNo(value: string): string {
    return value.trim();
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
}

function toPublicImportedStudent(student: StudentRecord): PublicStudentRecord {
  return {
    id: student.id,
    tenantId: student.tenantId,
    studentNo: student.studentNo,
    firstName: student.firstName,
    lastName: student.lastName,
    classId: student.classId,
    responsibleTeacherId: student.responsibleTeacherId,
    status: student.status,
  };
}

function isXlsx(bytes: Buffer): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function createSha256(body: Buffer): string {
  return createHash("sha256").update(body).digest("hex");
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

function findHeaderIndex(header: string[], names: string[]): number | undefined {
  const normalizedNames = new Set(names.map(normalizeHeader));
  const index = header.findIndex((cell) => normalizedNames.has(normalizeHeader(cell)));
  return index === -1 ? undefined : index;
}

function findHeaderRowIndex(matrix: Array<{ cells: string[] }>): number {
  const index = matrix.findIndex((row) =>
    findHeaderIndex(row.cells, ["firstName", "ad", "adi", "adı", "isim"]) !== undefined &&
    findHeaderIndex(row.cells, ["lastName", "soyad", "soyadi", "soyadı"]) !== undefined,
  );
  return index === -1 ? 0 : index;
}

function readGuardian(
  cells: string[],
  firstNameIndex: number | undefined,
  lastNameIndex: number | undefined,
  phoneIndex: number | undefined,
): StudentGuardianProvisionInput | undefined {
  const firstName = firstNameIndex === undefined ? "" : cells[firstNameIndex]?.trim() ?? "";
  const lastName = lastNameIndex === undefined ? "" : cells[lastNameIndex]?.trim() ?? "";
  const phone = phoneIndex === undefined ? "" : cells[phoneIndex]?.trim() ?? "";
  if (!firstName && !lastName && !phone) return undefined;

  return {
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    phone: phone || undefined,
    relationshipType: "GUARDIAN",
    isPrimary: true,
    canViewFinance: true,
    canReceiveSms: true,
    canReceiveAnnouncements: true,
    canOpenSupportTickets: true,
  };
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR").replace(/[\s_-]+/g, "");
}
