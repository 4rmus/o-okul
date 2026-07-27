import { describe, expect, it } from "vitest";
import {
  processReportPdfRenderJob,
  SimpleReportPdfRenderer,
  type ReportPdfRenderInput,
  type ReportPdfRenderer,
} from "./report-pdf-render-job.js";

describe("report PDF render job", () => {
  it("scoped snapshot payloadini PDF sonucuna cevirir", async () => {
    const renderer = new FakeRenderer();

    const result = await processReportPdfRenderJob({
      id: "pdf-job-a",
      name: "report-pdf-render",
      data: {
        institution: { institutionName: "DNA Egitim" },
        snapshot: {
          id: "snapshot-a",
          tenantId: "tenant-a",
          examId: "exam-a",
          reportType: "EXAM_RESULT_SUMMARY",
          status: "READY",
          generatedAt: "2026-06-06T09:00:00.000Z",
          snapshotData: {
            resultCount: 1,
            averages: { estimatedRawScore: 456.7, net: 17.5, questionCount: 20, standardScore: 123.4, successRate: 87.5 },
            branches: [{ branch: "Matematik", questionCount: 20, resultCount: 1, net: 17.5, successRate: 87.5 }],
            classes: [{ branches: [{ branch: "Matematik", net: 16.2 }], classId: "class-a", className: "8-A", resultCount: 1, averages: { estimatedRawScore: 456.7, net: 17.5, questionCount: 20, standardScore: 123.4, successRate: 87.5 } }],
            statistics: { branches: [{ branch: "Matematik", meanNet: 15.1 }] },
            students: [{
              branches: [{ branch: "Matematik", correct: 18, wrong: 2, blank: 0, net: 17.5 }],
              classId: "class-a",
              className: "8-A",
              outcomes: [{ outcomeCode: "M.1", branch: "Matematik", correct: 2, wrong: 0, blank: 0, net: 2 }],
              questions: [{ questionNo: 1, branch: "Matematik", outcomeCode: "M.1", answer: "A", correctAnswer: "A", status: "CORRECT" }],
              statistics: { general: { rank: 1, outOf: 10, percentile: 90 }, class: { rank: 1, outOf: 3, percentile: 67 } },
              displayName: "Ada Ak",
              studentNo: "1001",
              studentId: "student-a",
              total: { estimatedRawScore: 456.7, net: 17.5, questionCount: 20, standardScore: 123.4, successRate: 87.5 },
            }],
          },
        },
      },
    }, renderer);

    expect(result.fileName).toBe("exam-a-snapshot-a.pdf");
    expect(result.contentType).toBe("application/pdf");
    expect(Buffer.from(result.fileBase64, "base64").toString("utf8")).toContain("%PDF-1.4");
    expect(renderer.inputs[0]?.html).toContain("Sınav Raporu");
    expect(renderer.inputs[0]?.html).toContain("Öğrenci Karnesi");
    expect(renderer.inputs[0]?.html).toContain("Branş Başarı");
    expect(renderer.inputs[0]?.html).toContain("Başarı %");
    expect(renderer.inputs[0]?.html).toContain("Ada Ak");
    expect(renderer.inputs[0]?.html).toContain("Eski hesaplama");
    expect(renderer.inputs[0]?.html).not.toMatch(/LGS puanı|Standart puan|percentile/u);
    expect(renderer.inputs[0]?.fallbackLines).toContain("DNA Egitim - Sinav Raporu");
    expect(renderer.inputs[0]?.fallbackLines).toContain("Ortalama basari: %87.5");
    expect(renderer.inputs[0]?.fallbackLines).toContain("Soru sayisi: 20");
  });

  it("PDF ozetinde sifir degerleri bos deger gibi gostermez", async () => {
    const renderer = new FakeRenderer();

    await processReportPdfRenderJob({
      id: "pdf-job-zero",
      name: "report-pdf-render",
      data: {
        institution: { institutionName: "Sifir Akademi" },
        snapshot: {
          id: "snapshot-zero",
          tenantId: "tenant-a",
          examId: "exam-zero",
          reportType: "EXAM_RESULT_SUMMARY",
          status: "READY",
          generatedAt: "2026-06-06T09:00:00.000Z",
          snapshotData: {
            resultCount: 0,
            averages: { estimatedRawScore: 0, net: 0, questionCount: 0, standardScore: 0, successRate: 0 },
            branches: [{ branch: "Matematik", questionCount: 0, resultCount: 0, net: 0, successRate: 0 }],
            classes: [{ classId: "class-zero", className: "8-Z", resultCount: 0, averages: { estimatedRawScore: 0, net: 0, questionCount: 0, standardScore: 0, successRate: 0 } }],
            students: [{
              classId: "class-zero",
              className: "8-Z",
              statistics: { general: { rank: 0, outOf: 0, percentile: 0 } },
              studentId: "student-zero",
              total: { estimatedRawScore: 0, net: 0, questionCount: 0, standardScore: 0, successRate: 0 },
            }],
          },
        },
      },
    }, renderer);

    expect(renderer.inputs[0]?.fallbackLines).toContain("Sonuc sayisi: 0");
    expect(renderer.inputs[0]?.fallbackLines).toContain("Ortalama basari: %0");
    expect(renderer.inputs[0]?.fallbackLines).toContain("Soru sayisi: 0");
    expect(renderer.inputs[0]?.fallbackLines).toContain("Ortalama net: 0");
    expect(renderer.inputs[0]?.fallbackLines).toContain("Eski hesaplama");
    expect(renderer.inputs[0]?.fallbackLines.join("\n")).not.toMatch(/LGS puani|Standart puan/u);
  });

  it("schema v2 scoreViews ve tür bazlı sıraları resmî değil uyarısıyla render eder", async () => {
    const renderer = new FakeRenderer();
    await processReportPdfRenderJob({
      name: "report-pdf-render",
      data: {
        snapshot: {
          id: "snapshot-v2",
          tenantId: "tenant-a",
          examId: "exam-ayt",
          reportType: "EXAM_RESULT_SUMMARY",
          status: "READY",
          snapshotData: {
            schemaVersion: 2,
            pdfMode: "STUDENT_CARDS",
            examType: "AYT",
            examYear: 2026,
            scoringProfileId: "TR-YKS-2026-NOSD-V1",
            examTitle: "Örnek AYT 2026",
            examStartsAt: "2026-06-21T07:15:00.000Z",
            resultCount: 1,
            averages: { net: 1, questionCount: 1, successRate: 100 },
            scoreAverages: [{ type: "EA", calculatedCount: 1, practiceScore: 420 }],
            students: [{
              studentId: "sample-01",
              participantNo: "ÖR-001",
              bookletType: "A",
              resultKey: "result-01",
              total: { net: 1, questionCount: 1, successRate: 100 },
              scoreViews: [
                { type: "SAY", status: "NOT_ELIGIBLE", metrics: { correct: 0, wrong: 0, blank: 1, net: 0, questionCount: 1, successRate: 0 }, profileId: "TR-YKS-2026-NOSD-V1", officialComparable: false },
                { type: "EA", status: "CALCULATED", metrics: { correct: 1, wrong: 0, blank: 0, net: 1, questionCount: 1, successRate: 100 }, practiceScore: 420, profileId: "TR-YKS-2026-NOSD-V1", officialComparable: false },
              ],
              scoreRankings: [{ type: "EA", institution: { rank: 1, outOf: 1 }, class: { rank: 1, outOf: 1 } }],
              questions: [{ questionNo: 1, branch: "Edebiyat", answer: "", correctAnswer: "", status: "CANCELLED" }],
            }],
          },
        },
      },
    }, renderer);

    const html = renderer.inputs[0]?.html ?? "";
    const lines = renderer.inputs[0]?.fallbackLines.join("\n") ?? "";
    for (const output of [html, lines]) {
      expect(output).toContain("Standart sapma kullanılmadan hesaplanan deneme puanıdır. Resmî MEB/ÖSYM sınav puanı değildir.");
      expect(output).toContain("EA");
      expect(output).toContain("420");
      expect(output).toContain("1/1");
      expect(output).toContain("İptal");
      expect(output).not.toMatch(/LGS puanı|Standart puan|percentile/u);
    }
    expect(html.match(/class="karne karne-(?:summary|detail)"/gu)).toHaveLength(2);
    expect(html).toContain("Örnek AYT 2026");
    expect(html).toContain("ÖR-001");
    expect(html).not.toContain("Ortalama Deneme Puanları");
  });

  it("kurum özeti branş, sınıf ve öğrenci sıralamasını karne sayfaları olmadan render eder", async () => {
    const renderer = new FakeRenderer();
    await processReportPdfRenderJob({
      name: "report-pdf-render",
      data: {
        snapshot: {
          id: "snapshot-summary",
          tenantId: "tenant-a",
          examId: "exam-lgs",
          reportType: "EXAM_RESULT_SUMMARY",
          status: "READY",
          snapshotData: {
            schemaVersion: 2,
            pdfMode: "INSTITUTION_SUMMARY",
            examType: "LGS",
            examYear: 2026,
            scoringProfileId: "TR-LGS-2026-NOSD-V1",
            resultCount: 1,
            averages: { net: 80, questionCount: 90, successRate: 90 },
            scoreAverages: [{ type: "LGS", calculatedCount: 1, practiceScore: 460 }],
            branches: [{ branch: "Türkçe", net: 18, questionCount: 20, successRate: 90 }],
            classes: [{ className: "8-A", resultCount: 1, averages: { net: 80, questionCount: 90, successRate: 90 } }],
            students: [{
              studentId: "sample-01",
              displayName: "Örnek Öğrenci 01",
              total: { net: 80, questionCount: 90, successRate: 90 },
              branches: [{ branch: "Türkçe", net: 18, questionCount: 20, successRate: 90 }],
              scoreViews: [{
                type: "LGS",
                status: "CALCULATED",
                metrics: { correct: 82, wrong: 6, blank: 2, net: 80, questionCount: 90, successRate: 90 },
                practiceScore: 460,
                profileId: "TR-LGS-2026-NOSD-V1",
                officialComparable: false,
              }],
              scoreRankings: [{ type: "LGS", institution: { rank: 1, outOf: 1 }, class: { rank: 1, outOf: 1 } }],
            }],
          },
        },
      },
    }, renderer);

    const html = renderer.inputs[0]?.html ?? "";
    expect(html).toContain("Branş Karşılaştırması");
    expect(html).toContain("Sınıf Karşılaştırması");
    expect(html).toContain("Öğrenci Sıralaması");
    expect(html).toContain("Ders Başarı Grafiği");
    expect(html).toContain("Puan Türü Karşılaştırması");
    expect(html).toContain("LGS puanı");
    expect(html).toContain("Kurum başarı sırası");
    expect(html).toContain("Sınıf başarı sırası");
    expect(html).toContain("Tr 18");
    expect(html).toContain("460");
    expect(html).toContain("LGS 1/1");
    expect(html).not.toContain("Öğrenci Karnesi");
  });

  it("AYT kurum özetinde SAY EA ve SÖZ puanlarını ayrı kolonlarda render eder", async () => {
    const renderer = new FakeRenderer();
    const scoreView = (type: "SAY" | "EA" | "SOZ", practiceScore: number) => ({
      type,
      status: "CALCULATED" as const,
      metrics: { correct: 80, wrong: 20, blank: 60, net: 75, questionCount: 160, successRate: 46.9 },
      practiceScore,
      profileId: "TR-YKS-2026-NOSD-V1",
      officialComparable: false as const,
    });
    await processReportPdfRenderJob({
      name: "report-pdf-render",
      data: {
        snapshot: {
          id: "snapshot-ayt-summary",
          tenantId: "tenant-a",
          examId: "exam-ayt",
          reportType: "EXAM_RESULT_SUMMARY",
          status: "READY",
          snapshotData: {
            schemaVersion: 2,
            pdfMode: "INSTITUTION_SUMMARY",
            examType: "AYT",
            examYear: 2026,
            scoringProfileId: "TR-YKS-2026-NOSD-V1",
            resultCount: 1,
            averages: { net: 75, questionCount: 160, successRate: 46.9 },
            scoreAverages: [
              { type: "SAY", calculatedCount: 1, practiceScore: 412 },
              { type: "EA", calculatedCount: 1, practiceScore: 398 },
              { type: "SOZ", calculatedCount: 1, practiceScore: 376 },
            ],
            branches: [
              { branch: "AYT Matematik", net: 28, questionCount: 40, successRate: 72.5 },
              { branch: "Edebiyat", net: 17.25, questionCount: 24, successRate: 71.9 },
            ],
            classes: [{ className: "12-A", resultCount: 1, averages: { net: 75, questionCount: 160, successRate: 46.9 } }],
            students: [{
              studentId: "sample-ayt-01",
              displayName: "Örnek AYT Öğrencisi",
              total: { net: 75, questionCount: 160, successRate: 46.9 },
              branches: [
                { branch: "AYT Matematik", net: 28, questionCount: 40, successRate: 72.5 },
                { branch: "Edebiyat", net: 17.25, questionCount: 24, successRate: 71.9 },
              ],
              scoreViews: [
                scoreView("SAY", 412),
                scoreView("EA", 398),
                scoreView("SOZ", 376),
              ],
              scoreRankings: [
                { type: "SAY", institution: { rank: 1, outOf: 1 }, class: { rank: 1, outOf: 1 } },
                { type: "EA", institution: { rank: 1, outOf: 1 }, class: { rank: 1, outOf: 1 } },
                { type: "SOZ", institution: { rank: 1, outOf: 1 }, class: { rank: 1, outOf: 1 } },
              ],
            }],
          },
        },
      },
    }, renderer);

    const html = renderer.inputs[0]?.html ?? "";
    expect(html).toContain("Sayısal puanı");
    expect(html).toContain("EA puanı");
    expect(html).toContain("Sözel puanı");
    expect(html).toContain("412");
    expect(html).toContain("398");
    expect(html).toContain("376");
    expect(html).toContain("Mat 28");
    expect(html).toContain("Edb 17.25");
    expect(html).toContain("Kurum başarı sırası");
    expect(html).toContain("Sınıf başarı sırası");
  });

  it("snapshot kayitlarini kirpmadan her ogrenci icin karne uretir", async () => {
    const renderer = new FakeRenderer();
    const branches = Array.from({ length: 10 }, (_, index) => ({
      branch: `Brans ${index + 1}`,
      net: index + 1,
      questionCount: 10,
      resultCount: 16,
      successRate: 50,
    }));
    const classes = Array.from({ length: 10 }, (_, index) => ({
      averages: { net: index + 1, questionCount: 10, successRate: 50 },
      classId: `class-${index + 1}`,
      className: `Sinif ${index + 1}`,
      resultCount: 2,
    }));
    const students = Array.from({ length: 16 }, (_, index) => ({
      branches: [{ branch: `Brans ${(index % 10) + 1}`, correct: 6, wrong: 2, blank: 2, net: 5.5 }],
      classId: `class-${(index % 10) + 1}`,
      className: `Sinif ${(index % 10) + 1}`,
      displayName: `Ogrenci ${index + 1}`,
      outcomes: Array.from({ length: 8 }, (_, outcomeIndex) => ({
        branch: `Brans ${(index % 10) + 1}`,
        outcomeCode: `K.${index + 1}.${outcomeIndex + 1}`,
        correct: 1,
        wrong: 0,
        blank: 0,
        net: 1,
      })),
      questions: Array.from({ length: 12 }, (_, questionIndex) => ({
        answer: "A",
        branch: `Brans ${(index % 10) + 1}`,
        correctAnswer: "A",
        outcomeCode: `K.${index + 1}.${(questionIndex % 8) + 1}`,
        questionNo: questionIndex + 1,
        status: "CORRECT" as const,
      })),
      statistics: { general: { rank: index + 1, outOf: 16, percentile: 50 } },
      studentId: `student-${index + 1}`,
      studentNo: String(1000 + index + 1),
      total: { estimatedRawScore: 400, net: 5.5, questionCount: 10, standardScore: 100, successRate: 55 },
    }));

    await processReportPdfRenderJob({
      id: "pdf-job-complete",
      name: "report-pdf-render",
      data: {
        institution: { institutionName: "Butunluk Koleji" },
        snapshot: {
          id: "snapshot-complete",
          tenantId: "tenant-a",
          examId: "exam-complete",
          reportType: "EXAM_RESULT_SUMMARY",
          status: "READY",
          generatedAt: "2026-07-14T09:00:00.000Z",
          snapshotData: {
            averages: { net: 5.5, questionCount: 10, successRate: 55 },
            branches,
            classes,
            resultCount: students.length,
            students,
          },
        },
      },
    }, renderer);

    const html = renderer.inputs[0]?.html ?? "";
    const fallback = renderer.inputs[0]?.fallbackLines.join("\n") ?? "";
    expect(html).toContain("Brans 10");
    expect(html).toContain("Ogrenci 16");
    expect(html.match(/<h2>Öğrenci Karnesi<\/h2>/g)).toHaveLength(16);
    expect(html).toContain("<td>12</td><td>Brans 6</td><td>Doğru</td>");
    expect(fallback).toContain("Brans 10");
    expect(fallback).toContain("Ogrenci 16");
    expect(fallback).toContain("Ogrenci Karnesi: Ogrenci 16");
    expect(fallback).toContain("12. soru Brans 6: Doğru");
  });

  it("yedek PDF ureticisi uzun raporu birden fazla sayfaya boler", async () => {
    const renderer = new SimpleReportPdfRenderer();
    const pdf = await renderer.render({
      fallbackLines: Array.from({ length: 85 }, (_, index) => `Satir ${index + 1}`),
      html: "",
    });
    const source = pdf.toString("latin1");

    expect(source.match(/\/Type\s*\/Page\b/g)).toHaveLength(3);
    expect(source.match(/\/MediaBox \[0 0 595 842\]/g)).toHaveLength(3);
    expect(source).toContain("Satir 85");
  });

  it("yanlis queue adini reddeder", async () => {
    await expect(processReportPdfRenderJob({
      id: "pdf-job-a",
      name: "report-generation",
      data: {
        snapshot: {
          id: "snapshot-a",
          tenantId: "tenant-a",
          examId: "exam-a",
          reportType: "EXAM_RESULT_SUMMARY",
          status: "READY",
          snapshotData: { resultCount: 1 },
        },
      },
    })).rejects.toThrow("REPORT_PDF_RENDER_JOB_NAME_INVALID");
  });
});

class FakeRenderer implements ReportPdfRenderer {
  readonly inputs: ReportPdfRenderInput[] = [];

  async render(input: ReportPdfRenderInput): Promise<Buffer> {
    this.inputs.push(input);
    return Buffer.from("%PDF-1.4\nworker\n%%EOF", "utf8");
  }
}
