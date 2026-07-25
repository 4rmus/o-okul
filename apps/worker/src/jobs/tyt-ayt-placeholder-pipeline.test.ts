import { describe, expect, it } from "vitest";
import type { ExamType, ParserConfigPreset, ParserConfigSuggestion } from "@o-okul/shared-types";
import { type QueueJob } from "../queue/queues.js";
import {
  type ExamEvaluationJobAdapter,
  type ExamEvaluationJobPayload,
  type ExamEvaluationJobResult,
  processExamEvaluationJob,
} from "./exam-evaluation-job.js";
import { getParserConfigPresetSuggestion } from "./format-analyzer-service.js";
import { OpticalAnswerParser } from "./optical-answer-parser.js";
import {
  examResultSummaryReportType,
  type ExamResultForReport,
  type ReportGenerationJobAdapter,
  type ReportGenerationJobPayload,
  processReportGenerationJob,
} from "./report-generation-job.js";
import { scoringEngineVersion, type AnswerKeyItem, type Choice } from "./scoring-engine.js";

type PlaceholderCase = {
  preset: ParserConfigPreset;
  examType: Extract<ExamType, "TYT" | "AYT">;
  questionCount: 120 | 160;
  sections: Array<{ branch: string; count: number }>;
  studentNos: [string, string];
};

const cases: PlaceholderCase[] = [
  {
    preset: "OPTIK_129_TYT",
    examType: "TYT",
    questionCount: 120,
    sections: [
      { branch: "Türkçe", count: 40 },
      { branch: "Sosyal Bilimler", count: 20 },
      { branch: "Temel Matematik", count: 40 },
      { branch: "Fen Bilimleri", count: 20 },
    ],
    studentNos: ["10001", "10002"],
  },
  {
    preset: "OPTIK_129_AYT",
    examType: "AYT",
    questionCount: 160,
    sections: [
      { branch: "TDE-Sosyal-1", count: 40 },
      { branch: "Sosyal-2", count: 40 },
      { branch: "Matematik", count: 40 },
      { branch: "Fen Bilimleri", count: 40 },
    ],
    studentNos: ["10001", "10002"],
  },
  {
    preset: "YANIT_TYT",
    examType: "TYT",
    questionCount: 120,
    sections: [
      { branch: "Türkçe", count: 40 },
      { branch: "Sosyal Bilimler", count: 20 },
      { branch: "Temel Matematik", count: 40 },
      { branch: "Fen Bilimleri", count: 20 },
    ],
    studentNos: ["100001", "100002"],
  },
  {
    preset: "YANIT_AYT",
    examType: "AYT",
    questionCount: 160,
    sections: [
      { branch: "TDE-Sosyal-1", count: 40 },
      { branch: "Sosyal-2", count: 40 },
      { branch: "Matematik", count: 40 },
      { branch: "Fen Bilimleri", count: 40 },
    ],
    studentNos: ["100001", "100002"],
  },
];

describe("TYT/AYT sentetik job composition değerlendirme pipeline", () => {
  it.each(cases)(
    "$preset parser→evaluation→report zincirini $questionCount soruyla deterministik tamamlar",
    async ({ preset, examType, questionCount, sections, studentNos }) => {
      const parserConfig = getParserConfigPresetSuggestion(preset);
      const answerKey = createAnswerKey(sections);
      const bPermutation = createSectionReversePermutation(sections);
      const aMasterAnswers = createAMasterAnswers(sections, answerKey);
      const bBookletAnswers = createBBookletAnswers(answerKey, bPermutation);
      const parserVersion = `${preset.toLowerCase()}-placeholder-v1`;
      const examId = `${preset.toLowerCase()}-exam`;
      const rawImportId = `${preset.toLowerCase()}-raw`;
      const parsed = new OpticalAnswerParser().parse({
        tenantId: "tenant-a",
        examId,
        rawImportId,
        parserConfigVersion: parserVersion,
        content: [
          createFixedWidthLine(parserConfig, studentNos[0], "A", aMasterAnswers),
          createFixedWidthLine(parserConfig, studentNos[1], "B", bBookletAnswers),
        ].join("\n"),
        parserConfig,
        participants: [
          { participantId: "participant-a", participantNo: studentNos[0], bookletType: "A" },
          { participantId: "participant-b", participantNo: studentNos[1], bookletType: "B" },
        ],
      });

      expect(parsed.unmatched).toEqual([]);
      expect(parsed.matched).toHaveLength(2);
      expect(parsed.matched.map((row) => row.answers.length)).toEqual([questionCount, questionCount]);

      const evaluationAdapter = createEvaluationAdapter({
        examId,
        examType,
        parserVersion,
        answerKey,
        bPermutation,
        parsed: new Map(parsed.matched.map((row) => [row.participantId, row])),
      });
      const evaluationResults = await Promise.all([
        processExamEvaluationJob(createEvaluationJob("participant-a", rawImportId), evaluationAdapter),
        processExamEvaluationJob(createEvaluationJob("participant-b", rawImportId), evaluationAdapter),
      ]);
      const [aResult, bResult] = evaluationResults;
      if (!aResult || !bResult) throw new Error("PLACEHOLDER_EVALUATION_RESULT_MISSING");

      expectScore(aResult, questionCount, questionCount - 8, 4, 4, questionCount - 9, sections);
      expectScore(bResult, questionCount, questionCount, 0, 0, questionCount, sections);
      expect(evaluationResults.every((result) => result.score.questions.length === questionCount)).toBe(true);
      expect(evaluationResults.every((result) => !("estimatedRawScore" in result.score.total))).toBe(true);

      const reportAdapter = createReportAdapter(evaluationResults);
      const snapshot = await processReportGenerationJob(
        createReportJob(examId),
        reportAdapter,
        () => "2026-07-25T12:00:00.000Z",
      );

      expect(snapshot.status).toBe("READY");
      expect(snapshot.snapshotData.averages).toMatchObject({
        questionCount,
        successRate: questionCount === 120 ? 96.25 : 97.1875,
      });
      expect(snapshot.snapshotData.averages).not.toHaveProperty("estimatedRawScore");
      expect(snapshot.snapshotData.branches.map(({ branch, questionCount: count }) => ({ branch, questionCount: count })))
        .toEqual([...sections]
          .sort((left, right) => left.branch.localeCompare(right.branch))
          .map(({ branch, count }) => ({ branch, questionCount: count })));
      expect(snapshot.snapshotData.students).toHaveLength(2);
      expect(snapshot.snapshotData.students.map(({ studentId, displayName }) => ({ studentId, displayName }))).toEqual([
        { studentId: "student-a", displayName: "Lorem Ipsum" },
        { studentId: "student-b", displayName: "Dolor Sit Amet" },
      ]);
      expect(snapshot.snapshotData.students.every((student) => student.questions.length === questionCount)).toBe(true);
      expect(snapshot.snapshotData.students.every((student) => !("estimatedRawScore" in student.total))).toBe(true);
      expect(snapshot.inputRefs.resultKeys).toEqual(evaluationResults.map((result) => result.resultKey).sort());
      expect(new Set(snapshot.inputRefs.resultKeys).size).toBe(2);

      const replayedA = await processExamEvaluationJob(
        createEvaluationJob("participant-a", rawImportId),
        evaluationAdapter,
      );
      const replayedSnapshot = await processReportGenerationJob(
        createReportJob(examId),
        reportAdapter,
        () => "2026-07-25T12:05:00.000Z",
      );
      expect(replayedA.resultKey).toBe(aResult.resultKey);
      expect(replayedSnapshot.id).toBe(snapshot.id);
      expect(replayedSnapshot.contentHash).toBe(snapshot.contentHash);
      expect(replayedSnapshot.inputRefs).toEqual(snapshot.inputRefs);
    },
  );
});

function createAnswerKey(sections: PlaceholderCase["sections"]): AnswerKeyItem[] {
  const choices: Exclude<Choice, "">[] = ["A", "B", "C", "D", "E"];
  return sections.flatMap(({ branch, count }) =>
    Array.from({ length: count }, (_unused, index) => ({
      questionNo: 1,
      correctAnswer: choices[index % choices.length]!,
      branch,
      outcomeCode: `LOREM-${branch}-${index + 1}`,
      topic: "Lorem ipsum",
    })))
    .map((question, index) => ({ ...question, questionNo: index + 1 }));
}

function createSectionReversePermutation(sections: PlaceholderCase["sections"]): number[] {
  let offset = 0;
  return sections.flatMap(({ count }) => {
    const permutation = Array.from({ length: count }, (_unused, index) => offset + count - index);
    offset += count;
    return permutation;
  });
}

function createAMasterAnswers(sections: PlaceholderCase["sections"], answerKey: AnswerKeyItem[]): Choice[] {
  let offset = 0;
  return sections.flatMap(({ count }) => {
    const answers = Array.from({ length: count }, (_unused, index) => {
      const correct = answerKey[offset + index]!.correctAnswer;
      if (index === 0) return nextChoice(correct);
      if (index === 1) return "";
      return correct;
    });
    offset += count;
    return answers;
  });
}

function createBBookletAnswers(answerKey: AnswerKeyItem[], permutation: number[]): Choice[] {
  const answers: Choice[] = Array.from({ length: answerKey.length }, () => "");
  for (const [masterIndex, bookletQuestionNo] of permutation.entries()) {
    answers[bookletQuestionNo - 1] = answerKey[masterIndex]!.correctAnswer;
  }
  return answers;
}

function nextChoice(choice: Exclude<Choice, "">): Exclude<Choice, ""> {
  const choices: Exclude<Choice, "">[] = ["A", "B", "C", "D", "E"];
  return choices[(choices.indexOf(choice) + 1) % choices.length]!;
}

function createFixedWidthLine(
  config: ParserConfigSuggestion,
  studentNo: string,
  bookletType: "A" | "B",
  answers: Choice[],
): string {
  const mapping = config.fieldMapping;
  if (
    mapping.studentNo.kind !== "fixed" ||
    mapping.bookletType.kind !== "fixed" ||
    mapping.answers.kind !== "fixed" ||
    !mapping.answers.segments
  ) {
    throw new Error("PLACEHOLDER_FIXED_PRESET_REQUIRED");
  }
  const length = Math.max(
    mapping.studentNo.start + mapping.studentNo.length,
    mapping.bookletType.start + mapping.bookletType.length,
    ...mapping.answers.segments.map((segment) => segment.start + segment.length),
  );
  const line = Array.from({ length }, () => " ");
  writeField(line, mapping.studentNo.start, mapping.studentNo.length, studentNo);
  writeField(line, mapping.bookletType.start, mapping.bookletType.length, bookletType);
  let answerOffset = 0;
  for (const segment of mapping.answers.segments) {
    writeField(
      line,
      segment.start,
      segment.length,
      answers.slice(answerOffset, answerOffset + segment.length).map((answer) => answer || " ").join(""),
    );
    answerOffset += segment.length;
  }
  return line.join("");
}

function writeField(line: string[], start: number, length: number, value: string): void {
  for (let index = 0; index < length; index += 1) {
    line[start + index] = value[index] ?? " ";
  }
}

function createEvaluationJob(
  participantId: string,
  rawImportId: string,
): QueueJob<ExamEvaluationJobPayload> {
  return {
    id: `${rawImportId}-${participantId}`,
    name: "exam-evaluation",
    payload: {
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: rawImportId,
      contentHash: "placeholder-content-v1",
      participantId,
      rawImportId,
      answerKeyId: "answer-key-placeholder-v1",
    },
  };
}

function createEvaluationAdapter(input: {
  examId: string;
  examType: Extract<ExamType, "TYT" | "AYT">;
  parserVersion: string;
  answerKey: AnswerKeyItem[];
  bPermutation: number[];
  parsed: Map<string, { bookletType: string; answers: Array<{ questionNo: number; answer: Choice }> }>;
}): ExamEvaluationJobAdapter {
  return {
    async loadInput(jobInput) {
      const parsed = input.parsed.get(jobInput.participantId);
      if (!parsed) throw new Error("PLACEHOLDER_PARTICIPANT_MISSING");
      return {
        examId: input.examId,
        studentId: jobInput.participantId === "participant-a" ? "student-a" : "student-b",
        parserConfigVersion: input.parserVersion,
        bookletType: parsed.bookletType,
        answers: parsed.answers,
        bookletVariants: [{ code: "B", permutation: input.bPermutation }],
        answerKey: input.answerKey,
        scoringConfig: {
          examType: input.examType,
          wrongPenalty: 0.25,
          answerKeyVersion: "answer-key-placeholder-v1",
          engineVersion: scoringEngineVersion,
          computedAt: "2026-07-25T11:00:00.000Z",
        },
      };
    },
    async saveResult(result) {
      return result;
    },
  };
}

function expectScore(
  result: ExamEvaluationJobResult,
  questionCount: number,
  correct: number,
  wrong: number,
  blank: number,
  net: number,
  sections: PlaceholderCase["sections"],
): void {
  expect(result.score.total).toMatchObject({ correct, wrong, blank, net });
  expect(result.score.total.correct + result.score.total.wrong + result.score.total.blank).toBe(questionCount);
  expect(result.score.branches.map((branch) => ({
    branch: branch.branch,
    questionCount: branch.correct + branch.wrong + branch.blank,
  }))).toEqual(sections.map(({ branch, count }) => ({ branch, questionCount: count })));
}

function createReportJob(examId: string): QueueJob<ReportGenerationJobPayload> {
  return {
    id: `${examId}-report`,
    name: "report-generation",
    payload: {
      tenantId: "tenant-a",
      userId: "user-a",
      entityId: examId,
      contentHash: "placeholder-results-v1",
      reportType: examResultSummaryReportType,
    },
  };
}

function createReportAdapter(results: ExamEvaluationJobResult[]): ReportGenerationJobAdapter {
  const reportResults: ExamResultForReport[] = results.map((result) => ({
    studentId: result.studentId,
    displayName: result.studentId === "student-a" ? "Lorem Ipsum" : "Dolor Sit Amet",
    resultKey: result.resultKey,
    answerKeyVersion: result.answerKeyVersion,
    parserConfigVersion: result.parserConfigVersion,
    engineVersion: result.engineVersion,
    score: result.score,
    computedAt: result.score._meta.computedAt,
  }));
  return {
    async loadResults() {
      return reportResults;
    },
    async saveSnapshot(snapshot) {
      return { ...snapshot, id: `snapshot-${snapshot.contentHash}` };
    },
  };
}
