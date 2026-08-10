import { createHash } from "node:crypto";
import { BadRequestException, ConflictException, Injectable, Optional, PayloadTooLargeException } from "@nestjs/common";
import ExcelJS from "exceljs";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import { normalizeTurkishMobilePhone } from "../auth/phone-normalize.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { toTurkishUpperCase } from "../http/zod-validation.js";
import { FeatureRolloutService } from "../feature-rollout/feature-rollout.service.js";
import { maskContactEmail, maskContactPhone } from "../privacy/contact-mask.js";
import { SchoolService } from "../school/school.service.js";
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
  StudentContactCreateRequest,
  StudentContactRelationType,
} from "@o-okul/shared-types";

type StudentImportDryRunInput = Partial<StudentImportRequest>;
interface ParsedStudentContact extends StudentContactCreateRequest {
  invalidRelation?: string;
}

type ParsedStudentImportRow = Omit<StudentImportPreviewRow, "contact"> & {
  nationalId?: string;
  phone?: string;
  contact?: ParsedStudentContact;
};
const maxStudentImportBytes = 5 * 1024 * 1024;

@Injectable()
export class StudentImportService {
  constructor(
    private readonly students: StudentService,
    private readonly school: SchoolService,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional() private readonly idempotency?: IdempotencyService,
    @Optional() private readonly featureRollouts?: FeatureRolloutService,
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
    if (!idempotencyKey) {
      throw new BadRequestException("IDEMPOTENCY_KEY_REQUIRED");
    }
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
    const rowErrors = errors.filter((error) => error.code !== "ACTIVE_STUDENT_LIMIT_REACHED");

    if (rowErrors.length > 0) {
      throw new BadRequestException({
        code: "STUDENT_IMPORT_INVALID",
        errors: rowErrors,
      });
    }
    if (quota.wouldExceed) {
      throw new ConflictException("ACTIVE_STUDENT_LIMIT_REACHED");
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
      importedContacts: rows.filter((row) => Boolean(row.contact)).length,
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
    const rowPilotErrors: StudentImportError[] = [];
    const registryV2Enabled = await this.isRegistryV2Enabled(context);
    if (registryV2Enabled) {
      for (const row of rows) {
        rowPilotErrors.push(...errorsForCoreOnlyPilot(row));
      }
    }
    if (!registryV2Enabled && rows.some((row) => Boolean(row.guardian))) {
      await this.students.assertGuardianProvisioningAllowed(context);
    }
    const errors = [...rowPilotErrors, ...await this.validateRows(context, rows)];
    const incomingActiveStudents = filterValidRows(rows, errors).filter((row) => Boolean(row.classId)).length;
    const quota = await this.students.previewQuota(context, incomingActiveStudents);

    if (quota.wouldExceed) {
      errors.push({ row: 0, field: "quota", code: "ACTIVE_STUDENT_LIMIT_REACHED" });
    }

    return { rows, errors, quota };
  }

  async export(context: RequestContext): Promise<StudentExportResult> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Students");
    const students = await this.students.list(context);
    const classes = await this.school.listClasses(context);
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
      const workbook = await this.loadWorkbook(bytes);
      if (workbook.worksheets.length === 0) {
        throw new BadRequestException("IMPORT_WORKSHEET_REQUIRED");
      }
      // Numbers/Excel dışa aktarımları başa özet sayfası ekleyebilir; başlık satırı içeren ilk sayfayı al.
      const matrices = workbook.worksheets.map((worksheet) => this.worksheetMatrix(worksheet));
      const matrix = matrices.find((candidate) => candidate.some((row) => isHeaderRow(row.cells))) ?? matrices[0] ?? [];
      return this.readMatrixRows(matrix);
    }
    if (isLegacyXls(bytes)) {
      throw new BadRequestException("IMPORT_FILE_UNSUPPORTED");
    }

    return this.readDelimitedRows(bytes.toString("utf8"));
  }

  private async loadWorkbook(bytes: Buffer): Promise<ExcelJS.Workbook> {
    const workbook = new ExcelJS.Workbook();
    const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    try {
      await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
    } catch {
      throw new BadRequestException("IMPORT_FILE_INVALID");
    }

    return workbook;
  }

  private worksheetMatrix(worksheet: ExcelJS.Worksheet): Array<{ rowNumber: number; cells: string[] }> {
    const matrix: Array<{ rowNumber: number; cells: string[] }> = [];

    worksheet.eachRow((row, rowNumber) => {
      const cells: string[] = [];
      for (let index = 1; index <= row.cellCount; index += 1) {
        cells.push(this.cellText(row.getCell(index).value));
      }
      matrix.push({ rowNumber, cells });
    });

    return matrix;
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
      nationalId: findHeaderIndex(header, ["guardianNationalId", "guardianTc", "veliTc", "veliTcKimlikNo", "veliTckn", "veliKimlikNo"]),
    };
    const contactIndexes: ContactColumnIndexes = {
      firstName: findHeaderIndex(header, ["contactFirstName", "iletisimKisiAdi", "iletişimKişiAdı"]),
      lastName: findHeaderIndex(header, ["contactLastName", "iletisimKisiSoyadi", "iletişimKişiSoyadı"]),
      relation: findHeaderIndex(header, ["contactRelation", "iletisimIliski", "iletişimİlişki"]),
      phone: findHeaderIndex(header, ["contactPhone", "iletisimTelefon", "iletişimTelefon"]),
      email: findHeaderIndex(header, ["contactEmail", "iletisimEposta", "iletişimEposta"]),
    };

    for (const row of matrix.slice(headerRowIndex + 1)) {
      const studentNo = studentNoIndex === undefined ? "" : row.cells[studentNoIndex]?.trim() ?? "";
      const firstName = toTurkishUpperCase(row.cells[firstNameIndex]?.trim() ?? "");
      const lastName = toTurkishUpperCase(row.cells[lastNameIndex]?.trim() ?? "");
      const className = classIndex === undefined ? "" : row.cells[classIndex]?.trim() ?? "";
      const email = readOptionalCell(row.cells, emailIndex);
      const phone = readOptionalCell(row.cells, phoneIndex);
      const nationalId = readOptionalCell(row.cells, nationalIdIndex);
      const guardian = readGuardian(row.cells, guardianIndexes);
      const contact = readContact(row.cells, contactIndexes);
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
        ...(contact ? { contact } : {}),
      });
    }

    return rows;
  }

  private async validateRows(context: RequestContext, rows: ParsedStudentImportRow[]): Promise<StudentImportError[]> {
    const errors: StudentImportError[] = [];
    const classes = await this.school.listClasses(context);
    const classByName = new Map(classes.map((record) => [this.normalizeValue(record.name), record]));
    const existingStudentNos = new Set(
      (await this.students.listStudentNosForImport(context))
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
      if (row.contact) {
        if (!row.contact.firstName) errors.push({ row: row.row, field: "contactFirstName", code: "REQUIRED" });
        if (!row.contact.lastName) errors.push({ row: row.row, field: "contactLastName", code: "REQUIRED" });
        if (row.contact.invalidRelation) {
          errors.push({ row: row.row, field: "contactRelation", code: "INVALID_RELATION_TYPE", value: row.contact.invalidRelation });
        }
        if (row.contact.phone) {
          try {
            row.contact.phone = normalizeTurkishMobilePhone(row.contact.phone, "STUDENT_CONTACT_PHONE_INVALID");
          } catch {
            errors.push({ row: row.row, field: "contactPhone", code: "INVALID_PHONE" });
          }
        }
        if (row.contact.email) {
          row.contact.email = row.contact.email.trim().toLowerCase();
          if (!isEmailLike(row.contact.email)) {
            errors.push({ row: row.row, field: "contactEmail", code: "INVALID_EMAIL" });
          }
        }
      }
    }

    return errors;
  }

  private async isRegistryV2Enabled(context: RequestContext): Promise<boolean> {
    if (!this.featureRollouts) return false;
    return (await this.featureRollouts.resolve(context)).enabledFeatureKeys.includes("web.student-registry-v2");
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

function errorsForCoreOnlyPilot(row: ParsedStudentImportRow): StudentImportError[] {
  const errors: StudentImportError[] = [];
  if (row.nationalId) errors.push({ row: row.row, field: "nationalId", code: "STUDENT_IMPORT_PILOT_CORE_ONLY" });
  if (row.phone) errors.push({ row: row.row, field: "phone", code: "STUDENT_IMPORT_PILOT_CORE_ONLY" });
  if (row.email) errors.push({ row: row.row, field: "email", code: "STUDENT_IMPORT_PILOT_CORE_ONLY" });
  if (row.guardian) errors.push({ row: row.row, field: "guardian", code: "STUDENT_CONTACT_IMPORT_REQUIRED" });
  return errors;
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

function isHeaderRow(cells: string[]): boolean {
  return findHeaderIndex(cells, ["firstName", "ad", "adi", "adı", "isim"]) !== undefined &&
    findHeaderIndex(cells, ["lastName", "soyad", "soyadi", "soyadı"]) !== undefined;
}

function findHeaderRowIndex(matrix: Array<{ cells: string[] }>): number {
  const index = matrix.findIndex((row) => isHeaderRow(row.cells));
  return index === -1 ? 0 : index;
}

interface GuardianColumnIndexes {
  firstName?: number;
  lastName?: number;
  phone?: number;
  nationalId?: number;
}

interface ContactColumnIndexes {
  firstName?: number;
  lastName?: number;
  relation?: number;
  phone?: number;
  email?: number;
}

function filterValidRows<T extends { row: number }>(rows: T[], errors: StudentImportError[]): T[] {
  const invalidRows = new Set(errors.filter((error) => error.row > 0).map((error) => error.row));
  return rows.filter((row) => !invalidRows.has(row.row));
}

function toPreviewRow(row: ParsedStudentImportRow): StudentImportPreviewRow {
  const { nationalId: _nationalId, phone: _phone, contact, ...previewRow } = row;
  if (previewRow.guardian?.nationalId) {
    previewRow.guardian = {
      ...previewRow.guardian,
      nationalId: maskTcIdentity(previewRow.guardian.nationalId),
    };
  }
  return {
    ...previewRow,
    ...(contact ? {
      contact: {
        firstName: contact.firstName,
        lastName: contact.lastName,
        relationType: contact.relationType,
        ...(contact.phone ? { phoneMasked: maskContactPhone(contact.phone) } : {}),
        ...(contact.email ? { emailMasked: maskContactEmail(contact.email) } : {}),
      },
    } : {}),
  };
}

function maskedNationalIdValue(value: string): { value?: string } {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? { value: `*******${digits.slice(-4)}` } : {};
}

function readGuardian(cells: string[], indexes: GuardianColumnIndexes): StudentGuardianProvisionInput | undefined {
  const firstName = toTurkishUpperCase(readOptionalCell(cells, indexes.firstName));
  const lastName = toTurkishUpperCase(readOptionalCell(cells, indexes.lastName));
  const phone = readOptionalCell(cells, indexes.phone);
  const nationalId = readOptionalCell(cells, indexes.nationalId);
  if (!firstName && !lastName && !phone && !nationalId) return undefined;

  return {
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    nationalId: nationalId || undefined,
    phone: phone || undefined,
  };
}

function readContact(cells: string[], indexes: ContactColumnIndexes): ParsedStudentContact | undefined {
  const firstName = toTurkishUpperCase(readOptionalCell(cells, indexes.firstName));
  const lastName = toTurkishUpperCase(readOptionalCell(cells, indexes.lastName));
  const relation = readOptionalCell(cells, indexes.relation);
  const phone = readOptionalCell(cells, indexes.phone);
  const email = readOptionalCell(cells, indexes.email);
  if (!firstName && !lastName && !relation && !phone && !email) return undefined;
  const relationType = parseContactRelation(relation);
  return {
    firstName,
    lastName,
    relationType: relationType ?? "OTHER",
    ...(relation && !relationType ? { invalidRelation: relation } : {}),
    ...(phone ? { phone } : {}),
    ...(email ? { email } : {}),
    canReceiveSms: false,
    canReceiveAnnouncements: false,
    canReceiveFinance: false,
  };
}

function parseContactRelation(value: string): StudentContactRelationType | undefined {
  if (!value) return "OTHER";
  const normalized = value.trim().toLocaleUpperCase("tr-TR").replace(/[\s_-]+/g, "_");
  const relations: Record<string, StudentContactRelationType> = {
    MOTHER: "MOTHER",
    ANNE: "MOTHER",
    FATHER: "FATHER",
    BABA: "FATHER",
    LEGAL_GUARDIAN: "LEGAL_GUARDIAN",
    YASAL_VELI: "LEGAL_GUARDIAN",
    YASAL_VELİ: "LEGAL_GUARDIAN",
    OTHER: "OTHER",
    DIGER: "OTHER",
    DİĞER: "OTHER",
  };
  return relations[normalized];
}

function readOptionalCell(cells: string[], index: number | undefined): string {
  return index === undefined ? "" : cells[index]?.trim() ?? "";
}

function isEmailLike(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
}

function normalizeHeader(value: string): string {
  return value.trim().toLocaleLowerCase("tr-TR").replace(/[\s_-]+/g, "");
}
