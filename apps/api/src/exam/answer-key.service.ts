import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional } from "@nestjs/common";
import type {
  AnswerChoice,
  AnswerKeyBranchSummary,
  AnswerKeyEvaluationStatus,
  AnswerKeyItemInput,
  AnswerKeyRecord,
  AnswerKeyScoreSection,
  AnswerKeyScoringConfig,
  ExamType,
} from "@o-okul/shared-types";
import { AuditLogService } from "../audit-log/audit-log.service.js";
import type { RequestContext } from "../context/request-context.js";
import { IdempotencyService } from "../http/idempotency.js";
import { reportSnapshotStoreToken, type ReportSnapshotStore } from "../report/report-snapshot-store.js";
import { requireTenantWideStaffContext } from "../tenant/tenant-access.js";

export const answerKeyRepositoryToken = Symbol("AnswerKeyRepository");

const answerChoices = new Set<AnswerChoice>(["A", "B", "C", "D", "E"]);
const answerKeyScoreSections = new Set<AnswerKeyScoreSection>([
  "LGS_TURKCE", "LGS_MATEMATIK", "LGS_FEN", "LGS_INKILAP", "LGS_DIN", "LGS_YABANCI_DIL",
  "TYT_TURKCE", "TYT_SOSYAL", "TYT_MATEMATIK", "TYT_FEN",
  "AYT_MATEMATIK", "AYT_FIZIK", "AYT_KIMYA", "AYT_BIYOLOJI", "AYT_EDEBIYAT",
  "AYT_TARIH_1", "AYT_COGRAFYA_1", "AYT_TARIH_2", "AYT_COGRAFYA_2", "AYT_FELSEFE", "AYT_DIN",
]);

export interface AnswerKeyExamScoringContext {
  examType?: ExamType | string;
  examYear?: number;
  scoringProfileId?: string;
}

export interface SaveAnswerKeyInput {
  tenantId: string;
  examId: string;
  version: string;
  questions: AnswerKeyItemInput[];
  scoringConfig: AnswerKeyScoringConfig;
  bookletVariants?: SaveAnswerKeyBookletVariantInput[];
}

export interface SaveAnswerKeyBookletVariantInput {
  code: string;
  permutation: number[];
}

export interface AnswerKeyBookletVariantSummary {
  code: string;
  questionCount: number;
}

export interface AnswerKeyRepository {
  create(input: SaveAnswerKeyInput): Promise<AnswerKeyRecord>;
  list(tenantId: string, examId: string): Promise<AnswerKeyRecord[]>;
  publish(tenantId: string, examId: string, version: string): Promise<AnswerKeyRecord | undefined>;
  findExamScoringContext?(tenantId: string, examId: string): Promise<AnswerKeyExamScoringContext | undefined>;
}

export interface CreateAnswerKeyInput {
  examId?: string;
  version?: string;
  questions?: unknown;
  scoringConfig?: unknown;
  dryRun?: unknown;
  bookletVariants?: unknown;
}

export interface AnswerKeyDryRunResult {
  tenantId: string;
  examId: string;
  version: string;
  questionCount: number;
  branches: AnswerKeyBranchSummary[];
  scoringConfig: AnswerKeyScoringConfig;
  bookletVariants: AnswerKeyBookletVariantSummary[];
  status: "DRY_RUN";
}

@Injectable()
export class AnswerKeyService {
  constructor(
    @Inject(answerKeyRepositoryToken)
    private readonly repository: AnswerKeyRepository,
    @Optional() private readonly auditLogs?: AuditLogService,
    @Optional()
    @Inject(reportSnapshotStoreToken)
    private readonly snapshots?: ReportSnapshotStore,
    @Optional() private readonly idempotency?: IdempotencyService,
  ) {}

  async create(
    context: RequestContext,
    input: CreateAnswerKeyInput,
    idempotencyKey?: string,
  ): Promise<AnswerKeyRecord | AnswerKeyDryRunResult> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "answer-key.create", request: input },
        () => this.createOnce(context, input),
      );
    }

    return this.createOnce(context, input);
  }

  private async createOnce(
    context: RequestContext,
    input: CreateAnswerKeyInput,
  ): Promise<AnswerKeyRecord | AnswerKeyDryRunResult> {
    const tenantId = requireTenant(context);
    const examId = requiredString(input.examId, "ANSWER_KEY_EXAM_REQUIRED");
    const version = requiredString(input.version, "ANSWER_KEY_VERSION_REQUIRED");
    const questions = parseQuestions(input.questions);
    const scoringConfig = parseScoringConfig(input.scoringConfig);
    const examScoringContext = await this.repository.findExamScoringContext?.(tenantId, examId);
    assertOfficialAnswerKeyProfile(examScoringContext, questions, scoringConfig);
    const bookletVariants = parseBookletVariants(input.bookletVariants, questions.length);
    const summary = summarizeAnswerKeyQuestions(questions);

    if (input.dryRun === true) {
      return {
        tenantId,
        examId,
        version,
        questionCount: summary.questionCount,
        branches: summary.branches,
        scoringConfig,
        bookletVariants: summarizeBookletVariants(bookletVariants),
        status: "DRY_RUN",
      };
    }

    try {
      const record = await this.repository.create({ tenantId, examId, version, questions, scoringConfig, bookletVariants });
      await this.snapshots?.markStaleByExam(tenantId, examId, "answer_key.created");
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
    const tenantId = requireReadTenant(context);
    return this.repository.list(tenantId, requiredString(examId, "ANSWER_KEY_EXAM_REQUIRED"));
  }

  async publish(
    context: RequestContext,
    examId: string | undefined,
    version: string | undefined,
    idempotencyKey?: string,
  ): Promise<AnswerKeyRecord> {
    if (idempotencyKey && this.idempotency) {
      return this.idempotency.run(
        context,
        { key: idempotencyKey, operation: "answer-key.publish", request: { examId, version } },
        () => this.publishOnce(context, examId, version),
      );
    }

    return this.publishOnce(context, examId, version);
  }

  private async publishOnce(
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
    await this.snapshots?.markStaleByExam(tenantId, resolvedExamId, "answer_key.published");
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
    const topic = typeof record.topic === "string" && record.topic.trim() ? record.topic.trim() : undefined;
    const scoreSection = typeof record.scoreSection === "string"
      ? record.scoreSection.trim().toUpperCase() as AnswerKeyScoreSection
      : undefined;
    if (scoreSection && !answerKeyScoreSections.has(scoreSection)) {
      throw new BadRequestException("ANSWER_KEY_SCORE_SECTION_INVALID");
    }
    const evaluationStatus = record.evaluationStatus === undefined
      ? "ACTIVE"
      : record.evaluationStatus as AnswerKeyEvaluationStatus;
    if (evaluationStatus !== "ACTIVE" && evaluationStatus !== "CANCELLED") {
      throw new BadRequestException("ANSWER_KEY_EVALUATION_STATUS_INVALID");
    }
    return {
      questionNo,
      correctAnswer,
      branch,
      ...(scoreSection ? { scoreSection } : {}),
      evaluationStatus,
      ...(outcomeCode ? { outcomeCode } : {}),
      ...(topic ? { topic } : {}),
    };
  });

  return questions.sort((a, b) => a.questionNo - b.questionNo);
}

function assertOfficialAnswerKeyProfile(
  context: AnswerKeyExamScoringContext | undefined,
  questions: AnswerKeyItemInput[],
  scoringConfig: AnswerKeyScoringConfig,
): void {
  if (!context?.scoringProfileId) return;

  const expected = context.scoringProfileId === "TR-LGS-2026-NOSD-V1"
    ? { examType: "LGS", examYear: 2026, wrongPenalty: 1 / 3, scoreSectionPrefix: "LGS_" }
    : context.scoringProfileId === "TR-YKS-2026-NOSD-V1"
      ? { examType: context.examType, examYear: 2026, wrongPenalty: 1 / 4, scoreSectionPrefix: context.examType === "AYT" ? "AYT_" : "TYT_" }
      : undefined;
  if (!expected) {
    throw new BadRequestException("SCORING_PROFILE_UNSUPPORTED");
  }
  if (
    context.examType !== expected.examType && context.scoringProfileId === "TR-LGS-2026-NOSD-V1"
    || context.scoringProfileId === "TR-YKS-2026-NOSD-V1" && context.examType !== "TYT" && context.examType !== "AYT"
  ) {
    throw new BadRequestException("SCORING_PROFILE_EXAM_TYPE_MISMATCH");
  }
  if (context.examYear !== expected.examYear) {
    throw new BadRequestException("SCORING_PROFILE_EXAM_YEAR_MISMATCH");
  }
  if (Math.abs(scoringConfig.wrongPenalty - expected.wrongPenalty) > 0.000001) {
    throw new BadRequestException("SCORING_PROFILE_WRONG_PENALTY_MISMATCH");
  }
  if (questions.some((question) =>
    question.evaluationStatus !== "CANCELLED" && !question.scoreSection?.startsWith(expected.scoreSectionPrefix)
  )) {
    throw new BadRequestException("SCORING_PROFILE_SCORE_SECTION_MISMATCH");
  }
}

function parseBookletVariants(value: unknown, questionCount: number): SaveAnswerKeyBookletVariantInput[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new BadRequestException("ANSWER_KEY_BOOKLET_VARIANTS_INVALID");
  }

  const seen = new Set<string>();
  return value.map((item) => {
    const record = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
    const code = typeof record.code === "string" ? record.code.trim().toUpperCase() : "";
    if (!code) {
      throw new BadRequestException("ANSWER_KEY_BOOKLET_CODE_REQUIRED");
    }
    if (seen.has(code)) {
      throw new BadRequestException("ANSWER_KEY_BOOKLET_CODE_DUPLICATE");
    }
    seen.add(code);

    const permutation = Array.isArray(record.permutation) ? record.permutation : [];
    if (permutation.length !== questionCount) {
      throw new BadRequestException("ANSWER_KEY_BOOKLET_PERMUTATION_INVALID");
    }
    const used = new Set<number>();
    const parsed = permutation.map((value) => {
      if (typeof value !== "number" || !Number.isInteger(value) || value <= 0 || value > questionCount || used.has(value)) {
        throw new BadRequestException("ANSWER_KEY_BOOKLET_PERMUTATION_INVALID");
      }
      used.add(value);
      return value;
    });
    return { code, permutation: parsed };
  });
}

function summarizeBookletVariants(variants: SaveAnswerKeyBookletVariantInput[]): AnswerKeyBookletVariantSummary[] {
  return variants.map((variant) => ({ code: variant.code, questionCount: variant.permutation.length }));
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
  try {
    return requireTenantWideStaffContext(context, "ANSWER_KEY_CAMPUS_SCOPE_FORBIDDEN");
  } catch (error) {
    throw new ForbiddenException(error instanceof Error ? error.message : "ANSWER_KEY_CAMPUS_SCOPE_FORBIDDEN");
  }
}

function requireReadTenant(context: RequestContext): string {
  const hasAdminRole = context.roles.some((role) => (
    role === "TENANT_OWNER" || role === "TENANT_ADMIN" || role === "ASSISTANT_ADMIN"
  ));
  if (context.activePersona === "TEACHER" || (context.roles.includes("TEACHER") && !hasAdminRole)) {
    if (!context.tenantId) throw new ForbiddenException("TENANT_CONTEXT_MISSING");
    return context.tenantId;
  }
  return requireTenant(context);
}

function requiredString(value: string | undefined, errorCode: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new BadRequestException(errorCode);
  }
  return trimmed;
}
