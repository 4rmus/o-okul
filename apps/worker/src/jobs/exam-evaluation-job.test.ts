import { describe, expect, it } from "vitest";
import { getJobContext } from "../context/job-context.js";
import { createJobId, type QueueJob } from "../queue/queues.js";
import {
  type ExamEvaluationJobAdapter,
  type ExamEvaluationJobPayload,
  type ExamEvaluationJobResult,
  processExamEvaluationJob,
} from "./exam-evaluation-job.js";
import { scoringEngineVersion } from "./scoring-engine.js";

describe("exam evaluation job", () => {
  const payload: ExamEvaluationJobPayload = {
    tenantId: "tenant-a",
    userId: "user-a",
    entityId: "raw-import-a",
    contentHash: "hash-a",
    participantId: "participant-a",
    rawImportId: "raw-import-a",
    answerKeyId: "answer-key-a",
  };

  it("referans payload ile input yükler, skorlar ve sonucu kaydeder", async () => {
    const adapter = createAdapter();
    const job = createJob(payload);

    const result = await processExamEvaluationJob(job, adapter);

    expect(adapter.loadInputs).toEqual([
      {
        tenantId: "tenant-a",
        userId: "user-a",
        jobId: createJobId(payload.entityId, payload.contentHash),
        participantId: "participant-a",
        rawImportId: "raw-import-a",
        answerKeyId: "answer-key-a",
        contentHash: "hash-a",
      },
    ]);
    expect(adapter.savedResults).toHaveLength(1);
    expect(result).toEqual({
      tenantId: "tenant-a",
      examId: "exam-a",
      studentId: "student-a",
      participantId: "participant-a",
      rawImportId: "raw-import-a",
      answerKeyId: "answer-key-a",
      parserConfigVersion: "parser-v1",
      answerKeyVersion: "answer-key-v1",
      engineVersion: scoringEngineVersion,
      resultKey: expect.stringMatching(/^[a-f0-9]{64}$/),
      status: "completed",
      score: {
        total: {
          correct: 1,
          wrong: 1,
          blank: 1,
          net: 0.75,
          rawScore: 0.75,
          estimatedRawScore: 3.261,
          standardScore: 0.75,
        },
        branches: [
          { branch: "Matematik", correct: 1, wrong: 1, blank: 0, net: 0.75 },
          { branch: "Türkçe", correct: 0, wrong: 0, blank: 1, net: 0 },
        ],
        questions: [
          { questionNo: 1, branch: "Matematik", answer: "A", correctAnswer: "A", status: "CORRECT" },
          { questionNo: 2, branch: "Matematik", answer: "C", correctAnswer: "B", status: "WRONG" },
          { questionNo: 3, branch: "Türkçe", answer: "", correctAnswer: "C", status: "BLANK" },
        ],
        _meta: {
          answerKeyVersion: "answer-key-v1",
          engineVersion: scoringEngineVersion,
          computedAt: "2026-05-30T03:00:00.000Z",
        },
      },
    });
    expect(adapter.savedResults[0]).toEqual(result);
    expect(() => getJobContext()).toThrow("JOB_CONTEXT_MISSING");
  });

  it("aynı idempotency girdileriyle aynı resultKey değerini üretir", async () => {
    const job = createJob(payload);

    const first = await processExamEvaluationJob(job, createAdapter());
    const second = await processExamEvaluationJob(job, createAdapter());

    expect(first.resultKey).toBe(second.resultKey);
  });

  it("retry zaman damgası değişse de aynı resultKey değerini üretir", async () => {
    const first = await processExamEvaluationJob(createJob(payload), createAdapter());
    const second = await processExamEvaluationJob(createJob(payload), createAdapter({
      scoringConfig: {
        answerKeyVersion: "answer-key-v1",
        computedAt: "2026-05-30T04:00:00.000Z",
        engineVersion: scoringEngineVersion,
        wrongPenalty: 0.25,
      },
    }));

    expect(first.resultKey).toBe(second.resultKey);
  });

  it("puanlama içeriği değiştiğinde farklı resultKey üretir", async () => {
    const first = await processExamEvaluationJob(createJob(payload), createAdapter());
    const second = await processExamEvaluationJob(createJob(payload), createAdapter({
      answers: [
        { questionNo: 1, answer: "B" },
        { questionNo: 2, answer: "C" },
        { questionNo: 3, answer: "" },
      ],
    }));

    expect(first.resultKey).not.toBe(second.resultKey);
  });

  it("B kitapçığı cevaplarını puanlamadan önce master sıraya hizalar", async () => {
    const adapter = createAdapter({
      bookletType: "B",
      answers: [
        { questionNo: 1, answer: "B" },
        { questionNo: 2, answer: "A" },
        { questionNo: 3, answer: "C" },
      ],
      bookletVariants: [{ code: "B", permutation: [2, 1, 3] }],
    });

    const result = await processExamEvaluationJob(createJob(payload), adapter);

    expect(result.score.questions).toEqual([
      { questionNo: 1, branch: "Matematik", answer: "A", correctAnswer: "A", status: "CORRECT" },
      { questionNo: 2, branch: "Matematik", answer: "B", correctAnswer: "B", status: "CORRECT" },
      { questionNo: 3, branch: "Türkçe", answer: "C", correctAnswer: "C", status: "CORRECT" },
    ]);
  });

  it("adapter kayıt bulamazsa hatayı net şekilde yukarı taşır", async () => {
    const adapter: ExamEvaluationJobAdapter = {
      async loadInput() {
        throw new Error("EXAM_EVALUATION_INPUT_NOT_FOUND");
      },
      async saveResult(result) {
        return result;
      },
    };

    await expect(processExamEvaluationJob(createJob(payload), adapter)).rejects.toThrow(
      "EXAM_EVALUATION_INPUT_NOT_FOUND",
    );
  });

  it("job adı exam-evaluation değilse adapter çağırmadan reddeder", async () => {
    const adapter = createAdapter();
    const job = {
      id: "bad-job",
      name: "excel-import",
      payload,
    } as QueueJob<ExamEvaluationJobPayload>;

    await expect(processExamEvaluationJob(job, adapter)).rejects.toThrow("EXAM_EVALUATION_JOB_NAME_INVALID");
    expect(adapter.loadInputs).toHaveLength(0);
    expect(adapter.savedResults).toHaveLength(0);
  });

  it("tenant payload eksikse adapter çağırmadan fail eder", async () => {
    const adapter = createAdapter();
    const job = {
      id: "bad-job",
      name: "exam-evaluation",
      payload: { ...payload, tenantId: "" },
    } as QueueJob<ExamEvaluationJobPayload>;

    await expect(processExamEvaluationJob(job, adapter)).rejects.toThrow("TENANT_JOB_PAYLOAD_INVALID");
    expect(adapter.loadInputs).toHaveLength(0);
    expect(adapter.savedResults).toHaveLength(0);
  });

  it("exam evaluation referansları eksikse adapter çağırmadan fail eder", async () => {
    const adapter = createAdapter();
    const job = {
      id: "bad-job",
      name: "exam-evaluation",
      payload: { ...payload, answerKeyId: "" },
    } as QueueJob<ExamEvaluationJobPayload>;

    await expect(processExamEvaluationJob(job, adapter)).rejects.toThrow("EXAM_EVALUATION_PAYLOAD_INVALID");
    expect(adapter.loadInputs).toHaveLength(0);
    expect(adapter.savedResults).toHaveLength(0);
  });
});

function createJob(payload: ExamEvaluationJobPayload): QueueJob<ExamEvaluationJobPayload> {
  return {
    id: createJobId(payload.entityId, payload.contentHash),
    name: "exam-evaluation",
    payload,
  };
}

function createAdapter(overrides: Partial<Awaited<ReturnType<ExamEvaluationJobAdapter["loadInput"]>>> = {}): ExamEvaluationJobAdapter & {
  loadInputs: Parameters<ExamEvaluationJobAdapter["loadInput"]>[0][];
  savedResults: ExamEvaluationJobResult[];
} {
  return {
    loadInputs: [],
    savedResults: [],
    async loadInput(input) {
      this.loadInputs.push(input);
      return {
        examId: "exam-a",
        studentId: "student-a",
        parserConfigVersion: "parser-v1",
        answers: [
          { questionNo: 1, answer: "A" },
          { questionNo: 2, answer: "C" },
          { questionNo: 3, answer: "" },
        ],
        answerKey: [
          { questionNo: 1, correctAnswer: "A", branch: "Matematik" },
          { questionNo: 2, correctAnswer: "B", branch: "Matematik" },
          { questionNo: 3, correctAnswer: "C", branch: "Türkçe" },
        ],
        scoringConfig: {
          answerKeyVersion: "answer-key-v1",
          computedAt: "2026-05-30T03:00:00.000Z",
          engineVersion: scoringEngineVersion,
          wrongPenalty: 0.25,
        },
        ...overrides,
      };
    },
    async saveResult(result) {
      this.savedResults.push(result);
      return result;
    },
  };
}
