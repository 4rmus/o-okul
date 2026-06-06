import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { alignAnswersToMaster } from "./booklet-alignment.js";
import { getParserConfigPresetSuggestion } from "./format-analyzer-service.js";
import { OpticalAnswerParser } from "./optical-answer-parser.js";
import { scoreExam, scoringEngineVersion, type AnswerKeyItem, type Choice } from "./scoring-engine.js";

type RealExamFixture = {
  id: string;
  txtPath: string;
  answerKeyPath: string;
  expectedRows: {
    total: number;
    A: number;
    B: number;
  };
  expectedStudents: {
    A: string;
    B: string;
  };
  expectedBPermutationHead: number[];
  expectedScores: {
    A: {
      correct: number;
      wrong: number;
      blank: number;
      net: number;
      first20: string;
    };
    B: {
      correct: number;
      wrong: number;
      blank: number;
      net: number;
      first20: string;
      firstQuestion: {
        answer: Choice;
        correctAnswer: Exclude<Choice, "">;
        status: "CORRECT" | "WRONG" | "BLANK";
      };
    };
  };
};

const fixtures: RealExamFixture[] = [
  {
    id: "isem-lgs-1",
    txtPath: "../../ornek-veriler/iSEM .txt",
    answerKeyPath: "../../ornek-veriler/iSEM - LGS - 1 Detaylı Cevap Anahtarı.xlsx",
    expectedRows: { total: 254, A: 128, B: 126 },
    expectedStudents: { A: "331", B: "638" },
    expectedBPermutationHead: [
      20, 19, 18, 17, 16, 15, 14, 13, 12, 11,
      10, 9, 8, 7, 6, 5, 4, 3, 2, 1,
      30, 29, 28, 27, 26,
    ],
    expectedScores: {
      A: { correct: 56, wrong: 32, blank: 2, net: 45.3333, first20: "CBCADDBABDBACAABDACA" },
      B: {
        correct: 44,
        wrong: 31,
        blank: 15,
        net: 33.6667,
        first20: "BBC_BDBACDADDDABBACD",
        firstQuestion: { answer: "B", correctAnswer: "D", status: "WRONG" },
      },
    },
  },
  {
    id: "3d-prova-lgs-2",
    txtPath: "../../ornek-veriler/3D.txt",
    answerKeyPath: "../../ornek-veriler/3D - PROVA LGS - 2 Detaylı Cevap Anahtarı.xlsx",
    expectedRows: { total: 227, A: 116, B: 111 },
    expectedStudents: { A: "157", B: "1333" },
    expectedBPermutationHead: [
      3, 4, 1, 2, 6, 7, 13, 8, 10, 11,
      12, 18, 5, 14, 15, 16, 19, 20, 17, 9,
      23, 24, 21, 22, 26,
    ],
    expectedScores: {
      A: { correct: 48, wrong: 24, blank: 18, net: 40, first20: "BDD_AACBDCACBBBDCBAA" },
      B: {
        correct: 59,
        wrong: 21,
        blank: 10,
        net: 52,
        first20: "CBDAAABCDCBCBDBDCBAB",
        firstQuestion: { answer: "C", correctAnswer: "C", status: "CORRECT" },
      },
    },
  },
];

describe("OPTİK-7108 gerçek veri pipeline fixture", () => {
  it.each(fixtures)(
    "$id gerçek TXT ve gerçek cevap anahtarıyla A/B parse→hizala→puan zincirini deterministik çalıştırır",
    async (fixture) => {
      const answerKey = await readAnswerKey(fixture.answerKeyPath);
      const rows = readOptikRows(fixture.txtPath);
      const aRow = rows.find((row) => row.bookletType === "A");
      const bRow = rows.find((row) => row.bookletType === "B");
      if (!aRow || !bRow) throw new Error("OPTIK_7108_FIXTURE_ROW_MISSING");

      expect(rows).toHaveLength(fixture.expectedRows.total);
      expect(rows.filter((row) => row.bookletType === "A")).toHaveLength(fixture.expectedRows.A);
      expect(rows.filter((row) => row.bookletType === "B")).toHaveLength(fixture.expectedRows.B);
      expect(aRow.studentNo).toBe(fixture.expectedStudents.A);
      expect(bRow.studentNo).toBe(fixture.expectedStudents.B);

      const parsed = new OpticalAnswerParser().parse({
        tenantId: "tenant-a",
        examId: fixture.id,
        rawImportId: `${fixture.id}-raw-import`,
        parserConfigVersion: "optik-7108-lgs-v1",
        content: [aRow.line, bRow.line].join("\n"),
        parserConfig: getParserConfigPresetSuggestion("OPTIK_7108_LGS"),
        participants: [
          { participantId: "participant-a", participantNo: aRow.studentNo, bookletType: "A" },
          { participantId: "participant-b", participantNo: bRow.studentNo, bookletType: "B" },
        ],
      });

      expect(parsed.unmatched).toEqual([]);
      expect(parsed.matched).toHaveLength(2);
      const aAnswers = parsed.matched.find((row) => row.participantId === "participant-a")?.answers ?? [];
      const bAnswers = parsed.matched.find((row) => row.participantId === "participant-b")?.answers ?? [];
      const alignedBAnswers = alignAnswersToMaster(bAnswers, "B", [{ code: "B", permutation: answerKey.bPermutation }]);

      expect(aAnswers).toHaveLength(90);
      expect(bAnswers).toHaveLength(90);
      expect(answerKey.questions).toHaveLength(90);
      expect(answerKey.bPermutation.slice(0, 25)).toEqual(fixture.expectedBPermutationHead);
      expect(aAnswers.slice(0, 20).map((answer) => answer.answer || "_").join("")).toBe(
        fixture.expectedScores.A.first20,
      );
      expect(alignedBAnswers.slice(0, 20).map((answer) => answer.answer || "_").join("")).toBe(
        fixture.expectedScores.B.first20,
      );

      const aScore = scoreExam(aAnswers, answerKey.questions, createScoringConfig());
      const bScore = scoreExam(alignedBAnswers, answerKey.questions, createScoringConfig());

      expect(aScore.total).toMatchObject({
        correct: fixture.expectedScores.A.correct,
        wrong: fixture.expectedScores.A.wrong,
        blank: fixture.expectedScores.A.blank,
      });
      expect(aScore.total.net).toBeCloseTo(fixture.expectedScores.A.net, 4);
      expect(bScore.total).toMatchObject({
        correct: fixture.expectedScores.B.correct,
        wrong: fixture.expectedScores.B.wrong,
        blank: fixture.expectedScores.B.blank,
      });
      expect(bScore.total.net).toBeCloseTo(fixture.expectedScores.B.net, 4);
      expect(bScore.questions[0]).toEqual({
        questionNo: 1,
        branch: "LGS TÜRKÇE",
        outcomeCode: "SÖZCÜKTE ANLAM",
        topic: "SÖZCÜKTE ANLAM",
        answer: fixture.expectedScores.B.firstQuestion.answer,
        correctAnswer: fixture.expectedScores.B.firstQuestion.correctAnswer,
        status: fixture.expectedScores.B.firstQuestion.status,
      });
    },
  );
});

function createScoringConfig() {
  return {
    answerKeyVersion: "isem-lgs-1-v1",
    computedAt: "2026-06-02T00:00:00.000Z",
    engineVersion: scoringEngineVersion,
    wrongPenalty: 1 / 3,
  };
}

async function readAnswerKey(path: string): Promise<{ questions: AnswerKeyItem[]; bPermutation: number[] }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("ANSWER_KEY_WORKSHEET_MISSING");

  const rows: Array<{
    section: string;
    globalQuestionNo: number;
    bEquivalent: number;
    correctAnswer: Exclude<Choice, "">;
    branch: string;
    outcomeCode?: string;
    topic?: string;
  }> = [];

  worksheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const section = cellText(row.getCell(1).value);
    const localQuestionNo = Number(cellText(row.getCell(2).value));
    if (!section || !Number.isInteger(localQuestionNo)) return;
    rows.push({
      section,
      globalQuestionNo: rows.length + 1,
      bEquivalent: Number(cellText(row.getCell(3).value)),
      correctAnswer: cellText(row.getCell(4).value).toUpperCase() as Exclude<Choice, "">,
      outcomeCode: cellText(row.getCell(5).value),
      topic: cellText(row.getCell(6).value),
      branch: cellText(row.getCell(7).value),
    });
  });

  const sectionStats = new Map<string, { start: number; count: number }>();
  for (const row of rows) {
    const current = sectionStats.get(row.section);
    sectionStats.set(row.section, {
      start: current?.start ?? row.globalQuestionNo,
      count: (current?.count ?? 0) + 1,
    });
  }

  return {
    questions: rows.map((row) => ({
      questionNo: row.globalQuestionNo,
      correctAnswer: row.correctAnswer,
      branch: row.branch,
      ...(row.outcomeCode ? { outcomeCode: row.outcomeCode } : {}),
      ...(row.topic ? { topic: row.topic } : {}),
    })),
    bPermutation: rows.map((row) => {
      const section = sectionStats.get(row.section);
      if (!section) throw new Error("ANSWER_KEY_SECTION_MISSING");
      return section.start + row.bEquivalent - 1;
    }),
  };
}

function readOptikRows(path: string): Array<{ line: string; studentNo: string; bookletType: string }> {
  return readFileSync(path, "utf8")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter(Boolean)
    .map((line) => ({
      line,
      studentNo: line.slice(11, 15).trim(),
      bookletType: line.slice(50, 51),
    }));
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
