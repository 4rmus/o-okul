import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildSeedExams } from "./seed-exams.js";

describe("seed-exams gerçek pipeline", () => {
  it("gerçek TXT/XLSX girdilerinden deterministik seed verisi üretir", async () => {
    const first = await buildSeedExams();
    const second = await buildSeedExams();

    expect(second).toEqual(first);
    expect(first.map((exam) => ({
      id: exam.id,
      questionCount: exam.questions.length,
      bPermutationHead: exam.bookletVariants[0]?.permutation.slice(0, 5),
      matchedDemoStudents: exam.matchedEntries.length,
      unmatchedRows: exam.unmatchedCount,
      adiguzel: exam.matchedEntries.find((entry) => entry.studentNo === "176")?.score.total,
      missing1606: exam.matchedEntries.some((entry) => entry.studentNo === "1606"),
    }))).toEqual([
      {
        id: "exam-demo-isem-lgs-1",
        questionCount: 90,
        bPermutationHead: [20, 19, 18, 17, 16],
        matchedDemoStudents: 17,
        unmatchedRows: 237,
        adiguzel: {
          correct: 80,
          wrong: 10,
          blank: 0,
          net: 76.66666666666666,
          rawScore: 76.66666666666666,
          standardScore: 76.66666666666666,
        },
        missing1606: false,
      },
      {
        id: "exam-demo-muba-lgs-3",
        questionCount: 90,
        bPermutationHead: [2, 1, 4, 5, 3],
        matchedDemoStudents: 17,
        unmatchedRows: 226,
        adiguzel: {
          correct: 86,
          wrong: 4,
          blank: 0,
          net: 84.66666666666667,
          rawScore: 84.66666666666667,
          standardScore: 84.66666666666667,
        },
        missing1606: false,
      },
      {
        id: "exam-demo-3d-lgs-2",
        questionCount: 90,
        bPermutationHead: [3, 4, 1, 2, 6],
        matchedDemoStudents: 16,
        unmatchedRows: 211,
        adiguzel: {
          correct: 86,
          wrong: 4,
          blank: 0,
          net: 84.66666666666667,
          rawScore: 84.66666666666667,
          standardScore: 84.66666666666667,
        },
        missing1606: false,
      },
    ]);
  });

  it("ADIGÜZEL seed skorlarını hedef karne PDF'leriyle karşılaştırır", async () => {
    const seedExams = await buildSeedExams();

    for (const expectedPdf of adiguzelPdfExpectations) {
      const exam = seedExams.find((candidate) => candidate.id === expectedPdf.examId);
      const adiguzel = exam?.matchedEntries.find((entry) => entry.studentNo === "176");
      const pdf = readAdiguzelPdfSummary(expectedPdf.fileNameNeedle);

      expect(exam?.title).toBe(pdf.title);
      expect(pdf.studentName).toBe("AHMET İSHAK ADIGÜZEL");
      expect(pdf.studentNo).toBe("176");
      expect(pdf.bookletType).toBe(expectedPdf.bookletType);
      expect(adiguzel?.bookletType).toBe(pdf.bookletType);
      expect(adiguzel?.score.total.correct).toBe(pdf.correct);
      expect(adiguzel?.score.total.wrong).toBe(pdf.wrong);
      expect(adiguzel?.score.total.blank).toBe(pdf.blank);
      expect(adiguzel?.score.total.net).toBeCloseTo(pdf.net, 2);
    }
  });
});

const fixtureDir = fileURLToPath(new URL("../../../ornek-veriler/", import.meta.url));

const adiguzelPdfExpectations = [
  { examId: "exam-demo-isem-lgs-1", fileNameNeedle: "iSEM", bookletType: "B" },
  { examId: "exam-demo-muba-lgs-3", fileNameNeedle: "MUBA", bookletType: "A" },
  { examId: "exam-demo-3d-lgs-2", fileNameNeedle: "3D", bookletType: "B" },
];

function readAdiguzelPdfSummary(fileNameNeedle: string) {
  const fileName = readdirSync(fixtureDir).find((name) =>
    name.startsWith("Ahmet-ishak-") && name.includes(fileNameNeedle) && name.endsWith(".pdf")
  );
  if (!fileName) throw new Error(`ADIGUZEL_PDF_NOT_FOUND:${fileNameNeedle}`);

  const lines = extractPdfTextLines(`${fixtureDir}${fileName}`);
  const totalIndex = lines.findIndex((line) => line === "TOPLAM");
  const studentInfo = lines[3] ?? "";
  const bookletLine = lines.find((line) => line.includes("KİTAPÇIĞI")) ?? "";
  if (totalIndex < 0) throw new Error(`ADIGUZEL_PDF_TOTAL_NOT_FOUND:${fileName}`);

  return {
    title: lines[0],
    studentName: lines[1],
    studentNo: studentInfo.split(" - ")[1],
    bookletType: bookletLine.slice(0, 1),
    correct: Number(lines[totalIndex + 2]),
    wrong: Number(lines[totalIndex + 3]),
    blank: Number(lines[totalIndex + 4]),
    net: Number(lines[totalIndex + 5]),
  };
}

function extractPdfTextLines(path: string): string[] {
  const pdf = readFileSync(path, "latin1");
  const unicodeMap = new Map<number, string>();
  for (const match of pdf.matchAll(/<([0-9a-fA-F]{4})>\s*<([0-9a-fA-F]{4})>/g)) {
    unicodeMap.set(Number.parseInt(match[1] ?? "", 16), String.fromCharCode(Number.parseInt(match[2] ?? "", 16)));
  }

  const lines: string[] = [];
  for (const match of pdf.matchAll(/<([0-9a-fA-F]{4,})>\s*Tj/g)) {
    const hex = match[1] ?? "";
    let text = "";
    for (let index = 0; index < hex.length; index += 4) {
      const code = Number.parseInt(hex.slice(index, index + 4), 16);
      text += unicodeMap.get(code) ?? "";
    }
    if (text.trim()) lines.push(text);
  }
  return lines;
}
