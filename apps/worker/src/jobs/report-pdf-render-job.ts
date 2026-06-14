import type {
  ReportPdfInstitution,
  ReportPdfRenderJobPayload,
  ReportPdfRenderJobResult,
  ReportPdfSnapshotRecord,
  ReportScopeRank,
  ReportStudentBranchStatistics,
  ReportStudentBranchSummary,
  ReportStudentQuestionSummary,
  ReportStudentStatistics,
} from "@uzman-hocam/shared-types";

export type {
  ReportPdfInstitution,
  ReportPdfRenderJobPayload,
  ReportPdfRenderJobResult,
  ReportPdfSnapshotRecord,
} from "@uzman-hocam/shared-types";

export interface ReportPdfRenderInput {
  fallbackLines: string[];
  html: string;
}

export interface ReportPdfRenderer {
  render(input: ReportPdfRenderInput): Promise<Buffer>;
}

export interface ReportPdfRenderQueueJob {
  id?: string | number;
  name: string;
  data: ReportPdfRenderJobPayload;
}

export async function processReportPdfRenderJob(
  job: ReportPdfRenderQueueJob,
  renderer: ReportPdfRenderer = createReportPdfRenderer(),
): Promise<ReportPdfRenderJobResult> {
  if (job.name !== "report-pdf-render") {
    throw new Error("REPORT_PDF_RENDER_JOB_NAME_INVALID");
  }
  assertReportPdfRenderPayload(job.data);

  const pdf = await renderer.render({
    fallbackLines: createSnapshotPdfLines(job.data.snapshot, job.data.institution),
    html: createSnapshotPdfHtml(job.data.snapshot, job.data.institution),
  });

  return {
    fileName: `${job.data.snapshot.examId}-${job.data.snapshot.id}.pdf`,
    contentType: "application/pdf",
    fileBase64: pdf.toString("base64"),
    pageCount: 1,
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

function assertReportPdfRenderPayload(payload: ReportPdfRenderJobPayload): void {
  if (!payload?.snapshot?.tenantId || !payload.snapshot.examId || !payload.snapshot.id) {
    throw new Error("REPORT_PDF_RENDER_PAYLOAD_INVALID");
  }
  if (payload.snapshot.status !== "READY" || !payload.snapshot.snapshotData) {
    throw new Error("REPORT_PDF_RENDER_SNAPSHOT_NOT_READY");
  }
}

function createSnapshotPdfLines(snapshot: ReportPdfSnapshotRecord, institution: ReportPdfInstitution = {}): string[] {
  const snapshotData = snapshot.snapshotData ?? {};
  const averages = readRecord(snapshotData.averages);
  return [
    `${institution.institutionName ?? "Uzman Hocam"} - Sinav Raporu`,
    `Sinav: ${snapshot.examId}`,
    `Snapshot: ${snapshot.id}`,
    `Durum: ${snapshot.status}`,
    `Uretim: ${snapshot.generatedAt ?? "-"}`,
    "",
    "Genel Ozet",
    `Sonuc sayisi: ${readNumber(snapshotData.resultCount) || "-"}`,
    `Ortalama net: ${readNumber(averages.net) || "-"}`,
    `Ortalama LGS puani: ${readLgsScore(averages) || "-"}`,
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
      const statistics = readStudentStatistics(student.statistics);
      return `${readText(student.studentId) || "-"} ${readText(student.className) || ""}: ${readNumber(total.net) || "-"} net, ${readLgsScore(total) || "-"} LGS puani, genel ${formatPdfRank(statistics?.general)}, sinif ${formatPdfRank(statistics?.class)}`;
    }),
    "",
    "Ogrenci Karnesi",
    "Bolum Analizi",
    "Puan - Sira Analizi",
    "Bolum Basari Yuzdeleri",
    "Son Sinav Netleri",
  ];
}

function createSnapshotPdfHtml(snapshot: ReportPdfSnapshotRecord, institution: ReportPdfInstitution = {}): string {
  const snapshotData = snapshot.snapshotData ?? {};
  const averages = readRecord(snapshotData.averages);
  const averageLgsScore = readLgsScore(averages);
  const branches = readRecords(snapshotData.branches).slice(0, 8);
  const classes = readRecords(snapshotData.classes).slice(0, 8);
  const students = readRecords(snapshotData.students).slice(0, 14);
  const institutionName = institution.institutionName ?? "Uzman Hocam";

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
    .karne { border: 3px solid #d9a428; margin: 0 0 24px; padding: 14px; }
    .karne-detail { page-break-before: always; }
    .karne-header { display: grid; grid-template-columns: 1fr 160px; border: 1px solid #d9a428; }
    .karne-header div { padding: 10px 12px; }
    .karne-header h2 { margin: 0 0 6px; }
    .karne-header strong { display: block; font-size: 20px; }
    .karne-brand { align-items: center; border-left: 1px solid #d9a428; color: #0f766e; display: grid; font-weight: 800; justify-items: center; padding: 10px; text-align: center; }
    .karne-brand img { display: block; max-height: 66px; max-width: 116px; object-fit: contain; }
    .karne-summary { display: grid; grid-template-columns: repeat(5, 1fr); margin: 10px 0; }
    .karne-summary span { border: 1px solid #d9a428; font-size: 11px; font-weight: 700; padding: 7px; text-align: center; }
    .karne-grid { display: grid; gap: 12px; grid-template-columns: 1.3fr .7fr; }
    h2 { color: #16324f; font-size: 16px; margin: 22px 0 10px; }
    table { border-collapse: collapse; font-size: 12px; width: 100%; }
    th { background: #eef3f8; color: #273447; text-align: left; }
    th, td { border: 1px solid #dce3ec; padding: 7px 8px; }
    .footer { color: #66758a; font-size: 11px; margin-top: 18px; }
  </style>
</head>
<body>
  <section class="hero">
    <p>${escapeHtml(institutionName)}</p>
    <h1>Sınav Raporu</h1>
  </section>
  <main class="content">
    <section class="cards">
      ${renderPdfCard("Sınav", snapshot.examId)}
	    ${renderPdfCard("Snapshot", snapshot.id)}
	    ${renderPdfCard("Sonuç", readNumber(snapshotData.resultCount) || "-")}
	    ${renderPdfCard("Ortalama net", readNumber(averages.net) || "-")}
	    ${renderPdfCard("Ortalama LGS puanı", averageLgsScore || "-")}
	    ${renderPdfCard("Standart puan", readNumber(averages.standardScore) || "-")}
	    ${renderPdfCard("Durum", snapshot.status)}
	    ${renderPdfCard("Üretim", snapshot.generatedAt ?? "-")}
	    ${renderPdfCard("Rapor tipi", snapshot.reportType)}
    </section>
    ${renderPdfStudentKarne(students[0], createStudentBranchAverageLookup(snapshotData, readText(students[0]?.classId)), institution)}
    ${renderPdfTable("Branş Başarı", ["Branş", "Sonuç", "Net"], branches, (branch) => [
      readText(branch.branch) || "-",
      readNumber(branch.resultCount) || "-",
      readNumber(branch.net) || "-",
    ])}
    ${renderPdfTable("Sınıf Başarı", ["Sınıf", "Sonuç", "Net", "LGS puanı", "Standart puan"], classes, (classSummary) => {
      const classAverages = readRecord(classSummary.averages);
      return [
        readText(classSummary.className) || "Sınıfsız",
        readNumber(classSummary.resultCount) || "-",
        readNumber(classAverages.net) || "-",
        readLgsScore(classAverages) || "-",
        readNumber(classAverages.standardScore) || "-",
      ];
    })}
    ${renderPdfTable("Öğrenci Özeti", ["Öğrenci", "Sınıf", "Net", "LGS puanı", "Standart puan", "Genel sıra", "Sınıf sıra"], students, (student) => {
      const total = readRecord(student.total);
      const statistics = readStudentStatistics(student.statistics);
      return [
        readText(student.studentId) || "-",
        readText(student.className) || "-",
        readNumber(total.net) || "-",
        readLgsScore(total) || "-",
        readNumber(total.standardScore) || "-",
        formatPdfRank(statistics?.general),
        formatPdfRank(statistics?.class),
      ];
    })}
    <p class="footer">Bu çıktı hazır ReportSnapshot verisinden üretilmiştir.</p>
  </main>
</body>
</html>`;
}

function renderPdfStudentKarne(
  student: Record<string, unknown> | undefined,
  branchAverages = new Map<string, Pick<ReportStudentBranchSummary, "classNetAverage" | "generalNetAverage" | "schoolNetAverage">>(),
  institution: ReportPdfInstitution = {},
): string {
  if (!student) return "";

  const total = readRecord(student.total);
  const lgsScore = readLgsScore(total);
  const statistics = readStudentStatistics(student.statistics);
  const branches = readRecords(student.branches);
  const outcomes = readRecords(student.outcomes);
  const summaryOutcomes = outcomes.slice(0, 6);
  const questions = readRecords(student.questions).sort((left, right) => {
    const leftNo = readNumber(left.questionNo) || 0;
    const rightNo = readNumber(right.questionNo) || 0;
    return leftNo - rightNo;
  });

  return `<section class="karne">
      <div class="karne-header">
        <div>
          <h2>Öğrenci Karnesi</h2>
          <strong>${escapeHtml(readText(student.studentId) || "-")}</strong>
          <span>${escapeHtml(readText(student.className) || readText(student.classId) || "-")}</span>
        </div>
        <div class="karne-brand">${renderPdfInstitutionBrand(institution)}</div>
      </div>
      <div class="karne-summary">
        <span>Net ${escapeHtml(formatPdfValue(readNumber(total.net)))}</span>
        <span>Başarı ${escapeHtml(formatPdfPercent(scoreSuccessRate(total)))}</span>
        <span>LGS puanı ${escapeHtml(formatPdfValue(lgsScore))}</span>
        <span>Standart puan ${escapeHtml(formatPdfValue(readNumber(total.standardScore)))}</span>
        <span>Genel sıra ${escapeHtml(formatPdfRank(statistics?.general))}</span>
        <span>Sınıf sıra ${escapeHtml(formatPdfRank(statistics?.class))}</span>
      </div>
      <div class="karne-grid">
        ${renderPdfTable("BÖLÜM ANALİZİ", ["No", "Branş", "Soru sayısı", "Başarı %", "Doğru", "Yanlış", "Boş", "Net", "Sınıf net ort", "Okul net ort", "Genel net ort"], branches, (branch, index) => [
          index + 1,
          readText(branch.branch) || "-",
          formatPdfValue(branchQuestionCount(branch)),
          formatPdfPercent(scoreSuccessRate(branch)),
          formatPdfValue(readNumber(branch.correct)),
          formatPdfValue(readNumber(branch.wrong)),
          formatPdfValue(readNumber(branch.blank)),
          formatPdfValue(readNumber(branch.net)),
          formatPdfValue(branchAverages.get(readText(branch.branch))?.classNetAverage ?? readNumber(branch.classNetAverage)),
          formatPdfValue(branchAverages.get(readText(branch.branch))?.schoolNetAverage ?? readNumber(branch.schoolNetAverage)),
          formatPdfValue(branchAverages.get(readText(branch.branch))?.generalNetAverage ?? readNumber(branch.generalNetAverage)),
        ])}
        <section>
          <h2>PUAN - SIRA ANALİZİ</h2>
          <table>
            <tbody>
        <tr><th>LGS puanı</th><td>${escapeHtml(formatPdfValue(lgsScore))}</td></tr>
        <tr><th>Başarı %</th><td>${escapeHtml(formatPdfPercent(scoreSuccessRate(total)))}</td></tr>
        <tr><th>Standart puan</th><td>${escapeHtml(formatPdfValue(readNumber(total.standardScore)))}</td></tr>
        <tr><th>SIRA</th><td>${escapeHtml(formatPdfRank(statistics?.general))}</td></tr>
        <tr><th>SINIF</th><td>${escapeHtml(formatPdfRank(statistics?.class))}</td></tr>
      </tbody>
    </table>
        </section>
      </div>
      ${renderPdfTable("BÖLÜM BAŞARI YÜZDELERİ", ["Kazanım", "Branş", "Soru", "Başarı %", "Doğru", "Yanlış", "Boş", "Net"], summaryOutcomes, (outcome) => [
        readText(outcome.outcomeCode) || "-",
        readText(outcome.branch) || "-",
        formatPdfValue(branchQuestionCount(outcome)),
        formatPdfPercent(scoreSuccessRate(outcome)),
        formatPdfValue(readNumber(outcome.correct)),
        formatPdfValue(readNumber(outcome.wrong)),
        formatPdfValue(readNumber(outcome.blank)),
        formatPdfValue(readNumber(outcome.net)),
      ])}
      ${renderPdfTable("SON SINAV NETLERİ", ["Öğrenci", "Başarı %", "Net", "LGS puanı", "Standart puan"], [student], (row) => {
        const rowTotal = readRecord(row.total);
        return [
          readText(row.studentId) || "-",
          formatPdfPercent(scoreSuccessRate(rowTotal)),
          formatPdfValue(readNumber(rowTotal.net)),
          formatPdfValue(readLgsScore(rowTotal)),
          formatPdfValue(readNumber(rowTotal.standardScore)),
        ];
      })}
    </section>
    <section class="karne karne-detail">
      <div class="karne-header">
        <div>
          <h2>Detaylı Deneme Analizi</h2>
          <strong>${escapeHtml(readText(student.studentId) || "-")}</strong>
          <span>${escapeHtml(readText(student.className) || readText(student.classId) || "-")}</span>
        </div>
        <div class="karne-brand">${renderPdfInstitutionBrand(institution)}</div>
      </div>
      ${renderPdfTable("KAZANIM DETAYI", ["Kazanım", "Ders", "Soru", "Başarı %", "Doğru", "Yanlış", "Boş", "Net"], outcomes, (outcome) => [
        readText(outcome.outcomeCode) || "-",
        readText(outcome.branch) || "-",
        formatPdfValue(branchQuestionCount(outcome)),
        formatPdfPercent(scoreSuccessRate(outcome)),
        formatPdfValue(readNumber(outcome.correct)),
        formatPdfValue(readNumber(outcome.wrong)),
        formatPdfValue(readNumber(outcome.blank)),
        formatPdfValue(readNumber(outcome.net)),
      ])}
      ${renderPdfTable("SORU CEVAP ANALİZİ", ["Soru", "Ders", "Kazanım", "Öğrenci cevabı", "Doğru cevap", "Durum"], questions, (question) => [
        formatPdfValue(readNumber(question.questionNo)),
        readText(question.branch) || "-",
        readText(question.outcomeCode) || "-",
        readText(question.answer) || "-",
        readText(question.correctAnswer) || "-",
        formatPdfQuestionStatus(question.status),
      ])}
    </section>`;
}

function renderPdfInstitutionBrand(institution: ReportPdfInstitution): string {
  const name = institution.institutionName ?? "Uzman Hocam";
  if (institution.institutionLogoUrl) {
    return `<img src="${escapeHtml(institution.institutionLogoUrl)}" alt="${escapeHtml(name)} logosu" />`;
  }
  return escapeHtml(name);
}

function renderPdfCard(label: string, value: string | number): string {
  return `<article class="card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value))}</strong></article>`;
}

function formatPdfValue(value: string | number): string {
  return value === "" ? "-" : String(value);
}

function formatPdfPercent(value: string | number): string {
  return value === "" ? "-" : `%${value}`;
}

function formatPdfRank(rank: ReportScopeRank | undefined): string {
  if (!rank) return "-";
  return `${rank.rank}/${rank.outOf} (%${rank.percentile})`;
}

function formatPdfQuestionStatus(value: unknown): string {
  const status = readQuestionStatus(value);
  if (status === "WRONG") return "Yanlış";
  if (status === "BLANK") return "Boş";
  return "Doğru";
}

function renderPdfTable(
  title: string,
  headers: string[],
  rows: Record<string, unknown>[],
  mapRow: (row: Record<string, unknown>, index: number) => Array<string | number>,
): string {
  if (rows.length === 0) return "";

  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const rowHtml = rows
    .map((row, index) => `<tr>${mapRow(row, index).map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`)
    .join("");

  return `<section><h2>${escapeHtml(title)}</h2><table><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table></section>`;
}

function branchQuestionCount(branch: Record<string, unknown>): string | number {
  const questionCount = readNumber(branch.questionCount);
  if (questionCount !== "") return questionCount;
  const correct = readNumber(branch.correct);
  const wrong = readNumber(branch.wrong);
  const blank = readNumber(branch.blank);
  if (correct === "" || wrong === "" || blank === "") return "-";
  return correct + wrong + blank;
}

function scoreSuccessRate(score: Record<string, unknown>): string | number {
  const successRate = readNumber(score.successRate);
  if (successRate !== "") return successRate;
  const net = readNumber(score.net);
  const questionCount = branchQuestionCount(score);
  if (net === "" || typeof questionCount !== "number" || questionCount <= 0) return "-";
  return Number(((net / questionCount) * 100).toFixed(4));
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

function readLgsScore(value: unknown): number | "" {
  const record = readRecord(value);
  const estimatedRawScore = readNumber(record.estimatedRawScore);
  return estimatedRawScore === "" ? readNumber(record.standardScore) : estimatedRawScore;
}

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function createStudentBranchAverageLookup(
  snapshotData: Record<string, unknown>,
  classId: string,
): Map<string, Pick<ReportStudentBranchSummary, "classNetAverage" | "generalNetAverage" | "schoolNetAverage">> {
  const averages = new Map<string, Pick<ReportStudentBranchSummary, "classNetAverage" | "generalNetAverage" | "schoolNetAverage">>();
  const schoolBranches = readRecords(snapshotData.branches);
  const classBranches = readRecords(readRecords(snapshotData.classes).find((klass) => readText(klass.classId) === classId)?.branches);
  const generalBranches = readRecords(readRecord(snapshotData.statistics).branches);
  for (const branch of schoolBranches) {
    const branchName = readText(branch.branch);
    if (!branchName) continue;
    const schoolNetAverage = readOptionalNumber(branch.net);
    averages.set(branchName, {
      ...(schoolNetAverage !== undefined ? { schoolNetAverage } : {}),
    });
  }
  for (const branch of classBranches) {
    const branchName = readText(branch.branch);
    if (!branchName) continue;
    const current = averages.get(branchName) ?? {};
    const classNetAverage = readOptionalNumber(branch.net);
    averages.set(branchName, {
      ...current,
      ...(classNetAverage !== undefined ? { classNetAverage } : {}),
    });
  }
  for (const branch of generalBranches) {
    const branchName = readText(branch.branch);
    if (!branchName) continue;
    const current = averages.get(branchName) ?? {};
    const generalNetAverage = readOptionalNumber(branch.meanNet);
    averages.set(branchName, {
      ...current,
      ...(generalNetAverage !== undefined ? { generalNetAverage } : {}),
    });
  }
  return averages;
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

function readQuestionStatus(value: unknown): ReportStudentQuestionSummary["status"] {
  return value === "WRONG" || value === "BLANK" ? value : "CORRECT";
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
