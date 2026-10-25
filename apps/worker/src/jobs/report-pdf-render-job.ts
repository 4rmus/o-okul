import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
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
  footerLabel?: string;
  html: string;
  landscape?: boolean;
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
    footerLabel: createSnapshotPdfFooterLabel(job.data.snapshot, job.data.institution),
    html: createSnapshotPdfHtml(job.data.snapshot, job.data.institution),
    landscape: readText(readRecord(job.data.snapshot.snapshotData).pdfMode) === "INSTITUTION_SUMMARY",
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
        displayHeaderFooter: Boolean(input.footerLabel),
        footerTemplate: renderPdfFooterTemplate(input.footerLabel ?? ""),
        format: "A4",
        headerTemplate: "<span></span>",
        landscape: Boolean(input.landscape),
        margin: { bottom: "16mm", left: "14mm", right: "14mm", top: "16mm" },
        printBackground: true,
      });
      return Buffer.from(pdf);
    } finally {
      await browser.close();
    }
  }
}

// Puppeteer altbilgisi sayfa CSS'inden yalıtılmıştır; stil satır içi olmalıdır. Öğrenci adı taşınmaz.
function renderPdfFooterTemplate(label: string): string {
  return `<div style="box-sizing:border-box;width:100%;padding:0 14mm;display:flex;justify-content:space-between;font-family:Arial,sans-serif;font-size:7px;color:#6b7280"><span>${escapeHtml(label)}</span><span>Sayfa <span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`;
}

function createSnapshotPdfFooterLabel(snapshot: ReportPdfSnapshotRecord, institution: ReportPdfInstitution = {}): string {
  const data = readRecord(snapshot.snapshotData);
  return [institution.institutionName?.trim() || "o-okul", readText(data.examTitle) || snapshot.examId, readText(data.exampleMarker)]
    .filter(Boolean)
    .join(" · ");
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
    body{font-family:"IBM Plex Sans",Arial,sans-serif;color:#161b2b;font-variant-numeric:tabular-nums}.content{padding:24px}
    table{border-collapse:collapse;width:100%}th,td{border:1px solid #dfe3ea;padding:6px}th{background:#f3f4f8;font-weight:600}
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

// DEC-20260930-04: v2 karne ve kurum özeti Berrak kâğıt dilini kullanır. Bütün sayılar aynı snapshot
// alanlarından gelir; şablon yalnız gösterim (sıralama, kısaltma, grafik) türetir. Tablolar erişilebilir
// metin olarak kalır, grafikler tabloların yanında görsel özet verir.
function createV2SnapshotPdfHtml(snapshot: ReportPdfSnapshotRecord, institution: ReportPdfInstitution): string {
  const data = readRecord(snapshot.snapshotData);
  const students = readRecords(data.students);
  const pdfMode = readText(data.pdfMode);
  const renderInstitutionSummary = pdfMode !== "STUDENT_CARDS";
  const renderStudentCards = pdfMode !== "INSTITUTION_SUMMARY";
  const context: PdfReportContext = {
    data,
    examContext: [readText(data.examTitle) || snapshot.examId, formatPdfDateTime(data.examStartsAt)].filter(Boolean).join(" · "),
    exampleMarker: readText(data.exampleMarker),
    institutionName: institution.institutionName?.trim() || "o-okul",
    scoreTypes: pdfScoreTypes(data),
  };
  const institutionHtml = renderInstitutionSummary ? renderPdfInstitutionSummary(context, students) : "";
  const studentHtml = renderStudentCards
    ? students.map((student) => renderPdfStudentCard(context, student, pdfMode === "STUDENT_CARDS")).join("")
    : "";
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8" /><style>${pdfFontFaceCss()}${pdfReportCss}</style></head><body><main class="content ${pdfMode === "STUDENT_CARDS" ? "student-cards" : ""}">${institutionHtml}${studentHtml}</main></body></html>`;
}

interface PdfReportContext {
  data: Record<string, unknown>;
  examContext: string;
  exampleMarker: string;
  institutionName: string;
  scoreTypes: ExamScoreType[];
}

const pdfScoreWarning = "Standart sapma kullanılmadan hesaplanan deneme puanıdır. Resmî MEB/ÖSYM sınav puanı değildir.";

function renderPdfNotices(context: PdfReportContext): string {
  return `<div class="notices">${context.exampleMarker ? `<p class="warning marker">${escapeHtml(context.exampleMarker)}</p>` : ""}<p class="warning">${escapeHtml(pdfScoreWarning)}</p></div>`;
}

function renderPdfMasthead(context: PdfReportContext, title: string, subtitle: string, aside: string): string {
  const [initials] = splitPdfInstitutionName(context.institutionName);
  return `<header class="masthead"><div class="brand"><span class="monogram" aria-hidden="true">${escapeHtml(initials)}</span><div><p class="eyebrow">${escapeHtml(context.institutionName)}</p><h1>${escapeHtml(title)}</h1><p class="muted">${escapeHtml(subtitle)}</p></div></div>${aside}</header>`;
}

function renderPdfStudentCard(context: PdfReportContext, student: Record<string, unknown>, renderNotices: boolean): string {
  const data = context.data;
  const rankings = readRecords(student.scoreRankings);
  const scoreViews = readRecords(student.scoreViews);
  const identity = readText(student.displayName) || readText(student.studentId) || "-";
  const identityContext = [
    readText(student.participantNo),
    readText(student.bookletType) ? `${readText(student.bookletType)} kitapçığı` : "",
    readText(student.studentNo),
    readText(student.className) || readText(student.classId),
  ].filter(Boolean).join(" · ") || "-";
  const total = readRecord(student.total);
  const branches = readRecords(student.branches);
  const studentClass = readRecords(data.classes).find((klass) => readText(klass.classId) && readText(klass.classId) === readText(student.classId));
  const classBranches = readRecords(studentClass?.branches);
  const institutionBranches = readRecords(data.branches);
  const aside = `<div class="identity"><p class="eyebrow">Öğrenci</p><strong>${escapeHtml(identity)}</strong><p class="muted">${escapeHtml(identityContext)}</p></div>`;
  const masthead = (title: string) => renderPdfMasthead(context, title, context.examContext, aside);

  const scoreCards = scoreViews.map((view) => {
    const ranking = rankings.find((candidate) => readText(candidate.type) === readText(view.type));
    const calculated = view.status === "CALCULATED";
    return renderPdfStatCard(
      `${pdfScoreTypeLabel(readText(view.type))} deneme puanı`,
      calculated ? formatKarneNumber(view.practiceScore) : "-",
      calculated
        ? `Kurum ${formatV2Rank(readRecord(ranking?.institution))} · Sınıf ${formatV2Rank(readRecord(ranking?.class))}`
        : formatScoreStatus(view.status),
    );
  }).join("");
  const kpis = `<section class="kpis" aria-label="Özet">
    ${renderPdfStatCard("Başarı %", formatKarnePercent(scoreSuccessRate(total)), `${formatPdfValue(branchQuestionCount(total))} soru`, true)}
    ${renderPdfStatCard("Net", formatKarneNet(total.net), renderPdfAnswerSplitText(total))}
    ${scoreCards}
  </section>${renderPdfAnswerSplitBar(total)}`;

  const scoreTable = renderPdfTable("Deneme Puanları", ["Tür", "Durum", "Deneme Puanı", "D", "Y", "B", "Net", "Soru", "Başarı %", "Kurum başarı sırası", "Sınıf başarı sırası"], scoreViews, (view) => {
    const metrics = readRecord(view.metrics);
    const ranking = rankings.find((candidate) => readText(candidate.type) === readText(view.type));
    const type = readExamScoreType(view.type);
    return [
      pdfScoreTypeLabel(readText(view.type)),
      formatScoreStatus(view.status),
      type ? `${formatKarneNumber(view.practiceScore)}\n${formatPdfScoreCourseNets(student, type, formatKarneNet)}` : formatKarneNumber(view.practiceScore),
      formatKarneNumber(metrics.correct),
      formatKarneNumber(metrics.wrong),
      formatKarneNumber(metrics.blank),
      formatKarneNet(metrics.net),
      formatKarneNumber(metrics.questionCount),
      formatKarnePercent(scoreSuccessRate(metrics)),
      formatV2Rank(readRecord(ranking?.institution)),
      formatV2Rank(readRecord(ranking?.class)),
    ];
  }, "score-table");

  const hasClassAverages = classBranches.length > 0;
  const hasInstitutionAverages = institutionBranches.length > 0;
  const branchTable = renderPdfTable(
    "Bölüm Analizi",
    ["Branş", "Soru", "D", "Y", "B", "Net", "Başarı %", "Karşılaştırma", ...(hasClassAverages ? ["Sınıf %"] : []), ...(hasInstitutionAverages ? ["Kurum %"] : [])],
    branches,
    (branch) => {
      const name = readText(branch.branch);
      const classRate = scoreSuccessRate(findPdfBranch(classBranches, name));
      const institutionRate = scoreSuccessRate(findPdfBranch(institutionBranches, name));
      return [
        name || "-",
        formatPdfValue(branchQuestionCount(branch)),
        formatKarneNumber(branch.correct),
        formatKarneNumber(branch.wrong),
        formatKarneNumber(branch.blank),
        formatKarneNet(branch.net),
        formatKarnePercent(scoreSuccessRate(branch)),
        pdfHtmlCell(renderPdfComparisonBars(scoreSuccessRate(branch), hasClassAverages ? classRate : "", hasInstitutionAverages ? institutionRate : "")),
        ...(hasClassAverages ? [formatKarnePercent(classRate)] : []),
        ...(hasInstitutionAverages ? [formatKarnePercent(institutionRate)] : []),
      ];
    },
    "branch-table",
  );
  const legend = branches.length > 0
    ? `<p class="legend"><span class="key key-student"></span>Öğrenci${hasClassAverages ? `<span class="key key-class"></span>Sınıf ortalaması` : ""}${hasInstitutionAverages ? `<span class="key key-institution"></span>Kurum ortalaması` : ""}</p>`
    : "";

  const outcomes = selectPdfOutcomeRows(student.outcomes);
  const outcomeTopics = pdfOutcomeTopics(student.questions);
  const outcomeTable = renderPdfTable("Öncelikli Kazanım Analizi", ["Kazanım", "Branş", "Soru", "Başarı %", "Net"], outcomes, (outcome) => {
    const code = readText(outcome.outcomeCode);
    const topic = outcomeTopics.get(code);
    return [
      pdfHtmlCell(`${topic ? `<span class="topic">${escapeHtml(topic)}</span>` : ""}<span class="${topic ? "code" : "topic"}">${escapeHtml(code || "-")}</span>`),
      readText(outcome.branch) || "-",
      formatPdfValue(branchQuestionCount(outcome)),
      formatKarnePercent(scoreSuccessRate(outcome)),
      formatKarneNet(outcome.net),
    ];
  }, "outcome-table");

  return `<section class="karne karne-summary">${masthead("Öğrenci Karnesi")}${renderNotices ? renderPdfNotices(context) : ""}
      <h2 class="sr-title">Öğrenci Karnesi</h2>
      ${kpis}
      ${scoreTable}
      ${branchTable}${legend}
      ${renderPdfBranchHighlights(branches)}
    </section>
    <section class="karne karne-detail">${masthead("Kazanım ve Soru Analizi")}
      ${outcomeTable}
      ${renderPdfAnswerGrid(student.questions)}
    </section>`;
}

function renderPdfInstitutionSummary(context: PdfReportContext, students: Record<string, unknown>[]): string {
  const data = context.data;
  const averages = readRecord(data.averages);
  const scoreAverages = readRecords(data.scoreAverages);
  const branches = readRecords(data.branches);
  const classes = readRecords(data.classes);
  const subtitle = [
    formatPdfDateTime(data.examStartsAt),
    [readText(data.examType), formatPdfValue(readNumber(data.examYear))].filter((part) => part && part !== "-").join(" "),
    readText(data.scoringProfileId),
  ].filter(Boolean).join(" · ");
  const aside = `<div class="identity"><p class="eyebrow">Katılım</p><strong>${escapeHtml(formatKarneNumber(data.resultCount))} öğrenci</strong><p class="muted">${escapeHtml(`${formatKarneNumber(classes.length)} sınıf`)}</p></div>`;
  const scoreCards = scoreAverages.map((score) => renderPdfStatCard(
    `${pdfScoreTypeLabel(readText(score.type))} ortalama puan`,
    formatKarneNumber(score.practiceScore),
    `${formatKarneNumber(score.calculatedCount)} hesaplanan`,
  )).join("");
  const kpis = `<section class="kpis" aria-label="Puan Türü Karşılaştırması"><h2 class="sr-title">Puan Türü Karşılaştırması</h2>
    ${renderPdfStatCard("Ortalama başarı %", formatKarnePercent(scoreSuccessRate(averages)), `${formatPdfValue(branchQuestionCount(averages))} soru`, true)}
    ${renderPdfStatCard("Ortalama net", formatKarneNet(averages.net), renderPdfAnswerSplitText(averages))}
    ${scoreCards}
  </section>`;

  const institutionStudentTable = context.scoreTypes
    .map((type) => renderPdfScoreRanking(type, students, context.scoreTypes.length > 1))
    .join("");

  return `<section class="institution-summary">${renderPdfMasthead(context, readText(data.examTitle) || "Sınav Raporu", subtitle, aside)}
      ${renderPdfNotices(context)}
      ${kpis}
      <div class="chart-grid">
        ${renderPdfBarChart("Ders Başarı Grafiği", branches, (branch) => readText(branch.branch) || "-", (branch) => readOptionalNumber(scoreSuccessRate(branch)), 0, 100, "%")}
        ${renderPdfSuccessDistribution(students)}
      </div>
      ${renderPdfTable("Branş Karşılaştırması", ["Branş", "Soru", "D", "Y", "B", "Net", "Başarı %", "Dağılım"], branches, (branch) => [
        readText(branch.branch) || "-",
        formatPdfValue(branchQuestionCount(branch)),
        formatKarneNumber(branch.correct),
        formatKarneNumber(branch.wrong),
        formatKarneNumber(branch.blank),
        formatKarneNet(branch.net),
        formatKarnePercent(scoreSuccessRate(branch)),
        pdfHtmlCell(renderPdfComparisonBars(scoreSuccessRate(branch), "", "")),
      ], "branch-table")}
      ${renderPdfTable("Sınıf Karşılaştırması", ["Sınıf", "Sonuç", "Başarı %", "Net", "Dağılım"], classes, (klass) => {
        const classAverages = readRecord(klass.averages);
        return [
          readText(klass.className) || "Sınıfsız",
          formatKarneNumber(klass.resultCount),
          formatKarnePercent(scoreSuccessRate(classAverages)),
          formatKarneNet(classAverages.net),
          pdfHtmlCell(renderPdfComparisonBars(scoreSuccessRate(classAverages), "", readOptionalNumber(scoreSuccessRate(averages)) ?? "")),
        ];
      }, "class-table")}${classes.length > 0 ? `<p class="legend"><span class="key key-student"></span>Sınıf<span class="key key-institution"></span>Kurum ortalaması</p>` : ""}
      ${institutionStudentTable ? `<div class="rankings">${institutionStudentTable}</div>` : ""}</section>`;
}

// Kurum özeti listesi her puan türünde o türün puanına göre sıralanır; ders sütunları D/Y/N taşır.
// Sıra değerleri snapshot'taki rekabet sırasıdır, şablon yeniden hesaplamaz.
function renderPdfScoreRanking(type: ExamScoreType, students: Record<string, unknown>[], titleWithType: boolean): string {
  const label = pdfScoreTypeLabel(type);
  const courses = pdfScoreCourses(students, type);
  const rows = students
    .map((student) => ({
      ranking: readRecords(student.scoreRankings).find((candidate) => readText(candidate.type) === type),
      student,
      view: readRecords(student.scoreViews).find((candidate) => readText(candidate.type) === type),
    }))
    .filter((row) => row.view || courses.some((course) => findPdfCourse(row.student, type, course)))
    .sort((left, right) => {
      const leftScore = left.view?.status === "CALCULATED" ? readOptionalNumber(left.view.practiceScore) : undefined;
      const rightScore = right.view?.status === "CALCULATED" ? readOptionalNumber(right.view.practiceScore) : undefined;
      if (leftScore !== undefined && rightScore !== undefined && leftScore !== rightScore) return rightScore - leftScore;
      if (leftScore === undefined && rightScore !== undefined) return 1;
      if (leftScore !== undefined && rightScore === undefined) return -1;
      return pdfStudentName(left.student).localeCompare(pdfStudentName(right.student), "tr");
    });
  if (rows.length === 0) return "";

  const courseHeaders = courses.map((course) => `<th class="course" colspan="3">${escapeHtml(course)}</th>`).join("");
  const splitHeaders = courses.map(() => `<th class="course-start">D</th><th>Y</th><th>N</th>`).join("");
  const body = rows.map(({ ranking, student, view }) => {
    const calculated = view?.status === "CALCULATED";
    const courseCells = courses.map((course) => {
      const branch = findPdfCourse(student, type, course);
      return branch
        ? `<td class="course-start">${escapeHtml(formatKarneNumber(branch.correct))}</td><td>${escapeHtml(formatKarneNumber(branch.wrong))}</td><td class="net">${escapeHtml(formatKarneNet(branch.net))}</td>`
        : `<td class="course-start">-</td><td>-</td><td class="net">-</td>`;
    }).join("");
    return `<tr><td class="rank">${escapeHtml(calculated ? formatV2Rank(readRecord(ranking?.institution)) : "-")}</td><td class="name">${escapeHtml(pdfStudentName(student))}</td><td class="name">${escapeHtml(readText(student.className) || "-")}</td><td class="score">${calculated ? escapeHtml(formatKarneNumber(view?.practiceScore)) : `<span class="status">${escapeHtml(formatScoreStatus(view?.status))}</span>`}</td><td class="total">${escapeHtml(formatKarneNet(readRecord(view?.metrics).net))}</td>${courseCells}<td class="rank">${escapeHtml(calculated ? formatV2Rank(readRecord(ranking?.class)) : "-")}</td></tr>`;
  }).join("");
  return `<section class="ranking-table"><h2>${escapeHtml(titleWithType ? `Öğrenci Sıralaması · ${label}` : "Öğrenci Sıralaması")}</h2><table><thead><tr><th rowspan="2">Kurum sırası</th><th rowspan="2" class="name">Öğrenci</th><th rowspan="2" class="name">Sınıf</th><th rowspan="2">${escapeHtml(`${label} puanı`)}</th><th rowspan="2">Toplam net</th>${courseHeaders}<th rowspan="2">Sınıf sırası</th></tr><tr>${splitHeaders}</tr></thead><tbody>${body}</tbody></table></section>`;
}

function pdfScoreCourses(students: Record<string, unknown>[], type: ExamScoreType): string[] {
  const courses = new Set<string>();
  for (const student of students) {
    for (const branch of readRecords(student.branches)) {
      const name = readText(branch.branch);
      if (name && reportCourseMatchesScoreType(type, name)) courses.add(reportCourseShortName(name));
    }
  }
  return [...courses].sort((left, right) => reportCourseSortOrder(type, left) - reportCourseSortOrder(type, right));
}

function findPdfCourse(student: Record<string, unknown>, type: ExamScoreType, course: string): Record<string, unknown> | undefined {
  return readRecords(student.branches).find((branch) => {
    const name = readText(branch.branch);
    return reportCourseMatchesScoreType(type, name) && reportCourseShortName(name) === course;
  });
}

function pdfStudentName(student: Record<string, unknown>): string {
  return readText(student.displayName) || readText(student.studentId) || "-";
}

function renderPdfStatCard(label: string, value: string, detail: string, primary = false): string {
  return `<div class="stat${primary ? " stat-primary" : ""}"><p class="stat-label">${escapeHtml(label)}</p><p class="stat-value">${escapeHtml(value)}</p><p class="stat-detail">${escapeHtml(detail)}</p></div>`;
}

function renderPdfAnswerSplitText(score: Record<string, unknown>): string {
  return `D ${formatKarneNumber(score.correct)} · Y ${formatKarneNumber(score.wrong)} · B ${formatKarneNumber(score.blank)}`;
}

function renderPdfAnswerSplitBar(score: Record<string, unknown>): string {
  const correct = readOptionalNumber(score.correct) ?? 0;
  const wrong = readOptionalNumber(score.wrong) ?? 0;
  const blank = readOptionalNumber(score.blank) ?? 0;
  const sum = correct + wrong + blank;
  if (sum <= 0) return "";
  const segment = (value: number, kind: string, label: string) => value > 0
    ? `<span class="split-${kind}" style="width:${((value / sum) * 100).toFixed(2)}%">${value / sum >= 0.08 ? escapeHtml(`${label} ${formatKarneNumber(value)}`) : ""}</span>`
    : "";
  return `<div class="split" aria-hidden="true">${segment(correct, "correct", "Doğru")}${segment(wrong, "wrong", "Yanlış")}${segment(blank, "blank", "Boş")}</div>`;
}

function renderPdfComparisonBars(student: string | number, klass: string | number, institution: string | number): string {
  const bar = (value: string | number, kind: string) => typeof value === "number"
    ? `<span class="bar bar-${kind}"><span style="width:${Math.max(0, Math.min(100, value)).toFixed(2)}%"></span></span>`
    : "";
  return `<span class="bars" aria-hidden="true">${bar(student, "student")}${bar(klass, "class")}${bar(institution, "institution")}</span>`;
}

function renderPdfBranchHighlights(branches: Record<string, unknown>[]): string {
  const ranked = branches
    .map((branch) => ({ name: readText(branch.branch), rate: readOptionalNumber(scoreSuccessRate(branch)) }))
    .filter((branch): branch is { name: string; rate: number } => Boolean(branch.name) && branch.rate !== undefined)
    .sort((left, right) => right.rate - left.rate || left.name.localeCompare(right.name, "tr"));
  if (ranked.length < 2) return "";
  const count = Math.min(3, Math.floor(ranked.length / 2));
  const list = (items: typeof ranked) => items.map((item) => `<li><span>${escapeHtml(item.name)}</span><strong>${escapeHtml(formatKarnePercent(item.rate))}</strong></li>`).join("");
  return `<section class="highlights"><div><h3>Güçlü dersler</h3><ul>${list(ranked.slice(0, count))}</ul></div><div><h3>Öncelikli çalışma</h3><ul>${list(ranked.slice(-count).reverse())}</ul></div></section>`;
}

function renderPdfAnswerGrid(value: unknown): string {
  const questions = readRecords(value);
  if (questions.length === 0) return "";
  const groups = new Map<string, Record<string, unknown>[]>();
  for (const question of questions) {
    const branch = readText(question.branch) || "-";
    groups.set(branch, [...(groups.get(branch) ?? []), question]);
  }
  const rows = [...groups].map(([branch, items]) => `<div class="grid-row"><span class="grid-label">${escapeHtml(branch)}</span><span class="grid-cells">${items.map((question) => {
    const status = readQuestionStatus(question.status);
    const answer = readText(question.answer);
    const correctAnswer = readText(question.correctAnswer);
    const mark = status === "CANCELLED" ? "İ" : answer || "–";
    const hint = status === "WRONG" && correctAnswer ? `<small>${escapeHtml(correctAnswer)}</small>` : "";
    return `<span class="cell cell-${status.toLowerCase()}"><em>${escapeHtml(formatKarneNumber(question.questionNo))}</em>${escapeHtml(mark)}${hint}</span>`;
  }).join("")}</span></div>`).join("");
  return `<section class="answer-grid"><h2>Cevap Haritası</h2><p class="legend"><span class="key key-correct"></span>Doğru<span class="key key-wrong"></span>Yanlış (sağ altta doğru cevap)<span class="key key-blank"></span>Boş<span class="key key-cancelled"></span>İptal</p>${rows}</section>`;
}

function renderPdfSuccessDistribution(students: Record<string, unknown>[]): string {
  const rates = students
    .map((student) => readOptionalNumber(scoreSuccessRate(readRecord(student.total))))
    .filter((rate): rate is number => rate !== undefined);
  if (rates.length === 0) return "";
  const bands = [
    { label: "0–20", min: Number.NEGATIVE_INFINITY, max: 20 },
    { label: "20–40", min: 20, max: 40 },
    { label: "40–60", min: 40, max: 60 },
    { label: "60–80", min: 60, max: 80 },
    { label: "80–100", min: 80, max: Number.POSITIVE_INFINITY },
  ].map((band) => ({ ...band, count: rates.filter((rate) => rate >= band.min && rate < band.max).length }));
  const peak = Math.max(1, ...bands.map((band) => band.count));
  return `<section class="distribution"><h2>Başarı Dağılımı</h2><div class="columns">${bands.map((band) => `<div class="column"><strong>${escapeHtml(formatKarneNumber(band.count))}</strong><span class="column-track"><span style="height:${((band.count / peak) * 100).toFixed(2)}%"></span></span><span class="column-label">%${escapeHtml(band.label)}</span></div>`).join("")}</div><p class="muted">Öğrenci sayısı, toplam başarı yüzdesi aralığına göre</p></section>`;
}

function findPdfBranch(branches: Record<string, unknown>[], name: string): Record<string, unknown> {
  return branches.find((branch) => readText(branch.branch) === name) ?? {};
}

function pdfOutcomeTopics(value: unknown): Map<string, string> {
  const topics = new Map<string, string>();
  for (const question of readRecords(value)) {
    const code = readText(question.outcomeCode);
    const topic = readText(question.topic).trim();
    if (code && topic && question.status !== "CANCELLED" && !topics.has(code)) topics.set(code, topic);
  }
  return topics;
}

function splitPdfInstitutionName(name: string): readonly [string, string] {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (words.length === 0) return ["KURUM", ""];
  if (words.length === 1) return [words[0]!.slice(0, 3).toLocaleUpperCase("tr-TR"), words[0]!];
  return [words.slice(0, 3).map((word) => word.charAt(0)).join("").toLocaleUpperCase("tr-TR"), words.join(" ")];
}

// Snapshot tarihleri UTC ISO'dur; kâğıtta kurumun saat diliminde okunur biçimde gösterilir.
function formatPdfDateTime(value: unknown): string {
  const text = readText(value);
  if (!text) return "";
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return new Intl.DateTimeFormat("tr-TR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Europe/Istanbul",
  }).format(date);
}

let pdfFontFaceCache: string | undefined;

// IBM Plex worker imajında kurulu değil; Chromium'un yedek fonta düşmemesi için woff2 dosyaları HTML'e gömülür.
function pdfFontFaceCss(): string {
  if (pdfFontFaceCache !== undefined) return pdfFontFaceCache;
  const fontDirectory = resolvePath(__dirname, "../../assets/fonts");
  pdfFontFaceCache = [["IBMPlexSans-Regular.woff2", 400], ["IBMPlexSans-SemiBold.woff2", 600]]
    .flatMap(([file, weight]) => {
      try {
        const font = readFileSync(resolvePath(fontDirectory, String(file))).toString("base64");
        return [`@font-face{font-family:"IBM Plex Sans";font-style:normal;font-weight:${weight};src:url(data:font/woff2;base64,${font}) format("woff2")}`];
      } catch {
        return [];
      }
    })
    .join("");
  return pdfFontFaceCache;
}

// KARNE-PAPER-PINS: karne tema bağımsız açık kâğıttır; değerler tokens.css açık temasıyla aynıdır.
const pdfReportCss = `
  :root{--paper:oklch(99.9% 0.001 250);--paper-muted:oklch(96.5% 0.005 250);--ink:oklch(21% 0.020 265);
    --ink-secondary:oklch(35% 0.025 263);--ink-muted:oklch(51% 0.030 260);--rule:oklch(91% 0.008 255);
    --rule-strong:oklch(83% 0.008 255);--accent:oklch(51% 0.230 277);--accent-strong:oklch(41% 0.190 277);
    --accent-soft:oklch(96% 0.018 272);--success:oklch(50% 0.130 150);--success-soft:oklch(96.2% 0.044 157);
    --warning:oklch(52% 0.140 49);--warning-soft:oklch(96.2% 0.059 96);--danger:oklch(52% 0.215 27);
    --danger-soft:oklch(97.1% 0.013 17);--series-class:oklch(52% 0.012 260);--series-institution:oklch(72% 0.010 260)}
  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:"IBM Plex Sans",Arial,sans-serif;font-size:10px;line-height:1.35;font-variant-numeric:tabular-nums;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  h1,h2,h3{font-weight:600;color:var(--ink);margin:0}
  h2{color:var(--accent-strong);font-size:10px;letter-spacing:.06em;text-transform:uppercase;margin:14px 0 6px}
  h3{font-size:10px;margin:0 0 4px}
  p{margin:0}
  .muted{color:var(--ink-muted)}
  .sr-title{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  .karne{break-before:page;position:relative}
  .content>.karne:first-child{break-before:auto}
  .masthead{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;padding-bottom:10px;border-bottom:2px solid var(--accent)}
  .brand{display:flex;gap:10px;align-items:center}
  .monogram{display:inline-flex;align-items:center;justify-content:center;min-width:40px;height:40px;padding:0 6px;border-radius:8px;background:var(--accent);color:var(--paper);font-size:14px;font-weight:600;letter-spacing:.04em}
  .eyebrow{color:var(--ink-muted);font-size:8.5px;font-weight:600;letter-spacing:.06em;text-transform:uppercase}
  .masthead h1{font-size:19px;line-height:1.2}
  .identity{text-align:right;max-width:46%}
  .identity strong{display:block;font-size:13px}
  .notices{display:flex;flex-direction:column;gap:3px;margin-top:8px}
  .warning{background:var(--warning-soft);border:1px solid var(--warning);border-radius:6px;color:var(--warning);font-size:8.5px;font-weight:600;padding:4px 8px}
  .warning.marker{text-transform:uppercase;letter-spacing:.04em}
  .kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(88px,1fr));gap:6px;margin-top:10px}
  .stat{border:1px solid var(--rule);border-radius:8px;padding:7px 8px;background:var(--paper);break-inside:avoid}
  .stat-primary{background:var(--accent-soft);border-color:var(--accent)}
  .stat-label{color:var(--ink-muted);font-size:8px;font-weight:600;letter-spacing:.05em;text-transform:uppercase}
  .stat-value{font-size:20px;font-weight:600;line-height:1.15;margin-top:2px}
  .stat-primary .stat-value{color:var(--accent-strong);font-size:24px}
  .stat-detail{color:var(--ink-secondary);font-size:8.5px;margin-top:1px}
  .split{display:flex;height:14px;margin-top:6px;border-radius:4px;overflow:hidden;font-size:8px;font-weight:600;line-height:14px}
  .split span{display:block;padding-left:5px;white-space:nowrap;overflow:hidden}
  .split-correct{background:var(--success);color:var(--paper)}
  .split-wrong{background:var(--danger);color:var(--paper)}
  .split-blank{background:var(--rule-strong);color:var(--ink)}
  section{break-inside:avoid}
  .institution-summary>section,.institution-summary .ranking-table{break-inside:auto}
  table{border-collapse:collapse;width:100%}
  thead{display:table-header-group}
  tr{break-inside:avoid}
  th,td{border-bottom:1px solid var(--rule);padding:3px 5px;text-align:left;vertical-align:top}
  th{background:var(--paper-muted);color:var(--ink-secondary);font-size:8px;font-weight:600;letter-spacing:.03em;border-bottom-color:var(--rule-strong)}
  td{font-size:9px}
  .score-table td:nth-child(n+4),.branch-table td:nth-child(n+2),.outcome-table td:nth-child(n+3),.class-table td:nth-child(n+2){white-space:nowrap}
  .branch-table td,.class-table td{vertical-align:middle}
  .rankings{break-before:page}
  .ranking-table h2{break-after:avoid}
  .ranking-table thead tr:nth-child(2) th{text-align:right}
  .ranking-table table{table-layout:auto}
  .ranking-table th,.ranking-table td{padding:3px 3px;text-align:right;white-space:nowrap}
  .ranking-table th{text-align:center;vertical-align:middle}
  .ranking-table td.name,.ranking-table th.name{text-align:left}
  .ranking-table th.course{border-left:1px solid var(--rule-strong);border-bottom:1px solid var(--rule)}
  .ranking-table .course-start{border-left:1px solid var(--rule-strong)}
  .ranking-table td.rank{text-align:center;color:var(--ink-secondary)}
  .ranking-table td.net{font-weight:600}
  .ranking-table td.total{font-weight:600}
  .ranking-table td.score{color:var(--accent-strong);font-weight:600;font-size:9.5px;border-left:1px solid var(--rule-strong)}
  .ranking-table td.score .status{display:inline-block;max-width:72px;white-space:normal;text-align:right;color:var(--ink-muted);font-size:7px;font-weight:400;line-height:1.2}
  .ranking-table tbody tr:nth-child(even) td{background:var(--paper-muted)}
  .bars{display:flex;flex-direction:column;gap:1px;width:100%;min-width:90px}
  .bar{display:block;background:var(--paper-muted);border-radius:2px;overflow:hidden}
  .bar span{display:block;height:100%}
  .bar-student{height:7px}.bar-student span{background:var(--accent)}
  .bar-class{height:3px}.bar-class span{background:var(--series-class)}
  .bar-institution{height:3px}.bar-institution span{background:var(--series-institution)}
  .legend{display:flex;align-items:center;gap:4px;flex-wrap:wrap;color:var(--ink-muted);font-size:8px;margin:4px 0 0}
  .key{display:inline-block;width:10px;height:6px;border-radius:2px;margin-left:6px}
  .key:first-child{margin-left:0}
  .key-student{background:var(--accent)}.key-class{background:var(--series-class)}.key-institution{background:var(--series-institution)}
  .key-correct{background:var(--success)}.key-wrong{background:var(--danger)}.key-blank{background:var(--rule-strong)}.key-cancelled{background:var(--warning)}
  .highlights{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}
  .highlights>div{border:1px solid var(--rule);border-radius:8px;padding:7px 9px}
  .highlights>div:first-child{border-left:3px solid var(--success)}
  .highlights>div:last-child{border-left:3px solid var(--warning)}
  .highlights ul{list-style:none;margin:0;padding:0}
  .highlights li{display:flex;justify-content:space-between;gap:8px;font-size:9px;padding:1px 0}
  .topic{display:block}
  .code{display:block;color:var(--ink-muted);font-size:7.5px}
  .answer-grid .grid-row{display:grid;grid-template-columns:92px 1fr;gap:6px;align-items:start;padding:2px 0;border-bottom:1px solid var(--rule)}
  .grid-label{font-size:8.5px;font-weight:600;color:var(--ink-secondary);padding-top:3px}
  .grid-cells{display:flex;flex-wrap:wrap;gap:2px}
  .cell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:21px;height:19px;border-radius:3px;font-size:9px;font-weight:600}
  .cell em{position:absolute;top:0;left:2px;font-size:5.5px;font-style:normal;font-weight:400;opacity:.8}
  .cell small{position:absolute;right:2px;bottom:0;font-size:6px}
  .cell-correct{background:var(--success-soft);color:var(--success)}
  .cell-wrong{background:var(--danger);color:var(--paper)}
  .cell-blank{background:var(--paper-muted);color:var(--ink-muted);border:1px solid var(--rule)}
  .cell-cancelled{background:var(--warning-soft);color:var(--warning);border:1px dashed var(--warning)}
  .chart-grid{display:grid;grid-template-columns:3fr 2fr;gap:14px}
  .bar-chart{margin:0}.bar-row{display:grid;grid-template-columns:110px 1fr 44px;align-items:center;gap:8px;margin:4px 0}
  .bar-row>span:first-child{font-size:9px}
  .bar-track{background:var(--paper-muted);border-radius:3px;height:9px;overflow:hidden}.bar-fill{background:var(--accent);height:100%}
  .bar-value{text-align:right;font-size:9px}
  .distribution .columns{display:flex;align-items:flex-end;gap:6px;height:96px}
  .column{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;height:100%}
  .column strong{font-size:9px}
  .column-track{flex:1;width:100%;display:flex;align-items:flex-end;background:var(--paper-muted);border-radius:3px;overflow:hidden}
  .column-track span{display:block;width:100%;background:var(--accent)}
  .column-label{color:var(--ink-muted);font-size:7.5px;white-space:nowrap}
  .distribution .muted{font-size:7.5px;margin-top:4px}
`;

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

// DEC-20260930-04: karne HTML'i web karnesiyle aynı Türkçe biçimi kullanır (Başarı % bir ondalık: %73,3;
// net iki ondalık: 24,50; sayı/puan en çok iki ondalık). Değerler aynı snapshot alanlarından gelir, yalnız
// gösterim biçimlenir. Düz metin fallback satırları ASCII biçimini korur.
function formatKarnePercent(value: string | number): string {
  return typeof value === "number"
    ? `%${value.toLocaleString("tr-TR", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}`
    : formatPdfPercent(value);
}

function formatKarneNet(value: unknown): string {
  const number = readNumber(value);
  return typeof number === "number"
    ? number.toLocaleString("tr-TR", { maximumFractionDigits: 2, minimumFractionDigits: 2 })
    : formatPdfValue(number);
}

function formatKarneNumber(value: unknown): string {
  const number = readNumber(value);
  return typeof number === "number" ? number.toLocaleString("tr-TR", { maximumFractionDigits: 2 }) : formatPdfValue(number);
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

function formatPdfScoreCourseNets(student: Record<string, unknown>, type: ExamScoreType, format: (value: unknown) => string = formatPdfNumber): string {
  return readRecords(student.branches)
    .filter((branch) => reportCourseMatchesScoreType(type, readText(branch.branch)))
    .sort((left, right) => reportCourseSortOrder(type, readText(left.branch)) - reportCourseSortOrder(type, readText(right.branch)))
    .map((branch) => `${reportCourseShortName(readText(branch.branch))} ${format(branch.net)}`)
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
    return [`<div class="bar-row"><span>${escapeHtml(label(row))}</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${(ratio * 100).toFixed(2)}%"></span></span><strong class="bar-value">${escapeHtml(suffix === "%" ? formatKarnePercent(numericValue) : `${formatKarneNumber(numericValue)}${suffix}`)}</strong></div>`];
  });
  return chartRows.length > 0
    ? `<section class="bar-chart"><h2>${escapeHtml(title)}</h2>${chartRows.join("")}</section>`
    : "";
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

interface PdfHtmlCell {
  html: string;
}

// Yalnız şablonun kendi ürettiği, değerleri önceden kaçırılmış işaretleme için kullanılır.
function pdfHtmlCell(html: string): PdfHtmlCell {
  return { html };
}

function renderPdfTable(
  title: string,
  headers: string[],
  rows: Record<string, unknown>[],
  mapRow: (row: Record<string, unknown>, index: number) => Array<string | number | PdfHtmlCell>,
  className = "",
): string {
  if (rows.length === 0) return "";

  const headerHtml = headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("");
  const rowHtml = rows
    .map((row, index) => `<tr>${mapRow(row, index).map((cell) => `<td>${typeof cell === "object" ? cell.html : escapeHtml(String(cell)).replace(/\r?\n/gu, "<br>")}</td>`).join("")}</tr>`)
    .join("");

  return `<section${className ? ` class="${className}"` : ""}><h2>${escapeHtml(title)}</h2><table><thead><tr>${headerHtml}</tr></thead><tbody>${rowHtml}</tbody></table></section>`;
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
