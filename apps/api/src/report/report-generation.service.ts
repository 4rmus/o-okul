import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type {
  ReportErrorBooklet,
  ReportScopeRank,
  ReportStudentBranchStatistics,
  ReportStudentBranchSummary,
  ReportStudentOutcomeSummary,
  ReportStudentProgress,
  ReportStudentProgressPoint,
  ReportStudentQuestionSummary,
  ReportStudentScoreSummary,
  ReportStudentSnapshot,
  ReportStudentStatistics,
} from "@uzman-hocam/shared-types";
import ExcelJS from "exceljs";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import type { ProducedJob, TenantQueueJobInput } from "../queue/job-producer.js";
import { reportSnapshotStoreToken, type ReportSnapshotStore } from "./report-snapshot-store.js";

export const reportGenerationQueueProducerToken = Symbol("reportGenerationQueueProducer");
export const reportPdfRendererToken = Symbol("reportPdfRenderer");
export const examResultSummaryReportType = "EXAM_RESULT_SUMMARY";

export interface ReportGenerationQueueProducer {
  enqueue(input: TenantQueueJobInput): Promise<ProducedJob>;
}

export interface EnqueueReportGenerationInput {
  examId?: string;
  reportType?: string;
  contentHash?: string;
}

export interface ReportGenerationQueueResult {
  tenantId: string;
  examId: string;
  reportType: typeof examResultSummaryReportType;
  queueName: "report-generation";
  jobId: string;
  status: "queued";
}

export interface ReportSnapshotRecord {
  id: string;
  tenantId: string;
  examId: string;
  reportType: string;
  status: string;
  inputRefs: Record<string, unknown>;
  snapshotData?: Record<string, unknown>;
  generatedAt?: string;
  staleAt?: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReportSnapshotExportResult {
  fileName: string;
  contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  fileBase64: string;
  rowCount: number;
}

export interface ReportSnapshotPdfResult {
  fileName: string;
  contentType: "application/pdf";
  fileBase64: string;
  pageCount: number;
}

export interface ReportPdfRenderInput {
  html: string;
  fallbackLines: string[];
}

export interface ReportPdfRenderer {
  render(input: ReportPdfRenderInput): Promise<Buffer>;
}

@Injectable()
export class ReportGenerationService {
  constructor(
    @Inject(reportGenerationQueueProducerToken)
    private readonly producer: ReportGenerationQueueProducer,
    @Inject(reportSnapshotStoreToken)
    private readonly snapshots: ReportSnapshotStore,
    @Optional()
    @Inject(reportPdfRendererToken)
    private readonly pdfRenderer: ReportPdfRenderer = createReportPdfRenderer(),
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async enqueueGeneration(
    context: RequestContext,
    input: EnqueueReportGenerationInput,
  ): Promise<ReportGenerationQueueResult> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const examId = required(input.examId, "REPORT_EXAM_REQUIRED");
    const reportType = parseReportType(input.reportType);
    const contentHash = required(input.contentHash, "REPORT_CONTENT_HASH_REQUIRED");

    const job = await this.producer.enqueue({
      queueName: "report-generation",
      tenantId: context.tenantId,
      userId: context.userId,
      entityId: examId,
      contentHash,
      reportType,
    });
    await this.auditLogs?.record({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      entityType: "ReportGeneration",
      entityId: examId,
      action: "report_generation.queued",
      diff: { reportType, contentHash, jobId: job.options.jobId },
    });

    return {
      tenantId: context.tenantId,
      examId,
      reportType,
      queueName: "report-generation",
      jobId: job.options.jobId,
      status: "queued",
    };
  }

  async listSnapshots(context: RequestContext, examId: string | undefined): Promise<ReportSnapshotRecord[]> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    return this.snapshots.listByExam(context.tenantId, required(examId, "REPORT_EXAM_REQUIRED"));
  }

  async exportSnapshotExcel(
    context: RequestContext,
    examId: string | undefined,
    snapshotId: string | undefined,
  ): Promise<ReportSnapshotExportResult> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedSnapshotId = required(snapshotId, "REPORT_SNAPSHOT_REQUIRED");
    const snapshot = await this.snapshots.findById(context.tenantId, resolvedExamId, resolvedSnapshotId);
    if (!snapshot) {
      throw new NotFoundException("REPORT_SNAPSHOT_NOT_FOUND");
    }
    if (snapshot.status !== "READY" || !snapshot.snapshotData) {
      throw new BadRequestException("REPORT_SNAPSHOT_NOT_READY");
    }

    return createSnapshotWorkbook(snapshot);
  }

  async exportSnapshotPdf(
    context: RequestContext,
    examId: string | undefined,
    snapshotId: string | undefined,
  ): Promise<ReportSnapshotPdfResult> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedSnapshotId = required(snapshotId, "REPORT_SNAPSHOT_REQUIRED");
    const snapshot = await this.snapshots.findById(context.tenantId, resolvedExamId, resolvedSnapshotId);
    if (!snapshot) {
      throw new NotFoundException("REPORT_SNAPSHOT_NOT_FOUND");
    }
    if (snapshot.status !== "READY" || !snapshot.snapshotData) {
      throw new BadRequestException("REPORT_SNAPSHOT_NOT_READY");
    }

    return createSnapshotPdf(snapshot, this.pdfRenderer);
  }

  async getStudentReport(
    context: RequestContext,
    examId: string | undefined,
    snapshotId: string | undefined,
    studentId: string | undefined,
  ): Promise<ReportStudentSnapshot> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedSnapshotId = required(snapshotId, "REPORT_SNAPSHOT_REQUIRED");
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    const snapshot = await this.snapshots.findById(context.tenantId, resolvedExamId, resolvedSnapshotId);
    if (!snapshot) {
      throw new NotFoundException("REPORT_SNAPSHOT_NOT_FOUND");
    }
    if (snapshot.status !== "READY" || !snapshot.snapshotData) {
      throw new BadRequestException("REPORT_SNAPSHOT_NOT_READY");
    }

    const student = readRecords(snapshot.snapshotData.students)
      .find((candidate) => readText(candidate.studentId) === resolvedStudentId);
    if (!student) {
      throw new NotFoundException("REPORT_STUDENT_NOT_FOUND");
    }

    const classId = readText(student.classId);
    const className = readText(student.className);
    const outcomes = readRecords(student.outcomes).map(readOutcomeSummary);
    const statistics = readStudentStatistics(student.statistics);
    return {
      tenantId: context.tenantId,
      examId: resolvedExamId,
      snapshotId: resolvedSnapshotId,
      studentId: resolvedStudentId,
      ...(classId ? { classId } : {}),
      ...(className ? { className } : {}),
      resultKey: readText(student.resultKey),
      total: readScoreSummary(student.total),
      branches: readRecords(student.branches).map(readBranchSummary),
      ...(outcomes.length > 0 ? { outcomes } : {}),
      ...(statistics ? { statistics } : {}),
      generatedAt: snapshot.generatedAt,
    };
  }

  async getLatestStudentReport(
    context: RequestContext,
    examId: string | undefined,
    studentId: string | undefined,
  ): Promise<ReportStudentSnapshot> {
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    const snapshotId = await this.findLatestReadyStudentSnapshotId(context, examId, resolvedStudentId);
    return this.getStudentReport(context, examId, snapshotId, resolvedStudentId);
  }

  async getStudentErrorBooklet(
    context: RequestContext,
    examId: string | undefined,
    snapshotId: string | undefined,
    studentId: string | undefined,
  ): Promise<ReportErrorBooklet> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedSnapshotId = required(snapshotId, "REPORT_SNAPSHOT_REQUIRED");
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    const snapshot = await this.snapshots.findById(context.tenantId, resolvedExamId, resolvedSnapshotId);
    if (!snapshot) {
      throw new NotFoundException("REPORT_SNAPSHOT_NOT_FOUND");
    }
    if (snapshot.status !== "READY" || !snapshot.snapshotData) {
      throw new BadRequestException("REPORT_SNAPSHOT_NOT_READY");
    }

    const student = readRecords(snapshot.snapshotData.students)
      .find((candidate) => readText(candidate.studentId) === resolvedStudentId);
    if (!student) {
      throw new NotFoundException("REPORT_STUDENT_NOT_FOUND");
    }

    const items = readRecords(student.questions)
      .map(readQuestionSummary)
      .filter((question) => question.status === "WRONG" || question.status === "BLANK");

    return {
      tenantId: context.tenantId,
      examId: resolvedExamId,
      snapshotId: resolvedSnapshotId,
      studentId: resolvedStudentId,
      items,
      generatedAt: snapshot.generatedAt,
    };
  }

  async getLatestStudentErrorBooklet(
    context: RequestContext,
    examId: string | undefined,
    studentId: string | undefined,
  ): Promise<ReportErrorBooklet> {
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    const snapshotId = await this.findLatestReadyStudentSnapshotId(context, examId, resolvedStudentId);
    return this.getStudentErrorBooklet(context, examId, snapshotId, resolvedStudentId);
  }

  async getStudentProgress(
    context: RequestContext,
    examId: string | undefined,
    studentId: string | undefined,
  ): Promise<ReportStudentProgress> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const resolvedStudentId = required(studentId, "REPORT_STUDENT_REQUIRED");
    const snapshots = await this.snapshots.listByExam(context.tenantId, resolvedExamId);
    const points: ReportStudentProgressPoint[] = [];

    for (const snapshot of snapshots) {
      if (snapshot.status !== "READY" || !snapshot.snapshotData) continue;

      const student = readRecords(snapshot.snapshotData.students)
        .find((candidate) => readText(candidate.studentId) === resolvedStudentId);
      if (student) {
        points.push({
          snapshotId: snapshot.id,
          ...(snapshot.generatedAt ? { generatedAt: snapshot.generatedAt } : {}),
          total: readScoreSummary(student.total),
        });
      }
    }

    points.sort((a, b) => toTime(a.generatedAt) - toTime(b.generatedAt));

    if (points.length === 0) {
      throw new NotFoundException("REPORT_STUDENT_PROGRESS_NOT_FOUND");
    }

    return {
      tenantId: context.tenantId,
      examId: resolvedExamId,
      studentId: resolvedStudentId,
      points,
      netDelta: delta(points, (point) => point.total.net),
      standardScoreDelta: delta(points, (point) => point.total.standardScore),
    };
  }

  private async findLatestReadyStudentSnapshotId(
    context: RequestContext,
    examId: string | undefined,
    studentId: string,
  ): Promise<string> {
    if (!context.tenantId) {
      throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    }

    const resolvedExamId = required(examId, "REPORT_EXAM_REQUIRED");
    const snapshots = await this.snapshots.listByExam(context.tenantId, resolvedExamId);
    const snapshot = snapshots
      .filter((candidate) => candidate.status === "READY" && candidate.snapshotData)
      .sort((a, b) => toTime(b.generatedAt ?? b.createdAt) - toTime(a.generatedAt ?? a.createdAt))
      .find((candidate) =>
        readRecords(candidate.snapshotData?.students).some((student) => readText(student.studentId) === studentId),
      );

    if (!snapshot) {
      throw new NotFoundException("REPORT_STUDENT_NOT_FOUND");
    }

    return snapshot.id;
  }
}

function parseReportType(value: string | undefined): typeof examResultSummaryReportType {
  const reportType = required(value, "REPORT_TYPE_REQUIRED");
  if (reportType !== examResultSummaryReportType) {
    throw new BadRequestException("REPORT_TYPE_UNSUPPORTED");
  }
  return reportType;
}

function required(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}

async function createSnapshotWorkbook(snapshot: ReportSnapshotRecord): Promise<ReportSnapshotExportResult> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Uzman Hocam";
  workbook.created = new Date();

  const summary = workbook.addWorksheet("Summary");
  const snapshotData = snapshot.snapshotData ?? {};
  const averages = readRecord(snapshotData.averages);

  summary.addRows([
    ["examId", snapshot.examId],
    ["snapshotId", snapshot.id],
    ["reportType", snapshot.reportType],
    ["status", snapshot.status],
    ["generatedAt", snapshot.generatedAt ?? ""],
    ["resultCount", readNumber(snapshotData.resultCount)],
    ["averageNet", readNumber(averages.net)],
    ["averageRawScore", readNumber(averages.rawScore)],
    ["averageStandardScore", readNumber(averages.standardScore)],
  ]);

  const branches = workbook.addWorksheet("Branches");
  branches.addRow(["branch", "resultCount", "correct", "wrong", "blank", "net"]);
  for (const branch of readRecords(snapshotData.branches)) {
    branches.addRow([
      readText(branch.branch),
      readNumber(branch.resultCount),
      readNumber(branch.correct),
      readNumber(branch.wrong),
      readNumber(branch.blank),
      readNumber(branch.net),
    ]);
  }

  const classes = workbook.addWorksheet("Classes");
  classes.addRow(["classId", "className", "resultCount", "correct", "wrong", "blank", "net", "rawScore", "standardScore"]);
  for (const classSummary of readRecords(snapshotData.classes)) {
    const averages = readRecord(classSummary.averages);
    classes.addRow([
      readText(classSummary.classId),
      readText(classSummary.className),
      readNumber(classSummary.resultCount),
      readNumber(averages.correct),
      readNumber(averages.wrong),
      readNumber(averages.blank),
      readNumber(averages.net),
      readNumber(averages.rawScore),
      readNumber(averages.standardScore),
    ]);
  }

  const students = workbook.addWorksheet("Students");
  students.addRow(["studentId", "classId", "className", "resultKey", "correct", "wrong", "blank", "net", "rawScore", "standardScore"]);
  for (const student of readRecords(snapshotData.students)) {
    const total = readRecord(student.total);
    students.addRow([
      readText(student.studentId),
      readText(student.classId),
      readText(student.className),
      readText(student.resultKey),
      readNumber(total.correct),
      readNumber(total.wrong),
      readNumber(total.blank),
      readNumber(total.net),
      readNumber(total.rawScore),
      readNumber(total.standardScore),
    ]);
  }

  for (const worksheet of workbook.worksheets) {
    worksheet.columns.forEach((column) => {
      column.width = 18;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return {
    fileName: `${snapshot.examId}-${snapshot.id}.xlsx`,
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    fileBase64: Buffer.from(buffer).toString("base64"),
    rowCount: readRecords(snapshotData.students).length,
  };
}

export function createReportPdfRenderer(): ReportPdfRenderer {
  const executablePath = process.env.REPORT_PDF_BROWSER_EXECUTABLE_PATH ?? process.env.PUPPETEER_EXECUTABLE_PATH;
  return executablePath ? new PuppeteerReportPdfRenderer(executablePath) : new SimpleReportPdfRenderer();
}

class PuppeteerReportPdfRenderer implements ReportPdfRenderer {
  constructor(private readonly executablePath: string) {}

  async render(input: ReportPdfRenderInput): Promise<Buffer> {
    const puppeteer = await import("puppeteer-core");
    const browser = await puppeteer.launch({
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
      executablePath: this.executablePath,
      headless: true,
    });

    try {
      const page = await browser.newPage();
      await page.setContent(input.html, { waitUntil: "domcontentloaded" });
      const pdf = await page.pdf({
        format: "A4",
        margin: { bottom: "16mm", left: "14mm", right: "14mm", top: "16mm" },
        printBackground: true,
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
}

class SimpleReportPdfRenderer implements ReportPdfRenderer {
  async render(input: ReportPdfRenderInput): Promise<Buffer> {
    return buildSimplePdf(input.fallbackLines);
  }
}

async function createSnapshotPdf(
  snapshot: ReportSnapshotRecord,
  renderer: ReportPdfRenderer,
): Promise<ReportSnapshotPdfResult> {
  const lines = createSnapshotPdfLines(snapshot);
  const pdf = await renderer.render({
    fallbackLines: lines,
    html: createSnapshotPdfHtml(snapshot),
  });

  return {
    fileName: `${snapshot.examId}-${snapshot.id}.pdf`,
    contentType: "application/pdf",
    fileBase64: pdf.toString("base64"),
    pageCount: 1,
  };
}

function createSnapshotPdfLines(snapshot: ReportSnapshotRecord): string[] {
  const snapshotData = snapshot.snapshotData ?? {};
  const averages = readRecord(snapshotData.averages);
  return [
    "Uzman Hocam - Sinav Raporu",
    `Sinav: ${snapshot.examId}`,
    `Snapshot: ${snapshot.id}`,
    `Durum: ${snapshot.status}`,
    `Uretim: ${snapshot.generatedAt ?? "-"}`,
    "",
    "Genel Ozet",
    `Sonuc sayisi: ${readNumber(snapshotData.resultCount) || "-"}`,
    `Ortalama net: ${readNumber(averages.net) || "-"}`,
    `Standart puan: ${readNumber(averages.standardScore) || "-"}`,
    "",
    "Branslar",
    ...readRecords(snapshotData.branches).slice(0, 8).map((branch) =>
      `${readText(branch.branch) || "-"}: ${readNumber(branch.resultCount) || "-"} sonuc, ${readNumber(branch.net) || "-"} net`
    ),
    "",
    "Siniflar",
    ...readRecords(snapshotData.classes).slice(0, 8).map((classSummary) => {
      const classAverages = readRecord(classSummary.averages);
      return `${readText(classSummary.className) || "Sinifsiz"}: ${readNumber(classSummary.resultCount) || "-"} sonuc, ${readNumber(classAverages.net) || "-"} net`;
    }),
    "",
    "Ogrenciler",
    ...readRecords(snapshotData.students).slice(0, 12).map((student) => {
      const total = readRecord(student.total);
      return `${readText(student.studentId) || "-"} ${readText(student.className) || ""}: ${readNumber(total.net) || "-"} net`;
    }),
  ];
}

function createSnapshotPdfHtml(snapshot: ReportSnapshotRecord): string {
  const snapshotData = snapshot.snapshotData ?? {};
  const averages = readRecord(snapshotData.averages);
  const branches = readRecords(snapshotData.branches).slice(0, 8);
  const classes = readRecords(snapshotData.classes).slice(0, 8);
  const students = readRecords(snapshotData.students).slice(0, 14);

  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <style>
    body { color: #1b1d23; font-family: Arial, sans-serif; margin: 0; }
    .hero { background: #16324f; color: #fff; padding: 28px 30px; }
    .hero p { margin: 0 0 8px; opacity: .78; }
    .hero h1 { font-size: 26px; margin: 0; }
    .content { padding: 24px 30px; }
    .cards { display: grid; gap: 12px; grid-template-columns: repeat(4, 1fr); margin-bottom: 24px; }
    .card { border: 1px solid #dce3ec; border-radius: 8px; padding: 12px; }
    .card span { color: #66758a; display: block; font-size: 11px; margin-bottom: 7px; }
    .card strong { font-size: 18px; }
    h2 { color: #16324f; font-size: 16px; margin: 22px 0 10px; }
    table { border-collapse: collapse; font-size: 12px; width: 100%; }
    th { background: #eef3f8; color: #273447; text-align: left; }
    th, td { border: 1px solid #dce3ec; padding: 7px 8px; }
    .footer { color: #66758a; font-size: 11px; margin-top: 18px; }
  </style>
</head>
<body>
  <section class="hero">
    <p>Uzman Hocam</p>
    <h1>Sınav Raporu</h1>
  </section>
  <main class="content">
    <section class="cards">
      ${renderPdfCard("Sınav", snapshot.examId)}
      ${renderPdfCard("Snapshot", snapshot.id)}
      ${renderPdfCard("Sonuç", readNumber(snapshotData.resultCount) || "-")}
      ${renderPdfCard("Ortalama net", readNumber(averages.net) || "-")}
      ${renderPdfCard("Standart puan", readNumber(averages.standardScore) || "-")}
      ${renderPdfCard("Durum", snapshot.status)}
      ${renderPdfCard("Üretim", snapshot.generatedAt ?? "-")}
      ${renderPdfCard("Rapor tipi", snapshot.reportType)}
    </section>
    ${renderPdfTable("Branş Başarı", ["Branş", "Sonuç", "Net"], branches, (branch) => [
      readText(branch.branch) || "-",
      readNumber(branch.resultCount) || "-",
      readNumber(branch.net) || "-",
    ])}
    ${renderPdfTable("Sınıf Başarı", ["Sınıf", "Sonuç", "Net", "Standart puan"], classes, (classSummary) => {
      const classAverages = readRecord(classSummary.averages);
      return [
        readText(classSummary.className) || "Sınıfsız",
        readNumber(classSummary.resultCount) || "-",
        readNumber(classAverages.net) || "-",
        readNumber(classAverages.standardScore) || "-",
      ];
    })}
    ${renderPdfTable("Öğrenci Özeti", ["Öğrenci", "Sınıf", "Net", "Standart puan"], students, (student) => {
      const total = readRecord(student.total);
      return [
        readText(student.studentId) || "-",
        readText(student.className) || "-",
        readNumber(total.net) || "-",
        readNumber(total.standardScore) || "-",
      ];
    })}
    <p class="footer">Bu çıktı hazır ReportSnapshot verisinden üretilmiştir.</p>
  </main>
</body>
</html>`;
}

function renderPdfCard(label: string, value: string | number): string {
  return `<article class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`;
}

function renderPdfTable(
  title: string,
  headers: string[],
  rows: Record<string, unknown>[],
  mapRow: (row: Record<string, unknown>) => Array<string | number>,
): string {
  if (rows.length === 0) return "";

  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const rowHtml = rows
    .map((row) => `<tr>${mapRow(row).map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`)
    .join("");

  return `<section><h2>${escapeHtml(title)}</h2><table><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table></section>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSimplePdf(lines: string[]): Buffer {
  const textStream = [
    "BT",
    "/F1 18 Tf",
    "50 790 Td",
    `(${escapePdfText(lines[0] ?? "")}) Tj`,
    "/F1 11 Tf",
    ...lines.slice(1).map((line) => `0 -18 Td (${escapePdfText(line)}) Tj`),
    "ET",
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(textStream, "utf8")} >>\nstream\n${textStream}\nendstream`,
  ];

  let body = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(body, "utf8");
  body += `xref\n0 ${objects.length + 1}\n`;
  body += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) {
    body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(body, "utf8");
}

function escapePdfText(value: string): string {
  return normalizePdfText(value)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)")
    .replace(/\r?\n/g, " ");
}

function normalizePdfText(value: string): string {
  return value
    .replace(/[Çç]/g, "c")
    .replace(/[Ğğ]/g, "g")
    .replace(/[İIı]/g, "i")
    .replace(/[Öö]/g, "o")
    .replace(/[Şş]/g, "s")
    .replace(/[Üü]/g, "u")
    .replace(/[^\x20-\x7E]/g, "?");
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function readRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(readRecord) : [];
}

function readNumber(value: unknown): number | "" {
  return typeof value === "number" && Number.isFinite(value) ? value : "";
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readScoreSummary(value: unknown): ReportStudentScoreSummary {
  const record = readRecord(value);
  return {
    correct: readOptionalNumber(record.correct),
    wrong: readOptionalNumber(record.wrong),
    blank: readOptionalNumber(record.blank),
    net: readOptionalNumber(record.net),
    rawScore: readOptionalNumber(record.rawScore),
    standardScore: readOptionalNumber(record.standardScore),
  };
}

function readBranchSummary(value: unknown): ReportStudentBranchSummary {
  const record = readRecord(value);
  return {
    branch: readText(record.branch),
    correct: readOptionalNumber(record.correct),
    wrong: readOptionalNumber(record.wrong),
    blank: readOptionalNumber(record.blank),
    net: readOptionalNumber(record.net),
  };
}

function readStudentStatistics(value: unknown): ReportStudentStatistics | undefined {
  const record = readRecord(value);
  const general = readScopeRank(record.general);
  if (!general) {
    return undefined;
  }
  const klass = readScopeRank(record.class);
  return {
    standardScore: readOptionalNumber(record.standardScore) ?? 0,
    general,
    ...(klass ? { class: klass } : {}),
    branches: readRecords(record.branches)
      .map(readBranchStatistics)
      .filter((branch): branch is ReportStudentBranchStatistics => branch !== undefined),
  };
}

function readBranchStatistics(value: unknown): ReportStudentBranchStatistics | undefined {
  const record = readRecord(value);
  const branch = readText(record.branch);
  const general = readScopeRank(record.general);
  if (!branch || !general) {
    return undefined;
  }
  const klass = readScopeRank(record.class);
  return {
    branch,
    standardScore: readOptionalNumber(record.standardScore) ?? 0,
    general,
    ...(klass ? { class: klass } : {}),
  };
}

function readScopeRank(value: unknown): ReportScopeRank | undefined {
  const record = readRecord(value);
  const rank = readOptionalNumber(record.rank);
  const outOf = readOptionalNumber(record.outOf);
  const percentile = readOptionalNumber(record.percentile);
  if (rank === undefined || outOf === undefined || percentile === undefined) {
    return undefined;
  }
  return { rank, outOf, percentile };
}

function readOutcomeSummary(value: unknown): ReportStudentOutcomeSummary {
  const record = readRecord(value);
  return {
    outcomeCode: readText(record.outcomeCode),
    branch: readText(record.branch),
    correct: readOptionalNumber(record.correct),
    wrong: readOptionalNumber(record.wrong),
    blank: readOptionalNumber(record.blank),
    net: readOptionalNumber(record.net),
  };
}

function readQuestionSummary(value: unknown): ReportStudentQuestionSummary {
  const record = readRecord(value);
  return {
    questionNo: readWholeNumber(record.questionNo),
    branch: readText(record.branch),
    ...(readText(record.outcomeCode) ? { outcomeCode: readText(record.outcomeCode) } : {}),
    answer: readText(record.answer),
    correctAnswer: readText(record.correctAnswer),
    status: readQuestionStatus(record.status),
  };
}

function readQuestionStatus(value: unknown): ReportStudentQuestionSummary["status"] {
  return value === "WRONG" || value === "BLANK" ? value : "CORRECT";
}

function readWholeNumber(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) ? value : 0;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toTime(value: string | undefined): number {
  return value ? new Date(value).getTime() : 0;
}

function delta(
  points: ReportStudentProgressPoint[],
  select: (point: ReportStudentProgressPoint) => number | undefined,
): number | undefined {
  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  if (!firstPoint || !lastPoint) return undefined;

  const first = select(firstPoint);
  const last = select(lastPoint);
  return first === undefined || last === undefined ? undefined : Number((last - first).toFixed(4));
}
