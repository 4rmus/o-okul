import { createHash } from "node:crypto";
import { BadRequestException, Inject, Injectable, Optional, PayloadTooLargeException } from "@nestjs/common";
import type {
  GuardianImportDryRunResult,
  GuardianImportError,
  GuardianImportPreviewRow,
  GuardianImportRequest,
  GuardianImportResult,
} from "@o-okul/shared-types";
import ExcelJS from "exceljs";
import { normalizeTurkishMobilePhone } from "../auth/phone-normalize.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { type StudentStore, studentStoreToken } from "../student/student-store.js";
import { normalizeTcIdentity } from "../student/tc-identity.js";
import { GuardianService } from "./guardian.service.js";

type ParsedGuardianImportRow = GuardianImportPreviewRow & {
  nationalId?: string;
  phone?: string;
};

const maxGuardianImportBytes = 5 * 1024 * 1024;

@Injectable()
export class GuardianImportService {
  constructor(
    private readonly guardians: GuardianService,
    @Inject(studentStoreToken) private readonly students: StudentStore,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async dryRun(context: RequestContext, input: Partial<GuardianImportRequest>): Promise<GuardianImportDryRunResult> {
    const { errors, rows } = await this.readAndValidateRows(context, input.fileBase64);
    return {
      dryRun: true,
      errors,
      totalRows: rows.length,
      validRows: errors.length > 0 ? [] : rows.map(toPreviewRow),
      wouldImport: errors.length === 0,
    };
  }

  async import(context: RequestContext, input: Partial<GuardianImportRequest>, idempotencyKey?: string): Promise<GuardianImportResult> {
    const request = { fileSha256: input.fileBase64 ? createSha256(Buffer.from(input.fileBase64, "base64")) : undefined };
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "guardian.import.commit", request },
        () => this.importOnce(context, input),
      );
    }

    return this.importOnce(context, input);
  }

  private async importOnce(context: RequestContext, input: Partial<GuardianImportRequest>): Promise<GuardianImportResult> {
    const { errors, rows } = await this.readAndValidateRows(context, input.fileBase64);
    if (errors.length > 0) {
      throw new BadRequestException({ code: "GUARDIAN_IMPORT_INVALID", errors });
    }

    const guardians = [];
    const links = [];
    for (const row of rows) {
      const guardian = await this.guardians.createGuardian(context, {
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
        nationalId: row.nationalId,
        phone: row.phone,
      });
      guardians.push(guardian);
      links.push(await this.guardians.linkGuardianStudent(context, guardian.id, row.studentId, {
        canOpenSupportTickets: true,
        canReceiveAnnouncements: true,
        canReceiveSms: true,
        canViewFinance: true,
      }));
    }

    return {
      createdOrMatchedGuardians: guardians.length,
      guardians,
      importedRows: rows.length,
      linkedStudents: links.length,
      links,
    };
  }

  private async readAndValidateRows(
    context: RequestContext,
    fileBase64: string | undefined,
  ): Promise<{ rows: ParsedGuardianImportRow[]; errors: GuardianImportError[] }> {
    if (!fileBase64) throw new BadRequestException("IMPORT_FILE_REQUIRED");

    const rows = await this.readRows(fileBase64);
    const students = (await this.students.list()).filter((student) => student.tenantId === context.tenantId && !student.deletedAt);
    const studentByNo = new Map(students.flatMap((student) => student.studentNo ? [[normalizeValue(student.studentNo), student]] : []));
    const errors: GuardianImportError[] = [];

    for (const row of rows) {
      if (!row.firstName) errors.push({ row: row.row, field: "firstName", code: "REQUIRED" });
      if (!row.lastName) errors.push({ row: row.row, field: "lastName", code: "REQUIRED" });
      if (!row.studentNo) errors.push({ row: row.row, field: "studentNo", code: "REQUIRED" });
      const student = row.studentNo ? studentByNo.get(normalizeValue(row.studentNo)) : undefined;
      if (row.studentNo && !student) errors.push({ row: row.row, field: "studentNo", code: "STUDENT_NOT_FOUND", value: row.studentNo });
      if (student) row.studentId = student.id;
      if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
        errors.push({ row: row.row, field: "email", code: "INVALID_EMAIL", value: row.email });
      }
      if (row.nationalId) {
        try {
          row.nationalId = normalizeTcIdentity(row.nationalId, "GUARDIAN_NATIONAL_ID_INVALID");
        } catch {
          errors.push({ row: row.row, field: "nationalId", code: "INVALID", value: row.nationalId });
        }
      }
      if (row.phone) {
        try {
          row.phone = normalizeTurkishMobilePhone(row.phone, "GUARDIAN_PHONE_INVALID");
        } catch {
          errors.push({ row: row.row, field: "phone", code: "INVALID", value: row.phone });
        }
      }
    }

    return { errors, rows };
  }

  private async readRows(fileBase64: string): Promise<ParsedGuardianImportRow[]> {
    const bytes = Buffer.from(fileBase64, "base64");
    if (bytes.length > maxGuardianImportBytes) throw new PayloadTooLargeException("IMPORT_FILE_TOO_LARGE");
    if (isXlsx(bytes)) {
      const workbook = new ExcelJS.Workbook();
      const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
      const worksheet = workbook.worksheets[0];
      if (!worksheet) throw new BadRequestException("IMPORT_WORKSHEET_REQUIRED");
      const matrix: Array<{ rowNumber: number; cells: string[] }> = [];
      worksheet.eachRow((row, rowNumber) => {
        const cells = Array.from({ length: row.cellCount }, (_, index) => cellText(row.getCell(index + 1).value));
        matrix.push({ rowNumber, cells });
      });
      return readMatrixRows(matrix);
    }

    return readMatrixRows(
      bytes.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/)
        .map((line, index) => ({ rowNumber: index + 1, cells: line.split(/[;\t,]/).map((cell) => cell.trim()) }))
        .filter((row) => row.cells.some(Boolean)),
    );
  }
}

function readMatrixRows(matrix: Array<{ rowNumber: number; cells: string[] }>): ParsedGuardianImportRow[] {
  const headerIndex = matrix.findIndex((row) => row.cells.some((cell) => normalizeValue(cell) === "ad"));
  const header = matrix[headerIndex]?.cells ?? [];
  const firstNameIndex = findHeaderIndex(header, ["ad", "adi", "adı", "veliAd", "veliAdi", "veliAdı"]) ?? 0;
  const lastNameIndex = findHeaderIndex(header, ["soyad", "soyadi", "soyadı", "veliSoyad", "veliSoyadi", "veliSoyadı"]) ?? 1;
  const phoneIndex = findHeaderIndex(header, ["telefon", "veliTelefon", "veliTel", "veliCep"]);
  const nationalIdIndex = findHeaderIndex(header, ["tc", "tckn", "tcKimlikNo", "veliTc", "veliTckn", "veliKimlikNo", "veliTcKimlikNo"]);
  const emailIndex = findHeaderIndex(header, ["email", "eposta", "ePosta", "veliEmail", "veliEposta"]);
  const studentNoIndex = findHeaderIndex(header, ["okulNo", "ogrenciNo", "öğrenciNo", "studentNo"]);

  return matrix.slice(headerIndex + 1).flatMap((row) => {
    const firstName = row.cells[firstNameIndex]?.trim() ?? "";
    const lastName = row.cells[lastNameIndex]?.trim() ?? "";
    const studentNo = studentNoIndex === undefined ? "" : row.cells[studentNoIndex]?.trim() ?? "";
    if (!firstName && !lastName && !studentNo) return [];
    return [{
      email: readOptionalCell(row.cells, emailIndex),
      firstName,
      lastName,
      nationalId: readOptionalCell(row.cells, nationalIdIndex),
      phone: readOptionalCell(row.cells, phoneIndex),
      row: row.rowNumber,
      studentId: "",
      studentNo,
    }];
  });
}

function toPreviewRow(row: ParsedGuardianImportRow): GuardianImportPreviewRow {
  return {
    email: row.email,
    firstName: row.firstName,
    lastName: row.lastName,
    row: row.row,
    studentId: row.studentId,
    studentNo: row.studentNo,
  };
}

function findHeaderIndex(header: string[], aliases: string[]) {
  const normalized = aliases.map(normalizeValue);
  const index = header.findIndex((cell) => normalized.includes(normalizeValue(cell)));
  return index === -1 ? undefined : index;
}

function readOptionalCell(cells: string[], index: number | undefined) {
  if (index === undefined || index < 0) return undefined;
  return cells[index]?.trim() || undefined;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object" && "text" in value && typeof value.text === "string") return value.text.trim();
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

function isXlsx(bytes: Buffer) {
  return bytes.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
}

function normalizeValue(value: string) {
  return value.toLocaleLowerCase("tr-TR").normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/[^a-z0-9]/g, "");
}

function createSha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
