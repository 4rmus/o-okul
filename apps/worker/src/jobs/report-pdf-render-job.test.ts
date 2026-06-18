import { describe, expect, it } from "vitest";
import {
  processReportPdfRenderJob,
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
    expect(renderer.inputs[0]?.html).toContain("<td>student-a</td><td>8-A</td><td>%87.5</td><td>20</td><td>17.5</td>");
    expect(renderer.inputs[0]?.html).toContain("PUAN - SIRA ANALİZİ");
    expect(renderer.inputs[0]?.html).toContain("<th>No</th><th>Branş</th><th>Başarı %</th><th>Soru sayısı</th><th>Doğru</th><th>Yanlış</th><th>Boş</th><th>Net</th>");
    expect(renderer.inputs[0]?.html).toContain("<td>1</td><td>Matematik</td><td>%87.5</td><td>20</td><td>18</td><td>2</td><td>0</td><td>17.5</td>");
    expect(renderer.inputs[0]?.html).toContain("KAZANIM DETAYI");
    expect(renderer.inputs[0]?.html).toContain("student-a");
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
