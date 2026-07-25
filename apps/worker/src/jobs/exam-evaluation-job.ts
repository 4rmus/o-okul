import { createHash } from "node:crypto";
import { runWithJobContext } from "../context/job-context.js";
import { assertTenantJobPayload, type QueueJob, type TenantJobPayload } from "../queue/queues.js";
import { alignAnswersToMaster, type ExamBookletVariantInput } from "./booklet-alignment.js";
import { scoreExam, type AnswerKeyItem, type ScoringConfig, type ScoringResult, type StudentAnswer } from "./scoring-engine.js";

export interface ExamEvaluationJobPayload extends TenantJobPayload {
  participantId: string;
  rawImportId: string;
  answerKeyId: string;
}

export interface ExamEvaluationJobInput {
  tenantId: string;
  userId: string;
  jobId: string;
  participantId: string;
  rawImportId: string;
  answerKeyId: string;
  contentHash: string;
}

export interface ExamEvaluationScoringInput {
  examId: string;
  studentId: string;
  parserConfigVersion: string;
  bookletType?: string | null;
  answers: StudentAnswer[];
  bookletVariants?: ExamBookletVariantInput[];
  answerKey: AnswerKeyItem[];
  scoringConfig: ScoringConfig;
}

export interface ExamEvaluationJobResult {
  tenantId: string;
  examId: string;
  studentId: string;
  participantId: string;
  rawImportId: string;
  answerKeyId: string;
  parserConfigVersion: string;
  answerKeyVersion: string;
  engineVersion: string;
  resultKey: string;
  score: ScoringResult;
  status: "completed";
}

export interface ExamEvaluationJobAdapter {
  loadInput(input: ExamEvaluationJobInput): Promise<ExamEvaluationScoringInput>;
  saveResult(result: ExamEvaluationJobResult): Promise<ExamEvaluationJobResult>;
}

export async function processExamEvaluationJob(
  job: QueueJob<ExamEvaluationJobPayload>,
  adapter: ExamEvaluationJobAdapter,
): Promise<ExamEvaluationJobResult> {
  if (job.name !== "exam-evaluation") {
    throw new Error("EXAM_EVALUATION_JOB_NAME_INVALID");
  }
  assertTenantJobPayload(job.payload);
  assertExamEvaluationPayload(job.payload);

  return runWithJobContext(
    {
      tenantId: job.payload.tenantId,
      userId: job.payload.userId,
      jobId: job.id,
    },
    async () => {
      const input: ExamEvaluationJobInput = {
        tenantId: job.payload.tenantId,
        userId: job.payload.userId,
        jobId: job.id,
        participantId: job.payload.participantId,
        rawImportId: job.payload.rawImportId,
        answerKeyId: job.payload.answerKeyId,
        contentHash: job.payload.contentHash,
      };
      const scoringInput = await adapter.loadInput(input);
      assertQuestionCounts(scoringInput);
      const answers = alignAnswersToMaster(
        scoringInput.answers,
        scoringInput.bookletType,
        scoringInput.bookletVariants,
      );
      const score = scoreExam(answers, scoringInput.answerKey, scoringInput.scoringConfig);
      const result: ExamEvaluationJobResult = {
        tenantId: job.payload.tenantId,
        examId: scoringInput.examId,
        studentId: scoringInput.studentId,
        participantId: job.payload.participantId,
        rawImportId: job.payload.rawImportId,
        answerKeyId: job.payload.answerKeyId,
        parserConfigVersion: scoringInput.parserConfigVersion,
        answerKeyVersion: score._meta.answerKeyVersion,
        engineVersion: score._meta.engineVersion,
        resultKey: createExamResultKey({
          participantId: job.payload.participantId,
          rawImportId: job.payload.rawImportId,
          answerKeyVersion: score._meta.answerKeyVersion,
          parserConfigVersion: scoringInput.parserConfigVersion,
          engineVersion: score._meta.engineVersion,
          score,
        }),
        score,
        status: "completed",
      };
      return adapter.saveResult(result);
    },
  );
}

function assertExamEvaluationPayload(payload: ExamEvaluationJobPayload): void {
  if (!payload.participantId || !payload.rawImportId || !payload.answerKeyId) {
    throw new Error("EXAM_EVALUATION_PAYLOAD_INVALID");
  }
}

function assertQuestionCounts(input: ExamEvaluationScoringInput): void {
  if (input.answers.length !== input.answerKey.length) {
    throw new Error("EXAM_EVALUATION_QUESTION_COUNT_MISMATCH");
  }

  const expectedQuestionCount =
    input.scoringConfig.examType === "LGS" ? 90 :
    input.scoringConfig.examType === "TYT" ? 120 :
    input.scoringConfig.examType === "AYT" ? 160 :
    undefined;
  if (expectedQuestionCount !== undefined && input.answerKey.length !== expectedQuestionCount) {
    throw new Error("EXAM_EVALUATION_EXAM_TYPE_QUESTION_COUNT_MISMATCH");
  }
}

function createExamResultKey(input: {
  participantId: string;
  rawImportId: string;
  answerKeyVersion: string;
  parserConfigVersion: string;
  engineVersion: string;
  score: ScoringResult;
}): string {
  const { computedAt: _computedAt, ...stableMeta } = input.score._meta;
  return createHash("sha256")
    .update(JSON.stringify({ ...input, score: { ...input.score, _meta: stableMeta } }))
    .digest("hex");
}
