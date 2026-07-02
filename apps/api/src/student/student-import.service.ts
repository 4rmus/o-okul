import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Inject, Injectable, Optional, PayloadTooLargeException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { normalizeTurkishMobilePhone } from "../auth/phone-normalize.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { StudentService, type StudentGuardianProvisionInput, type StudentRecord } from "./student.service.js";
import { maskTcIdentity, normalizeTcIdentity } from "./tc-identity.js";
import type {
  PublicStudentRecord,
  StudentExportResult,
  StudentImportDryRunResult,
  StudentImportError,
  StudentImportPreviewRow,
  StudentImportRequest,
  StudentImportResult,
} from "@o-okul/shared-types";

type StudentImportDryRunInput = Partial<StudentImportRequest>;
type ParsedStudentImportRow = StudentImportPreviewRow & {
  nationalId?: string;
  phone?: string;
};
const maxStudentImportBytes = 5 * 1024 * 1024;

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

    const { rows, errors, quota } = await this.readAndValidateRows(context, input.fileBase64);

    return {
      dryRun: true,
      totalRows: rows.length,
      validRows: filterValidRows(rows, errors).map(toPreviewRow),
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
    const { rows, errors, quota } = await this.readAndValidateRows(context, input.fileBase64);
    const rowErrors = errors.filter((error) => error.code !== "STUDENT_QUOTA_EXCEEDED");

    if (rowErrors.length > 0) {
      throw new BadRequestException({
        code: "STUDENT_IMPORT_INVALID",
        errors: rowErrors,
      });
    }
    if (quota.wouldExceed) {
      throw new ConflictException("STUDENT_QUOTA_EXCEEDED");
    }

    const students = await this.students.createMany(context, filterValidRows(rows, errors));
    await this.auditLogs?.record({
      tenantId: context.tenantId ?? undefined,
      actorUserId: context.userId,
      entityType: "StudentImport",
      action: "student_import.completed",
      diff: {
        totalRows: rows.length,
        importedRows: students.length,
        errorCount: errors.length,
        quota,
      },
    });
    return {
      importedRows: students.length,
      students: students.map(toPublicImportedStudent),
    };
  }

  private async readAndValidateRows(
    context: RequestContext,
    fileBase64: string | undefined,
  ): Promise<{ rows: ParsedStudentImportRow[]; errors: StudentImportError[]; quota: StudentImportDryRunResult["quota"] }> {
    if (!fileBase64) {
      throw new BadRequestException("IMPORT_FILE_REQUIRED");
    }
    const rows = await this.readRows(fileBase64);
    const errors = await this.validateRows(context, rows);
    const quota = await this.students.previewQuota(context, rows.length);

    if (quota.wouldExceed) {
      errors.push({ row: 0, field: "quota", code: "STUDENT_QUOTA_EXCEEDED" });
    }

    return { rows, errors, quota };
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

  private async readRows(fileBase64: string): Promise<ParsedStudentImportRow[]> {
    const bytes = Buffer.from(fileBase64, "base64");
    if (bytes.byteLength > maxStudentImportBytes) {
      throw new PayloadTooLargeException("IMPORT_FILE_TOO_LARGE");
    }
    if (isXlsx(bytes)) {
      const worksheet = await this.readFirstWorksheet(bytes);
      return this.readWorksheetRows(worksheet);
    }
    if (isLegacyXls(bytes)) {
      throw new BadRequestException("IMPORT_FILE_UNSUPPORTED");
    }

    return this.readDelimitedRows(bytes.toString("utf8"));
  }

  private async readFirstWorksheet(bytes: Buffer): Promise<ExcelJS.Worksheet> {
    const workbook = new ExcelJS.Workbook();
    const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    try {
      await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
    } catch {
      throw new BadRequestException("IMPORT_FILE_INVALID");
    }

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException("IMPORT_WORKSHEET_REQUIRED");
    }

    return worksheet;
  }

  private readWorksheetRows(worksheet: ExcelJS.Worksheet): ParsedStudentImportRow[] {
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

  private readDelimitedRows(content: string): ParsedStudentImportRow[] {
    const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
    const delimiter = detectDelimiter(lines.find((line) => line.trim()) ?? "");
    const matrix = lines
      .map((line, index) => ({ rowNumber: index + 1, cells: parseDelimitedLine(line, delimiter).map((cell) => cell.trim()) }))
      .filter((row) => row.cells.some((cell) => cell));

    return this.readMatrixRows(matrix);
  }

  private readMatrixRows(matrix: Array<{ rowNumber: number; cells: string[] }>): ParsedStudentImportRow[] {
    const rows: ParsedStudentImportRow[] = [];
    const headerRowIndex = findHeaderRowIndex(matrix);
    const header = matrix[headerRowIndex]?.cells ?? [];
    const studentNoIndex = findHeaderIndex(header, ["studentNo", "schoolNo", "okulNo", "okulNumarasi", "okulNumarası", "ogrenciNo", "öğrenciNo"]);
    const firstNameIndex = findHeaderIndex(header, ["firstName", "ad", "adi", "adı", "isim"]) ?? 0;
    const lastNameIndex = findHeaderIndex(header, ["lastName", "soyad", "soyadi", "soyadı"]) ?? 1;
    const classIndex = findHeaderIndex(header, ["class", "className", "sinif", "sınıf", "sube", "şube", "sinifAdi", "sınıfAdı"]);
    const emailIndex = findHeaderIndex(header, ["email", "ePosta", "eposta", "studentEmail", "ogrenciEmail", "öğrenciEmail"]);
    const phoneIndex = findHeaderIndex(header, ["phone", "telefon", "cepTelefonu", "studentPhone", "ogrenciTelefon", "öğrenciTelefon"]);
    const nationalIdIndex = findHeaderIndex(header, ["nationalId", "tc", "tckn", "tcKimlikNo", "kimlikNo", "ogrenciTc", "öğrenciTc"]);
    const guardianIndexes: GuardianColumnIndexes = {
      firstName: findHeaderIndex(header, ["guardianFirstName", "veliAd", "veliAdi", "veliAdı"]),
      lastName: findHeaderIndex(header, ["guardianLastName", "veliSoyad", "veliSoyadi", "veliSoyadı"]),
      phone: findHeaderIndex(header, ["guardianPhone", "veliTelefon", "veliTel", "veliCep"]),
      nationalId: findHeaderIndex(header, ["guardianNationalId", "guardianTc", "veliTc", "veliTckn", "veliKimlikNo"]),
      canViewFinance: findHeaderIndex(header, ["guardianCanViewFinance", "veliFinans", "veliFinansGoruntuleme", "veliFinansGörme"]),
      canReceiveSms: findHeaderIndex(header, ["guardianCanReceiveSms", "veliSms", "veliSmsIzni", "veliSmsİzni"]),
      canReceiveAnnouncements: findHeaderIndex(header, ["guardianCanReceiveAnnouncements", "veliDuyuru", "veliDuyuruIzni", "veliDuyuruİzni"]),
      canOpenSupportTickets: findHeaderIndex(header, ["guardianCanOpenSupportTickets", "veliDestek", "veliDestekTalebi", "veliDestekIzni"]),
    };

    for (const row of matrix.slice(headerRowIndex + 1)) {
      const studentNo = studentNoIndex === undefined ? "" : row.cells[studentNoIndex]?.trim() ?? "";
      const firstName = row.cells[firstNameIndex]?.trim() ?? "";
      const lastName = row.cells[lastNameIndex]?.trim() ?? "";
      const className = classIndex === undefined ? "" : row.cells[classIndex]?.trim() ?? "";
      const email = readOptionalCell(row.cells, emailIndex);
      const phone = readOptionalCell(row.cells, phoneIndex);
      const nationalId = readOptionalCell(row.cells, nationalIdIndex);
      const guardian = readGuardian(row.cells, guardianIndexes);
      if (!studentNo && !firstName && !lastName) continue;

      rows.push({
        row: row.rowNumber,
        firstName,
        lastName,
        ...(studentNo ? { studentNo } : {}),
        ...(className ? { className } : {}),
        ...(email ? { email } : {}),
        ...(phone ? { phone } : {}),
        ...(nationalId ? { nationalId } : {}),
        ...(guardian ? { guardian } : {}),
      });
    }

    return rows;
  }

  private async validateRows(context: RequestContext, rows: ParsedStudentImportRow[]): Promise<StudentImportError[]> {
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
    const seenNationalIds = new Set<string>();

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
      if (row.email && !isEmailLike(row.email)) {
        errors.push({ row: row.row, field: "email", code: "INVALID_EMAIL" });
      }
      if (row.nationalId && !row.phone) {
        errors.push({ row: row.row, field: "phone", code: "REQUIRED" });
      }
      if (row.phone && !row.nationalId) {
        errors.push({ row: row.row, field: "nationalId", code: "REQUIRED" });
      }
      let identityValid = true;
      if (row.nationalId) {
        try {
          row.nationalId = normalizeTcIdentity(row.nationalId);
        } catch {
          identityValid = false;
          errors.push({
            row: row.row,
            field: "nationalId",
            code: "INVALID_NATIONAL_ID",
            ...maskedNationalIdValue(row.nationalId),
          });
        }
      }
      if (row.phone) {
        try {
          row.phone = normalizeTurkishMobilePhone(row.phone, "STUDENT_PHONE_INVALID");
        } catch {
          identityValid = false;
          errors.push({ row: row.row, field: "phone", code: "INVALID_PHONE" });
        }
      }
      if (row.nationalId && identityValid) {
        if (seenNationalIds.has(row.nationalId) || await this.students.hasNationalId(context, row.nationalId)) {
          errors.push({
            row: row.row,
            field: "nationalId",
            code: "STUDENT_NATIONAL_ID_DUPLICATE",
            ...maskedNationalIdValue(row.nationalId),
          });
        }
        seenNationalIds.add(row.nationalId);
      }
      if (row.nationalId && row.phone && identityValid) {
        row.accountPreview = {
          usernameMasked: maskTcIdentity(row.nationalId),
          willCreate: true,
        };
      }
      if (row.guardian?.nationalId) {
        try {
          row.guardian.nationalId = normalizeTcIdentity(row.guardian.nationalId);
        } catch {
          errors.push({
            row: row.row,
            field: "guardianNationalId",
            code: "INVALID_NATIONAL_ID",
            ...maskedNationalIdValue(row.guardian.nationalId),
          });
        }
        if (!row.guardian.phone) {
          errors.push({ row: row.row, field: "guardianPhone", code: "REQUIRED" });
        }
      }
      if (row.guardian?.nationalId && row.guardian.phone) {
        try {
          row.guardian.phone = normalizeTurkishMobilePhone(row.guardian.phone, "GUARDIAN_PHONE_INVALID");
        } catch {
          errors.push({ row: row.row, field: "guardianPhone", code: "INVALID_PHONE" });
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

function isLegacyXls(bytes: Buffer): boolean {
  return bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
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

interface GuardianColumnIndexes {
  firstName?: number;
  lastName?: number;
  phone?: number;
  nationalId?: number;
  canViewFinance?: number;
  canReceiveSms?: number;
  canReceiveAnnouncements?: number;
  canOpenSupportTickets?: number;
}

function filterValidRows<T extends { row: number }>(rows: T[], errors: StudentImportError[]): T[] {
  const invalidRows = new Set(errors.filter((error) => error.row > 0).map((error) => error.row));
  return rows.filter((row) => !invalidRows.has(row.row));
}

function toPreviewRow(row: ParsedStudentImportRow): StudentImportPreviewRow {
  const { nationalId: _nationalId, phone: _phone, ...previewRow } = row;
  if (previewRow.guardian?.nationalId) {
    previewRow.guardian = {
      ...previewRow.guardian,
      nationalId: maskTcIdentity(previewRow.guardian.nationalId),
    };
  }
  return previewRow;
}

function maskedNationalIdValue(value: string): { value?: string } {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? { value: `*******${digits.slice(-4)}` } : {};
}

function readGuardian(cells: string[], indexes: GuardianColumnIndexes): StudentGuardianProvisionInput | undefined {
  const firstName = readOptionalCell(cells, indexes.firstName);
  const lastName = readOptionalCell(cells, indexes.lastName);
  const phone = readOptionalCell(cells, indexes.phone);
  const nationalId = readOptionalCell(cells, indexes.nationalId);
  if (!firstName && !lastName && !phone && !nationalId) return undefined;

  return {
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    nationalId: nationalId || undefined,
    phone: phone || undefined,
    canViewFinance: readBooleanCell(cells, indexes.canViewFinance) ?? true,
    canReceiveSms: readBooleanCell(cells, indexes.canReceiveSms) ?? false,
    canReceiveAnnouncements: readBooleanCell(cells, indexes.canReceiveAnnouncements) ?? true,
    canOpenSupportTickets: readBooleanCell(cells, indexes.canOpenSupportTickets) ?? true,
  };
}

function readOptionalCell(cells: string[], index: number | undefined): string {
  return index === undefined ? "" : cells[index]?.trim() ?? "";
}

function readBooleanCell(cells: string[], index: number | undefined): boolean | undefined {
  const value = readOptionalCell(cells, index).toLocaleLowerCase("tr-TR");
  if (!value) return undefined;
  if (["1", "true", "evet", "e", "var", "x", "açık", "acik", "aktif"].includes(value)) return true;
  if (["0", "false", "hayır", "hayir", "h", "yok", "kapalı", "kapali", "pasif"].includes(value)) return false;
  return undefined;
}

function isEmailLike(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR").replace(/[\s_-]+/g, "");
}
