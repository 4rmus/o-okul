import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { FormatAnalyzerService } from "./format-analyzer-service.js";
import { OpticalAnswerParser } from "./optical-answer-parser.js";
import {
  scoreExam,
  scoringEngineVersion,
  type AnswerKeyItem,
  type StudentAnswer,
  type ScoringResult,
} from "./scoring-engine.js";

interface AnswerKeyFixture {
  version: string;
  wrongPenalty: number;
  questions: AnswerKeyItem[];
}

const fixtureDir = resolve(__dirname, "../../src/jobs/fixtures");
const answerKey = readJsonFixture<AnswerKeyFixture>("optical-pilot-answer-key.json");

describe("optical pilot fixtures", () => {
  it.each([
    { fileName: "optical-pilot-tab.txt", delimiter: "TAB", skipHeaderLines: 1 },
    { fileName: "optical-pilot-fixed.dat", delimiter: "FIXED", skipHeaderLines: 0 },
  ] as const)("$fileName örneğini analiz eder, parse eder ve puanlar", ({ fileName, delimiter, skipHeaderLines }) => {
    const content = readTextFixture(fileName);
    const suggestion = new FormatAnalyzerService().analyze({ sampleText: content });

    expect(suggestion).toMatchObject({
      delimiter,
      skipHeaderLines,
      fieldMapping: {
        answers: { estimatedQuestionCount: 5 },
      },
    });

    const result = new OpticalAnswerParser().parse({
      tenantId: "tenant-a",
      examId: "exam-a",
      rawImportId: "raw-import-a",
      parserConfigVersion: "pilot-parser-v1",
      content,
      parserConfig: suggestion,
      participants: [
        { participantId: "participant-1", studentNo: "100001", bookletType: "A" },
        { participantId: "participant-2", studentNo: "100002", bookletType: "B" },
      ],
    });

    expect(result.unmatched).toEqual([expect.objectContaining({
      reason: "STUDENT_NOT_FOUND",
      rawRow: expect.objectContaining({ studentNo: "999999" }),
    })]);
    expect(scoreMatchedRows(result.matched.map((row) => row.answers)).map((score) => score.total)).toEqual([
      { correct: 5, wrong: 0, blank: 0, net: 5, rawScore: 5, standardScore: 5 },
      { correct: 4, wrong: 0, blank: 1, net: 4, rawScore: 4, standardScore: 4 },
    ]);
  });
});

function scoreMatchedRows(rows: StudentAnswer[][]): ScoringResult[] {
  return rows.map((answers) =>
    scoreExam(answers, answerKey.questions, {
      answerKeyVersion: answerKey.version,
      computedAt: "2026-05-31T00:00:00.000Z",
      engineVersion: scoringEngineVersion,
      wrongPenalty: answerKey.wrongPenalty,
    }),
  );
}

function readTextFixture(fileName: string): string {
  return readFileSync(resolve(fixtureDir, fileName), "utf8");
}

function readJsonFixture<T>(fileName: string): T {
  return JSON.parse(readTextFixture(fileName)) as T;
}
