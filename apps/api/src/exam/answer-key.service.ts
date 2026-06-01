import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import type {
  AnswerChoice,
  AnswerKeyBranchSummary,
  AnswerKeyItemInput,
  AnswerKeyRecord,
  AnswerKeyScoringConfig,
} from "@uzman-hocam/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";

export const answerKeyRepositoryToken = Symbol("AnswerKeyRepository");

const answerChoices = new Set<AnswerChoice>(["A", "B", "C", "D", "E"]);

export interface SaveAnswerKeyInput {
  tenantId: string;
  examId: string;
  version: string;
  questions: AnswerKeyItemInput[];
  scoringConfig: AnswerKeyScoringConfig;
}

export interface AnswerKeyRepository {
  create(input: SaveAnswerKeyInput): Promise<AnswerKeyRecord>;
  list(tenantId: string, examId: string): Promise<AnswerKeyRecord[]>;
  publish(tenantId: string, examId: string, version: string): Promise<AnswerKeyRecord | undefined>;
}

export interface CreateAnswerKeyInput {
  examId?: string;
  version?: string;
  questions?: unknown;
  scoringConfig?: unknown;
}

@Injectable()
export class AnswerKeyService {
  constructor(
    @Inject(answerKeyRepositoryToken)
    private readonly repository: AnswerKeyRepository,
    @Optional() private readonly auditLogs?: AuditLogService,
  ) {}

  async create(context: RequestContext, input: CreateAnswerKeyInput): Promise<AnswerKeyRecord> {
    const tenantId = requireTenant(context);
    const examId = requiredString(input.examId, "ANSWER_KEY_EXAM_REQUIRED");
    const version = requiredString(input.version, "ANSWER_KEY_VERSION_REQUIRED");
    const questions = parseQuestions(input.questions);
    const scoringConfig = parseScoringConfig(input.scoringConfig);

    try {
      const record = await this.repository.create({ tenantId, examId, version, questions, scoringConfig });
      await this.auditLogs?.record({
        tenantId,
        actorUserId: context.userId,
        entityType: "AnswerKey",
        entityId: `${record.examId}:${record.version}`,
        action: "answer_key.created",
        diff: {
          examId: record.examId,
          version: record.version,
          questionCount: record.questionCount,
          branches: record.branches.map((branch) => branch.branch),
          wrongPenalty: record.scoringConfig.wrongPenalty,
        },
      });
      return record;
    } catch (error) {
      if (error instanceof Error && error.message === "ANSWER_KEY_VERSION_CONFLICT") {
        throw new ConflictException("ANSWER_KEY_VERSION_CONFLICT");
      }
      throw error;
    }
  }

  async list(context: RequestContext, examId: string | undefined): Promise<AnswerKeyRecord[]> {
    const tenantId = requireTenant(context);
    return this.repository.list(tenantId, requiredString(examId, "ANSWER_KEY_EXAM_REQUIRED"));
  }

  async publish(
    context: RequestContext,
    examId: string | undefined,
    version: string | undefined,
  ): Promise<AnswerKeyRecord> {
    const tenantId = requireTenant(context);
    const resolvedExamId = requiredString(examId, "ANSWER_KEY_EXAM_REQUIRED");
    const resolvedVersion = requiredString(version, "ANSWER_KEY_VERSION_REQUIRED");
    const record = await this.repository.publish(tenantId, resolvedExamId, resolvedVersion);
    if (!record) {
      throw new BadRequestException("ANSWER_KEY_NOT_FOUND");
    }
    await this.auditLogs?.record({
      tenantId,
      actorUserId: context.userId,
      entityType: "AnswerKey",
      entityId: `${record.examId}:${record.version}`,
      action: "answer_key.published",
      diff: { examId: record.examId, version: record.version },
    });
    return record;
  }
}

/** Cevap anahtarı sorularından soru sayısı + branş kırılımı özeti çıkarır (branş adına göre sıralı). */
export function summarizeAnswerKeyQuestions(questions: AnswerKeyItemInput[]): {
  questionCount: number;
  branches: AnswerKeyBranchSummary[];
} {
  const counts = new Map<string, number>();
  for (const question of questions) {
    counts.set(question.branch, (counts.get(question.branch) ?? 0) + 1);
  }
  const branches = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([branch, questionCount]) => ({ branch, questionCount }));
  return { questionCount: questions.length, branches };
}

function parseQuestions(value: unknown): AnswerKeyItemInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException("ANSWER_KEY_QUESTIONS_REQUIRED");
  }

  const seen = new Set<number>();
  const questions = value.map((item) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    const questionNo = record.questionNo;
    if (typeof questionNo !== "number" || !Number.isInteger(questionNo) || questionNo <= 0) {
      throw new BadRequestException("ANSWER_KEY_QUESTION_NO_INVALID");
    }
    if (seen.has(questionNo)) {
      throw new BadRequestException("ANSWER_KEY_QUESTION_DUPLICATE");
    }
    seen.add(questionNo);

    const correctAnswer = typeof record.correctAnswer === "string" ? (record.correctAnswer.trim().toUpperCase() as AnswerChoice) : undefined;
    if (!correctAnswer || !answerChoices.has(correctAnswer)) {
      throw new BadRequestException("ANSWER_KEY_CORRECT_ANSWER_INVALID");
    }

    const branch = typeof record.branch === "string" ? record.branch.trim() : "";
    if (!branch) {
      throw new BadRequestException("ANSWER_KEY_BRANCH_REQUIRED");
    }

    const outcomeCode = typeof record.outcomeCode === "string" && record.outcomeCode.trim() ? record.outcomeCode.trim() : undefined;
    return {
      questionNo,
      correctAnswer,
      branch,
      ...(outcomeCode ? { outcomeCode } : {}),
    };
  });

  return questions.sort((a, b) => a.questionNo - b.questionNo);
}

function parseScoringConfig(value: unknown): AnswerKeyScoringConfig {
  const record = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const wrongPenalty = numberOrDefault(record.wrongPenalty, 0.25);
  if (wrongPenalty < 0) {
    throw new BadRequestException("ANSWER_KEY_WRONG_PENALTY_INVALID");
  }
  const rawScoreMultiplier = optionalNumber(record.rawScoreMultiplier);
  const standardScoreBase = optionalNumber(record.standardScoreBase);
  const standardScoreMultiplier = optionalNumber(record.standardScoreMultiplier);
  return {
    wrongPenalty,
    ...(rawScoreMultiplier !== undefined ? { rawScoreMultiplier } : {}),
    ...(standardScoreBase !== undefined ? { standardScoreBase } : {}),
    ...(standardScoreMultiplier !== undefined ? { standardScoreMultiplier } : {}),
  };
}

function numberOrDefault(value: unknown, fallback: number): number {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestException("ANSWER_KEY_SCORING_CONFIG_INVALID");
  }
  return value;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new BadRequestException("ANSWER_KEY_SCORING_CONFIG_INVALID");
  }
  return value;
}

function requireTenant(context: RequestContext): string {
  if (!context.tenantId) {
    throw new ForbiddenException("TENANT_CONTEXT_MISSING");
  }
  return context.tenantId;
}

function requiredString(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}
