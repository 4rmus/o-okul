import { BadRequestException, ConflictException, Injectable, Optional } from "@nestjs/common";
import ExcelJS from "exceljs";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { StudentService, type StudentRecord } from "./student.service.js";

export interface StudentImportError {
  row: number;
  field: "firstName" | "lastName" | "quota";
  code: "REQUIRED" | "STUDENT_QUOTA_EXCEEDED";
}

export interface StudentImportPreviewRow {
  row: number;
  firstName: string;
  lastName: string;
}

export interface StudentImportDryRunResult {
  dryRun: true;
  totalRows: number;
  validRows: StudentImportPreviewRow[];
  errors: StudentImportError[];
  quota: {
    limit: number;
    current: number;
    incoming: number;
    wouldExceed: boolean;
  };
  wouldImport: boolean;
}

export interface StudentImportResult {
  importedRows: number;
  students: StudentRecord[];
}

export interface StudentExportResult {
  fileName: string;
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  fileBase64: string;
  rowCount: number;
}

interface StudentImportDryRunInput {
  fileBase64?: string;
}

@Injectable()
export class StudentImportService {
  constructor(
    private readonly students: StudentService,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async dryRun(context: RequestContext, input: StudentImportDryRunInput): Promise<StudentImportDryRunResult> {
    if (!input.fileBase64) {
      throw new BadRequestException("IMPORT_FILE_REQUIRED");
    }

    const worksheet = await this.readFirstWorksheet(input.fileBase64);
    const rows = this.readRows(worksheet);
    const errors = this.validateRows(rows);
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

  async import(context: RequestContext, input: StudentImportDryRunInput): Promise<StudentImportResult> {
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
      students,
    };
  }

  async export(context: RequestContext): Promise<StudentExportResult> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Students");
    const students = await this.students.list(context);

    worksheet.addRow(["firstName", "lastName"]);
    for (const student of students) {
      worksheet.addRow([student.firstName, student.lastName]);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    return {
      fileName: "students.xlsx",
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileBase64: Buffer.from(buffer).toString("base64"),
      rowCount: students.length,
    };
  }

  private async readFirstWorksheet(fileBase64: string): Promise<ExcelJS.Worksheet> {
    const workbook = new ExcelJS.Workbook();
    const bytes = Buffer.from(fileBase64, "base64");
    const file = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    await workbook.xlsx.load(file as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) {
      throw new BadRequestException("IMPORT_WORKSHEET_REQUIRED");
    }

    return worksheet;
  }

  private readRows(worksheet: ExcelJS.Worksheet): StudentImportPreviewRow[] {
    const rows: StudentImportPreviewRow[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;

      const firstName = this.cellText(row.getCell(1).value);
      const lastName = this.cellText(row.getCell(2).value);
      if (!firstName && !lastName) return;

      rows.push({ row: rowNumber, firstName, lastName });
    });

    return rows;
  }

  private validateRows(rows: StudentImportPreviewRow[]): StudentImportError[] {
    const errors: StudentImportError[] = [];

    for (const row of rows) {
      if (!row.firstName) {
        errors.push({ row: row.row, field: "firstName", code: "REQUIRED" });
      }
      if (!row.lastName) {
        errors.push({ row: row.row, field: "lastName", code: "REQUIRED" });
      }
    }

    return errors;
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
