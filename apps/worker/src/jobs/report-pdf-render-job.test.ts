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
    expect(renderer.inputs[0]?.html).toContain("Rapor bağlamı");
    expect(renderer.inputs[0]?.html).toContain("READY snapshot");
    expect(renderer.inputs[0]?.html).toContain("Branş Başarı");
    expect(renderer.inputs[0]?.html).toContain("Başarı %");
    expect(renderer.inputs[0]?.html).toContain("<span>Başarı % %87.5</span>");
    expect(renderer.inputs[0]?.html).toContain("Soru");
    expect(renderer.inputs[0]?.html).toContain("<td>Matematik</td><td>1</td><td>%87.5</td><td>20</td><td>17.5</td>");
    expect(renderer.inputs[0]?.html).toContain("<td>Ada Ak</td><td>8-A</td><td>%87.5</td><td>20</td><td>17.5</td>");
    expect(renderer.inputs[0]?.html).toContain("PUAN - SIRA ANALİZİ");
    expect(renderer.inputs[0]?.html).toContain("<th>No</th><th>Branş</th><th>Başarı %</th><th>Soru sayısı</th><th>Doğru</th><th>Yanlış</th><th>Boş</th><th>Net</th>");
    expect(renderer.inputs[0]?.html).toContain("<td>1</td><td>Matematik</td><td>%87.5</td><td>20</td><td>18</td><td>2</td><td>0</td><td>17.5</td>");
    expect(renderer.inputs[0]?.html).toContain("KAZANIM DETAYI");
    expect(renderer.inputs[0]?.html).toContain("Ada Ak");
    expect(renderer.inputs[0]?.html).toContain("1001 · 8-A");
    expect(renderer.inputs[0]?.fallbackLines).toContain("DNA Egitim - Sinav Raporu");
    expect(renderer.inputs[0]?.fallbackLines).toContain("Ortalama basari: %87.5");
    expect(renderer.inputs[0]?.fallbackLines).toContain("Soru sayisi: 20");
    expect(renderer.inputs[0]?.fallbackLines).toContain("Ortalama LGS puani: 456.7");
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
    expect(renderer.inputs[0]?.fallbackLines).toContain("Ortalama LGS puani: 0");
    expect(renderer.inputs[0]?.fallbackLines).toContain("Standart puan: 0");
    expect(renderer.inputs[0]?.html).toContain("<span>Başarı % %0</span>");
    expect(renderer.inputs[0]?.html).toContain("<span>Soru 0</span>");
    expect(renderer.inputs[0]?.html).toContain("<span>Net 0</span>");
    expect(renderer.inputs[0]?.html).toContain("<span>LGS puanı 0</span>");
    expect(renderer.inputs[0]?.html).toContain("<span>Standart puan 0</span>");
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
      outcomes: [{ branch: `Brans ${(index % 10) + 1}`, outcomeCode: `K.${index + 1}`, correct: 1, wrong: 0, blank: 0, net: 1 }],
      questions: [{ answer: "A", branch: `Brans ${(index % 10) + 1}`, correctAnswer: "A", outcomeCode: `K.${index + 1}`, questionNo: index + 1, status: "CORRECT" }],
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
    expect(html).toContain("Sinif 10");
    expect(html).toContain("Ogrenci 16");
    expect(html.match(/<h2>Öğrenci Karnesi<\/h2>/g)).toHaveLength(16);
    expect(html.match(/<h2>Detaylı Deneme Analizi<\/h2>/g)).toHaveLength(16);
    expect(html).toContain("K.16");
    expect(fallback).toContain("Brans 10");
    expect(fallback).toContain("Sinif 10");
    expect(fallback).toContain("Ogrenci 16");
    expect(fallback).toContain("Ogrenci Karnesi: Ogrenci 16");
    expect(fallback).toContain("K.16");
  });

  it("yedek PDF ureticisi uzun raporu birden fazla sayfaya boler", async () => {
    const renderer = new SimpleReportPdfRenderer();
    const pdf = await renderer.render({
      fallbackLines: Array.from({ length: 85 }, (_, index) => `Satir ${index + 1}`),
      html: "",
    });
    const source = pdf.toString("latin1");

    expect(source.match(/\/Type\s*\/Page\b/g)).toHaveLength(3);
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
