import { createHash } from "node:crypto";
import { BadRequestException, ForbiddenException, Inject, Injectable, Optional, PayloadTooLargeException } from "@nestjs/common";
import type {
  TeacherAssignmentRecord,
  TeacherImportDryRunResult,
  TeacherImportError,
  TeacherImportPreviewRow,
  TeacherImportResult,
  TeacherRecord,
} from "@o-okul/shared-types";
import ExcelJS from "exceljs";
import { normalizeTurkishMobilePhone } from "../auth/phone-normalize.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { maskTcIdentity, normalizeTcIdentity } from "../student/tc-identity.js";
import { type ClassStore, classStoreToken } from "../school/class-store.js";
import { type CourseStore, courseStoreToken } from "../school/course-store.js";
import { TeacherService } from "./teacher.service.js";
import {
  type TeacherAssignmentStore,
  teacherAssignmentStoreToken,
} from "../school/teacher-assignment-store.js";
import { type TeacherStore, teacherStoreToken } from "../school/teacher-store.js";

interface TeacherImportInput {
  fileBase64?: string;
}

type ParsedTeacherImportRow = TeacherImportPreviewRow & {
  hasCourseColumn: boolean;
  nationalId?: string;
  phone?: string;
};

const maxTeacherImportBytes = 5 * 1024 * 1024;

@Injectable()
export class TeacherImportService {
  constructor(
    private readonly teacherService: TeacherService,
    @Inject(classStoreToken) private readonly classes: ClassStore,
    @Inject(courseStoreToken) private readonly courses: CourseStore,
    @Inject(teacherStoreToken) private readonly teachers: TeacherStore,
    @Inject(teacherAssignmentStoreToken) private readonly teacherAssignments: TeacherAssignmentStore,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async dryRun(context: RequestContext, input: TeacherImportInput): Promise<TeacherImportDryRunResult> {
    if (!input.fileBase64) {
      throw new BadRequestException("IMPORT_FILE_REQUIRED");
    }

    const { rows, errors } = await this.readAndValidateRows(context, input.fileBase64);
    return {
      dryRun: true,
      totalRows: rows.length,
      validRows: errors.length > 0 ? [] : rows.map(toPreviewRow),
      errors,
      wouldImport: errors.length === 0,
    };
  }

  async import(context: RequestContext, input: TeacherImportInput, idempotencyKey?: string): Promise<TeacherImportResult> {
    const idempotencyRequest = {
      fileSha256: input.fileBase64 ? createSha256(Buffer.from(input.fileBase64, "base64")) : undefined,
    };
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "teacher.import.commit", request: idempotencyRequest },
        () => this.importOnce(context, input),
      );
    }

    return this.importOnce(context, input);
  }

  private async importOnce(context: RequestContext, input: TeacherImportInput): Promise<TeacherImportResult> {
    if (!input.fileBase64) {
      throw new BadRequestException("IMPORT_FILE_REQUIRED");
    }
    const { rows, errors } = await this.readAndValidateRows(context, input.fileBase64);
    if (errors.length > 0) {
      throw new BadRequestException({
        error: {
          code: "TEACHER_IMPORT_INVALID",
          message: "Öğretmen aktarım dosyası geçersiz.",
          details: errors,
        },
      });
    }

    const tenantId = context.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const existingTeachers = (await this.teachers.list()).filter((teacher) => teacher.tenantId === tenantId && !teacher.deletedAt);
    const teacherByKey = new Map(existingTeachers.map((teacher) => [teacherKey(teacher), teacher]));
    const existingAssignments = (await this.teacherAssignments.list()).filter((assignment) => assignment.tenantId === tenantId);
    const assignmentKeys = new Set(existingAssignments.map(assignmentKey));
    const importedTeachers = new Map<string, TeacherRecord>();
    const createdAssignments: TeacherAssignmentRecord[] = [];
    let createdTeachers = 0;

    for (const row of rows) {
      const key = teacherKey(row);
      let teacher = teacherByKey.get(key);
      if (!teacher) {
        teacher = await this.teacherService.createTeacher(context, {
          branch: row.branch,
          firstName: row.firstName,
          lastName: row.lastName,
          nationalId: row.nationalId,
          phone: row.phone,
        });
        teacherByKey.set(key, teacher);
        createdTeachers += 1;
      } else if (row.nationalId && row.phone && !teacher.userId) {
        teacher = await this.teacherService.updateTeacher(context, teacher.id, {
          nationalId: row.nationalId,
          phone: row.phone,
        });
        teacherByKey.set(key, teacher);
      }
      importedTeachers.set(teacher.id, teacher);

      if (!row.classId) continue;

      const role: TeacherAssignmentRecord["role"] = row.courseId ? "BRANCH_TEACHER" : "CLASS_TEACHER";
      const nextAssignmentKey = assignmentKey({
        classId: row.classId,
        courseId: row.courseId,
        role,
        teacherId: teacher.id,
      });
      if (assignmentKeys.has(nextAssignmentKey)) continue;

      const assignment = await this.teacherService.createTeacherAssignment(context, teacher.id, {
        classId: row.classId,
        courseId: row.courseId,
        role,
      });
      assignmentKeys.add(nextAssignmentKey);
      createdAssignments.push(assignment);
    }

    return {
      importedRows: rows.length,
      createdTeachers,
      createdAssignments: createdAssignments.length,
      teachers: [...importedTeachers.values()],
      assignments: createdAssignments,
    };
  }

  private async readAndValidateRows(
    context: RequestContext,
    fileBase64: string | undefined,
  ): Promise<{ rows: ParsedTeacherImportRow[]; errors: TeacherImportError[] }> {
    if (!fileBase64) {
      throw new BadRequestException("IMPORT_FILE_REQUIRED");
    }
    const rows = await this.readRows(fileBase64);
    return { rows, errors: await this.validateRows(context, rows) };
  }

  private async readRows(fileBase64: string): Promise<ParsedTeacherImportRow[]> {
    const bytes = Buffer.from(fileBase64, "base64");
    if (bytes.length > maxTeacherImportBytes) {
      throw new PayloadTooLargeException("IMPORT_FILE_TOO_LARGE");
    }
    if (isXlsx(bytes)) {
      const workbook = new ExcelJS.Workbook();
      const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
      if (workbook.worksheets.length === 0) {
        throw new BadRequestException("IMPORT_WORKSHEET_REQUIRED");
      }

      // Numbers/Excel dışa aktarımları başa özet sayfası ekleyebilir; başlık satırı içeren ilk sayfayı al.
      const matrices = workbook.worksheets.map(worksheetMatrix);
      const matrix = matrices.find((candidate) => candidate.some((row) => isHeaderRow(row.cells))) ?? matrices[0] ?? [];
      return readMatrixRows(matrix);
    }

    const lines = bytes.toString("utf8").replace(/^\uFEFF/, "").split(/\r?\n/);
    const delimiter = detectDelimiter(lines.find((line) => line.trim()) ?? "");
    const matrix = lines
      .map((line, index) => ({ rowNumber: index + 1, cells: parseDelimitedLine(line, delimiter).map((cell) => cell.trim()) }))
      .filter((row) => row.cells.some((cell) => cell));
    return readMatrixRows(matrix);
  }

  private async validateRows(context: RequestContext, rows: ParsedTeacherImportRow[]): Promise<TeacherImportError[]> {
    const tenantId = context.tenantId;
    if (!tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const errors: TeacherImportError[] = [];
    const classes = (await this.classes.list()).filter((record) => record.tenantId === tenantId && !record.deletedAt);
    const courses = (await this.courses.list()).filter((record) => record.tenantId === tenantId && !record.deletedAt);
    const classByName = new Map(classes.map((record) => [normalizeValue(record.name), record]));
    const courseByNameOrCode = new Map<string, (typeof courses)[number]>();
    for (const course of courses) {
      courseByNameOrCode.set(normalizeValue(course.name), course);
      if (course.code) courseByNameOrCode.set(normalizeValue(course.code), course);
    }

    for (const row of rows) {
      if (!row.firstName) {
        errors.push({ row: row.row, field: "firstName", code: "REQUIRED" });
      }
      if (!row.lastName) {
        errors.push({ row: row.row, field: "lastName", code: "REQUIRED" });
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
          row.nationalId = normalizeTcIdentity(row.nationalId, "TEACHER_NATIONAL_ID_INVALID");
        } catch {
          identityValid = false;
          errors.push({ row: row.row, field: "nationalId", code: "INVALID", ...maskedNationalIdValue(row.nationalId) });
        }
      }
      if (row.phone) {
        try {
          row.phone = normalizeTurkishMobilePhone(row.phone, "TEACHER_PHONE_INVALID");
        } catch {
          identityValid = false;
          errors.push({ row: row.row, field: "phone", code: "INVALID" });
        }
      }
      if (identityValid && row.nationalId && row.phone) {
        row.accountPreview = {
          usernameMasked: maskTcIdentity(row.nationalId),
          willCreate: true,
        };
      }
      if (row.courseName && !row.className) {
        errors.push({ row: row.row, field: "className", code: "REQUIRED" });
      }
      if (row.className) {
        const classRecord = classByName.get(normalizeValue(row.className));
        if (classRecord) {
          row.classId = classRecord.id;
        } else {
          errors.push({ row: row.row, field: "className", code: "CLASS_NOT_FOUND", value: row.className });
        }
      }
      const inferredCourseName = !row.hasCourseColumn && row.className && row.branch ? row.branch : undefined;
      const courseName = row.courseName ?? inferredCourseName;
      if (courseName) {
        const course = courseByNameOrCode.get(normalizeValue(courseName));
        if (course) {
          row.courseId = course.id;
          row.courseName = courseName;
        } else if (row.courseName) {
          errors.push({ row: row.row, field: "courseName", code: "COURSE_NOT_FOUND", value: row.courseName });
        }
      }
    }

    return errors;
  }
}

function createSha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function toPreviewRow(row: ParsedTeacherImportRow): TeacherImportPreviewRow {
  const { hasCourseColumn: _hasCourseColumn, nationalId: _nationalId, phone: _phone, ...previewRow } = row;
  return previewRow;
}

function maskedNationalIdValue(value: string): { value?: string } {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 4 ? { value: `*******${digits.slice(-4)}` } : {};
}

function readMatrixRows(matrix: Array<{ rowNumber: number; cells: string[] }>): ParsedTeacherImportRow[] {
  const rows: ParsedTeacherImportRow[] = [];
  const headerRowIndex = findHeaderRowIndex(matrix);
  const header = matrix[headerRowIndex]?.cells ?? [];
  const firstNameIndex = findHeaderIndex(header, ["firstName", "ad", "adi", "adı", "isim"]) ?? 0;
  const lastNameIndex = findHeaderIndex(header, ["lastName", "soyad", "soyadi", "soyadı"]) ?? 1;
  const branchIndex = findHeaderIndex(header, ["branch", "brans", "branş", "dersBransi", "dersBranşı"]);
  const nationalIdIndex = findHeaderIndex(header, ["nationalId", "tc", "tckn", "tcKimlik", "tcKimlikNo", "kimlikNo"]);
  const phoneIndex = findHeaderIndex(header, ["phone", "telefon", "cepTelefonu", "cep", "gsm", "ogretmenTelefon", "öğretmenTelefon"]);
  const classIndex = findHeaderIndex(header, ["class", "className", "atanacakSinif", "atanacakSınıf", "sinif", "sınıf"]);
  const courseIndex = findHeaderIndex(header, ["course", "courseName", "ders", "dersAdi", "dersAdı"]);

  for (const row of matrix.slice(headerRowIndex + 1)) {
    const firstName = row.cells[firstNameIndex]?.trim() ?? "";
    const lastName = row.cells[lastNameIndex]?.trim() ?? "";
    const branch = branchIndex === undefined ? "" : row.cells[branchIndex]?.trim() ?? "";
    const nationalId = nationalIdIndex === undefined ? "" : row.cells[nationalIdIndex]?.trim() ?? "";
    const phone = phoneIndex === undefined ? "" : row.cells[phoneIndex]?.trim() ?? "";
    const className = classIndex === undefined ? "" : row.cells[classIndex]?.trim() ?? "";
    const courseName = courseIndex === undefined ? "" : row.cells[courseIndex]?.trim() ?? "";
    if (!firstName && !lastName && !branch && !nationalId && !phone && !className && !courseName) continue;

    rows.push({
      row: row.rowNumber,
      firstName,
      lastName,
      hasCourseColumn: courseIndex !== undefined,
      ...(branch ? { branch } : {}),
      ...(nationalId ? { nationalId } : {}),
      ...(phone ? { phone } : {}),
      ...(className ? { className } : {}),
      ...(courseName ? { courseName } : {}),
    });
  }

  return rows;
}

function teacherKey(input: { branch?: string; firstName: string; lastName: string }): string {
  return [input.firstName, input.lastName, input.branch ?? ""].map(normalizeValue).join("|");
}

function assignmentKey(input: {
  classId?: string;
  courseId?: string;
  role: TeacherAssignmentRecord["role"];
  teacherId: string;
}): string {
  return [input.teacherId, input.classId ?? "", input.courseId ?? "", input.role].join("|");
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

function worksheetMatrix(worksheet: ExcelJS.Worksheet): Array<{ rowNumber: number; cells: string[] }> {
  const matrix: Array<{ rowNumber: number; cells: string[] }> = [];
  worksheet.eachRow((row, rowNumber) => {
    const cells: string[] = [];
    for (let index = 1; index <= row.cellCount; index += 1) {
      cells.push(cellText(row.getCell(index).value));
    }
    matrix.push({ rowNumber, cells });
  });
  return matrix;
}

function isHeaderRow(cells: string[]): boolean {
  return findHeaderIndex(cells, ["firstName", "ad", "adi", "adı", "isim"]) !== undefined &&
    findHeaderIndex(cells, ["lastName", "soyad", "soyadi", "soyadı"]) !== undefined;
}

function findHeaderRowIndex(matrix: Array<{ cells: string[] }>): number {
  const index = matrix.findIndex((row) => isHeaderRow(row.cells));
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
