import type {
  ExamScoreType,
  ReportPdfInstitution,
  ReportPdfRenderJobPayload,
  ReportPdfRenderJobResult,
  ReportPdfSnapshotRecord,
} from "@o-okul/shared-types";
import {
  reportCourseMatchesScoreType,
  reportCourseShortName,
  reportCourseSortOrder,
} from "@o-okul/shared-types";

export type {
  ReportPdfInstitution,
  ReportPdfRenderJobPayload,
  ReportPdfRenderJobResult,
  ReportPdfSnapshotRecord,
} from "@o-okul/shared-types";

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
    pageCount: countPdfPages(pdf),
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

export class SimpleReportPdfRenderer implements ReportPdfRenderer {
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
  if (readNumber(snapshotData.schemaVersion) === 2) {
    return createV2SnapshotPdfLines(snapshot, institution);
  }
  return createLegacySnapshotPdfLines(snapshot, institution);
}

function createLegacySnapshotPdfLines(snapshot: ReportPdfSnapshotRecord, institution: ReportPdfInstitution): string[] {
  const data = readRecord(snapshot.snapshotData);
  const averages = readRecord(data.averages);
  return [
    `${institution.institutionName ?? "o-okul"} - Sinav Raporu`,
    "Eski hesaplama",
    `Sinav: ${snapshot.examId}`,
    `Sonuc sayisi: ${formatPdfNumber(data.resultCount)}`,
    `Ortalama basari: ${formatPdfPercent(scoreSuccessRate(averages))}`,
    `Soru sayisi: ${formatPdfValue(branchQuestionCount(averages))}`,
    `Ortalama net: ${formatPdfNumber(averages.net)}`,
    ...readRecords(data.branches).map((branch) =>
      `${readText(branch.branch) || "-"}: ${formatPdfNumber(branch.resultCount)} sonuc, ${formatPdfPercent(scoreSuccessRate(branch))}, ${formatPdfNumber(branch.net)} net`
    ),
    ...readRecords(data.classes).map((klass) =>
      `${readText(klass.className) || "Sinifsiz"}: ${formatPdfNumber(klass.resultCount)} sonuc`
    ),
    ...readRecords(data.students).flatMap((student) => [
      "",
      `Ogrenci Karnesi: ${readText(student.displayName) || readText(student.studentId) || "-"}`,
      ...readRecords(student.branches).map((branch) =>
        `${readText(branch.branch) || "-"}: ${formatPdfNumber(branch.net)} net, ${formatPdfPercent(scoreSuccessRate(branch))}`
      ),
      ...readRecords(student.outcomes).map((outcome) =>
        `${readText(outcome.outcomeCode) || "-"}: ${formatPdfNumber(outcome.net)} net`
      ),
      ...readRecords(student.questions).map((question) =>
        `${formatPdfNumber(question.questionNo)}. soru ${readText(question.branch) || "-"}: ${formatPdfQuestionStatus(question.status)}`
      ),
    ]),
  ];
}

function createLegacySnapshotPdfHtml(snapshot: ReportPdfSnapshotRecord, institution: ReportPdfInstitution): string {
  const data = readRecord(snapshot.snapshotData);
  const averages = readRecord(data.averages);
  const students = readRecords(data.students);
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" /><style>
    body{font-family:Arial,sans-serif}.content{padding:24px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:6px}
  </style></head><body><main class="content"><h1>Sınav Raporu</h1><p>Eski hesaplama</p>
  <p>Rapor bağlamı · ${escapeHtml(snapshot.status)} snapshot</p>
  <p>Başarı % ${escapeHtml(formatPdfPercent(scoreSuccessRate(averages)))} · Net ${escapeHtml(formatPdfNumber(averages.net))}</p>
  ${renderPdfTable("Branş Başarı", ["Branş", "Sonuç", "Başarı %", "Net"], readRecords(data.branches), (branch) => [
    readText(branch.branch) || "-", formatPdfNumber(branch.resultCount), formatPdfPercent(scoreSuccessRate(branch)), formatPdfNumber(branch.net),
  ])}
  ${renderPdfTable("Sınıf Başarı", ["Sınıf", "Sonuç"], readRecords(data.classes), (klass) => [
    readText(klass.className) || "Sınıfsız", formatPdfNumber(klass.resultCount),
  ])}
  ${students.map((student) => `<section class="karne"><h2>Öğrenci Karnesi</h2><strong>${escapeHtml(readText(student.displayName) || readText(student.studentId) || "-")}</strong>
    ${renderPdfTable("Bölüm Analizi", ["Branş", "Başarı %", "Soru", "Net"], readRecords(student.branches), (branch) => [
      readText(branch.branch) || "-", formatPdfPercent(scoreSuccessRate(branch)), formatPdfValue(branchQuestionCount(branch)), formatPdfNumber(branch.net),
    ])}
    ${renderPdfTable("Kazanım Detayı", ["Kazanım", "Branş", "Başarı %", "Net"], readRecords(student.outcomes), (outcome) => [
      readText(outcome.outcomeCode) || "-", readText(outcome.branch) || "-", formatPdfPercent(scoreSuccessRate(outcome)), formatPdfNumber(outcome.net),
    ])}
    ${renderPdfTable("Soru Cevap Analizi", ["Soru", "Ders", "Durum"], readRecords(student.questions), (question) => [
      formatPdfNumber(question.questionNo), readText(question.branch) || "-", formatPdfQuestionStatus(question.status),
    ])}</section>`).join("")}
  </main></body></html>`;
}

function createV2SnapshotPdfLines(snapshot: ReportPdfSnapshotRecord, institution: ReportPdfInstitution): string[] {
  const data = readRecord(snapshot.snapshotData);
  const averages = readRecord(data.averages);
  const students = readRecords(data.students);
  const pdfMode = readText(data.pdfMode);
  const header = [
    `${institution.institutionName ?? "o-okul"} - Sinav Raporu`,
    ...(readText(data.exampleMarker) ? [readText(data.exampleMarker)] : []),
    "Standart sapma kullanılmadan hesaplanan deneme puanıdır. Resmî MEB/ÖSYM sınav puanı değildir.",
    `Sinav: ${readText(data.examTitle) || snapshot.examId}`,
    `Sinav tarihi: ${readText(data.examStartsAt) || "-"}`,
    `Sinav turu/yili: ${readText(data.examType) || "-"} / ${formatPdfValue(readNumber(data.examYear))}`,
    `Puanlama profili: ${readText(data.scoringProfileId) || "-"}`,
  ];
  const institutionSummary = [
    `Sonuc sayisi: ${formatPdfNumber(data.resultCount)}`,
    `Ortalama basari: ${formatPdfPercent(scoreSuccessRate(averages))}`,
    ...readRecords(data.scoreAverages).map((score) =>
      `${readText(score.type)} Deneme Puani: ${formatPdfNumber(score.practiceScore)} (${formatPdfNumber(score.calculatedCount)} hesaplanan)`
    ),
    ...readRecords(data.branches).map((branch) =>
      `${readText(branch.branch) || "-"}: ${formatPdfPercent(scoreSuccessRate(branch))}, ${formatPdfNumber(branch.net)} net`
    ),
    ...readRecords(data.classes).map((klass) =>
      `${readText(klass.className) || "Sinifsiz"}: ${formatPdfNumber(klass.resultCount)} sonuc, ${formatPdfPercent(scoreSuccessRate(readRecord(klass.averages)))}`
    ),
    ...students.map((student) =>
      `${readText(student.displayName) || readText(student.studentId) || "-"}: ${formatPdfPercent(scoreSuccessRate(readRecord(student.total)))}, ${formatV2StudentScores(student)}`
    ),
  ];
  const studentCards = students.flatMap((student) => {
      const identity = readText(student.displayName) || readText(student.studentId) || "-";
      const rankings = readRecords(student.scoreRankings);
      return [
        "",
        `Ogrenci Karnesi: ${identity}`,
        ...readRecords(student.scoreViews).map((view) => {
          const metrics = readRecord(view.metrics);
          const ranking = rankings.find((candidate) => readText(candidate.type) === readText(view.type));
          const type = readExamScoreType(view.type);
          return `${pdfScoreTypeLabel(readText(view.type))}: ${formatScoreStatus(view.status)}, Deneme Puani ${formatPdfNumber(view.practiceScore)}, Ders Netleri ${type ? formatPdfScoreCourseNets(student, type) : "-"}, D/Y/B ${formatPdfNumber(metrics.correct)}/${formatPdfNumber(metrics.wrong)}/${formatPdfNumber(metrics.blank)}, Net ${formatPdfNumber(metrics.net)}, Basari ${formatPdfPercent(scoreSuccessRate(metrics))}, Kurum Basari Sirasi ${formatV2Rank(readRecord(ranking?.institution))}, Sinif Basari Sirasi ${formatV2Rank(readRecord(ranking?.class))}`;
        }),
        ...readRecords(student.branches).map((branch) =>
          `${readText(branch.branch) || "-"}: ${formatPdfNumber(branch.net)} net, ${formatPdfPercent(scoreSuccessRate(branch))}, ${formatPdfValue(branchQuestionCount(branch))} soru`
        ),
        ...readRecords(student.outcomes).map((outcome) =>
          `${readText(outcome.outcomeCode) || "-"} ${readText(outcome.branch) || "-"}: ${formatPdfNumber(outcome.net)} net`
        ),
        ...readRecords(student.questions).map((question) =>
          `${formatPdfNumber(question.questionNo)}. soru ${readText(question.branch) || "-"}: ${formatPdfQuestionStatus(question.status)}`
        ),
      ];
    });
  if (pdfMode === "INSTITUTION_SUMMARY") return [...header, ...institutionSummary];
  if (pdfMode === "STUDENT_CARDS") return [...header, ...studentCards];
  return [...header, ...institutionSummary, ...studentCards];
}

function createV2SnapshotPdfHtml(snapshot: ReportPdfSnapshotRecord, institution: ReportPdfInstitution): string {
  const data = readRecord(snapshot.snapshotData);
  const students = readRecords(data.students);
  const scoreAverages = readRecords(data.scoreAverages);
  const scoreTypes = pdfScoreTypes(data);
  const pdfMode = readText(data.pdfMode);
  const renderInstitutionSummary = pdfMode !== "STUDENT_CARDS";
  const renderStudentCards = pdfMode !== "INSTITUTION_SUMMARY";
  const exampleMarker = readText(data.exampleMarker);
  const warning = "Standart sapma kullanılmadan hesaplanan deneme puanıdır. Resmî MEB/ÖSYM sınav puanı değildir.";
  const studentHtml = renderStudentCards ? students.map((student) => {
    const rankings = readRecords(student.scoreRankings);
    const identity = escapeHtml(readText(student.displayName) || readText(student.studentId) || "-");
    const context = escapeHtml([
      readText(student.participantNo),
      readText(student.bookletType) ? `${readText(student.bookletType)} kitapçığı` : "",
      readText(student.studentNo),
      readText(student.className) || readText(student.classId),
    ].filter(Boolean).join(" · ") || "-");
    const studentNotice = pdfMode === "STUDENT_CARDS"
      ? `${exampleMarker ? `<p class="warning">${escapeHtml(exampleMarker)}</p>` : ""}<p class="warning">${escapeHtml(warning)}</p>`
      : "";
    const examContext = escapeHtml([
      readText(data.examTitle) || snapshot.examId,
      readText(data.examStartsAt),
    ].filter(Boolean).join(" · "));
    return `<section class="karne karne-summary">${studentNotice}<p>${examContext}</p><h2>Öğrenci Karnesi</h2><strong>${identity}</strong><p>${context}</p>
      ${renderPdfTable("Deneme Puanları", ["Tür", "Durum", "Deneme Puanı", "D", "Y", "B", "Net", "Soru", "Başarı %", "Kurum başarı sırası", "Sınıf başarı sırası"], readRecords(student.scoreViews), (view) => {
        const metrics = readRecord(view.metrics);
        const ranking = rankings.find((candidate) => readText(candidate.type) === readText(view.type));
        const type = readExamScoreType(view.type);
        return [
          pdfScoreTypeLabel(readText(view.type)),
          formatScoreStatus(view.status),
          type ? `${formatPdfNumber(view.practiceScore)}\n${formatPdfScoreCourseNets(student, type)}` : formatPdfNumber(view.practiceScore),
          formatPdfNumber(metrics.correct),
          formatPdfNumber(metrics.wrong),
          formatPdfNumber(metrics.blank),
          formatPdfNumber(metrics.net),
          formatPdfNumber(metrics.questionCount),
          formatPdfPercent(scoreSuccessRate(metrics)),
          formatV2Rank(readRecord(ranking?.institution)),
          formatV2Rank(readRecord(ranking?.class)),
        ];
      })}
      ${renderPdfTable("Bölüm Analizi", ["Branş", "Başarı %", "Soru", "Net"], readRecords(student.branches), (branch) => [
        readText(branch.branch) || "-", formatPdfPercent(scoreSuccessRate(branch)), formatPdfValue(branchQuestionCount(branch)), formatPdfNumber(branch.net),
      ])}
    </section>
    <section class="karne karne-detail"><p>${examContext}</p><h2>Kazanım ve Soru Analizi</h2><strong>${identity}</strong><p>${context}</p>
      ${renderPdfTable("Öncelikli Kazanım Analizi", ["Kazanım", "Branş", "Başarı %", "Net"], selectPdfOutcomeRows(student.outcomes), (outcome) => [
        readText(outcome.outcomeCode) || "-", readText(outcome.branch) || "-", formatPdfPercent(scoreSuccessRate(outcome)), formatPdfNumber(outcome.net),
      ])}
      ${renderPdfTable("Soru Cevap Analizi", ["Soru", "Ders", "Durum"], selectPdfQuestionRows(student.questions), (question) => [
        formatPdfNumber(question.questionNo),
        readText(question.branch) || "-",
        formatPdfQuestionStatus(question.status),
      ])}
    </section>`;
  }).join("") : "";
  const institutionStudentTable = renderPdfTable(
    "Öğrenci Sıralaması",
    [
      "Öğrenci",
      "Sınıf",
      "Başarı %",
      ...scoreTypes.map((type) => `${pdfScoreTypeLabel(type)} puanı`),
      "Kurum başarı sırası",
      "Sınıf başarı sırası",
    ],
    students,
    (student) => [
      readText(student.displayName) || readText(student.studentId) || "-",
      readText(student.className) || "-",
      formatPdfPercent(scoreSuccessRate(readRecord(student.total))),
      ...scoreTypes.map((type) => `${formatPdfScoreByType(student, type)}\n${formatPdfScoreCourseNets(student, type)}`),
      formatPdfRankingsByScope(student, "institution"),
      formatPdfRankingsByScope(student, "class"),
    ],
  );
  const institutionHtml = renderInstitutionSummary
    ? `<section class="hero"><p>${escapeHtml(institution.institutionName ?? "o-okul")}</p><h1>${escapeHtml(readText(data.examTitle) || "Sınav Raporu")}</h1></section>
      <section class="institution-summary">${exampleMarker ? `<p class="warning">${escapeHtml(exampleMarker)}</p>` : ""}
      <p class="warning">${escapeHtml(warning)}</p>
      <p>${escapeHtml(`${readText(data.examType) || "-"} ${formatPdfValue(readNumber(data.examYear))} · ${readText(data.scoringProfileId) || "-"}`)}</p>
      <p>${escapeHtml(readText(data.examStartsAt) || "")}</p>
      ${renderPdfBarChart("Puan Türü Karşılaştırması", scoreAverages, (score) => pdfScoreTypeLabel(readText(score.type)), (score) => readOptionalNumber(score.practiceScore), 100, 500)}
      ${renderPdfBarChart("Ders Başarı Grafiği", readRecords(data.branches), (branch) => readText(branch.branch) || "-", (branch) => readOptionalNumber(scoreSuccessRate(branch)), 0, 100, "%")}
      ${renderPdfTable("Ortalama Deneme Puanları", ["Tür", "Hesaplanan", "Deneme Puanı"], scoreAverages, (score) => [
        pdfScoreTypeLabel(readText(score.type)), formatPdfNumber(score.calculatedCount), formatPdfNumber(score.practiceScore),
      ])}
      ${renderPdfTable("Branş Karşılaştırması", ["Branş", "Başarı %", "Soru", "Net"], readRecords(data.branches), (branch) => [
        readText(branch.branch) || "-", formatPdfPercent(scoreSuccessRate(branch)), formatPdfValue(branchQuestionCount(branch)), formatPdfNumber(branch.net),
      ])}
      ${renderPdfTable("Sınıf Karşılaştırması", ["Sınıf", "Sonuç", "Başarı %", "Net"], readRecords(data.classes), (klass) => {
        const classAverages = readRecord(klass.averages);
        return [
          readText(klass.className) || "Sınıfsız",
          formatPdfNumber(klass.resultCount),
          formatPdfPercent(scoreSuccessRate(classAverages)),
          formatPdfNumber(classAverages.net),
        ];
      })}
      ${institutionStudentTable}</section>`
    : "";
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" /><style>
    body{font-family:Arial,sans-serif;color:#101828}.hero{background:#101828;color:white;padding:24px}.content{padding:24px}
    .warning{background:#fff4e5;border:1px solid #f79009;font-weight:700;padding:10px}.karne{break-before:page;margin-top:24px}
    .student-cards>.karne:first-child{break-before:auto}
    .student-cards{font-size:10px}.student-cards .karne{margin-top:0}.student-cards h2{font-size:18px;margin:9px 0}
    .student-cards p{margin:5px 0}.student-cards .warning{padding:6px}.student-cards th,.student-cards td{font-size:9px;line-height:1.15;padding:3px}
    .institution-summary>section{break-inside:avoid}thead{display:table-header-group}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #d0d5dd;padding:5px;vertical-align:top}th{background:#eef4ff;text-align:left}
    .bar-chart{break-inside:avoid;margin:14px 0}.bar-row{display:grid;grid-template-columns:120px 1fr 52px;align-items:center;gap:8px;margin:5px 0}
    .bar-track{background:#eef2f6;border-radius:5px;height:11px;overflow:hidden}.bar-fill{background:#155eef;height:100%}.bar-value{text-align:right;font-size:11px}
    .institution-summary table{font-size:9px}
  </style></head><body><main class="content ${pdfMode === "STUDENT_CARDS" ? "student-cards" : ""}">${institutionHtml}${studentHtml}</main></body></html>`;
}

function createSnapshotPdfHtml(snapshot: ReportPdfSnapshotRecord, institution: ReportPdfInstitution = {}): string {
  const snapshotData = snapshot.snapshotData ?? {};
  if (readNumber(snapshotData.schemaVersion) === 2) {
    return createV2SnapshotPdfHtml(snapshot, institution);
  }
  return createLegacySnapshotPdfHtml(snapshot, institution);
}

function formatPdfValue(value: string | number): string {
  return value === "" ? "-" : String(value);
}

function formatPdfNumber(value: unknown): string {
  return formatPdfValue(readNumber(value));
}

function formatPdfPercent(value: string | number): string {
  return value === "" ? "-" : `%${value}`;
}

function formatV2Rank(rank: Record<string, unknown>): string {
  const value = readOptionalNumber(rank.rank);
  const outOf = readOptionalNumber(rank.outOf);
  return value === undefined || outOf === undefined ? "-" : `${value}/${outOf}`;
}

function formatV2StudentScores(student: Record<string, unknown>): string {
  const rankings = readRecords(student.scoreRankings);
  const labels = readRecords(student.scoreViews).map((view) => {
    const type = readText(view.type) || "-";
    const label = pdfScoreTypeLabel(type);
    if (view.status !== "CALCULATED") return `${label}: ${formatScoreStatus(view.status)}`;
    const ranking = rankings.find((candidate) => readText(candidate.type) === type);
    const scoreType = readExamScoreType(type);
    const courseNets = scoreType ? formatPdfScoreCourseNets(student, scoreType) : "-";
    return `${label}: ${formatPdfNumber(view.practiceScore)} · ${courseNets} · ${formatV2Rank(readRecord(ranking?.institution))}`;
  });
  return labels.join(" | ") || "-";
}

function pdfScoreTypes(data: Record<string, unknown>): ExamScoreType[] {
  const examType = readText(data.examType);
  if (examType === "LGS") return ["LGS"];
  if (examType === "TYT") return ["TYT"];
  if (examType === "AYT") return ["SAY", "EA", "SOZ"];
  return [...new Set(readRecords(data.scoreAverages).map((score) => readExamScoreType(score.type)).filter((type): type is ExamScoreType => Boolean(type)))];
}

function pdfScoreTypeLabel(type: string): string {
  if (type === "SAY") return "Sayısal";
  if (type === "SOZ") return "Sözel";
  return type || "-";
}

function formatPdfScoreByType(student: Record<string, unknown>, type: ExamScoreType): string {
  const view = readRecords(student.scoreViews).find((candidate) => readText(candidate.type) === type);
  return view?.status === "CALCULATED" ? formatPdfNumber(view.practiceScore) : formatScoreStatus(view?.status);
}

function formatPdfScoreCourseNets(student: Record<string, unknown>, type: ExamScoreType): string {
  return readRecords(student.branches)
    .filter((branch) => reportCourseMatchesScoreType(type, readText(branch.branch)))
    .sort((left, right) => reportCourseSortOrder(type, readText(left.branch)) - reportCourseSortOrder(type, readText(right.branch)))
    .map((branch) => `${reportCourseShortName(readText(branch.branch))} ${formatPdfNumber(branch.net)}`)
    .join(" · ") || "-";
}

function formatPdfRankingsByScope(student: Record<string, unknown>, scope: "institution" | "class"): string {
  return readRecords(student.scoreRankings)
    .map((ranking) => `${readText(ranking.type)} ${formatV2Rank(readRecord(ranking[scope]))}`)
    .join(" · ") || "-";
}

function renderPdfBarChart(
  title: string,
  rows: Record<string, unknown>[],
  label: (row: Record<string, unknown>) => string,
  value: (row: Record<string, unknown>) => number | undefined,
  minimum: number,
  maximum: number,
  suffix = "",
): string {
  const chartRows = rows.flatMap((row) => {
    const numericValue = value(row);
    if (numericValue === undefined) return [];
    const ratio = Math.max(0, Math.min(1, (numericValue - minimum) / (maximum - minimum)));
    return [`<div class="bar-row"><span>${escapeHtml(label(row))}</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${(ratio * 100).toFixed(2)}%"></span></span><strong class="bar-value">${escapeHtml(formatPdfNumber(numericValue))}${escapeHtml(suffix)}</strong></div>`];
  });
  return chartRows.length > 0
    ? `<section class="bar-chart"><h2>${escapeHtml(title)}</h2>${chartRows.join("")}</section>`
    : "";
}

function selectPdfQuestionRows(value: unknown): Record<string, unknown>[] {
  const questions = readRecords(value);
  const actionable = questions.filter((question) => question.status !== "CORRECT");
  return (actionable.length > 0 ? actionable : questions).slice(0, 10);
}

function selectPdfOutcomeRows(value: unknown): Record<string, unknown>[] {
  return readRecords(value)
    .sort((left, right) =>
      numericSuccessRate(left) - numericSuccessRate(right)
      || readText(left.outcomeCode).localeCompare(readText(right.outcomeCode), "tr")
    )
    .slice(0, 8);
}

function numericSuccessRate(score: Record<string, unknown>): number {
  const rate = scoreSuccessRate(score);
  return typeof rate === "number" ? rate : Number.POSITIVE_INFINITY;
}

function formatScoreStatus(value: unknown): string {
  if (value === "CALCULATED") return "Hesaplandı";
  if (value === "NOT_ELIGIBLE") return "Hesaplama koşulu sağlanmadı";
  if (value === "MISSING_TYT") return "Bağlı TYT deneme puanı yok";
  return "-";
}

function formatPdfQuestionStatus(value: unknown): string {
  const status = readQuestionStatus(value);
  if (status === "CANCELLED") return "İptal";
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
    .map((row, index) => `<tr>${mapRow(row, index).map((cell) => `<td>${escapeHtml(String(cell)).replace(/\r?\n/gu, "<br>")}</td>`).join("")}</tr>`)
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
  const pages = paginatePdfLines(lines);
  const fontObjectId = 3 + pages.length * 2;
  const pageObjectIds = pages.map((_, index) => 3 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`,
  ];

  pages.forEach((pageLines, index) => {
    const pageObjectId = pageObjectIds[index] ?? 3;
    const contentObjectId = pageObjectId + 1;
    const textStream = buildSimplePdfTextStream(pageLines, index === 0);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontObjectId} 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      `<< /Length ${Buffer.byteLength(textStream, "utf8")} >>\nstream\n${textStream}\nendstream`,
    );
  });
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");

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

function paginatePdfLines(lines: string[]): string[][] {
  const pageSize = 40;
  const source = lines.length > 0 ? lines : [""];
  const pages: string[][] = [];
  for (let index = 0; index < source.length; index += pageSize) {
    pages.push(source.slice(index, index + pageSize));
  }
  return pages;
}

function buildSimplePdfTextStream(lines: string[], isFirstPage: boolean): string {
  const [firstLine = "", ...remainingLines] = lines;
  return [
    "BT",
    `/F1 ${isFirstPage ? 18 : 11} Tf`,
    "50 790 Td",
    `(${escapePdfText(firstLine)}) Tj`,
    ...(isFirstPage ? ["/F1 11 Tf"] : []),
    ...remainingLines.map((line) => `0 -18 Td (${escapePdfText(line)}) Tj`),
    "ET",
  ].join("\n");
}

function countPdfPages(pdf: Buffer): number {
  return Math.max(1, pdf.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ?? 0);
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

function readOptionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readQuestionStatus(value: unknown): "CORRECT" | "WRONG" | "BLANK" | "CANCELLED" {
  return value === "WRONG" || value === "BLANK" || value === "CANCELLED" ? value : "CORRECT";
}

function readExamScoreType(value: unknown): ExamScoreType | undefined {
  return value === "LGS" || value === "TYT" || value === "SAY" || value === "EA" || value === "SOZ"
    ? value
    : undefined;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}
